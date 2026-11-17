export type DataSourceOrigin = 'live_api';

export interface DataProvenanceItem {
  provider: string;
  fetchedAt: string | null;
  dataTimestamp?: string | null;
  cadence: string;
  kind: '실제 데이터' | '모델 추정치';
}

export interface DailyClosePoint {
  /** ISO date string (YYYY-MM-DD) */
  date: string;
  /** Short axis display label */
  label: string;
  /** Day index relative to today (-29 to 0) */
  dayOffset: number;
  /** Daily close price in USD */
  close: number;
  /** Daily trading volume in USD or contracts */
  volumeB: number;
}

export interface OptionMaturityIV {
  /** Human-readable tenor code, e.g., "7D", "30D", "365D" */
  tenor: string;
  /** Expiration date ISO string */
  expiryDate: string;
  /** Days remaining until expiration (fractional up to 365) */
  daysToExpiry: number;
  /** Annualized representative ATM Implied Volatility as decimal (e.g. 0.4966 = 49.66%) */
  atmIv: number;
  /** Call IV (ATM) as decimal */
  callIv: number;
  /** Put IV (ATM) as decimal */
  putIv: number;
  /** Whether ATM IV was directly observed vs averaged */
  ivSource: 'atm_direct' | 'interpolated';
  /** Total notional open interest at this tenor in BTC */
  tenorOiBtc: number;
  /** Strike-level OI breakdown for this maturity */
  strikesOI: OptionStrikeOI[];
}

export interface OptionStrikeOI {
  /** Strike price in USD */
  strike: number;
  /** Call Open Interest in BTC (open_interest * contract_size) */
  callOiBtc: number;
  /** Put Open Interest in BTC (open_interest * contract_size) */
  putOiBtc: number;
  /** Average Call IV at strike (decimal) */
  callIv: number;
  /** Average Put IV at strike (decimal) */
  putIv: number;
}

export type LiquidationDataType = 'estimated' | 'realized';

export interface LiquidationBin {
  priceFrom: number;
  priceTo: number;
  midPrice: number;
  estimatedLongUsdM: number;
  estimatedShortUsdM: number;
  realizedLongUsdM: number;
  realizedShortUsdM: number;
  dominantLeverage: string;
}

export interface LiquidationSupportStatus {
  supported: boolean;
  provider: string | null;
  reason: string;
}

export interface MarketSnapshot {
  id: string;
  name: string;
  description: string;
  symbol: 'BTC/USD';
  origin: DataSourceOrigin;
  isSimulated: boolean;
  sourceLabel: string;
  timestampIso: string;
  currentPrice: number;
  history30d: DailyClosePoint[];
  optionMaturities: OptionMaturityIV[];
  optionStrikesOI: OptionStrikeOI[];
  liquidationBins: LiquidationBin[];
  liquidationSupport: LiquidationSupportStatus;
  provenance: {
    spot: DataProvenanceItem;
    history30d: DataProvenanceItem;
    options: DataProvenanceItem;
  };
}

export interface ExpectedMovePoint {
  tenor: string;
  expiryDate: string;
  daysToExpiry: number;
  atmIv: number;
  callIv: number;
  putIv: number;
  ivSource: 'atm_direct' | 'interpolated';
  tenorOiBtc: number;
  /** Absolute 1-sigma expected move in USD: Spot * IV * sqrt(days / 365) */
  expectedMoveUsd: number;
  /** Percentage 1-sigma expected move: IV * sqrt(days / 365) */
  expectedMovePct: number;
  /** Upper 1-sigma bound (Spot + expectedMoveUsd) */
  upper1Sigma: number;
  /** Lower 1-sigma bound (Spot - expectedMoveUsd) */
  lower1Sigma: number;
  /** Upper 0.5-sigma inner reference */
  upperHalfSigma: number;
  /** Lower 0.5-sigma inner reference */
  lowerHalfSigma: number;
}

export interface MaturityMaxPainPoint {
  tenor: string;
  expiryDate: string;
  daysToExpiry: number;
  maxPainPrice: number;
  diffFromSpotUsd: number;
  diffFromSpotPct: number;
  totalCallOiBtc: number;
  totalPutOiBtc: number;
}

export interface MaxPainCurvePoint {
  strike: number;
  callOiBtc: number;
  putOiBtc: number;
  /** Total buyer payout / expiration loss metric at this settlement price (USD millions) */
  callSettlementUsdM: number;
  putSettlementUsdM: number;
  totalSettlementUsdM: number;
}

export interface MaxPainAnalysis {
  maxPainPrice: number;
  minSettlementUsdM: number;
  /** Difference: maxPainPrice - currentPrice */
  diffFromSpotUsd: number;
  /** Percentage difference: (maxPainPrice - currentPrice) / currentPrice */
  diffFromSpotPct: number;
  totalCallOiBtc: number;
  totalPutOiBtc: number;
  putCallRatio: number;
  curve: MaxPainCurvePoint[];
}

export interface LiquidationSummary {
  totalEstimatedLongUsdM: number;
  totalEstimatedShortUsdM: number;
  totalRealizedLongUsdM: number;
  totalRealizedShortUsdM: number;
  peakShortCluster: LiquidationBin | null;
  peakLongCluster: LiquidationBin | null;
  maxBinTotalUsdM: number;
}

export interface LayerVisibility {
  showIV: boolean;
  showMaxPain: boolean;
  showLiquidations: boolean;
}
