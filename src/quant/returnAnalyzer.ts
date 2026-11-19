import {
  HORIZON_CONFIG,
  type HorizonKey,
  type HorizonReturnStats,
} from '../types/signalAnalysis.ts';
import {
  applyBenjaminiHochbergFdr,
  computeMeanAndStd,
  evaluateHorizonSignificance,
  quantileSorted,
  resolveVerdict,
} from './statisticalAnalyzer.ts';

const BAR_MS = 300_000;

export interface BaselineHorizonStats {
  horizon: HorizonKey;
  barsAhead: number;
  count: number;
  meanPct: number;
  variancePct: number;
  winRatePct: number;
  subsample: number[];
}

export function computeForwardReturnPct(
  close: Float64Array,
  openTimeMs: Float64Array,
  totalCount: number,
  index: number,
  barsAhead: number,
): number | null {
  const futureIdx = index + barsAhead;
  if (index < 0 || futureIdx >= totalCount) return null;
  const c0 = close[index];
  const c1 = close[futureIdx];
  if (c0 <= 0 || !Number.isFinite(c0) || !Number.isFinite(c1)) return null;
  if (Math.abs(openTimeMs[futureIdx] - openTimeMs[index] - barsAhead * BAR_MS) > 1000) {
    return null;
  }
  return (c1 / c0 - 1) * 100;
}

export function computeUnconditionalBaselines(
  close: Float64Array,
  openTimeMs: Float64Array,
  totalCount: number,
  maxIndexExclusive: number,
): Record<HorizonKey, BaselineHorizonStats> {
  const result = {} as Record<HorizonKey, BaselineHorizonStats>;
  const limit = Math.min(totalCount, maxIndexExclusive);

  for (const cfg of HORIZON_CONFIG) {
    const barsAhead = cfg.bars;
    let count = 0;
    let wins = 0;
    let mean = 0;
    let m2 = 0;
    const subsample: number[] = [];
    // Evenly spaced non-overlapping subsample (~2,500 points max) for Mann-Whitney baseline
    const minStep = Math.max(barsAhead, Math.floor(limit / 2500));

    for (let i = 48; i < limit; i++) {
      const ret = computeForwardReturnPct(close, openTimeMs, totalCount, i, barsAhead);
      if (ret === null) continue;
      count++;
      if (ret > 0) wins++;
      const d = ret - mean;
      mean += d / count;
      m2 += d * (ret - mean);

      if (i % minStep === 0) {
        subsample.push(ret);
      }
    }

    result[cfg.key] = {
      horizon: cfg.key,
      barsAhead,
      count,
      meanPct: count > 0 ? mean : 0,
      variancePct: count > 1 ? m2 / (count - 1) : 0,
      winRatePct: count > 0 ? (wins / count) * 100 : 0,
      subsample,
    };
  }

  return result;
}

function buildHistogramBins(
  values: number[],
  p05: number | null,
  p95: number | null,
): Array<{ from: number; to: number; count: number }> {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const lo = p05 !== null ? Math.min(p05 * 1.4, sorted[0]) : sorted[0];
  const hi = p95 !== null ? Math.max(p95 * 1.4, sorted[sorted.length - 1]) : sorted[sorted.length - 1];
  const maxAbs = Math.max(Math.abs(lo), Math.abs(hi), 0.25);
  const binCount = 12;
  const step = (2 * maxAbs) / binCount;
  const start = -maxAbs;

  const bins = Array.from({ length: binCount }, (_, b) => ({
    from: start + b * step,
    to: start + (b + 1) * step,
    count: 0,
  }));

  for (const v of values) {
    const rawIdx = Math.floor((v - start) / step);
    const idx = Math.max(0, Math.min(binCount - 1, rawIdx));
    bins[idx].count += 1;
  }
  return bins;
}

