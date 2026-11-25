import type { PerformanceSummary, TradeRecord } from '../../types/strategyBacktest.ts';

export function formatProfitFactorDisplay(
  grossWinUsd: number,
  grossLossUsd: number,
  tradeCount: number,
): { profitFactor: number | null; profitFactorDisplay: string } {
  if (tradeCount === 0) {
    return { profitFactor: null, profitFactorDisplay: 'N/A (거래 없음)' };
  }
  if (grossLossUsd <= 1e-9) {
    if (grossWinUsd > 0) {
      return { profitFactor: null, profitFactorDisplay: '무손실 (∞)' };
    }
    return { profitFactor: 0, profitFactorDisplay: '0.00' };
  }
  const pf = grossWinUsd / grossLossUsd;
  return {
    profitFactor: Number.isFinite(pf) ? pf : null,
    profitFactorDisplay: Number.isFinite(pf) ? pf.toFixed(2) : 'N/A',
  };
}

export function computePerformanceSummary(params: {
  trades: TradeRecord[];
  initialCapitalUsd: number;
  finalEquityUsd: number;
  startTimestampMs: number;
  endTimestampMs: number;
  totalFeesPaidUsd: number;
  totalSlippagePaidUsd: number;
}): PerformanceSummary {
  const {
    trades,
    initialCapitalUsd,
    finalEquityUsd,
    startTimestampMs,
    endTimestampMs,
    totalFeesPaidUsd,
    totalSlippagePaidUsd,
  } = params;

  const netProfitUsd = finalEquityUsd - initialCapitalUsd;
  const totalReturnPct = initialCapitalUsd > 0 ? (netProfitUsd / initialCapitalUsd) * 100 : 0;

  const durationYears = Math.max(0, (endTimestampMs - startTimestampMs) / (365 * 24 * 3_600_000));
  let annualizedReturnPct: number | null = null;
  if (durationYears >= 0.02 && initialCapitalUsd > 0) {
    if (finalEquityUsd <= 0) {
      annualizedReturnPct = -100;
    } else {
      const cagr = (Math.pow(finalEquityUsd / initialCapitalUsd, 1 / durationYears) - 1) * 100;
      annualizedReturnPct = Number.isFinite(cagr) ? cagr : null;
    }
  }

  const n = trades.length;
  if (n === 0) {
    return {
      initialCapitalUsd,
      finalEquityUsd,
      netProfitUsd,
      totalReturnPct,
      annualizedReturnPct,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRatePct: null,
      avgTradeReturnPct: null,
      avgWinPct: null,
      avgLossPct: null,
      profitFactor: null,
      profitFactorDisplay: 'N/A (거래 없음)',
      expectancyUsd: null,
      expectancyPct: null,
      payoffRatio: null,
      totalFeesPaidUsd,
      totalSlippagePaidUsd,
    };
  }

  let winningTrades = 0;
  let losingTrades = 0;
  let grossWinUsd = 0;
  let grossLossUsd = 0;
  let sumWinRetPct = 0;
  let sumLossRetPct = 0;
  let sumRetPct = 0;
  let sumNetUsd = 0;

  for (const t of trades) {
    sumRetPct += t.netReturnOnMarginPct;
    sumNetUsd += t.netPnlUsd;
    if (t.netPnlUsd > 0) {
      winningTrades++;
      grossWinUsd += t.netPnlUsd;
      sumWinRetPct += t.netReturnOnMarginPct;
    } else if (t.netPnlUsd < 0) {
      losingTrades++;
      grossLossUsd += Math.abs(t.netPnlUsd);
      sumLossRetPct += t.netReturnOnMarginPct; // negative
    }
  }

  const winRatePct = (winningTrades / n) * 100;
  const avgTradeReturnPct = sumRetPct / n;
  const avgWinPct = winningTrades > 0 ? sumWinRetPct / winningTrades : null;
  const avgLossPct = losingTrades > 0 ? sumLossRetPct / losingTrades : null;
  const { profitFactor, profitFactorDisplay } = formatProfitFactorDisplay(
    grossWinUsd,
    grossLossUsd,
    n,
  );

  const expectancyUsd = sumNetUsd / n;
  const expectancyPct = avgTradeReturnPct;

  let payoffRatio: number | null = null;
  if (avgWinPct !== null && avgLossPct !== null && Math.abs(avgLossPct) > 1e-9) {
    payoffRatio = avgWinPct / Math.abs(avgLossPct);
  }

  return {
    initialCapitalUsd,
    finalEquityUsd,
    netProfitUsd,
    totalReturnPct,
    annualizedReturnPct,
    totalTrades: n,
    winningTrades,
    losingTrades,
    winRatePct,
    avgTradeReturnPct,
    avgWinPct,
    avgLossPct,
    profitFactor,
    profitFactorDisplay,
    expectancyUsd,
    expectancyPct,
    payoffRatio,
    totalFeesPaidUsd,
    totalSlippagePaidUsd,
  };
}
