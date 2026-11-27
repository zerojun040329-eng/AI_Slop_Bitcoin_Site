import React, { Suspense, lazy, useMemo } from 'react';
import { AlertTriangle, ArrowLeft, RefreshCw, X } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import type {
  AssetDetailId,
  AssetDetailPayload,
  MarketNetworkOverviewResponse,
} from '../../../types/marketNetwork';
import { buildPendingDetailPayload } from './pendingDetailPayloads';

const QQQDetailView = lazy(() =>
  import('./QQQDetailView').then((m) => ({ default: m.QQQDetailView })),
);
const SPYDetailView = lazy(() =>
  import('./SPYDetailView').then((m) => ({ default: m.SPYDetailView })),
);
const XAUDetailView = lazy(() =>
  import('./XAUDetailView').then((m) => ({ default: m.XAUDetailView })),
);
const TLTDetailView = lazy(() =>
  import('./TLTDetailView').then((m) => ({ default: m.TLTDetailView })),
);
const M2DetailView = lazy(() =>
  import('./M2DetailView').then((m) => ({ default: m.M2DetailView })),
);
const WTIDetailView = lazy(() =>
  import('./WTIDetailView').then((m) => ({ default: m.WTIDetailView })),
);

export interface AssetDetailStageProps {
  assetId: AssetDetailId;
  overview?: MarketNetworkOverviewResponse | null;
  data: AssetDetailPayload | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  isEnteringMorph?: boolean;
  isExitingMorph?: boolean;
  detailCenterAnchorRef?: React.RefObject<HTMLDivElement | null>;
  onRetry: () => void;
  onRefresh: () => void;
  onClose: () => void;
}

const ASSET_STAGE_HEADERS: Record<AssetDetailId, { title: string; subtitle: string }> = {
  QQQ: {
    title: 'QQQ · 기술주 Top 10 버블 네트워크',
    subtitle: 'Nasdaq-100 내 Technology 섹터 시가총액 상위 10개 기업',
  },
  SPY: {
    title: 'SPY · S&P 500 섹터 궤도 네트워크',
    subtitle: '기술주 섹터(XLK) 중심 S&P 500 섹터 비중 및 수익률 구조',
  },
  XAU: {
    title: 'XAU · 귀금속 및 산업금속 원자재 네트워크',
    subtitle: '금(Gold) 중심 구리 · 백금 · 팔라듐 · 은 가격 및 상관관계',
  },
  TLT: {
    title: 'TLT · 미국 국채 수익률 곡선 및 만기별 금리 추이',
    subtitle: '2년 · 5년 · 10년 · 20년 · 30년 미국 국채 수익률 시계열',
  },
  M2: {
    title: 'M2 증가율 · 거시경제 유동성 마인드맵',
    subtitle: '통화량 · 유동성 · 금리 · 경기 · 물가 · 자산시장 연결 구조',
  },
  WTI: {
    title: 'WTI · 원유 및 에너지 시장 생태계',
    subtitle: 'WTI 중심 브렌트유 · 휘발유 · 난방유 · 천연가스 가격 및 상관관계',
  },
};

function renderLazyDetail(
  data: AssetDetailPayload,
  animateReveal: boolean,
  isPending: boolean,
): React.ReactNode {
  switch (data.assetId) {
    case 'QQQ':
      return <QQQDetailView data={data} animateReveal={animateReveal} isPending={isPending} />;
    case 'SPY':
      return <SPYDetailView data={data} animateReveal={animateReveal} isPending={isPending} />;
    case 'XAU':
      return <XAUDetailView data={data} animateReveal={animateReveal} isPending={isPending} />;
    case 'TLT':
      return <TLTDetailView data={data} animateReveal={animateReveal} isPending={isPending} />;
    case 'M2':
      return <M2DetailView data={data} animateReveal={animateReveal} isPending={isPending} />;
    case 'WTI':
      return <WTIDetailView data={data} animateReveal={animateReveal} isPending={isPending} />;
  }
}

