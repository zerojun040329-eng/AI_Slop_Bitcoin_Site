import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { SyncStatus } from '../../types/signalAnalysis';
import type {
  BacktestAccountConfig,
  LiquidityFakeoutParams,
  StrategyBacktestResponse,
  StrategyBacktestRunRequest,
  StrategyId,
  StrategyMetadata,
  TradeDetailWindowResponse,
  TradeRecord,
} from '../../types/strategyBacktest';
import { StrategySettings } from './StrategySettings';
import { PerformanceOverview } from './PerformanceOverview';
import { DrawdownChart } from './DrawdownChart';
import { MonthlyPerformance } from './MonthlyPerformance';
import { TradeHistory } from './TradeHistory';

interface StrategyDashboardProps {
  syncStatus: SyncStatus | null;
  strategies: StrategyMetadata[];
  result: StrategyBacktestResponse | null;
  selectedTradeWindow: TradeDetailWindowResponse | null;
  loadingInit: boolean;
  runningBacktest: boolean;
  loadingTradeWindow: boolean;
  error: string | null;
  onTriggerSync: () => Promise<SyncStatus | null>;
  onRunBacktest: (req: StrategyBacktestRunRequest) => Promise<StrategyBacktestResponse | null>;
  onSelectTrade: (trade: TradeRecord | null) => Promise<void>;
}

const FALLBACK_STRATEGY_PARAMS: LiquidityFakeoutParams = {
  pivotLeftBars: 12,
  pivotRightBars: 12,
  rvolPeriod: 48,
  minRvol: 1.8,
  minReversalStrength: 0.5,
  minRangeAtrMultiple: 1.2,
  minVolumeSurgeRatio: 1.5,
  atrPeriod: 14,
  tp1AtrMultiple: 1.5,
  tp2AtrMultiple: 3.0,
  sweepWindowBars: 2,
  maxPivotAgeBars: 288,
};

const FALLBACK_ACCOUNT: BacktestAccountConfig = {
  initialCapital: 10_000,
  positionSizePct: 25,
  leverage: 2,
  feeRatePct: 0.04,
  slippagePct: 0.02,
};

