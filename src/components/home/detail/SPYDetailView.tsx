import React, { useState } from 'react';
import type { SpyDetailPayload, SpySectorSatellite } from '../../../types/marketNetwork';
import {
  HOME_FUI_COLORS,
  getPolarityColor,
  getValuePolarity,
  rgbaFromPolarity,
} from '../homeTokens';

export interface SPYDetailViewProps {
  data: SpyDetailPayload;
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
const STAGE_H = 580;
const CX = STAGE_W / 2;
const CY = STAGE_H / 2;
const ORBIT_R = 205;
const OUTER_RING_R = 266;

function formatMarketCap(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '—';
  if (usd >= 1e12) return `$${(usd / 1e12).toFixed(2)}T`;
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(0)}B`;
  return `$${(usd / 1e6).toFixed(0)}M`;
}

function formatPct(val: number | null, isPending = false): string {
  if (val === null || !Number.isFinite(val)) return isPending ? '—' : 'N/A';
  return `${val > 0 ? '+' : ''}${val.toFixed(2)}%`;
}

function satelliteRadius(weightPct: number, maxWeightPct: number): number {
  const norm = maxWeightPct > 0 ? Math.sqrt(weightPct / maxWeightPct) : 0.5;
  return 24 + norm * 24;
}

export const SPYDetailView: React.FC<SPYDetailViewProps> = ({
  data,
  animateReveal = true,
  isPending = false,
}) => {
  const [hoveredSector, setHoveredSector] = useState<string | null>(null);

  const techSector =
    data.sectors.find((s) => s.sectorKey === 'Technology') ?? data.sectors[0] ?? null;
  const orbitalSectors = techSector
    ? data.sectors.filter((s) => s.sectorKey !== techSector.sectorKey)
    : data.sectors;

  const maxWeight = Math.max(1, ...data.sectors.map((s) => s.spyWeightPct));
  const activeSector: SpySectorSatellite | null =
    data.sectors.find((s) => s.sectorKey === hoveredSector) ?? techSector ?? data.sectors[0] ?? null;

  const centerPolarity = getValuePolarity(techSector?.changePct);
  const centerColor = getPolarityColor(centerPolarity);

  return (
    <div className="w-full flex flex-col lg:flex-row items-center gap-6">
      <div className="flex-1 w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
          role="img"
          aria-label="기술주 중심 S&P 500 섹터 궤도 시각화"
          className="w-full min-w-[560px] max-h-[560px] block mx-auto select-none outline-none focus:outline-none"
        >
          {/* Outer SPY Orbital Ring */}
          <g
            aria-hidden="true"
            className={animateReveal ? 'detail-reveal-fade' : undefined}
            style={revealStyle(animateReveal, 40, 380)}
          >
            <circle
              cx={CX}
              cy={CY}
              r={OUTER_RING_R}
              fill="rgba(8, 14, 26, 0.45)"
              stroke={HOME_FUI_COLORS.white}
              strokeOpacity={0.18}
              strokeWidth={1.1}
            />
            <circle
              cx={CX}
              cy={CY}
              r={ORBIT_R}
              fill="none"
              stroke={HOME_FUI_COLORS.white}
              strokeOpacity={0.1}
              strokeWidth={0.85}
              strokeDasharray="3 5"
            />
            <circle
              cx={CX}
              cy={CY}
              r={104}
              fill="none"
              stroke={HOME_FUI_COLORS.white}
              strokeOpacity={0.07}
              strokeWidth={0.75}
            />
          </g>

          {/* Radial Sector Connections & Satellite Nodes */}
          {orbitalSectors.map((sector, idx) => {
            const angle = -Math.PI / 2 + (idx * 2 * Math.PI) / Math.max(1, orbitalSectors.length);
            const sx = CX + ORBIT_R * Math.cos(angle);
            const sy = CY + ORBIT_R * Math.sin(angle);
            const r = satelliteRadius(sector.spyWeightPct, maxWeight);

            const polarity = getValuePolarity(sector.changePct);
            const strokeColor = getPolarityColor(polarity);
            const isHovered = hoveredSector === sector.sectorKey;
            const isCenterHovered = techSector !== null && hoveredSector === techSector.sectorKey;
            const dimmed = hoveredSector !== null && !isHovered && !isCenterHovered;
            const edgeDelay = 160 + idx * 38;
            const nodeDelay = edgeDelay + 170;

            return (
              <g
                key={sector.sectorKey}
                onMouseEnter={() => setHoveredSector(sector.sectorKey)}
                onMouseLeave={() =>
                  setHoveredSector((prev) => (prev === sector.sectorKey ? null : prev))
                }
                onMouseDown={(e) => e.preventDefault()}
                style={{
                  cursor: 'default',
                  opacity: isPending ? 0.55 : dimmed ? 0.3 : 1,
                  transition: 'opacity 240ms ease',
                }}
              >
                <line
                  x1={CX}
                  y1={CY}
                  x2={sx}
                  y2={sy}
                  pathLength={100}
                  stroke={strokeColor}
                  strokeOpacity={isPending ? 0.2 : isHovered || isCenterHovered ? 0.9 : 0.32}
                  strokeWidth={
                    isHovered ? 2.2 : Math.max(1, (sector.spyWeightPct / maxWeight) * 2.4)
                  }
                  className={animateReveal ? 'detail-reveal-line' : undefined}
                  style={revealStyle(animateReveal, edgeDelay, 320)}
                />
                <g
                  className={animateReveal ? 'detail-reveal-scale' : undefined}
                  style={revealStyle(animateReveal, nodeDelay, 300)}
                >
                  <circle
                    cx={sx}
                    cy={sy}
                    r={r}
                    fill={isHovered ? '#0E1729' : '#080E1A'}
                    stroke={rgbaFromPolarity(polarity, isPending ? 0.24 : isHovered ? 0.92 : 0.45)}
                    strokeWidth={isHovered ? 1.75 : 1.1}
                  />
                  <g
                    className={animateReveal ? 'detail-reveal-fade' : undefined}
                    style={revealStyle(animateReveal, nodeDelay + 100, 240)}
                  >
                    <text
                      x={sx}
                      y={sy - 9}
                      textAnchor="middle"
                      fill={HOME_FUI_COLORS.white}
                      fontSize={r >= 36 ? 11.5 : 10}
                      fontWeight={700}
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      {sector.etfSymbol}
                    </text>
                    <text
                      x={sx}
                      y={sy + 5}
                      textAnchor="middle"
                      fill={HOME_FUI_COLORS.white}
                      fillOpacity={0.75}
                      fontSize={9.5}
                      style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                    >
                      {isPending ? '—' : `${sector.spyWeightPct.toFixed(1)}%`}
                    </text>
                    <text
                      x={sx}
                      y={sy + 18}
                      textAnchor="middle"
                      fill={strokeColor}
                      fontSize={10}
                      fontWeight={600}
                      style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatPct(sector.changePct, isPending)}
                    </text>
                  </g>
                </g>
              </g>
            );
          })}

          {/* Center Technology Sector (기술주) Node */}
          {techSector && (
            <g
              onMouseEnter={() => setHoveredSector(techSector.sectorKey)}
              onMouseLeave={() =>
                setHoveredSector((prev) => (prev === techSector.sectorKey ? null : prev))
              }
              onMouseDown={(e) => e.preventDefault()}
              className={animateReveal ? 'detail-reveal-scale' : undefined}
              style={{
                cursor: 'default',
                ...revealStyle(animateReveal, 0, 280),
              }}
            >
              <circle
                cx={CX}
                cy={CY}
                r={62}
                fill={hoveredSector === techSector.sectorKey ? '#0E1729' : '#091120'}
                stroke={rgbaFromPolarity(
                  centerPolarity,
                  isPending ? 0.42 : hoveredSector === techSector.sectorKey ? 0.95 : 0.72,
                )}
                strokeWidth={hoveredSector === techSector.sectorKey ? 2 : 1.6}
              />
              <text
                x={CX}
                y={CY - 13}
                textAnchor="middle"
                fill={HOME_FUI_COLORS.white}
                fontSize={16}
                fontWeight={700}
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {techSector.etfSymbol}
              </text>
              <text
                x={CX}
                y={CY + 6}
                textAnchor="middle"
                fill={HOME_FUI_COLORS.white}
                fillOpacity={0.85}
                fontSize={10.5}
                style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
              >
                {isPending
                  ? '—'
                  : `${techSector.spyWeightPct.toFixed(1)}% · ${formatMarketCap(techSector.sectorMarketCapUsd)}`}
              </text>
              <text
                x={CX}
                y={CY + 24}
                textAnchor="middle"
                fill={centerColor}
                fontSize={12}
                fontWeight={600}
                style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
              >
                {formatPct(techSector.changePct, isPending)}
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Right Sector Breakdown Readout */}
      <aside
        className={`w-full lg:w-[330px] shrink-0 space-y-4 border-t lg:border-t-0 lg:border-l border-[#F2F5F7]/12 pt-4 lg:pt-0 lg:pl-5 text-xs ${
          animateReveal ? 'detail-reveal-fade' : ''
        }`}
        style={revealStyle(animateReveal, 480, 360)}
      >
        {activeSector && (
          <div className="space-y-1.5 pb-3 border-b border-[#F2F5F7]/12">
            <div className="flex items-center justify-between text-[11px] text-[#F2F5F7]/55">
              <span>{activeSector.etfSymbol} · {isPending ? '—' : `${activeSector.constituentCount}종목`}</span>
              <span className="font-mono-tabular">
                SPY 비중 {isPending ? '—' : `${activeSector.spyWeightPct.toFixed(2)}%`}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-[#F2F5F7]">{activeSector.labelKo}</span>
              <span
                className="font-mono-tabular font-semibold"
                style={{ color: getPolarityColor(getValuePolarity(activeSector.changePct)) }}
              >
                {formatPct(activeSector.changePct, isPending)}
              </span>
            </div>
            <div className="text-[11px] font-mono-tabular text-[#F2F5F7]/70">
              섹터 합산 시가총액 {formatMarketCap(activeSector.sectorMarketCapUsd)}
            </div>
          </div>
        )}

        <div className="space-y-1">
          <div className="text-[11px] text-[#F2F5F7]/55 font-medium mb-1">S&P 500 섹터별 비중 · 등락률</div>
          <div className="divide-y divide-[#F2F5F7]/8">
            {data.sectors.map((s) => {
              const color = getPolarityColor(getValuePolarity(s.changePct));
              const active = activeSector?.sectorKey === s.sectorKey;
              return (
                <div
                  key={s.sectorKey}
                  onMouseEnter={() => setHoveredSector(s.sectorKey)}
                  onMouseLeave={() => setHoveredSector(null)}
                  className={`py-1.5 px-1.5 flex items-center justify-between gap-2 rounded-sm transition-colors ${
                    active ? 'bg-[#F2F5F7]/8' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono-tabular text-[11px] font-semibold text-[#F2F5F7] w-10">
                      {s.etfSymbol}
                    </span>
                    <span className="text-[#F2F5F7]/75 truncate text-[11px]">{s.labelKo}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 font-mono-tabular text-[11px]">
                    <span className="text-[#F2F5F7]/65">
                      {isPending ? '—' : `${s.spyWeightPct.toFixed(1)}%`}
                    </span>
                    <span className="w-14 text-right font-medium" style={{ color }}>
                      {formatPct(s.changePct, isPending)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="pt-2 border-t border-[#F2F5F7]/12 space-y-1 text-[11px] text-[#F2F5F7]/55">
          <div>보유비중 기준일: <span className="font-mono-tabular text-[#F2F5F7]/80">{data.holdingsReferenceDate ?? (isPending ? '—' : 'N/A')}</span></div>
          <div>출처: {data.sourceLabel}</div>
          {data.methodologyNote && (
            <p className="leading-relaxed text-[#F2F5F7]/50 pt-1">{data.methodologyNote}</p>
          )}
        </div>
      </aside>
    </div>
  );
};
