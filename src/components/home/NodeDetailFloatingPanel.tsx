import React from 'react';
import { X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type {
  HomeMarketNetworkViewModel,
  NetworkNodeId,
} from './marketNetworkAdapter';

export interface NodeDetailFloatingPanelProps {
  nodeId: NetworkNodeId;
  model: HomeMarketNetworkViewModel;
  corrWindow: '24h' | '30d';
  onClose: () => void;
}

const ASSET_DESCRIPTIONS: Record<string, string> = {
  BTC: '글로벌 유동성·위험선호 중심 노드 (기존 4년 5분봉 및 일봉 시계열)',
  SPY: '미국 대형주 S&P 500 지수 추종 ETF 무기한 선물',
  QQQ: '미국 기술주 Nasdaq-100 지수 추종 ETF 무기한 선물',
  XAU: '금(Gold) 현물 가격 기반 원자재 무기한 선물',
  WTI: '서부텍사스산원유(WTI) 원자재 무기한 선물',
  TLT: '미국 20년 이상 장기 국채 ETF 무기한 선물',
};

function getAnchorPositionClass(nodeId: NetworkNodeId): string {
  switch (nodeId) {
    case 'BTC':
      return 'md:left-[56%] md:top-4 md:right-auto md:bottom-auto md:translate-x-0';
    case 'SPY':
      return 'md:left-3 md:top-[10%] md:right-auto md:bottom-auto md:translate-x-0';
    case 'QQQ':
      return 'md:right-[12%] md:top-3 md:left-auto md:bottom-auto md:translate-x-0';
    case 'XAU':
      return 'md:left-3 md:top-[34%] md:right-auto md:bottom-auto md:translate-x-0';
    case 'WTI':
      return 'md:left-3 md:bottom-[8%] md:right-auto md:top-auto md:translate-x-0';
    case 'TLT':
      return 'md:right-[4%] md:bottom-3 md:left-auto md:top-auto md:translate-x-0';
    case 'M2':
      return 'md:right-3 md:top-[14%] md:left-auto md:bottom-auto md:translate-x-0';
    case 'DGS10':
      return 'md:right-3 md:bottom-[10%] md:left-auto md:top-auto md:translate-x-0';
  }
}

function formatPrice(val: number | null): string {
  if (val === null || !Number.isFinite(val)) return 'N/A';
  return `$${val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPct(val: number | null): string {
  if (val === null || !Number.isFinite(val)) return 'N/A';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}%`;
}

function formatCorr(val: number | null): string {
  if (val === null || !Number.isFinite(val)) return 'N/A';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(3)}`;
}

function formatUtcShort(iso: string | null): string {
  if (!iso) return 'N/A';
  return `${iso.replace('T', ' ').slice(0, 16)} UTC`;
}

function interpretCorrelation(r: number | null): string {
  if (r === null || !Number.isFinite(r)) return '상관계수 미산출 (표본 부족)';
  const abs = Math.abs(r);
  const strength =
    abs >= 0.7 ? '강한' : abs >= 0.4 ? '뚜렷한' : abs >= 0.2 ? '완만한' : '미약한';
  const dir = r >= 0 ? '양(+)의 동조화' : '음(-)의 역행';
  return `${strength} ${dir} 경향`;
}

export const NodeDetailFloatingPanel: React.FC<NodeDetailFloatingPanelProps> = ({
  nodeId,
  model,
  corrWindow,
  onClose,
}) => {
  const prefersReducedMotion = Boolean(useReducedMotion());
  const positionClass = getAnchorPositionClass(nodeId);

  const isMacro = nodeId === 'M2' || nodeId === 'DGS10';
  const assetNode =
    nodeId === 'BTC'
      ? model.centerBtc
      : model.surroundingAssets.find((a) => a.id === nodeId) ?? null;
  const assetEdge =
    !isMacro && nodeId !== 'BTC'
      ? model.assetEdges.find((e) => e.targetId === nodeId) ?? null
      : null;

  return (
    <motion.aside
      key={nodeId}
      role="dialog"
      aria-label={`${nodeId} 상세 정보`}
      onClick={(e) => e.stopPropagation()}
      initial={
        prefersReducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.96, y: 6 }
      }
      animate={
        prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }
      }
      exit={
        prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 4 }
      }
      transition={{
        duration: prefersReducedMotion ? 0 : 0.18,
        ease: [0.16, 1, 0.3, 1],
      }}
      className={`absolute bottom-3 left-1/2 -translate-x-1/2 w-[min(92vw,292px)] ${positionClass} z-20 rounded-md border border-cyan-400/25 bg-[#070C17]/90 backdrop-blur-md p-3.5 shadow-[0_0_24px_rgba(34,211,238,0.08)] text-xs text-slate-200`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-800/80">
        <div className="min-w-0">
          <div className="text-[11px] text-cyan-300/90 font-medium truncate">
            {isMacro
              ? `거시경제 · ${nodeId === 'M2' ? model.m2Node.seriesCode : model.dgs10Node.seriesCode}`
              : assetNode?.id === 'BTC'
                ? '중심 자산 · BTCUSDT'
                : `자산시장 · ${assetNode?.symbol ?? nodeId}`}
          </div>
          <div className="text-sm font-semibold text-slate-100 mt-0.5 truncate">
            {nodeId === 'M2'
              ? model.m2Node.label
              : nodeId === 'DGS10'
                ? model.dgs10Node.label
                : assetNode?.id ?? nodeId}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="상세 패널 닫기"
          className="h-6 w-6 rounded flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 transition-colors shrink-0 cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body */}
      {isMacro ? (
        nodeId === 'M2' ? (
          <div className="pt-2.5 space-y-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-slate-400">전년 동월 대비(YoY)</span>
              <span
                className={`font-mono-tabular text-base font-semibold ${
                  model.m2Node.primaryValueText === 'N/A'
                    ? 'text-slate-400'
                    : model.m2Node.primaryValueText.startsWith('-')
                      ? 'text-rose-400'
                      : 'text-emerald-400'
                }`}
              >
                {model.m2Node.primaryValueText}
              </span>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-slate-800/60 font-mono-tabular text-[11px]">
              <div className="flex justify-between gap-2">
                <span className="text-slate-400 font-sans">최신 M2 잔액</span>
                <span className="text-slate-200">
                  {model.m2Node.rawLatestValue !== null
                    ? `${model.m2Node.rawLatestValue.toLocaleString('en-US', {
                        maximumFractionDigits: 1,
                      })} B`
                    : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-400 font-sans">BTC ↔ M2 교차 r</span>
                <span className="text-cyan-300">
                  {formatCorr(model.btcM2CrossEdge.correlation)} (n=
                  {model.btcM2CrossEdge.sampleCount})
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-400 font-sans">M2 ↔ DGS10 r</span>
                <span className="text-slate-200">
                  {formatCorr(model.macroPairEdge.correlation)} (n=
                  {model.macroPairEdge.sampleCount})
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-400 font-sans">기준일 · 관측수</span>
                <span className="text-slate-300">
                  {model.m2Node.latestDate ?? 'N/A'} · {model.m2Node.pointCount}개
                </span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed pt-1 border-t border-slate-800/60">
              월간 통화량(M2SL)의 전년 동월 대비 증가율입니다. BTC와는 공통 월간 시계열로만 교차
              연결됩니다.
            </p>
          </div>
        ) : (
          <div className="pt-2.5 space-y-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-slate-400">10년물 국채금리</span>
              <span className="font-mono-tabular text-base font-semibold text-slate-100">
                {model.dgs10Node.primaryValueText}
              </span>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-slate-800/60 font-mono-tabular text-[11px]">
              <div className="flex justify-between gap-2">
                <span className="text-slate-400 font-sans">최근 변화량</span>
                <span className="text-slate-200">{model.dgs10Node.secondaryValueText}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-400 font-sans">M2 ↔ DGS10 r</span>
                <span className="text-cyan-300">
                  {formatCorr(model.macroPairEdge.correlation)} (n=
                  {model.macroPairEdge.sampleCount})
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-400 font-sans">기준일 · 관측수</span>
                <span className="text-slate-300">
                  {model.dgs10Node.latestDate ?? 'N/A'} · {model.dgs10Node.pointCount}개
                </span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed pt-1 border-t border-slate-800/60">
              미국 10년 만기 국채 수익률(FRED DGS10)입니다. 거시경제 내부 지표로 BTC와는 직접
              연결하지 않습니다.
            </p>
          </div>
        )
      ) : assetNode ? (
        <div className="pt-2.5 space-y-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono-tabular text-base font-semibold text-slate-100">
              {assetNode.status === 'syncing' ? '로딩 중' : formatPrice(assetNode.latestPrice)}
            </span>
            <span
              className={`font-mono-tabular text-xs font-semibold ${
                assetNode.change24hPct === null
                  ? 'text-slate-500'
                  : assetNode.change24hPct >= 0
                    ? 'text-emerald-400'
                    : 'text-rose-400'
              }`}
            >
              24h {formatPct(assetNode.change24hPct)}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-slate-800/60 font-mono-tabular text-[11px]">
            <div>
              <div className="text-slate-500 font-sans">1시간</div>
              <div
                className={
                  assetNode.change1hPct === null
                    ? 'text-slate-500'
                    : assetNode.change1hPct >= 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                }
              >
                {formatPct(assetNode.change1hPct)}
              </div>
            </div>
            <div>
              <div className="text-slate-500 font-sans">4시간</div>
              <div
                className={
                  assetNode.change4hPct === null
                    ? 'text-slate-500'
                    : assetNode.change4hPct >= 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                }
              >
                {formatPct(assetNode.change4hPct)}
              </div>
            </div>
            <div>
              <div className="text-slate-500 font-sans">24시간</div>
              <div
                className={
                  assetNode.change24hPct === null
                    ? 'text-slate-500'
                    : assetNode.change24hPct >= 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                }
              >
                {formatPct(assetNode.change24hPct)}
              </div>
            </div>
          </div>

          {assetEdge ? (
            <div className="space-y-1.5 pt-2 border-t border-slate-800/60 font-mono-tabular text-[11px]">
              <div className="flex justify-between gap-2">
                <span className="text-slate-400 font-sans">
                  BTC 상관 ({corrWindow === '24h' ? '24시간' : '30일'})
                </span>
                <span className="text-cyan-300 font-semibold">
                  {formatCorr(assetEdge.correlation)} (n={assetEdge.sampleCount})
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-400 font-sans">
                  {corrWindow === '24h' ? '참고 (30일)' : '참고 (24시간)'}
                </span>
                <span className="text-slate-300">
                  {corrWindow === '24h'
                    ? `${formatCorr(assetEdge.correlation30d)} (n=${assetEdge.sampleCount30d})`
                    : `${formatCorr(assetEdge.correlation24h)} (n=${assetEdge.sampleCount24h})`}
                </span>
              </div>
              <div className="text-slate-400 font-sans">
                해석: {interpretCorrelation(assetEdge.correlation)}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5 pt-2 border-t border-slate-800/60 font-mono-tabular text-[11px]">
              <div className="flex justify-between gap-2">
                <span className="text-slate-400 font-sans">BTC ↔ M2 교차 r</span>
                <span className="text-cyan-300">
                  {formatCorr(model.btcM2CrossEdge.correlation)} (n=
                  {model.btcM2CrossEdge.sampleCount})
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-400 font-sans">저장 5분봉</span>
                <span className="text-slate-300">
                  {assetNode.storedBars.toLocaleString('en-US')}봉
                </span>
              </div>
            </div>
          )}

          <div className="pt-1.5 border-t border-slate-800/60 space-y-1 text-[11px] text-slate-400">
            <p className="leading-relaxed">{ASSET_DESCRIPTIONS[assetNode.id] ?? ''}</p>
            <div className="flex justify-between gap-2 font-mono-tabular text-[10px] text-slate-500">
              <span>{assetNode.providerLabel}</span>
              <span>{formatUtcShort(assetNode.latestTimestampIso)}</span>
            </div>
          </div>
        </div>
      ) : null}
    </motion.aside>
  );
};
