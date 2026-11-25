import type {
  ExitReason,
  StrategyId,
  StrategyMetadata,
  TradeDirection,
} from '../../types/strategyBacktest.ts';

export interface BacktestCandleSeries {
  count: number;
  openTimeMs: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  quoteVolume: Float64Array;
}

export interface StrategySignal {
  signalIndex: number; // closed bar index where signal triggers
  executeIndex: number; // signalIndex + 1 (next bar open)
  direction: TradeDirection;
  pivotIndex: number;
  pivotConfirmedIndex: number;
  pivotPrice: number;
  atrAtSignal: number;
  initialStopPrice: number;
}

export interface ActivePositionState {
  direction: TradeDirection;
  pivotPrice: number;
  entryIndex: number;
  entryPrice: number;
  entryAtr: number;
  initialStopPrice: number;
  tp1Price: number;
  tp2Price: number;
  tp1Hit: boolean;
  remainingRatio: number; // starts at 1.0, drops to 0.5 after TP1
  breakevenStopPrice: number | null;
}

export interface BarPositionAction {
  tp1FilledPrice?: number;
  tp1QtyRatio?: number;
  movedToBreakeven?: boolean;
  finalExitPrice?: number;
  finalQtyRatio?: number;
  exitReason?: ExitReason;
  exitReasonLabel?: string;
}

export interface StrategyPreparedData<TParams = Record<string, unknown>> {
  params: TParams;
  atr: Float64Array;
  pivotsDetectedCount: number;
  signalsByExecuteIndex: Map<number, StrategySignal>;
  totalSignalsGenerated: number;
}

export interface TradingStrategyModule<TParams = Record<string, unknown>> {
  readonly metadata: StrategyMetadata;
  resolveParams(rawParams?: Partial<TParams>): TParams;
  prepare(series: BacktestCandleSeries, params: TParams, startIdx: number, endIdx: number): StrategyPreparedData<TParams>;
  buildPositionPlan(entryPrice: number, entryIndex: number, signal: StrategySignal, params: TParams): ActivePositionState;
  evaluateBarExit(
    series: BacktestCandleSeries,
    barIndex: number,
    position: ActivePositionState,
  ): BarPositionAction;
}
