import type {
  BacktestCandleSeries,
} from '../strategies/types.ts';
import type { BreakdownBucket, TradeRecord } from '../../types/strategyBacktest.ts';
import { computeWilderAtr } from '../strategies/liquidityFakeout/indicators.ts';

export interface CausalRegimeArrays {
  trend: Uint8Array; // 0=uptrend, 1=downtrend, 2=range
  volatility: Uint8Array; // 0=low_vol, 1=high_vol
  volume: Uint8Array; // 0=low_volume, 1=high_volume
}

/**
 * Strictly causal pre-entry market regime classification using ONLY data up to bar `i - 1`
 * (or completed bar `i` when called for `signalIndex = entryIndex - 1`):
 * - Trend: 48-bar Efficiency Ratio >= 0.18 & 48-bar return sign (uptrend / downtrend / range)
 * - Volatility: ATR(14)/Close vs rolling 288-bar (24h) causal median ATR/Close (high_vol / low_vol)
 * - Volume: Volume vs rolling 48-bar causal median/mean volume (high_volume / low_volume)
 */
export function computeCausalRegimeArrays(series: BacktestCandleSeries): CausalRegimeArrays {
  const n = series.count;
  const trend = new Uint8Array(n).fill(2);
  const volatility = new Uint8Array(n).fill(0);
  const volumeArr = new Uint8Array(n).fill(0);

  if (n < 60) return { trend, volatility, volume: volumeArr };

  const atr14 = computeWilderAtr(series.high, series.low, series.close, n, 14);
  const atrPct = new Float64Array(n).fill(NaN);
  for (let i = 14; i < n; i++) {
    if (Number.isFinite(atr14[i]) && series.close[i] > 0) {
      atrPct[i] = atr14[i] / series.close[i];
    }
  }

  // Prefix sums for ER(48) and Volume(48) and rolling 288-bar ATR% mean
  const prefixAbsDiff = new Float64Array(n);
  const prefixVol = new Float64Array(n);
  const prefixAtrPct = new Float64Array(n);
  const prefixAtrValid = new Int32Array(n);

  prefixVol[0] = series.volume[0];
  for (let i = 1; i < n; i++) {
    prefixAbsDiff[i] = prefixAbsDiff[i - 1] + Math.abs(series.close[i] - series.close[i - 1]);
    prefixVol[i] = prefixVol[i - 1] + series.volume[i];
    const ap = atrPct[i];
    if (Number.isFinite(ap)) {
      prefixAtrPct[i] = prefixAtrPct[i - 1] + ap;
      prefixAtrValid[i] = prefixAtrValid[i - 1] + 1;
    } else {
      prefixAtrPct[i] = prefixAtrPct[i - 1];
      prefixAtrValid[i] = prefixAtrValid[i - 1];
    }
  }

  const volWin = 48;
  const atrWin = 288; // 24 hours causal baseline

  for (let i = 48; i < n; i++) {
    // Trend (ER 48)
    const dir = Math.abs(series.close[i] - series.close[i - 48]);
    const path = prefixAbsDiff[i] - prefixAbsDiff[i - 48];
    const er = path > 0 ? dir / path : 0;
    if (er >= 0.18) {
      trend[i] = series.close[i] >= series.close[i - 48] ? 0 : 1;
    } else {
      trend[i] = 2;
    }

    // Volume (vs previous 48-bar mean)
    const prevVolMean = (prefixVol[i - 1] - (i - 1 - volWin >= 0 ? prefixVol[i - 1 - volWin] : 0)) / volWin;
    volumeArr[i] = prevVolMean > 0 && series.volume[i] >= prevVolMean ? 1 : 0;

    // Volatility (ATR% vs previous 288-bar causal mean)
    const ap = atrPct[i];
    const startAtrIdx = Math.max(0, i - 1 - atrWin);
    const cntValid = prefixAtrValid[i - 1] - prefixAtrValid[startAtrIdx];
    const sumAtr = prefixAtrPct[i - 1] - prefixAtrPct[startAtrIdx];
    if (Number.isFinite(ap) && cntValid > 0) {
      const meanAtrPct = sumAtr / cntValid;
      volatility[i] = ap >= meanAtrPct ? 1 : 0;
    }
  }

  return { trend, volatility, volume: volumeArr };
}

