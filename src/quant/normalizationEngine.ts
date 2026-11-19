import { ALL_INDICATOR_IDS, type IndicatorId } from '../types/signalAnalysis.ts';
import type { RawIndicatorMatrix } from './indicatorCalculator.ts';

const BINS = 2048;
const MIN_CAUSAL_SAMPLES = 288; // 1 day of 5m bars before emitting causal normalized vector

export interface NormalizedMatrixBundle {
  count: number;
  normalized: Record<IndicatorId, Float64Array>;
  causalPercentile: Record<IndicatorId, Float64Array>;
  causalZScore: Record<IndicatorId, Float64Array>;
}

// Acklam inverse normal CDF approximation (error < 1.15e-9)
export function inverseNormalCdf(pRaw: number): number {
  const p = Math.max(1e-4, Math.min(1 - 1e-4, pRaw));
  const a1 = -3.969683028665376e1;
  const a2 = 2.209460984245205e2;
  const a3 = -2.759285104469687e2;
  const a4 = 1.38357751867269e2;
  const a5 = -3.066479806614716e1;
  const a6 = 2.506628277459239e0;

  const b1 = -5.447609879822406e1;
  const b2 = 1.615858368580409e2;
  const b3 = -1.556989798598866e2;
  const b4 = 6.680131188771972e1;
  const b5 = -1.328068155288572e1;

  const c1 = -7.784894002430293e-3;
  const c2 = -3.223964580411365e-1;
  const c3 = -2.400758277161838e0;
  const c4 = -2.549732539343734e0;
  const c5 = 4.374664141464968e0;
  const c6 = 2.938163982698783e0;

  const d1 = 7.784695709041462e-3;
  const d2 = 3.224671290700398e-1;
  const d3 = 2.445134137142996e0;
  const d4 = 3.754408661907416e0;

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
      ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
    );
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q) /
      (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
    ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
  );
}

class FenwickHistogram {
  private readonly tree: Int32Array;
  private readonly size: number;
  private total = 0;

  constructor(size: number) {
    this.size = size;
    this.tree = new Int32Array(size + 1);
  }

  add(binZeroBased: number): void {
    let idx = Math.max(0, Math.min(this.size - 1, binZeroBased)) + 1;
    while (idx <= this.size) {
      this.tree[idx] += 1;
      idx += idx & -idx;
    }
    this.total += 1;
  }

  prefixSum(binZeroBased: number): number {
    let idx = Math.max(0, Math.min(this.size - 1, binZeroBased)) + 1;
    let sum = 0;
    while (idx > 0) {
      sum += this.tree[idx];
      idx -= idx & -idx;
    }
    return sum;
  }

  get count(): number {
    return this.total;
  }
}

interface BinSpec {
  minVal: number;
  maxVal: number;
  useLog: boolean;
}

const INDICATOR_BIN_SPEC: Record<IndicatorId, BinSpec> = {
  er48: { minVal: 0, maxVal: 1, useLog: false },
  rsi14: { minVal: 0, maxVal: 100, useLog: false },
  vwapZ48: { minVal: -6, maxVal: 6, useLog: false },
  rv48: { minVal: -6, maxVal: 3, useLog: true }, // ln(0.0025%) ~ -6, ln(20%) ~ 3
  rvol48: { minVal: -5, maxVal: 5, useLog: true }, // ln(rvol)
  vp12: { minVal: -1, maxVal: 1, useLog: false },
  donchian48: { minVal: -0.5, maxVal: 1.5, useLog: false },
  amihud48: { minVal: -10, maxVal: 8, useLog: true }, // ln(amihud)
};

function mapValueToBin(val: number, spec: BinSpec): number {
  const x = spec.useLog ? Math.log(val) : val;
  const ratio = (x - spec.minVal) / (spec.maxVal - spec.minVal);
  const clamped = Math.max(0, Math.min(0.999999, ratio));
  return Math.floor(clamped * BINS);
}

export function computeCausalNormalization(
  raw: RawIndicatorMatrix,
  count: number,
): NormalizedMatrixBundle {
  const normalized = {} as Record<IndicatorId, Float64Array>;
  const causalPercentile = {} as Record<IndicatorId, Float64Array>;
  const causalZScore = {} as Record<IndicatorId, Float64Array>;

  for (const id of ALL_INDICATOR_IDS) {
    const src = raw[id];
    const spec = INDICATOR_BIN_SPEC[id];
    const normOut = new Float64Array(count).fill(NaN);
    const pctOut = new Float64Array(count).fill(NaN);
    const zOut = new Float64Array(count).fill(NaN);

    const hist = new FenwickHistogram(BINS);
    let wCount = 0;
    let wMean = 0;
    let wM2 = 0;

    for (let i = 0; i < count; i++) {
      const v = src[i];
      if (!Number.isFinite(v)) continue;
      if (spec.useLog && v <= 0) continue;

      const bin = mapValueToBin(v, spec);
      hist.add(bin);

      // Percentile uses count <= current bin up to time i (strictly causal)
      const rankCount = hist.prefixSum(bin);
      const pct = (rankCount - 0.5) / hist.count;

      // Welford causal standardization on transformed value (log for RVOL/RV/Amihud, raw otherwise)
      const x = id === 'rvol48' ? Math.log(v) : v;
      wCount += 1;
      const delta = x - wMean;
      wMean += delta / wCount;
      const delta2 = x - wMean;
      wM2 += delta * delta2;

      if (wCount >= MIN_CAUSAL_SAMPLES) {
        pctOut[i] = pct;

        const variance = wM2 / (wCount - 1);
        const std = Math.sqrt(variance);
        const z = std > 1e-12 ? Math.max(-6, Math.min(6, (x - wMean) / std)) : 0;
        zOut[i] = z;

        // Primary normalized feature vector for similarity distance:
        // - rv48 and amihud48: probit of strictly causal percentile (immune to extreme fat-tail skew)
        // - rvol48: causal z-score of log(RVOL)
        // - all others: causal z-score of raw value
        if (id === 'rv48' || id === 'amihud48') {
          normOut[i] = inverseNormalCdf(pct);
        } else {
          normOut[i] = z;
        }
      }
    }

    normalized[id] = normOut;
    causalPercentile[id] = pctOut;
    causalZScore[id] = zOut;
  }

  return {
    count,
    normalized,
    causalPercentile,
    causalZScore,
  };
}
