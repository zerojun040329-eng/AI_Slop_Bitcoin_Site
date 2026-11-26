import type { CandleTypedSeries } from '../../services/candleRepository.ts';
import type {
  AssetCorrelationMatrix,
  AssetId,
  AssetMarketSummary,
  AssetOhlcvResponse,
  BtcMacroCrossAnalysis,
  MacroCorrelationSummary,
  MacroId,
  MacroIndicatorSummary,
  MarketNetworkOverviewResponse,
  MarketNetworkStatusResponse,
  NetworkOhlcvBar,
  ProviderHealthStatus,
} from '../../../src/types/marketNetwork.ts';
import {
  computeAssetCorrelationMatrix,
  computeAssetMomentumStats,
  computeBtcMacroCrossAnalysis,
  computeM2YoYSeries,
  computeMacroCorrelations,
} from '../correlation/correlationEngine.ts';
import { BybitProvider, NON_BTC_ASSET_SPECS } from '../providers/bybitProvider.ts';
import { fetchFredSeries } from '../providers/fredProvider.ts';
import { fetchYahooDxyDaily } from '../providers/yahooProvider.ts';
import {
  MarketNetworkStorage,
  mergeNormalizeOhlcvBars,
  type StoredMacroSeries,
} from '../storage/networkStorage.ts';

const ALL_ASSET_IDS: readonly AssetId[] = ['BTC', 'SPY', 'QQQ', 'XAU', 'WTI', 'TLT', 'EEM'];
const ASSET_SYNC_COOLDOWN_MS = 5 * 60_000;
const MACRO_SYNC_COOLDOWN_MS = 30 * 60_000;
const THIRTY_TWO_DAYS_MS = 32 * 24 * 60 * 60_000;

export interface ReadOnlyBtcAdapters {
  /** Read-only reference to existing 4-year 5m typed array store (never mutates) */
  getBtc5mSeries: () => CandleTypedSeries;
  getBtc5mMeta: () => { lastUpdatedIso: string | null; hasSufficientData: boolean };
  /** Read-only reference to existing Coin Metrics daily BTC price cache */
  getBtcDailyHistory: () => Promise<Array<{ date: string; priceUsd: number }>>;
  /** Triggers 4-year 5m BTC store sync when Home loads before Signal Analysis is visited */
  ensureBtc5mSync?: () => Promise<unknown>;
  isBtc5mSyncing?: () => boolean;
}

export class MarketNetworkService {
  private readonly storage = new MarketNetworkStorage();
  private readonly bybit = new BybitProvider();
  private readonly btcAdapters: ReadOnlyBtcAdapters;

  private readonly nonBtcBars = new Map<AssetId, NetworkOhlcvBar[]>();
  private readonly assetSummaries = new Map<AssetId, AssetMarketSummary>();
  private readonly macroSeries = new Map<MacroId, StoredMacroSeries>();
  private readonly macroSummaries = new Map<MacroId, MacroIndicatorSummary>();

  private activeSyncPromise: Promise<void> | null = null;
  private lastFullSyncMs = 0;
  private lastFullSyncIso: string | null = null;
  private lastMacroSyncMs = 0;

  constructor(btcAdapters: ReadOnlyBtcAdapters) {
    this.btcAdapters = btcAdapters;
    this.hydrateFromDisk();
  }

