import fs from 'fs';
import path from 'path';
import type { IntegrityReport, RawCandleBar } from '../../src/types/signalAnalysis.ts';

export const BAR_INTERVAL_MS = 300_000; // 5 minutes
const MAGIC_HEADER = 'BTC5M01\0'; // 8 bytes

export interface CandleTypedSeries {
  count: number;
  openTimeMs: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  quoteVolume: Float64Array;
}

export interface ValidationStats {
  duplicateRowsRemoved: number;
  abnormalRowsDropped: number;
  excludedUnclosedCandle: boolean;
}

export interface PersistedMeta {
  integrity: IntegrityReport;
  lastUpdatedIso: string;
}

export interface GapRange {
  startOpenTimeMs: number;
  endOpenTimeMs: number;
  missingBars: number;
}

export function getLatestClosedOpenTimeMs(nowMs = Date.now()): number {
  const currentBarOpen = Math.floor(nowMs / BAR_INTERVAL_MS) * BAR_INTERVAL_MS;
  return currentBarOpen - BAR_INTERVAL_MS;
}

export function isValidCandle(c: RawCandleBar): boolean {
  if (
    !Number.isFinite(c.openTimeMs) ||
    !Number.isFinite(c.open) ||
    !Number.isFinite(c.high) ||
    !Number.isFinite(c.low) ||
    !Number.isFinite(c.close) ||
    !Number.isFinite(c.volume) ||
    !Number.isFinite(c.quoteVolume)
  ) {
    return false;
  }
  if (c.openTimeMs <= 0 || c.openTimeMs % BAR_INTERVAL_MS !== 0) return false;
  if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) return false;
  if (c.high < c.low) return false;
  if (c.high < Math.max(c.open, c.close) - 1e-8) return false;
  if (c.low > Math.min(c.open, c.close) + 1e-8) return false;
  if (c.volume < 0 || c.quoteVolume < 0) return false;
  return true;
}

export function buildSeriesFromBars(bars: RawCandleBar[]): CandleTypedSeries {
  const count = bars.length;
  const openTimeMs = new Float64Array(count);
  const open = new Float64Array(count);
  const high = new Float64Array(count);
  const low = new Float64Array(count);
  const close = new Float64Array(count);
  const volume = new Float64Array(count);
  const quoteVolume = new Float64Array(count);

  for (let i = 0; i < count; i++) {
    const b = bars[i];
    openTimeMs[i] = b.openTimeMs;
    open[i] = b.open;
    high[i] = b.high;
    low[i] = b.low;
    close[i] = b.close;
    volume[i] = b.volume;
    quoteVolume[i] = b.quoteVolume;
  }

  return { count, openTimeMs, open, high, low, close, volume, quoteVolume };
}

export function detectGapsInSeries(series: CandleTypedSeries): {
  gaps: GapRange[];
  missingBarsTotal: number;
  chronologicalSorted: boolean;
} {
  const gaps: GapRange[] = [];
  let missingBarsTotal = 0;
  let chronologicalSorted = true;

  for (let i = 1; i < series.count; i++) {
    const prev = series.openTimeMs[i - 1];
    const curr = series.openTimeMs[i];
    if (curr <= prev) {
      chronologicalSorted = false;
    }
    const diff = curr - prev;
    if (diff > BAR_INTERVAL_MS) {
      const missingBars = Math.round(diff / BAR_INTERVAL_MS) - 1;
      if (missingBars > 0) {
        missingBarsTotal += missingBars;
        gaps.push({
          startOpenTimeMs: prev + BAR_INTERVAL_MS,
          endOpenTimeMs: curr - BAR_INTERVAL_MS,
          missingBars,
        });
      }
    }
  }

  return { gaps, missingBarsTotal, chronologicalSorted };
}

export function computeIntegrityReport(
  series: CandleTypedSeries,
  stats: ValidationStats,
  repairedGapBars: number,
  nowMs = Date.now(),
): IntegrityReport {
  if (series.count === 0) {
    return {
      totalStoredBars: 0,
      expectedBarsInSpan: 0,
      startTimestampMs: null,
      endTimestampMs: null,
      duplicateRowsRemoved: stats.duplicateRowsRemoved,
      abnormalRowsDropped: stats.abnormalRowsDropped,
      missingGapIntervals: 0,
      missingBarsTotal: 0,
      repairedGapBars,
      chronologicalSorted: true,
      excludedUnclosedCandle: stats.excludedUnclosedCandle,
      lastClosedOpenTimeMs: getLatestClosedOpenTimeMs(nowMs),
      verifiedAtIso: new Date(nowMs).toISOString(),
    };
  }

  const startTimestampMs = series.openTimeMs[0];
  const endTimestampMs = series.openTimeMs[series.count - 1];
  const expectedBarsInSpan = Math.round((endTimestampMs - startTimestampMs) / BAR_INTERVAL_MS) + 1;
  const { gaps, missingBarsTotal, chronologicalSorted } = detectGapsInSeries(series);

  return {
    totalStoredBars: series.count,
    expectedBarsInSpan,
    startTimestampMs,
    endTimestampMs,
    duplicateRowsRemoved: stats.duplicateRowsRemoved,
    abnormalRowsDropped: stats.abnormalRowsDropped,
    missingGapIntervals: gaps.length,
    missingBarsTotal,
    repairedGapBars,
    chronologicalSorted,
    excludedUnclosedCandle: stats.excludedUnclosedCandle,
    lastClosedOpenTimeMs: endTimestampMs,
    verifiedAtIso: new Date(nowMs).toISOString(),
  };
}

