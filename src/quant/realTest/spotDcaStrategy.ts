import type {
  DailyPriceRow,
  HalvingSchedule,
  SpotDcaCycleResult,
  SpotDcaDailyExecution,
  SpotDcaStatus,
} from '../../types/realTest';
import { enumerateUtcDates } from './halvingSchedule';

/**
 * Strategy 1: Halving + 24~36M Daily Equal-Amount BTC Spot DCA
 * - Buys at UTC 00:00 daily close (`priceUsd`) over [dcaStartDate, dcaEndExclusiveDate).
 * - Never sells accumulated BTC.
 * - For ongoing windows, only executes days <= latestDataDate and never includes future planned cash.
 */
export function runSpotDcaStrategy(
  schedule: HalvingSchedule,
  priceByDate: ReadonlyMap<string, number>,
  latestDataDate: string,
  liveSpotUsd: number | null,
  totalBudgetUsd: number,
  feeRatePct: number,
): SpotDcaCycleResult {
  const scheduledDates = enumerateUtcDates(schedule.dcaStartDate, schedule.dcaEndExclusiveDate);
  const scheduledDays = scheduledDates.length;
  const safeBudget = Number.isFinite(totalBudgetUsd) && totalBudgetUsd > 0 ? totalBudgetUsd : 0;
  const safeFeePct = Number.isFinite(feeRatePct) && feeRatePct >= 0 ? Math.min(feeRatePct, 10) : 0;
  const feeFraction = safeFeePct / 100;
  const dailyInvestmentGrossUsd = scheduledDays > 0 ? safeBudget / scheduledDays : 0;

  const executionRuleLabel = '매일 UTC 00:00 일봉 종가 기준 동일 금액 현물 매수 (매도 없음)';

  if (scheduledDays === 0 || !latestDataDate) {
    return {
      status: 'insufficient_data',
      statusLabel: '데이터 부족',
      executionRuleLabel,
      scheduledDays,
      executedDays: 0,
      remainingDays: scheduledDays,
      missingDataDays: 0,
      progressPct: 0,
      plannedTotalBudgetUsd: safeBudget,
      dailyInvestmentGrossUsd,
      feeRatePct: safeFeePct,
      totalInvestedUsd: 0,
      totalFeeUsd: 0,
      netCapitalAllocatedUsd: 0,
      totalBtc: 0,
      averageEntryPriceUsd: null,
      evaluationPriceUsd: null,
      evaluationDate: null,
      evaluationPriceSource: null,
      portfolioValueUsd: 0,
      netProfitUsd: 0,
      roiPct: null,
      valueAtWindowEndUsd: null,
      windowEndPriceUsd: null,
      executions: [],
    };
  }

  if (latestDataDate < schedule.dcaStartDate) {
    return {
      status: 'not_started',
      statusLabel: '매집 미개시',
      executionRuleLabel,
      scheduledDays,
      executedDays: 0,
      remainingDays: scheduledDays,
      missingDataDays: 0,
      progressPct: 0,
      plannedTotalBudgetUsd: safeBudget,
      dailyInvestmentGrossUsd,
      feeRatePct: safeFeePct,
      totalInvestedUsd: 0,
      totalFeeUsd: 0,
      netCapitalAllocatedUsd: 0,
      totalBtc: 0,
      averageEntryPriceUsd: null,
      evaluationPriceUsd: liveSpotUsd ?? priceByDate.get(latestDataDate) ?? null,
      evaluationDate: latestDataDate,
      evaluationPriceSource: liveSpotUsd ? 'live_spot' : 'daily_close',
      portfolioValueUsd: 0,
      netProfitUsd: 0,
      roiPct: null,
      valueAtWindowEndUsd: null,
      windowEndPriceUsd: null,
      executions: [],
    };
  }

  let cumulativeGrossInvestedUsd = 0;
  let cumulativeFeeUsd = 0;
  let cumulativeNetCapitalUsd = 0;
  let cumulativeBtc = 0;
  let missingDataDays = 0;
  let remainingDays = 0;
  let lastWindowPrice: number | null = null;
  const executions: SpotDcaDailyExecution[] = [];

  for (let i = 0; i < scheduledDates.length; i++) {
    const date = scheduledDates[i];
    if (date > latestDataDate) {
      remainingDays++;
      continue;
    }

    const priceUsd = priceByDate.get(date);
    if (priceUsd === undefined || !Number.isFinite(priceUsd) || priceUsd <= 0) {
      missingDataDays++;
      continue;
    }

    lastWindowPrice = priceUsd;
    const grossInvestedUsd = dailyInvestmentGrossUsd;
    const feeUsd = grossInvestedUsd * feeFraction;
    const netCapitalUsd = grossInvestedUsd - feeUsd;
    const btcBought = netCapitalUsd / priceUsd;

    cumulativeGrossInvestedUsd += grossInvestedUsd;
    cumulativeFeeUsd += feeUsd;
    cumulativeNetCapitalUsd += netCapitalUsd;
    cumulativeBtc += btcBought;

    const averageEntryPriceUsd = cumulativeBtc > 0 ? cumulativeGrossInvestedUsd / cumulativeBtc : 0;
    const portfolioValueUsd = cumulativeBtc * priceUsd;

    executions.push({
      date,
      dayIndex: executions.length + 1,
      priceUsd,
      grossInvestedUsd,
      feeUsd,
      netCapitalUsd,
      btcBought,
      cumulativeGrossInvestedUsd,
      cumulativeFeeUsd,
      cumulativeBtc,
      averageEntryPriceUsd,
      portfolioValueUsd,
    });
  }

  const executedDays = executions.length;
  const isOngoing = latestDataDate < schedule.dcaLastScheduledBuyDate;
  let status: SpotDcaStatus;
  let statusLabel: string;

  if (executedDays === 0) {
    status = 'insufficient_data';
    statusLabel = '데이터 부족';
  } else if (isOngoing) {
    status = 'ongoing';
    statusLabel = '매집 진행 중';
  } else {
    status = 'completed';
    statusLabel = '매집 완료 (보유)';
  }

  const latestClose = priceByDate.get(latestDataDate) ?? lastWindowPrice;
  const useLiveSpot = liveSpotUsd !== null && Number.isFinite(liveSpotUsd) && liveSpotUsd > 0;
  const evaluationPriceUsd = useLiveSpot ? liveSpotUsd : latestClose ?? null;
  const evaluationPriceSource =
    evaluationPriceUsd === null ? null : useLiveSpot ? 'live_spot' : 'daily_close';

  const averageEntryPriceUsd =
    cumulativeBtc > 0 ? cumulativeGrossInvestedUsd / cumulativeBtc : null;
  const portfolioValueUsd =
    evaluationPriceUsd !== null ? cumulativeBtc * evaluationPriceUsd : 0;
  const netProfitUsd = portfolioValueUsd - cumulativeGrossInvestedUsd;
  const roiPct =
    cumulativeGrossInvestedUsd > 0 ? (netProfitUsd / cumulativeGrossInvestedUsd) * 100 : null;

  const valueAtWindowEndUsd =
    lastWindowPrice !== null ? cumulativeBtc * lastWindowPrice : null;
  const progressPct = scheduledDays > 0 ? (executedDays / scheduledDays) * 100 : 0;

  return {
    status,
    statusLabel,
    executionRuleLabel,
    scheduledDays,
    executedDays,
    remainingDays,
    missingDataDays,
    progressPct,
    plannedTotalBudgetUsd: safeBudget,
    dailyInvestmentGrossUsd,
    feeRatePct: safeFeePct,
    totalInvestedUsd: cumulativeGrossInvestedUsd,
    totalFeeUsd: cumulativeFeeUsd,
    netCapitalAllocatedUsd: cumulativeNetCapitalUsd,
    totalBtc: cumulativeBtc,
    averageEntryPriceUsd,
    evaluationPriceUsd,
    evaluationDate: latestDataDate,
    evaluationPriceSource,
    portfolioValueUsd,
    netProfitUsd,
    roiPct,
    valueAtWindowEndUsd,
    windowEndPriceUsd: lastWindowPrice,
    executions,
  };
}

export function extractCyclePriceContext(
  rows: readonly DailyPriceRow[],
  schedule: HalvingSchedule,
): DailyPriceRow[] {
  const startContextDate = schedule.halvingDate;
  return rows.filter((r) => r.date >= startContextDate && r.date <= schedule.dcaLastScheduledBuyDate);
}
