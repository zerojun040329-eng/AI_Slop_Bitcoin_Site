import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSignalSyncStatus, triggerSignalDataSync } from '../api/signalAnalysisApi';
import {
  fetchRegisteredStrategies,
  fetchTradeDetailWindowApi,
  runStrategyBacktestApi,
} from '../api/strategyBacktestApi';
import type { SyncStatus } from '../types/signalAnalysis';
import type {
  StrategyBacktestResponse,
  StrategyBacktestRunRequest,
  StrategyMetadata,
  TradeDetailWindowResponse,
  TradeRecord,
} from '../types/strategyBacktest';

export function useStrategyBacktest(enabled: boolean) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [strategies, setStrategies] = useState<StrategyMetadata[]>([]);
  const [result, setResult] = useState<StrategyBacktestResponse | null>(null);
  const [selectedTradeWindow, setSelectedTradeWindow] =
    useState<TradeDetailWindowResponse | null>(null);

  const [loadingInit, setLoadingInit] = useState(false);
  const [runningBacktest, setRunningBacktest] = useState(false);
  const [loadingTradeWindow, setLoadingTradeWindow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const autoTriggeredSyncRef = useRef(false);
  const autoRanInitialRef = useRef(false);

  const selectTrade = useCallback(async (trade: TradeRecord | null) => {
    if (!trade) {
      setSelectedTradeWindow(null);
      return;
    }
    setLoadingTradeWindow(true);
    try {
      const detail = await fetchTradeDetailWindowApi(trade);
      setSelectedTradeWindow(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : '거래 캔들 데이터를 불러오지 못했습니다.');
    } finally {
      setLoadingTradeWindow(false);
    }
  }, []);

  const runBacktest = useCallback(
    async (req: StrategyBacktestRunRequest = {}) => {
      setRunningBacktest(true);
      setError(null);
      try {
        const res = await runStrategyBacktestApi(req);
        setResult(res);
        if (res.trades.length > 0) {
          // Select latest trade by default for immediate inspection
          await selectTrade(res.trades[res.trades.length - 1]);
        } else {
          setSelectedTradeWindow(null);
        }
        return res;
      } catch (err) {
        const msg = err instanceof Error ? err.message : '백테스트 실행 중 오류가 발생했습니다.';
        setError(msg);
        return null;
      } finally {
        setRunningBacktest(false);
      }
    },
    [selectTrade],
  );

  const triggerSync = useCallback(async () => {
    setError(null);
    try {
      const next = await triggerSignalDataSync(false);
      setSyncStatus(next);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : '데이터 동기화 시작 실패');
      return null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let pollTimer: number | null = null;

    const initAndPoll = async () => {
      setLoadingInit((prev) => (syncStatus === null ? true : prev));
      try {
        const [stratList, s] = await Promise.all([
          strategies.length > 0 ? Promise.resolve(strategies) : fetchRegisteredStrategies(),
          fetchSignalSyncStatus(),
        ]);
        if (cancelled) return;
        setStrategies(stratList);
        setSyncStatus(s);
        setLoadingInit(false);

        if (s.phase === 'idle' && !autoTriggeredSyncRef.current) {
          autoTriggeredSyncRef.current = true;
          const started = await triggerSignalDataSync(false);
          if (!cancelled) setSyncStatus(started);
        }

        if (s.hasSufficientData && s.phase === 'ready' && !autoRanInitialRef.current) {
          autoRanInitialRef.current = true;
          await runBacktest({ strategyId: stratList[0]?.id ?? 'liquidity_fakeout' });
        }

        const isSyncing =
          s.phase === 'backfilling' ||
          s.phase === 'repairing_gaps' ||
          s.phase === 'updating_incremental' ||
          s.phase === 'idle';

        if (!cancelled && isSyncing) {
          pollTimer = window.setTimeout(initAndPoll, 1500);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadingInit(false);
          setError(err instanceof Error ? err.message : '백테스트 상태 초기화 실패');
        }
      }
    };

    void initAndPoll();

    return () => {
      cancelled = true;
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
      }
    };
  }, [enabled, runBacktest]);

  return {
    syncStatus,
    strategies,
    result,
    selectedTradeWindow,
    loadingInit,
    runningBacktest,
    loadingTradeWindow,
    error,
    triggerSync,
    runBacktest,
    selectTrade,
  };
}
