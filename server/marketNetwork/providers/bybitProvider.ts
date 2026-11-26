import type {
  AssetId,
  AssetInstrumentType,
  NetworkOhlcvBar,
} from '../../../src/types/marketNetwork.ts';
import { BAR_INTERVAL_MS, getLatestClosed5mOpenMs } from '../storage/networkStorage.ts';

const BYBIT_BASE_URL = 'https://api.bybit.com';
const INSTRUMENTS_CACHE_TTL_MS = 15 * 60_000;
const PAGE_LIMIT = 1000;
const TARGET_DAYS = 30;
const TARGET_5M_BARS = TARGET_DAYS * 288; // 8,640 bars

export interface BybitInstrumentMeta {
  symbol: string;
  contractType: string;
  symbolType: string;
  status: string;
  baseCoin: string;
  quoteCoin: string;
  launchTimeMs: number | null;
}

export interface AssetTargetSpec {
  id: AssetId;
  name: string;
  targetDescription: string;
  candidateSymbols: string[];
  expectedTradFi: boolean;
}

/**
 * Verified mapping targets against live Bybit `instruments-info?category=linear`.
 * Never guesses unverified symbols: if absent in Bybit instruments-info, asset is marked unsupported.
 */
export const NON_BTC_ASSET_SPECS: readonly AssetTargetSpec[] = [
  {
    id: 'SPY',
    name: 'SPY',
    targetDescription: 'S&P 500 대표 ETF',
    candidateSymbols: ['SPYUSDT'],
    expectedTradFi: true,
  },
  {
    id: 'QQQ',
    name: 'QQQ',
    targetDescription: 'Nasdaq 100 대표 ETF',
    candidateSymbols: ['QQQUSDT'],
    expectedTradFi: true,
  },
  {
    id: 'XAU',
    name: 'XAU',
    targetDescription: '금 (Gold)',
    candidateSymbols: ['XAUUSDT'],
    expectedTradFi: true,
  },
  {
    id: 'WTI',
    name: 'WTI',
    targetDescription: '원유 (WTI Crude Oil)',
    candidateSymbols: ['CLUSDT', 'WTIUSDT', 'USOILUSDT'],
    expectedTradFi: true,
  },
  {
    id: 'TLT',
    name: 'TLT',
    targetDescription: '미국 장기국채 ETF',
    candidateSymbols: ['TLTUSDT'],
    expectedTradFi: true,
  },
  {
    id: 'EEM',
    name: 'EEM',
    targetDescription: '신흥국 주식 ETF',
    candidateSymbols: ['EEMUSDT', 'EEMSTOCKUSDT'],
    expectedTradFi: true,
  },
];

interface BybitApiResponse<T> {
  retCode: number;
  retMsg: string;
  result?: T;
}

interface BybitInstrumentsResult {
  nextPageCursor?: string;
  list?: Array<{
    symbol: string;
    contractType?: string;
    symbolType?: string;
    status?: string;
    baseCoin?: string;
    quoteCoin?: string;
    launchTime?: string;
  }>;
}

