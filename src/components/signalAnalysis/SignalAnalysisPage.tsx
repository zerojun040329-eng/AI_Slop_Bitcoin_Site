import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, SlidersHorizontal } from 'lucide-react';
import {
  ALL_INDICATOR_IDS,
  INDICATOR_DEFINITIONS,
  type DistanceMetricType,
  type HorizonKey,
  type IndicatorId,
  type MarketRegimeId,
  type MatchDetailResponse,
  type SignalAnalysisResponse,
  type SignalAnalysisRunRequest,
  type SimilarityMatch,
  type SyncStatus,
} from '../../types/signalAnalysis';
import { REGIME_ORDER, REGIME_LABELS } from '../../quant/regimeAnalyzer';
import { SignalPriceMatchesChart } from './SignalPriceMatchesChart';
import { ForwardReturnChartsSection } from './ForwardReturnChartsSection';
import { SignalAuditTabs } from './SignalAuditTabs';

interface SignalAnalysisPageProps {
  status: SyncStatus | null;
  analysis: SignalAnalysisResponse | null;
  selectedMatchDetail: MatchDetailResponse | null;
  selectedMatchRank: number | null;
  loadingStatus: boolean;
  runningAnalysis: boolean;
  loadingMatchDetail: boolean;
  error: string | null;
  onTriggerSync: (forceFullBackfill?: boolean) => Promise<SyncStatus | null>;
  onRunAnalysis: (req: SignalAnalysisRunRequest) => Promise<SignalAnalysisResponse | null>;
  onSelectMatch: (match: SimilarityMatch | null) => Promise<void>;
}

