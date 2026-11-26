import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchMarketNetworkOverview,
  triggerMarketNetworkSync,
} from '../api/marketNetworkApi';
import type { MarketNetworkOverviewResponse } from '../types/marketNetwork';

export interface MarketNetworkHookState {
  data: MarketNetworkOverviewResponse | null;
  loading: boolean;
  syncing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  syncNow: () => Promise<void>;
}

const POLL_INTERVAL_MS = 180_000;

export function useMarketNetwork(enabled = true): MarketNetworkHookState {
  const [data, setData] = useState<MarketNetworkOverviewResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const hasLoadedRef = useRef(false);

  const loadOverview = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const overview = await fetchMarketNetworkOverview();
      if (!mountedRef.current) return;
      setData(overview);
      setError(null);
      hasLoadedRef.current = true;
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const overview = await triggerMarketNetworkSync();
      if (!mountedRef.current) return;
      setData(overview);
      hasLoadedRef.current = true;
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) {
        setSyncing(false);
        setLoading(false);
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    await loadOverview(!hasLoadedRef.current);
  }, [loadOverview]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    void loadOverview(!hasLoadedRef.current);
    const interval = window.setInterval(() => {
      void loadOverview(false);
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [enabled, loadOverview]);

  const btcAsset = data?.status.assets.find((a) => a.id === 'BTC');
  const isBtcPending = btcAsset?.status === 'syncing';

  useEffect(() => {
    if (!enabled || !isBtcPending) return;

    const timer = window.setTimeout(() => {
      void loadOverview(false);
    }, 2500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [enabled, isBtcPending, data, loadOverview]);

  return {
    data,
    loading,
    syncing,
    error,
    refresh,
    syncNow,
  };
}
