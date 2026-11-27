import React, { useState } from 'react';
import type { EnergyNodeItem, WtiDetailPayload } from '../../../types/marketNetwork';
import {
  HOME_FUI_COLORS,
  getPolarityColor,
  getValuePolarity,
  rgbaFromPolarity,
} from '../homeTokens';

export interface WTIDetailViewProps {
  data: WtiDetailPayload;
  animateReveal?: boolean;
  isPending?: boolean;
}

function revealStyle(active: boolean, delayMs: number, durationMs: number): React.CSSProperties | undefined {
  if (!active) return undefined;
  return {
    animationDelay: `${delayMs}ms`,
    animationDuration: `${durationMs}ms`,
  };
}

const STAGE_W = 880;
const STAGE_H = 540;
const CX = STAGE_W / 2;
const CY = STAGE_H / 2;

const SATELLITE_POSITIONS: Array<{ x: number; y: number }> = [
  { x: 185, y: 120 }, // Brent
  { x: 695, y: 120 }, // Gasoline
  { x: 695, y: 420 }, // Heating Oil
  { x: 185, y: 420 }, // Natural Gas
];

function formatEnergyPrice(item: EnergyNodeItem, isPending = false): string {
  if (item.status === 'unsupported') return '미지원';
  if (item.priceUsd === null) return isPending ? '—' : 'N/A';
  return `$${item.priceUsd.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: item.priceUsd < 10 ? 3 : 2,
  })}`;
}

function formatPct(val: number | null, isPending = false): string {
  if (val === null || !Number.isFinite(val)) return isPending ? '—' : 'N/A';
  return `${val > 0 ? '+' : ''}${val.toFixed(2)}%`;
}

function formatCorr(r: number | null, isPending = false): string {
  if (r === null || !Number.isFinite(r)) return isPending ? '—' : 'N/A';
  return `${r > 0 ? '+' : ''}${r.toFixed(2)}`;
}

