import type {
  AssetId,
  AssetOhlcvResponse,
  MarketNetworkOverviewResponse,
} from '../types/marketNetwork';

async function parseJsonResponse<T>(res: Response, fallbackMessage: string): Promise<T> {
  if (!res.ok) {
    let detail = fallbackMessage;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // Ignore invalid JSON error bodies
    }
    throw new Error(`${detail} (HTTP ${res.status})`);
  }
  return (await res.json()) as T;
}

export async function fetchMarketNetworkOverview(): Promise<MarketNetworkOverviewResponse> {
  const res = await fetch('/api/market-network/overview', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  return parseJsonResponse<MarketNetworkOverviewResponse>(
    res,
    '글로벌 시장 네트워크 데이터를 불러오지 못했습니다.',
  );
}

export async function triggerMarketNetworkSync(): Promise<MarketNetworkOverviewResponse> {
  const res = await fetch('/api/market-network/sync', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  return parseJsonResponse<MarketNetworkOverviewResponse>(
    res,
    '글로벌 시장 네트워크 수동 동기화에 실패했습니다.',
  );
}

export async function fetchAssetOhlcv(assetId: AssetId, limit = 288): Promise<AssetOhlcvResponse> {
  const res = await fetch(
    `/api/market-network/assets/${encodeURIComponent(assetId)}/ohlcv?limit=${encodeURIComponent(
      String(limit),
    )}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
    },
  );
  return parseJsonResponse<AssetOhlcvResponse>(
    res,
    `${assetId} 5분봉 데이터를 불러오지 못했습니다.`,
  );
}
