import {
  ALL_INDICATOR_IDS,
  INDICATOR_DEFINITIONS,
  type IndependenceMatrixReport,
  type IndicatorId,
  type IndicatorPairStat,
  type IndicatorStabilityStat,
} from '../types/signalAnalysis.ts';
import type { NormalizedMatrixBundle } from './normalizationEngine.ts';

const REDUNDANCY_CORR_THRESHOLD = 0.8;
const MI_QUANTILE_BINS = 16;

function computeRanksForSample(values: Float64Array): Float64Array {
  const n = values.length;
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => values[a] - values[b]);

  const ranks = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i + 1;
    const v = values[idx[i]];
    while (j < n && values[idx[j]] === v) j++;
    const avgRank = (i + j - 1) * 0.5;
    for (let k = i; k < j; k++) {
      ranks[idx[k]] = avgRank;
    }
    i = j;
  }
  return ranks;
}

function pearsonFromArrays(a: Float64Array, b: Float64Array): number {
  const n = a.length;
  if (n < 3) return 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const denom = Math.sqrt(denA * denB);
  if (denom <= 1e-12) return 0;
  return Math.max(-1, Math.min(1, num / denom));
}

function mutualInfoBitsFromRanks(
  ranksA: Float64Array,
  ranksB: Float64Array,
  bins = MI_QUANTILE_BINS,
): number {
  const n = ranksA.length;
  if (n < bins * 4) return 0;
  const joint = new Int32Array(bins * bins);
  const margA = new Int32Array(bins);
  const margB = new Int32Array(bins);

  for (let i = 0; i < n; i++) {
    const ba = Math.min(bins - 1, Math.floor((ranksA[i] / n) * bins));
    const bb = Math.min(bins - 1, Math.floor((ranksB[i] / n) * bins));
    joint[ba * bins + bb] += 1;
    margA[ba] += 1;
    margB[bb] += 1;
  }

  let mi = 0;
  const log2 = Math.LN2;
  for (let a = 0; a < bins; a++) {
    if (margA[a] === 0) continue;
    const pa = margA[a] / n;
    for (let b = 0; b < bins; b++) {
      const c = joint[a * bins + b];
      if (c === 0 || margB[b] === 0) continue;
      const pab = c / n;
      const pb = margB[b] / n;
      mi += pab * (Math.log(pab / (pa * pb)) / log2);
    }
  }
  return Math.max(0, mi);
}

function computePsiHalfDrift(firstHalf: Float64Array, secondHalf: Float64Array): number {
  if (firstHalf.length < 100 || secondHalf.length < 100) return 0;
  // Build 10 quantile edges from firstHalf
  const sortedFirst = Float64Array.from(firstHalf).sort();
  const edges: number[] = [];
  for (let b = 1; b < 10; b++) {
    const pos = Math.floor((b / 10) * sortedFirst.length);
    edges.push(sortedFirst[pos]);
  }

  const countBins = (arr: Float64Array): Float64Array => {
    const counts = new Float64Array(10);
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      let bin = 0;
      while (bin < 9 && v > edges[bin]) bin++;
      counts[bin] += 1;
    }
    for (let b = 0; b < 10; b++) {
      counts[b] = Math.max(0.0001, counts[b] / arr.length);
    }
    return counts;
  };

  const p = countBins(firstHalf);
  const q = countBins(secondHalf);
  let psi = 0;
  for (let b = 0; b < 10; b++) {
    psi += (q[b] - p[b]) * Math.log(q[b] / p[b]);
  }
  return Math.max(0, psi);
}

