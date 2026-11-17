import type {
  HashratePoint,
  HistoricalPricePoint,
  MiningAssumptions,
  MiningEconomicsSummary,
  PowerLawBandTier,
  PowerLawEvaluation,
  PowerLawModelSummary,
} from '../types/longTerm';

export const GENESIS_DATE_ISO = '2009-01-03';
const GENESIS_UTC_MS = Date.UTC(2009, 0, 3);

/** Specified Power Law Trendline parameters: P = 3.096 * 10^-17 * d^5.690 */
export const POWER_LAW_COEFF_A = 3.096e-17;
export const POWER_LAW_EXPONENT_B = 5.690;

/** 9-step valuation bands centered around the Power Law trendline */
export const POWER_LAW_9_TIERS: PowerLawBandTier[] = [
  {
    id: 1,
    name: '1단계 · 극단적 저평가',
    shortName: '극단 저평가',
    sigmaMin: -2.25,
    sigmaMax: -1.75,
    color: '#1D4ED8',
    fillOpacity: 0.24,
  },
  {
    id: 2,
    name: '2단계 · 강한 저평가',
    shortName: '강한 저평가',
    sigmaMin: -1.75,
    sigmaMax: -1.25,
    color: '#2563EB',
    fillOpacity: 0.19,
  },
  {
    id: 3,
    name: '3단계 · 저평가 매집 구간',
    shortName: '매집 구간',
    sigmaMin: -1.25,
    sigmaMax: -0.75,
    color: '#0891B2',
    fillOpacity: 0.16,
  },
  {
    id: 4,
    name: '4단계 · 추세 하단 (완만 저평가)',
    shortName: '추세 하단',
    sigmaMin: -0.75,
    sigmaMax: -0.25,
    color: '#0D9488',
    fillOpacity: 0.14,
  },
  {
    id: 5,
    name: '5단계 · Power Law 공정가치',
    shortName: '공정가치',
    sigmaMin: -0.25,
    sigmaMax: 0.25,
    color: '#10B981',
    fillOpacity: 0.16,
  },
  {
    id: 6,
    name: '6단계 · 추세 상단 (완만 고평가)',
    shortName: '추세 상단',
    sigmaMin: 0.25,
    sigmaMax: 0.75,
    color: '#CA8A04',
    fillOpacity: 0.14,
  },
  {
    id: 7,
    name: '7단계 · 과열 경계 구간',
    shortName: '과열 경계',
    sigmaMin: 0.75,
    sigmaMax: 1.25,
    color: '#D97706',
    fillOpacity: 0.16,
  },
  {
    id: 8,
    name: '8단계 · 고평가 과열 구간',
    shortName: '고평가 과열',
    sigmaMin: 1.25,
    sigmaMax: 1.75,
    color: '#EA580C',
    fillOpacity: 0.19,
  },
  {
    id: 9,
    name: '9단계 · 극단적 버블 구간',
    shortName: '극단 버블',
    sigmaMin: 1.75,
    sigmaMax: 2.25,
    color: '#DC2626',
    fillOpacity: 0.24,
  },
];

export function daysSinceGenesisFromIso(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d);
  return Math.max(1, Math.round((utc - GENESIS_UTC_MS) / 86_400_000));
}

export function calculatePowerLawPrice(daysSinceGenesis: number): number {
  if (daysSinceGenesis <= 0) return 0;
  return POWER_LAW_COEFF_A * Math.pow(daysSinceGenesis, POWER_LAW_EXPONENT_B);
}

export function calculatePowerLawPriceAtSigma(
  daysSinceGenesis: number,
  sigmaLog10: number,
  sigmaMultiplier: number,
): number {
  const trend = calculatePowerLawPrice(daysSinceGenesis);
  return trend * Math.pow(10, sigmaMultiplier * sigmaLog10);
}

export function classifyPowerLawTier(zScore: number): PowerLawBandTier {
  for (const tier of POWER_LAW_9_TIERS) {
    if (zScore >= tier.sigmaMin && zScore < tier.sigmaMax) {
      return tier;
    }
  }
  return zScore < POWER_LAW_9_TIERS[0].sigmaMin
    ? POWER_LAW_9_TIERS[0]
    : POWER_LAW_9_TIERS[POWER_LAW_9_TIERS.length - 1];
}

export function evaluatePowerLawPoint(
  point: HistoricalPricePoint,
  sigmaLog10: number,
): PowerLawEvaluation {
  const trendPrice = calculatePowerLawPrice(point.daysSinceGenesis);
  const logResidual =
    point.close > 0 && trendPrice > 0 ? Math.log10(point.close) - Math.log10(trendPrice) : 0;
  const zScore = sigmaLog10 > 0 ? logResidual / sigmaLog10 : 0;
  const pctFromTrend = trendPrice > 0 ? (point.close - trendPrice) / trendPrice : 0;
  const ratioToTrend = trendPrice > 0 ? point.close / trendPrice : 1;

  return {
    date: point.date,
    daysSinceGenesis: point.daysSinceGenesis,
    price: point.close,
    trendPrice,
    pctFromTrend,
    ratioToTrend,
    logResidual,
    zScore,
    tier: classifyPowerLawTier(zScore),
  };
}

