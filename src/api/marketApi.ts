import type { DataProvenanceItem, LiquidationSupportStatus } from '../types/derivatives';

export interface DeribitBundleResponse {
  spot: {
    indexPrice: number;
    estimatedDeliveryPrice: number;
  };
  history30d: Array<{
    timestampMs: number;
    date: string;
    close: number;
    volume: number;
  }>;
  instruments: Array<{
    instrument_name: string;
    expiration_timestamp: number;
    strike: number;
    option_type: 'call' | 'put';
    contract_size: number;
    is_active: boolean;
    quote_currency: string;
    base_currency: string;
  }>;
  bookSummary: Array<{
    instrument_name: string;
    mark_iv: number | null;
    open_interest: number;
    underlying_price: number;
    underlying_index: string;
    mark_price: number;
    volume: number;
    volume_usd?: number;
    creation_timestamp: number;
  }>;
  liquidationSupport: LiquidationSupportStatus;
  provenance: {
    spot: DataProvenanceItem;
    history30d: DataProvenanceItem;
    options: DataProvenanceItem;
  };
}

export interface LongTermHistoryResponse {
  history: Array<{
    date: string;
    priceUsd: number;
    hashrateEh: number | null;
    blockCount: number | null;
  }>;
  liveSpot: number | null;
  provenance: {
    history: DataProvenanceItem & {
      startDate: string | null;
      endDate: string | null;
      rowCount: number;
    };
    liveSpot: DataProvenanceItem | null;
  };
}

export interface LongTermMiningResponse {
  currentBlockHeight: number;
  difficultyAdjustment: {
    progressPercent: number;
    difficultyChange: number;
    estimatedRetargetDate: number;
    remainingBlocks: number;
    remainingTime: number;
    previousRetarget: number;
    nextRetargetHeight: number;
    timeAvg: number;
    adjustedTimeAvg: number;
  };
  currentHashrateEh: number;
  currentDifficultyT: number;
  avgTotalRewardBtc: number;
  avgFeePerBlockBtc: number;
  hashrates: Array<{
    timestampSec: number;
    date: string;
    hashrateEh: number;
  }>;
  difficulties: Array<{
    timestampSec: number;
    date: string;
    height: number;
    difficultyT: number;
  }>;
  provenance: {
    blockchain: DataProvenanceItem;
    historicalFeesArchive: {
      supported: boolean;
      reason: string;
    };
  };
}

interface ClientCacheEntry<T> {
  data: T;
  expiresAt: number;
}

const clientCache = new Map<string, ClientCacheEntry<unknown>>();
const clientInFlight = new Map<string, Promise<unknown>>();

async function fetchApiJson<T>(
  url: string,
  ttlMs: number,
  forceRefresh = false,
): Promise<T> {
  const now = Date.now();
  if (!forceRefresh) {
    const cached = clientCache.get(url) as ClientCacheEntry<T> | undefined;
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }
    const pending = clientInFlight.get(url) as Promise<T> | undefined;
    if (pending) {
      return pending;
    }
  }

  const reqPromise = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 18_000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          payload && typeof payload === 'object' && 'message' in payload
            ? String((payload as { message: unknown }).message)
            : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      if (!payload || typeof payload !== 'object') {
        throw new Error('유효하지 않은 JSON 응답입니다.');
      }
      clientCache.set(url, {
        data: payload as T,
        expiresAt: Date.now() + ttlMs,
      });
      return payload as T;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('API 응답 시간이 초과되었습니다 (Timeout).');
      }
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      window.clearTimeout(timer);
      clientInFlight.delete(url);
    }
  })();

  clientInFlight.set(url, reqPromise);
  return reqPromise;
}

export function fetchDerivativesBundle(forceRefresh = false): Promise<DeribitBundleResponse> {
  return fetchApiJson<DeribitBundleResponse>('/api/derivatives/bundle', 25_000, forceRefresh);
}

export function fetchLongTermHistory(forceRefresh = false): Promise<LongTermHistoryResponse> {
  return fetchApiJson<LongTermHistoryResponse>('/api/long-term/history', 300_000, forceRefresh);
}

export function fetchLongTermMining(forceRefresh = false): Promise<LongTermMiningResponse> {
  return fetchApiJson<LongTermMiningResponse>('/api/long-term/mining', 60_000, forceRefresh);
}
