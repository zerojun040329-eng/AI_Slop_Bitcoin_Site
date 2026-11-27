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

export type AssetDetailId = 'QQQ' | 'SPY' | 'XAU' | 'TLT' | 'M2' | 'WTI';

export interface QqqTechConstituent {
  rank: number;
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  marketCapUsd: number;
  priceUsd: number | null;
  changePct: number | null;
  weightInTop10Pct: number;
}

export interface QqqDetailPayload {
  assetId: 'QQQ';
  title: string;
  subtitle: string;
  constituents: QqqTechConstituent[];
  totalTechMarketCapUsd: number;
  marketCapReferenceDate: string | null;
  fetchedAtIso: string;
  sourceLabel: string;
  methodologyNote: string;
}

export interface SpySectorSatellite {
  sectorKey: string;
  labelKo: string;
  etfSymbol: string;
  spyWeightPct: number;
  sectorMarketCapUsd: number;
  constituentCount: number;
  etfPriceUsd: number | null;
  changePct: number | null;
}

export interface SpyCenterTechStock {
  symbol: string;
  name: string;
  sector: string;
  marketCapUsd: number;
  spyWeightPct: number | null;
  priceUsd: number | null;
  changePct: number | null;
}

export interface SpyDetailPayload {
  assetId: 'SPY';
  title: string;
  subtitle: string;
  centerTechStock: SpyCenterTechStock;
  sectors: SpySectorSatellite[];
  holdingsReferenceDate: string | null;
  fetchedAtIso: string;
  sourceLabel: string;
  methodologyNote: string;
}

export interface MetalNodeItem {
  id: 'XAU' | 'XAG' | 'HG' | 'PL' | 'PA';
  symbol: string;
  nameKo: string;
  categoryKo: '귀금속' | '산업금속';
  unitLabel: string;
  status: 'ok' | 'unsupported';
  priceUsd: number | null;
  change1dPct: number | null;
  correlationToXau: number | null;
  sampleCount: number;
  sourceLabel: string;
  lastDate: string | null;
  reason?: string;
}

export interface XauDetailPayload {
  assetId: 'XAU';
  title: string;
  subtitle: string;
  center: MetalNodeItem;
  satellites: MetalNodeItem[];
  fetchedAtIso: string;
  methodologyNote: string;
}

export type TreasuryMaturityKey = '2Y' | '5Y' | '10Y' | '20Y' | '30Y';

export interface TreasuryMaturityPoint {
  date: string;
  yieldPct: number | null;
}

export interface TreasuryMaturitySummary {
  maturity: TreasuryMaturityKey;
  seriesCode: string;
  latestDate: string | null;
  latestYieldPct: number | null;
  change1dPp: number | null;
  change1mPp: number | null;
}

export interface TltDetailPayload {
  assetId: 'TLT';
  title: string;
  subtitle: string;
  tltReference: {
    symbol: string;
    priceUsd: number | null;
    change24hPct: number | null;
    latestTimestampIso: string | null;
  };
  spread10y2yPp: number | null;
  maturities: TreasuryMaturitySummary[];
  seriesDates: string[];
  seriesByMaturity: Record<TreasuryMaturityKey, Array<number | null>>;
  fetchedAtIso: string;
  sourceLabel: string;
  etfDistinctionNote: string;
}

export interface MacroMindMapLeaf {
  id: string;
  labelKo: string;
  seriesCode: string;
  status: 'ok' | 'unlinked';
  valueText: string;
  subText: string;
  directionValue: number | null;
  observationDate: string | null;
  sourceLabel: string;
}

export interface MacroMindMapGroup {
  id: 'money_supply' | 'liquidity' | 'rates' | 'economy' | 'inflation' | 'markets';
  labelKo: string;
  nodes: MacroMindMapLeaf[];
}

export interface M2DetailPayload {
  assetId: 'M2';
  title: string;
  subtitle: string;
  center: {
    labelKo: string;
    seriesCode: string;
    yoyPct: number | null;
    levelBillionsUsd: number | null;
    latestDate: string | null;
  };
  groups: MacroMindMapGroup[];
  fetchedAtIso: string;
  methodologyNote: string;
}

export interface EnergyNodeItem {
  id: 'WTI' | 'BRENT' | 'RBOB' | 'HOIL' | 'NATGAS';
  symbol: string;
  nameKo: string;
  roleKo: string;
  unitLabel: string;
  status: 'ok' | 'unsupported';
  priceUsd: number | null;
  change1dPct: number | null;
  correlationToWti: number | null;
  sampleCount: number;
  spreadToWtiText: string | null;
  sourceLabel: string;
  lastDate: string | null;
  reason?: string;
}

export interface WtiDetailPayload {
  assetId: 'WTI';
  title: string;
  subtitle: string;
  center: EnergyNodeItem;
  satellites: EnergyNodeItem[];
  brentWtiSpreadUsd: number | null;
  fetchedAtIso: string;
  methodologyNote: string;
}

export type AssetDetailPayload =
  | QqqDetailPayload
  | SpyDetailPayload
  | XauDetailPayload
  | TltDetailPayload
  | M2DetailPayload
  | WtiDetailPayload;