  private hydrateFromDisk(): void {
    // Load previously persisted non-BTC 5m assets from independent storage
    for (const spec of NON_BTC_ASSET_SPECS) {
      for (const candidate of spec.candidateSymbols) {
        const loaded = this.storage.loadAsset5m(candidate);
        if (loaded.bars.length > 0 && loaded.meta) {
          this.nonBtcBars.set(spec.id, loaded.bars);
          const stats = computeAssetMomentumStats(loaded.bars);
          this.assetSummaries.set(spec.id, {
            id: spec.id,
            name: spec.name,
            targetDescription: spec.targetDescription,
            symbol: loaded.meta.symbol,
            instrumentType: 'tradfi_perpetual',
            bybitSymbolType: null,
            provider: 'bybit',
            providerLabel: 'Bybit Linear Perpetual',
            cadence: '5m',
            status: 'ok',
            errorMessage: null,
            lastUpdatedIso: loaded.meta.lastUpdatedIso,
            latestTimestampMs: stats.latestTimestampMs,
            latestTimestampIso:
              stats.latestTimestampMs !== null
                ? new Date(stats.latestTimestampMs).toISOString()
                : null,
            latestPrice: stats.latestPrice,
            change1hPct: stats.change1hPct,
            change4hPct: stats.change4hPct,
            change24hPct: stats.change24hPct,
            storedBars: loaded.bars.length,
          });
          break;
        }
      }
    }

    // Load previously persisted macro series
    for (const id of ['DXY', 'M2', 'DGS10'] as const) {
      const saved = this.storage.loadMacro(id);
      if (saved) {
        this.macroSeries.set(id, saved);
        this.macroSummaries.set(id, this.buildMacroSummary(saved));
      }
    }
  }

  /**
   * Read-only slice of the last ~32 days from the existing BTC 5m binary store.
   * Never mutates, writes, or duplicates BTC 5m storage.
   */
  private readBtc5mWindowBars(maxWindowMs = THIRTY_TWO_DAYS_MS): NetworkOhlcvBar[] {
    const series = this.btcAdapters.getBtc5mSeries();
    const count = series.count;
    if (count === 0) return [];

    const latestTs = series.openTimeMs[count - 1];
    const cutoff = latestTs - maxWindowMs;

    // Binary search start index >= cutoff
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (series.openTimeMs[mid] < cutoff) lo = mid + 1;
      else hi = mid;
    }

