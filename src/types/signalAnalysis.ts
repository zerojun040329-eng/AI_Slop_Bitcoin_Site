export type IndicatorId =
  | 'er48'
  | 'rsi14'
  | 'vwapZ48'
  | 'rv48'
  | 'rvol48'
  | 'vp12'
  | 'donchian48'
  | 'amihud48';

export const ALL_INDICATOR_IDS: IndicatorId[] = [
  'er48',
  'rsi14',
  'vwapZ48',
  'rv48',
  'rvol48',
  'vp12',
  'donchian48',
  'amihud48',
];

export interface IndicatorDefinition {
  id: IndicatorId;
  shortLabel: string;
  name: string;
  koreanName: string;
  windowBars: number;
  category: 'trend_efficiency' | 'momentum' | 'mean_reversion' | 'volatility' | 'volume_flow' | 'liquidity';
  formulaSummary: string;
  causalScaleDesc: string;
  unit: string;
}

export const INDICATOR_DEFINITIONS: Record<IndicatorId, IndicatorDefinition> = {
  er48: {
    id: 'er48',
    shortLabel: 'ER(48)',
    name: 'Kaufman Efficiency Ratio',
    koreanName: '추세 효율성 비율',
    windowBars: 48,
    category: 'trend_efficiency',
    formulaSummary: '|Close[t] - Close[t-48]| / Σ|Close[i] - Close[i-1]|',
    causalScaleDesc: '[0, 1] 원시 비율 → 인과적 Z-스코어 변환',
    unit: 'ratio',
  },
  rsi14: {
    id: 'rsi14',
    shortLabel: 'RSI(14)',
    name: 'Wilder RSI',
    koreanName: '와일더 상대강도지수',
    windowBars: 14,
    category: 'momentum',
    formulaSummary: '100 - 100 / (1 + WilderEMA(Gain,14) / WilderEMA(Loss,14))',
    causalScaleDesc: '[0, 100] 구간 → 인과적 Z-스코어 변환',
    unit: 'pt',
  },
  vwapZ48: {
    id: 'vwapZ48',
    shortLabel: 'VWAP-Z(48)',
    name: 'Rolling VWAP Deviation Z-score',
    koreanName: '롤링 VWAP 이격도 Z',
    windowBars: 48,
    category: 'mean_reversion',
    formulaSummary: '(Close[t] - RollingVWAP(48)) / RollingStdDev(Close, 48)',
    causalScaleDesc: '과거 누적 분포 기준 인과적 표준화',
    unit: 'σ',
  },
  rv48: {
    id: 'rv48',
    shortLabel: 'RV(48)',
    name: 'Realized Volatility',
    koreanName: '실현 변동성 (4h)',
    windowBars: 48,
    category: 'volatility',
    formulaSummary: '√(Σ ln(Close[i]/Close[i-1])²)',
    causalScaleDesc: '과거 시점까지만의 백분위 순위 [0, 1] → Z-스코어',
    unit: '%',
  },
  rvol48: {
    id: 'rvol48',
    shortLabel: 'RVOL(48)',
    name: 'Relative Volume (vs Median)',
    koreanName: '상대 거래량 비율',
    windowBars: 48,
    category: 'volume_flow',
    formulaSummary: 'Volume[t] / Median(Volume[t-48 .. t-1])',
    causalScaleDesc: 'ln(RVOL) 로그 변환 후 인과적 표준화',
    unit: 'x',
  },
  vp12: {
    id: 'vp12',
    shortLabel: 'VP(12)',
    name: 'Volume Pressure (CLV)',
    koreanName: '거래량 가중 매수압력',
    windowBars: 12,
    category: 'volume_flow',
    formulaSummary: 'Σ(CLV[i]·Vol[i]) / ΣVol[i], CLV=(2C-H-L)/(H-L)',
    causalScaleDesc: '[-1, +1] 정규 구간 → 인과적 Z-스코어 변환',
    unit: 'clv',
  },
  donchian48: {
    id: 'donchian48',
    shortLabel: 'Donchian(48)',
    name: 'Donchian Channel Position',
    koreanName: '돈치안 채널 내 위치',
    windowBars: 48,
    category: 'trend_efficiency',
    formulaSummary: '(Close[t] - MinLow[t-48..t-1]) / (MaxHigh[t-48..t-1] - MinLow[t-48..t-1])',
    causalScaleDesc: '과거 48봉 고저 대비 위치 → 인과적 표준화',
    unit: 'pos',
  },
  amihud48: {
    id: 'amihud48',
    shortLabel: 'Amihud(48)',
    name: 'Amihud Illiquidity Proxy',
    koreanName: '아미후드 비유동성 지수',
    windowBars: 48,
    category: 'liquidity',
    formulaSummary: 'Mean(|Return[i]| / QuoteVolume[i]) × 10⁹ (48봉)',
    causalScaleDesc: '과거 시점까지만의 백분위 순위 [0, 1] → Z-스코어',
    unit: 'illiq',
  },
};

