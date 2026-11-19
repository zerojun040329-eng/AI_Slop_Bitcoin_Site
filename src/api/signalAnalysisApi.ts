import type {
  MatchDetailResponse,
  SignalAnalysisResponse,
  SignalAnalysisRunRequest,
  SyncStatus,
} from '../types/signalAnalysis';

export async function fetchSignalSyncStatus(): Promise<SyncStatus> {
  const res = await fetch('/api/signal-analysis/status');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `동기화 상태 조회 실패 (HTTP ${res.status})`);
  }
  return (await res.json()) as SyncStatus;
}

export async function triggerSignalDataSync(forceFullBackfill = false): Promise<SyncStatus> {
  const res = await fetch('/api/signal-analysis/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ forceFullBackfill }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `데이터 동기화 요청 실패 (HTTP ${res.status})`);
  }
  return (await res.json()) as SyncStatus;
}

export async function runSignalSimilarityAnalysis(
  request: SignalAnalysisRunRequest,
): Promise<SignalAnalysisResponse> {
  const res = await fetch('/api/signal-analysis/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `유사 구간 분석 실행 실패 (HTTP ${res.status})`);
  }
  return (await res.json()) as SignalAnalysisResponse;
}

export async function fetchMatchDetail(
  matchIndex: number,
  mahalanobisDistance: number,
  euclideanDistance: number,
): Promise<MatchDetailResponse> {
  const qs = new URLSearchParams({
    index: String(matchIndex),
    mDist: String(mahalanobisDistance),
    eDist: String(euclideanDistance),
  });
  const res = await fetch(`/api/signal-analysis/match-detail?${qs.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `매치 상세 조회 실패 (HTTP ${res.status})`);
  }
  return (await res.json()) as MatchDetailResponse;
}