function msToDateStr(ms: number | null | undefined): string {
  if (!ms) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

function dateStrToStartMs(dateStr: string): number | null {
  if (!dateStr) return null;
  const ms = Date.parse(`${dateStr}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

function dateStrToEndMs(dateStr: string): number | null {
  if (!dateStr) return null;
  const ms = Date.parse(`${dateStr}T23:55:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

export const StrategyDashboard: React.FC<StrategyDashboardProps> = ({
  syncStatus,
  strategies,
  result,
  selectedTradeWindow,
  loadingInit,
  runningBacktest,
  loadingTradeWindow,
  error,
  onTriggerSync,
  onRunBacktest,
  onSelectTrade,
}) => {
  const [selectedStrategyId, setSelectedStrategyId] = useState<StrategyId>('liquidity_fakeout');
  const [strategyParams, setStrategyParams] =
    useState<LiquidityFakeoutParams>(FALLBACK_STRATEGY_PARAMS);
  const [accountConfig, setAccountConfig] = useState<BacktestAccountConfig>(FALLBACK_ACCOUNT);
  const [startDateStr, setStartDateStr] = useState<string>('');
  const [endDateStr, setEndDateStr] = useState<string>('');

  useEffect(() => {
    if (!result) return;
    setSelectedStrategyId(result.strategy.id);
    setStrategyParams(result.resolvedParams);
    setAccountConfig(result.resolvedAccount);
    if (!startDateStr) setStartDateStr(msToDateStr(result.dataSpan.startTimestampMs));
    if (!endDateStr) setEndDateStr(msToDateStr(result.dataSpan.endTimestampMs));
  }, [result, startDateStr, endDateStr]);

  useEffect(() => {
    if (!syncStatus?.integrity) return;
    if (!startDateStr && syncStatus.integrity.startTimestampMs) {
      setStartDateStr(msToDateStr(syncStatus.integrity.startTimestampMs));
    }
    if (!endDateStr && syncStatus.integrity.endTimestampMs) {
      setEndDateStr(msToDateStr(syncStatus.integrity.endTimestampMs));
    }
  }, [syncStatus, startDateStr, endDateStr]);

  const handleResetDefaults = () => {
    const meta = strategies.find((s) => s.id === selectedStrategyId) ?? strategies[0];
    setStrategyParams(meta ? { ...meta.defaultParams } : { ...FALLBACK_STRATEGY_PARAMS });
    setAccountConfig({ ...FALLBACK_ACCOUNT });
    if (syncStatus?.integrity.startTimestampMs) {
      setStartDateStr(msToDateStr(syncStatus.integrity.startTimestampMs));
    }
    if (syncStatus?.integrity.endTimestampMs) {
      setEndDateStr(msToDateStr(syncStatus.integrity.endTimestampMs));
    }
  };

  const handleExecute = () => {
    void onRunBacktest({
      strategyId: selectedStrategyId,
      strategyParams,
      account: accountConfig,
      startTimestampMs: dateStrToStartMs(startDateStr),
      endTimestampMs: dateStrToEndMs(endDateStr),
    });
  };

  if (loadingInit && !syncStatus) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-24 text-center space-y-3">
        <RefreshCw className="h-6 w-6 text-sky-400 animate-spin" />
        <div className="text-sm font-medium text-slate-200">
          4년 BTCUSDT 5분봉 원시 데이터 및 전략 엔진 상태를 확인하는 중입니다
        </div>
      </div>
    );
  }

  if (!syncStatus || !syncStatus.hasSufficientData) {
    const isError = syncStatus?.phase === 'error';
    const pct = syncStatus?.progressPercent ?? 0;

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
              : '4년 BTCUSDT 5분봉 원시 데이터를 준비하고 있습니다'}
          </h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            {isError
              ? syncStatus?.lastError ?? error ?? 'API 호출 중 오류가 발생했습니다.'
              : '불완전하거나 가상의 캔들 데이터로 전략 백테스트를 실행하지 않습니다. 공용 5분봉 원시 바이너리 저장소 구축 완료 후 자동으로 백테스트가 시작됩니다.'}
          </p>
        </div>

        {syncStatus && (
          <div className="w-full max-w-md rounded-lg border border-slate-800 bg-[#0C121E] p-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between font-mono-tabular">
              <span className="text-slate-400">진행률 ({syncStatus.phase})</span>
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
                저장 봉수: {syncStatus.storedBars.toLocaleString()} /{' '}
                {syncStatus.targetMinBars.toLocaleString()}
              </span>
              <span>
                페이지: {syncStatus.completedPages} / {syncStatus.totalPages || '—'}
              </span>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => void onTriggerSync()}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700 cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>동기화 재개</span>
        </button>
      </div>
    );
  }

  const minDateStr = msToDateStr(syncStatus.integrity.startTimestampMs);
  const maxDateStr = msToDateStr(syncStatus.integrity.endTimestampMs);

  return (
    <div className="flex-1 flex flex-col">
      {/* Live Provenance Context Strip */}
      <div className="border-b border-slate-800/80 bg-[#0A0F1A] px-5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-emerald-400">실제 데이터 백테스트 (Live Raw OHLCV)</span>
          <span aria-hidden="true">·</span>
          <span>
            {syncStatus.exchange} {syncStatus.symbol} ({syncStatus.interval})
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono-tabular text-slate-300">
            저장 5분봉 {syncStatus.integrity.totalStoredBars.toLocaleString()}개
          </span>
          {result && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular text-slate-400">
                평가 {result.dataSpan.totalBarsEvaluated.toLocaleString()}봉 ({result.computedInMs}ms 연산)
              </span>
            </>
          )}
        </div>
        <div className="text-[11px] text-slate-500">
          독립 백테스팅 엔진 · Look-ahead Bias 차단 (Pivot 우측 확정 + 다음 봉 시가 체결)
        </div>
      </div>

      {/* Strategy Configuration & Controls */}
      <StrategySettings
        strategies={strategies}
        selectedStrategyId={selectedStrategyId}
        onSelectStrategy={setSelectedStrategyId}
        strategyParams={strategyParams}
        onChangeStrategyParams={setStrategyParams}
        accountConfig={accountConfig}
        onChangeAccountConfig={setAccountConfig}
        startDateStr={startDateStr || minDateStr}
        endDateStr={endDateStr || maxDateStr}
        minDateStr={minDateStr}
        maxDateStr={maxDateStr}
        onChangeStartDate={setStartDateStr}
        onChangeEndDate={setEndDateStr}
        onResetDefaults={handleResetDefaults}
        onRunBacktest={handleExecute}
        isRunning={runningBacktest}
        totalStoredBars={syncStatus.integrity.totalStoredBars}
      />

      {error && (
        <div className="mx-auto w-full max-w-[1440px] px-5 pt-4">
          <div className="rounded border border-rose-800/70 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        </div>
      )}

      {!result ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20 px-5 text-center space-y-3">
          <RefreshCw className="h-6 w-6 text-sky-400 animate-spin" />
          <div className="text-sm text-slate-200">
            4년 5분봉 데이터 기반 유동성 페이크 아웃 전략 백테스트를 실행하는 중입니다...
          </div>
        </div>
      ) : (
        <>
          <PerformanceOverview result={result} />
          <DrawdownChart
            equityCurve={result.equityCurve}
            initialCapitalUsd={result.resolvedAccount.initialCapital}
            maxDrawdownPct={result.risk.maxDrawdownPct}
          />
          <MonthlyPerformance result={result} />
          <TradeHistory
            trades={result.trades}
            totalTradesRecorded={result.totalTradesRecorded}
            selectedTradeWindow={selectedTradeWindow}
            loadingTradeWindow={loadingTradeWindow}
            onSelectTrade={(t) => void onSelectTrade(t)}
          />

          {/* Methodology & Engine Architecture Section */}
          <section
            id="architecture"
            className="mx-auto w-full max-w-[1440px] px-5 border-t border-slate-800/80 pt-8 pb-10 grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-slate-400"
          >
            <div>
              <h3 className="text-sm font-semibold text-slate-200 mb-1.5">
                Look-ahead Bias 차단 및 시차 체결
              </h3>
              <p className="leading-relaxed">
                유동성 스윙(Pivot High/Low)은 <span className="font-mono-tabular">pivotIndex + pivotRightBars</span> 시점이 마감된 이후에만 유효 목록에 등록됩니다. 이탈·회복 신호가 <span className="font-mono-tabular">t</span>봉 종가에 확정되면 주문은 반드시 <span className="font-mono-tabular">t+1</span>봉 시가에 편도 슬리피지·수수료를 반영해 체결됩니다.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-200 mb-1.5">
                보수적 포지션 관리 및 손익 정합성
              </h3>
              <p className="leading-relaxed">
                동시 보유 포지션은 최대 1개로 제한하며, TP1 도달 시 50% 부분 익절 후 잔여 50% 손절가를 진입가로 이동(본절 스탑)합니다. 동일 5분봉 내 손절과 익절이 동시 발생할 경우 손절 우선 원칙을 적용하며, 본절 갭 이탈 시 시가로 체결합니다.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-200 mb-1.5">
                시간 정합 리스크 지표 및 통계 검증
              </h3>
              <p className="leading-relaxed">
                Sharpe/Sortino 비율은 개별 거래 수익률이 아닌 균일 1시간 간격 포트폴리오 순자산 수익률(<span className="font-mono-tabular">√8760</span> 연율화)로 계산합니다. 기대수익의 95% 신뢰구간(모수 및 블록 부트스트랩)과 전반 60%/후반 40% 표본 외 검증으로 과최적화를 점검합니다.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
