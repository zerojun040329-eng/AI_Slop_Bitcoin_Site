import type { DistanceMetricType, IndicatorId, MarketRegimeId } from '../types/signalAnalysis.ts';
import type { NormalizedMatrixBundle } from './normalizationEngine.ts';
import { regimeIdToCode } from './regimeAnalyzer.ts';

export interface CandidateMatchRaw {
  index: number;
  openTimeMs: number;
  distance: number;
  mahalanobisDistance: number;
  euclideanDistance: number;
}

export interface ThresholdGuidance {
  recommendedLow: number;
  recommendedMid: number;
  recommendedHigh: number;
}

export interface SimilaritySearchResult {
  candidates: CandidateMatchRaw[];
  eligibleCount: number;
  guidance: ThresholdGuidance;
  targetVector: number[];
}

function invertSymmetricMatrixWithShrinkage(cov: number[][], k: number, shrinkage = 0.005): number[][] {
  if (k === 1) {
    const v = Math.max(1e-6, cov[0][0]);
    return [[1 / v]];
  }

  let trace = 0;
  for (let i = 0; i < k; i++) {
    trace += Math.max(0, cov[i][i]);
  }
  const avgDiag = trace > 1e-9 ? trace / k : 1;

  // Augmented matrix [A | I] of size k x 2k
  const aug: number[][] = Array.from({ length: k }, (_, r) => {
    const row = new Array<number>(2 * k).fill(0);
    for (let c = 0; c < k; c++) {
      const regVal = (1 - shrinkage) * cov[r][c] + (r === c ? shrinkage * avgDiag : 0);
      row[c] = regVal;
    }
    row[k + r] = 1;
    return row;
  });

  // Gauss-Jordan with partial pivoting
  for (let col = 0; col < k; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(aug[col][col]);
    for (let r = col + 1; r < k; r++) {
      const v = Math.abs(aug[r][col]);
      if (v > maxAbs) {
        maxAbs = v;
        pivotRow = r;
      }
    }

    if (pivotRow !== col) {
      const tmp = aug[col];
      aug[col] = aug[pivotRow];
      aug[pivotRow] = tmp;
    }

    const pivot = aug[col][col];
    const safePivot = Math.abs(pivot) < 1e-9 ? (pivot >= 0 ? 1e-9 : -1e-9) : pivot;
    const invPivot = 1 / safePivot;
    for (let j = 0; j < 2 * k; j++) {
      aug[col][j] *= invPivot;
    }

    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * k; j++) {
        aug[r][j] -= factor * aug[col][j];
      }
    }
  }

  return aug.map((row) => row.slice(k));
}

