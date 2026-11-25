import type {
  BacktestAccountConfig,
  EquityPoint,
  TradeRecord,
} from '../../types/strategyBacktest.ts';
import type {
  BacktestCandleSeries,
  TradingStrategyModule,
} from '../strategies/types.ts';
import { computeCausalRegimeArrays } from '../analytics/marketRegime.ts';
import { BacktestPortfolio } from './portfolio.ts';
import {
  computeUnrealizedPnlUsd,
  openPositionFromSignal,
  processOpenTradeOnBar,
  type OpenTradeTracker,
} from './tradeSimulator.ts';

export interface BacktestExecutionResult<TParams> {
  resolvedParams: TParams;
  resolvedAccount: BacktestAccountConfig;
  startTimestampMs: number;
  endTimestampMs: number;
  totalBarsEvaluated: number;
  pivotsDetectedCount: number;
  signalsGeneratedCount: number;
  signalsIgnoredWhileInPosition: number;
  trades: TradeRecord[];
  equityCurve: EquityPoint[];
  hourlyReturns: number[];
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  finalEquityUsd: number;
  totalFeesPaidUsd: number;
  totalSlippagePaidUsd: number;
}

/**
 * Strategy-agnostic sequential backtesting engine.
 * Enforces single concurrent position (ignores signals while a trade is open),
 * executes entry signals at `executeIndex = signalIndex + 1` open price,
 * and delegates exit evaluation strictly to `strategy.evaluateBarExit`.
 */
export function runGenericBacktest<TParams>(params: {
  series: BacktestCandleSeries;
  strategy: TradingStrategyModule<TParams>;
  rawStrategyParams?: Partial<TParams>;
  account: BacktestAccountConfig;
  startIdx?: number;
  endIdx?: number;
}): BacktestExecutionResult<TParams> {
  const { series, strategy, rawStrategyParams, account } = params;
  const n = series.count;
  const startIdx = Math.max(0, params.startIdx ?? 0);
  const endIdx = Math.min(n - 1, params.endIdx ?? n - 1);

  const resolvedParams = strategy.resolveParams(rawStrategyParams);

  if (n < 50 || endIdx - startIdx < 50) {
    return {
      resolvedParams,
      resolvedAccount: account,
      startTimestampMs: n > 0 ? series.openTimeMs[startIdx] : 0,
      endTimestampMs: n > 0 ? series.openTimeMs[endIdx] : 0,
      totalBarsEvaluated: Math.max(0, endIdx - startIdx + 1),
      pivotsDetectedCount: 0,
      signalsGeneratedCount: 0,
      signalsIgnoredWhileInPosition: 0,
      trades: [],
      equityCurve: [],
      hourlyReturns: [],
      maxDrawdownUsd: 0,
      maxDrawdownPct: 0,
      finalEquityUsd: account.initialCapital,
      totalFeesPaidUsd: 0,
      totalSlippagePaidUsd: 0,
    };
  }

  const prepared = strategy.prepare(series, resolvedParams, startIdx, endIdx);
  const regimes = computeCausalRegimeArrays(series);
  const portfolio = new BacktestPortfolio(account);
  const trades: TradeRecord[] = [];

  const totalEvalBars = endIdx - startIdx + 1;
  const sampleStepBars = Math.max(1, Math.floor(totalEvalBars / 500));

  let activeTrade: OpenTradeTracker | null = null;
  let signalsIgnoredWhileInPosition = 0;
  let nextTradeId = 1;

  for (let i = startIdx; i <= endIdx; i++) {
    // 1. Check pending entry signal scheduled for bar `i` open
    const pendingSignal = prepared.signalsByExecuteIndex.get(i);
    if (pendingSignal) {
      if (activeTrade !== null) {
        signalsIgnoredWhileInPosition++;
      } else {
        activeTrade = openPositionFromSignal({
          tradeId: nextTradeId,
          strategy,
          strategyParams: resolvedParams,
          series,
          signal: pendingSignal,
          account,
          portfolio,
          regimes,
        });
        if (activeTrade) nextTradeId++;
      }
    }

    // 2. Evaluate open position exit on bar `i`
    if (activeTrade !== null) {
      const closedTrade = processOpenTradeOnBar({
        tracker: activeTrade,
        strategy,
        series,
        barIndex: i,
        account,
        portfolio,
        forceCloseAtEnd: i === endIdx,
      });
      if (closedTrade) {
        trades.push(closedTrade);
        activeTrade = null;
      }
    }

    // 3. Record bar-level equity & MDD
    const unrealized = activeTrade ? computeUnrealizedPnlUsd(activeTrade, series.close[i]) : 0;
    portfolio.recordBarMarkToMarket(
      i,
      series.openTimeMs[i],
      series.close[i],
      unrealized,
      sampleStepBars,
      i === startIdx || i === endIdx,
    );
  }

  return {
    resolvedParams,
    resolvedAccount: account,
    startTimestampMs: series.openTimeMs[startIdx],
    endTimestampMs: series.openTimeMs[endIdx],
    totalBarsEvaluated: totalEvalBars,
    pivotsDetectedCount: prepared.pivotsDetectedCount,
    signalsGeneratedCount: prepared.totalSignalsGenerated,
    signalsIgnoredWhileInPosition,
    trades,
    equityCurve: portfolio.equityCurve,
    hourlyReturns: portfolio.hourlyReturns,
    maxDrawdownUsd: portfolio.maxDrawdownUsd,
    maxDrawdownPct: portfolio.maxDrawdownPct,
    finalEquityUsd: portfolio.cashEquity,
    totalFeesPaidUsd: portfolio.totalFeesPaidUsd,
    totalSlippagePaidUsd: portfolio.totalSlippagePaidUsd,
  };
}