export function getEntryRegimeTags(
  regimes: CausalRegimeArrays,
  entryIndex: number,
): TradeRecord['regimesAtEntry'] {
  // Strictly evaluate completed bar BEFORE entry open (`entryIndex - 1`)
  const ref = Math.max(0, entryIndex - 1);
  const tCode = regimes.trend[ref];
  const vCode = regimes.volatility[ref];
  const volCode = regimes.volume[ref];

  return {
    trend: tCode === 0 ? 'uptrend' : tCode === 1 ? 'downtrend' : 'range',
    volatility: vCode === 1 ? 'high_vol' : 'low_vol',
    volume: volCode === 1 ? 'high_volume' : 'low_volume',
  };
}

function summarizeTradeBucket(key: string, label: string, trades: TradeRecord[]): BreakdownBucket {
  const n = trades.length;
  if (n === 0) {
    return {
      key,
      label,
      trades: 0,
      winRatePct: null,
      expectancyPct: null,
      profitFactorDisplay: 'N/A',
      netPnlUsd: 0,
    };
  }

  let wins = 0;
  let grossWinUsd = 0;
  let grossLossUsd = 0;
  let sumRetPct = 0;
  let netPnlUsd = 0;

  for (const t of trades) {
    sumRetPct += t.netReturnOnMarginPct;
    netPnlUsd += t.netPnlUsd;
    if (t.netPnlUsd > 0) {
      wins++;
      grossWinUsd += t.netPnlUsd;
    } else if (t.netPnlUsd < 0) {
      grossLossUsd += Math.abs(t.netPnlUsd);
    }
  }

  let pfDisplay = 'N/A';
  if (grossLossUsd > 0) {
    pfDisplay = (grossWinUsd / grossLossUsd).toFixed(2);
  } else if (grossWinUsd > 0) {
    pfDisplay = '무손실 (∞)';
  } else {
    pfDisplay = '0.00';
  }

  return {
    key,
    label,
    trades: n,
    winRatePct: (wins / n) * 100,
    expectancyPct: sumRetPct / n,
    profitFactorDisplay: pfDisplay,
    netPnlUsd,
  };
}

export function buildDirectionAndRegimeBreakdowns(trades: TradeRecord[]): {
  directionBreakdown: BreakdownBucket[];
  regimeBreakdown: BreakdownBucket[];
} {
  const directionBreakdown: BreakdownBucket[] = [
    summarizeTradeBucket('LONG', 'LONG (매수)', trades.filter((t) => t.direction === 'LONG')),
    summarizeTradeBucket('SHORT', 'SHORT (매도)', trades.filter((t) => t.direction === 'SHORT')),
  ];

  const regimeBreakdown: BreakdownBucket[] = [
    summarizeTradeBucket('uptrend', '상승 추세', trades.filter((t) => t.regimesAtEntry.trend === 'uptrend')),
    summarizeTradeBucket('downtrend', '하락 추세', trades.filter((t) => t.regimesAtEntry.trend === 'downtrend')),
    summarizeTradeBucket('range', '횡보장', trades.filter((t) => t.regimesAtEntry.trend === 'range')),
    summarizeTradeBucket('high_vol', '고변동성', trades.filter((t) => t.regimesAtEntry.volatility === 'high_vol')),
    summarizeTradeBucket('low_vol', '저변동성', trades.filter((t) => t.regimesAtEntry.volatility === 'low_vol')),
    summarizeTradeBucket('high_volume', '고거래량', trades.filter((t) => t.regimesAtEntry.volume === 'high_volume')),
    summarizeTradeBucket('low_volume', '저거래량', trades.filter((t) => t.regimesAtEntry.volume === 'low_volume')),
  ];

  return { directionBreakdown, regimeBreakdown };
}
