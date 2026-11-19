import type { RawCandleBar, SyncStatePhase, SyncStatus } from '../../src/types/signalAnalysis.ts';
import {
  BAR_INTERVAL_MS,
  CandleRepository,
  type CandleTypedSeries,
  computeIntegrityReport,
  detectGapsInSeries,
  getLatestClosedOpenTimeMs,
  mergeValidateCandles,
} from './candleRepository.ts';

const BINANCE_FAPI_KLINES = 'https://fapi.binance.com/fapi/v1/klines';
const SYMBOL = 'BTCUSDT';
const INTERVAL = '5m';
const PAGE_LIMIT = 1000;
const FOUR_YEARS_BARS = 4 * 365 * 288; // 420,480 bars
const WARMUP_BARS = 100;
const TARGET_TOTAL_BARS = FOUR_YEARS_BARS + WARMUP_BARS; // 420,580 bars
const MIN_REQUIRED_BARS = 400_000;
const WEIGHT_LIMIT_SOFT_CAP = 2050; // Binance IP limit is 2400 weight/1m
const FETCH_CONCURRENCY = 5;

type BinanceKlineTuple = [
  number, // 0 openTime
  string, // 1 open
  string, // 2 high
  string, // 3 low
  string, // 4 close
  string, // 5 volume
  number, // 6 closeTime
  string, // 7 quoteAssetVolume
  number, // 8 trades
  string, // 9 takerBuyBaseVolume
  string, // 10 takerBuyQuoteVolume
  string, // 11 ignore
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MarketDataService {
  private readonly repo: CandleRepository;
  private series: CandleTypedSeries;
  private phase: SyncStatePhase = 'idle';
  private completedPages = 0;
  private totalPages = 0;
  private usedWeight1m = 0;
  private lastUpdatedIso: string | null = null;
  private lastError: string | null = null;
  private activeSyncPromise: Promise<SyncStatus> | null = null;
  private cumulativeDupRemoved = 0;
  private cumulativeAbnormalDropped = 0;
  private cumulativeRepairedGaps = 0;
  private lastExcludedUnclosed = false;
  private listeners = new Set<() => void>();

  constructor(dataDir?: string) {
    this.repo = new CandleRepository(dataDir);
    const loaded = this.repo.load();
    this.series = loaded.series;
    if (loaded.meta) {
      this.lastUpdatedIso = loaded.meta.lastUpdatedIso;
      this.cumulativeDupRemoved = loaded.meta.integrity.duplicateRowsRemoved;
      this.cumulativeAbnormalDropped = loaded.meta.integrity.abnormalRowsDropped;
      this.cumulativeRepairedGaps = loaded.meta.integrity.repairedGapBars;
      this.lastExcludedUnclosed = loaded.meta.integrity.excludedUnclosedCandle;
    }
    if (this.series.count >= MIN_REQUIRED_BARS) {
      this.phase = 'ready';
    }
  }

  onSeriesChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifySeriesChanged(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  getSeries(): CandleTypedSeries {
    return this.series;
  }

  getStatus(): SyncStatus {
    const integrity = computeIntegrityReport(
      this.series,
      {
        duplicateRowsRemoved: this.cumulativeDupRemoved,
        abnormalRowsDropped: this.cumulativeAbnormalDropped,
        excludedUnclosedCandle: this.lastExcludedUnclosed,
      },
      this.cumulativeRepairedGaps,
    );

    const progressPercent =
      this.totalPages > 0
        ? Math.min(100, Math.round((this.completedPages / this.totalPages) * 1000) / 10)
        : this.series.count >= MIN_REQUIRED_BARS
          ? 100
          : 0;

    return {
      phase: this.phase,
      exchange: 'Binance USDⓈ-M Futures',
      symbol: SYMBOL,
      interval: INTERVAL,
      targetYears: 4,
      progressPercent,
      completedPages: this.completedPages,
      totalPages: this.totalPages,
      storedBars: this.series.count,
      targetMinBars: FOUR_YEARS_BARS,
      hasSufficientData: this.series.count >= MIN_REQUIRED_BARS && this.phase !== 'error',
      lastUpdatedIso: this.lastUpdatedIso,
      lastError: this.lastError,
      usedWeight1m: this.usedWeight1m,
      integrity,
    };
  }

  private async fetchKlinesPage(
    startTimeMs: number,
    endTimeMs: number,
    limit = PAGE_LIMIT,
  ): Promise<RawCandleBar[]> {
    const url = `${BINANCE_FAPI_KLINES}?symbol=${SYMBOL}&interval=${INTERVAL}&startTime=${startTimeMs}&endTime=${endTimeMs}&limit=${limit}`;
    const maxRetries = 5;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (this.usedWeight1m >= WEIGHT_LIMIT_SOFT_CAP) {
        const msIntoMinute = Date.now() % 60_000;
        const waitMs = Math.max(2000, 60_000 - msIntoMinute + 1500);
        await sleep(waitMs);
        this.usedWeight1m = 0;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'btc-derivatives-desk/1.0',
          },
        });
        clearTimeout(timer);

        const weightHeader = res.headers.get('x-mbx-used-weight-1m');
        if (weightHeader) {
          const parsedWeight = Number(weightHeader);
          if (Number.isFinite(parsedWeight)) {
            this.usedWeight1m = parsedWeight;
          }
        }

        if (res.status === 429 || res.status === 418) {
          const retryAfterSec = Number(res.headers.get('retry-after') ?? '15');
          const backoffMs = Math.max(retryAfterSec * 1000, 3000 * Math.pow(2, attempt));
          if (attempt < maxRetries) {
            await sleep(backoffMs);
            continue;
          }
          throw new Error(`Binance rate limit HTTP ${res.status}`);
        }

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          if (res.status >= 500 && attempt < maxRetries) {
            await sleep(800 * Math.pow(2, attempt));
            continue;
          }
          throw new Error(`Binance HTTP ${res.status}: ${text.slice(0, 180)}`);
        }

        const raw = (await res.json()) as BinanceKlineTuple[];
        if (!Array.isArray(raw)) {
          throw new Error('Unexpected Binance klines payload (non-array)');
        }

        return raw.map((row) => ({
          openTimeMs: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
          quoteVolume: Number(row[7]),
        }));
      } catch (err) {
        clearTimeout(timer);
        if (attempt < maxRetries) {
          await sleep(800 * Math.pow(2, attempt));
          continue;
        }
        throw err instanceof Error ? err : new Error(String(err));
      }
    }

    return [];
  }

  private commitBars(bars: RawCandleBar[]): number {
    const beforeCount = this.series.count;
    const { series, stats } = mergeValidateCandles(this.series, bars);
    this.series = series;
    this.cumulativeDupRemoved += stats.duplicateRowsRemoved;
    this.cumulativeAbnormalDropped += stats.abnormalRowsDropped;
    this.lastExcludedUnclosed = stats.excludedUnclosedCandle;
    this.lastUpdatedIso = new Date().toISOString();

    const integrity = computeIntegrityReport(
      this.series,
      {
        duplicateRowsRemoved: this.cumulativeDupRemoved,
        abnormalRowsDropped: this.cumulativeAbnormalDropped,
        excludedUnclosedCandle: this.lastExcludedUnclosed,
      },
      this.cumulativeRepairedGaps,
    );

    this.repo.save(this.series, {
      integrity,
      lastUpdatedIso: this.lastUpdatedIso,
    });

    this.notifySeriesChanged();
    return this.series.count - beforeCount;
  }

  async syncData(forceFullBackfill = false): Promise<SyncStatus> {
    if (this.activeSyncPromise) {
      return this.activeSyncPromise;
    }

    this.activeSyncPromise = this.executeSync(forceFullBackfill).finally(() => {
      this.activeSyncPromise = null;
    });
    return this.activeSyncPromise;
  }

  private async executeSync(forceFullBackfill: boolean): Promise<SyncStatus> {
    this.lastError = null;

    try {
      const latestClosedOpen = getLatestClosedOpenTimeMs();
      const targetStartOpen = latestClosedOpen - (TARGET_TOTAL_BARS - 1) * BAR_INTERVAL_MS;

      const needsFullBackfill =
        forceFullBackfill ||
        this.series.count < MIN_REQUIRED_BARS ||
        this.series.openTimeMs[0] > targetStartOpen + 288 * BAR_INTERVAL_MS;

      if (needsFullBackfill) {
        this.phase = 'backfilling';
        if (forceFullBackfill) {
          this.series = mergeValidateCandles(null, []).series;
          this.cumulativeDupRemoved = 0;
          this.cumulativeAbnormalDropped = 0;
          this.cumulativeRepairedGaps = 0;
        }

        const pageSpanMs = PAGE_LIMIT * BAR_INTERVAL_MS;
        const pageWindows: Array<{ start: number; end: number }> = [];
        for (let s = targetStartOpen; s <= latestClosedOpen; s += pageSpanMs) {
          const e = Math.min(latestClosedOpen, s + pageSpanMs - BAR_INTERVAL_MS);
          pageWindows.push({ start: s, end: e });
        }

        this.completedPages = 0;
        this.totalPages = pageWindows.length;
        const collected: RawCandleBar[] = [];

        for (let i = 0; i < pageWindows.length; i += FETCH_CONCURRENCY) {
          const batch = pageWindows.slice(i, i + FETCH_CONCURRENCY);
          const batchResults = await Promise.all(
            batch.map(async (w) => {
              const rows = await this.fetchKlinesPage(w.start, w.end, PAGE_LIMIT);
              this.completedPages++;
              return rows;
            }),
          );
          for (const rows of batchResults) {
            for (const r of rows) {
              collected.push(r);
            }
          }
          // Periodically persist every ~100 pages so restarts preserve progress
          if (collected.length >= 100_000) {
            this.commitBars(collected.splice(0, collected.length));
          }
        }

        if (collected.length > 0) {
          this.commitBars(collected);
        }
      } else {
        // Incremental update from latest stored openTimeMs
        const lastStoredOpen = this.series.openTimeMs[this.series.count - 1];
        const nextOpen = lastStoredOpen + BAR_INTERVAL_MS;
        if (nextOpen <= latestClosedOpen) {
          this.phase = 'updating_incremental';
          const pageSpanMs = PAGE_LIMIT * BAR_INTERVAL_MS;
          const incWindows: Array<{ start: number; end: number }> = [];
          for (let s = nextOpen; s <= latestClosedOpen; s += pageSpanMs) {
            const e = Math.min(latestClosedOpen, s + pageSpanMs - BAR_INTERVAL_MS);
            incWindows.push({ start: s, end: e });
          }

          this.completedPages = 0;
          this.totalPages = incWindows.length;
          const incBars: RawCandleBar[] = [];

          for (let i = 0; i < incWindows.length; i += FETCH_CONCURRENCY) {
            const batch = incWindows.slice(i, i + FETCH_CONCURRENCY);
            const results = await Promise.all(
              batch.map(async (w) => {
                const rows = await this.fetchKlinesPage(w.start, w.end, PAGE_LIMIT);
                this.completedPages++;
                return rows;
              }),
            );
            for (const rows of results) {
              for (const r of rows) {
                incBars.push(r);
              }
            }
          }
          if (incBars.length > 0) {
            this.commitBars(incBars);
          }
        }
      }

      // Check & repair any missing gaps in stored span (limit max 25 gap repairs per run)
      const { gaps } = detectGapsInSeries(this.series);
      if (gaps.length > 0) {
        this.phase = 'repairing_gaps';
        const repairable = gaps.slice(0, 40);
        const repairedBars: RawCandleBar[] = [];
        for (const gap of repairable) {
          const pageSpanMs = PAGE_LIMIT * BAR_INTERVAL_MS;
          for (let s = gap.startOpenTimeMs; s <= gap.endOpenTimeMs; s += pageSpanMs) {
            const e = Math.min(gap.endOpenTimeMs, s + pageSpanMs - BAR_INTERVAL_MS);
            const rows = await this.fetchKlinesPage(s, e, PAGE_LIMIT);
            for (const r of rows) repairedBars.push(r);
          }
        }
        if (repairedBars.length > 0) {
          const added = this.commitBars(repairedBars);
          if (added > 0) {
            this.cumulativeRepairedGaps += added;
          }
        }
      }

      if (this.series.count < MIN_REQUIRED_BARS) {
        throw new Error(
          `수집된 5분봉 수(${this.series.count.toLocaleString()})가 최소 분석 기준(${MIN_REQUIRED_BARS.toLocaleString()})에 미달합니다.`,
        );
      }

      this.phase = 'ready';
      this.completedPages = this.totalPages;
      return this.getStatus();
    } catch (err) {
      this.phase = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      return this.getStatus();
    }
  }
}