export function analyzeHorizonReturns(params: {
  matchIndices: number[];
  close: Float64Array;
  openTimeMs: Float64Array;
  totalCount: number;
  baselines: Record<HorizonKey, BaselineHorizonStats>;
}): HorizonReturnStats[] {
  const { matchIndices, close, openTimeMs, totalCount, baselines } = params;

  // Sort chronologically for autocorrelation / block bootstrap / Newey-West
  const chronoIndices = [...matchIndices].sort((a, b) => openTimeMs[a] - openTimeMs[b]);

  const prelim = HORIZON_CONFIG.map((cfg) => {
    const base = baselines[cfg.key];
    const chronoReturns: number[] = [];
    let excludedBoundaryCount = 0;

    for (const idx of chronoIndices) {
      const r = computeForwardReturnPct(close, openTimeMs, totalCount, idx, cfg.bars);
      if (r === null) {
        excludedBoundaryCount++;
      } else {
        chronoReturns.push(r);
      }
    }

    const n = chronoReturns.length;
    if (n === 0) {
      return {
        cfg,
        base,
        n: 0,
        excludedBoundaryCount,
        chronoReturns,
        sigRaw: evaluateHorizonSignificance({
          chronoReturns: [],
          horizonBars: cfg.bars,
          baselineMean: base.meanPct,
          baselineVariance: base.variancePct,
          baselineCount: base.count,
          baselineSubsample: base.subsample,
        }),
        stats: null,
      };
    }

    const sorted = [...chronoReturns].sort((a, b) => a - b);
    const { mean, stdDev } = computeMeanAndStd(chronoReturns);
    let wins = 0;
    for (const r of chronoReturns) {
      if (r > 0) wins++;
    }
    const winRatePct = (wins / n) * 100;
    const p05Pct = quantileSorted(sorted, 0.05);
    const p25Pct = quantileSorted(sorted, 0.25);
    const medianReturnPct = quantileSorted(sorted, 0.5);
    const p75Pct = quantileSorted(sorted, 0.75);
    const p95Pct = quantileSorted(sorted, 0.95);
    const se = n > 1 ? stdDev / Math.sqrt(n) : 0;

    const sigRaw = evaluateHorizonSignificance({
      chronoReturns,
      horizonBars: cfg.bars,
      baselineMean: base.meanPct,
      baselineVariance: base.variancePct,
      baselineCount: base.count,
      baselineSubsample: base.subsample,
    });

    const ci95LowPct = sigRaw.bootstrapMeanCiLow ?? mean - 1.96 * se;
    const ci95HighPct = sigRaw.bootstrapMeanCiHigh ?? mean + 1.96 * se;

    return {
      cfg,
      base,
      n,
      excludedBoundaryCount,
      chronoReturns,
      sigRaw,
      stats: {
        meanReturnPct: mean,
        medianReturnPct,
        winRatePct,
        stdDevPct: stdDev,
        minReturnPct: sorted[0],
        maxReturnPct: sorted[sorted.length - 1],
        p05Pct,
        p25Pct,
        p75Pct,
        p95Pct,
        ci95LowPct,
        ci95HighPct,
        excessReturnPct: mean - base.meanPct,
        histogramBins: buildHistogramBins(chronoReturns, p05Pct, p95Pct),
      },
    };
  });

  // Apply Benjamini-Hochberg FDR across all 6 horizons simultaneously
  const rawPValues = prelim.map((p) => p.sigRaw.primaryPValue);
  const fdrPValues = applyBenjaminiHochbergFdr(rawPValues);

  return prelim.map((p, idx) => {
    const fdrP = fdrPValues[idx];
    const verdictInfo = resolveVerdict(
      p.n,
      p.sigRaw.effectiveSampleSize,
      p.sigRaw.primaryPValue,
      fdrP,
    );

    return {
      horizon: p.cfg.key,
      barsAhead: p.cfg.bars,
      koreanLabel: p.cfg.koreanLabel,
      sampleCount: p.n,
      excludedBoundaryCount: p.excludedBoundaryCount,
      meanReturnPct: p.stats?.meanReturnPct ?? null,
      medianReturnPct: p.stats?.medianReturnPct ?? null,
      winRatePct: p.stats?.winRatePct ?? null,
      stdDevPct: p.stats?.stdDevPct ?? null,
      minReturnPct: p.stats?.minReturnPct ?? null,
      maxReturnPct: p.stats?.maxReturnPct ?? null,
      p05Pct: p.stats?.p05Pct ?? null,
      p25Pct: p.stats?.p25Pct ?? null,
      p75Pct: p.stats?.p75Pct ?? null,
      p95Pct: p.stats?.p95Pct ?? null,
      ci95LowPct: p.stats?.ci95LowPct ?? null,
      ci95HighPct: p.stats?.ci95HighPct ?? null,
      baselineMeanPct: p.base.count > 0 ? p.base.meanPct : null,
      baselineWinRatePct: p.base.count > 0 ? p.base.winRatePct : null,
      baselineSampleCount: p.base.count,
      excessReturnPct: p.stats?.excessReturnPct ?? null,
      histogramBins: p.stats?.histogramBins ?? [],
      significance: {
        effectiveSampleSize: p.sigRaw.effectiveSampleSize,
        autocorrelationLag1: p.sigRaw.autocorrelationLag1,
        bootstrapBlockLength: p.sigRaw.bootstrapBlockLength,
        bootstrapMeanCiLow: p.sigRaw.bootstrapMeanCiLow,
        bootstrapMeanCiHigh: p.sigRaw.bootstrapMeanCiHigh,
        hacTStat: p.sigRaw.hacTStat,
        hacPValue: p.sigRaw.hacPValue,
        welchTStat: p.sigRaw.welchTStat,
        welchPValue: p.sigRaw.welchPValue,
        mannWhitneyU: p.sigRaw.mannWhitneyU,
        mannWhitneyPValue: p.sigRaw.mannWhitneyPValue,
        fdrAdjustedPValue: fdrP,
        isFdrSignificant: verdictInfo.isFdrSignificant,
        verdict: verdictInfo.verdict,
        verdictLabel: verdictInfo.verdictLabel,
      },
    };
  });
}

export function summarizeSingleHorizonQuick(params: {
  matchIndices: number[];
  close: Float64Array;
  openTimeMs: Float64Array;
  totalCount: number;
  barsAhead: number;
}): {
  sampleCount: number;
  meanReturnPct: number | null;
  winRatePct: number | null;
} {
  const { matchIndices, close, openTimeMs, totalCount, barsAhead } = params;
  const rets: number[] = [];
  let wins = 0;
  for (const idx of matchIndices) {
    const r = computeForwardReturnPct(close, openTimeMs, totalCount, idx, barsAhead);
    if (r !== null) {
      rets.push(r);
      if (r > 0) wins++;
    }
  }
  if (rets.length === 0) {
    return { sampleCount: 0, meanReturnPct: null, winRatePct: null };
  }
  const { mean } = computeMeanAndStd(rets);
  return {
    sampleCount: rets.length,
    meanReturnPct: mean,
    winRatePct: (wins / rets.length) * 100,
  };
}
