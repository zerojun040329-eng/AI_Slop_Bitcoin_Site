import {
  addCalendarDaysUtc,
  addCalendarMonthsUtc,
  buildHalvingSchedules,
  enumerateUtcDates,
} from './halvingSchedule.ts';
import {
  computeCausal30DayRv,
  normCdf,
  priceEuropeanPutBlackScholes,
  PUT_RISK_FREE_RATE,
  runPutOptionStrategy,
} from './putOptionStrategy.ts';
import { normalizeDailyRowsFrom2015, runRealTestSuite } from './realTestEngine.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function assertClose(actual: number, expected: number, tol: number, message: string): void {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(
      `ASSERTION FAILED (${message}): expected ${expected} ± ${tol}, got ${actual}`,
    );
  }
}

function buildSyntheticDailyHistory(
  startIso: string,
  endIso: string,
  priceFn: (dateIso: string, idx: number) => number,
) {
  const dates = enumerateUtcDates(startIso, addCalendarDaysUtc(endIso, 1));
  return dates.map((date, idx) => ({
    date,
    priceUsd: priceFn(date, idx),
    hashrateEh: null,
    blockCount: null,
  }));
}

function runAllTests(): void {
  // 1. 2015+ filtering & deduplication & ascending order
  const rawWithPre2015 = [
    { date: '2014-12-31', priceUsd: 315, hashrateEh: null, blockCount: null },
    { date: '2015-01-02', priceUsd: 316, hashrateEh: null, blockCount: null },
    { date: '2015-01-01', priceUsd: 314, hashrateEh: null, blockCount: null },
    { date: '2015-01-02', priceUsd: 318, hashrateEh: null, blockCount: null }, // dedup latest
  ];
  const filtered = normalizeDailyRowsFrom2015(rawWithPre2015);
  assert(filtered.length === 2, 'Check 1: pre-2015 excluded & duplicates collapsed');
  assert(filtered[0].date === '2015-01-01' && filtered[1].date === '2015-01-02', 'Check 1: UTC sorted');
  assert(filtered[1].priceUsd === 318, 'Check 1: deduplication keeps valid price');

  // 2. Halving calendar calculations (+18M, +365d, +24M, +36M)
  const schedules = buildHalvingSchedules();
  assert(schedules.length === 3, 'Check 2: strictly 2016, 2020, 2024 halving cycles');
  assert(schedules[0].halvingDate === '2016-07-09', 'Check 2: 2016 halving');
  assert(schedules[0].optionEntryDate === '2018-01-09', 'Check 2: 2016 +18M');
  assert(schedules[0].optionExpiryDate === '2019-01-09', 'Check 2: 2016 +18M +365d');
  assert(schedules[0].dcaStartDate === '2018-07-09', 'Check 2: 2016 +24M');
  assert(schedules[0].dcaLastScheduledBuyDate === '2019-07-08', 'Check 2: 2016 +36M end');
  assert(schedules[1].optionEntryDate === '2021-11-11', 'Check 2: 2020 +18M');
  assert(schedules[1].optionExpiryDate === '2022-11-11', 'Check 2: 2020 +365d');
  assert(schedules[2].optionEntryDate === '2025-10-20', 'Check 2: 2024 +18M');
  assert(schedules[2].optionExpiryDate === '2026-10-20', 'Check 2: 2024 +365d');
  assert(addCalendarMonthsUtc('2024-01-31', 1) === '2024-02-29', 'Check 2: month-end leap clamp');

  // 3. Normal CDF & Black-Scholes Put numerical accuracy against textbook reference
  // S=100, K=100, T=1, r=0.04, q=0, sigma=0.50:
  // d1 = (0 + (0.04 + 0.125))/0.5 = 0.33; d2 = -0.17
  // N(-0.33)=0.370700, N(0.17)=0.567495
  // P = 100*exp(-0.04)*0.567495 - 100*0.370700 ≈ 54.5243 - 37.0700 = 17.4543
  assertClose(normCdf(0), 0.5, 1e-7, 'Check 3: normCdf(0)');
  const bsPutRef = priceEuropeanPutBlackScholes(100, 100, 1, 0.04, 0, 0.5);
  assertClose(bsPutRef, 17.4543, 0.01, 'Check 3: Black-Scholes European Put reference');

  // 4. Causal 30-day RV with ddof=1 and sqrt(365), ZERO future lookahead
  const seriesA = buildSyntheticDailyHistory('2017-12-01', '2018-02-01', (_d, idx) => {
    // Alternating +-2% log steps up to entryDate (2018-01-09), then huge 500% crash AFTER entryDate
    if (_d > '2018-01-09') return 100;
    return 10000 * Math.exp((idx % 2 === 0 ? 1 : -1) * 0.01);
  });
  const seriesB = buildSyntheticDailyHistory('2017-12-01', '2018-02-01', (_d, idx) => {
    // Same up to 2018-01-09, wildly different after
    if (_d > '2018-01-09') return 999999;
    return 10000 * Math.exp((idx % 2 === 0 ? 1 : -1) * 0.01);
  });
  const normA = normalizeDailyRowsFrom2015(seriesA);
  const normB = normalizeDailyRowsFrom2015(seriesB);
  const rvA = computeCausal30DayRv(normA, '2018-01-09');
  const rvB = computeCausal30DayRv(normB, '2018-01-09');
  assert(rvA !== null && rvB !== null, 'Check 4: RV computed');
  assertClose(rvA.rvAnnualized, rvB.rvAnnualized, 1e-12, 'Check 4: Zero future lookahead');

  // Verify exact ddof=1 * sqrt(365) on known log returns (alternating +0.02, -0.02 -> 30 returns: 15 of +0.02, 15 of -0.02 -> mean=0, var = 30*(0.0004)/29)
  const exactExpectedStd = Math.sqrt((30 * 0.02 * 0.02) / 29);
  const exactExpectedRv = exactExpectedStd * Math.sqrt(365);
  assertClose(rvA.rvAnnualized, exactExpectedRv, 1e-10, 'Check 4: Exact ddof=1 & sqrt(365)');

  // 5. Strategy 1 Spot DCA + Strategy 2 Ex-Post Quantity Normalization & 5 Strikes & Expiry Payoff
  const full2016To2026 = buildSyntheticDailyHistory('2015-01-01', '2026-11-24', (date, idx) => {
    // Steady deterministic path with oscillation for positive RV; drop during 2018-2019 for ITM put test
    const base = date >= '2018-06-01' && date <= '2019-06-01' ? 4000 : 12000;
    return base * Math.exp((idx % 2 === 0 ? 1 : -1) * 0.015);
  });

  const suite = runRealTestSuite(
    full2016To2026,
    95000,
    { totalBudgetUsd: 36500, feeRatePct: 0.1 },
    '2026-11-25',
  );

  // Check 5a: 2016 Cycle Completed Spot DCA
  const c2016 = suite.cycles.find((c) => c.schedule.epoch === 2)!;
  assert(c2016.spotDca.status === 'completed', 'Check 5: 2016 Spot DCA completed');
  assert(c2016.spotDca.executedDays === 365, 'Check 5: 365 executed days');
  assertClose(c2016.spotDca.dailyInvestmentGrossUsd, 100, 1e-8, 'Check 5: Equal daily budget $100/day');
  assertClose(c2016.spotDca.totalInvestedUsd, 36500, 1e-6, 'Check 5: Total invested equals budget');
  assertClose(c2016.spotDca.totalFeeUsd, 36.5, 1e-6, 'Check 5: Fee 0.1% exact');

  // Check 5b: Strategy 2 Ex-Post Quantity Q == Strategy 1 TotalBTC and sum of 5 strike quantities == Q
  assert(c2016.putOption.isExPostNormalizedQuantity === true, 'Check 6: Ex-post flag true');
  assertClose(
    c2016.putOption.totalContractQtyBtc,
    c2016.spotDca.totalBtc,
    1e-12,
    'Check 6: Option Q equals Strategy 1 TotalBTC',
  );
  assert(c2016.putOption.strikes.length === 5, 'Check 6: Strictly 5 strikes');
  const sumStrikeQty = c2016.putOption.strikes.reduce((acc, s) => acc + s.contractQtyBtc, 0);
  assertClose(sumStrikeQty, c2016.spotDca.totalBtc, 1e-12, 'Check 6: Sum of 5 strike qty == Q');
  assert(c2016.putOption.riskFreeRate === PUT_RISK_FREE_RATE && PUT_RISK_FREE_RATE === 0.04, 'Check 6: r=0.04');
  assertClose(
    c2016.putOption.ivAnnualized!,
    c2016.putOption.rv30dAnnualized!,
    1e-12,
    'Check 6: IV == RV',
  );

  // Check 7: 5-strike formula K_j = S * exp(-j * RV * sqrt(1) / 4)
  for (let j = 0; j < 5; j++) {
    const expectedK =
      c2016.putOption.entrySpotUsd! * Math.exp((-j * c2016.putOption.rv30dAnnualized!) / 4);
    assertClose(
      c2016.putOption.strikes[j].strikePriceUsd,
      expectedK,
      1e-8,
      `Check 7: Strike K_${j} formula`,
    );
  }

  // Check 8: Expiry Payoff math (in 2016 synthetic series, S ~ 12000 at 2018-01-09 and ST ~ 4000 at 2019-01-09 -> ITM!)
  assert(c2016.putOption.status === 'completed', 'Check 8: 2016 Put Option matured & completed');
  const expectedPayoff = c2016.putOption.strikes.reduce(
    (acc, s) =>
      acc + s.contractQtyBtc * Math.max(s.strikePriceUsd - c2016.putOption.expirySpotUsd!, 0),
    0,
  );
  assertClose(c2016.putOption.totalPayoffUsd!, expectedPayoff, 1e-8, 'Check 8: Total payoff exact');
  assertClose(
    c2016.putOption.netProfitUsd!,
    expectedPayoff - c2016.putOption.totalPremiumUsd!,
    1e-8,
    'Check 8: Net profit = Payoff - Premium',
  );

  // Check 9: Ongoing 2024 DCA must NOT include future planned budget
  const c2024 = suite.cycles.find((c) => c.schedule.epoch === 4)!;
  assert(c2024.spotDca.status === 'ongoing', 'Check 9: 2024 DCA ongoing on 2026-11-24');
  assert(c2024.spotDca.executedDays < 365, 'Check 9: Executed days < 365');
  assertClose(
    c2024.spotDca.totalInvestedUsd,
    c2024.spotDca.executedDays * 100,
    1e-6,
    'Check 9: Ongoing invested excludes future planned cash',
  );

  // Check 10: Unmatured Put Option must NOT compute expiry payoff/ROI
  const partialUpTo2026Mid = buildSyntheticDailyHistory('2015-01-01', '2026-08-01', (_d, idx) =>
    50000 * Math.exp((idx % 2 === 0 ? 1 : -1) * 0.012),
  );
  const partialNorm = normalizeDailyRowsFrom2015(partialUpTo2026Mid);
  const partialMap = new Map(partialNorm.map((r) => [r.date, r.priceUsd]));
  const unmaturedPut = runPutOptionStrategy(
    schedules[2], // 2024 cycle: entry 2025-10-20, expiry 2026-10-20
    partialNorm,
    partialMap,
    '2026-08-01',
    1.5,
    '2026-08-02', // today before expiry
  );
  assert(unmaturedPut.status === 'unmatured', 'Check 10: Future expiry marked unmatured');
  assert(unmaturedPut.totalPayoffUsd === null && unmaturedPut.roiPct === null, 'Check 10: No payoff/ROI before maturity');

  // Check 11: Missing expiry data when expiry <= today marked insufficient_data
  const missingExpiryPut = runPutOptionStrategy(
    schedules[2],
    partialNorm,
    partialMap,
    '2026-08-01',
    1.5,
    '2026-11-25', // today after expiry, but dataset stops 2026-08-01
  );
  assert(missingExpiryPut.status === 'insufficient_data', 'Check 11: Missing past expiry marked insufficient_data');

  console.log('ALL REALTEST VERIFICATION CHECKS PASSED (11 suites / 14+ assertions)');
}

runAllTests();
