import type {
  AssetCorrelationMatrix,
  AssetId,
  BtcMacroCrossAnalysis,
  BtcMacroCrossPair,
  MacroCorrelationPair,
  MacroCorrelationSummary,
  MacroId,
  MacroObservation,
  NetworkOhlcvBar,
} from '../../../src/types/marketNetwork.ts';
import { BAR_INTERVAL_MS } from '../storage/networkStorage.ts';

export function pearsonCorrelation(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  const denom = Math.sqrt(varX * varY);
  if (!Number.isFinite(denom) || denom <= 1e-15) return null;
  const r = cov / denom;
  if (!Number.isFinite(r)) return null;
  return Math.max(-1, Math.min(1, r));
}

export function computeAssetMomentumStats(bars: readonly NetworkOhlcvBar[]): {
  latestTimestampMs: number | null;
  latestPrice: number | null;
  change1hPct: number | null;
  change4hPct: number | null;
  change24hPct: number | null;
} {
  if (bars.length === 0) {
    return {
      latestTimestampMs: null,
      latestPrice: null,
      change1hPct: null,
      change4hPct: null,
      change24hPct: null,
    };
  }

  const latest = bars[bars.length - 1];
  const latestTs = latest.openTimeMs;
  const latestPrice = latest.close;

  const findCloseAtOffset = (offsetMs: number): number | null => {
    const targetTs = latestTs - offsetMs;
    const maxToleranceMs = 15 * 60_000; // Allow up to 15m tolerance only if exact bar absent
    let lo = 0;
    let hi = bars.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = bars[mid].openTimeMs;
      if (t === targetTs) return bars[mid].close;
      if (t < targetTs) lo = mid + 1;
      else hi = mid - 1;
    }
    // Check closest neighbor around hi/lo within tolerance
    let best: NetworkOhlcvBar | null = null;
    let bestDist = Infinity;
    for (const idx of [hi, lo]) {
      if (idx >= 0 && idx < bars.length) {
        const dist = Math.abs(bars[idx].openTimeMs - targetTs);
        if (dist <= maxToleranceMs && dist < bestDist) {
          bestDist = dist;
          best = bars[idx];
        }
      }
    }
    return best ? best.close : null;
  };

  const pct = (prev: number | null): number | null =>
    prev !== null && prev > 0 ? ((latestPrice - prev) / prev) * 100 : null;

  return {
    latestTimestampMs: latestTs,
    latestPrice,
    change1hPct: pct(findCloseAtOffset(60 * 60_000)),
    change4hPct: pct(findCloseAtOffset(4 * 60 * 60_000)),
    change24hPct: pct(findCloseAtOffset(24 * 60 * 60_000)),
  };
}

/**
 * Builds map of openTimeMs -> 5m log return ln(C_t / C_{t-1}) strictly for consecutive 5m bars.
 */
function buildConsecutive5mLogReturns(
  bars: readonly NetworkOhlcvBar[],
  windowStartMs: number,
  windowEndMs: number,
): Map<number, number> {
  const returns = new Map<number, number>();
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const curr = bars[i];
    if (curr.openTimeMs < windowStartMs || curr.openTimeMs > windowEndMs) continue;
    if (curr.openTimeMs - prev.openTimeMs !== BAR_INTERVAL_MS) continue;
    if (prev.close <= 0 || curr.close <= 0) continue;
    const lr = Math.log(curr.close / prev.close);
    if (Number.isFinite(lr)) {
      returns.set(curr.openTimeMs, lr);
    }
  }
  return returns;
}

