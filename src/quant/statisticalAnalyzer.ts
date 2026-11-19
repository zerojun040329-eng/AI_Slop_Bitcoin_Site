import type { StatisticalSignificanceResult, StatisticalVerdict } from '../types/signalAnalysis.ts';

const MIN_RELIABLE_SAMPLES = 20;

export function quantileSorted(sorted: number[], q: number): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  if (n === 1) return sorted[0];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

export function computeMeanAndStd(values: number[]): { mean: number; variance: number; stdDev: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, variance: 0, stdDev: 0 };
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i];
  const mean = sum / n;
  if (n < 2) return { mean, variance: 0, stdDev: 0 };
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - mean;
    sq += d * d;
  }
  const variance = sq / (n - 1);
  return { mean, variance, stdDev: Math.sqrt(Math.max(0, variance)) };
}

function erfApprox(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t) *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normalTwoSidedPValue(zAbs: number): number {
  if (!Number.isFinite(zAbs) || zAbs < 0) return 1;
  const cdf = 0.5 * (1 + erfApprox(zAbs / Math.SQRT2));
  return Math.max(0, Math.min(1, 2 * (1 - cdf)));
}

function logGamma(z: number): number {
  const coef = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.1208650973866179e-2,
    -0.5395239384953e-5,
  ];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += coef[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(a, b, x)) / a;
  }
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

export function studentTTwoSidedPValue(tAbs: number, df: number): number {
  if (!Number.isFinite(tAbs) || df <= 0) return 1;
  if (df > 1000) return normalTwoSidedPValue(tAbs);
  const x = df / (df + tAbs * tAbs);
  return Math.max(0, Math.min(1, regularizedBeta(x, df * 0.5, 0.5)));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeAutocorrelationLag1(chronoValues: number[]): number {
  const n = chronoValues.length;
  if (n < 4) return 0;
  const { mean } = computeMeanAndStd(chronoValues);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const d = chronoValues[i] - mean;
    den += d * d;
    if (i > 0) {
      num += d * (chronoValues[i - 1] - mean);
    }
  }
  if (den <= 1e-12) return 0;
  return Math.max(-0.99, Math.min(0.99, num / den));
}

export function circularBlockBootstrapCi(
  chronoValues: number[],
  blockLen: number,
  seedHint: number,
  iterations = 1000,
): { low: number; high: number } {
  const n = chronoValues.length;
  if (n === 0) return { low: 0, high: 0 };
  if (n === 1) return { low: chronoValues[0], high: chronoValues[0] };

  const b = Math.max(1, Math.min(n, blockLen));
  const numBlocks = Math.ceil(n / b);
  const rng = mulberry32(seedHint);
  const bootMeans = new Array<number>(iterations);

  for (let iter = 0; iter < iterations; iter++) {
    let sum = 0;
    let count = 0;
    for (let blk = 0; blk < numBlocks; blk++) {
      const start = Math.floor(rng() * n);
      for (let off = 0; off < b && count < n; off++) {
        sum += chronoValues[(start + off) % n];
        count++;
      }
    }
    bootMeans[iter] = sum / n;
  }

  bootMeans.sort((a, bVal) => a - bVal);
  return {
    low: quantileSorted(bootMeans, 0.025) ?? bootMeans[0],
    high: quantileSorted(bootMeans, 0.975) ?? bootMeans[bootMeans.length - 1],
  };
}