export function buildPowerLawSummary(history: HistoricalPricePoint[]): PowerLawModelSummary {
  // Compute empirical standard deviation of log10 residuals around P = 3.096e-17 * d^5.690
  const residuals: number[] = [];
  for (const pt of history) {
    const trend = calculatePowerLawPrice(pt.daysSinceGenesis);
    if (pt.close > 0 && trend > 0) {
      residuals.push(Math.log10(pt.close) - Math.log10(trend));
    }
  }

  let sqSum = 0;
  for (const r of residuals) {
    sqSum += r * r;
  }
  const sigmaLog10 =
    residuals.length > 1 ? Math.sqrt(sqSum / residuals.length) : 0.31;

  const latest = history[history.length - 1];
  const currentEval = evaluatePowerLawPoint(latest, sigmaLog10);

  return {
    coeffA: POWER_LAW_COEFF_A,
    exponentB: POWER_LAW_EXPONENT_B,
    sigmaLog10,
    tiers: POWER_LAW_9_TIERS,
    currentEval,
  };
}

/**
 * Adds exact calendar months to a UTC Date (clamping day-of-month if needed).
 */
export function addCalendarMonthsUtc(baseMs: number, months: number): number {
  const d = new Date(baseMs);
  const targetYear = d.getUTCFullYear();
  const targetMonth = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  const res = new Date(Date.UTC(targetYear, targetMonth, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const lastDayOfTargetMonth = new Date(Date.UTC(res.getUTCFullYear(), res.getUTCMonth() + 1, 0)).getUTCDate();
  res.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return res.getTime();
}

export interface CyclePhaseEvaluation {
  activePhase: 'bull' | 'bear';
  /** End timestamp (UTC ms) of the currently active bull window (next halving + 18m) */
  bullEndMs: number;
  /** Start timestamp (UTC ms) of bear window (halving + 18m) */
  bearStartMs: number;
  /** End timestamp (UTC ms) of bear window (halving + 30m) */
  bearEndMs: number;
  /** Next cycle halving reference used when computing post-bear bull phase */
  nextHalvingEstMs: number;
}

/**
 * Mutually exclusive historical cycle phase logic:
 * - Bear Phase: [lastHalving + 18 months, lastHalving + 30 months)
 * - Bull Phase: Complement of Bear Phase (never simultaneously active)
 *   - If before +18m of lastHalving: Bull runs until lastHalving + 18m
 *   - If after +30m of lastHalving: Bull runs until nextHalvingEst + 18m
 */
export function evaluateHalvingCyclePhase(
  nowMs: number,
  lastHalvingMs: number,
  estimatedCycleLengthMs: number,
): CyclePhaseEvaluation {
  // Determine which cycle epoch `nowMs` sits in relative to `lastHalvingMs`
  let cycleAnchorMs = lastHalvingMs;
  if (nowMs < cycleAnchorMs) {
    while (nowMs < cycleAnchorMs && estimatedCycleLengthMs > 0) {
      cycleAnchorMs -= estimatedCycleLengthMs;
    }
  } else {
    while (nowMs >= cycleAnchorMs + estimatedCycleLengthMs && estimatedCycleLengthMs > 0) {
      cycleAnchorMs += estimatedCycleLengthMs;
    }
  }

  const bearStartMs = addCalendarMonthsUtc(cycleAnchorMs, 18);
  const bearEndMs = addCalendarMonthsUtc(cycleAnchorMs, 30);
  const nextHalvingEstMs = cycleAnchorMs + estimatedCycleLengthMs;
  const nextBearStartMs = addCalendarMonthsUtc(nextHalvingEstMs, 18);

  if (nowMs >= bearStartMs && nowMs < bearEndMs) {
    return {
      activePhase: 'bear',
      bullEndMs: nextBearStartMs,
      bearStartMs,
      bearEndMs,
      nextHalvingEstMs,
    };
  }

  const bullEndMs = nowMs < bearStartMs ? bearStartMs : nextBearStartMs;
  return {
    activePhase: 'bull',
    bullEndMs,
    bearStartMs,
    bearEndMs,
    nextHalvingEstMs,
  };
}

/**
 * Computes Bitcoin mining economics from network hashrate, efficiency, electricity price, and block rewards.
 * Separates raw electricity-only cost from all-in operational cost, and computes both subsidy-only and
 * 24h fee-inclusive miner revenue / hashprice using real Mempool.space reward & fee telemetry.
 */
export function calculateMiningEconomics(
  currentSpotUsd: number,
  blockRewardBtc: number,
  avgTotalRewardPerBlockBtc: number,
  avgFeePerBlockBtc: number,
  hashrateHistory: HashratePoint[],
  assumptions: MiningAssumptions,
): MiningEconomicsSummary {
  const latest = hashrateHistory[hashrateHistory.length - 1] ?? {
    date: '',
    hashrateEh: 0,
    difficultyT: 0,
  };
  const currentHashrateEh = latest.hashrateEh;

  let currentDifficultyT = 0;
  for (let i = hashrateHistory.length - 1; i >= 0; i--) {
    const d = hashrateHistory[i].difficultyT;
    if (d !== null && Number.isFinite(d) && d > 0) {
      currentDifficultyT = d;
      break;
    }
  }

  let athHashrateEh = 0;
  let athHashrateDate = latest.date;
  for (const pt of hashrateHistory) {
    if (pt.hashrateEh >= athHashrateEh) {
      athHashrateEh = pt.hashrateEh;
      athHashrateDate = pt.date;
    }
  }

  const pt30dAgo = hashrateHistory[Math.max(0, hashrateHistory.length - 31)] ?? latest;
  const pt1yAgo = hashrateHistory[Math.max(0, hashrateHistory.length - 366)] ?? hashrateHistory[0] ?? latest;

  const hashrateChange30dPct =
    pt30dAgo.hashrateEh > 0 ? (currentHashrateEh - pt30dAgo.hashrateEh) / pt30dAgo.hashrateEh : 0;
  const hashrateChange1yPct =
    pt1yAgo.hashrateEh > 0 ? (currentHashrateEh - pt1yAgo.hashrateEh) / pt1yAgo.hashrateEh : 0;

  const dailyBlocksAvg = 144;
  const dailyNewIssuanceBtc = dailyBlocksAvg * blockRewardBtc;

  // Power formula:
  // 1 EH/s = 1,000,000 TH/s.
  // Watts = (Hashrate_TH) * (Efficiency J/TH).
  // Daily kWh = Watts * 24 / 1000.
  const hashrateTh = currentHashrateEh * 1_000_000;
  const totalPowerKw = (hashrateTh * assumptions.fleetEfficiencyJPerTh) / 1000;
  const dailyElectricityKwh = totalPowerKw * 24;
  const dailyElectricitySpendUsd = dailyElectricityKwh * assumptions.electricityUsdPerKwh;

  const electricityCostPerBtcUsd =
    dailyNewIssuanceBtc > 0 ? dailyElectricitySpendUsd / dailyNewIssuanceBtc : 0;
  const allInCostPerBtcUsd = electricityCostPerBtcUsd * assumptions.allInOpExMultiplier;

  const electricityDiffUsd = currentSpotUsd - electricityCostPerBtcUsd;
  const allInDiffUsd = currentSpotUsd - allInCostPerBtcUsd;

  // Miner Premium (%) = (Current BTC Price / Mining Cost per BTC - 1) * 100
  const electricityPremiumPct =
    electricityCostPerBtcUsd > 0 ? (currentSpotUsd / electricityCostPerBtcUsd - 1) * 100 : 0;
  const allInPremiumPct =
    allInCostPerBtcUsd > 0 ? (currentSpotUsd / allInCostPerBtcUsd - 1) * 100 : 0;

  const safeTotalReward =
    avgTotalRewardPerBlockBtc > 0 ? avgTotalRewardPerBlockBtc : blockRewardBtc + Math.max(0, avgFeePerBlockBtc);
  const dailySubsidyRevenueUsd = dailyNewIssuanceBtc * currentSpotUsd;
  const dailyTotalRevenueUsd = dailyBlocksAvg * safeTotalReward * currentSpotUsd;
  const subsidyHashpriceUsdPerThDay = hashrateTh > 0 ? dailySubsidyRevenueUsd / hashrateTh : 0;
  const totalHashpriceUsdPerThDay = hashrateTh > 0 ? dailyTotalRevenueUsd / hashrateTh : 0;

  return {
    currentSpotUsd,
    blockRewardBtc,
    avgFeePerBlockBtc,
    avgTotalRewardPerBlockBtc: safeTotalReward,
    dailyBlocksAvg,
    dailyNewIssuanceBtc,
    currentHashrateEh,
    athHashrateEh,
    athHashrateDate,
    hashrateChange30dPct,
    hashrateChange1yPct,
    currentDifficultyT,
    electricityCostPerBtcUsd,
    allInCostPerBtcUsd,
    electricityDiffUsd,
    allInDiffUsd,
    electricityPremiumPct,
    allInPremiumPct,
    historicalAvgPremiumPct: assumptions.historicalAvgPremiumPct,
    dailySubsidyRevenueUsd,
    dailyTotalRevenueUsd,
    totalHashpriceUsdPerThDay,
    subsidyHashpriceUsdPerThDay,
  };
}