export function analyzeIndicatorIndependence(
  normBundle: NormalizedMatrixBundle,
  rawMatrix: Record<IndicatorId, Float64Array>,
): IndependenceMatrixReport {
  const ids = [...ALL_INDICATOR_IDS];
  const d = ids.length;
  const totalCount = normBundle.count;

  // Find indices where ALL 8 normalized indicators are finite
  const validIndices: number[] = [];
  for (let i = 0; i < totalCount; i++) {
    let ok = true;
    for (let k = 0; k < d; k++) {
      if (!Number.isFinite(normBundle.normalized[ids[k]][i])) {
        ok = false;
        break;
      }
    }
    if (ok) validIndices.push(i);
  }

  const validLen = validIndices.length;
  const pearsonMatrix: number[][] = Array.from({ length: d }, () => Array(d).fill(0));
  const spearmanMatrix: number[][] = Array.from({ length: d }, () => Array(d).fill(0));
  const mutualInfoMatrix: number[][] = Array.from({ length: d }, () => Array(d).fill(0));

  // Build aligned Float64Arrays for exact Pearson
  const alignedFull = ids.map((id) => {
    const arr = new Float64Array(validLen);
    const src = normBundle.normalized[id];
    for (let idx = 0; idx < validLen; idx++) {
      arr[idx] = src[validIndices[idx]];
    }
    return arr;
  });

  // Evenly subsample up to 80,000 points for Spearman & MI so runtime stays <40ms
  const maxRankSamples = 80_000;
  const step = Math.max(1, Math.floor(validLen / maxRankSamples));
  const sampledCount = Math.ceil(validLen / step);
  const alignedRankSample = ids.map((_, k) => {
    const arr = new Float64Array(sampledCount);
    const full = alignedFull[k];
    let outIdx = 0;
    for (let i = 0; i < validLen && outIdx < sampledCount; i += step) {
      arr[outIdx++] = full[i];
    }
    return computeRanksForSample(arr.subarray(0, outIdx));
  });

  const redundantPairs: IndicatorPairStat[] = [];

  for (let r = 0; r < d; r++) {
    pearsonMatrix[r][r] = 1;
    spearmanMatrix[r][r] = 1;
    mutualInfoMatrix[r][r] = Math.log2(MI_QUANTILE_BINS);

    for (let c = r + 1; c < d; c++) {
      const pCorr = pearsonFromArrays(alignedFull[r], alignedFull[c]);
      const sCorr = pearsonFromArrays(alignedRankSample[r], alignedRankSample[c]);
      const mi = mutualInfoBitsFromRanks(alignedRankSample[r], alignedRankSample[c]);

      pearsonMatrix[r][c] = pCorr;
      pearsonMatrix[c][r] = pCorr;
      spearmanMatrix[r][c] = sCorr;
      spearmanMatrix[c][r] = sCorr;
      mutualInfoMatrix[r][c] = mi;
      mutualInfoMatrix[c][r] = mi;

      const isRedundant =
        Math.abs(pCorr) >= REDUNDANCY_CORR_THRESHOLD ||
        Math.abs(sCorr) >= REDUNDANCY_CORR_THRESHOLD;

      if (isRedundant) {
        redundantPairs.push({
          rowId: ids[r],
          colId: ids[c],
          pearson: pCorr,
          spearman: sCorr,
          mutualInfo: mi,
          isRedundant: true,
        });
      }
    }
  }

  // Compute stability & decide redundant exclusion if any pair >= 0.8
  const stabilityRaw: Omit<IndicatorStabilityStat, 'isRedundantExcluded' | 'exclusionReason'>[] =
    ids.map((id, k) => {
      const rawArr = rawMatrix[id];
      let validCount = 0;
      let nullCount = 0;
      let sum = 0;
      let sumSq = 0;

      for (let i = 0; i < totalCount; i++) {
        const v = rawArr[i];
        if (Number.isFinite(v)) {
          validCount++;
          sum += v;
          sumSq += v * v;
        } else {
          nullCount++;
        }
      }

      const normArr = alignedFull[k];
      const half = Math.floor(normArr.length / 2);
      const firstHalf = normArr.subarray(0, half);
      const secondHalf = normArr.subarray(half);

      const calcMeanStd = (a: Float64Array) => {
        if (a.length === 0) return { mean: 0, std: 0 };
        let s = 0;
        for (let i = 0; i < a.length; i++) s += a[i];
        const m = s / a.length;
        let sq = 0;
        for (let i = 0; i < a.length; i++) {
          const dVal = a[i] - m;
          sq += dVal * dVal;
        }
        return { mean: m, std: Math.sqrt(sq / a.length) };
      };

      const s1 = calcMeanStd(firstHalf);
      const s2 = calcMeanStd(secondHalf);
      const mean = validCount > 0 ? sum / validCount : 0;
      const variance = validCount > 1 ? Math.max(0, sumSq / validCount - mean * mean) : 0;
      const psiDrift = computePsiHalfDrift(firstHalf, secondHalf);

      return {
        id,
        validCount,
        nullCount,
        mean,
        stdDev: Math.sqrt(variance),
        firstHalfMean: s1.mean,
        secondHalfMean: s2.mean,
        firstHalfStd: s1.std,
        secondHalfStd: s2.std,
        psiDrift,
      };
    });

  const excludedSet = new Set<IndicatorId>();
  const exclusionReasons = new Map<IndicatorId, string>();

  // Greedy exclusion on any redundant pair (|r| >= 0.8): exclude one with higher mean |corr| to remaining indicators
  const sortedPairs = [...redundantPairs].sort(
    (a, b) => Math.max(Math.abs(b.pearson), Math.abs(b.spearman)) - Math.max(Math.abs(a.pearson), Math.abs(a.spearman)),
  );

  for (const pair of sortedPairs) {
    if (excludedSet.has(pair.rowId) || excludedSet.has(pair.colId)) continue;
    const rIdx = ids.indexOf(pair.rowId);
    const cIdx = ids.indexOf(pair.colId);

    const avgAbsCorr = (idx: number) => {
      let acc = 0;
      let cnt = 0;
      for (let j = 0; j < d; j++) {
        if (j === idx || excludedSet.has(ids[j])) continue;
        acc += Math.abs(pearsonMatrix[idx][j]);
        cnt++;
      }
      return cnt > 0 ? acc / cnt : 0;
    };

    const rAvg = avgAbsCorr(rIdx);
    const cAvg = avgAbsCorr(cIdx);
    const dropId = rAvg >= cAvg ? pair.rowId : pair.colId;
    const keepId = dropId === pair.rowId ? pair.colId : pair.rowId;
    excludedSet.add(dropId);
    exclusionReasons.set(
      dropId,
      `${INDICATOR_DEFINITIONS[keepId].shortLabel}와 상관계수 |r|≥0.80 중복 (Pearson ${pair.pearson.toFixed(3)}, Spearman ${pair.spearman.toFixed(3)})`,
    );
  }

  const stability: IndicatorStabilityStat[] = stabilityRaw.map((item) => ({
    ...item,
    isRedundantExcluded: excludedSet.has(item.id),
    exclusionReason: exclusionReasons.get(item.id) ?? null,
  }));

  const activeIndicatorIds = ids.filter((id) => !excludedSet.has(id));
  const excludedIndicatorIds = ids.filter((id) => excludedSet.has(id));

  const maxOffDiagCorr = (() => {
    let m = 0;
    for (let r = 0; r < d; r++) {
      for (let c = r + 1; c < d; c++) {
        m = Math.max(m, Math.abs(pearsonMatrix[r][c]), Math.abs(spearmanMatrix[r][c]));
      }
    }
    return m;
  })();

  const summaryNote =
    excludedIndicatorIds.length === 0
      ? `8개 지표 간 최대 절대 상관계수는 ${maxOffDiagCorr.toFixed(3)}로 중복 임계값(0.80) 미만입니다. 모든 8개 지표가 독립 정보량을 보유하여 상태 벡터에 포함됩니다.`
      : `${redundantPairs.length}개 지표 쌍에서 |r| ≥ 0.80 중복이 감지되어 ${excludedIndicatorIds.map((id) => INDICATOR_DEFINITIONS[id].shortLabel).join(', ')}을(를) 기본 축에서 제외 권고하고 ${activeIndicatorIds.length}개 독립 지표를 기본 채택했습니다.`;

  return {
    sampleCount: validLen,
    ids,
    activeIndicatorIds,
    excludedIndicatorIds,
    redundancyThreshold: REDUNDANCY_CORR_THRESHOLD,
    redundantPairs,
    pearsonMatrix,
    spearmanMatrix,
    mutualInfoMatrix,
    stability,
    summaryNote,
  };
}