export function mergeValidateCandles(
  existing: CandleTypedSeries | null,
  incoming: RawCandleBar[],
  nowMs = Date.now(),
): { series: CandleTypedSeries; stats: ValidationStats } {
  const latestClosed = getLatestClosedOpenTimeMs(nowMs);
  const dedupMap = new Map<number, RawCandleBar>();
  let duplicateRowsRemoved = 0;
  let abnormalRowsDropped = 0;
  let excludedUnclosedCandle = false;

  if (existing && existing.count > 0) {
    for (let i = 0; i < existing.count; i++) {
      const openTimeMs = existing.openTimeMs[i];
      if (openTimeMs > latestClosed) {
        excludedUnclosedCandle = true;
        continue;
      }
      dedupMap.set(openTimeMs, {
        openTimeMs,
        open: existing.open[i],
        high: existing.high[i],
        low: existing.low[i],
        close: existing.close[i],
        volume: existing.volume[i],
        quoteVolume: existing.quoteVolume[i],
      });
    }
  }

  for (let i = 0; i < incoming.length; i++) {
    const c = incoming[i];
    if (c.openTimeMs > latestClosed) {
      excludedUnclosedCandle = true;
      continue;
    }
    if (!isValidCandle(c)) {
      abnormalRowsDropped++;
      continue;
    }
    if (dedupMap.has(c.openTimeMs)) {
      duplicateRowsRemoved++;
    }
    dedupMap.set(c.openTimeMs, c);
  }

  const sorted = Array.from(dedupMap.values()).sort((a, b) => a.openTimeMs - b.openTimeMs);
  return {
    series: buildSeriesFromBars(sorted),
    stats: {
      duplicateRowsRemoved,
      abnormalRowsDropped,
      excludedUnclosedCandle,
    },
  };
}

export class CandleRepository {
  private readonly binPath: string;
  private readonly metaPath: string;

  constructor(dataDir = path.resolve(process.cwd(), 'data')) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.binPath = path.join(dataDir, 'btcusdt_5m.bin');
    this.metaPath = path.join(dataDir, 'btcusdt_5m.meta.json');
  }

  load(): { series: CandleTypedSeries; meta: PersistedMeta | null } {
    if (!fs.existsSync(this.binPath)) {
      return {
        series: buildSeriesFromBars([]),
        meta: null,
      };
    }

    const buf = fs.readFileSync(this.binPath);
    if (buf.byteLength < 16) {
      return {
        series: buildSeriesFromBars([]),
        meta: null,
      };
    }

    const magic = buf.subarray(0, 8).toString('utf8');
    if (magic !== MAGIC_HEADER) {
      throw new Error(`Invalid candle binary file header: ${magic}`);
    }

    const count = buf.readUInt32LE(8);
    const expectedBytes = 16 + count * 7 * 8;
    if (buf.byteLength < expectedBytes) {
      throw new Error(`Truncated candle binary file: expected ${expectedBytes} bytes, got ${buf.byteLength}`);
    }

    const colBytes = count * 8;
    const readCol = (colIndex: number): Float64Array => {
      const start = 16 + colIndex * colBytes;
      const slice = buf.subarray(start, start + colBytes);
      const copy = new Uint8Array(colBytes);
      copy.set(slice);
      return new Float64Array(copy.buffer);
    };

    const series: CandleTypedSeries = {
      count,
      openTimeMs: readCol(0),
      open: readCol(1),
      high: readCol(2),
      low: readCol(3),
      close: readCol(4),
      volume: readCol(5),
      quoteVolume: readCol(6),
    };

    let meta: PersistedMeta | null = null;
    if (fs.existsSync(this.metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(this.metaPath, 'utf8')) as PersistedMeta;
      } catch {
        meta = null;
      }
    }

    return { series, meta };
  }

  save(series: CandleTypedSeries, meta: PersistedMeta): void {
    const count = series.count;
    const colBytes = count * 8;
    const header = Buffer.alloc(16);
    header.write(MAGIC_HEADER, 0, 8, 'utf8');
    header.writeUInt32LE(count, 8);
    header.writeUInt32LE(0, 12);

    const cols = [
      series.openTimeMs,
      series.open,
      series.high,
      series.low,
      series.close,
      series.volume,
      series.quoteVolume,
    ];

    const out = Buffer.allocUnsafe(16 + cols.length * colBytes);
    header.copy(out, 0);
    for (let c = 0; c < cols.length; c++) {
      const bytes = Buffer.from(cols[c].buffer, cols[c].byteOffset, colBytes);
      bytes.copy(out, 16 + c * colBytes);
    }

    const tmpBin = `${this.binPath}.tmp`;
    const tmpMeta = `${this.metaPath}.tmp`;
    fs.writeFileSync(tmpBin, out);
    fs.renameSync(tmpBin, this.binPath);

    fs.writeFileSync(tmpMeta, JSON.stringify(meta, null, 2));
    fs.renameSync(tmpMeta, this.metaPath);
  }
}
