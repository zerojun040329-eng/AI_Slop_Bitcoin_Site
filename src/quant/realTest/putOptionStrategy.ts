import type {
  DailyPriceRow,
  HalvingSchedule,
  PutOptionCycleResult,
  PutOptionStatus,
  PutOptionStrikeResult,
  PutPayoffCurvePoint,
} from '../../types/realTest';
import { addCalendarDaysUtc } from './halvingSchedule';

export const PUT_RISK_FREE_RATE = 0.04; // Fixed 4% continuously compounded annualized
export const PUT_DIVIDEND_YIELD = 0;
export const PUT_TENOR_YEARS = 1; // 365 calendar days / 365
export const RV_LOOKBACK_RETURNS = 30; // Requires 31 daily closes ending on entryDate
export const ANNUALIZATION_DAYS = 365;

const STRIKE_SPECS: readonly { rvMultiple: number; label: string }[] = [
  { rvMultiple: 0.0, label: 'ATM (0% RV)' },
  { rvMultiple: 0.25, label: '25% RV OTM' },
  { rvMultiple: 0.5, label: '50% RV OTM' },
  { rvMultiple: 0.75, label: '75% RV OTM' },
  { rvMultiple: 1.0, label: '100% RV OTM' },
];

/**
 * High-precision standard normal CDF via Abramowitz & Stegun erf approximation (error < 1.5e-7)
 */
export function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * absX);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t) *
      Math.exp(-absX * absX);
  return 0.5 * (1 + sign * y);
}

/**
 * European Black-Scholes Put Option Price
 * Put = K * exp(-rT) * N(-d2) - S * exp(-qT) * N(-d1)
 */
export function priceEuropeanPutBlackScholes(
  spotS: number,
  strikeK: number,
  tenorT: number,
  rateR: number,
  dividendQ: number,
  volatilitySigma: number,
): number {
  if (spotS <= 0 || strikeK <= 0) return 0;
  if (tenorT <= 0) return Math.max(strikeK - spotS, 0);
  if (volatilitySigma <= 0) {
    return Math.max(strikeK * Math.exp(-rateR * tenorT) - spotS * Math.exp(-dividendQ * tenorT), 0);
  }

  const sqrtT = Math.sqrt(tenorT);
  const volSqrtT = volatilitySigma * sqrtT;
  const d1 =
    (Math.log(spotS / strikeK) + (rateR - dividendQ + 0.5 * volatilitySigma * volatilitySigma) * tenorT) /
    volSqrtT;
  const d2 = d1 - volSqrtT;

  return (
    strikeK * Math.exp(-rateR * tenorT) * normCdf(-d2) -
    spotS * Math.exp(-dividendQ * tenorT) * normCdf(-d1)
  );
}

/**
 * Causal 30-day Realized Volatility strictly using daily closes <= entryDate (zero lookahead).
 * Requires 31 consecutive UTC daily closes (30 daily log returns r_t = ln(C_t / C_{t-1})),
 * sample standard deviation (ddof = 1), annualized with sqrt(365).
 */
export function computeCausal30DayRv(
  sortedDailyRows: readonly DailyPriceRow[],
  entryDate: string,
): { rvAnnualized: number; entrySpotUsd: number; windowStartDate: string } | null {
  const entryIndex = sortedDailyRows.findIndex((r) => r.date === entryDate);
  if (entryIndex < RV_LOOKBACK_RETURNS) {
    return null;
  }

  const windowSlice = sortedDailyRows.slice(entryIndex - RV_LOOKBACK_RETURNS, entryIndex + 1);
  if (windowSlice.length !== RV_LOOKBACK_RETURNS + 1) {
    return null;
  }

  // Strictly enforce causal chronological order with consecutive UTC calendar days & zero future dates
  for (let i = 0; i < windowSlice.length; i++) {
    const row = windowSlice[i];
    if (row.date > entryDate || !Number.isFinite(row.priceUsd) || row.priceUsd <= 0) {
      return null;
    }
    if (i > 0) {
      const expectedDate = addCalendarDaysUtc(windowSlice[i - 1].date, 1);
      if (row.date !== expectedDate) {
        return null;
      }
    }
  }

  const logReturns: number[] = [];
  for (let i = 1; i < windowSlice.length; i++) {
    logReturns.push(Math.log(windowSlice[i].priceUsd / windowSlice[i - 1].priceUsd));
  }

  const n = logReturns.length; // 30
  if (n !== RV_LOOKBACK_RETURNS) return null;

  const mean = logReturns.reduce((acc, v) => acc + v, 0) / n;
  let sumSq = 0;
  for (const r of logReturns) {
    const diff = r - mean;
    sumSq += diff * diff;
  }
  const sampleVariance = sumSq / (n - 1); // ddof = 1
  const dailyStd = Math.sqrt(sampleVariance);
  const rvAnnualized = dailyStd * Math.sqrt(ANNUALIZATION_DAYS);

  if (!Number.isFinite(rvAnnualized) || rvAnnualized <= 0) {
    return null;
  }

  return {
    rvAnnualized,
    entrySpotUsd: windowSlice[windowSlice.length - 1].priceUsd,
    windowStartDate: windowSlice[0].date,
  };
}