interface BybitKlineResult {
  symbol: string;
  category: string;
  list?: string[][];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBybitJson<T>(url: string, retries = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'btc-analytics-desk/1.0',
        },
      });
      clearTimeout(timer);

      if (res.status === 429 || res.status === 403) {
        const waitMs = 1500 * Math.pow(2, attempt);
        if (attempt < retries) {
          await sleep(waitMs);
          continue;
        }
        throw new Error(`Bybit rate-limit HTTP ${res.status}`);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (res.status >= 500 && attempt < retries) {
          await sleep(600 * Math.pow(2, attempt));
          continue;
        }
        throw new Error(`Bybit HTTP ${res.status}: ${body.slice(0, 160)}`);
      }

      const json = (await res.json()) as BybitApiResponse<T>;
      if (json.retCode !== 0 || !json.result) {
        if (json.retCode === 10006 && attempt < retries) {
          await sleep(1500 * Math.pow(2, attempt));
          continue;
        }
        throw new Error(`Bybit API error (${json.retCode}): ${json.retMsg}`);
      }
      return json.result;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) {
        await sleep(500 * Math.pow(2, attempt));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export class BybitProvider {
  private instrumentsMapCache: Map<string, BybitInstrumentMeta> | null = null;
  private instrumentsFetchedAtMs = 0;

  async getLinearInstruments(forceRefresh = false): Promise<Map<string, BybitInstrumentMeta>> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.instrumentsMapCache &&
      now - this.instrumentsFetchedAtMs < INSTRUMENTS_CACHE_TTL_MS
    ) {
      return this.instrumentsMapCache;
    }

    const map = new Map<string, BybitInstrumentMeta>();
    let cursor = '';
    for (let page = 0; page < 10; page++) {
      const qs = new URLSearchParams({
        category: 'linear',
        limit: '1000',
      });
      if (cursor) qs.set('cursor', cursor);

      const res = await fetchBybitJson<BybitInstrumentsResult>(
        `${BYBIT_BASE_URL}/v5/market/instruments-info?${qs.toString()}`,
      );

      for (const item of res.list ?? []) {
        if (!item.symbol) continue;
        const launchNum = item.launchTime ? Number(item.launchTime) : NaN;
        map.set(item.symbol, {
          symbol: item.symbol,
          contractType: item.contractType ?? '',
          symbolType: item.symbolType ?? '',
          status: item.status ?? '',
          baseCoin: item.baseCoin ?? '',
          quoteCoin: item.quoteCoin ?? '',
          launchTimeMs: Number.isFinite(launchNum) && launchNum > 0 ? launchNum : null,
        });
      }

      if (!res.nextPageCursor) break;
      cursor = res.nextPageCursor;
    }

    this.instrumentsMapCache = map;
    this.instrumentsFetchedAtMs = now;
    return map;
  }

  resolveInstrument(
    spec: AssetTargetSpec,
    instruments: ReadonlyMap<string, BybitInstrumentMeta>,
  ): {
    supported: boolean;
    instrument: BybitInstrumentMeta | null;
    instrumentType: AssetInstrumentType;
    reason: string | null;
  } {
    for (const sym of spec.candidateSymbols) {
      const found = instruments.get(sym);
      if (found && found.status === 'Trading') {
        const isTradFi = Boolean(found.symbolType && found.symbolType.trim() !== '');
        return {
          supported: true,
          instrument: found,
          instrumentType: isTradFi ? 'tradfi_perpetual' : 'crypto_perpetual',
          reason: null,
        };
      }
    }

    return {
      supported: false,
      instrument: null,
      instrumentType: 'unsupported',
      reason: `Bybit linear 상품 목록에서 ${spec.id}(${spec.targetDescription}) 지원 심볼(${spec.candidateSymbols.join(', ')})이 확인되지 않았습니다.`,
    };
  }

  private async fetchKlineWindow(
    symbol: string,
    startMs: number,
    endMs: number,
    limit = PAGE_LIMIT,
  ): Promise<NetworkOhlcvBar[]> {
    const qs = new URLSearchParams({
      category: 'linear',
      symbol,
      interval: '5',
      start: String(startMs),
      end: String(endMs),
      limit: String(limit),
    });
    const res = await fetchBybitJson<BybitKlineResult>(
      `${BYBIT_BASE_URL}/v5/market/kline?${qs.toString()}`,
    );

    const rows = res.list ?? [];
    const bars: NetworkOhlcvBar[] = [];
    for (const row of rows) {
      const openTimeMs = Number(row[0]);
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      const volume = Number(row[5]);
      const quoteVolume = Number(row[6] ?? 0);
      bars.push({ openTimeMs, open, high, low, close, volume, quoteVolume });
    }
    return bars;
  }

  /**
   * Fetches missing 5m bars cleanly:
   * - If no existing bars, backfills 30 days (8,640 bars) in paged 1000-bar windows.
   * - If existing bars exist, fetches strictly from lastStoredOpen + 300_000 up to latestClosedOpen.
   */
  async fetchMissing5mBars(
    symbol: string,
    lastStoredOpenMs: number | null,
    nowMs = Date.now(),
  ): Promise<NetworkOhlcvBar[]> {
    const latestClosed = getLatestClosed5mOpenMs(nowMs);
    const defaultStart = latestClosed - (TARGET_5M_BARS - 1) * BAR_INTERVAL_MS;
    const startMs =
      lastStoredOpenMs !== null && lastStoredOpenMs >= defaultStart
        ? lastStoredOpenMs + BAR_INTERVAL_MS
        : defaultStart;

    if (startMs > latestClosed) {
      return [];
    }

    const pageSpanMs = PAGE_LIMIT * BAR_INTERVAL_MS;
    const allBars: NetworkOhlcvBar[] = [];

    for (let s = startMs; s <= latestClosed; s += pageSpanMs) {
      const e = Math.min(latestClosed, s + pageSpanMs - BAR_INTERVAL_MS);
      const batch = await this.fetchKlineWindow(symbol, s, e, PAGE_LIMIT);
      for (const b of batch) {
        allBars.push(b);
      }
      if (s + pageSpanMs <= latestClosed) {
        await sleep(90); // Rate-limit friendly pacing
      }
    }

    return allBars;
  }
}
