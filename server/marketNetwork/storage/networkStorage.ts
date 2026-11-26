import fs from 'fs';
import path from 'path';
import type {
  MacroId,
  MacroObservation,
  MarketDataStatus,
  MarketProviderId,
  NetworkOhlcvBar,
} from '../../../src/types/marketNetwork.ts';

export const BAR_INTERVAL_MS = 300_000;
const MAGIC_HEADER = 'MN5M01\0\0'; // 8 bytes

export interface Stored5mMeta {
  symbol: string;
  provider: MarketProviderId;
  cadence: '5m';
  lastUpdatedIso: string;
  startTimestampMs: number | null;
  endTimestampMs: number | null;
  barCount: number;
}

export interface StoredMacroSeries {
  id: MacroId;
  seriesCode: string;
  provider: MarketProviderId;
  providerLabel: string;
  cadence: '1d' | '1mo';
  status: MarketDataStatus;
  errorMessage: string | null;
  lastUpdatedIso: string;
  observations: MacroObservation[];
}

export function getLatestClosed5mOpenMs(nowMs = Date.now()): number {
  return Math.floor(nowMs / BAR_INTERVAL_MS) * BAR_INTERVAL_MS - BAR_INTERVAL_MS;
}

export function isValidOhlcvBar(bar: NetworkOhlcvBar, latestClosedOpenMs: number): boolean {
  if (
    !Number.isFinite(bar.openTimeMs) ||
    !Number.isFinite(bar.open) ||
    !Number.isFinite(bar.high) ||
    !Number.isFinite(bar.low) ||
    !Number.isFinite(bar.close) ||
    !Number.isFinite(bar.volume) ||
    !Number.isFinite(bar.quoteVolume)
  ) {
    return false;
  }
  if (bar.openTimeMs <= 0 || bar.openTimeMs > latestClosedOpenMs) return false;
  if (bar.openTimeMs % BAR_INTERVAL_MS !== 0) return false;
  if (bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0) return false;
  if (bar.high < bar.low) return false;
  if (bar.volume < 0 || bar.quoteVolume < 0) return false;
  return true;
}

export function mergeNormalizeOhlcvBars(
  existing: readonly NetworkOhlcvBar[],
  incoming: readonly NetworkOhlcvBar[],
  maxBarsRetention = 9_500, // Keep >32 days of 5m bars cleanly
  nowMs = Date.now(),
): NetworkOhlcvBar[] {
  const latestClosed = getLatestClosed5mOpenMs(nowMs);
  const byTime = new Map<number, NetworkOhlcvBar>();

  for (const b of existing) {
    if (isValidOhlcvBar(b, latestClosed)) {
      byTime.set(b.openTimeMs, b);
    }
  }
  for (const b of incoming) {
    if (isValidOhlcvBar(b, latestClosed)) {
      byTime.set(b.openTimeMs, b);
    }
  }

  const sorted = Array.from(byTime.values()).sort((a, b) => a.openTimeMs - b.openTimeMs);
  if (sorted.length > maxBarsRetention) {
    return sorted.slice(sorted.length - maxBarsRetention);
  }
  return sorted;
}

export class MarketNetworkStorage {
  private readonly baseDir: string;

