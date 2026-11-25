import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchLongTermHistory, type LongTermHistoryResponse } from '../api/marketApi';
import { runRealTestSuite } from '../quant/realTest/realTestEngine';
import type { RealTestInputs, RealTestSuiteResult } from '../types/realTest';

export interface UseRealTestState {
  inputs: RealTestInputs;
  setTotalBudgetUsd: (val: number) => void;
  setFeeRatePct: (val: number) => void;
  result: RealTestSuiteResult | null;
  provenance: LongTermHistoryResponse['provenance'] | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
}

export function useRealTest(enabled: boolean): UseRealTestState {
  const [inputs, setInputs] = useState<RealTestInputs>({
    totalBudgetUsd: 100_000,
    feeRatePct: 0.1,
  });
  const [historyData, setHistoryData] = useState<LongTermHistoryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (forceRefresh = false) => {
    setError(null);
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading((prev) => (historyData ? prev : true));
    }
    try {
      // Reuses existing 장기투자지표 daily data endpoint + client 5m cache + server 1h cache
      const res = await fetchLongTermHistory(forceRefresh);
      if (!mountedRef.current) return;
      setHistoryData(res);
      setLoading(false);
      setRefreshing(false);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : '일봉 시계열 데이터를 불러오지 못했습니다.');
      setLoading(false);
      setRefreshing(false);
    }
  }, [historyData]);

  useEffect(() => {
    if (!enabled) return;
    void load(false);
  }, [enabled, load]);

  const result = useMemo<RealTestSuiteResult | null>(() => {
    if (!historyData) return null;
    try {
      return runRealTestSuite(historyData.history, historyData.liveSpot, inputs);
    } catch (err) {
      return null;
    }
  }, [historyData, inputs]);

  const setTotalBudgetUsd = useCallback((val: number) => {
    const clean = Number.isFinite(val) ? Math.max(100, Math.min(val, 1_000_000_000)) : 100_000;
    setInputs((prev) => ({ ...prev, totalBudgetUsd: clean }));
  }, []);

  const setFeeRatePct = useCallback((val: number) => {
    const clean = Number.isFinite(val) ? Math.max(0, Math.min(val, 5)) : 0;
    setInputs((prev) => ({ ...prev, feeRatePct: clean }));
  }, []);

  return {
    inputs,
    setTotalBudgetUsd,
    setFeeRatePct,
    result,
    provenance: historyData?.provenance ?? null,
    loading,
    refreshing,
    error,
    refresh: () => {
      void load(true);
    },
  };
}
