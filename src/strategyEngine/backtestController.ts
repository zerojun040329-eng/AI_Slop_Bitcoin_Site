import type {
  StrategyBacktestResponse,
  StrategyBacktestRunRequest,
  TradeChartCandle,
  TradeDetailWindowResponse,
  TradeRecord,
} from '../types/strategyBacktest.ts';
import type { BacktestCandleSeries } from './strategies/types.ts';
import { getStrategyModule } from './strategies/registry.ts';
import { resolveAccountConfig } from './backtesting/costModel.ts';
import { runGenericBacktest } from './backtesting/engine.ts';
import { computePerformanceSummary } from './analytics/performance.ts';
import { computeRiskSummary } from './analytics/riskMetrics.ts';
import { computeStatisticalValidation } from './analytics/bootstrap.ts';
import { buildDirectionAndRegimeBreakdowns } from './analytics/marketRegime.ts';
import { verifyTradeAccountingReconciliation } from './analytics/validation.ts';

function findIndexByTime(openTimeMs: Float64Array, count: number, targetMs: number): number {
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (openTimeMs[mid] < targetMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function executeStrategyBacktest(
  series: BacktestCandleSeries,
  req: StrategyBacktestRunRequest = {},
): StrategyBacktestResponse {
  const t0 = Date.now();
  const strategy = getStrategyModule(req.strategyId ?? 'liquidity_fakeout');
  const account = resolveAccountConfig(req.account);

  const n = series.count;
  if (n < 100) {
    throw new Error('백테스팅을 실행하기에 5분봉 데이터가 부족합니다.');
  }

  let startIdx = 0;
  let endIdx = n - 1;

  if (req.startTimestampMs !== null && req.startTimestampMs !== undefined) {
    startIdx = Math.max(0, findIndexByTime(series.openTimeMs, n, req.startTimestampMs));
  }
  if (req.endTimestampMs !== null && req.endTimestampMs !== undefined) {
    endIdx = Math.min(n - 1, findIndexByTime(series.openTimeMs, n, req.endTimestampMs));
  }
  if (endIdx - startIdx < 100) {
    throw new Error('선택한 백테스트 기간이 너무 짧습니다 (최소 100봉 이상 필요).');
  }

  const exec = runGenericBacktest({
    series,
    strategy,
    rawStrategyParams: req.strategyParams,
    account,
    startIdx,
    endIdx,
  });

  const performance = computePerformanceSummary({
    trades: exec.trades,
    initialCapitalUsd: account.initialCapital,
    finalEquityUsd: exec.finalEquityUsd,
    startTimestampMs: exec.startTimestampMs,
    endTimestampMs: exec.endTimestampMs,
    totalFeesPaidUsd: exec.totalFeesPaidUsd,
    totalSlippagePaidUsd: exec.totalSlippagePaidUsd,
  });

  const risk = computeRiskSummary({
    trades: exec.trades,
    hourlyReturns: exec.hourlyReturns,
    maxDrawdownUsd: exec.maxDrawdownUsd,
    maxDrawdownPct: exec.maxDrawdownPct,
  });

  const validation = computeStatisticalValidation({
    trades: exec.trades,
    initialCapitalUsd: account.initialCapital,
    startTimestampMs: exec.startTimestampMs,
    endTimestampMs: exec.endTimestampMs,
  });

  const { directionBreakdown, regimeBreakdown } = buildDirectionAndRegimeBreakdowns(exec.trades);

  const recon = verifyTradeAccountingReconciliation({
    trades: exec.trades,
    initialCapitalUsd: account.initialCapital,
    finalEquityUsd: exec.finalEquityUsd,
  });

  // Cap returned trade list cleanly to keep payload crisp if > 2000 trades, preserving chronological order
  const maxReturnedTrades = 2000;
  const serializedTrades =
    exec.trades.length > maxReturnedTrades
      ? exec.trades.slice(-maxReturnedTrades)
      : exec.trades;

  return {
    strategy: strategy.metadata,
    resolvedParams: exec.resolvedParams,
    resolvedAccount: exec.resolvedAccount,
    dataSpan: {
      startTimestampMs: exec.startTimestampMs,
      endTimestampMs: exec.endTimestampMs,
      totalBarsEvaluated: exec.totalBarsEvaluated,
      pivotsDetectedCount: exec.pivotsDetectedCount,
      signalsGeneratedCount: exec.signalsGeneratedCount,
      signalsIgnoredWhileInPosition: exec.signalsIgnoredWhileInPosition,
    },
    performance,
    risk,
    validation,
    directionBreakdown,
    regimeBreakdown,
    equityCurve: exec.equityCurve,
    trades: serializedTrades,
    totalTradesRecorded: exec.trades.length,
    reconciliationOk: recon.ok,
    reconciliationDiffUsd: recon.diffUsd,
    computedInMs: Date.now() - t0,
  };
}

export function extractTradeCandleWindow(
  series: BacktestCandleSeries,
  trade: TradeRecord,
): TradeDetailWindowResponse {
  const n = series.count;
  const padBefore = 24; // 2h before pivot/entry
  const padAfter = 24; // 2h after exit
  const rawStart = Math.max(0, Math.min(trade.pivotIndex, trade.entryIndex) - padBefore);
  const rawEnd = Math.min(n - 1, trade.exitIndex + padAfter);

  const totalBars = rawEnd - rawStart + 1;
  // Keep candle window responsive (<= 320 bars); if trade held longer, sample cleanly while preserving exact entry/tp1/exit bars
  const step = totalBars > 320 ? Math.ceil(totalBars / 300) : 1;
  const candles: TradeChartCandle[] = [];

  for (let i = rawStart; i <= rawEnd; i += step) {
    const endI = Math.min(rawEnd, i + step - 1);
    let hi = -Infinity;
    let lo = Infinity;
    let vol = 0;
    for (let k = i; k <= endI; k++) {
      if (series.high[k] > hi) hi = series.high[k];
      if (series.low[k] < lo) lo = series.low[k];
      vol += series.volume[k];
    }
    candles.push({
      openTimeMs: series.openTimeMs[i],
      open: series.open[i],
      high: hi,
      low: lo,
      close: series.close[endI],
      volume: vol,
    });
  }

  return { trade, candles };
}
