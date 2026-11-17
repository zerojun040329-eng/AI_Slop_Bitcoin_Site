import type { DataProvenanceItem, DataSourceOrigin } from './derivatives';

export type LongTermScaleMode = 'log_log' | 'semi_log' | 'linear';

export interface HistoricalPricePoint {
  date: string;
  /** Days elapsed since Bitcoin Genesis Block (2009-01-03) */
  daysSinceGenesis: number;
  close: number;
}

export interface HalvingEvent {
  epoch: number;
  label: string;
  date: string;
  daysSinceGenesis: number;
  blockHeight: number;
  rewardAfterBtc: number;
  isProjected?: boolean;
  isCurrentEpoch?: boolean;
}

export interface PowerLawBandTier {
  id: number;
  name: string;
  shortName: string;
  sigmaMin: number;
  sigmaMax: number;
  color: string;
  fillOpacity: number;
}

export interface PowerLawEvaluation {
  date: string;
  daysSinceGenesis: number;
  price: number;
  trendPrice: number;
  pctFromTrend: number;
  ratioToTrend: number;
  logResidual: number;
  zScore: number;
  tier: PowerLawBandTier;
}

export interface PowerLawModelSummary {
  /** Formula constant A in P = A * d^B */
  coeffA: number;
  /** Formula exponent B in P = A * d^B */
  exponentB: number;
  /** Empirical standard deviation of log10 residuals */
  sigmaLog10: number;
  tiers: PowerLawBandTier[];
  currentEval: PowerLawEvaluation;
}

export interface HashratePoint {
  date: string;
  /** Total network hashrate in EH/s */
  hashrateEh: number;
  /** Mining difficulty in Trillions (T) */
  difficultyT: number | null;
}

export interface MiningAssumptions {
  electricityUsdPerKwh: number;
  fleetEfficiencyJPerTh: number;
  /** Non-electricity OpEx / depreciation / hosting multiplier over raw electricity cost */
  allInOpExMultiplier: number;
  historicalAvgPremiumPct: number | null;
}

export interface MiningEconomicsSummary {
  currentSpotUsd: number;
  blockRewardBtc: number;
  avgFeePerBlockBtc: number;
  avgTotalRewardPerBlockBtc: number;
  dailyBlocksAvg: number;
  dailyNewIssuanceBtc: number;
  currentHashrateEh: number;
  athHashrateEh: number;
  athHashrateDate: string;
  hashrateChange30dPct: number;
  hashrateChange1yPct: number;
  currentDifficultyT: number;
  electricityCostPerBtcUsd: number;
  allInCostPerBtcUsd: number;
  electricityDiffUsd: number;
  allInDiffUsd: number;
  electricityPremiumPct: number;
  allInPremiumPct: number;
  historicalAvgPremiumPct: number | null;
  /** Subsidy-only daily miner revenue (dailyNewIssuanceBtc * Spot) */
  dailySubsidyRevenueUsd: number;
  /** Real 24h fee-inclusive daily miner revenue ((subsidy + avgFee) * dailyBlocks * Spot) */
  dailyTotalRevenueUsd: number;
  /** Real 24h fee-inclusive hashprice in USD per TH/s per day */
  totalHashpriceUsdPerThDay: number;
  /** Subsidy-only hashprice in USD per TH/s per day */
  subsidyHashpriceUsdPerThDay: number;
}

export interface LongTermDataset {
  origin: DataSourceOrigin;
  isSimulated: boolean;
  sourceLabel: string;
  genesisDate: string;
  currentDate: string;
  currentSpotPrice: number;
  currentBlockHeight: number;
  nextHalvingBlock: number;
  avgBlockIntervalSec: number;
  avgTotalRewardBtc: number;
  avgFeePerBlockBtc: number;
  difficultyRetargetProgressPct: number;
  difficultyRetargetChangePct: number;
  priceHistory: HistoricalPricePoint[];
  halvings: HalvingEvent[];
  hashrateHistory: HashratePoint[];
  defaultMiningAssumptions: MiningAssumptions;
  historicalFeesArchiveSupported: boolean;
  historicalFeesArchiveReason: string;
  provenance: {
    priceHistory: DataProvenanceItem;
    liveSpot: DataProvenanceItem | null;
    blockchain: DataProvenanceItem;
  };
}