export function computeAssetCorrelationMatrix(
  seriesByAsset: ReadonlyMap<AssetId, readonly NetworkOhlcvBar[]>,
  assetIds: readonly AssetId[],
  windowId: '24h' | '30d',
): AssetCorrelationMatrix {
  const windowLabel = windowId === '24h' ? '최근 24시간 (5분봉 수익률)' : '최근 30일 (5분봉 수익률)';
  const windowMs = windowId === '24h' ? 24 * 60 * 60_000 : 30 * 24 * 60 * 60_000;
  const minSamples = windowId === '24h' ? 24 : 144;

  // Determine common anchor end time across available series
  let globalLatestMs = 0;
  for (const id of assetIds) {
    const bars = seriesByAsset.get(id);
    if (bars && bars.length > 0) {
      const lastTs = bars[bars.length - 1].openTimeMs;
      if (lastTs > globalLatestMs) globalLatestMs = lastTs;
    }
  }
  const windowStartMs = globalLatestMs > 0 ? globalLatestMs - windowMs : 0;

  const returnsMap = new Map<AssetId, Map<number, number>>();
  for (const id of assetIds) {
    const bars = seriesByAsset.get(id) ?? [];
    returnsMap.set(
      id,
      bars.length >= 2 ? buildConsecutive5mLogReturns(bars, windowStartMs, globalLatestMs) : new Map(),
    );
  }

  const n = assetIds.length;
  const matrix: Array<Array<number | null>> = Array.from({ length: n }, () =>
    Array<number | null>(n).fill(null),
  );
  const sampleCounts: Array<Array<number>> = Array.from({ length: n }, () =>
    Array<number>(n).fill(0),
  );

  for (let i = 0; i < n; i++) {
    const retA = returnsMap.get(assetIds[i])!;
    for (let j = i; j < n; j++) {
      const retB = returnsMap.get(assetIds[j])!;
      if (i === j) {
        const cnt = retA.size;
        sampleCounts[i][j] = cnt;
        matrix[i][j] = cnt >= minSamples ? 1 : null;
        continue;
      }

      const xs: number[] = [];
      const ys: number[] = [];
      for (const [ts, valA] of retA.entries()) {
        const valB = retB.get(ts);
        if (valB !== undefined) {
          xs.push(valA);
          ys.push(valB);
        }
      }

      sampleCounts[i][j] = xs.length;
      sampleCounts[j][i] = xs.length;
      const corr = xs.length >= minSamples ? pearsonCorrelation(xs, ys) : null;
      matrix[i][j] = corr;
      matrix[j][i] = corr;
    }
  }

  return {
    windowId,
    windowLabel,
    cadence: '5m',
    assetIds: [...assetIds],
    matrix,
    sampleCounts,
    computedAtIso: new Date().toISOString(),
  };
}

