export type AssetId = 'BTC' | 'SPY' | 'QQQ' | 'XAU' | 'WTI' | 'TLT' | 'EEM';
export type MacroId = 'DXY' | 'M2' | 'DGS10';
export type MarketProviderId = 'bybit' | 'btc_local_store' | 'yahoo_finance' | 'fred';
export type MarketDataStatus = 'ok' | 'unsupported' | 'error' | 'syncing';

export type AssetInstrumentType = 'crypto_perpetual' | 'tradfi_perpetual' | 'unsupported';

export interface NetworkOhlcvBar {
  openTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
}

export interface AssetMarketSummary {
  id: AssetId;
  name: string;
  targetDescription: string;
  symbol: string | null;
  instrumentType: AssetInstrumentType;
  bybitSymbolType: string | null;
  provider: MarketProviderId;
  providerLabel: string;
  cadence: '5m';
  status: MarketDataStatus;
  errorMessage: string | null;
  lastUpdatedIso: string | null;
  latestTimestampMs: number | null;
  latestTimestampIso: string | null;
  latestPrice: number | null;
  change1hPct: number | null;
  change4hPct: number | null;
  change24hPct: number | null;
  storedBars: number;
}

export interface MacroObservation {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface MacroIndicatorSummary {
  id: MacroId;
  name: string;
  seriesCode: string;
  provider: MarketProviderId;
  providerLabel: string;
  cadence: '1d' | '1mo';
  unit: string;
  status: MarketDataStatus;
  errorMessage: string | null;
  lastUpdatedIso: string | null;
  latestDate: string | null;
  latestValue: number | null;
  /** DXY: daily % change; M2: YoY % growth; DGS10: daily yield change in percentage points */
  changeLabel: string;
  changeValue: number | null;
  changeUnit: '%' | '%p';
  pointCount: number;
  recentObservations: MacroObservation[];
}

export interface AssetCorrelationMatrix {
  windowId: '24h' | '30d';
  windowLabel: string;
  cadence: '5m';
  assetIds: AssetId[];
  matrix: Array<Array<number | null>>;
  sampleCounts: Array<Array<number>>;
  computedAtIso: string;
}

export interface MacroCorrelationPair {
  pairId: string;
  idA: MacroId;
  idB: MacroId;
  label: string;
  cadence: '1d' | '1mo';
  sampleCount: number;
  startDate: string | null;
  endDate: string | null;
  correlation: number | null;
  bestLag: {
    lagSteps: number;
    lagUnit: 'days' | 'months';
    correlation: number;
  } | null;
  status: 'ok' | 'insufficient_data' | 'error';
  errorMessage: string | null;
}

export interface MacroCorrelationSummary {
  ids: MacroId[];
  monthlyMatrix: Array<Array<number | null>>;
  monthlySampleCounts: Array<Array<number>>;
  pairs: MacroCorrelationPair[];
  computedAtIso: string;
  methodologyNote: string;
}

export interface BtcMacroCrossPair {
  pairId: 'btc_dxy_daily' | 'btc_dxy_monthly' | 'btc_m2_monthly';
  label: string;
  macroId: 'DXY' | 'M2';
  cadence: '1d' | '1mo';
  btcSourceLabel: string;
  macroSourceLabel: string;
  sampleCount: number;
  startDate: string | null;
  endDate: string | null;
  correlation: number | null;
  bestLag: {
    lagSteps: number;
    lagUnit: 'days' | 'months';
    correlation: number;
  } | null;
  status: 'ok' | 'insufficient_data' | 'error';
  errorMessage: string | null;
}

export interface BtcMacroCrossAnalysis {
  pairs: BtcMacroCrossPair[];
  computedAtIso: string;
  causalityNotice: string;
}

export interface ProviderHealthStatus {
  provider: MarketProviderId;
  label: string;
  status: 'ok' | 'partial' | 'error';
  lastSyncIso: string | null;
  successCount: number;
  totalCount: number;
  errorMessages: string[];
  modeNote: string;
}

export interface MarketNetworkStatusResponse {
  isSyncing: boolean;
  lastFullSyncIso: string | null;
  providers: ProviderHealthStatus[];
  assets: AssetMarketSummary[];
  macro: MacroIndicatorSummary[];
}

export interface MarketNetworkOverviewResponse {
  status: MarketNetworkStatusResponse;
  assetCorrelations: {
    h24: AssetCorrelationMatrix;
    d30: AssetCorrelationMatrix;
  };
  macroCorrelations: MacroCorrelationSummary;
  btcMacroCross: BtcMacroCrossAnalysis;
}

export interface AssetOhlcvResponse {
  asset: AssetMarketSummary;
  bars: NetworkOhlcvBar[];
}
