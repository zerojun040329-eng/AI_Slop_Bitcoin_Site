export type HalvingEpochId = 2 | 3 | 4;

export interface RealTestInputs {
  /** Total planned Spot DCA budget per halving cycle in USDT/USD */
  totalBudgetUsd: number;
  /** Spot buy fee rate in percent (e.g., 0.1 means 0.10%) */
  feeRatePct: number;
}

export interface DailyPriceRow {
  date: string; // YYYY-MM-DD UTC
  priceUsd: number;
}

export interface HalvingSchedule {
  epoch: HalvingEpochId;
  cycleLabel: string;
  halvingDate: string;
  blockHeight: number;
  rewardAfterBtc: number;
  /** Strategy 2 option entry: Halving + 18 calendar months */
  optionEntryDate: string;
  /** Strategy 2 option expiry: OptionEntry + 365 calendar days */
  optionExpiryDate: string;
  /** Strategy 1 spot DCA start: Halving + 24 calendar months */
  dcaStartDate: string;
  /** Strategy 1 spot DCA exclusive end boundary: Halving + 36 calendar months */
  dcaEndExclusiveDate: string;
  /** Final scheduled UTC daily buy date inside [dcaStartDate, dcaEndExclusiveDate) */
  dcaLastScheduledBuyDate: string;
  /** Total scheduled UTC daily buy days D in the 12-month window */
  totalScheduledDays: number;
}

export type SpotDcaStatus = 'completed' | 'ongoing' | 'not_started' | 'insufficient_data';

export interface SpotDcaDailyExecution {
  date: string;
  dayIndex: number;
  priceUsd: number;
  grossInvestedUsd: number;
  feeUsd: number;
  netCapitalUsd: number;
  btcBought: number;
  cumulativeGrossInvestedUsd: number;
  cumulativeFeeUsd: number;
  cumulativeBtc: number;
  averageEntryPriceUsd: number;
  portfolioValueUsd: number;
}

export interface SpotDcaCycleResult {
  status: SpotDcaStatus;
  statusLabel: string;
  executionRuleLabel: string;
  scheduledDays: number;
  executedDays: number;
  remainingDays: number;
  missingDataDays: number;
  progressPct: number;
  plannedTotalBudgetUsd: number;
  dailyInvestmentGrossUsd: number;
  feeRatePct: number;
  /** Actual cash spent so far (executedDays * dailyInvestmentGrossUsd) */
  totalInvestedUsd: number;
  totalFeeUsd: number;
  netCapitalAllocatedUsd: number;
  totalBtc: number;
  averageEntryPriceUsd: number | null;
  /** Latest evaluation price used for mark-to-market (liveSpot for ongoing, or latestClose) */
  evaluationPriceUsd: number | null;
  evaluationDate: string | null;
  evaluationPriceSource: 'live_spot' | 'daily_close' | null;
  portfolioValueUsd: number;
  netProfitUsd: number;
  roiPct: number | null;
  /** Value strictly on the last closed daily price inside the DCA window */
  valueAtWindowEndUsd: number | null;
  windowEndPriceUsd: number | null;
  executions: SpotDcaDailyExecution[];
}

export type PutOptionStatus = 'completed' | 'unmatured' | 'not_entered' | 'insufficient_data';

export interface PutOptionStrikeResult {
  strikeIndex: number; // 0..4
  label: string; // ATM, 25% RV OTM, etc.
  rvMultiple: number; // 0, 0.25, 0.5, 0.75, 1.0
  strikePriceUsd: number;
  contractQtyBtc: number; // Q / 5
  unitPutPriceUsd: number;
  premiumUsd: number;
  expiryPayoffUsd: number | null;
  netProfitUsd: number | null;
  roiPct: number | null;
  finishedItm: boolean | null;
}

export interface PutPayoffCurvePoint {
  btcPriceUsd: number;
  grossPayoffUsd: number;
  netProfitUsd: number;
}

export interface PutOptionCycleResult {
  status: PutOptionStatus;
  statusLabel: string;
  /** Explicit disclosure that Q uses same-cycle Strategy 1 final BTC */
  isExPostNormalizedQuantity: boolean;
  exPostQuantityNote: string;
  entryDate: string;
  expiryDate: string;
  entrySpotUsd: number | null;
  expirySpotUsd: number | null;
  /** 30-day daily log-return realized volatility annualized by sqrt(365) */
  rv30dAnnualized: number | null;
  /** IV = RV (annualized decimal, e.g. 0.65 = 65%) */
  ivAnnualized: number | null;
  /** Fixed 4% risk-free rate */
  riskFreeRate: number;
  tenorYears: number;
  totalContractQtyBtc: number;
  strikeCount: number;
  strikes: PutOptionStrikeResult[];
  totalPremiumUsd: number | null;
  totalPayoffUsd: number | null;
  netProfitUsd: number | null;
  roiPct: number | null;
  payoffCurve: PutPayoffCurvePoint[];
}

export interface IntegratedCycleComparison {
  isExPostNormalizedQuantity: boolean;
  /** Spot totalInvested + Option totalPremium (or Spot only if option not yet priced) */
  combinedCostBasisUsd: number;
  spotNetProfitUsd: number;
  optionNetProfitUsd: number | null;
  combinedNetProfitUsd: number | null;
  combinedRoiPct: number | null;
  spotContributionUsd: number;
  optionContributionUsd: number | null;
}

export interface HalvingCycleBacktest {
  schedule: HalvingSchedule;
  spotDca: SpotDcaCycleResult;
  putOption: PutOptionCycleResult;
  integrated: IntegratedCycleComparison;
  priceContextSeries: DailyPriceRow[];
}

export interface RealTestSuiteResult {
  datasetStartDate: string;
  datasetEndDate: string;
  totalDailyRows: number;
  liveSpotUsd: number | null;
  inputs: RealTestInputs;
  cycles: HalvingCycleBacktest[];
}
