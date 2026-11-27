import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAssetDetail } from '../api/marketNetworkApi';
import type { AssetDetailId, AssetDetailPayload } from '../types/marketNetwork';

export interface UseAssetDetailResult {
  data: AssetDetailPayload | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  retry: () => void;
  refresh: () => void;
}

const CLIENT_DETAIL_CACHE_TTL_MS = 5 * 60_000;

interface CachedEntry {
  payload: AssetDetailPayload;
  expiresAtMs: number;
}

export function useAssetDetail(assetId: AssetDetailId | null): UseAssetDetailResult {
  const [data, setData] = useState<AssetDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cacheRef = useRef<Map<AssetDetailId, CachedEntry>>(new Map());
  const reqSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (targetId: AssetDetailId, forceRefresh: boolean) => {
      abortRef.current?.abort();

      if (!forceRefresh) {
        const cached = cacheRef.current.get(targetId);
        if (cached && cached.expiresAtMs > Date.now()) {
          setData(cached.payload);
          setLoading(false);
          setRefreshing(false);
          setError(null);
          return;
        }
      }

      const seq = ++reqSeqRef.current;
      const controller = new AbortController();
      abortRef.current = controller;

      if (forceRefresh && cacheRef.current.has(targetId)) {
        setRefreshing(true);
      } else {
        setData(null);
        setLoading(true);
      }
      setError(null);

      try {
        const payload = await fetchAssetDetail(targetId, {
          signal: controller.signal,
          refresh: forceRefresh,
        });
        if (controller.signal.aborted || reqSeqRef.current !== seq) return;
        cacheRef.current.set(targetId, {
          payload,
          expiresAtMs: Date.now() + CLIENT_DETAIL_CACHE_TTL_MS,
        });
        setData(payload);
        setError(null);
      } catch (err) {
        if (controller.signal.aborted || reqSeqRef.current !== seq) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted && reqSeqRef.current === seq) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!assetId) {
      abortRef.current?.abort();
      reqSeqRef.current += 1;
      setData(null);
      setLoading(false);
      setRefreshing(false);
      setError(null);
      return;
    }

    void load(assetId, false);
    return () => {
      abortRef.current?.abort();
    };
  }, [assetId, load]);

  const retry = useCallback(() => {
    if (assetId) void load(assetId, false);
  }, [assetId, load]);

  const refresh = useCallback(() => {
    if (assetId) void load(assetId, true);
  }, [assetId, load]);

  return { data, loading, refreshing, error, retry, refresh };
}
