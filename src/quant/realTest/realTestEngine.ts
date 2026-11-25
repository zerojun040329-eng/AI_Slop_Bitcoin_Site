import type { LongTermHistoryResponse } from '../../api/marketApi';
import type {
  DailyPriceRow,
  HalvingCycleBacktest,
  IntegratedCycleComparison,
  RealTestInputs,
  RealTestSuiteResult,
} from '../../types/realTest';
import { buildHalvingSchedules } from './halvingSchedule';
import { runPutOptionStrategy } from './putOptionStrategy';
import { extractCyclePriceContext, runSpotDcaStrategy } from './spotDcaStrategy';

export const REAL_TEST_START_DATE = '2015-01-01';

/**
 * Normalizes raw `/api/long-term/history` daily rows to UTC >= 2015-01-01, deduplicated & ascending.
 * Pure transformation over the existing Long-Term Dashboard daily series (zero duplicate fetching).
 */
export function normalizeDailyRowsFrom2015(
  history: LongTermHistoryResponse['history'],
): DailyPriceRow[] {
  const dedup = new Map<string, number>();
  for (const row of history) {
    if (!row || typeof row.date !== 'string' || row.date < REAL_TEST_START_DATE) {
      continue;
    }
    if (!Number.isFinite(row.priceUsd) || row.priceUsd <= 0) {
      continue;
    }
    dedup.set(row.date, row.priceUsd);
  }

  return Array.from(dedup.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, priceUsd]) => ({ date, priceUsd }));
}

export function runRealTestSuite(
  rawHistory: LongTermHistoryResponse['history'],
  liveSpotUsd: number | null,
  inputs: RealTestInputs,
  todayUtcIso: string = new Date().toISOString().slice(0, 10),
): RealTestSuiteResult {
  const dailyRows = normalizeDailyRowsFrom2015(rawHistory);
  if (dailyRows.length === 0) {
    throw new Error('2015년 이후 BTC 일봉 종가 데이터를 찾을 수 없습니다.');
  }

  const priceByDate = new Map<string, number>();
  for (const r of dailyRows) {
    priceByDate.set(r.date, r.priceUsd);
  }

  const datasetStartDate = dailyRows[0].date;
  const datasetEndDate = dailyRows[dailyRows.length - 1].date;
  const schedules = buildHalvingSchedules();

  const cycles: HalvingCycleBacktest[] = schedules.map((schedule) => {
    const spotDca = runSpotDcaStrategy(
      schedule,
      priceByDate,
      datasetEndDate,
      liveSpotUsd,
      inputs.totalBudgetUsd,
      inputs.feeRatePct,
    );

    const putOption = runPutOptionStrategy(
      schedule,
      dailyRows,
      priceByDate,
      datasetEndDate,
      spotDca.totalBtc,
      todayUtcIso,
    );

    const optionCompleted = putOption.status === 'completed' && putOption.netProfitUsd !== null;
    const optionPremium = putOption.totalPremiumUsd ?? 0;
    const combinedCostBasisUsd = spotDca.totalInvestedUsd + optionPremium;
    const optionNetProfitUsd = optionCompleted ? putOption.netProfitUsd : null;
    const combinedNetProfitUsd =
      optionNetProfitUsd !== null ? spotDca.netProfitUsd + optionNetProfitUsd : null;
    const combinedRoiPct =
      combinedNetProfitUsd !== null && combinedCostBasisUsd > 0
        ? (combinedNetProfitUsd / combinedCostBasisUsd) * 100
        : null;

    const integrated: IntegratedCycleComparison = {
      isExPostNormalizedQuantity: true,
      combinedCostBasisUsd,
      spotNetProfitUsd: spotDca.netProfitUsd,
      optionNetProfitUsd,
      combinedNetProfitUsd,
      combinedRoiPct,
      spotContributionUsd: spotDca.netProfitUsd,
      optionContributionUsd: optionNetProfitUsd,
    };

    const priceContextSeries = extractCyclePriceContext(dailyRows, schedule);

    return {
      schedule,
      spotDca,
      putOption,
      integrated,
      priceContextSeries,
    };
  });

  return {
    datasetStartDate,
    datasetEndDate,
    totalDailyRows: dailyRows.length,
    liveSpotUsd,
    inputs,
    cycles,
  };
}