export function computeCausalInverseCovariance(
  norm: NormalizedMatrixBundle,
  selectedIds: IndicatorId[],
  maxIndexInclusive: number,
): number[][] {
  const k = selectedIds.length;
  const cols = selectedIds.map((id) => norm.normalized[id]);

  // Subsample stride up to 120,000 points within [0..maxIndexInclusive] for O(N * k^2) speed
  const step = Math.max(1, Math.floor((maxIndexInclusive + 1) / 120_000));
  const means = new Float64Array(k);
  let validN = 0;

  for (let i = 0; i <= maxIndexInclusive; i += step) {
    let ok = true;
    for (let a = 0; a < k; a++) {
      if (!Number.isFinite(cols[a][i])) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    validN++;
    for (let a = 0; a < k; a++) {
      means[a] += cols[a][i];
    }
  }

  if (validN < Math.max(30, k * 4)) {
    // Identity fallback if insufficient history
    return Array.from({ length: k }, (_, r) =>
      Array.from({ length: k }, (__, c) => (r === c ? 1 : 0)),
    );
  }

  for (let a = 0; a < k; a++) means[a] /= validN;

  const cov: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const diff = new Float64Array(k);

  for (let i = 0; i <= maxIndexInclusive; i += step) {
    let ok = true;
    for (let a = 0; a < k; a++) {
      const v = cols[a][i];
      if (!Number.isFinite(v)) {
        ok = false;
        break;
      }
      diff[a] = v - means[a];
    }
    if (!ok) continue;
    for (let a = 0; a < k; a++) {
      for (let b = a; b < k; b++) {
        cov[a][b] += diff[a] * diff[b];
      }
    }
  }

  const denom = Math.max(1, validN - 1);
  for (let a = 0; a < k; a++) {
    for (let b = a; b < k; b++) {
      const val = cov[a][b] / denom;
      cov[a][b] = val;
      cov[b][a] = val;
    }
  }

  return invertSymmetricMatrixWithShrinkage(cov, k, 0.005);
}

export function searchSimilarStates(params: {
  openTimeMs: Float64Array;
  norm: NormalizedMatrixBundle;
  regimes: Uint8Array;
  selectedIds: IndicatorId[];
  targetIndex: number;
  metric: DistanceMetricType;
  threshold: number;
  minGapMs: number;
  regimeFilter: MarketRegimeId | 'all';
}): SimilaritySearchResult {
  const {
    openTimeMs,
    norm,
    regimes,
    selectedIds,
    targetIndex,
    metric,
    threshold,
    minGapMs,
    regimeFilter,
  } = params;

  const k = selectedIds.length;
  if (k === 0) {
    throw new Error('유사도 검색을 위해 최소 1개 이상의 지표를 선택해야 합니다.');
  }

  const cols = selectedIds.map((id) => norm.normalized[id]);
  const targetVector = cols.map((c) => c[targetIndex]);
  for (let a = 0; a < k; a++) {
    if (!Number.isFinite(targetVector[a])) {
      throw new Error(
        `기준 시점(${new Date(openTimeMs[targetIndex]).toISOString()})에 ${selectedIds[a]} 지표가 계산 불가(null) 상태입니다.`,
      );
    }
  }

  const invCov = computeCausalInverseCovariance(norm, selectedIds, targetIndex);
  const targetOpenMs = openTimeMs[targetIndex];
  const maxEligibleOpenMs = targetOpenMs - minGapMs;
  const requiredRegimeCode = regimeFilter === 'all' ? -1 : regimeIdToCode(regimeFilter);

  const candidates: CandidateMatchRaw[] = [];
  const sampleDistances: number[] = [];
  let eligibleCount = 0;

  // Flatten symmetric invCov upper triangle for ultra-fast inner loop
  const diagInv = new Float64Array(k);
  const pairA: number[] = [];
  const pairB: number[] = [];
  const pairW: number[] = [];
  for (let a = 0; a < k; a++) {
    diagInv[a] = invCov[a][a];
    for (let b = a + 1; b < k; b++) {
      pairA.push(a);
      pairB.push(b);
      pairW.push(2 * invCov[a][b]);
    }
  }
  const pairLen = pairA.length;
  const dVec = new Float64Array(k);

  for (let i = 0; i < targetIndex; i++) {
    if (openTimeMs[i] > maxEligibleOpenMs) break;
    if (requiredRegimeCode !== -1 && regimes[i] !== requiredRegimeCode) continue;

    let ok = true;
    let euclidSq = 0;
    for (let a = 0; a < k; a++) {
      const val = cols[a][i];
      if (!Number.isFinite(val)) {
        ok = false;
        break;
      }
      const diff = val - targetVector[a];
      dVec[a] = diff;
      euclidSq += diff * diff;
    }
    if (!ok) continue;

    let mahalSq = 0;
    for (let a = 0; a < k; a++) {
      mahalSq += diagInv[a] * dVec[a] * dVec[a];
    }
    for (let p = 0; p < pairLen; p++) {
      mahalSq += pairW[p] * dVec[pairA[p]] * dVec[pairB[p]];
    }

    const mahalDist = Math.sqrt(Math.max(0, mahalSq));
    const euclidDist = Math.sqrt(Math.max(0, euclidSq));
    const primaryDist = metric === 'mahalanobis' ? mahalDist : euclidDist;

    if ((eligibleCount & 15) === 0) {
      sampleDistances.push(primaryDist);
    }
    eligibleCount++;

    if (primaryDist <= threshold) {
      candidates.push({
        index: i,
        openTimeMs: openTimeMs[i],
        distance: primaryDist,
        mahalanobisDistance: mahalDist,
        euclideanDistance: euclidDist,
      });
    }
  }

  sampleDistances.sort((a, b) => a - b);
  const pickQuantile = (q: number, fallback: number): number => {
    if (sampleDistances.length === 0) return fallback;
    const pos = Math.min(sampleDistances.length - 1, Math.max(0, Math.floor(sampleDistances.length * q)));
    return Math.round(sampleDistances[pos] * 100) / 100;
  };

  const guidance: ThresholdGuidance = {
    recommendedLow: Math.max(0.2, pickQuantile(0.0015, Math.sqrt(k) * 0.45)),
    recommendedMid: Math.max(0.35, pickQuantile(0.005, Math.sqrt(k) * 0.65)),
    recommendedHigh: Math.max(0.5, pickQuantile(0.015, Math.sqrt(k) * 0.85)),
  };

  return {
    candidates,
    eligibleCount,
    guidance,
    targetVector,
  };
}
