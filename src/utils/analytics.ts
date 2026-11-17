import type {
  ExpectedMovePoint,
  LiquidationBin,
  LiquidationSummary,
  MaturityMaxPainPoint,
  MaxPainAnalysis,
  MaxPainCurvePoint,
  OptionMaturityIV,
  OptionStrikeOI,
} from '../types/derivatives';

/**
 * Calculates option expected price range for a given maturity.
 * Formula: Expected Move ($) = Current Spot * Annualized IV * sqrt(DaysToExpiry / 365)
 */
export function calculateExpectedVolatilityMoves(
  currentPrice: number,
  maturities: OptionMaturityIV[],
): ExpectedMovePoint[] {
  return [...maturities]
    .filter((m) => m.daysToExpiry > 0 && m.daysToExpiry <= 365)
    .sort((a, b) => a.daysToExpiry - b.daysToExpiry)
    .map((m) => {
      const timeFactor = Math.sqrt(m.daysToExpiry / 365);
      const expectedMovePct = m.atmIv * timeFactor;
      const expectedMoveUsd = currentPrice * expectedMovePct;

      return {
        tenor: m.tenor,
        expiryDate: m.expiryDate,
        daysToExpiry: m.daysToExpiry,
        atmIv: m.atmIv,
        callIv: m.callIv,
        putIv: m.putIv,
        ivSource: m.ivSource,
        tenorOiBtc: m.tenorOiBtc,
        expectedMoveUsd,
        expectedMovePct,
        upper1Sigma: currentPrice + expectedMoveUsd,
        lower1Sigma: Math.max(0, currentPrice - expectedMoveUsd),
        upperHalfSigma: currentPrice + expectedMoveUsd * 0.5,
        lowerHalfSigma: Math.max(0, currentPrice - expectedMoveUsd * 0.5),
      };
    });
}

/**
 * Computes Max Pain across option strikes.
 * Evaluates aggregate expiration intrinsic payout across all Call & Put Open Interest
 * at each candidate settlement strike and selects the price that MINIMIZES the total sum.
 */
export function calculateMaxPain(
  strikesOI: OptionStrikeOI[],
  currentPrice: number,
): MaxPainAnalysis {
  const sorted = [...strikesOI].sort((a, b) => a.strike - b.strike);

  let totalCallOiBtc = 0;
  let totalPutOiBtc = 0;
  for (const row of sorted) {
    totalCallOiBtc += row.callOiBtc;
    totalPutOiBtc += row.putOiBtc;
  }

  const curve: MaxPainCurvePoint[] = sorted.map((candidate) => {
    const settlePrice = candidate.strike;
    let callSettlementUsd = 0;
    let putSettlementUsd = 0;

    for (const opt of sorted) {
      if (settlePrice > opt.strike) {
        callSettlementUsd += (settlePrice - opt.strike) * opt.callOiBtc;
      }
      if (settlePrice < opt.strike) {
        putSettlementUsd += (opt.strike - settlePrice) * opt.putOiBtc;
      }
    }

    const callSettlementUsdM = callSettlementUsd / 1_000_000;
    const putSettlementUsdM = putSettlementUsd / 1_000_000;

    return {
      strike: settlePrice,
      callOiBtc: candidate.callOiBtc,
      putOiBtc: candidate.putOiBtc,
      callSettlementUsdM,
      putSettlementUsdM,
      totalSettlementUsdM: callSettlementUsdM + putSettlementUsdM,
    };
  });

  // Select the strike with the MINIMUM aggregate expiration settlement sum
  let minPoint = curve[0];
  for (const pt of curve) {
    if (pt.totalSettlementUsdM < minPoint.totalSettlementUsdM) {
      minPoint = pt;
    }
  }

  const maxPainPrice = minPoint ? minPoint.strike : currentPrice;
  const diffFromSpotUsd = maxPainPrice - currentPrice;
  const diffFromSpotPct = currentPrice > 0 ? diffFromSpotUsd / currentPrice : 0;
  const putCallRatio = totalCallOiBtc > 0 ? totalPutOiBtc / totalCallOiBtc : 0;

  return {
    maxPainPrice,
    minSettlementUsdM: minPoint ? minPoint.totalSettlementUsdM : 0,
    diffFromSpotUsd,
    diffFromSpotPct,
    totalCallOiBtc,
    totalPutOiBtc,
    putCallRatio,
    curve,
  };
}

