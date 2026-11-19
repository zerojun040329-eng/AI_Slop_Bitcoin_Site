import type { IndicatorId } from '../types/signalAnalysis.ts';

export interface PriceVolumeArrays {
  count: number;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  quoteVolume: Float64Array;
}

export type RawIndicatorMatrix = Record<IndicatorId, Float64Array>;

function binaryInsert(arr: Float64Array, len: number, val: number): void {
  let lo = 0;
  let hi = len;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < val) lo = mid + 1;
    else hi = mid;
  }
  for (let i = len; i > lo; i--) {
    arr[i] = arr[i - 1];
  }
  arr[lo] = val;
}

function binaryRemove(arr: Float64Array, len: number, val: number): void {
  let lo = 0;
  let hi = len - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] === val) {
      found = mid;
      break;
    }
    if (arr[mid] < val) lo = mid + 1;
    else hi = mid - 1;
  }
  if (found === -1) return;
  for (let i = found; i < len - 1; i++) {
    arr[i] = arr[i + 1];
  }
}

export function computeAllRawIndicators(series: PriceVolumeArrays): RawIndicatorMatrix {
  const n = series.count;
  const { high, low, close, volume, quoteVolume } = series;

  const er48 = new Float64Array(n).fill(NaN);
  const rsi14 = new Float64Array(n).fill(NaN);
  const vwapZ48 = new Float64Array(n).fill(NaN);
  const rv48 = new Float64Array(n).fill(NaN);
  const rvol48 = new Float64Array(n).fill(NaN);
  const vp12 = new Float64Array(n).fill(NaN);
  const donchian48 = new Float64Array(n).fill(NaN);
  const amihud48 = new Float64Array(n).fill(NaN);

  if (n < 2) {
    return { er48, rsi14, vwapZ48, rv48, rvol48, vp12, donchian48, amihud48 };
  }

  // 1. Kaufman Efficiency Ratio (48)
  {
    const absDiff = new Float64Array(n);
    const prefixAbsDiff = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      absDiff[i] = Math.abs(close[i] - close[i - 1]);
      prefixAbsDiff[i] = prefixAbsDiff[i - 1] + absDiff[i];
    }
    for (let i = 48; i < n; i++) {
      const direction = Math.abs(close[i] - close[i - 48]);
      const volatility = prefixAbsDiff[i] - prefixAbsDiff[i - 48];
      if (volatility > 0 && Number.isFinite(volatility)) {
        er48[i] = direction / volatility;
      }
    }
  }

  // 2. Wilder RSI (14)
  {
    const period = 14;
    if (n > period) {
      let sumGain = 0;
      let sumLoss = 0;
      for (let i = 1; i <= period; i++) {
        const diff = close[i] - close[i - 1];
        if (diff > 0) sumGain += diff;
        else if (diff < 0) sumLoss -= diff;
      }
      let avgGain = sumGain / period;
      let avgLoss = sumLoss / period;

      const calcRsi = (ag: number, al: number): number => {
        if (ag === 0 && al === 0) return NaN;
        if (al === 0) return 100;
        if (ag === 0) return 0;
        const rs = ag / al;
        return 100 - 100 / (1 + rs);
      };

      rsi14[period] = calcRsi(avgGain, avgLoss);

      for (let i = period + 1; i < n; i++) {
        const diff = close[i] - close[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        rsi14[i] = calcRsi(avgGain, avgLoss);
      }
    }
  }

  // 3. Rolling VWAP Deviation Z-score (48)
  {
    const win = 48;
    const tp = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      tp[i] = (high[i] + low[i] + close[i]) / 3;
    }

    for (let i = win - 1; i < n; i++) {
      const start = i - win + 1;
      let sumPV = 0;
      let sumV = 0;
      let sumC = 0;
      for (let k = start; k <= i; k++) {
        const v = volume[k];
        sumPV += tp[k] * v;
        sumV += v;
        sumC += close[k];
      }
      if (sumV <= 0) continue;
      const vwap = sumPV / sumV;
      const meanC = sumC / win;
      let sumSqDev = 0;
      for (let k = start; k <= i; k++) {
        const d = close[k] - meanC;
        sumSqDev += d * d;
      }
      const stdC = Math.sqrt(sumSqDev / win);
      if (stdC > 1e-12 && Number.isFinite(stdC)) {
        vwapZ48[i] = (close[i] - vwap) / stdC;
      }
    }
  }

  // 4. Realized Volatility (48) in percent
  {
    const win = 48;
    const sqLogRet = new Float64Array(n);
    const prefixSq = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const r = close[i] > 0 && close[i - 1] > 0 ? Math.log(close[i] / close[i - 1]) : NaN;
      if (Number.isFinite(r)) {
        sqLogRet[i] = r * r;
        prefixSq[i] = prefixSq[i - 1] + sqLogRet[i];
      } else {
        prefixSq[i] = prefixSq[i - 1];
      }
    }
    for (let i = win; i < n; i++) {
      const sumSq = prefixSq[i] - prefixSq[i - win];
      if (sumSq >= 0 && Number.isFinite(sumSq)) {
        rv48[i] = Math.sqrt(sumSq) * 100;
      }
    }
  }

  // 5. Relative Volume (48) = CurrentVolume / Median(Previous 48 Volumes)
  {
    const win = 48;
    if (n > win) {
      const sorted = new Float64Array(win);
      for (let k = 0; k < win; k++) {
        binaryInsert(sorted, k, volume[k]);
      }
      for (let i = win; i < n; i++) {
        const median = (sorted[23] + sorted[24]) * 0.5;
        if (median > 0 && Number.isFinite(median)) {
          rvol48[i] = volume[i] / median;
        }
        binaryRemove(sorted, win, volume[i - win]);
        binaryInsert(sorted, win - 1, volume[i]);
      }
    }
  }

  // 6. Volume Pressure (12): Sum(CLV * Vol) / Sum(Vol)
  {
    const win = 12;
    const clvVol = new Float64Array(n);
    const validBar = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const hl = high[i] - low[i];
      if (hl > 0 && Number.isFinite(hl)) {
        const clv = (2 * close[i] - high[i] - low[i]) / hl;
        clvVol[i] = clv * volume[i];
        validBar[i] = 1;
      }
    }

    for (let i = win - 1; i < n; i++) {
      const start = i - win + 1;
      let sumClvVol = 0;
      let sumVol = 0;
      let hasHl = false;
      for (let k = start; k <= i; k++) {
        sumClvVol += clvVol[k];
        sumVol += volume[k];
        if (validBar[k] === 1) hasHl = true;
      }
      if (sumVol > 0 && hasHl) {
        const val = sumClvVol / sumVol;
        vp12[i] = Math.max(-1, Math.min(1, val));
      }
    }
  }

  // 7. Donchian Channel Position (48) using strictly previous 48 bars [i-48 .. i-1]
  {
    const win = 48;
    if (n > win) {
      const maxDeque = new Int32Array(n);
      const minDeque = new Int32Array(n);
      let maxHead = 0;
      let maxTail = 0;
      let minHead = 0;
      let minTail = 0;

      for (let j = 0; j < n - 1; j++) {
        // Push bar j into monotonic deques
        while (maxTail > maxHead && high[maxDeque[maxTail - 1]] <= high[j]) {
          maxTail--;
        }
        maxDeque[maxTail++] = j;
        if (maxDeque[maxHead] <= j - win) {
          maxHead++;
        }

        while (minTail > minHead && low[minDeque[minTail - 1]] >= low[j]) {
          minTail--;
        }
        minDeque[minTail++] = j;
        if (minDeque[minHead] <= j - win) {
          minHead++;
        }

        const targetIdx = j + 1;
        if (targetIdx >= win) {
          const prevHigh = high[maxDeque[maxHead]];
          const prevLow = low[minDeque[minHead]];
          const span = prevHigh - prevLow;
          if (span > 0 && Number.isFinite(span)) {
            donchian48[targetIdx] = (close[targetIdx] - prevLow) / span;
          }
        }
      }
    }
  }

  // 8. Amihud Illiquidity Proxy (48): Mean(|Ret| / QuoteVolume) * 1e9
  {
    const win = 48;
    const barIlliq = new Float64Array(n).fill(NaN);
    for (let i = 1; i < n; i++) {
      if (close[i - 1] > 0 && quoteVolume[i] > 0) {
        const absRet = Math.abs((close[i] - close[i - 1]) / close[i - 1]);
        barIlliq[i] = (absRet / quoteVolume[i]) * 1e9;
      }
    }

    for (let i = win; i < n; i++) {
      const start = i - win + 1;
      let sum = 0;
      let valid = 0;
      for (let k = start; k <= i; k++) {
        const val = barIlliq[k];
        if (Number.isFinite(val)) {
          sum += val;
          valid++;
        }
      }
      if (valid >= 24) {
        amihud48[i] = sum / valid;
      }
    }
  }

  return {
    er48,
    rsi14,
    vwapZ48,
    rv48,
    rvol48,
    vp12,
    donchian48,
    amihud48,
  };
}
