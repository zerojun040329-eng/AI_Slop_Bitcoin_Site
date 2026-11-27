import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertTriangle, BookOpen, ChevronUp, RefreshCw } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useAssetDetail } from '../../hooks/useAssetDetail';
import type { AssetDetailId, MarketNetworkOverviewResponse } from '../../types/marketNetwork';
import { HOME_FUI_COLORS, HOME_FUI_CSS_VARS } from './homeTokens';
import {
  MarketNetworkGraph,
  type HomeRevealMode,
  type NodeScreenSnapshot,
} from './MarketNetworkGraph';
import { NodeDetailFloatingPanel } from './NodeDetailFloatingPanel';
import {
  SharedNodeMorphOverlay,
  type SharedMorphPayload,
} from './SharedNodeMorphOverlay';
import {
  buildHomeMarketNetworkViewModel,
  buildPendingHomeMarketNetworkViewModel,
  type NetworkNodeId,
} from './marketNetworkAdapter';

const LazyAssetDetailStage = lazy(() =>
  import('./detail/AssetDetailStage').then((m) => ({ default: m.AssetDetailStage })),
);

const DETAIL_SUPPORTED_IDS: ReadonlySet<NetworkNodeId> = new Set<AssetDetailId>([
  'QQQ',
  'SPY',
  'XAU',
  'TLT',
  'M2',
  'WTI',
]);

function isDetailAssetId(id: NetworkNodeId): id is AssetDetailId {
  return DETAIL_SUPPORTED_IDS.has(id);
}

function toPlainRect(rect: DOMRect): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function centeredSquareRect(
  rect: DOMRect,
  size: number,
): { left: number; top: number; width: number; height: number } {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return {
    left: cx - size / 2,
    top: cy - size / 2,
    width: size,
    height: size,
  };
}

export interface HomePageProps {
  /** Reserved extension slot for future real-time market streaming visualizers (Canvas/SVG/WebGL/Three.js) */
  renderStageLayer?: (containerRef: React.RefObject<HTMLDivElement | null>) => React.ReactNode;
  isActive?: boolean;
  overview: MarketNetworkOverviewResponse | null;
  loading: boolean;
  syncing: boolean;
  error: string | null;
  onRefresh: () => void;
  onSyncNow: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  renderStageLayer,
  isActive = true,
  overview,
  loading,
  syncing,
  error,
  onRefresh,
  onSyncNow,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const legendAnchorRef = useRef<HTMLDivElement | null>(null);
  const detailCenterAnchorRef = useRef<HTMLDivElement | null>(null);
  const nodeSnapshotGetterRef = useRef<((id: NetworkNodeId) => NodeScreenSnapshot | null) | null>(
    null,
  );

  const [corrWindow, setCorrWindow] = useState<'24h' | '30d'>('24h');
  const [showExplanation, setShowExplanation] = useState(false);

  // State A: selectedNodeId === null && detailAssetId === null
  // State B: selectedNodeId !== null && detailAssetId === null
  // State C: detailAssetId !== null (lazy-loaded expanded detail view)
  const [selectedNodeId, setSelectedNodeId] = useState<NetworkNodeId | null>(null);
  const [detailAssetId, setDetailAssetId] = useState<AssetDetailId | null>(null);

  // Shared element transition state (node <-> detail center)
  const [pendingEnterMorph, setPendingEnterMorph] = useState<{
    assetId: AssetDetailId;
    snapshot: NodeScreenSnapshot;
  } | null>(null);
  const [activeMorph, setActiveMorph] = useState<SharedMorphPayload | null>(null);
  const [returningNodeId, setReturningNodeId] = useState<NetworkNodeId | null>(null);

  // Separate progressive reveal state from API loading and tab re-entry:
  // 'initial' runs strictly once on first Home activation; tab re-entry preserves
  // the existing graph DOM without resetting nodes/edges to opacity: 0.
  const hasEnteredOnceRef = useRef(isActive);
  const prevActiveRef = useRef(isActive);
  const [isReentrySettling, setIsReentrySettling] = useState(false);
  const [revealState, setRevealState] = useState<{ mode: HomeRevealMode; runId: number }>({
    mode: isActive ? 'initial' : 'none',
    runId: isActive ? 1 : 0,
  });

  // Synchronously handle tab hide/restore BEFORE paint so returning to Home never flashes
  useLayoutEffect(() => {
    const wasActive = prevActiveRef.current;
    prevActiveRef.current = isActive;

    if (!isActive && wasActive) {
      setIsReentrySettling(false);
      setRevealState((prev) => (prev.mode === 'none' ? prev : { ...prev, mode: 'none' }));
      return;
    }

    if (isActive && !wasActive) {
      if (!hasEnteredOnceRef.current) {
        hasEnteredOnceRef.current = true;
        setRevealState({ mode: 'initial', runId: 1 });
      } else if (!detailAssetId) {
        setRevealState((prev) => ({ mode: 'reentry', runId: prev.runId + 1 }));
        setIsReentrySettling(true);
      }
    }
  }, [isActive, detailAssetId]);