/**
 * Computes Max Pain individually for each option maturity tenor (7D..365D)
 * so Max Pain points align horizontally with the IV term structure maturities.
 */
export function calculateMaxPainByMaturity(
  maturities: OptionMaturityIV[],
  currentPrice: number,
): MaturityMaxPainPoint[] {
  return [...maturities]
    .filter((m) => m.daysToExpiry > 0 && m.daysToExpiry <= 365)
    .sort((a, b) => a.daysToExpiry - b.daysToExpiry)
    .map((m) => {
      const mp = calculateMaxPain(m.strikesOI, currentPrice);
      return {
        tenor: m.tenor,
        expiryDate: m.expiryDate,
        daysToExpiry: m.daysToExpiry,
        maxPainPrice: mp.maxPainPrice,
        diffFromSpotUsd: mp.diffFromSpotUsd,
        diffFromSpotPct: mp.diffFromSpotPct,
        totalCallOiBtc: mp.totalCallOiBtc,
        totalPutOiBtc: mp.totalPutOiBtc,
      };
    });
}

/**
 * Summarizes estimated vs realized liquidation liquidity above and below spot.
 */
export function summarizeLiquidations(
  bins: LiquidationBin[],
  currentPrice: number,
): LiquidationSummary {
  let totalEstimatedLongUsdM = 0;
  let totalEstimatedShortUsdM = 0;
  let totalRealizedLongUsdM = 0;
  let totalRealizedShortUsdM = 0;
  let peakShortCluster: LiquidationBin | null = null;
  let peakLongCluster: LiquidationBin | null = null;
  let maxBinTotalUsdM = 0;

  for (const bin of bins) {
    totalEstimatedLongUsdM += bin.estimatedLongUsdM;
    totalEstimatedShortUsdM += bin.estimatedShortUsdM;
    totalRealizedLongUsdM += bin.realizedLongUsdM;
    totalRealizedShortUsdM += bin.realizedShortUsdM;

    const totalLong = bin.estimatedLongUsdM + bin.realizedLongUsdM;
    const totalShort = bin.estimatedShortUsdM + bin.realizedShortUsdM;
    const binTotal = totalLong + totalShort;
    if (binTotal > maxBinTotalUsdM) {
      maxBinTotalUsdM = binTotal;
    }

    if (bin.midPrice >= currentPrice) {
      if (
        !peakShortCluster ||
        totalShort > peakShortCluster.estimatedShortUsdM + peakShortCluster.realizedShortUsdM
      ) {
        peakShortCluster = bin;
      }
    } else {
      if (
        !peakLongCluster ||
        totalLong > peakLongCluster.estimatedLongUsdM + peakLongCluster.realizedLongUsdM
      ) {
        peakLongCluster = bin;
      }
    }
  }

  return {
    totalEstimatedLongUsdM,
    totalEstimatedShortUsdM,
    totalRealizedLongUsdM,
    totalRealizedShortUsdM,
    peakShortCluster,
    peakLongCluster,
    maxBinTotalUsdM: Math.max(maxBinTotalUsdM, 1),
  };
}

export function formatUsd(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatSignedUsd(value: number, fractionDigits = 0): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatUsd(Math.abs(value), fractionDigits)}`;
}

export function formatPercent(decimalValue: number, fractionDigits = 2, signed = false): string {
  const pct = decimalValue * 100;
  const sign = signed ? (pct > 0 ? '+' : pct < 0 ? '-' : '') : pct < 0 ? '-' : '';
  return `${sign}${Math.abs(pct).toFixed(fractionDigits)}%`;
}

export function formatUsdMillions(valueM: number): string {
  if (valueM >= 1000) {
    return `$${(valueM / 1000).toFixed(2)}B`;
  }
  return `$${valueM.toFixed(1)}M`;
}
