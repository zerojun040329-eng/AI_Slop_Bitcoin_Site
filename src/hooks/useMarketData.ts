import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchDerivativesBundle,
  fetchLongTermHistory,
  fetchLongTermMining,
} from '../api/marketApi';
import { normalizeDeribitSnapshot } from '../services/derivativesService';
import { normalizeLongTermDataset } from '../services/longTermService';
import type { MarketSnapshot } from '../types/derivatives';
import type { LongTermDataset } from '../types/longTerm';

export interface AsyncDataState<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastUpdatedIso: string | null;
  refresh: () => void;
}

export function useDerivativesMarketData(enabled: boolean): AsyncDataState<MarketSnapshot> {
  const [data, setData] = useState<MarketSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedIso, setLastUpdatedIso] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (forceRefresh = false) => {
    setError(null);
    setRefreshing((prev) => (forceRefresh ? true : prev));
    try {
      const raw = await fetchDerivativesBundle(forceRefresh);
      const normalized = normalizeDeribitSnapshot(raw);
      if (!mountedRef.current) return;
      setData(normalized);
      setLastUpdatedIso(new Date().toISOString());
      setLoading(false);
      setRefreshing(false);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : '파생상품 API 데이터를 불러오지 못했습니다.');
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load(false);
    // Refresh live spot & options every 45s while Derivatives tab is active
    const id = window.setInterval(() => {
      void load(true);
    }, 45_000);
    return () => window.clearInterval(id);
  }, [enabled, load]);

  return {
    data,
    loading,
    refreshing,
    error,
    lastUpdatedIso,
    refresh: () => {
      void load(true);
    },
  };
}

export function useLongTermMarketData(enabled: boolean): AsyncDataState<LongTermDataset> {
  const [data, setData] = useState<LongTermDataset | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedIso, setLastUpdatedIso] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (forceRefresh = false) => {
    setError(null);
    setRefreshing((prev) => (forceRefresh ? true : prev));
    try {
      const [historyRes, miningRes] = await Promise.all([
        fetchLongTermHistory(forceRefresh),
        fetchLongTermMining(forceRefresh),
      ]);
      const normalized = normalizeLongTermDataset(historyRes, miningRes);
      if (!mountedRef.current) return;
      setData(normalized);
      setLastUpdatedIso(new Date().toISOString());
      setLoading(false);
      setRefreshing(false);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : '장기투자 API 데이터를 불러오지 못했습니다.');
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load(false);
    // Refresh block height & mining telemetry every 90s while Long-Term tab is active
    const id = window.setInterval(() => {
      void load(true);
    }, 90_000);
    return () => window.clearInterval(id);
  }, [enabled, load]);

  return {
    data,
    loading,
    refreshing,
    error,
    lastUpdatedIso,
    refresh: () => {
      void load(true);
    },
  };
}
