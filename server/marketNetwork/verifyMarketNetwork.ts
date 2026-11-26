import {
  computeAssetCorrelationMatrix,
  computeAssetMomentumStats,
  computeBtcMacroCrossAnalysis,
  computeM2YoYSeries,
  computeMacroCorrelations,
  pearsonCorrelation,
} from './correlation/correlationEngine.ts';
import type { AssetId, NetworkOhlcvBar } from '../../src/types/marketNetwork.ts';
import { BAR_INTERVAL_MS } from './storage/networkStorage.ts';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function assertClose(a: number, b: number, tol: number, msg: string) {
  if (Math.abs(a - b) > tol) {
    throw new Error(`ASSERTION FAILED (${msg}): expected ${b} ± ${tol}, got ${a}`);
  }
}

function makeBars(
  startMs: number,
  count: number,
  priceFn: (i: number) => number,
): NetworkOhlcvBar[] {
  const out: NetworkOhlcvBar[] = [];
  for (let i = 0; i < count; i++) {
    const p = priceFn(i);
    out.push({
      openTimeMs: startMs + i * BAR_INTERVAL_MS,
      open: p,
      high: p,
      low: p,
      close: p,
      volume: 10,
      quoteVolume: 10 * p,
    });
  }
  return out;
}

function run(): void {
  // 1. Pearson Correlation
  assertClose(pearsonCorrelation([1, 2, 3, 4], [2, 4, 6, 8])!, 1, 1e-12, 'perfect +1');
  assertClose(pearsonCorrelation([1, 2, 3, 4], [8, 6, 4, 2])!, -1, 1e-12, 'perfect -1');
  assert(pearsonCorrelation([1, 2], [1, 2]) === null, 'n < 3 returns null');
  assert(pearsonCorrelation([5, 5, 5, 5], [1, 2, 3, 4]) === null, 'zero variance returns null');

  // 2. Momentum 1h / 4h / 24h
  const startMs = Date.UTC(2026, 10, 1, 0, 0, 0);
  const bars = makeBars(startMs, 300, (i) => 100 + i * 0.5);
  const mom = computeAssetMomentumStats(bars);
  const latest = bars[299].close; // 249.5
  assertClose(mom.latestPrice!, latest, 1e-12, 'latest price');
  assertClose(mom.change1hPct!, ((latest - bars[299 - 12].close) / bars[299 - 12].close) * 100, 1e-9, '1h pct');
  assertClose(mom.change4hPct!, ((latest - bars[299 - 48].close) / bars[299 - 48].close) * 100, 1e-9, '4h pct');
  assertClose(mom.change24hPct!, ((latest - bars[299 - 288].close) / bars[299 - 288].close) * 100, 1e-9, '24h pct');

  // 3. 5m return correlation matrix (BTC & SPY move identically, XAU moves inversely, EEM missing -> null)
  const btc = makeBars(startMs, 400, (i) => 50000 * Math.exp(0.001 * Math.sin(i * 0.3)));
  const spy = makeBars(startMs, 400, (i) => 500 * Math.exp(0.002 * Math.sin(i * 0.3)));
  const xau = makeBars(startMs, 400, (i) => 3000 * Math.exp(-0.0015 * Math.sin(i * 0.3)));
  const map = new Map<AssetId, NetworkOhlcvBar[]>([
    ['BTC', btc],
    ['SPY', spy],
    ['XAU', xau],
  ]);
  const ids: AssetId[] = ['BTC', 'SPY', 'XAU', 'EEM'];
  const mat24 = computeAssetCorrelationMatrix(map, ids, '24h');
  assert(mat24.matrix[0][1]! > 0.99, 'BTC-SPY positive aligned return corr');
  assert(mat24.matrix[0][2]! < -0.99, 'BTC-XAU inverse aligned return corr');
  assert(mat24.matrix[0][3] === null && mat24.sampleCounts[0][3] === 0, 'Missing EEM yields null');

  // 4. M2 YoY calculation
  const m2Obs = Array.from({ length: 24 }, (_, m) => {
    const y = 2024 + Math.floor(m / 12);
    const mo = (m % 12) + 1;
    return {
      date: `${y}-${String(mo).padStart(2, '0')}-01`,
      value: m < 12 ? 20000 : 21000, // +5% YoY
    };
  });
  const m2Yoy = computeM2YoYSeries(m2Obs);
  assert(m2Yoy.length === 12, 'M2 YoY has 12 points');
  assertClose(m2Yoy[0].yoyPct, 5.0, 1e-9, 'M2 YoY 5.0%');

  // 5. Macro & Cross Analysis (ensuring DGS10 is NOT in BTC cross analysis)
  const dailyDates = Array.from({ length: 90 }, (_, d) =>
    new Date(Date.UTC(2025, 0, 1) + d * 86_400_000).toISOString().slice(0, 10),
  );
  const dxyObs = dailyDates.map((date, i) => ({ date, value: 100 + Math.sin(i * 0.2) * 2 }));
  const dgsObs = dailyDates.map((date, i) => ({ date, value: 4.0 + Math.sin(i * 0.2) * 0.2 }));
  const macroCorr = computeMacroCorrelations(dxyObs, m2Obs, dgsObs);
  assert(macroCorr.pairs[0].correlation! > 0.9, 'DXY-DGS10 daily positive corr');

  const btcDaily = Array.from({ length: 730 }, (_, d) => ({
    date: new Date(Date.UTC(2024, 0, 1) + d * 86_400_000).toISOString().slice(0, 10),
    priceUsd: 40000 + d * 50 + Math.sin(d * 0.2) * 1000,
  }));
  const dxy2y = Array.from({ length: 730 }, (_, d) => ({
    date: new Date(Date.UTC(2024, 0, 1) + d * 86_400_000).toISOString().slice(0, 10),
    value: 104 - Math.sin(d * 0.2) * 1.5,
  }));
  const cross = computeBtcMacroCrossAnalysis(btcDaily, dxy2y, m2Obs, 'test', true, true);
  assert(cross.pairs.length === 3, 'Strictly BTC-DXY daily/monthly & BTC-M2 monthly (no DGS10)');
  assert(
    cross.pairs.every((p) => p.macroId === 'DXY' || p.macroId === 'M2'),
    'No DGS10 in BTC cross pairs',
  );

  console.log('ALL MARKET-NETWORK ENGINE UNIT TESTS PASSED');
}

run();