export interface RawCandleBar {
  openTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
}

export interface IntegrityReport {
  totalStoredBars: number;
  expectedBarsInSpan: number;
  startTimestampMs: number | null;
  endTimestampMs: number | null;
  duplicateRowsRemoved: number;
  abnormalRowsDropped: number;
  missingGapIntervals: number;
  missingBarsTotal: number;
  repairedGapBars: number;
  chronologicalSorted: boolean;
  excludedUnclosedCandle: boolean;
  lastClosedOpenTimeMs: number | null;
  verifiedAtIso: string;
}

export type SyncStatePhase =
  | 'idle'
  | 'backfilling'
  | 'repairing_gaps'
  | 'updating_incremental'
  | 'ready'
  | 'error';

export interface SyncStatus {
  phase: SyncStatePhase;
  exchange: string;
  symbol: string;
  interval: '5m';
  targetYears: number;
  progressPercent: number;
  completedPages: number;
  totalPages: number;
  storedBars: number;
  targetMinBars: number;
  hasSufficientData: boolean;
  lastUpdatedIso: string | null;
  lastError: string | null;
  usedWeight1m: number;
  integrity: IntegrityReport;
}

export interface IndicatorPairStat {
  rowId: IndicatorId;
  colId: IndicatorId;
  pearson: number;
  spearman: number;
  mutualInfo: number;
  isRedundant: boolean;
}

export interface IndicatorStabilityStat {
  id: IndicatorId;
  validCount: number;
  nullCount: number;
  mean: number;
  stdDev: number;
  firstHalfMean: number;
  secondHalfMean: number;
  firstHalfStd: number;
  secondHalfStd: number;
  psiDrift: number;
  isRedundantExcluded: boolean;
  exclusionReason: string | null;
}

export interface IndependenceMatrixReport {
  sampleCount: number;
  ids: IndicatorId[];
  activeIndicatorIds: IndicatorId[];
  excludedIndicatorIds: IndicatorId[];
  redundancyThreshold: number;
  redundantPairs: IndicatorPairStat[];
  pearsonMatrix: number[][];
  spearmanMatrix: number[][];
  mutualInfoMatrix: number[][];
  stability: IndicatorStabilityStat[];
  summaryNote: string;
}

export type MarketRegimeId = 'uptrend' | 'downtrend' | 'range' | 'high_vol';

export interface MarketRegimeInfo {
  id: MarketRegimeId;
  koreanLabel: string;
  description: string;
  sampleCount: number;
  sharePercent: number;
}

export type DistanceMetricType = 'mahalanobis' | 'euclidean';

export interface IndicatorValueSnapshot {
  id: IndicatorId;
  rawValue: number | null;
  normalizedValue: number | null;
  percentileRank: number | null;
  zScore: number | null;
}

export interface TargetMarketState {
  index: number;
  openTimeMs: number;
  closeTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  regime: MarketRegimeId;
  regimeLabel: string;
  indicators: IndicatorValueSnapshot[];
  missingIndicatorIds: IndicatorId[];
}

export interface SimilarityMatch {
  matchRank: number;
  index: number;
  openTimeMs: number;
  closeTimeMs: number;
  closePrice: number;
  distance: number;
  mahalanobisDistance: number;
  euclideanDistance: number;
  similarityScore: number;
  regime: MarketRegimeId;
  regimeLabel: string;
  indicators: Record<IndicatorId, number | null>;
  normalizedVector: Record<IndicatorId, number | null>;
  forwardReturnsPct: Record<HorizonKey, number | null>;
}

export interface TemporalClusterStats {
  rawCandidatesCount: number;
  acceptedCount: number;
  removedByGapCount: number;
  minGapHours: number;
  medianInterMatchHours: number | null;
  minInterMatchHours: number | null;
  yearlyDistribution: Array<{ year: string; rawCount: number; deduplicatedCount: number }>;
  clusterRiskNote: string;
}

export type HorizonKey = '30m' | '1h' | '3h' | '6h' | '12h' | '24h';

export const HORIZON_CONFIG: Array<{ key: HorizonKey; bars: number; label: string; koreanLabel: string }> = [
  { key: '30m', bars: 6, label: '30m', koreanLabel: '30분' },
  { key: '1h', bars: 12, label: '1h', koreanLabel: '1시간' },
  { key: '3h', bars: 36, label: '3h', koreanLabel: '3시간' },
  { key: '6h', bars: 72, label: '6h', koreanLabel: '6시간' },
  { key: '12h', bars: 144, label: '12h', koreanLabel: '12시간' },
  { key: '24h', bars: 288, label: '24h', koreanLabel: '24시간' },
];

