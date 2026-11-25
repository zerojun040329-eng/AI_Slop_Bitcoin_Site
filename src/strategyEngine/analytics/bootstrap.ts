import type {
  StatisticalValidationSummary,
  TradeRecord,
} from '../../types/strategyBacktest.ts';
import { formatProfitFactorDisplay } from './performance.ts';

const MIN_SUFFICIENT_TRADES = 30;

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

function summarizeTradeSubset(
  label: string,
  trades: TradeRecord[],
  startEquityUsd: number,
): {
  label: string;
  trades: number;
  winRatePct: number | null;
  expectancyPct: number | null;
  profitFactorDisplay: string;
  totalReturnPct: number;
} {
  const n = trades.length;
  if (n === 0) {
    return {
      label,
      trades: 0,
      winRatePct: null,
      expectancyPct: null,
      profitFactorDisplay: 'N/A',
      totalReturnPct: 0,
    };
  }

  let wins = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let sumRet = 0;
  let sumPnl = 0;

  for (const t of trades) {
    sumRet += t.netReturnOnMarginPct;
    sumPnl += t.netPnlUsd;
    if (t.netPnlUsd > 0) {
      wins++;
      grossWin += t.netPnlUsd;
    } else if (t.netPnlUsd < 0) {
      grossLoss += Math.abs(t.netPnlUsd);
    }
  }

  const { profitFactorDisplay } = formatProfitFactorDisplay(grossWin, grossLoss, n);
  return {
    label,
    trades: n,
    winRatePct: (wins / n) * 100,
    expectancyPct: sumRet / n,
    profitFactorDisplay,
    totalReturnPct: startEquityUsd > 0 ? (sumPnl / startEquityUsd) * 100 : 0,
  };
}