  const prefersReducedMotion = Boolean(useReducedMotion());

  // Measure target center anchor synchronously before paint when entering State C
  useLayoutEffect(() => {
    if (!pendingEnterMorph) return;

    const { assetId, snapshot } = pendingEnterMorph;
    const anchorRect = detailCenterAnchorRef.current?.getBoundingClientRect();
    const stageRect = stageRef.current?.getBoundingClientRect();

    let toRect: { left: number; top: number; width: number; height: number };
    if (anchorRect && anchorRect.width > 0 && anchorRect.height > 0) {
      toRect = centeredSquareRect(anchorRect, 140);
    } else if (stageRect) {
      toRect = centeredSquareRect(stageRect, 140);
    } else {
      toRect = centeredSquareRect(snapshot.rect, 140);
    }

    setPendingEnterMorph(null);
    setActiveMorph({
      phase: 'entering',
      snapshot,
      fromRect: toPlainRect(snapshot.rect),
      toRect,
      onComplete: () => {
        setActiveMorph((curr) =>
          curr?.phase === 'entering' && curr.snapshot.label === snapshot.label ? null : curr,
        );
      },
    });
    void assetId;
  }, [pendingEnterMorph]);

  // Clear temporary returning node highlight halo cleanly
  useEffect(() => {
    if (!returningNodeId) return;
    const timer = window.setTimeout(() => {
      setReturningNodeId((curr) => (curr === returningNodeId ? null : curr));
    }, 620);
    return () => window.clearTimeout(timer);
  }, [returningNodeId]);

  // Strictly lazy: only fetches /api/market-network/detail/:assetId when detailAssetId is non-null (State C)
  const detailState = useAssetDetail(detailAssetId);

  const pendingModel = useMemo(() => buildPendingHomeMarketNetworkViewModel(), []);
  const networkModel = useMemo(
    () => (overview ? buildHomeMarketNetworkViewModel(overview, corrWindow) : null),
    [overview, corrWindow],
  );
  const activeNetworkModel = networkModel ?? pendingModel;

  const isEnteringMorph = Boolean(
    pendingEnterMorph || activeMorph?.phase === 'entering',
  );
  const isExitingMorph = activeMorph?.phase === 'exiting';
  const showDetailOverlay = Boolean(detailAssetId);

  const handleCloseDetail = useCallback(() => {
    if (!detailAssetId || isExitingMorph) return;

    const closingAssetId = detailAssetId;
    const targetSnapshot = nodeSnapshotGetterRef.current?.(closingAssetId) ?? null;
    const anchorRect = detailCenterAnchorRef.current?.getBoundingClientRect();

    if (
      !prefersReducedMotion &&
      targetSnapshot &&
      anchorRect &&
      anchorRect.width > 0 &&
      anchorRect.height > 0
    ) {
      const fromRect = centeredSquareRect(anchorRect, 140);
      setPendingEnterMorph(null);
      setActiveMorph({
        phase: 'exiting',
        snapshot: targetSnapshot,
        fromRect,
        toRect: toPlainRect(targetSnapshot.rect),
        onComplete: () => {
          setActiveMorph(null);
          setDetailAssetId(null);
          setSelectedNodeId(null);
          setReturningNodeId(closingAssetId);
        },
      });
      return;
    }

    setPendingEnterMorph(null);
    setActiveMorph(null);
    setDetailAssetId(null);
    setSelectedNodeId(null);
    setReturningNodeId(closingAssetId);
  }, [detailAssetId, isExitingMorph, prefersReducedMotion]);

  const handleSelectNode = useCallback(
    (nodeId: NetworkNodeId | null, snapshot?: NodeScreenSnapshot | null) => {
      if (isExitingMorph || isEnteringMorph) return;

      if (nodeId === null) {
        setSelectedNodeId(null);
        return;
      }

      // Second click on the SAME currently selected node -> enter State C (if supported)
      if (selectedNodeId === nodeId) {
        if (isDetailAssetId(nodeId)) {
          setShowExplanation(false);
          setSelectedNodeId(null);
          setDetailAssetId(nodeId);
          if (!prefersReducedMotion && snapshot) {
            setPendingEnterMorph({ assetId: nodeId, snapshot });
          }
        } else {
          setSelectedNodeId(null);
        }
        return;
      }

      // First click (or clicking a different node) -> enter/switch State B basic info only
      setDetailAssetId(null);
      setSelectedNodeId(nodeId);
    },
    [selectedNodeId, isExitingMorph, isEnteringMorph, prefersReducedMotion],
  );