export type StatisticalVerdict =
  | 'insufficient_sample'
  | 'significant_fdr'
  | 'marginal_uncorrected'
  | 'not_significant';

export interface StatisticalSignificanceResult {
  effectiveSampleSize: number;
  autocorrelationLag1: number;
  bootstrapBlockLength: number;
  bootstrapMeanCiLow: number | null;
  bootstrapMeanCiHigh: number | null;
  hacTStat: number | null;
  hacPValue: number | null;
  welchTStat: number | null;
  welchPValue: number | null;
  mannWhitneyU: number | null;
  mannWhitneyPValue: number | null;
  fdrAdjustedPValue: number | null;
  isFdrSignificant: boolean;
  verdict: StatisticalVerdict;
  verdictLabel: string;
}

export interface HorizonReturnStats {
  horizon: HorizonKey;
  barsAhead: number;
  koreanLabel: string;
  sampleCount: number;
  excludedBoundaryCount: number;
  meanReturnPct: number | null;
  medianReturnPct: number | null;
  winRatePct: number | null;
  stdDevPct: number | null;
  minReturnPct: number | null;
  maxReturnPct: number | null;
  p05Pct: number | null;
  p25Pct: number | null;
  p75Pct: number | null;
  p95Pct: number | null;
  ci95LowPct: number | null;
  ci95HighPct: number | null;
  baselineMeanPct: number | null;
  baselineWinRatePct: number | null;
  baselineSampleCount: number;
  excessReturnPct: number | null;
  histogramBins: Array<{ from: number; to: number; count: number }>;
  significance: StatisticalSignificanceResult;
}

export interface PriceContextPoint {
  openTimeMs: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface MatchDetailResponse {
  matchIndex: number;
  openTimeMs: number;
  closePrice: number;
  regime: MarketRegimeId;
  regimeLabel: string;
  mahalanobisDistance: number;
  euclideanDistance: number;
  indicators: IndicatorValueSnapshot[];
  forwardReturnsPct: Record<HorizonKey, number | null>;
  contextSeries: Array<{
    offsetBars: number;
    openTimeMs: number;
    close: number;
    returnFromMatchPct: number;
  }>;
}

export interface AblationExperimentResult {
  experimentId: string;
  label: string;
  kind: 'all' | 'leave_one_out' | 'single' | 'custom';
  includedIndicators: IndicatorId[];
  omittedIndicator: IndicatorId | null;
  dedupMatchesCount: number;
  horizonKey: HorizonKey;
  sampleCount: number;
  meanReturnPct: number | null;
  winRatePct: number | null;
  excessReturnPct: number | null;
  ci95LowPct: number | null;
  ci95HighPct: number | null;
  fdrPValue: number | null;
  deltaMeanVsFullPct: number | null;
  deltaWinRateVsFullPct: number | null;
}

export interface SignalAnalysisRunRequest {
  targetTimestampMs?: number | null;
  distanceMetric?: DistanceMetricType;
  threshold?: number;
  minGapHours?: number;
  regimeFilter?: MarketRegimeId | 'all';
  selectedIndicators?: IndicatorId[];
  ablationHorizon?: HorizonKey;
  includeAblation?: boolean;
}

export interface SignalAnalysisResponse {
  request: Required<Omit<SignalAnalysisRunRequest, 'targetTimestampMs'>> & {
    targetTimestampMs: number;
  };
  dataSpan: {
    startTimestampMs: number;
    endTimestampMs: number;
    totalBars: number;
    availableTargetsMinMs: number;
    availableTargetsMaxMs: number;
  };
  targetState: TargetMarketState;
  availableRegimes: MarketRegimeInfo[];
  independence: IndependenceMatrixReport;
  clustering: TemporalClusterStats;
  thresholdGuidance: {
    recommendedLow: number;
    recommendedMid: number;
    recommendedHigh: number;
    sampleWarning: 'too_few' | 'too_many' | 'optimal';
    warningMessage: string | null;
  };
  dedupVsRawComparison: {
    horizon: HorizonKey;
    rawCount: number;
    rawMeanPct: number | null;
    rawWinRatePct: number | null;
    dedupCount: number;
    dedupMeanPct: number | null;
    dedupWinRatePct: number | null;
  };
  matches: SimilarityMatch[];
  horizonStats: HorizonReturnStats[];
  regimeComparison: Array<{
    regime: MarketRegimeId | 'all';
    label: string;
    matchCount: number;
    stats24h: {
      meanReturnPct: number | null;
      winRatePct: number | null;
      excessReturnPct: number | null;
      ci95LowPct: number | null;
      ci95HighPct: number | null;
    };
  }>;
  priceOverviewSeries: PriceContextPoint[];
  ablationResults: AblationExperimentResult[];
  computedInMs: number;
}