export const AssetDetailStage: React.FC<AssetDetailStageProps> = ({
  assetId,
  overview = null,
  data,
  loading,
  refreshing,
  error,
  isEnteringMorph = false,
  isExitingMorph = false,
  detailCenterAnchorRef,
  onRetry,
  onRefresh,
  onClose,
}) => {
  const prefersReducedMotion = Boolean(useReducedMotion());
  const headerMeta = data
    ? { title: data.title, subtitle: data.subtitle }
    : ASSET_STAGE_HEADERS[assetId];

  const hasSideColumn =
    assetId === 'QQQ' || assetId === 'SPY' || assetId === 'XAU' || assetId === 'WTI';

  const pendingPayload = useMemo(
    () => buildPendingDetailPayload(assetId, overview),
    [assetId, overview],
  );
  const activePayload = data ?? pendingPayload;
  const isPending = !data && !error;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="w-full flex-1 flex flex-col justify-between py-2 transition-opacity duration-200"
      style={{ opacity: isExitingMorph ? 0 : 1 }}
    >
      {/* Top Bar: Back/Close + Title + Refresh */}
      <div
        className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[#F2F5F7]/12 transition-all duration-300"
        style={{
          opacity: isEnteringMorph || isExitingMorph ? 0 : 1,
          transform: isEnteringMorph ? 'translate3d(0, -6px, 0)' : 'translate3d(0, 0, 0)',
        }}
      >
        <div className="flex items-start gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="글로벌 네트워크로 돌아가기"
            className="mt-0.5 inline-flex items-center gap-1.5 rounded border border-[#F2F5F7]/20 bg-[#080E1A]/90 px-2.5 py-1.5 text-xs font-medium text-[#F2F5F7]/85 hover:border-[#F2F5F7]/45 hover:text-[#F2F5F7] transition-colors shrink-0 cursor-pointer focus:outline-none"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>네트워크로</span>
          </button>

          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-[#F2F5F7] tracking-tight truncate">
              {headerMeta.title}
            </h2>
            <p className="text-xs text-[#F2F5F7]/60 mt-0.5 truncate">{headerMeta.subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {data?.fetchedAtIso && (
            <span className="hidden sm:inline font-mono-tabular text-[11px] text-[#F2F5F7]/45">
              {data.fetchedAtIso.replace('T', ' ').slice(0, 16)} UTC
            </span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1.5 rounded border border-[#F2F5F7]/15 bg-[#080E1A]/85 px-2.5 py-1.5 text-xs font-medium text-[#F2F5F7]/80 hover:border-[#F2F5F7]/35 hover:text-[#F2F5F7] disabled:opacity-45 cursor-pointer transition-colors focus:outline-none"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>새로고침</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="상세 탐색 닫기"
            className="h-7 w-7 rounded border border-[#F2F5F7]/15 bg-[#080E1A]/85 flex items-center justify-center text-[#F2F5F7]/65 hover:text-[#F2F5F7] hover:border-[#F2F5F7]/35 cursor-pointer transition-colors focus:outline-none"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Main Lazy Visualization Stage + Shared Element Center Anchor */}
      <div className="relative flex-1 flex items-center justify-center py-5">
        {/* Invisible target anchor aligned with the visualization center for Shared Element enter/exit */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center py-5"
        >
          <div
            className={`w-full flex items-center justify-center ${
              hasSideColumn ? 'lg:pr-[344px]' : ''
            }`}
          >
            <div ref={detailCenterAnchorRef} className="h-[144px] w-[144px] rounded-full" />
          </div>
        </div>

        {isEnteringMorph ? null : error && !data ? (
          <div className="flex flex-col items-center justify-center min-h-[340px] text-center space-y-3 max-w-md">
            <AlertTriangle className="h-6 w-6 text-[#FF7185]" />
            <div className="text-sm font-medium text-[#FF7185]">
              {assetId} 상세 데이터를 불러오지 못했습니다
            </div>
            <div className="text-xs font-mono-tabular text-[#F2F5F7]/60">{error}</div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded border border-[#F2F5F7]/25 bg-[#080E1A] px-3 py-1.5 text-xs font-medium text-[#F2F5F7] hover:border-[#F2F5F7]/45 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>다시 시도</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-[#F2F5F7]/15 px-3 py-1.5 text-xs text-[#F2F5F7]/75 hover:text-[#F2F5F7] cursor-pointer"
              >
                돌아가기
              </button>
            </div>
          </div>
        ) : (
          <Suspense fallback={null}>
            {renderLazyDetail(activePayload, !prefersReducedMotion, isPending)}
          </Suspense>
        )}
      </div>
    </div>
  );
};