function toUtcDatetimeLocal(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

function parseUtcDatetimeLocal(val: string): number | null {
  if (!val) return null;
  const ms = Date.parse(`${val}:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

export const SignalAnalysisPage: React.FC<SignalAnalysisPageProps> = ({
  status,
  analysis,
  selectedMatchDetail,
  selectedMatchRank,
  loadingStatus,
  runningAnalysis,
  loadingMatchDetail,
  error,
  onTriggerSync,
  onRunAnalysis,
  onSelectMatch,
}) => {
  const [targetInputStr, setTargetInputStr] = useState<string>('');
  const [useLatestTarget, setUseLatestTarget] = useState<boolean>(true);
  const [distanceMetric, setDistanceMetric] = useState<DistanceMetricType>('mahalanobis');
  const [thresholdInput, setThresholdInput] = useState<string>('');
  const [minGapHours, setMinGapHours] = useState<number>(24);
  const [regimeFilter, setRegimeFilter] = useState<MarketRegimeId | 'all'>('all');
  const [selectedIndicators, setSelectedIndicators] = useState<IndicatorId[]>([]);
  const [ablationHorizon, setAblationHorizon] = useState<HorizonKey>('24h');
  const [showIndicatorPicker, setShowIndicatorPicker] = useState<boolean>(false);

  // Sync local controls when initial/latest analysis arrives
  useEffect(() => {
    if (!analysis) return;
    setTargetInputStr(toUtcDatetimeLocal(analysis.request.targetTimestampMs));
    setDistanceMetric(analysis.request.distanceMetric);
    setThresholdInput(analysis.request.threshold.toFixed(2));
    setMinGapHours(analysis.request.minGapHours);
    setRegimeFilter(analysis.request.regimeFilter);
    setSelectedIndicators(analysis.request.selectedIndicators);
    setAblationHorizon(analysis.request.ablationHorizon);
  }, [analysis]);

  const handleRun = (overrideThreshold?: number, overrideLatest?: boolean) => {
    const latestFlag = overrideLatest ?? useLatestTarget;
    const parsedTarget = latestFlag ? null : parseUtcDatetimeLocal(targetInputStr);
    const parsedThr =
      overrideThreshold !== undefined
        ? overrideThreshold
        : Number.parseFloat(thresholdInput);

    void onRunAnalysis({
      targetTimestampMs: parsedTarget,
      distanceMetric,
      threshold: Number.isFinite(parsedThr) && parsedThr > 0 ? parsedThr : undefined,
      minGapHours,
      regimeFilter,
      selectedIndicators: selectedIndicators.length > 0 ? selectedIndicators : undefined,
      ablationHorizon,
      includeAblation: true,
    });
  };

  const handleToggleIndicator = (id: IndicatorId) => {
    setSelectedIndicators((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev;
        return prev.filter((item) => item !== id);
      }
      return [...prev, id];
    });
  };

  // Case 1: Initial loading
  if (loadingStatus && !status) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-24 text-center space-y-3">
        <RefreshCw className="h-6 w-6 text-sky-400 animate-spin" />
        <div className="text-sm font-medium text-slate-200">
          Binance USDⓈ-M Futures 4년 5분봉 데이터 상태를 확인하는 중입니다
        </div>
      </div>
    );
  }

  // Case 2: Syncing / Insufficient Data -> strictly refuse synthetic fallback
  if (!status || !status.hasSufficientData) {
    const isError = status?.phase === 'error';
    const pct = status?.progressPercent ?? 0;

    return (
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-20 text-center space-y-5">
        {isError ? (
          <AlertTriangle className="h-7 w-7 text-rose-400" />
        ) : (
          <RefreshCw className="h-7 w-7 text-sky-400 animate-spin" />
        )}
        <div className="space-y-1.5 max-w-lg">
          <h2 className="font-display text-base font-semibold text-slate-100">
            {isError
              ? 'Binance 4년 5분봉 데이터 수집 중단'
              : 'Binance USDⓈ-M Futures 4년 5분봉 과거 데이터를 수집하고 있습니다'}
          </h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            {isError
              ? status?.lastError ?? error ?? 'API 호출 중 오류가 발생했습니다.'
              : '최근 4년간의 BTCUSDT 5분봉(~420,480봉)을 검증된 원시 OHLCV 바이너리로 구축 중입니다. 불완전한 데이터로는 유사도 통계 분석을 실행하지 않습니다.'}
          </p>
        </div>

        {status && (
          <div className="w-full max-w-md rounded-lg border border-slate-800 bg-[#0C121E] p-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between font-mono-tabular">
              <span className="text-slate-400">진행률 ({status.phase})</span>
              <span className="text-sky-300 font-semibold">{pct.toFixed(1)}%</span>
            </div>
            <div className="h-2 w-full rounded bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-sky-400 transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono-tabular text-slate-400">
              <span>
                저장 봉수: {status.storedBars.toLocaleString()} / {status.targetMinBars.toLocaleString()}
              </span>
              <span>
                페이지: {status.completedPages} / {status.totalPages || '—'}
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void onTriggerSync(false)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>동기화 재개</span>
          </button>
        </div>
      </div>
    );
  }

  const integrity = status.integrity;
  const isSyncing =
    status.phase === 'backfilling' ||
    status.phase === 'repairing_gaps' ||
    status.phase === 'updating_incremental';

  return (
    <div className="flex-1 flex flex-col">
      {/* Live Provenance & Integrity Strip */}
      <div className="border-b border-slate-800/80 bg-[#0A0F1A] px-5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-emerald-400">실제 API 연동 (Live)</span>
          <span aria-hidden="true">·</span>
          <span>
            {status.exchange} {status.symbol} ({status.interval})
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono-tabular text-slate-300">
            마감 5분봉 {integrity.totalStoredBars.toLocaleString()}개 (결측 {integrity.missingBarsTotal}개 · 중복제거{' '}
            {integrity.duplicateRowsRemoved}개)
          </span>
          {integrity.startTimestampMs && integrity.endTimestampMs && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular text-slate-500">
                {new Date(integrity.startTimestampMs).toISOString().slice(0, 10)} ~{' '}
                {new Date(integrity.endTimestampMs).toISOString().slice(0, 16).replace('T', ' ')} UTC
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={isSyncing}
            onClick={() => void onTriggerSync(false)}
            className="inline-flex items-center gap-1 text-[11px] text-slate-300 hover:text-white disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? '증분 동기화 중...' : '최신 봉 증분 업데이트'}</span>
          </button>
        </div>
      </div>

      {/* Analysis Control Bar */}
      <section
        id="signal-controls"
        className="border-b border-slate-800/80 bg-[#0C121E]/70 px-5 py-4"
      >
        <div className="mx-auto max-w-[1440px] space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            {/* Target Timestamp */}
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-400">
                기준 시점 (UTC 5분봉)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="datetime-local"
                  value={targetInputStr}
                  min={analysis ? toUtcDatetimeLocal(analysis.dataSpan.availableTargetsMinMs) : undefined}
                  max={analysis ? toUtcDatetimeLocal(analysis.dataSpan.availableTargetsMaxMs) : undefined}
                  onChange={(e) => {
                    setUseLatestTarget(false);
                    setTargetInputStr(e.target.value);
                  }}
                  className="rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100 focus:border-sky-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    setUseLatestTarget(true);
                    if (analysis) {
                      setTargetInputStr(toUtcDatetimeLocal(analysis.dataSpan.availableTargetsMaxMs));
                    }
                    handleRun(undefined, true);
                  }}
                  className={`px-2.5 py-1.5 rounded border text-xs whitespace-nowrap cursor-pointer ${
                    useLatestTarget
                      ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
                      : 'border-slate-700 bg-[#090D16] text-slate-300 hover:text-white'
                  }`}
                >
                  최신 마감봉
                </button>
              </div>
            </div>

            {/* Distance Metric */}
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-400">거리 척도</label>
              <select
                value={distanceMetric}
                onChange={(e) => setDistanceMetric(e.target.value as DistanceMetricType)}
                className="rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-400 focus:outline-none"
              >
                <option value="mahalanobis">마할라노비스 거리 (공분산 보정)</option>
                <option value="euclidean">표준화 유클리드 거리</option>
              </select>
            </div>

            {/* Threshold */}
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-400">
                유사도 거리 임계값 (Threshold)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step="0.05"
                  min="0.1"
                  max="10"
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                  className="w-20 rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100 focus:border-sky-400 focus:outline-none"
                />
                {analysis && (
                  <div className="flex items-center gap-1 text-[11px] font-mono-tabular">
                    <button
                      type="button"
                      onClick={() => {
                        const v = analysis.thresholdGuidance.recommendedLow;
                        setThresholdInput(v.toFixed(2));
                        handleRun(v);
                      }}
                      className="px-2 py-1 rounded border border-slate-700 bg-[#090D16] text-slate-300 hover:border-slate-500 cursor-pointer"
                      title="상위 ~0.15% 근접 매치"
                    >
                      엄격 ({analysis.thresholdGuidance.recommendedLow.toFixed(2)})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const v = analysis.thresholdGuidance.recommendedMid;
                        setThresholdInput(v.toFixed(2));
                        handleRun(v);
                      }}
                      className="px-2 py-1 rounded border border-slate-700 bg-[#090D16] text-slate-300 hover:border-slate-500 cursor-pointer"
                      title="상위 ~0.5% 근접 매치"
                    >
                      권장 ({analysis.thresholdGuidance.recommendedMid.toFixed(2)})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const v = analysis.thresholdGuidance.recommendedHigh;
                        setThresholdInput(v.toFixed(2));
                        handleRun(v);
                      }}
                      className="px-2 py-1 rounded border border-slate-700 bg-[#090D16] text-slate-300 hover:border-slate-500 cursor-pointer"
                      title="상위 ~1.5% 근접 매치"
                    >
                      확장 ({analysis.thresholdGuidance.recommendedHigh.toFixed(2)})
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Min Gap Hours */}
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-400">중복 제거 최소 간격</label>
              <select
                value={minGapHours}
                onChange={(e) => setMinGapHours(Number(e.target.value))}
                className="rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100 focus:border-sky-400 focus:outline-none"
              >
                <option value={12}>12시간 (144봉)</option>
                <option value={24}>24시간 (288봉 · 기본)</option>
                <option value={48}>48시간 (576봉)</option>
                <option value={72}>72시간 (864봉)</option>
              </select>
            </div>

            {/* Market Regime Filter */}
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-400">시장 체제 필터</label>
              <select
                value={regimeFilter}
                onChange={(e) => setRegimeFilter(e.target.value as MarketRegimeId | 'all')}
                className="rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-400 focus:outline-none"
              >
                <option value="all">전체 시장</option>
                {REGIME_ORDER.map((id) => (
                  <option key={id} value={id}>
                    {REGIME_LABELS[id].koreanLabel}
                  </option>
                ))}
              </select>
            </div>

            {/* Ablation Horizon */}
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-400">비교/Ablation 시계</label>
              <select
                value={ablationHorizon}
                onChange={(e) => setAblationHorizon(e.target.value as HorizonKey)}
                className="rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100 focus:border-sky-400 focus:outline-none"
              >
                {(['30m', '1h', '3h', '6h', '12h', '24h'] as HorizonKey[]).map((hk) => (
                  <option key={hk} value={hk}>
                    {hk}
                  </option>
                ))}
              </select>
            </div>

            {/* Indicator Subset Picker Toggle & Run CTA */}
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={() => setShowIndicatorPicker((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-[#090D16] px-3 py-1.5 text-xs text-slate-200 hover:border-slate-500 cursor-pointer whitespace-nowrap"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
                <span>지표 축 ({selectedIndicators.length}/8)</span>
              </button>

              <button
                type="button"
                disabled={runningAnalysis}
                onClick={() => handleRun()}
                className="inline-flex items-center gap-1.5 rounded bg-sky-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-60 cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${runningAnalysis ? 'animate-spin' : ''}`} />
                <span>{runningAnalysis ? '연산 중...' : '유사 구간 분석 실행'}</span>
              </button>
            </div>
          </div>

          {/* Collapsible Indicator Picker */}
          {showIndicatorPicker && (
            <div className="rounded border border-slate-800 bg-[#090D16] p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {ALL_INDICATOR_IDS.map((id) => {
                  const active = selectedIndicators.includes(id);
                  const excludedByIndep = analysis?.independence.excludedIndicatorIds.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleToggleIndicator(id)}
                      className={`px-2.5 py-1 rounded border transition-colors cursor-pointer ${
                        active
                          ? 'border-sky-500/60 bg-sky-500/20 text-sky-200'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {INDICATOR_DEFINITIONS[id].shortLabel}
                      {excludedByIndep && <span className="ml-1 text-[10px] text-amber-300">(중복)</span>}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                {analysis && (
                  <button
                    type="button"
                    onClick={() => setSelectedIndicators(analysis.independence.activeIndicatorIds)}
                    className="text-sky-300 hover:underline cursor-pointer"
                  >
                    독립 {analysis.independence.activeIndicatorIds.length}개 선택
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedIndicators([...ALL_INDICATOR_IDS])}
                  className="text-slate-400 hover:text-slate-200 hover:underline cursor-pointer"
                >
                  전체 8개 선택
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded border border-rose-800/70 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          )}

          {analysis?.thresholdGuidance.warningMessage && (
            <div className="rounded border border-amber-700/60 bg-amber-950/25 px-3 py-2 text-xs text-amber-200">
              {analysis.thresholdGuidance.warningMessage}
            </div>
          )}
        </div>
      </section>

      {/* Main Content once analysis is computed */}
      {!analysis ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20 px-5 text-center space-y-3">
          <RefreshCw className="h-6 w-6 text-sky-400 animate-spin" />
          <div className="text-sm text-slate-200">
            4년 5분봉 지표 계산 및 유사도 통계 엔진을 초기화하는 중입니다...
          </div>
        </div>
      ) : (
        <>
          {/* Section B: Target Candle State & 8 Technical Indicators */}
          <section
            id="signal-indicators"
            className="mx-auto w-full max-w-[1440px] px-5 py-6 border-b border-slate-800/80 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="font-display text-lg font-semibold text-slate-50">
                    기준 시점 시장 상태 및 8대 기술적 시그널
                  </h1>
                  <span className="text-xs font-medium text-sky-300">
                    · {analysis.targetState.regimeLabel}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-mono-tabular mt-0.5">
                  대상 5분봉: {new Date(analysis.targetState.openTimeMs).toISOString().replace('T', ' ').slice(0, 16)} UTC ·
                  종가 ${analysis.targetState.close.toLocaleString(undefined, { maximumFractionDigits: 1 })} ·
                  거래량 {analysis.targetState.volume.toFixed(1)} BTC
                </p>
              </div>

              {/* Compact Key KPI Strip */}
              <div className="flex flex-wrap items-center gap-6 text-xs">
                <div>
                  <div className="text-[11px] text-slate-400">원시 후보 → 독립 매치</div>
                  <div className="font-mono-tabular text-sm font-semibold text-slate-100">
                    {analysis.clustering.rawCandidatesCount.toLocaleString()} →{' '}
                    <span className="text-sky-300">{analysis.clustering.acceptedCount.toLocaleString()}건</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400">적용 척도 · 임계값</div>
                  <div className="font-mono-tabular text-sm font-semibold text-slate-100">
                    {analysis.request.distanceMetric === 'mahalanobis' ? 'Mahalanobis' : 'Euclidean'} ≤{' '}
                    {analysis.request.threshold.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400">24h 기대수익 / 승률</div>
                  {(() => {
                    const h24 = analysis.horizonStats.find((h) => h.horizon === '24h');
                    return (
                      <div className="font-mono-tabular text-sm font-semibold">
                        <span
                          className={
                            h24?.meanReturnPct === null || h24?.meanReturnPct === undefined
                              ? 'text-slate-400'
                              : h24.meanReturnPct >= 0
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                          }
                        >
                          {h24?.meanReturnPct !== null && h24?.meanReturnPct !== undefined
                            ? `${h24.meanReturnPct >= 0 ? '+' : ''}${h24.meanReturnPct.toFixed(3)}%`
                            : 'N/A'}
                        </span>
                        <span className="text-slate-500"> / </span>
                        <span className="text-slate-200">
                          {h24?.winRatePct !== null && h24?.winRatePct !== undefined
                            ? `${h24.winRatePct.toFixed(1)}%`
                            : 'N/A'}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* 8 Indicator Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {analysis.targetState.indicators.map((snap) => {
                const def = INDICATOR_DEFINITIONS[snap.id];
                const isSelectedAxis = analysis.request.selectedIndicators.includes(snap.id);
                const isExcludedRedundant = analysis.independence.excludedIndicatorIds.includes(snap.id);

                return (
                  <div
                    key={snap.id}
                    className={`rounded-lg border p-3.5 transition-colors ${
                      isSelectedAxis
                        ? 'border-slate-700 bg-[#0C121E]'
                        : 'border-slate-800/70 bg-[#0A0F1A] opacity-80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-slate-100">{def.shortLabel}</div>
                        <div className="text-[11px] text-slate-400">{def.koreanName}</div>
                      </div>
                      <span
                        className={`text-[10px] font-medium ${
                          isSelectedAxis
                            ? 'text-sky-300'
                            : isExcludedRedundant
                              ? 'text-amber-300'
                              : 'text-slate-500'
                        }`}
                      >
                        {isSelectedAxis ? '벡터 포함' : isExcludedRedundant ? '중복 제외' : '비활성'}
                      </span>
                    </div>

                    <div className="mt-2.5 flex items-baseline justify-between font-mono-tabular">
                      <span className="text-lg font-semibold text-slate-50">
                        {snap.rawValue === null ? 'N/A' : snap.rawValue.toFixed(3)}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Z {snap.normalizedValue === null ? 'N/A' : `${snap.normalizedValue >= 0 ? '+' : ''}${snap.normalizedValue.toFixed(2)}σ`}
                      </span>
                    </div>

                    {/* Causal percentile bar */}
                    <div className="mt-2 space-y-1">
                      <div className="h-1 w-full rounded bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-sky-400/80"
                          style={{ width: `${Math.max(2, snap.percentileRank ?? 0)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono-tabular">
                        <span>인과적 백분위</span>
                        <span>
                          {snap.percentileRank === null ? 'N/A' : `${snap.percentileRank.toFixed(1)}%`}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 pt-2 border-t border-slate-800/70 text-[10px] text-slate-500 truncate" title={def.formulaSummary}>
                      {def.formulaSummary}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Section C: 4-Year BTC Price & Match Map + Detail Trajectory */}
          <SignalPriceMatchesChart
            overviewSeries={analysis.priceOverviewSeries}
            matches={analysis.matches}
            targetTimestampMs={analysis.targetState.openTimeMs}
            targetClose={analysis.targetState.close}
            selectedMatchRank={selectedMatchRank}
            selectedMatchDetail={selectedMatchDetail}
            loadingMatchDetail={loadingMatchDetail}
            onSelectMatch={(m) => void onSelectMatch(m)}
          />

          {/* Section D: Forward Return Statistics Table & 4 SVG Charts */}
          <ForwardReturnChartsSection horizonStats={analysis.horizonStats} />

          {/* Section E: Tabbed Deep Quantitative Audits */}
          <SignalAuditTabs
            analysis={analysis}
            selectedMatchRank={selectedMatchRank}
            onSelectMatch={(m) => void onSelectMatch(m)}
          />

          {/* Section F: Architecture & Quantitative Methodology Footer */}
          <section
            id="architecture"
            className="mx-auto w-full max-w-[1440px] px-5 border-t border-slate-800/80 pt-8 pb-10 grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-slate-400"
          >
            <div>
              <h3 className="text-sm font-semibold text-slate-200 mb-1.5">
                데이터 파이프라인 및 인과성 원칙
              </h3>
              <p className="leading-relaxed">
                Binance USDⓈ-M Futures <strong className="text-slate-200">BTCUSDT 5분봉</strong> 최근 4년치를 마감 완료 봉만 필터링하여 원시 OHLCV 바이너리로 영구 저장합니다. 모든 지표 정규화·공분산 행렬·시장 체제 분류·유사 구간 탐색은 기준 시점(<span className="font-mono-tabular">t</span>) 이전 데이터만 사용하는 <strong className="text-sky-300">엄격한 인과적(Causal)</strong> 구조로 미래 정보 누수를 차단합니다.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-200 mb-1.5">
                8대 기술적 시그널 및 중복성 제어
              </h3>
              <p className="leading-relaxed">
                외부 지표 라이브러리 없이 순수 수학 공식으로 ER(48), Wilder RSI(14), VWAP-Z(48), 실현변동성 RV(48), 상대거래량 RVOL(48), 매수압력 VP(12), Donchian(48), Amihud 비유동성(48)을 직접 계산합니다. Pearson/Spearman 상관계수 <span className="font-mono-tabular">|r| ≥ 0.80</span> 중복 축은 감사 행렬을 통해 자동 감지·제외 권고하며, 마할라노비스 거리로 지표 간 상관구조를 보정합니다.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-200 mb-1.5">
                시간적 중복 제거 및 통계적 엄격성
              </h3>
              <p className="leading-relaxed">
                연속된 5분봉 군집 과대표집을 방지하기 위해 최소 <span className="font-mono-tabular">24시간</span> 간격으로 탐욕적 중복 제거를 수행합니다. 모든 사후 수익률 검정은 자기상관을 반영한 유효표본수(ESS), 원형 블록 부트스트랩 95% 신뢰구간, Newey-West HAC, Welch t, Mann-Whitney U 및 6개 시계 동시 Benjamini-Hochberg FDR 다중검정 보정을 적용합니다.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