  // Close legend popover, State B floating panel, or State C detail view on Escape
  useEffect(() => {
    if (!showExplanation && !selectedNodeId && !detailAssetId) return;

    const handleOutside = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (showExplanation && !legendAnchorRef.current?.contains(target)) {
        setShowExplanation(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (detailAssetId) {
          handleCloseDetail();
          return;
        }
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
  }, [showExplanation, selectedNodeId, detailAssetId, handleCloseDetail]);

  const legendTransition = {
    duration: prefersReducedMotion ? 0 : 0.2,
    ease: [0.16, 1, 0.3, 1] as const,
  };

  return (
    <section
      id="home-overview-stage"
      ref={stageRef}
      aria-label="Home Overview"
      style={HOME_FUI_CSS_VARS}
      onClick={() => {
        if (!detailAssetId) {
          setSelectedNodeId(null);
        }
      }}
      className="relative flex-1 w-full min-h-screen bg-[#050811] bg-[radial-gradient(circle_at_50%_46%,rgba(11,18,33,0.9)_0%,rgba(5,8,17,1)_72%)] text-[#F2F5F7] flex flex-col"
    >
      {renderStageLayer ? renderStageLayer(stageRef) : null}

      <div className="relative z-10 w-full max-w-[1440px] mx-auto px-5 pt-14 sm:pt-4 pb-6 flex-1 flex flex-col">
        {/*
          Persistent Home Network Layer:
          Kept mounted at all times (even during State C Detail View) so node positions,
          SVG state, and data never unmount/remount or blink when returning.
        */}
        <div
          aria-hidden={showDetailOverlay && !isExitingMorph}
          onAnimationEnd={(e) => {
            if (e.animationName === 'homeReentrySettle') {
              setIsReentrySettling(false);
            }
          }}
          className={`${
            showDetailOverlay
              ? 'absolute inset-x-5 top-14 sm:top-4 bottom-6 flex flex-col'
              : 'relative flex-1 flex flex-col'
          } ${isReentrySettling && !showDetailOverlay ? 'home-reentry-settle' : ''}`}
          style={{
            opacity: showDetailOverlay && !isExitingMorph ? 0 : 1,
            pointerEvents: showDetailOverlay && !isExitingMorph ? 'none' : 'auto',
            transition: prefersReducedMotion
              ? 'none'
              : 'opacity 260ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {/* State A / B Top-right controls */}
          <header
            onClick={(e) => e.stopPropagation()}
            className="flex items-center justify-end gap-2 sm:pl-48 min-h-[36px]"
          >
            <div
              role="group"
              aria-label="상관계수 분석 기간"
              className="inline-flex rounded border border-[#F2F5F7]/15 bg-[#080E1A]/85 backdrop-blur-sm p-0.5"
            >
              <button
                type="button"
                onClick={() => setCorrWindow('24h')}
                className={`px-2.5 py-1 text-xs font-medium rounded-sm whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#F2F5F7]/50 ${
                  corrWindow === '24h'
                    ? 'bg-[#F2F5F7]/14 text-[#F2F5F7]'
                    : 'text-[#F2F5F7]/55 hover:text-[#F2F5F7]/85'
                }`}
              >
                24시간
              </button>
              <button
                type="button"
                onClick={() => setCorrWindow('30d')}
                className={`px-2.5 py-1 text-xs font-medium rounded-sm whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#F2F5F7]/50 ${
                  corrWindow === '30d'
                    ? 'bg-[#F2F5F7]/14 text-[#F2F5F7]'
                    : 'text-[#F2F5F7]/55 hover:text-[#F2F5F7]/85'
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
              className="inline-flex items-center gap-1.5 rounded border border-[#F2F5F7]/15 bg-[#080E1A]/85 backdrop-blur-sm px-2.5 py-1.5 text-xs font-medium text-[#F2F5F7]/80 hover:border-[#F2F5F7]/35 hover:text-[#F2F5F7] disabled:opacity-45 whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#F2F5F7]/50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? '동기화 중' : '새로고침'}</span>
            </button>
          </header>

          {/* Top-level API error banner (Soft Coral Red) without hiding the network graph */}
          {error && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="mt-3 border border-[#FF7185]/40 bg-[#FF7185]/10 rounded px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[#FF7185]"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[#FF7185] shrink-0" />
                <span className="font-mono-tabular">{error}</span>
              </div>
              <button
                type="button"
                onClick={onRefresh}
                className="underline text-[#F2F5F7]/90 hover:text-[#F2F5F7] whitespace-nowrap shrink-0 cursor-pointer"
              >
                재시도
              </button>
            </div>
          )}

          {/* Open digital network stage: renders immediately even while API loads */}
          <div className="relative w-full max-w-[1220px] mx-auto h-[calc(100vh-146px)] min-h-[480px] max-h-[660px] flex items-center justify-center shrink-0">
            <MarketNetworkGraph
              model={activeNetworkModel}
              selectedNodeId={selectedNodeId}
              onSelectNode={handleSelectNode}
              nodeSnapshotGetterRef={nodeSnapshotGetterRef}
              returningNodeId={returningNodeId}
              revealMode={revealState.mode}
              revealRunId={revealState.runId}
            />

            <AnimatePresence mode="wait">
              {selectedNodeId && !showDetailOverlay && (
                <NodeDetailFloatingPanel
                  nodeId={selectedNodeId}
                  model={activeNetworkModel}
                  corrWindow={corrWindow}
                  onClose={() => setSelectedNodeId(null)}
                />
              )}
            </AnimatePresence>
          </div>

          {/* Bottom centered explanation button with upward-expanding concise 3-color graph legend */}
          <div className="mt-auto pt-2 flex justify-center">
            <div
              ref={legendAnchorRef}
              onClick={(e) => e.stopPropagation()}
              className="relative inline-flex flex-col items-center"
            >
              <AnimatePresence>
                {showExplanation && !showDetailOverlay && (
                  <motion.aside
                    id="home-network-explanation"
                    key="network-legend-popover"
                    aria-label="네트워크 그래프 범례"
                    initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 10 }}
                    animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                    exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
                    transition={legendTransition}
                    className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-[min(92vw,560px)] origin-bottom rounded-md border border-[#F2F5F7]/20 bg-[#070C17]/92 px-4 py-3.5 shadow-[0_8px_28px_rgba(5,8,17,0.75)] backdrop-blur-md text-xs z-30"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-[#F2F5F7]/85">
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-medium text-[#F2F5F7]/55">색상 기준</div>
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: HOME_FUI_COLORS.cyan }}
                          />
                          <span>상승 및 양(+)의 상관관계</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: HOME_FUI_COLORS.coral }}
                          />
                          <span>하락 및 음(-)의 상관관계</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="h-2.5 w-2.5 rounded-full border border-[#F2F5F7]/50 bg-[#080E1A] shrink-0"
                          />
                          <span>일반 데이터 · 기본 인터페이스</span>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="text-[11px] font-medium text-[#F2F5F7]/55">구조 · 연결선</div>
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="w-5 h-0.5 shrink-0"
                            style={{ backgroundColor: HOME_FUI_COLORS.white, opacity: 0.7 }}
                          />
                          <span>동일 주기 상관 (굵기·투명도 = |r|)</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="w-5 border-t border-dashed shrink-0"
                            style={{ borderColor: HOME_FUI_COLORS.white, opacity: 0.7 }}
                          />
                          <span>월간 교차 상관 (BTC ↔ M2)</span>
                        </div>
                        <div className="text-[11px] text-[#F2F5F7]/60">
                          1회 클릭: 기본 정보 · 재클릭: 상세 탐색
                        </div>
                      </div>
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-[#F2F5F7]/12 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#F2F5F7]/55">
                      <span>미산출 시 N/A 표시</span>
                      <span className="font-mono-tabular">
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
                className={`inline-flex items-center gap-2 rounded border px-4 py-2 text-xs font-medium transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#F2F5F7]/50 ${
                  showExplanation
                    ? 'border-[#F2F5F7]/35 bg-[#F2F5F7]/12 text-[#F2F5F7]'
                    : 'border-[#F2F5F7]/15 bg-[#080E1A]/85 text-[#F2F5F7]/75 hover:border-[#F2F5F7]/35 hover:text-[#F2F5F7]'
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

        {/* State C Overlay: Lazy Detail Exploration */}
        {detailAssetId && (
          <div className="relative z-20 sm:pl-44 flex-1 flex flex-col">
            <Suspense fallback={null}>
              <LazyAssetDetailStage
                assetId={detailAssetId}
                overview={overview}
                data={detailState.data}
                loading={detailState.loading}
                refreshing={detailState.refreshing}
                error={detailState.error}
                isEnteringMorph={isEnteringMorph}
                isExitingMorph={isExitingMorph}
                detailCenterAnchorRef={detailCenterAnchorRef}
                onRetry={detailState.retry}
                onRefresh={detailState.refresh}
                onClose={handleCloseDetail}
              />
            </Suspense>
          </div>
        )}
      </div>

      {/* GPU-composited Shared Element Transition Bridge */}
      {activeMorph && (
        <SharedNodeMorphOverlay morph={activeMorph} reducedMotion={prefersReducedMotion} />
      )}
    </section>
  );
};
