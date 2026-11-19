import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchMatchDetail,
  fetchSignalSyncStatus,
  runSignalSimilarityAnalysis,
  triggerSignalDataSync,
} from '../api/signalAnalysisApi';
import type {
  MatchDetailResponse,
  SignalAnalysisResponse,
  SignalAnalysisRunRequest,
  SimilarityMatch,
  SyncStatus,
} from '../types/signalAnalysis';

export function useSignalAnalysis(enabled: boolean) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [analysis, setAnalysis] = useState<SignalAnalysisResponse | null>(null);
  const [selectedMatchDetail, setSelectedMatchDetail] = useState<MatchDetailResponse | null>(null);
  const [selectedMatchRank, setSelectedMatchRank] = useState<number | null>(null);

  const [loadingStatus, setLoadingStatus] = useState(false);
  const [runningAnalysis, setRunningAnalysis] = useState(false);
  const [loadingMatchDetail, setLoadingMatchDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const autoTriggeredSyncRef = useRef(false);
  const autoRanInitialRef = useRef(false);

  const selectMatch = useCallback(async (match: SimilarityMatch | null) => {
    if (!match) {
      setSelectedMatchDetail(null);
      setSelectedMatchRank(null);
      return;
    }
    setSelectedMatchRank(match.matchRank);
    setLoadingMatchDetail(true);
    try {
      const detail = await fetchMatchDetail(
        match.index,
        match.mahalanobisDistance,
        match.euclideanDistance,
      );
      setSelectedMatchDetail(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : '매치 상세 정보를 불러오지 못했습니다.');
    } finally {
      setLoadingMatchDetail(false);
    }
  }, []);

  const run = useCallback(
    async (req: SignalAnalysisRunRequest = {}) => {
      setRunningAnalysis(true);
      setError(null);
      try {
        const result = await runSignalSimilarityAnalysis(req);
        setAnalysis(result);
        if (result.matches.length > 0) {
          await selectMatch(result.matches[0]);
        } else {
          setSelectedMatchDetail(null);
          setSelectedMatchRank(null);
        }
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : '유사 구간 분석 실행 오류';
        setError(msg);
        return null;
      } finally {
        setRunningAnalysis(false);
      }
    },
    [selectMatch],
  );

  const triggerSync = useCallback(async (forceFullBackfill = false) => {
    setError(null);
    try {
      const next = await triggerSignalDataSync(forceFullBackfill);
      setStatus(next);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : '데이터 동기화 시작 실패');
      return null;
    }
  }, []);

  // Poll status while enabled & syncing
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let pollTimer: number | null = null;

    const poll = async () => {
      setLoadingStatus((prev) => (status === null ? true : prev));
      try {
        const s = await fetchSignalSyncStatus();
        if (cancelled) return;
        setStatus(s);
        setLoadingStatus(false);

        if (s.phase === 'idle' && !autoTriggeredSyncRef.current) {
          autoTriggeredSyncRef.current = true;
          const started = await triggerSignalDataSync(false);
          if (!cancelled) setStatus(started);
        }

        if (s.hasSufficientData && s.phase === 'ready' && !autoRanInitialRef.current) {
          autoRanInitialRef.current = true;
          await run({ includeAblation: true });
        }

        const isSyncing =
          s.phase === 'backfilling' ||
          s.phase === 'repairing_gaps' ||
          s.phase === 'updating_incremental' ||
          s.phase === 'idle';

        if (!cancelled && isSyncing) {
          pollTimer = window.setTimeout(poll, 1500);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadingStatus(false);
          setError(err instanceof Error ? err.message : '상태 조회 실패');
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
      }
    };
  }, [enabled, run]);

  return {
    status,
    analysis,
    selectedMatchDetail,
    selectedMatchRank,
    loadingStatus,
    runningAnalysis,
    loadingMatchDetail,
    error,
    triggerSync,
    run,
    selectMatch,
  };
}