    const bars: NetworkOhlcvBar[] = new Array(count - lo);
    for (let i = lo; i < count; i++) {
      bars[i - lo] = {
        openTimeMs: series.openTimeMs[i],
        open: series.open[i],
        high: series.high[i],
        low: series.low[i],
        close: series.close[i],
        volume: series.volume[i],
        quoteVolume: series.quoteVolume[i],
      };
    }
    return bars;
  }

  private buildBtcAssetSummary(btcBars: readonly NetworkOhlcvBar[]): AssetMarketSummary {
    const meta = this.btcAdapters.getBtc5mMeta();
    const isSyncing = this.btcAdapters.isBtc5mSyncing?.() ?? false;
    const isBackfilling = isSyncing && !meta.hasSufficientData;

    if (isBackfilling) {
      return {
        id: 'BTC',
        name: 'BTC',
        targetDescription: 'BTCUSDT (기존 BTC 5분봉 저장소 읽기 전용)',
        symbol: 'BTCUSDT',
        instrumentType: 'crypto_perpetual',
        bybitSymbolType: 'CryptoLinearPerpetual',
        provider: 'btc_local_store',
        providerLabel: '기존 BTC 5m 저장소 (Read-Only)',
        cadence: '5m',
        status: 'syncing',
        errorMessage: '4년 5분봉 BTC 데이터를 로딩하는 중입니다.',
        lastUpdatedIso: meta.lastUpdatedIso ?? new Date().toISOString(),
        latestTimestampMs: null,
        latestTimestampIso: null,
        latestPrice: null,
        change1hPct: null,
        change4hPct: null,
        change24hPct: null,
        storedBars: this.btcAdapters.getBtc5mSeries().count,
      };
    }

    const stats = computeAssetMomentumStats(btcBars);
    const hasBars = btcBars.length > 0;

    return {
      id: 'BTC',
      name: 'BTC',
      targetDescription: 'BTCUSDT (기존 BTC 5분봉 저장소 읽기 전용)',
      symbol: 'BTCUSDT',
      instrumentType: 'crypto_perpetual',
      bybitSymbolType: 'CryptoLinearPerpetual',
      provider: 'btc_local_store',
      providerLabel: '기존 BTC 5m 저장소 (Read-Only)',
      cadence: '5m',
      status: hasBars ? 'ok' : 'error',
      errorMessage: hasBars
        ? null
        : '기존 BTC 5분봉 저장소(btcusdt_5m.bin)에 조회 가능한 데이터가 없습니다.',
      lastUpdatedIso: meta.lastUpdatedIso ?? new Date().toISOString(),
      latestTimestampMs: stats.latestTimestampMs,
      latestTimestampIso:
        stats.latestTimestampMs !== null ? new Date(stats.latestTimestampMs).toISOString() : null,
      latestPrice: stats.latestPrice,
      change1hPct: stats.change1hPct,
      change4hPct: stats.change4hPct,
      change24hPct: stats.change24hPct,
      storedBars: this.btcAdapters.getBtc5mSeries().count,
    };
  }

  private buildMacroSummary(stored: StoredMacroSeries): MacroIndicatorSummary {
    const obs = stored.observations;
    const latest = obs.length > 0 ? obs[obs.length - 1] : null;

    if (stored.id === 'M2') {
      const yoySeries = computeM2YoYSeries(obs);
      const latestYoy = yoySeries.length > 0 ? yoySeries[yoySeries.length - 1] : null;
      return {
        id: 'M2',
        name: '미국 M2 증가율',
        seriesCode: stored.seriesCode,
        provider: stored.provider,
        providerLabel: stored.providerLabel,
        cadence: '1mo',
        unit: 'Billions USD (YoY %)',
        status: stored.status,
        errorMessage: stored.errorMessage,
        lastUpdatedIso: stored.lastUpdatedIso,
        latestDate: latestYoy?.date ?? latest?.date ?? null,
        latestValue: latest?.value ?? null,
        changeLabel: '전년 동월 대비(YoY)',
        changeValue: latestYoy ? latestYoy.yoyPct : null,
        changeUnit: '%',
        pointCount: obs.length,
        recentObservations: obs.slice(-36),
      };
    }

    if (stored.id === 'DXY') {
      const prev = obs.length >= 2 ? obs[obs.length - 2] : null;
      const pct =
        latest && prev && prev.value > 0
          ? ((latest.value - prev.value) / prev.value) * 100
          : null;
      return {
        id: 'DXY',
        name: '달러 인덱스 (DXY)',
        seriesCode: stored.seriesCode,
        provider: stored.provider,
        providerLabel: stored.providerLabel,
        cadence: '1d',
        unit: 'Index',
        status: stored.status,
        errorMessage: stored.errorMessage,
        lastUpdatedIso: stored.lastUpdatedIso,
        latestDate: latest?.date ?? null,
        latestValue: latest?.value ?? null,
        changeLabel: '일간 변화율',
        changeValue: pct,
        changeUnit: '%',
        pointCount: obs.length,
        recentObservations: obs.slice(-90),
      };
    }

    // DGS10
    const prev = obs.length >= 2 ? obs[obs.length - 2] : null;
    const diffPp = latest && prev ? latest.value - prev.value : null;
    return {
      id: 'DGS10',
      name: '미국 10년물 국채금리',
      seriesCode: stored.seriesCode,
      provider: stored.provider,
      providerLabel: stored.providerLabel,
      cadence: '1d',
      unit: '%',
      status: stored.status,
      errorMessage: stored.errorMessage,
      lastUpdatedIso: stored.lastUpdatedIso,
      latestDate: latest?.date ?? null,
      latestValue: latest?.value ?? null,
      changeLabel: '일간 금리 변화량',
      changeValue: diffPp,
      changeUnit: '%p',
      pointCount: obs.length,
      recentObservations: obs.slice(-90),
    };
  }

  async ensureSynced(force = false): Promise<void> {
    if (this.btcAdapters.ensureBtc5mSync) {
      const meta = this.btcAdapters.getBtc5mMeta();
      if (!meta.hasSufficientData && !this.btcAdapters.isBtc5mSyncing?.()) {
        // Trigger 4-year BTC 5m backfill immediately in background on Home load
        void this.btcAdapters.ensureBtc5mSync();
      }
    }

    const now = Date.now();
    const needsAssetSync =
      force || this.lastFullSyncMs === 0 || now - this.lastFullSyncMs > ASSET_SYNC_COOLDOWN_MS;
    const needsMacroSync =
      force || this.lastMacroSyncMs === 0 || now - this.lastMacroSyncMs > MACRO_SYNC_COOLDOWN_MS;

    if (!needsAssetSync && !needsMacroSync) {
      return;
    }

    if (this.activeSyncPromise) {
      // If we already have initial data and this is just a background refresh, don't block callers unless forced
      if (!force && this.lastFullSyncMs > 0) return;
      await this.activeSyncPromise;
      return;
    }

    const syncJob = this.runIsolatedSync(needsAssetSync, needsMacroSync).finally(() => {
      this.activeSyncPromise = null;
    });
    this.activeSyncPromise = syncJob;

    // Await initial cold sync or forced sync; otherwise refresh in background
    if (force || this.lastFullSyncMs === 0) {
      await syncJob;
    }
  }

  private async runIsolatedSync(syncAssets: boolean, syncMacro: boolean): Promise<void> {
    const tasks: Promise<unknown>[] = [];

    if (syncAssets) {
      tasks.push(this.syncBybitAssets());
      if (this.btcAdapters.ensureBtc5mSync && this.btcAdapters.getBtc5mMeta().hasSufficientData) {
        tasks.push(this.btcAdapters.ensureBtc5mSync());
      }
    }
    if (syncMacro) {
      tasks.push(this.syncMacroIndicators());
    }

    await Promise.allSettled(tasks);
    const now = Date.now();
    if (syncAssets) {
      this.lastFullSyncMs = now;
      this.lastFullSyncIso = new Date(now).toISOString();
    }
    if (syncMacro) {
      this.lastMacroSyncMs = now;
    }
  }

  private async syncBybitAssets(): Promise<void> {
    let instruments: Awaited<ReturnType<BybitProvider['getLinearInstruments']>> | null = null;
    let instrumentsError: string | null = null;

    try {
      instruments = await this.bybit.getLinearInstruments(false);
    } catch (err) {
      instrumentsError = err instanceof Error ? err.message : String(err);
    }

    await Promise.allSettled(
      NON_BTC_ASSET_SPECS.map(async (spec) => {
        const nowIso = new Date().toISOString();
        if (!instruments) {
          const existingBars = this.nonBtcBars.get(spec.id) ?? [];
          const stats = computeAssetMomentumStats(existingBars);
          this.assetSummaries.set(spec.id, {
            id: spec.id,
            name: spec.name,
            targetDescription: spec.targetDescription,
            symbol: null,
            instrumentType: 'unsupported',
            bybitSymbolType: null,
            provider: 'bybit',
            providerLabel: 'Bybit Linear Perpetual',
            cadence: '5m',
            status: 'error',
            errorMessage: `Bybit 상품 목록 조회 실패: ${instrumentsError}`,
            lastUpdatedIso: nowIso,
            latestTimestampMs: stats.latestTimestampMs,
            latestTimestampIso:
              stats.latestTimestampMs !== null
                ? new Date(stats.latestTimestampMs).toISOString()
                : null,
            latestPrice: stats.latestPrice,
            change1hPct: stats.change1hPct,
            change4hPct: stats.change4hPct,
            change24hPct: stats.change24hPct,
            storedBars: existingBars.length,
          });
          return;
        }

        const resolved = this.bybit.resolveInstrument(spec, instruments);
        if (!resolved.supported || !resolved.instrument) {
          this.nonBtcBars.delete(spec.id);
          this.assetSummaries.set(spec.id, {
            id: spec.id,
            name: spec.name,
            targetDescription: spec.targetDescription,
            symbol: null,
            instrumentType: 'unsupported',
            bybitSymbolType: null,
            provider: 'bybit',
            providerLabel: 'Bybit Linear Perpetual',
            cadence: '5m',
            status: 'unsupported',
            errorMessage: resolved.reason,
            lastUpdatedIso: nowIso,
            latestTimestampMs: null,
            latestTimestampIso: null,
            latestPrice: null,
            change1hPct: null,
            change4hPct: null,
            change24hPct: null,
            storedBars: 0,
          });
          return;
        }

        const symbol = resolved.instrument.symbol;
        const loaded = this.storage.loadAsset5m(symbol);
        const lastOpenMs =
          loaded.bars.length > 0 ? loaded.bars[loaded.bars.length - 1].openTimeMs : null;

        try {
          const incoming = await this.bybit.fetchMissing5mBars(symbol, lastOpenMs);
          const merged = mergeNormalizeOhlcvBars(loaded.bars, incoming);
          const savedMeta = this.storage.saveAsset5m(symbol, 'bybit', merged, nowIso);
          this.nonBtcBars.set(spec.id, merged);

          const stats = computeAssetMomentumStats(merged);
          this.assetSummaries.set(spec.id, {
            id: spec.id,
            name: spec.name,
            targetDescription: spec.targetDescription,
            symbol,
            instrumentType: resolved.instrumentType,
            bybitSymbolType: resolved.instrument.symbolType || 'crypto',
            provider: 'bybit',
            providerLabel:
              resolved.instrumentType === 'tradfi_perpetual'
                ? `Bybit TradFi Perpetual (${resolved.instrument.symbolType})`
                : 'Bybit Crypto Perpetual',
            cadence: '5m',
            status: merged.length > 0 ? 'ok' : 'error',
            errorMessage: merged.length > 0 ? null : `${symbol} 5분봉 데이터를 수신하지 못했습니다.`,
            lastUpdatedIso: savedMeta.lastUpdatedIso,
            latestTimestampMs: stats.latestTimestampMs,
            latestTimestampIso:
              stats.latestTimestampMs !== null
                ? new Date(stats.latestTimestampMs).toISOString()
                : null,
            latestPrice: stats.latestPrice,
            change1hPct: stats.change1hPct,
            change4hPct: stats.change4hPct,
            change24hPct: stats.change24hPct,
            storedBars: merged.length,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const fallbackBars = loaded.bars;
          if (fallbackBars.length > 0) {
            this.nonBtcBars.set(spec.id, fallbackBars);
          }
          const stats = computeAssetMomentumStats(fallbackBars);
          this.assetSummaries.set(spec.id, {
            id: spec.id,
            name: spec.name,
            targetDescription: spec.targetDescription,
            symbol,
            instrumentType: resolved.instrumentType,
            bybitSymbolType: resolved.instrument.symbolType || 'crypto',
            provider: 'bybit',
            providerLabel: 'Bybit Linear Perpetual',
            cadence: '5m',
            status: 'error',
            errorMessage: `${symbol} 수집 실패: ${msg}`,
            lastUpdatedIso: loaded.meta?.lastUpdatedIso ?? nowIso,
            latestTimestampMs: stats.latestTimestampMs,
            latestTimestampIso:
              stats.latestTimestampMs !== null
                ? new Date(stats.latestTimestampMs).toISOString()
                : null,
            latestPrice: stats.latestPrice,
            change1hPct: stats.change1hPct,
            change4hPct: stats.change4hPct,
            change24hPct: stats.change24hPct,
            storedBars: fallbackBars.length,
          });
        }
      }),
    );
  }

  private async syncMacroIndicators(): Promise<void> {
    await Promise.allSettled([
      // 1. Yahoo Finance DX-Y.NYB
      (async () => {
        const nowIso = new Date().toISOString();
        try {
          const res = await fetchYahooDxyDaily('5y');
          const stored: StoredMacroSeries = {
            id: 'DXY',
            seriesCode: 'DX-Y.NYB',
            provider: 'yahoo_finance',
            providerLabel: 'Yahoo Finance (DX-Y.NYB)',
            cadence: '1d',
            status: 'ok',
            errorMessage: null,
            lastUpdatedIso: res.fetchedAtIso,
            observations: res.observations,
          };
          this.storage.saveMacro(stored);
          this.macroSeries.set('DXY', stored);
          this.macroSummaries.set('DXY', this.buildMacroSummary(stored));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const prev = this.macroSeries.get('DXY') ?? this.storage.loadMacro('DXY');
          const errStored: StoredMacroSeries = {
            id: 'DXY',
            seriesCode: 'DX-Y.NYB',
            provider: 'yahoo_finance',
            providerLabel: 'Yahoo Finance (DX-Y.NYB)',
            cadence: '1d',
            status: 'error',
            errorMessage: msg,
            lastUpdatedIso: prev?.lastUpdatedIso ?? nowIso,
            observations: prev?.observations ?? [],
          };
          this.macroSeries.set('DXY', errStored);
          this.macroSummaries.set('DXY', this.buildMacroSummary(errStored));
        }
      })(),

      // 2. FRED M2SL
      (async () => {
        const nowIso = new Date().toISOString();
        try {
          const res = await fetchFredSeries('M2SL');
          const stored: StoredMacroSeries = {
            id: 'M2',
            seriesCode: 'M2SL',
            provider: 'fred',
            providerLabel: res.providerLabel,
            cadence: '1mo',
            status: 'ok',
            errorMessage: null,
            lastUpdatedIso: res.fetchedAtIso,
            observations: res.observations,
          };
          this.storage.saveMacro(stored);
          this.macroSeries.set('M2', stored);
          this.macroSummaries.set('M2', this.buildMacroSummary(stored));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const prev = this.macroSeries.get('M2') ?? this.storage.loadMacro('M2');
          const errStored: StoredMacroSeries = {
            id: 'M2',
            seriesCode: 'M2SL',
            provider: 'fred',
            providerLabel: 'FRED (M2SL)',
            cadence: '1mo',
            status: 'error',
            errorMessage: msg,
            lastUpdatedIso: prev?.lastUpdatedIso ?? nowIso,
            observations: prev?.observations ?? [],
          };
          this.macroSeries.set('M2', errStored);
          this.macroSummaries.set('M2', this.buildMacroSummary(errStored));
        }
      })(),

      // 3. FRED DGS10
      (async () => {
        const nowIso = new Date().toISOString();
        try {
          const res = await fetchFredSeries('DGS10');
          const stored: StoredMacroSeries = {
            id: 'DGS10',
            seriesCode: 'DGS10',
            provider: 'fred',
            providerLabel: res.providerLabel,
            cadence: '1d',
            status: 'ok',
            errorMessage: null,
            lastUpdatedIso: res.fetchedAtIso,
            observations: res.observations,
          };
          this.storage.saveMacro(stored);
          this.macroSeries.set('DGS10', stored);
          this.macroSummaries.set('DGS10', this.buildMacroSummary(stored));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const prev = this.macroSeries.get('DGS10') ?? this.storage.loadMacro('DGS10');
          const errStored: StoredMacroSeries = {
            id: 'DGS10',
            seriesCode: 'DGS10',
            provider: 'fred',
            providerLabel: 'FRED (DGS10)',
            cadence: '1d',
            status: 'error',
            errorMessage: msg,
            lastUpdatedIso: prev?.lastUpdatedIso ?? nowIso,
            observations: prev?.observations ?? [],
          };
          this.macroSeries.set('DGS10', errStored);
          this.macroSummaries.set('DGS10', this.buildMacroSummary(errStored));
        }
      })(),
    ]);
  }

  private getOrderedAssets(): {
    summaries: AssetMarketSummary[];
    seriesMap: Map<AssetId, NetworkOhlcvBar[]>;
  } {
    const btcBars = this.readBtc5mWindowBars();
    const btcSummary = this.buildBtcAssetSummary(btcBars);
    const seriesMap = new Map<AssetId, NetworkOhlcvBar[]>();
    if (btcSummary.status === 'ok') {
      seriesMap.set('BTC', btcBars);
    }

    const summaries: AssetMarketSummary[] = [btcSummary];
    for (const spec of NON_BTC_ASSET_SPECS) {
      const bars = this.nonBtcBars.get(spec.id) ?? [];
      if (bars.length > 0) {
        seriesMap.set(spec.id, bars);
      }
      const existing = this.assetSummaries.get(spec.id);
      if (existing) {
        summaries.push(existing);
      } else {
        summaries.push({
          id: spec.id,
          name: spec.name,
          targetDescription: spec.targetDescription,
          symbol: null,
          instrumentType: 'unsupported',
          bybitSymbolType: null,
          provider: 'bybit',
          providerLabel: 'Bybit Linear Perpetual',
          cadence: '5m',
          status: 'error',
          errorMessage: '아직 동기화되지 않았습니다.',
          lastUpdatedIso: null,
          latestTimestampMs: null,
          latestTimestampIso: null,
          latestPrice: null,
          change1hPct: null,
          change4hPct: null,
          change24hPct: null,
          storedBars: 0,
        });
      }
    }

    return { summaries, seriesMap };
  }

  private getOrderedMacro(): MacroIndicatorSummary[] {
    return (['DXY', 'M2', 'DGS10'] as const).map((id) => {
      const existing = this.macroSummaries.get(id);
      if (existing) return existing;
      return {
        id,
        name: id === 'DXY' ? '달러 인덱스 (DXY)' : id === 'M2' ? '미국 M2 증가율' : '미국 10년물 국채금리',
        seriesCode: id === 'DXY' ? 'DX-Y.NYB' : id === 'M2' ? 'M2SL' : 'DGS10',
        provider: id === 'DXY' ? 'yahoo_finance' : 'fred',
        providerLabel: id === 'DXY' ? 'Yahoo Finance' : 'FRED',
        cadence: id === 'M2' ? '1mo' : '1d',
        unit: id === 'M2' ? 'Billions USD (YoY %)' : id === 'DXY' ? 'Index' : '%',
        status: 'error',
        errorMessage: '아직 동기화되지 않았습니다.',
        lastUpdatedIso: null,
        latestDate: null,
        latestValue: null,
        changeLabel: id === 'M2' ? '전년 동월 대비(YoY)' : id === 'DXY' ? '일간 변화율' : '일간 금리 변화량',
        changeValue: null,
        changeUnit: id === 'DGS10' ? '%p' : '%',
        pointCount: 0,
        recentObservations: [],
      };
    });
  }

  async getStatusSnapshot(ensure = true): Promise<MarketNetworkStatusResponse> {
    if (ensure) await this.ensureSynced(false);
    const { summaries: assets } = this.getOrderedAssets();
    const macro = this.getOrderedMacro();

    const btcAsset = assets.find((a) => a.id === 'BTC')!;
    const bybitAssets = assets.filter((a) => a.provider === 'bybit');
    const yahooMacro = macro.filter((m) => m.provider === 'yahoo_finance');
    const fredMacro = macro.filter((m) => m.provider === 'fred');

    const summarizeProvider = (
      provider: ProviderHealthStatus['provider'],
      label: string,
      items: ReadonlyArray<{ status: string; errorMessage: string | null; lastUpdatedIso: string | null }>,
      modeNote: string,
    ): ProviderHealthStatus => {
      const okCount = items.filter((i) => i.status === 'ok').length;
      const errors = items
        .map((i) => i.errorMessage)
        .filter((m): m is string => Boolean(m));
      const latestIso =
        items
          .map((i) => i.lastUpdatedIso)
          .filter((x): x is string => Boolean(x))
          .sort()
          .pop() ?? null;
      return {
        provider,
        label,
        status: okCount === items.length ? 'ok' : okCount > 0 ? 'partial' : 'error',
        lastSyncIso: latestIso,
        successCount: okCount,
        totalCount: items.length,
        errorMessages: errors,
        modeNote,
      };
    };

    const providers: ProviderHealthStatus[] = [
      summarizeProvider(
        'btc_local_store',
        '기존 BTC 저장소 (Read-Only)',
        [btcAsset],
        'data/btcusdt_5m.bin + Coin Metrics 일봉 읽기 전용 연결',
      ),
      summarizeProvider(
        'bybit',
        'Bybit Public API v5',
        bybitAssets,
        'instruments-info 검증 · Crypto/TradFi 5m 증분 수집',
      ),
      summarizeProvider(
        'yahoo_finance',
        'Yahoo Finance (DX-Y.NYB)',
        yahooMacro,
        '비공식 차트 API · 단독 실패 격리',
      ),
      summarizeProvider(
        'fred',
        'FRED (St. Louis Fed)',
        fredMacro,
        process.env.FRED_API_KEY?.trim()
          ? '공식 FRED JSON API (FRED_API_KEY 적용)'
          : 'FRED 공개 CSV 피드 (FRED_API_KEY 미설정 시 폴백)',
      ),
    ];

    return {
      isSyncing: this.activeSyncPromise !== null,
      lastFullSyncIso: this.lastFullSyncIso,
      providers,
      assets,
      macro,
    };
  }

  async getAssets(): Promise<AssetMarketSummary[]> {
    await this.ensureSynced(false);
    return this.getOrderedAssets().summaries;
  }

  async getAssetOhlcv(assetIdRaw: string, limit = 288): Promise<AssetOhlcvResponse> {
    await this.ensureSynced(false);
    const id = assetIdRaw.toUpperCase() as AssetId;
    if (!ALL_ASSET_IDS.includes(id)) {
      throw new Error(`지원하지 않는 자산 식별자입니다: ${assetIdRaw}`);
    }
    const cleanLimit = Math.max(1, Math.min(8640, Math.floor(limit)));
    const { summaries, seriesMap } = this.getOrderedAssets();
    const asset = summaries.find((a) => a.id === id)!;
    const bars = seriesMap.get(id) ?? [];
    return {
      asset,
      bars: bars.slice(-cleanLimit),
    };
  }

  async getAssetCorrelations(): Promise<{
    h24: AssetCorrelationMatrix;
    d30: AssetCorrelationMatrix;
  }> {
    await this.ensureSynced(false);
    const { seriesMap } = this.getOrderedAssets();
    return {
      h24: computeAssetCorrelationMatrix(seriesMap, ALL_ASSET_IDS, '24h'),
      d30: computeAssetCorrelationMatrix(seriesMap, ALL_ASSET_IDS, '30d'),
    };
  }

  async getMacro(): Promise<MacroIndicatorSummary[]> {
    await this.ensureSynced(false);
    return this.getOrderedMacro();
  }

  async getMacroCorrelations(): Promise<MacroCorrelationSummary> {
    await this.ensureSynced(false);
    const dxy = this.macroSeries.get('DXY')?.observations ?? [];
    const m2 = this.macroSeries.get('M2')?.observations ?? [];
    const dgs10 = this.macroSeries.get('DGS10')?.observations ?? [];
    return computeMacroCorrelations(dxy, m2, dgs10);
  }

  async getBtcMacroCrossAnalysis(): Promise<BtcMacroCrossAnalysis> {
    await this.ensureSynced(false);
    const dxyStored = this.macroSeries.get('DXY');
    const m2Stored = this.macroSeries.get('M2');

    let btcDailyRows: Array<{ date: string; priceUsd: number }> = [];
    let btcSourceLabel = 'Coin Metrics Community 일봉 (기존 장기 저장소 읽기 전용)';
    try {
      btcDailyRows = await this.btcAdapters.getBtcDailyHistory();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      btcSourceLabel = `기존 BTC 일봉 로드 실패 (${msg})`;
    }

    return computeBtcMacroCrossAnalysis(
      btcDailyRows,
      dxyStored?.observations ?? [],
      m2Stored?.observations ?? [],
      btcSourceLabel,
      dxyStored?.status === 'ok',
      m2Stored?.status === 'ok',
    );
  }

  async getOverview(): Promise<MarketNetworkOverviewResponse> {
    await this.ensureSynced(false);
    const [status, assetCorrelations, macroCorrelations, btcMacroCross] = await Promise.all([
      this.getStatusSnapshot(false),
      this.getAssetCorrelations(),
      this.getMacroCorrelations(),
      this.getBtcMacroCrossAnalysis(),
    ]);
    return {
      status,
      assetCorrelations,
      macroCorrelations,
      btcMacroCross,
    };
  }
}