function addMonthsKey(ym: string, deltaMonths: number): string {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + deltaMonths;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12 + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function computeM2YoYSeries(m2Rows: readonly MacroObservation[]): Array<{
  date: string;
  ym: string;
  value: number;
  yoyPct: number;
}> {
  const byYm = new Map<string, { date: string; value: number }>();
  for (const r of m2Rows) {
    if (!Number.isFinite(r.value) || r.value <= 0) continue;
    byYm.set(r.date.slice(0, 7), { date: r.date, value: r.value });
  }

  const out: Array<{ date: string; ym: string; value: number; yoyPct: number }> = [];
  for (const [ym, curr] of Array.from(byYm.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const prevYear = byYm.get(addMonthsKey(ym, -12));
    if (!prevYear || prevYear.value <= 0) continue;
    const yoyPct = ((curr.value - prevYear.value) / prevYear.value) * 100;
    if (Number.isFinite(yoyPct)) {
      out.push({ date: curr.date, ym, value: curr.value, yoyPct });
    }
  }
  return out;
}

function toMonthEndSeries(rows: readonly MacroObservation[]): Map<string, { date: string; value: number }> {
  const byYm = new Map<string, { date: string; value: number }>();
  for (const r of rows) {
    if (!Number.isFinite(r.value)) continue;
    const ym = r.date.slice(0, 7);
    const existing = byYm.get(ym);
    if (!existing || r.date > existing.date) {
      byYm.set(ym, { date: r.date, value: r.value });
    }
  }
  return byYm;
}

function computeAlignedSeriesPairs(
  mapA: ReadonlyMap<string, number>,
  mapB: ReadonlyMap<string, number>,
  keysSorted: readonly string[],
  lagSteps = 0,
): { xs: number[]; ys: number[]; dates: string[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  const dates: string[] = [];

  for (let i = 0; i < keysSorted.length; i++) {
    const targetIdx = i + lagSteps;
    if (targetIdx < 0 || targetIdx >= keysSorted.length) continue;
    const keyA = keysSorted[i];
    const keyB = keysSorted[targetIdx];
    const valA = mapA.get(keyA);
    const valB = mapB.get(keyB);
    if (valA !== undefined && valB !== undefined) {
      xs.push(valA);
      ys.push(valB);
      dates.push(keyA);
    }
  }
  return { xs, ys, dates };
}

function findBestLag(
  mapA: ReadonlyMap<string, number>,
  mapB: ReadonlyMap<string, number>,
  keysSorted: readonly string[],
  maxLag: number,
  lagUnit: 'days' | 'months',
  minSamples: number,
): { lagSteps: number; lagUnit: 'days' | 'months'; correlation: number } | null {
  let best: { lagSteps: number; lagUnit: 'days' | 'months'; correlation: number } | null = null;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const { xs, ys } = computeAlignedSeriesPairs(mapA, mapB, keysSorted, lag);
    if (xs.length < minSamples) continue;
    const r = pearsonCorrelation(xs, ys);
    if (r === null) continue;
    if (!best || Math.abs(r) > Math.abs(best.correlation)) {
      best = { lagSteps: lag, lagUnit, correlation: r };
    }
  }
  return best;
}

export function computeMacroCorrelations(
  dxyRows: readonly MacroObservation[],
  m2Rows: readonly MacroObservation[],
  dgs10Rows: readonly MacroObservation[],
): MacroCorrelationSummary {
  const ids: MacroId[] = ['DXY', 'M2', 'DGS10'];
  const matrix: Array<Array<number | null>> = Array.from({ length: 3 }, () =>
    Array<number | null>(3).fill(null),
  );
  const sampleCounts: Array<Array<number>> = Array.from({ length: 3 }, () =>
    Array<number>(3).fill(0),
  );

  // Monthly aligned series (for unified 3x3 long-term macro matrix):
  // - DXY: monthly % change
  // - M2: YoY % growth
  // - DGS10: monthly percentage-point yield change
  const dxyMonthEnd = toMonthEndSeries(dxyRows);
  const dgsMonthEnd = toMonthEndSeries(dgs10Rows);
  const m2Yoy = computeM2YoYSeries(m2Rows);

  const dxyMonthlyRet = new Map<string, number>();
  const dxyMonths = Array.from(dxyMonthEnd.keys()).sort();
  for (let i = 1; i < dxyMonths.length; i++) {
    const prev = dxyMonthEnd.get(dxyMonths[i - 1])!;
    const curr = dxyMonthEnd.get(dxyMonths[i])!;
    if (prev.value > 0 && curr.value > 0) {
      dxyMonthlyRet.set(dxyMonths[i], Math.log(curr.value / prev.value) * 100);
    }
  }

  const dgsMonthlyDiff = new Map<string, number>();
  const dgsMonths = Array.from(dgsMonthEnd.keys()).sort();
  for (let i = 1; i < dgsMonths.length; i++) {
    const prev = dgsMonthEnd.get(dgsMonths[i - 1])!;
    const curr = dgsMonthEnd.get(dgsMonths[i])!;
    dgsMonthlyDiff.set(dgsMonths[i], curr.value - prev.value);
  }

  const m2YoyMap = new Map<string, number>(m2Yoy.map((r) => [r.ym, r.yoyPct]));
  const monthlySeriesMap = new Map<MacroId, Map<string, number>>([
    ['DXY', dxyMonthlyRet],
    ['M2', m2YoyMap],
    ['DGS10', dgsMonthlyDiff],
  ]);

  const allMonthlyKeys = Array.from(
    new Set([
      ...Array.from(dxyMonthlyRet.keys()),
      ...Array.from(m2YoyMap.keys()),
      ...Array.from(dgsMonthlyDiff.keys()),
    ]),
  ).sort();

  for (let i = 0; i < 3; i++) {
    const mapA = monthlySeriesMap.get(ids[i])!;
    for (let j = i; j < 3; j++) {
      const mapB = monthlySeriesMap.get(ids[j])!;
      if (i === j) {
        matrix[i][j] = mapA.size >= 12 ? 1 : null;
        sampleCounts[i][j] = mapA.size;
        continue;
      }
      const { xs, ys } = computeAlignedSeriesPairs(mapA, mapB, allMonthlyKeys, 0);
      sampleCounts[i][j] = xs.length;
      sampleCounts[j][i] = xs.length;
      const r = xs.length >= 12 ? pearsonCorrelation(xs, ys) : null;
      matrix[i][j] = r;
      matrix[j][i] = r;
    }
  }

  // Daily DXY vs DGS10 pair
  const dxyDailyRet = new Map<string, number>();
  for (let i = 1; i < dxyRows.length; i++) {
    if (dxyRows[i - 1].value > 0 && dxyRows[i].value > 0) {
      dxyDailyRet.set(
        dxyRows[i].date,
        Math.log(dxyRows[i].value / dxyRows[i - 1].value) * 100,
      );
    }
  }
  const dgsDailyDiff = new Map<string, number>();
  for (let i = 1; i < dgs10Rows.length; i++) {
    dgsDailyDiff.set(dgs10Rows[i].date, dgs10Rows[i].value - dgs10Rows[i - 1].value);
  }
  const commonDailyDates = Array.from(dxyDailyRet.keys())
    .filter((d) => dgsDailyDiff.has(d))
    .sort();
  const dxyDgsDailyAligned = computeAlignedSeriesPairs(dxyDailyRet, dgsDailyDiff, commonDailyDates, 0);
  const dxyDgsDailyCorr =
    dxyDgsDailyAligned.xs.length >= 30
      ? pearsonCorrelation(dxyDgsDailyAligned.xs, dxyDgsDailyAligned.ys)
      : null;

  const buildMonthlyPair = (
    pairId: string,
    idA: MacroId,
    idB: MacroId,
    label: string,
  ): MacroCorrelationPair => {
    const mapA = monthlySeriesMap.get(idA)!;
    const mapB = monthlySeriesMap.get(idB)!;
    const commonKeys = Array.from(mapA.keys())
      .filter((k) => mapB.has(k))
      .sort();
    const { xs, ys, dates } = computeAlignedSeriesPairs(mapA, mapB, commonKeys, 0);
    const corr = xs.length >= 12 ? pearsonCorrelation(xs, ys) : null;
    return {
      pairId,
      idA,
      idB,
      label,
      cadence: '1mo',
      sampleCount: xs.length,
      startDate: dates[0] ?? null,
      endDate: dates[dates.length - 1] ?? null,
      correlation: corr,
      bestLag: findBestLag(mapA, mapB, commonKeys, 6, 'months', 12),
      status: corr !== null ? 'ok' : 'insufficient_data',
      errorMessage:
        corr === null ? `${label} 월간 공통 표본이 부족합니다 (${xs.length}개월).` : null,
    };
  };

  const pairs: MacroCorrelationPair[] = [
    {
      pairId: 'dxy_dgs10_daily',
      idA: 'DXY',
      idB: 'DGS10',
      label: 'DXY 일간 수익률 ↔ 미 10년물 금리 일간 변화량',
      cadence: '1d',
      sampleCount: dxyDgsDailyAligned.xs.length,
      startDate: dxyDgsDailyAligned.dates[0] ?? null,
      endDate: dxyDgsDailyAligned.dates[dxyDgsDailyAligned.dates.length - 1] ?? null,
      correlation: dxyDgsDailyCorr,
      bestLag: findBestLag(dxyDailyRet, dgsDailyDiff, commonDailyDates, 5, 'days', 30),
      status: dxyDgsDailyCorr !== null ? 'ok' : 'insufficient_data',
      errorMessage:
        dxyDgsDailyCorr === null
          ? `DXY-DGS10 일간 공통 표본이 부족합니다 (${dxyDgsDailyAligned.xs.length}일).`
          : null,
    },
    buildMonthlyPair('dxy_m2_monthly', 'DXY', 'M2', 'DXY 월간 변화율 ↔ 미국 M2 YoY 증가율'),
    buildMonthlyPair('dgs10_m2_monthly', 'DGS10', 'M2', '미 10년물 금리 월간 변화량 ↔ 미국 M2 YoY 증가율'),
  ];

  return {
    ids,
    monthlyMatrix: matrix,
    monthlySampleCounts: sampleCounts,
    pairs,
    computedAtIso: new Date().toISOString(),
    methodologyNote:
      'M2(월간)와 일간 지표는 5분봉과 결합하지 않고 월간(1mo) 또는 일간(1d) 주기로 정렬하여 Pearson 상관계수를 계산합니다.',
  };
}

/**
 * Cross analysis strictly between:
 *  - BTC <-> DXY (1d & 1mo)
 *  - BTC <-> M2 YoY (1mo)
 * Never connects DGS10 to BTC per design specification.
 */
export function computeBtcMacroCrossAnalysis(
  btcDailyRows: ReadonlyArray<{ date: string; priceUsd: number }>,
  dxyRows: readonly MacroObservation[],
  m2Rows: readonly MacroObservation[],
  btcSourceLabel: string,
  dxyStatusOk: boolean,
  m2StatusOk: boolean,
): BtcMacroCrossAnalysis {
  const btcDailyMap = new Map<string, number>();
  for (const r of btcDailyRows) {
    if (Number.isFinite(r.priceUsd) && r.priceUsd > 0) {
      btcDailyMap.set(r.date, r.priceUsd);
    }
  }

  // 1. BTC <-> DXY Daily aligned log returns
  const dxyDailyMap = new Map<string, number>(dxyRows.map((r) => [r.date, r.value]));
  const commonBtcDxyDates = Array.from(dxyDailyMap.keys())
    .filter((d) => btcDailyMap.has(d))
    .sort();

  const btcDxyDailyRetA = new Map<string, number>();
  const btcDxyDailyRetB = new Map<string, number>();
  for (let i = 1; i < commonBtcDxyDates.length; i++) {
    const prevD = commonBtcDxyDates[i - 1];
    const currD = commonBtcDxyDates[i];
    const b0 = btcDailyMap.get(prevD)!;
    const b1 = btcDailyMap.get(currD)!;
    const d0 = dxyDailyMap.get(prevD)!;
    const d1 = dxyDailyMap.get(currD)!;
    if (b0 > 0 && b1 > 0 && d0 > 0 && d1 > 0) {
      btcDxyDailyRetA.set(currD, Math.log(b1 / b0));
      btcDxyDailyRetB.set(currD, Math.log(d1 / d0));
    }
  }
  const retDates = Array.from(btcDxyDailyRetA.keys()).sort();
  const dailyAligned = computeAlignedSeriesPairs(btcDxyDailyRetA, btcDxyDailyRetB, retDates, 0);
  const dailyCorr =
    dxyStatusOk && dailyAligned.xs.length >= 30
      ? pearsonCorrelation(dailyAligned.xs, dailyAligned.ys)
      : null;

  // 2. BTC <-> DXY Monthly aligned log returns
  const btcMonthEnd = toMonthEndSeries(
    btcDailyRows.map((r) => ({ date: r.date, value: r.priceUsd })),
  );
  const dxyMonthEnd = toMonthEndSeries(dxyRows);
  const commonBtcDxyMonths = Array.from(dxyMonthEnd.keys())
    .filter((ym) => btcMonthEnd.has(ym))
    .sort();

  const btcMonthlyRet = new Map<string, number>();
  const dxyMonthlyRet = new Map<string, number>();
  for (let i = 1; i < commonBtcDxyMonths.length; i++) {
    const prevM = commonBtcDxyMonths[i - 1];
    const currM = commonBtcDxyMonths[i];
    const b0 = btcMonthEnd.get(prevM)!.value;
    const b1 = btcMonthEnd.get(currM)!.value;
    const d0 = dxyMonthEnd.get(prevM)!.value;
    const d1 = dxyMonthEnd.get(currM)!.value;
    if (b0 > 0 && b1 > 0 && d0 > 0 && d1 > 0) {
      btcMonthlyRet.set(currM, Math.log(b1 / b0));
      dxyMonthlyRet.set(currM, Math.log(d1 / d0));
    }
  }
  const btcDxyMonthsSorted = Array.from(btcMonthlyRet.keys()).sort();
  const btcDxyMonthlyAligned = computeAlignedSeriesPairs(
    btcMonthlyRet,
    dxyMonthlyRet,
    btcDxyMonthsSorted,
    0,
  );
  const btcDxyMonthlyCorr =
    dxyStatusOk && btcDxyMonthlyAligned.xs.length >= 12
      ? pearsonCorrelation(btcDxyMonthlyAligned.xs, btcDxyMonthlyAligned.ys)
      : null;

  // 3. BTC YoY % <-> M2 YoY % Monthly
  const m2YoyRows = computeM2YoYSeries(m2Rows);
  const m2YoyMap = new Map<string, number>(m2YoyRows.map((r) => [r.ym, r.yoyPct]));
  const btcYoYMap = new Map<string, number>();
  for (const ym of Array.from(btcMonthEnd.keys()).sort()) {
    const prevYear = btcMonthEnd.get(addMonthsKey(ym, -12));
    const curr = btcMonthEnd.get(ym)!;
    if (prevYear && prevYear.value > 0 && curr.value > 0) {
      btcYoYMap.set(ym, ((curr.value - prevYear.value) / prevYear.value) * 100);
    }
  }
  const commonM2Months = Array.from(m2YoyMap.keys())
    .filter((ym) => btcYoYMap.has(ym))
    .sort();
  const btcM2Aligned = computeAlignedSeriesPairs(btcYoYMap, m2YoyMap, commonM2Months, 0);
  const btcM2Corr =
    m2StatusOk && btcM2Aligned.xs.length >= 12
      ? pearsonCorrelation(btcM2Aligned.xs, btcM2Aligned.ys)
      : null;

  const pairs: BtcMacroCrossPair[] = [
    {
      pairId: 'btc_dxy_daily',
      label: 'BTC 일간 로그수익률 ↔ DXY 일간 로그수익률',
      macroId: 'DXY',
      cadence: '1d',
      btcSourceLabel,
      macroSourceLabel: 'Yahoo Finance (DX-Y.NYB)',
      sampleCount: dailyAligned.xs.length,
      startDate: dailyAligned.dates[0] ?? null,
      endDate: dailyAligned.dates[dailyAligned.dates.length - 1] ?? null,
      correlation: dailyCorr,
      bestLag:
        dxyStatusOk && retDates.length >= 30
          ? findBestLag(btcDxyDailyRetA, btcDxyDailyRetB, retDates, 10, 'days', 30)
          : null,
      status: !dxyStatusOk ? 'error' : dailyCorr !== null ? 'ok' : 'insufficient_data',
      errorMessage: !dxyStatusOk
        ? 'DXY 데이터 수집 실패로 교차 상관계수를 계산할 수 없습니다.'
        : dailyCorr === null
          ? '일간 공통 표본이 부족합니다.'
          : null,
    },
    {
      pairId: 'btc_dxy_monthly',
      label: 'BTC 월간 로그수익률 ↔ DXY 월간 로그수익률',
      macroId: 'DXY',
      cadence: '1mo',
      btcSourceLabel,
      macroSourceLabel: 'Yahoo Finance (DX-Y.NYB)',
      sampleCount: btcDxyMonthlyAligned.xs.length,
      startDate: btcDxyMonthlyAligned.dates[0] ?? null,
      endDate: btcDxyMonthlyAligned.dates[btcDxyMonthlyAligned.dates.length - 1] ?? null,
      correlation: btcDxyMonthlyCorr,
      bestLag: null,
      status: !dxyStatusOk ? 'error' : btcDxyMonthlyCorr !== null ? 'ok' : 'insufficient_data',
      errorMessage: !dxyStatusOk
        ? 'DXY 데이터 수집 실패로 월간 교차 상관계수를 계산할 수 없습니다.'
        : btcDxyMonthlyCorr === null
          ? '월간 공통 표본이 부족합니다.'
          : null,
    },
    {
      pairId: 'btc_m2_monthly',
      label: 'BTC 전년 동월 대비(YoY) 수익률 ↔ 미국 M2 YoY 증가율',
      macroId: 'M2',
      cadence: '1mo',
      btcSourceLabel,
      macroSourceLabel: 'FRED (M2SL)',
      sampleCount: btcM2Aligned.xs.length,
      startDate: btcM2Aligned.dates[0] ?? null,
      endDate: btcM2Aligned.dates[btcM2Aligned.dates.length - 1] ?? null,
      correlation: btcM2Corr,
      bestLag:
        m2StatusOk && commonM2Months.length >= 12
          ? findBestLag(btcYoYMap, m2YoyMap, commonM2Months, 6, 'months', 12)
          : null,
      status: !m2StatusOk ? 'error' : btcM2Corr !== null ? 'ok' : 'insufficient_data',
      errorMessage: !m2StatusOk
        ? 'M2SL 데이터 수집 실패로 교차 상관계수를 계산할 수 없습니다.'
        : btcM2Corr === null
          ? '월간 공통 표본이 부족합니다.'
          : null,
    },
  ];

  return {
    pairs,
    computedAtIso: new Date().toISOString(),
    causalityNotice:
      '상관계수는 동일 시간축의 통계적 동행/역행 강도만 나타내며 인과관계로 해석하지 않습니다. 국채 금리(DGS10)는 거시 영역 내부 관계만 분석하며 BTC와 직접 연결하지 않습니다.',
  };
}
