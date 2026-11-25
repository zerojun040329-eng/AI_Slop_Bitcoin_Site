import { useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { TopBar, type DashboardPageId } from './components/TopBar';
import { UnifiedDerivativesChart } from './components/UnifiedDerivativesChart';
import { AnalyticsDetailsPanel } from './components/AnalyticsDetailsPanel';
import { LongTermDashboardPage } from './components/longTerm/LongTermDashboardPage';
import { SignalAnalysisPage } from './components/signalAnalysis/SignalAnalysisPage';
import { RealTestPage } from './components/realTest/RealTestPage';
import { useDerivativesMarketData, useLongTermMarketData } from './hooks/useMarketData';
import { useSignalAnalysis } from './hooks/useSignalAnalysis';
import { useRealTest } from './hooks/useRealTest';
import type { LayerVisibility } from './types/derivatives';
import {
  calculateExpectedVolatilityMoves,
  calculateMaxPain,
  calculateMaxPainByMaturity,
  summarizeLiquidations,
} from './utils/analytics';

export default function App() {
  const [activePage, setActivePage] = useState<DashboardPageId>('derivatives');
  const [visibility, setVisibility] = useState<LayerVisibility>({
    showIV: true,
    showMaxPain: true,
    showLiquidations: true,
  });
  const [selectedTenor, setSelectedTenor] = useState<string | null>(null);

  const derivativesState = useDerivativesMarketData(activePage === 'derivatives');
  const longTermState = useLongTermMarketData(activePage === 'long_term');
  const signalState = useSignalAnalysis(activePage === 'signal_analysis');
  const realTestState = useRealTest(activePage === 'strategy_backtest');

  const snapshot = derivativesState.data;

  const expectedMoves = useMemo(
    () =>
      snapshot
        ? calculateExpectedVolatilityMoves(snapshot.currentPrice, snapshot.optionMaturities)
        : [],
    [snapshot],
  );

  const maxPain = useMemo(
    () =>
      snapshot
        ? calculateMaxPain(snapshot.optionStrikesOI, snapshot.currentPrice)
        : null,
    [snapshot],
  );

  const maturityMaxPains = useMemo(
    () =>
      snapshot
        ? calculateMaxPainByMaturity(snapshot.optionMaturities, snapshot.currentPrice)
        : [],
    [snapshot],
  );

  const liquidationSummary = useMemo(
    () =>
      snapshot
        ? summarizeLiquidations(snapshot.liquidationBins, snapshot.currentPrice)
        : null,
    [snapshot],
  );

  const handleToggleLayer = (key: keyof LayerVisibility) => {
    setVisibility((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 flex flex-col">
      <TopBar activePage={activePage} onSelectPage={setActivePage} />

      {activePage === 'derivatives' ? (
        <main className="flex-1 flex flex-col">
          {derivativesState.loading && !snapshot ? (
            <div className="flex-1 flex flex-col items-center justify-center px-5 py-24 text-center space-y-3">
              <RefreshCw className="h-6 w-6 text-sky-400 animate-spin" />
              <div className="text-sm font-medium text-slate-200">
                Deribit 실시간 BTC 파생상품 데이터를 불러오는 중입니다
              </div>
              <p className="text-xs text-slate-400 max-w-md">
                현물 지수, 30일 BTC-PERPETUAL 일봉 종가, 활성 옵션 체인(만기별 IV · 미결제약정)을 조회하고 있습니다.
              </p>
            </div>
          ) : !snapshot || !maxPain || !liquidationSummary ? (
            <div className="flex-1 flex flex-col items-center justify-center px-5 py-24 text-center space-y-4">
              <AlertTriangle className="h-7 w-7 text-rose-400" />
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-100">
                  파생상품 실시간 API 연동 실패
                </h2>
                <p className="text-xs text-rose-300 max-w-lg font-mono-tabular">
                  {derivativesState.error ?? 'Deribit 공개 API 응답을 수신하지 못했습니다.'}
                </p>
                <p className="text-xs text-slate-500 max-w-lg pt-1">
                  임의의 테스트 데이터나 캐시 모의 값으로 대체하지 않습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.
                </p>
              </div>
              <button
                type="button"
                onClick={derivativesState.refresh}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>API 다시 불러오기</span>
              </button>
            </div>
          ) : (
            <>
              {/* Live API Provenance Context Strip */}
              <div className="border-b border-slate-800/80 bg-[#0A0F1A] px-5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-emerald-400">실제 API 연동 (Live)</span>
                  <span aria-hidden="true">·</span>
                  <span>{snapshot.sourceLabel}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-tabular text-slate-500">
                    수신 {snapshot.timestampIso.replace('T', ' ').slice(0, 19)} UTC
                  </span>
                </div>
                <div className="text-slate-500">
                  {snapshot.description}
                </div>
              </div>

              {derivativesState.error && (
                <div className="border-b border-rose-900/60 bg-rose-950/30 px-5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-rose-200">
                  <span>최신 갱신 실패 ({derivativesState.error}) — 마지막 정상 수신 스냅샷을 표시 중입니다.</span>
                  <button
                    type="button"
                    onClick={derivativesState.refresh}
                    className="underline hover:text-white cursor-pointer"
                  >
                    재시도
                  </button>
                </div>
              )}

              <UnifiedDerivativesChart
                snapshot={snapshot}
                expectedMoves={expectedMoves}
                maxPain={maxPain}
                maturityMaxPains={maturityMaxPains}
                liquidationSummary={liquidationSummary}
                visibility={visibility}
                onToggleLayer={handleToggleLayer}
                selectedTenor={selectedTenor}
                onSelectTenor={setSelectedTenor}
                onRefresh={derivativesState.refresh}
                isRefreshing={derivativesState.refreshing}
              />

              <AnalyticsDetailsPanel
                snapshot={snapshot}
                expectedMoves={expectedMoves}
                maxPain={maxPain}
                liquidationSummary={liquidationSummary}
                selectedTenor={selectedTenor}
                onSelectTenor={setSelectedTenor}
              />
            </>
          )}
        </main>
      ) : activePage === 'long_term' ? (
        <main className="flex-1 flex flex-col">
          {longTermState.loading && !longTermState.data ? (
            <div className="flex-1 flex flex-col items-center justify-center px-5 py-24 text-center space-y-3">
              <RefreshCw className="h-6 w-6 text-amber-400 animate-spin" />
              <div className="text-sm font-medium text-slate-200">
                장기 온체인 · 초장기 가격 데이터를 불러오는 중입니다
              </div>
              <p className="text-xs text-slate-400 max-w-md">
                Coin Metrics Community 일봉 전체 시계열(2010년~현재)과 Mempool.space 블록·해시레이트·난이도·24h 수수료 데이터를 조회하고 있습니다.
              </p>
            </div>
          ) : !longTermState.data ? (
            <div className="flex-1 flex flex-col items-center justify-center px-5 py-24 text-center space-y-4">
              <AlertTriangle className="h-7 w-7 text-rose-400" />
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-100">
                  장기투자 데이터 API 연동 실패
                </h2>
                <p className="text-xs text-rose-300 max-w-lg font-mono-tabular">
                  {longTermState.error ?? 'Coin Metrics 또는 Mempool.space API 응답을 수신하지 못했습니다.'}
                </p>
                <p className="text-xs text-slate-500 max-w-lg pt-1">
                  임의의 테스트 데이터로 대체하지 않습니다. 잠시 후 다시 시도해 주세요.
                </p>
              </div>
              <button
                type="button"
                onClick={longTermState.refresh}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>API 다시 불러오기</span>
              </button>
            </div>
          ) : (
            <>
              {longTermState.error && (
                <div className="border-b border-rose-900/60 bg-rose-950/30 px-5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-rose-200">
                  <span>최신 갱신 실패 ({longTermState.error}) — 마지막 정상 수신 데이터를 표시 중입니다.</span>
                  <button
                    type="button"
                    onClick={longTermState.refresh}
                    className="underline hover:text-white cursor-pointer"
                  >
                    재시도
                  </button>
                </div>
              )}

              <LongTermDashboardPage
                dataset={longTermState.data}
                onRefresh={longTermState.refresh}
                isRefreshing={longTermState.refreshing}
              />
            </>
          )}
        </main>
      ) : activePage === 'signal_analysis' ? (
        <main className="flex-1 flex flex-col">
          <SignalAnalysisPage
            status={signalState.status}
            analysis={signalState.analysis}
            selectedMatchDetail={signalState.selectedMatchDetail}
            selectedMatchRank={signalState.selectedMatchRank}
            loadingStatus={signalState.loadingStatus}
            runningAnalysis={signalState.runningAnalysis}
            loadingMatchDetail={signalState.loadingMatchDetail}
            error={signalState.error}
            onTriggerSync={signalState.triggerSync}
            onRunAnalysis={signalState.run}
            onSelectMatch={signalState.selectMatch}
          />
        </main>
      ) : (
        <main className="flex-1 flex flex-col">
          <RealTestPage
            inputs={realTestState.inputs}
            onChangeBudget={realTestState.setTotalBudgetUsd}
            onChangeFee={realTestState.setFeeRatePct}
            result={realTestState.result}
            provenance={realTestState.provenance}
            loading={realTestState.loading}
            refreshing={realTestState.refreshing}
            error={realTestState.error}
            onRefresh={realTestState.refresh}
          />
        </main>
      )}
    </div>
  );
}
