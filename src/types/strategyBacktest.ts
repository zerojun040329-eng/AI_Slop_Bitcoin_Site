export type StrategyId = 'liquidity_fakeout';

export type TradeDirection = 'LONG' | 'SHORT';

export type ExitReason =
  | 'CLOSE_STOP_LOSS'
  | 'BREAKEVEN_STOP'
  | 'TP2_FULL_TARGET'
  | 'END_OF_DATA';

export interface BacktestAccountConfig {
  initialCapital: number;
  positionSizePct: number; // e.g., 25 = 25% of current equity allocated as margin
  leverage: number; // e.g., 2 = 2x notional leverage
  feeRatePct: number; // e.g., 0.04 = 0.04% per side (taker)
  slippagePct: number; // e.g., 0.02 = 0.02% adverse fill slippage per side
}

export interface LiquidityFakeoutParams {
  pivotLeftBars: number;
  pivotRightBars: number;
  rvolPeriod: number;
  minRvol: number;
  minReversalStrength: number; // body+wick reversal ratio
  minRangeAtrMultiple: number; // pivot candle (H-L)/ATR
  minVolumeSurgeRatio: number; // pivot vol / SMA(vol)
  atrPeriod: number;
  tp1AtrMultiple: number; // N
  tp2AtrMultiple: number; // M (enforced N < M)
  sweepWindowBars: number; // max bars allowed between break and close recovery (1 = single-bar wick, 2-3 = short multi-bar sweep)
  maxPivotAgeBars: number; // max bars a confirmed pivot stays valid
}

export interface StrategyConfigParamSchema {
  key: keyof LiquidityFakeoutParams;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export interface StrategyMetadata {
  id: StrategyId;
  name: string;
  koreanName: string;
  summary: string;
  rulesSummary: string[];
  defaultParams: LiquidityFakeoutParams;
  paramSchema: StrategyConfigParamSchema[];
}

export type RegimeTag =
  | 'uptrend'
  | 'downtrend'
  | 'range'
  | 'high_vol'
  | 'low_vol'
  | 'high_volume'
  | 'low_volume';

export interface TradeExecutionLeg {
  timestampMs: number;
  barIndex: number;
  type: 'ENTRY' | 'TP1_PARTIAL' | 'EXIT_FINAL';
  price: number;
  qtyRatio: number; // 1.0 for entry, 0.5 for TP1, 0.5 or 1.0 for final exit
  feeUsd: number;
  slippageCostUsd: number;
  realizedPnlUsd: number;
}

export interface TradeRecord {
  tradeId: number;
  strategyId: StrategyId;
  direction: TradeDirection;
  pivotIndex: number;
  pivotConfirmedIndex: number;
  pivotPrice: number;
  signalIndex: number;
  signalTimeMs: number;
  entryIndex: number;
  entryTimeMs: number;
  entryPrice: number;
  entryAtr: number;
  initialStopPrice: number;
  tp1Price: number;
  tp2Price: number;
  tp1Hit: boolean;
  tp1TimeMs: number | null;
  tp1FillPrice: number | null;
  tp2Hit: boolean;
  exitIndex: number;
  exitTimeMs: number;
  exitPrice: number; // weighted average exit price or final leg price (stored clearly)
  finalExitPrice: number;
  exitReason: ExitReason;
  exitReasonLabel: string;
  notionalUsd: number;
  grossPnlUsd: number;
  totalFeeUsd: number;
  totalSlippageUsd: number;
  netPnlUsd: number;
  netReturnOnMarginPct: number;
  netReturnOnNotionalPct: number;
  equityAfterUsd: number;
  holdingMinutes: number;
  regimesAtEntry: {
    trend: 'uptrend' | 'downtrend' | 'range';
    volatility: 'high_vol' | 'low_vol';
    volume: 'high_volume' | 'low_volume';
  };
  legs: TradeExecutionLeg[];
}

export interface EquityPoint {
  timestampMs: number;
  equityUsd: number;
  drawdownPct: number;
  btcClose: number;
}

export interface PerformanceSummary {
  initialCapitalUsd: number;
  finalEquityUsd: number;
  netProfitUsd: number;
  totalReturnPct: number;
  annualizedReturnPct: number | null;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number | null;
  avgTradeReturnPct: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  profitFactor: number | null; // null if 0 trades or 0 losses (labeled safely)
  profitFactorDisplay: string;
  expectancyUsd: number | null;
  expectancyPct: number | null;
  payoffRatio: number | null;
  totalFeesPaidUsd: number;
  totalSlippagePaidUsd: number;
}

export interface RiskSummary {
  maxDrawdownPct: number;
  maxDrawdownUsd: number;
  sharpeRatio: number | null; // annualized from uniform hourly portfolio equity returns
  sortinoRatio: number | null;
  maxConsecutiveLosses: number;
  maxConsecutiveLossUsd: number;
  avgHoldingMinutes: number | null;
  annualizationNote: string;
}

export interface StatisticalValidationSummary {
  sampleCount: number;
  isSampleSufficient: boolean; // >= 30 trades
  reliabilityLabel: string;
  expectancyMeanPct: number | null;
  parametricCi95LowPct: number | null;
  parametricCi95HighPct: number | null;
  blockBootstrapCi95LowPct: number | null;
  blockBootstrapCi95HighPct: number | null;
  bootstrapBlockLength: number;
  inSample: {
    label: string;
    trades: number;
    winRatePct: number | null;
    expectancyPct: number | null;
    profitFactorDisplay: string;
    totalReturnPct: number;
  };
  outOfSample: {
    label: string;
    trades: number;
    winRatePct: number | null;
    expectancyPct: number | null;
    profitFactorDisplay: string;
    totalReturnPct: number;
  };
  yearlyBreakdown: Array<{
    year: string;
    trades: number;
    winRatePct: number | null;
    netPnlUsd: number;
    returnPct: number;
    profitFactorDisplay: string;
  }>;
  monthlyReturns: Array<{
    year: number;
    month: number; // 1..12
    trades: number;
    returnPct: number;
    netPnlUsd: number;
  }>;
}

export interface BreakdownBucket {
  key: string;
  label: string;
  trades: number;
  winRatePct: number | null;
  expectancyPct: number | null;
  profitFactorDisplay: string;
  netPnlUsd: number;
}

export interface StrategyBacktestRunRequest {
  strategyId?: StrategyId;
  strategyParams?: Partial<LiquidityFakeoutParams>;
  account?: Partial<BacktestAccountConfig>;
  startTimestampMs?: number | null;
  endTimestampMs?: number | null;
}

export interface StrategyBacktestResponse {
  strategy: StrategyMetadata;
  resolvedParams: LiquidityFakeoutParams;
  resolvedAccount: BacktestAccountConfig;
  dataSpan: {
    startTimestampMs: number;
    endTimestampMs: number;
    totalBarsEvaluated: number;
    pivotsDetectedCount: number;
    signalsGeneratedCount: number;
    signalsIgnoredWhileInPosition: number;
  };
  performance: PerformanceSummary;
  risk: RiskSummary;
  validation: StatisticalValidationSummary;
  directionBreakdown: BreakdownBucket[];
  regimeBreakdown: BreakdownBucket[];
  equityCurve: EquityPoint[];
  trades: TradeRecord[]; // up to 1000 most recent or full list if <= 2500
  totalTradesRecorded: number;
  reconciliationOk: boolean;
  reconciliationDiffUsd: number;
  computedInMs: number;
}

export interface TradeChartCandle {
  openTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeDetailWindowResponse {
  trade: TradeRecord;
  candles: TradeChartCandle[];
}
