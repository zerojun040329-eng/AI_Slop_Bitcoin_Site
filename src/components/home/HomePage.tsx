import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, ChevronUp, RefreshCw } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { MarketNetworkOverviewResponse } from '../../types/marketNetwork';
import { MarketNetworkGraph } from './MarketNetworkGraph';
import { NodeDetailFloatingPanel } from './NodeDetailFloatingPanel';
import {
  buildHomeMarketNetworkViewModel,
  type NetworkNodeId,
} from './marketNetworkAdapter';

export interface HomePageProps {
  /** Reserved extension slot for future real-time market streaming visualizers (Canvas/SVG/WebGL/Three.js) */
  renderStageLayer?: (containerRef: React.RefObject<HTMLDivElement | null>) => React.ReactNode;
  overview: MarketNetworkOverviewResponse | null;
  loading: boolean;
  syncing: boolean;
  error: string | null;
  onRefresh: () => void;
  onSyncNow: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  renderStageLayer,
  overview,
  loading,
  syncing,
  error,
  onRefresh,
  onSyncNow,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const legendAnchorRef = useRef<HTMLDivElement | null>(null);
  const [corrWindow, setCorrWindow] = useState<'24h' | '30d'>('24h');
  const [showExplanation, setShowExplanation] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<NetworkNodeId | null>(null);
  const prefersReducedMotion = Boolean(useReducedMotion());

  const networkModel = useMemo(
    () => (overview ? buildHomeMarketNetworkViewModel(overview, corrWindow) : null),
    [overview, corrWindow],
  );