export const WTIDetailView: React.FC<WTIDetailViewProps> = ({
  data,
  animateReveal = true,
  isPending = false,
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const centerPolarity = getValuePolarity(data.center.change1dPct);
  const centerColor = getPolarityColor(centerPolarity);

  return (
    <div className="w-full flex flex-col lg:flex-row items-center gap-6">
      <div className="flex-1 w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
          role="img"
          aria-label="WTI 원유 및 에너지 시장 생태계 네트워크"
          className="w-full min-w-[560px] max-h-[540px] block mx-auto select-none outline-none focus:outline-none"
        >
          {animateReveal && (
            <defs>
              {data.satellites.map((sat, idx) => {
                const pos = SATELLITE_POSITIONS[idx % SATELLITE_POSITIONS.length];
                return (
                  <mask
                    key={`wti-mask-${sat.id}`}
                    id={`wti-edge-mask-${sat.id}`}
                    maskUnits="userSpaceOnUse"
                    x={0}
                    y={0}
                    width={STAGE_W}
                    height={STAGE_H}
                  >
                    <line
                      x1={CX}
                      y1={CY}
                      x2={pos.x}
                      y2={pos.y}
                      pathLength={100}
                      stroke="#FFFFFF"
                      strokeWidth={20}
                      strokeLinecap="round"
                      className="detail-reveal-line"
                      style={revealStyle(true, 150 + idx * 70, 360)}
                    />
                  </mask>
                );
              })}
            </defs>
          )}

          <g
            aria-hidden="true"
            pointerEvents="none"
            className={animateReveal ? 'detail-reveal-fade' : undefined}
            style={revealStyle(animateReveal, 40, 320)}
          >
            <circle
              cx={CX}
              cy={CY}
              r={182}
              fill="none"
              stroke={HOME_FUI_COLORS.white}
              strokeOpacity={0.05}
              strokeDasharray="2 6"
            />
          </g>

          {/* Edges from WTI center to energy satellites */}
          {data.satellites.map((sat, idx) => {
            const pos = SATELLITE_POSITIONS[idx % SATELLITE_POSITIONS.length];
            const corr = sat.correlationToWti;
            const corrPolarity = getValuePolarity(corr);
            const strokeColor = getPolarityColor(corrPolarity);
            const absR = corr !== null ? Math.min(1, Math.abs(corr)) : 0.2;
            const isHovered = hoveredId === sat.id;
            const midX = (CX + pos.x) / 2;
            const midY = (CY + pos.y) / 2;
            const isIndependentCommodity = sat.id === 'NATGAS';

            return (
              <g
                key={`edge-${sat.id}`}
                style={{
                  opacity: hoveredId && !isHovered ? 0.28 : 1,
                  transition: 'opacity 180ms ease',
                }}
              >
                <line
                  x1={CX}
                  y1={CY}
                  x2={pos.x}
                  y2={pos.y}
                  stroke={strokeColor}
                  strokeWidth={sat.status === 'unsupported' ? 1 : 1.5 + absR * 4.5}
                  strokeOpacity={
                    sat.status === 'unsupported' ? 0.18 : isHovered ? 0.94 : 0.35 + absR * 0.55
                  }
                  strokeDasharray={
                    sat.status === 'unsupported' || isIndependentCommodity ? '5 4' : undefined
                  }
                  strokeLinecap="round"
                  mask={animateReveal ? `url(#wti-edge-mask-${sat.id})` : undefined}
                />
                <g
                  className={animateReveal ? 'detail-reveal-fade' : undefined}
                  style={revealStyle(animateReveal, 360 + idx * 70, 260)}
                >
                  <rect
                    x={midX - 30}
                    y={midY - 11}
                    width={60}
                    height={22}
                    rx={4}
                    fill={HOME_FUI_COLORS.bgCanvas}
                    stroke={rgbaFromPolarity(corrPolarity, isHovered ? 0.65 : 0.25)}
                    strokeWidth={0.9}
                  />
                  <text
                    x={midX}
                    y={midY + 4}
                    textAnchor="middle"
                    fill={corr === null ? 'rgba(242,245,247,0.45)' : strokeColor}
                    fontSize={11}
                    fontWeight={600}
                    style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {isPending ? '—' : `r ${formatCorr(corr, isPending)}`}
                  </text>
                </g>
              </g>
            );
          })}

          {/* Energy Satellite Nodes */}
          {data.satellites.map((sat, idx) => {
            const pos = SATELLITE_POSITIONS[idx % SATELLITE_POSITIONS.length];
            const polarity =
              sat.status === 'unsupported' ? 'neutral' : getValuePolarity(sat.change1dPct);
            const accent = getPolarityColor(polarity);
            const isHovered = hoveredId === sat.id;
            const nodeDelay = 340 + idx * 70;

            return (
              <g
                key={sat.id}
                onMouseEnter={() => setHoveredId(sat.id)}
                onMouseLeave={() => setHoveredId((prev) => (prev === sat.id ? null : prev))}
                onMouseDown={(e) => e.preventDefault()}
                style={{
                  cursor: 'default',
                  opacity: isPending ? 0.55 : hoveredId && !isHovered ? 0.35 : 1,
                  transition: 'opacity 240ms ease',
                }}
              >
                <g
                  className={animateReveal ? 'detail-reveal-scale' : undefined}
                  style={revealStyle(animateReveal, nodeDelay, 320)}
                >
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={60}
                    fill={isHovered ? '#0E1729' : '#080E1A'}
                    stroke={rgbaFromPolarity(
                      polarity,
                      isPending ? 0.24 : sat.status === 'unsupported' ? 0.2 : isHovered ? 0.9 : 0.45,
                    )}
                    strokeWidth={isHovered ? 1.7 : 1.15}
                    strokeDasharray={sat.status === 'unsupported' ? '4 4' : undefined}
                  />
                  <g
                    className={animateReveal ? 'detail-reveal-fade' : undefined}
                    style={revealStyle(animateReveal, nodeDelay + 110, 260)}
                  >
                    <text
                      x={pos.x}
                      y={pos.y - 25}
                      textAnchor="middle"
                      fill={HOME_FUI_COLORS.white}
                      fillOpacity={0.55}
                      fontSize={9}
                    >
                      {sat.unitLabel}
                    </text>
                    <text
                      x={pos.x}
                      y={pos.y - 8}
                      textAnchor="middle"
                      fill={HOME_FUI_COLORS.white}
                      fontSize={12.5}
                      fontWeight={700}
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      {sat.nameKo.split(' (')[0]}
                    </text>
                    <text
                      x={pos.x}
                      y={pos.y + 11}
                      textAnchor="middle"
                      fill={HOME_FUI_COLORS.white}
                      fillOpacity={0.88}
                      fontSize={12}
                      style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatEnergyPrice(sat, isPending)}
                    </text>
                    <text
                      x={pos.x}
                      y={pos.y + 29}
                      textAnchor="middle"
                      fill={sat.status === 'unsupported' ? 'rgba(242,245,247,0.45)' : accent}
                      fontSize={11}
                      fontWeight={600}
                      style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                    >
                      {sat.status === 'unsupported' ? '미지원' : formatPct(sat.change1dPct, isPending)}
                    </text>
                  </g>
                </g>
              </g>
            );
          })}

          {/* Center WTI Crude Node */}
          <g
            className={animateReveal ? 'detail-reveal-scale' : undefined}
            style={revealStyle(animateReveal, 0, 280)}
          >
            <circle
              cx={CX}
              cy={CY}
              r={68}
              fill="#091120"
              stroke={rgbaFromPolarity(centerPolarity, 0.72)}
              strokeWidth={1.65}
            />
            <text
              x={CX}
              y={CY - 24}
              textAnchor="middle"
              fill={HOME_FUI_COLORS.white}
              fillOpacity={0.58}
              fontSize={10}
            >
              기준 원유 ({data.center.unitLabel})
            </text>
            <text
              x={CX}
              y={CY - 5}
              textAnchor="middle"
              fill={HOME_FUI_COLORS.white}
              fontSize={16}
              fontWeight={700}
              style={{ fontFamily: 'var(--font-display)' }}
            >
              WTI 원유
            </text>
            <text
              x={CX}
              y={CY + 14}
              textAnchor="middle"
              fill={HOME_FUI_COLORS.white}
              fontSize={13}
              fontWeight={500}
              style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
            >
              {formatEnergyPrice(data.center, isPending)}
            </text>
            <text
              x={CX}
              y={CY + 32}
              textAnchor="middle"
              fill={centerColor}
              fontSize={12}
              fontWeight={600}
              style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
            >
              {formatPct(data.center.change1dPct, isPending)}
            </text>
          </g>
        </svg>
      </div>

      {/* Right Energy Ecosystem Breakdown */}
      <aside
        className={`w-full lg:w-[335px] shrink-0 space-y-4 border-t lg:border-t-0 lg:border-l border-[#F2F5F7]/12 pt-4 lg:pt-0 lg:pl-5 text-xs ${
          animateReveal ? 'detail-reveal-fade' : ''
        }`}
        style={revealStyle(animateReveal, 520, 360)}
      >
        {data.brentWtiSpreadUsd !== null && (
          <div className="pb-2.5 border-b border-[#F2F5F7]/12 flex items-center justify-between font-mono-tabular">
            <span className="text-[#F2F5F7]/60 font-sans">Brent – WTI 스프레드</span>
            <span
              className="font-semibold"
              style={{ color: getPolarityColor(getValuePolarity(data.brentWtiSpreadUsd)) }}
            >
              {data.brentWtiSpreadUsd >= 0 ? '+' : ''}${data.brentWtiSpreadUsd.toFixed(2)}/bbl
            </span>
          </div>
        )}

        <div className="space-y-1">
          <div className="text-[11px] text-[#F2F5F7]/55 font-medium mb-1">에너지 시장 구성 및 WTI 상관</div>
          <div className="divide-y divide-[#F2F5F7]/8">
            {[data.center, ...data.satellites].map((item) => {
              const color =
                item.status === 'unsupported'
                  ? 'rgba(242,245,247,0.45)'
                  : getPolarityColor(getValuePolarity(item.change1dPct));
              return (
                <div
                  key={item.id}
                  onMouseEnter={() => item.id !== 'WTI' && setHoveredId(item.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className="py-2 flex items-start justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-[#F2F5F7] flex items-center gap-1.5">
                      <span>{item.nameKo}</span>
                      <span className="text-[10px] text-[#F2F5F7]/45 font-mono-tabular">
                        {item.unitLabel}
                      </span>
                    </div>
                    <div className="text-[10px] text-[#F2F5F7]/50">{item.roleKo}</div>
                    {item.spreadToWtiText && (
                      <div className="text-[10px] font-mono-tabular text-[#F2F5F7]/65 mt-0.5">
                        {item.spreadToWtiText}
                      </div>
                    )}
                  </div>
                  <div className="text-right font-mono-tabular shrink-0">
                    <div className="text-[#F2F5F7]/90">{formatEnergyPrice(item, isPending)}</div>
                    <div className="text-[11px]" style={{ color }}>
                      {item.status === 'unsupported'
                        ? '미지원'
                        : `${formatPct(item.change1dPct, isPending)}${
                            item.id !== 'WTI' ? ` · r ${formatCorr(item.correlationToWti, isPending)}` : ''
                          }`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {data.methodologyNote && (
          <p className="pt-2 border-t border-[#F2F5F7]/12 text-[11px] text-[#F2F5F7]/50 leading-relaxed">
            {data.methodologyNote}
          </p>
        )}
      </aside>
    </div>
  );
};
