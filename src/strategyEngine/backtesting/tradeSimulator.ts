import type {
  BacktestAccountConfig,
  ExitReason,
  StrategyId,
  TradeExecutionLeg,
  TradeRecord,
} from '../../types/strategyBacktest.ts';
import type {
  ActivePositionState,
  BacktestCandleSeries,
  StrategySignal,
  TradingStrategyModule,
} from '../strategies/types.ts';
import {
  applyExecutionSlippage,
  computeFeeUsd,
  computeSlippageCostUsd,
} from './costModel.ts';
import { BacktestPortfolio } from './portfolio.ts';
import type { CausalRegimeArrays } from '../analytics/marketRegime.ts';
import { getEntryRegimeTags } from '../analytics/marketRegime.ts';

export interface OpenTradeTracker {
  tradeId: number;
  strategyId: StrategyId;
  signal: StrategySignal;
  position: ActivePositionState;
  entryTimeMs: number;
  allocatedMarginUsd: number;
  notionalUsd: number;
  initialBaseQty: number;
  remainingBaseQty: number;
  entryFeeUsd: number;
  entrySlippageUsd: number;
  grossRealizedPnlUsd: number;
  totalFeeUsd: number;
  totalSlippageUsd: number;
  tp1TimeMs: number | null;
  tp1FillPrice: number | null;
  weightedExitNum: number;
  weightedExitDen: number;
  regimesAtEntry: TradeRecord['regimesAtEntry'];
  legs: TradeExecutionLeg[];
}

export function openPositionFromSignal<TParams>(params: {
  tradeId: number;
  strategy: TradingStrategyModule<TParams>;
  strategyParams: TParams;
  series: BacktestCandleSeries;
  signal: StrategySignal;
  account: BacktestAccountConfig;
  portfolio: BacktestPortfolio;
  regimes: CausalRegimeArrays;
}): OpenTradeTracker | null {
  const {
    tradeId,
    strategy,
    strategyParams,
    series,
    signal,
    account,
    portfolio,
    regimes,
  } = params;

  if (portfolio.cashEquity <= 10) return null;

  const idx = signal.executeIndex;
  const rawEntryPrice = series.open[idx];
  if (!Number.isFinite(rawEntryPrice) || rawEntryPrice <= 0) return null;

  const entryPrice = applyExecutionSlippage(
    rawEntryPrice,
    signal.direction,
    'ENTRY',
    account.slippagePct,
  );
  const allocatedMarginUsd = portfolio.cashEquity * (account.positionSizePct / 100);
  const notionalUsd = allocatedMarginUsd * account.leverage;
  const baseQty = notionalUsd / entryPrice;
  const entryFeeUsd = computeFeeUsd(notionalUsd, account.feeRatePct);
  const entrySlippageUsd = computeSlippageCostUsd(rawEntryPrice, entryPrice, baseQty);

  // Deduct entry fee immediately from cashEquity for strict bar-by-bar accounting
  portfolio.cashEquity -= entryFeeUsd;
  portfolio.totalFeesPaidUsd += entryFeeUsd;
  portfolio.totalSlippagePaidUsd += entrySlippageUsd;

  const position = strategy.buildPositionPlan(entryPrice, idx, signal, strategyParams);

  const entryTimeMs = series.openTimeMs[idx];
  const entryLeg: TradeExecutionLeg = {
    timestampMs: entryTimeMs,
    barIndex: idx,
    type: 'ENTRY',
    price: entryPrice,
    qtyRatio: 1.0,
    feeUsd: entryFeeUsd,
    slippageCostUsd: entrySlippageUsd,
    realizedPnlUsd: -entryFeeUsd,
  };

  return {
    tradeId,
    strategyId: strategy.metadata.id,
    signal,
    position,
    entryTimeMs,
    allocatedMarginUsd,
    notionalUsd,
    initialBaseQty: baseQty,
    remainingBaseQty: baseQty,
    entryFeeUsd,
    entrySlippageUsd,
    grossRealizedPnlUsd: 0,
    totalFeeUsd: entryFeeUsd,
    totalSlippageUsd: entrySlippageUsd,
    tp1TimeMs: null,
    tp1FillPrice: null,
    weightedExitNum: 0,
    weightedExitDen: 0,
    regimesAtEntry: getEntryRegimeTags(regimes, idx),
    legs: [entryLeg],
  };
}

export function computeUnrealizedPnlUsd(
  tracker: OpenTradeTracker,
  markPrice: number,
): number {
  const dirSign = tracker.position.direction === 'LONG' ? 1 : -1;
  return dirSign * (markPrice - tracker.position.entryPrice) * tracker.remainingBaseQty;
}