function buildPayoffCurve(
  entrySpotUsd: number,
  strikes: readonly PutOptionStrikeResult[],
  totalPremiumUsd: number,
): PutPayoffCurvePoint[] {
  if (entrySpotUsd <= 0 || strikes.length === 0) return [];
  const minP = Math.max(200, entrySpotUsd * 0.2);
  const maxP = entrySpotUsd * 1.55;
  const gridSet = new Set<number>();

  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    gridSet.add(minP + ((maxP - minP) * i) / steps);
  }
  gridSet.add(entrySpotUsd);
  for (const s of strikes) {
    if (s.strikePriceUsd >= minP && s.strikePriceUsd <= maxP) {
      gridSet.add(s.strikePriceUsd);
    }
  }

  const prices = Array.from(gridSet).sort((a, b) => a - b);
  return prices.map((btcPriceUsd) => {
    let grossPayoffUsd = 0;
    for (const s of strikes) {
      grossPayoffUsd += s.contractQtyBtc * Math.max(s.strikePriceUsd - btcPriceUsd, 0);
    }
    return {
      btcPriceUsd,
      grossPayoffUsd,
      netProfitUsd: grossPayoffUsd - totalPremiumUsd,
    };
  });
}

/**
 * Strategy 2: Halving + 18M Long 1-Year (365d) 5-Strike European Put Portfolio
 * - Quantity Q equals same-cycle Strategy 1 final BTC (ex-post normalized quantity).
 * - Equal BTC contract quantity Q/5 per strike across 5 strikes: 0%, 25%, 50%, 75%, 100% RV OTM.
 * - Fixed r = 0.04, q = 0, T = 1, IV = RV (30d daily log-return RV, zero lookahead).
 */