export function computeStatisticalValidation(params: {
  trades: TradeRecord[];
  initialCapitalUsd: number;
  startTimestampMs: number;
  endTimestampMs: number;
}): StatisticalValidationSummary {
  const { trades, initialCapitalUsd, startTimestampMs, endTimestampMs } = params;
  const n = trades.length;
  const returns = trades.map((t) => t.netReturnOnMarginPct);

  let expectancyMeanPct: number | null = null;
  let parametricCi95LowPct: number | null = null;
  let parametricCi95HighPct: number | null = null;
  let blockBootstrapCi95LowPct: number | null = null;
  let blockBootstrapCi95HighPct: number | null = null;
  const bootstrapBlockLength = Math.max(1, Math.min(Math.max(1, n), Math.round(Math.pow(Math.max(1, n), 1 / 3))));

  if (n >= 2) {
    let sum = 0;
    for (const r of returns) sum += r;
    const mean = sum / n;
    let sq = 0;
    for (const r of returns) {
      const d = r - mean;
      sq += d * d;
    }
    const std = Math.sqrt(sq / (n - 1));
    const se = std / Math.sqrt(n);
    // Approximate t critical value (1.96 for large n, slightly wider for small n)
    const tCrit = n >= 30 ? 1.96 : n >= 15 ? 2.13 : 2.35;

    expectancyMeanPct = mean;
    parametricCi95LowPct = mean - tCrit * se;
    parametricCi95HighPct = mean + tCrit * se;

    // Circular Block Bootstrap (1000 iterations, deterministic seed)
    const iters = 1000;
    const numBlocks = Math.ceil(n / bootstrapBlockLength);
    const rng = mulberry32(n * 7919 + Math.round(initialCapitalUsd));
    const bootMeans = new Array<number>(iters);

    for (let it = 0; it < iters; it++) {
      let s = 0;
      let cnt = 0;
      for (let blk = 0; blk < numBlocks; blk++) {
        const start = Math.floor(rng() * n);
        for (let off = 0; off < bootstrapBlockLength && cnt < n; off++) {
          s += returns[(start + off) % n];
          cnt++;
        }
      }
      bootMeans[it] = s / n;
    }

    bootMeans.sort((a, b) => a - b);
    blockBootstrapCi95LowPct = bootMeans[Math.floor(0.025 * (iters - 1))];
    blockBootstrapCi95HighPct = bootMeans[Math.floor(0.975 * (iters - 1))];
  } else if (n === 1) {
    expectancyMeanPct = returns[0];
  }

  const isSampleSufficient = n >= MIN_SUFFICIENT_TRADES;
  const reliabilityLabel =
    n === 0
      ? '거래 없음 (통계 산출 불가)'
      : !isSampleSufficient
        ? `표본 부족 (n=${n} < 30 · 통계적 신뢰도 낮음)`
        : blockBootstrapCi95LowPct !== null && blockBootstrapCi95LowPct > 0
          ? `양의 기대수익 95% 신뢰 확인 (n=${n})`
          : `충분한 표본 확보 (n=${n} · 기대수익 0 포함 여부 확인)`;

  // In-sample (first 60% time span) vs Out-of-sample (recent 40% time span)
  const splitMs = startTimestampMs + (endTimestampMs - startTimestampMs) * 0.6;
  const inSampleTrades = trades.filter((t) => t.entryTimeMs < splitMs);
  const outSampleTrades = trades.filter((t) => t.entryTimeMs >= splitMs);
  const inEndEquity =
    inSampleTrades.length > 0
      ? inSampleTrades[inSampleTrades.length - 1].equityAfterUsd
      : initialCapitalUsd;

  const splitDateStr = new Date(splitMs).toISOString().slice(0, 10);
  const inSample = summarizeTradeSubset(`학습 구간 (~${splitDateStr})`, inSampleTrades, initialCapitalUsd);
  const outOfSample = summarizeTradeSubset(`검증 구간 (${splitDateStr}~)`, outSampleTrades, inEndEquity);

  // Yearly breakdown
  const yearMap = new Map<string, TradeRecord[]>();
  const monthMap = new Map<string, { year: number; month: number; trades: number; netPnlUsd: number; startEquity: number }>();

  let runningEquityBefore = initialCapitalUsd;
  for (const t of trades) {
    const dt = new Date(t.exitTimeMs);
    const yr = String(dt.getUTCFullYear());
    const yList = yearMap.get(yr);
    if (yList) yList.push(t);
    else yearMap.set(yr, [t]);

    const mo = dt.getUTCMonth() + 1;
    const mKey = `${yr}-${mo}`;
    const existingM = monthMap.get(mKey);
    if (existingM) {
      existingM.trades++;
      existingM.netPnlUsd += t.netPnlUsd;
    } else {
      monthMap.set(mKey, {
        year: dt.getUTCFullYear(),
        month: mo,
        trades: 1,
        netPnlUsd: t.netPnlUsd,
        startEquity: Math.max(10, runningEquityBefore),
      });
    }
    runningEquityBefore = t.equityAfterUsd;
  }

  let prevYearEquity = initialCapitalUsd;
  const yearlyBreakdown = Array.from(yearMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([year, yTrades]) => {
      const sumPnl = yTrades.reduce((acc, item) => acc + item.netPnlUsd, 0);
      const baseEq = Math.max(10, prevYearEquity);
      prevYearEquity = yTrades[yTrades.length - 1]?.equityAfterUsd ?? prevYearEquity;
      const summary = summarizeTradeSubset(year, yTrades, baseEq);
      return {
        year,
        trades: yTrades.length,
        winRatePct: summary.winRatePct,
        netPnlUsd: sumPnl,
        returnPct: (sumPnl / baseEq) * 100,
        profitFactorDisplay: summary.profitFactorDisplay,
      };
    });

  const monthlyReturns = Array.from(monthMap.values())
    .sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month))
    .map((m) => ({
      year: m.year,
      month: m.month,
      trades: m.trades,
      netPnlUsd: m.netPnlUsd,
      returnPct: (m.netPnlUsd / m.startEquity) * 100,
    }));

  return {
    sampleCount: n,
    isSampleSufficient,
    reliabilityLabel,
    expectancyMeanPct,
    parametricCi95LowPct,
    parametricCi95HighPct,
    blockBootstrapCi95LowPct,
    blockBootstrapCi95HighPct,
    bootstrapBlockLength,
    inSample,
    outOfSample,
    yearlyBreakdown,
    monthlyReturns,
  };
}
