export interface FakeoutIndicatorArrays {
  atr: Float64Array;
  rvol: Float64Array;
  volumeSurgeRatio: Float64Array;
  rangeToAtr: Float64Array;
}

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

export function computeWilderAtr(
  high: Float64Array,
  low: Float64Array,
  close: Float64Array,
  count: number,
  period: number,
): Float64Array {
  const atr = new Float64Array(count).fill(NaN);
  if (count <= period) return atr;

  const tr = new Float64Array(count);
  tr[0] = high[0] - low[0];
  for (let i = 1; i < count; i++) {
    const hl = high[i] - low[i];
    const hc = Math.abs(high[i] - close[i - 1]);
    const lc = Math.abs(low[i] - close[i - 1]);
    tr[i] = Math.max(hl, hc, lc);
  }

  let sumTr = 0;
  for (let i = 1; i <= period; i++) {
    sumTr += tr[i];
  }
  let curAtr = sumTr / period;
  atr[period] = curAtr;

  for (let i = period + 1; i < count; i++) {
    curAtr = (curAtr * (period - 1) + tr[i]) / period;
    atr[i] = curAtr;
  }
  return atr;
}

export function computeStrategyIndicators(params: {
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  count: number;
  atrPeriod: number;
  rvolPeriod: number;
}): FakeoutIndicatorArrays {
  const { high, low, close, volume, count, atrPeriod, rvolPeriod } = params;

  const atr = computeWilderAtr(high, low, close, count, atrPeriod);
  const rvol = new Float64Array(count).fill(NaN);
  const volumeSurgeRatio = new Float64Array(count).fill(NaN);
  const rangeToAtr = new Float64Array(count).fill(NaN);

  // Range / ATR
  for (let i = 0; i < count; i++) {
    const a = atr[i];
    if (Number.isFinite(a) && a > 0) {
      rangeToAtr[i] = (high[i] - low[i]) / a;
    }
  }

  // Causal RVOL vs strictly previous rvolPeriod median + Volume Surge Ratio vs strictly previous mean
  if (count > rvolPeriod) {
    const sorted = new Float64Array(rvolPeriod);
    let sumPrev = 0;
    for (let k = 0; k < rvolPeriod; k++) {
      binaryInsert(sorted, k, volume[k]);
      sumPrev += volume[k];
    }

    const midA = Math.floor((rvolPeriod - 1) / 2);
    const midB = Math.floor(rvolPeriod / 2);

    for (let i = rvolPeriod; i < count; i++) {
      const median = (sorted[midA] + sorted[midB]) * 0.5;
      if (median > 0 && Number.isFinite(median)) {
        rvol[i] = volume[i] / median;
      }
      const meanPrev = sumPrev / rvolPeriod;
      if (meanPrev > 0 && Number.isFinite(meanPrev)) {
        volumeSurgeRatio[i] = volume[i] / meanPrev;
      }

      const outVol = volume[i - rvolPeriod];
      const inVol = volume[i];
      sumPrev = sumPrev - outVol + inVol;
      binaryRemove(sorted, rvolPeriod, outVol);
      binaryInsert(sorted, rvolPeriod - 1, inVol);
    }
  }

  return {
    atr,
    rvol,
    volumeSurgeRatio,
    rangeToAtr,
  };
}
