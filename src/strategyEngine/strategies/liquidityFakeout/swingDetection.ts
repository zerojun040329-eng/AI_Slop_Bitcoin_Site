import type { LiquidityFakeoutParams } from '../../../types/strategyBacktest.ts';
import type { BacktestCandleSeries } from '../types.ts';
import type { FakeoutIndicatorArrays } from './indicators.ts';

export type PivotKind = 'HIGH' | 'LOW';

export interface ConfirmedPivot {
  id: number;
  kind: PivotKind;
  pivotIndex: number;
  confirmedIndex: number; // pivotIndex + pivotRightBars (first bar where pivot is causally known)
  price: number;
  rvol: number;
  volumeSurge: number;
  reversalStrength: number;
  rangeToAtr: number;
}

/**
 * Strictly causal pivot detection:
 * A pivot at bar `p` depends on `[p - leftBars .. p + rightBars]`.
 * It is ONLY registered at `confirmedIndex = p + rightBars`, preventing any look-ahead bias.
 */
export function detectConfirmedPivots(
  series: BacktestCandleSeries,
  indicators: FakeoutIndicatorArrays,
  params: LiquidityFakeoutParams,
  startIdx = 0,
  endIdx = series.count - 1,
): ConfirmedPivot[] {
  const { high, low, close } = series;
  const { atr, rvol, volumeSurgeRatio, rangeToAtr } = indicators;
  const left = params.pivotLeftBars;
  const right = params.pivotRightBars;
  const pivots: ConfirmedPivot[] = [];
  let nextId = 1;

  const firstPivot = Math.max(left, params.rvolPeriod, params.atrPeriod, startIdx);
  const lastPivot = Math.min(series.count - 1 - right, endIdx - right);

  for (let p = firstPivot; p <= lastPivot; p++) {
    const curAtr = atr[p];
    const curRvol = rvol[p];
    const curSurge = volumeSurgeRatio[p];
    const curRangeAtr = rangeToAtr[p];

    if (
      !Number.isFinite(curAtr) ||
      curAtr <= 0 ||
      !Number.isFinite(curRvol) ||
      !Number.isFinite(curSurge) ||
      !Number.isFinite(curRangeAtr)
    ) {
      continue;
    }

    if (
      curRvol < params.minRvol ||
      curSurge < params.minVolumeSurgeRatio ||
      curRangeAtr < params.minRangeAtrMultiple
    ) {
      continue;
    }

    const pHigh = high[p];
    const pLow = low[p];
    let isPivotHigh = true;
    let isPivotLow = true;

    for (let k = p - left; k <= p + right; k++) {
      if (k === p) continue;
      if (high[k] >= pHigh) isPivotHigh = false;
      if (low[k] <= pLow) isPivotLow = false;
      if (!isPivotHigh && !isPivotLow) break;
    }

    const confirmedIndex = p + right;

    if (isPivotHigh) {
      const preMove = Math.max(0, pHigh - close[p - left]) / (curAtr * Math.sqrt(left));
      const postMove = Math.max(0, pHigh - close[confirmedIndex]) / (curAtr * Math.sqrt(right));
      const reversalStrength = 0.5 * (preMove + postMove);
      if (reversalStrength >= params.minReversalStrength) {
        pivots.push({
          id: nextId++,
          kind: 'HIGH',
          pivotIndex: p,
          confirmedIndex,
          price: pHigh,
          rvol: curRvol,
          volumeSurge: curSurge,
          reversalStrength,
          rangeToAtr: curRangeAtr,
        });
      }
    }

    if (isPivotLow) {
      const preMove = Math.max(0, close[p - left] - pLow) / (curAtr * Math.sqrt(left));
      const postMove = Math.max(0, close[confirmedIndex] - pLow) / (curAtr * Math.sqrt(right));
      const reversalStrength = 0.5 * (preMove + postMove);
      if (reversalStrength >= params.minReversalStrength) {
        pivots.push({
          id: nextId++,
          kind: 'LOW',
          pivotIndex: p,
          confirmedIndex,
          price: pLow,
          rvol: curRvol,
          volumeSurge: curSurge,
          reversalStrength,
          rangeToAtr: curRangeAtr,
        });
      }
    }
  }

  return pivots;
}