export function hacNeweyWestTest(
  chronoValues: number[],
  nullMean: number,
): { tStat: number; pValue: number } | null {
  const n = chronoValues.length;
  if (n < 3) return null;
  const { mean, variance } = computeMeanAndStd(chronoValues);
  const resid = chronoValues.map((v) => v - mean);

  const maxLag = Math.min(n - 1, Math.max(1, Math.floor(4 * Math.pow(n / 100, 2 / 9))));
  let gamma0 = 0;
  for (let i = 0; i < n; i++) gamma0 += resid[i] * resid[i];
  gamma0 /= n;

  let lrv = gamma0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let gammaJ = 0;
    for (let t = lag; t < n; t++) {
      gammaJ += resid[t] * resid[t - lag];
    }
    gammaJ /= n;
    const weight = 1 - lag / (maxLag + 1);
    lrv += 2 * weight * gammaJ;
  }

  const standardVar = Math.max(1e-12, variance);
  const effectiveLrv = Math.max(standardVar * 0.25, lrv);
  const se = Math.sqrt(effectiveLrv / n);
  if (se <= 1e-12) return null;

  const tStat = (mean - nullMean) / se;
  const pValue = studentTTwoSidedPValue(Math.abs(tStat), n - 1);
  return { tStat, pValue };
}

export function welchTTest(
  sample: number[],
  baselineMean: number,
  baselineVariance: number,
  baselineCount: number,
): { tStat: number; pValue: number } | null {
  const n1 = sample.length;
  const n2 = baselineCount;
  if (n1 < 2 || n2 < 2) return null;

  const { mean: m1, variance: v1 } = computeMeanAndStd(sample);
  const se1 = v1 / n1;
  const se2 = baselineVariance / n2;
  const seSum = se1 + se2;
  if (seSum <= 1e-12) return null;

  const tStat = (m1 - baselineMean) / Math.sqrt(seSum);
  const numDf = seSum * seSum;
  const denDf = (se1 * se1) / (n1 - 1) + (se2 * se2) / (n2 - 1);
  const df = denDf > 0 ? Math.max(1, numDf / denDf) : n1 - 1;
  const pValue = studentTTwoSidedPValue(Math.abs(tStat), df);
  return { tStat, pValue };
}

export function mannWhitneyUTest(
  sample: number[],
  baselineSubsample: number[],
): { uStat: number; pValue: number } | null {
  const n1 = sample.length;
  const n2 = baselineSubsample.length;
  if (n1 < 3 || n2 < 5) return null;

  const combined: Array<{ val: number; isSample: boolean }> = [];
  for (let i = 0; i < n1; i++) combined.push({ val: sample[i], isSample: true });
  for (let i = 0; i < n2; i++) combined.push({ val: baselineSubsample[i], isSample: false });
  combined.sort((a, b) => a.val - b.val);

  const N = combined.length;
  let rankSum1 = 0;
  let tieCorrectionSum = 0;

  let i = 0;
  while (i < N) {
    let j = i + 1;
    while (j < N && combined[j].val === combined[i].val) j++;
    const tieCount = j - i;
    const avgRank = (i + 1 + j) * 0.5;
    for (let k = i; k < j; k++) {
      if (combined[k].isSample) rankSum1 += avgRank;
    }
    if (tieCount > 1) {
      tieCorrectionSum += tieCount * tieCount * tieCount - tieCount;
    }
    i = j;
  }

  const u1 = rankSum1 - (n1 * (n1 + 1)) * 0.5;
  const muU = (n1 * n2) * 0.5;
  const tieFactor = N > 1 ? tieCorrectionSum / (N * (N - 1)) : 0;
  const varU = ((n1 * n2) / 12) * Math.max(1e-9, N + 1 - tieFactor);
  if (varU <= 1e-12) return null;

  const zAbs = Math.abs(u1 - muU) / Math.sqrt(varU);
  return {
    uStat: u1,
    pValue: normalTwoSidedPValue(zAbs),
  };
}

export function applyBenjaminiHochbergFdr(pValues: Array<number | null>): Array<number | null> {
  const indexed = pValues
    .map((p, idx) => ({ p, idx }))
    .filter((item): item is { p: number; idx: number } => item.p !== null && Number.isFinite(item.p));

  const m = indexed.length;
  const out: Array<number | null> = new Array(pValues.length).fill(null);
  if (m === 0) return out;

  indexed.sort((a, b) => a.p - b.p);
  const adjusted = new Array<number>(m);
  let minSoFar = 1;
  for (let i = m - 1; i >= 0; i--) {
    const rank = i + 1;
    const rawAdj = (indexed[i].p * m) / rank;
    minSoFar = Math.min(minSoFar, rawAdj);
    adjusted[i] = Math.min(1, Math.max(0, minSoFar));
  }

  for (let i = 0; i < m; i++) {
    out[indexed[i].idx] = adjusted[i];
  }
  return out;
}