export function processOpenTradeOnBar<TParams>(params: {
  tracker: OpenTradeTracker;
  strategy: TradingStrategyModule<TParams>;
  series: BacktestCandleSeries;
  barIndex: number;
  account: BacktestAccountConfig;
  portfolio: BacktestPortfolio;
  forceCloseAtEnd: boolean;
}): TradeRecord | null {
  const { tracker, strategy, series, barIndex, account, portfolio, forceCloseAtEnd } = params;
  const dirSign = tracker.position.direction === 'LONG' ? 1 : -1;
  const barTimeMs = series.openTimeMs[barIndex];

  let action = strategy.evaluateBarExit(series, barIndex, tracker.position);

  // If still open on the very last bar of dataset, force close cleanly at close price
  if (!action.finalExitPrice && forceCloseAtEnd) {
    action = {
      ...action,
      finalExitPrice: series.close[barIndex],
      finalQtyRatio: tracker.position.remainingRatio,
      exitReason: 'END_OF_DATA',
      exitReasonLabel: '데이터 기간 종료 청산',
    };
  }

  // Handle TP1 partial exit if it triggered on this bar
  if (action.tp1FilledPrice !== undefined && action.tp1QtyRatio !== undefined) {
    const rawTp1 = action.tp1FilledPrice;
    const filledTp1 = applyExecutionSlippage(
      rawTp1,
      tracker.position.direction,
      'EXIT',
      account.slippagePct,
    );
    const qtyExited = tracker.initialBaseQty * action.tp1QtyRatio;
    const grossPnl = dirSign * (filledTp1 - tracker.position.entryPrice) * qtyExited;
    const exitNotional = filledTp1 * qtyExited;
    const fee = computeFeeUsd(exitNotional, account.feeRatePct);
    const slip = computeSlippageCostUsd(rawTp1, filledTp1, qtyExited);

    portfolio.cashEquity += grossPnl - fee;
    portfolio.totalFeesPaidUsd += fee;
    portfolio.totalSlippagePaidUsd += slip;

    tracker.remainingBaseQty = Math.max(0, tracker.remainingBaseQty - qtyExited);
    tracker.grossRealizedPnlUsd += grossPnl;
    tracker.totalFeeUsd += fee;
    tracker.totalSlippageUsd += slip;
    tracker.tp1TimeMs = barTimeMs;
    tracker.tp1FillPrice = filledTp1;
    tracker.weightedExitNum += filledTp1 * qtyExited;
    tracker.weightedExitDen += qtyExited;

    tracker.legs.push({
      timestampMs: barTimeMs,
      barIndex,
      type: 'TP1_PARTIAL',
      price: filledTp1,
      qtyRatio: action.tp1QtyRatio,
      feeUsd: fee,
      slippageCostUsd: slip,
      realizedPnlUsd: grossPnl - fee,
    });
  }

  // Handle final exit if triggered on this bar
  if (action.finalExitPrice !== undefined && action.exitReason !== undefined) {
    const rawFinal = action.finalExitPrice;
    const filledFinal = applyExecutionSlippage(
      rawFinal,
      tracker.position.direction,
      'EXIT',
      account.slippagePct,
    );
    const qtyExited = tracker.remainingBaseQty;
    const grossPnl = dirSign * (filledFinal - tracker.position.entryPrice) * qtyExited;
    const exitNotional = filledFinal * qtyExited;
    const fee = computeFeeUsd(exitNotional, account.feeRatePct);
    const slip = computeSlippageCostUsd(rawFinal, filledFinal, qtyExited);

    portfolio.cashEquity += grossPnl - fee;
    portfolio.totalFeesPaidUsd += fee;
    portfolio.totalSlippagePaidUsd += slip;

    tracker.remainingBaseQty = 0;
    tracker.grossRealizedPnlUsd += grossPnl;
    tracker.totalFeeUsd += fee;
    tracker.totalSlippageUsd += slip;
    tracker.weightedExitNum += filledFinal * qtyExited;
    tracker.weightedExitDen += qtyExited;

    tracker.legs.push({
      timestampMs: barTimeMs,
      barIndex,
      type: 'EXIT_FINAL',
      price: filledFinal,
      qtyRatio: action.finalQtyRatio ?? tracker.position.remainingRatio,
      feeUsd: fee,
      slippageCostUsd: slip,
      realizedPnlUsd: grossPnl - fee,
    });

    const netPnlUsd = tracker.grossRealizedPnlUsd - tracker.totalFeeUsd;
    const avgExitPrice =
      tracker.weightedExitDen > 0 ? tracker.weightedExitNum / tracker.weightedExitDen : filledFinal;

    return {
      tradeId: tracker.tradeId,
      strategyId: tracker.strategyId,
      direction: tracker.position.direction,
      pivotIndex: tracker.signal.pivotIndex,
      pivotConfirmedIndex: tracker.signal.pivotConfirmedIndex,
      pivotPrice: tracker.signal.pivotPrice,
      signalIndex: tracker.signal.signalIndex,
      signalTimeMs: series.openTimeMs[tracker.signal.signalIndex],
      entryIndex: tracker.position.entryIndex,
      entryTimeMs: tracker.entryTimeMs,
      entryPrice: tracker.position.entryPrice,
      entryAtr: tracker.position.entryAtr,
      initialStopPrice: tracker.position.initialStopPrice,
      tp1Price: tracker.position.tp1Price,
      tp2Price: tracker.position.tp2Price,
      tp1Hit: tracker.position.tp1Hit,
      tp1TimeMs: tracker.tp1TimeMs,
      tp1FillPrice: tracker.tp1FillPrice,
      tp2Hit: action.exitReason === ('TP2_FULL_TARGET' satisfies ExitReason),
      exitIndex: barIndex,
      exitTimeMs: barTimeMs,
      exitPrice: avgExitPrice,
      finalExitPrice: filledFinal,
      exitReason: action.exitReason,
      exitReasonLabel: action.exitReasonLabel ?? action.exitReason,
      notionalUsd: tracker.notionalUsd,
      grossPnlUsd: tracker.grossRealizedPnlUsd,
      totalFeeUsd: tracker.totalFeeUsd,
      totalSlippageUsd: tracker.totalSlippageUsd,
      netPnlUsd,
      netReturnOnMarginPct:
        tracker.allocatedMarginUsd > 0 ? (netPnlUsd / tracker.allocatedMarginUsd) * 100 : 0,
      netReturnOnNotionalPct:
        tracker.notionalUsd > 0 ? (netPnlUsd / tracker.notionalUsd) * 100 : 0,
      equityAfterUsd: portfolio.cashEquity,
      holdingMinutes: Math.max(5, Math.round((barTimeMs - tracker.entryTimeMs) / 60_000) + 5),
      regimesAtEntry: tracker.regimesAtEntry,
      legs: tracker.legs,
    };
  }

  return null;
}