export function runPutOptionStrategy(
  schedule: HalvingSchedule,
  sortedDailyRows: readonly DailyPriceRow[],
  priceByDate: ReadonlyMap<string, number>,
  latestDataDate: string,
  normalizedTotalQtyBtc: number,
  todayUtcIso: string = new Date().toISOString().slice(0, 10),
): PutOptionCycleResult {
  const entryDate = schedule.optionEntryDate;
  const expiryDate = schedule.optionExpiryDate;
  const safeQty =
    Number.isFinite(normalizedTotalQtyBtc) && normalizedTotalQtyBtc > 0
      ? normalizedTotalQtyBtc
      : 0;
  const exPostQuantityNote =
    '사후 정규화 수량: 본 전략(+18M)의 풋옵션 총 계약 수량 Q는 동일 사이클 전략 1(+24~36M)의 최종 누적 매수 BTC 수량을 사후 기준으로 동일 적용했습니다.';

  if (!latestDataDate || entryDate > latestDataDate) {
    return {
      status: 'not_entered',
      statusLabel: '진입일 미도래',
      isExPostNormalizedQuantity: true,
      exPostQuantityNote,
      entryDate,
      expiryDate,
      entrySpotUsd: null,
      expirySpotUsd: null,
      rv30dAnnualized: null,
      ivAnnualized: null,
      riskFreeRate: PUT_RISK_FREE_RATE,
      tenorYears: PUT_TENOR_YEARS,
      totalContractQtyBtc: safeQty,
      strikeCount: STRIKE_SPECS.length,
      strikes: [],
      totalPremiumUsd: null,
      totalPayoffUsd: null,
      netProfitUsd: null,
      roiPct: null,
      payoffCurve: [],
    };
  }

  const rvCalc = computeCausal30DayRv(sortedDailyRows, entryDate);
  if (!rvCalc) {
    return {
      status: 'insufficient_data',
      statusLabel: '데이터 부족 (미계산)',
      isExPostNormalizedQuantity: true,
      exPostQuantityNote,
      entryDate,
      expiryDate,
      entrySpotUsd: priceByDate.get(entryDate) ?? null,
      expirySpotUsd: null,
      rv30dAnnualized: null,
      ivAnnualized: null,
      riskFreeRate: PUT_RISK_FREE_RATE,
      tenorYears: PUT_TENOR_YEARS,
      totalContractQtyBtc: safeQty,
      strikeCount: STRIKE_SPECS.length,
      strikes: [],
      totalPremiumUsd: null,
      totalPayoffUsd: null,
      netProfitUsd: null,
      roiPct: null,
      payoffCurve: [],
    };
  }

  const { rvAnnualized, entrySpotUsd } = rvCalc;
  const ivAnnualized = rvAnnualized;
  const qtyPerStrike = safeQty / STRIKE_SPECS.length;

  const isFutureExpiry = expiryDate > latestDataDate && expiryDate >= todayUtcIso;
  const expiryPrice = expiryDate <= latestDataDate ? priceByDate.get(expiryDate) ?? null : null;

  let status: PutOptionStatus;
  let statusLabel: string;

  if (expiryDate > latestDataDate) {
    status = isFutureExpiry ? 'unmatured' : 'insufficient_data';
    statusLabel = isFutureExpiry ? '만기 미도래' : '만기 데이터 부족 (미계산)';
  } else if (expiryPrice === null || !Number.isFinite(expiryPrice) || expiryPrice <= 0) {
    status = 'insufficient_data';
    statusLabel = '만기 데이터 부족 (미계산)';
  } else {
    status = 'completed';
    statusLabel = '만기 정산 완료';
  }

  let totalPremiumUsd = 0;
  let totalPayoffUsd = 0;

  const strikes: PutOptionStrikeResult[] = STRIKE_SPECS.map((spec, strikeIndex) => {
    const strikePriceUsd =
      entrySpotUsd * Math.exp(-spec.rvMultiple * rvAnnualized * Math.sqrt(PUT_TENOR_YEARS));
    const unitPutPriceUsd = priceEuropeanPutBlackScholes(
      entrySpotUsd,
      strikePriceUsd,
      PUT_TENOR_YEARS,
      PUT_RISK_FREE_RATE,
      PUT_DIVIDEND_YIELD,
      ivAnnualized,
    );
    const premiumUsd = unitPutPriceUsd * qtyPerStrike;
    totalPremiumUsd += premiumUsd;

    if (status === 'completed' && expiryPrice !== null) {
      const expiryPayoffUsd = qtyPerStrike * Math.max(strikePriceUsd - expiryPrice, 0);
      const netProfitUsd = expiryPayoffUsd - premiumUsd;
      const roiPct = premiumUsd > 0 ? (netProfitUsd / premiumUsd) * 100 : 0;
      totalPayoffUsd += expiryPayoffUsd;
      return {
        strikeIndex,
        label: spec.label,
        rvMultiple: spec.rvMultiple,
        strikePriceUsd,
        contractQtyBtc: qtyPerStrike,
        unitPutPriceUsd,
        premiumUsd,
        expiryPayoffUsd,
        netProfitUsd,
        roiPct,
        finishedItm: expiryPrice < strikePriceUsd,
      };
    }

    return {
      strikeIndex,
      label: spec.label,
      rvMultiple: spec.rvMultiple,
      strikePriceUsd,
      contractQtyBtc: qtyPerStrike,
      unitPutPriceUsd,
      premiumUsd,
      expiryPayoffUsd: null,
      netProfitUsd: null,
      roiPct: null,
      finishedItm: null,
    };
  });

  const payoffCurve = buildPayoffCurve(entrySpotUsd, strikes, totalPremiumUsd);

  if (status === 'completed') {
    const netProfitUsd = totalPayoffUsd - totalPremiumUsd;
    const roiPct = totalPremiumUsd > 0 ? (netProfitUsd / totalPremiumUsd) * 100 : null;
    return {
      status,
      statusLabel,
      isExPostNormalizedQuantity: true,
      exPostQuantityNote,
      entryDate,
      expiryDate,
      entrySpotUsd,
      expirySpotUsd: expiryPrice,
      rv30dAnnualized: rvAnnualized,
      ivAnnualized,
      riskFreeRate: PUT_RISK_FREE_RATE,
      tenorYears: PUT_TENOR_YEARS,
      totalContractQtyBtc: safeQty,
      strikeCount: STRIKE_SPECS.length,
      strikes,
      totalPremiumUsd,
      totalPayoffUsd,
      netProfitUsd,
      roiPct,
      payoffCurve,
    };
  }

  return {
    status,
    statusLabel,
    isExPostNormalizedQuantity: true,
    exPostQuantityNote,
    entryDate,
    expiryDate,
    entrySpotUsd,
    expirySpotUsd: null,
    rv30dAnnualized: rvAnnualized,
    ivAnnualized,
    riskFreeRate: PUT_RISK_FREE_RATE,
    tenorYears: PUT_TENOR_YEARS,
    totalContractQtyBtc: safeQty,
    strikeCount: STRIKE_SPECS.length,
    strikes,
    totalPremiumUsd,
    totalPayoffUsd: null,
    netProfitUsd: null,
    roiPct: null,
    payoffCurve,
  };
}