export function evaluateHorizonSignificance(params: {
  chronoReturns: number[];
  horizonBars: number;
  baselineMean: number;
  baselineVariance: number;
  baselineCount: number;
  baselineSubsample: number[];
}): Omit<StatisticalSignificanceResult, 'fdrAdjustedPValue' | 'isFdrSignificant' | 'verdict' | 'verdictLabel'> & {
  primaryPValue: number | null;
} {
  const {
    chronoReturns,
    horizonBars,
    baselineMean,
    baselineVariance,
    baselineCount,
    baselineSubsample,
  } = params;

  const n = chronoReturns.length;
  if (n < 3) {
    return {
      effectiveSampleSize: n,
      autocorrelationLag1: 0,
      bootstrapBlockLength: 1,
      bootstrapMeanCiLow: null,
      bootstrapMeanCiHigh: null,
      hacTStat: null,
      hacPValue: null,
      welchTStat: null,
      welchPValue: null,
      mannWhitneyU: null,
      mannWhitneyPValue: null,
      primaryPValue: null,
    };
  }

  const rho1 = computeAutocorrelationLag1(chronoReturns);
  const posRho = Math.max(0, Math.min(0.95, rho1));
  const ess = Math.max(1, Math.min(n, n / ((1 + posRho) / (1 - posRho))));
  const blockLen = Math.max(1, Math.min(n, Math.round((1 + 2 * posRho) * Math.pow(n, 1 / 3))));

  const boot = circularBlockBootstrapCi(
    chronoReturns,
    blockLen,
    n * 10007 + horizonBars * 97,
    1000,
  );
  const hac = hacNeweyWestTest(chronoReturns, baselineMean);
  const welch = welchTTest(chronoReturns, baselineMean, baselineVariance, baselineCount);
  const mwu = mannWhitneyUTest(chronoReturns, baselineSubsample);

  return {
    effectiveSampleSize: Math.round(ess * 10) / 10,
    autocorrelationLag1: rho1,
    bootstrapBlockLength: blockLen,
    bootstrapMeanCiLow: boot.low,
    bootstrapMeanCiHigh: boot.high,
    hacTStat: hac?.tStat ?? null,
    hacPValue: hac?.pValue ?? null,
    welchTStat: welch?.tStat ?? null,
    welchPValue: welch?.pValue ?? null,
    mannWhitneyU: mwu?.uStat ?? null,
    mannWhitneyPValue: mwu?.pValue ?? null,
    primaryPValue: hac?.pValue ?? welch?.pValue ?? null,
  };
}

export function resolveVerdict(
  n: number,
  ess: number,
  rawP: number | null,
  fdrP: number | null,
): { verdict: StatisticalVerdict; verdictLabel: string; isFdrSignificant: boolean } {
  if (n < MIN_RELIABLE_SAMPLES || ess < 15) {
    return {
      verdict: 'insufficient_sample',
      verdictLabel: `판단 유보 (표본 부족: n=${n}, ESS=${ess.toFixed(1)})`,
      isFdrSignificant: false,
    };
  }
  if (fdrP !== null && fdrP < 0.05) {
    return {
      verdict: 'significant_fdr',
      verdictLabel: '통계적 유의 (FDR < 0.05)',
      isFdrSignificant: true,
    };
  }
  if (rawP !== null && rawP < 0.05) {
    return {
      verdict: 'marginal_uncorrected',
      verdictLabel: '단일 시계열 유의 (FDR 보정 후 비유의)',
      isFdrSignificant: false,
    };
  }
  return {
    verdict: 'not_significant',
    verdictLabel: '통계적 유의성 없음',
    isFdrSignificant: false,
  };
}
