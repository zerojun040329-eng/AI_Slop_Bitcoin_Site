import React, { useMemo, useState } from 'react';
import type { QqqDetailPayload, QqqTechConstituent } from '../../../types/marketNetwork';
import {
  HOME_FUI_COLORS,
  getPolarityColor,
  getValuePolarity,
  rgbaFromPolarity,
} from '../homeTokens';

export interface QQQDetailViewProps {
  data: QqqDetailPayload;
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

interface PackedBubble {
  item: QqqTechConstituent;
  x: number;
  y: number;
  r: number;
}

const STAGE_W = 880;
const STAGE_H = 580;
const CENTER_X = STAGE_W / 2;
const CENTER_Y = STAGE_H / 2;
const OUTER_R = 258;

/**
 * Deterministic non-overlapping circle packing inside the enclosing circle.
 * Area is proportional to marketCapUsd (radius proportional to sqrt(marketCapUsd)).
 */
function packTechBubbles(constituents: QqqTechConstituent[]): PackedBubble[] {
  if (constituents.length === 0) return [];

  const sorted = [...constituents].sort((a, b) => b.marketCapUsd - a.marketCapUsd);
  const sqrts = sorted.map((c) => Math.sqrt(Math.max(1, c.marketCapUsd)));
  const sumAreas = sorted.reduce((acc, c) => acc + Math.max(1, c.marketCapUsd), 0);

  // Target total bubble area ~ 52% of outer circle area for airy, non-crowded Sci-Fi layout
  const targetBubbleArea = Math.PI * OUTER_R * OUTER_R * 0.5;
  const areaScale = Math.sqrt(targetBubbleArea / (Math.PI * sumAreas));

  const radii = sqrts.map((s) => Math.max(24, Math.min(82, s * areaScale)));

  const placed: PackedBubble[] = [];
  const padding = 8;

  for (let i = 0; i < sorted.length; i++) {
    const r = radii[i];
    if (i === 0) {
      placed.push({ item: sorted[i], x: CENTER_X, y: CENTER_Y, r });
      continue;
    }

    // Golden-angle spiral search for closest valid non-overlapping spot inside OUTER_R
    let bestX = CENTER_X;
    let bestY = CENTER_Y;
    const goldenAngle = 2.399963229728653;
    const baseAngle = i * goldenAngle;

    let found = false;
    for (let dist = 10; dist <= OUTER_R - r - 10; dist += 4) {
      for (let step = 0; step < 36; step++) {
        const theta = baseAngle + (step * Math.PI * 2) / 36;
        const cx = CENTER_X + dist * Math.cos(theta);
        const cy = CENTER_Y + dist * Math.sin(theta);

        const distFromCenter = Math.hypot(cx - CENTER_X, cy - CENTER_Y);
        if (distFromCenter + r + 10 > OUTER_R) continue;

        let overlaps = false;
        for (const other of placed) {
          if (Math.hypot(cx - other.x, cy - other.y) < r + other.r + padding) {
            overlaps = true;
            break;
          }
        }
        if (!overlaps) {
          bestX = cx;
          bestY = cy;
          found = true;
          break;
        }
      }
      if (found) break;
    }

    placed.push({ item: sorted[i], x: bestX, y: bestY, r });
  }

  // Gentle deterministic relaxation pass to equalize spacing & keep inside OUTER_R
  for (let iter = 0; iter < 80; iter++) {
    for (let i = 0; i < placed.length; i++) {
      const a = placed[i];
      // Slight pull toward center so largest clusters stay balanced
      a.x += (CENTER_X - a.x) * 0.015;
      a.y += (CENTER_Y - a.y) * 0.015;

      for (let j = i + 1; j < placed.length; j++) {
        const b = placed[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const minDist = a.r + b.r + padding;
        if (dist < minDist) {
          const push = (minDist - dist) * 0.52;
          const nx = dx / dist;
          const ny = dy / dist;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
        }
      }

      const dCenter = Math.hypot(a.x - CENTER_X, a.y - CENTER_Y);
      const maxD = OUTER_R - a.r - 12;
      if (dCenter > maxD && dCenter > 0) {
        const scale = maxD / dCenter;
        a.x = CENTER_X + (a.x - CENTER_X) * scale;
        a.y = CENTER_Y + (a.y - CENTER_Y) * scale;
      }
    }
  }

  return placed;
}

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

function formatPrice(val: number | null, isPending = false): string {
  if (val === null || !Number.isFinite(val)) return isPending ? '—' : 'N/A';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const QQQDetailView: React.FC<QQQDetailViewProps> = ({
  data,
  animateReveal = true,
  isPending = false,
}) => {
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const bubbles = useMemo(() => packTechBubbles(data.constituents), [data.constituents]);

  const activeItem =
    bubbles.find((b) => b.item.symbol === hoveredSymbol)?.item ??
    bubbles[0]?.item ??
    null;

  // Radial outward order from center for progressive reveal
  const radialDelayBySymbol = useMemo(() => {
    const sortedByDist = [...bubbles]
      .map((b) => ({
        symbol: b.item.symbol,
        dist: Math.hypot(b.x - CENTER_X, b.y - CENTER_Y),
      }))
      .sort((a, b) => a.dist - b.dist);
    const map = new Map<string, number>();
    sortedByDist.forEach((entry, idx) => {
      map.set(entry.symbol, idx === 0 ? 60 : 160 + idx * 48);
    });
    return map;
  }, [bubbles]);

  return (
    <div className="w-full flex flex-col lg:flex-row items-center gap-6">
      <div className="flex-1 w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
          role="img"
          aria-label="QQQ 기술주 Top 10 시가총액 비례 버블 네트워크"
          className="w-full min-w-[560px] max-h-[560px] block mx-auto select-none outline-none focus:outline-none"
        >
          <defs>
            <filter id="qqq-glow-positive" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={HOME_FUI_COLORS.cyan} floodOpacity="0.28" />
            </filter>
            <filter id="qqq-glow-negative" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={HOME_FUI_COLORS.coral} floodOpacity="0.28" />
            </filter>
          </defs>

          {/* Outer enclosing circular QQQ Tech Universe boundary */}
          <g
            aria-hidden="true"
            className={animateReveal ? 'detail-reveal-scale' : undefined}
            style={revealStyle(animateReveal, 0, 360)}
          >
            <circle
              cx={CENTER_X}
              cy={CENTER_Y}
              r={OUTER_R}
              fill="rgba(8, 14, 26, 0.55)"
              stroke={HOME_FUI_COLORS.white}
              strokeOpacity={0.22}
              strokeWidth={1.25}
            />
            <circle
              cx={CENTER_X}
              cy={CENTER_Y}
              r={OUTER_R + 10}
              fill="none"
              stroke={HOME_FUI_COLORS.white}
              strokeOpacity={0.08}
              strokeWidth={0.75}
              strokeDasharray="3 6"
            />
            <text
              x={CENTER_X}
              y={CENTER_Y - OUTER_R - 18}
              textAnchor="middle"
              fill={HOME_FUI_COLORS.white}
              fillOpacity={0.55}
              fontSize={10.5}
              fontWeight={500}
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              QQQ TECHNOLOGY TOP 10 · AREA ∝ MARKET CAP
            </text>
          </g>

          {/* Top 10 floating tech bubbles */}
          {bubbles.map(({ item, x, y, r }) => {
            const polarity = getValuePolarity(item.changePct);
            const accent = getPolarityColor(polarity);
            const isHovered = hoveredSymbol === item.symbol;
            const dimmed = hoveredSymbol !== null && !isHovered;

            const showName = r >= 44;
            const tickerSize = r >= 62 ? 15 : r >= 44 ? 13 : 11.5;
            const pctSize = r >= 62 ? 12.5 : r >= 44 ? 11 : 10;
            const bubbleDelay = radialDelayBySymbol.get(item.symbol) ?? 200;

            return (
              <g
                key={isPending ? `pending-${item.rank}` : item.symbol}
                onMouseEnter={() => !isPending && setHoveredSymbol(item.symbol)}
                onMouseLeave={() => setHoveredSymbol((prev) => (prev === item.symbol ? null : prev))}
                onMouseDown={(e) => e.preventDefault()}
                filter={
                  isHovered && polarity !== 'neutral'
                    ? `url(#qqq-glow-${polarity})`
                    : undefined
                }
                style={{
                  cursor: 'default',
                  opacity: isPending ? 0.55 : dimmed ? 0.36 : 1,
                  transition: 'opacity 240ms ease',
                }}
              >
                <g
                  className={animateReveal ? 'detail-reveal-scale' : undefined}
                  style={revealStyle(animateReveal, bubbleDelay, 340)}
                >
                  <circle
                    cx={x}
                    cy={y}
                    r={r}
                    fill={isHovered ? '#0E1729' : '#080E1A'}
                    stroke={rgbaFromPolarity(polarity, isPending ? 0.24 : isHovered ? 0.92 : 0.48)}
                    strokeWidth={isHovered ? 1.8 : 1.15}
                  />
                  <g
                    className={animateReveal ? 'detail-reveal-fade' : undefined}
                    style={revealStyle(animateReveal, bubbleDelay + 110, 260)}
                  >
                    <text
                      x={x}
                      y={y - (showName ? 11 : 6)}
                      textAnchor="middle"
                      fill={HOME_FUI_COLORS.white}
                      fontSize={tickerSize}
                      fontWeight={700}
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      {item.symbol}
                    </text>
                    {showName && (
                      <text
                        x={x}
                        y={y + 4}
                        textAnchor="middle"
                        fill={HOME_FUI_COLORS.white}
                        fillOpacity={0.58}
                        fontSize={9.5}
                        style={{ fontFamily: 'var(--font-sans)' }}
                      >
                        {item.name.length > 14 ? `${item.name.slice(0, 13)}…` : item.name}
                      </text>
                    )}
                    <text
                      x={x}
                      y={y + (showName ? 21 : 12)}
                      textAnchor="middle"
                      fill={accent}
                      fontSize={pctSize}
                      fontWeight={600}
                      style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatPct(item.changePct, isPending)}
                    </text>
                  </g>
                </g>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Right clean tabular telemetry readout (no heavy card boxes) */}
      <aside
        className={`w-full lg:w-[320px] shrink-0 space-y-4 border-t lg:border-t-0 lg:border-l border-[#F2F5F7]/12 pt-4 lg:pt-0 lg:pl-5 text-xs ${
          animateReveal ? 'detail-reveal-fade' : ''
        }`}
        style={revealStyle(animateReveal, 420, 360)}
      >
        {activeItem && (
          <div className="space-y-2 pb-3 border-b border-[#F2F5F7]/12">
            <div className="flex items-center justify-between text-[11px] text-[#F2F5F7]/55">
              <span>#{activeItem.rank} · {activeItem.industry}</span>
              <span className="font-mono-tabular">
                비중 {isPending ? '—' : `${activeItem.weightInTop10Pct.toFixed(1)}%`}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-semibold text-sm text-[#F2F5F7] truncate">
                {activeItem.name ? `${activeItem.symbol} · ${activeItem.name}` : activeItem.symbol}
              </div>
              <span
                className="font-mono-tabular font-semibold shrink-0"
                style={{ color: getPolarityColor(getValuePolarity(activeItem.changePct)) }}
              >
                {formatPct(activeItem.changePct, isPending)}
              </span>
            </div>
            <div className="flex justify-between text-[11px] font-mono-tabular text-[#F2F5F7]/75">
              <span>주가 {formatPrice(activeItem.priceUsd, isPending)}</span>
              <span>시총 {isPending ? '—' : formatMarketCap(activeItem.marketCapUsd)}</span>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="text-[11px] text-[#F2F5F7]/55 font-medium">Top 10 기술주 시가총액 순위</div>
          <div className="divide-y divide-[#F2F5F7]/8">
            {data.constituents.map((c) => {
              const color = getPolarityColor(getValuePolarity(c.changePct));
              const isActive = !isPending && activeItem?.symbol === c.symbol;
              return (
                <div
                  key={isPending ? `pending-row-${c.rank}` : c.symbol}
                  onMouseEnter={() => !isPending && setHoveredSymbol(c.symbol)}
                  onMouseLeave={() => setHoveredSymbol(null)}
                  className={`py-1.5 px-1.5 flex items-center justify-between gap-2 rounded-sm transition-colors ${
                    isActive ? 'bg-[#F2F5F7]/8' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-4 font-mono-tabular text-[10px] text-[#F2F5F7]/45">
                      {c.rank}
                    </span>
                    <span className="font-semibold text-[#F2F5F7]">{c.symbol}</span>
                    <span className="text-[#F2F5F7]/50 truncate text-[11px]">{c.name}</span>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0 font-mono-tabular text-[11px]">
                    <span className="text-[#F2F5F7]/70">
                      {isPending ? '—' : formatMarketCap(c.marketCapUsd)}
                    </span>
                    <span className="w-14 text-right font-medium" style={{ color }}>
                      {formatPct(c.changePct, isPending)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="pt-2 border-t border-[#F2F5F7]/12 space-y-1 text-[11px] text-[#F2F5F7]/55">
          <div>시가총액 기준일: <span className="font-mono-tabular text-[#F2F5F7]/80">{data.marketCapReferenceDate ?? (isPending ? '—' : 'N/A')}</span></div>
          <div>출처: {data.sourceLabel}</div>
          {data.methodologyNote && (
            <p className="leading-relaxed text-[#F2F5F7]/50 pt-1">{data.methodologyNote}</p>
          )}
        </div>
      </aside>
    </div>
  );
};