  constructor(baseDir = path.resolve(process.cwd(), 'data', 'market-network')) {
    this.baseDir = path.resolve(baseDir);
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  private resolveSafePath(fileName: string): string {
    const clean = path.basename(fileName);
    const resolved = path.resolve(this.baseDir, clean);
    if (!resolved.startsWith(this.baseDir + path.sep)) {
      throw new Error(`Unsafe storage path rejected: ${fileName}`);
    }
    return resolved;
  }

  private sanitizeKey(raw: string): string {
    if (!/^[A-Za-z0-9_-]{2,32}$/.test(raw)) {
      throw new Error(`Invalid storage key: ${raw}`);
    }
    return raw;
  }

  loadAsset5m(symbol: string): { bars: NetworkOhlcvBar[]; meta: Stored5mMeta | null } {
    const key = this.sanitizeKey(symbol);
    const binPath = this.resolveSafePath(`${key}_5m.bin`);
    const metaPath = this.resolveSafePath(`${key}_5m.meta.json`);

    if (!fs.existsSync(binPath)) {
      return { bars: [], meta: null };
    }

    const buf = fs.readFileSync(binPath);
    if (buf.byteLength < 16) {
      return { bars: [], meta: null };
    }

    const magic = buf.subarray(0, 8).toString('utf8');
    if (magic !== MAGIC_HEADER) {
      return { bars: [], meta: null };
    }

    const count = buf.readUInt32LE(8);
    const expectedBytes = 16 + count * 7 * 8;
    if (buf.byteLength < expectedBytes) {
      return { bars: [], meta: null };
    }

    const bars: NetworkOhlcvBar[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const offset = 16 + i * 7 * 8;
      bars[i] = {
        openTimeMs: buf.readDoubleLE(offset),
        open: buf.readDoubleLE(offset + 8),
        high: buf.readDoubleLE(offset + 16),
        low: buf.readDoubleLE(offset + 24),
        close: buf.readDoubleLE(offset + 32),
        volume: buf.readDoubleLE(offset + 40),
        quoteVolume: buf.readDoubleLE(offset + 48),
      };
    }

    let meta: Stored5mMeta | null = null;
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Stored5mMeta;
      } catch {
        meta = null;
      }
    }

    return { bars, meta };
  }

  saveAsset5m(
    symbol: string,
    provider: MarketProviderId,
    bars: readonly NetworkOhlcvBar[],
    lastUpdatedIso: string,
  ): Stored5mMeta {
    const key = this.sanitizeKey(symbol);
    const binPath = this.resolveSafePath(`${key}_5m.bin`);
    const metaPath = this.resolveSafePath(`${key}_5m.meta.json`);

    const count = bars.length;
    const out = Buffer.allocUnsafe(16 + count * 7 * 8);
    out.write(MAGIC_HEADER, 0, 8, 'utf8');
    out.writeUInt32LE(count, 8);
    out.writeUInt32LE(0, 12);

    for (let i = 0; i < count; i++) {
      const b = bars[i];
      const offset = 16 + i * 7 * 8;
      out.writeDoubleLE(b.openTimeMs, offset);
      out.writeDoubleLE(b.open, offset + 8);
      out.writeDoubleLE(b.high, offset + 16);
      out.writeDoubleLE(b.low, offset + 24);
      out.writeDoubleLE(b.close, offset + 32);
      out.writeDoubleLE(b.volume, offset + 40);
      out.writeDoubleLE(b.quoteVolume, offset + 48);
    }

    const meta: Stored5mMeta = {
      symbol: key,
      provider,
      cadence: '5m',
      lastUpdatedIso,
      startTimestampMs: count > 0 ? bars[0].openTimeMs : null,
      endTimestampMs: count > 0 ? bars[count - 1].openTimeMs : null,
      barCount: count,
    };

    const tmpBin = `${binPath}.tmp`;
    const tmpMeta = `${metaPath}.tmp`;
    fs.writeFileSync(tmpBin, out);
    fs.renameSync(tmpBin, binPath);
    fs.writeFileSync(tmpMeta, JSON.stringify(meta, null, 2));
    fs.renameSync(tmpMeta, metaPath);

    return meta;
  }

  loadMacro(id: MacroId): StoredMacroSeries | null {
    const key = this.sanitizeKey(id);
    const filePath = this.resolveSafePath(`macro_${key}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as StoredMacroSeries;
    } catch {
      return null;
    }
  }

  saveMacro(series: StoredMacroSeries): void {
    const key = this.sanitizeKey(series.id);
    const filePath = this.resolveSafePath(`macro_${key}.json`);
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(series, null, 2));
    fs.renameSync(tmp, filePath);
  }
}