  // Close legend popover or selected node floating panel on Escape / outside click
  useEffect(() => {
    if (!showExplanation && !selectedNodeId) return;

    const handleOutside = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (showExplanation && !legendAnchorRef.current?.contains(target)) {
        setShowExplanation(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowExplanation(false);
        setSelectedNodeId(null);
      }
    };

    document.addEventListener('pointerdown', handleOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showExplanation, selectedNodeId]);

  const legendTransition = {
    duration: prefersReducedMotion ? 0 : 0.2,
    ease: [0.16, 1, 0.3, 1] as const,
  };

  return (
    <section
      id="home-overview-stage"
      ref={stageRef}
      aria-label="Home Overview"
      onClick={() => setSelectedNodeId(null)}
      className="relative flex-1 w-full min-h-screen bg-[#050811] bg-[radial-gradient(circle_at_50%_46%,rgba(14,32,58,0.34)_0%,rgba(5,8,17,1)_72%)] text-slate-200 flex flex-col"
    >
      {renderStageLayer ? renderStageLayer(stageRef) : null}

      <div className="relative z-10 w-full max-w-[1440px] mx-auto px-5 pt-14 sm:pt-4 pb-6 flex-1 flex flex-col">
        {/* Minimal FUI top-right controls clear of top-left HomeFloatingMenu */}
        <header
          onClick={(e) => e.stopPropagation()}
          className="flex items-center justify-end gap-2 sm:pl-48 min-h-[36px]"
        >
          <div
            role="group"
            aria-label="상관계수 분석 기간"
            className="inline-flex rounded border border-slate-800/80 bg-[#070C17]/80 backdrop-blur-sm p-0.5"
          >
            <button
              type="button"
              onClick={() => setCorrWindow('24h')}
              className={`px-2.5 py-1 text-xs font-medium rounded-sm whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/50 ${
                corrWindow === '24h'
                  ? 'bg-cyan-500/15 text-cyan-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              24시간
            </button>
            <button
              type="button"
              onClick={() => setCorrWindow('30d')}
              className={`px-2.5 py-1 text-xs font-medium rounded-sm whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/50 ${
                corrWindow === '30d'
                  ? 'bg-cyan-500/15 text-cyan-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              30일
            </button>
          </div>

          <button
            type="button"
            onClick={onSyncNow}
            disabled={syncing || loading}
            aria-label="데이터 새로고침"
            className="inline-flex items-center gap-1.5 rounded border border-slate-800/80 bg-[#070C17]/80 backdrop-blur-sm px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-cyan-500/40 hover:text-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin text-cyan-400' : ''}`} />
            <span>{syncing ? '동기화 중' : '새로고침'}</span>
          </button>
        </header>

        {/* Top-level API error banner (only shown on actual fetch failure) */}
        {error && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="mt-3 border border-rose-900/60 bg-rose-950/30 rounded px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-rose-200"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
              <span className="font-mono-tabular">{error}</span>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              className="underline hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              재시도
            </button>
          </div>
        )}

        {/* Open digital network stage with floating node detail panel */}
        <div className="relative w-full max-w-[1220px] mx-auto h-[calc(100vh-146px)] min-h-[480px] max-h-[660px] flex items-center justify-center shrink-0">
          {loading && !networkModel ? (
            <div className="flex flex-col items-center justify-center text-center space-y-3 py-12">
              <RefreshCw className="h-6 w-6 text-cyan-400 animate-spin" />
              <div className="text-sm font-medium text-slate-300">
                네트워크 데이터를 불러오는 중입니다
              </div>
            </div>
          ) : networkModel ? (
            <>
              <MarketNetworkGraph
                model={networkModel}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
              />

              <AnimatePresence mode="wait">
                {selectedNodeId && (
                  <NodeDetailFloatingPanel
                    nodeId={selectedNodeId}
                    model={networkModel}
                    corrWindow={corrWindow}
                    onClose={() => setSelectedNodeId(null)}
                  />
                )}
              </AnimatePresence>
            </>
          ) : (
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex flex-col items-center justify-center text-center space-y-3 py-12"
            >
              <div className="text-sm font-medium text-slate-300">
                네트워크 데이터를 표시할 수 없습니다
              </div>
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-cyan-500/40 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>다시 불러오기</span>
              </button>
            </div>
          )}
        </div>

        {/* Bottom centered explanation button with upward-expanding concise graph legend */}
        <div className="mt-auto pt-2 flex justify-center">
          <div
            ref={legendAnchorRef}
            onClick={(e) => e.stopPropagation()}
            className="relative inline-flex flex-col items-center"
          >
            <AnimatePresence>
              {showExplanation && (
                <motion.aside
                  id="home-network-explanation"
                  key="network-legend-popover"
                  aria-label="네트워크 그래프 범례"
                  initial={
                    prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 10 }
                  }
                  animate={
                    prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }
                  }
                  exit={
                    prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }
                  }
                  transition={legendTransition}
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-[min(92vw,560px)] origin-bottom rounded-md border border-cyan-400/20 bg-[#070C17]/92 px-4 py-3.5 shadow-[0_0_24px_rgba(34,211,238,0.06)] backdrop-blur-md text-xs z-30"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-slate-300">
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-medium text-slate-400">노드 구분</div>
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 rounded-full border border-sky-400 bg-[#0A1322] shrink-0"
                        />
                        <span>중심 자산 (BTC)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 rounded-full border border-[#253954] bg-[#080E1A] shrink-0"
                        />
                        <span>자산시장 (SPY · QQQ · XAU · WTI · TLT)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 rounded-full border border-[#8A6732] bg-[#090F1C] shrink-0"
                        />
                        <span>거시경제 (M2 증가율 · DGS10)</span>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-[11px] font-medium text-slate-400">연결선 · 상호작용</div>
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="w-5 h-0.5 bg-emerald-400 shrink-0"
                        />
                        <span>양(+)의 상관관계</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="w-5 h-0.5 bg-rose-400 shrink-0"
                        />
                        <span>음(-)의 상관관계</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="w-5 border-t border-dashed border-emerald-400 shrink-0"
                        />
                        <span>월간 교차 상관 (BTC ↔ M2)</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                    <span>노드를 클릭하면 해당 상세 정보가 열립니다 (DGS10은 BTC 미연결)</span>
                    <span className="font-mono-tabular text-slate-500">
                      자산 5분봉 ({corrWindow === '24h' ? '24시간' : '30일'}) · 거시 월간
                    </span>
                  </div>
                </motion.aside>
              )}
            </AnimatePresence>

            <button
              type="button"
              onClick={() => setShowExplanation((prev) => !prev)}
              aria-expanded={showExplanation}
              aria-controls="home-network-explanation"
              className={`inline-flex items-center gap-2 rounded border px-4 py-2 text-xs font-medium transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/50 ${
                showExplanation
                  ? 'border-cyan-400/45 bg-cyan-500/15 text-cyan-200'
                  : 'border-slate-800/80 bg-[#070C17]/80 text-slate-300 hover:border-cyan-500/40 hover:text-slate-100'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5 shrink-0" />
              <span>설명 보기</span>
              <ChevronUp
                className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
                  showExplanation ? 'rotate-180' : ''
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
