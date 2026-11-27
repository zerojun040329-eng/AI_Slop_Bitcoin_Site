import React, { useState } from 'react';
import type { M2DetailPayload, MacroMindMapLeaf } from '../../../types/marketNetwork';
import {
  HOME_FUI_COLORS,
  getPolarityColor,
  getValuePolarity,
  rgbaFromPolarity,
} from '../homeTokens';

export interface M2DetailViewProps {
  data: M2DetailPayload;
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

const STAGE_W = 1080;
const STAGE_H = 620;
const CX = STAGE_W / 2;
const CY = STAGE_H / 2;

const GROUP_LAYOUT: Array<{
  angleDeg: number;
  hubDist: number;
  leafDist: number;
  leafSpreadDeg: number;
}> = [
  { angleDeg: -150, hubDist: 165, leafDist: 315, leafSpreadDeg: 24 }, // 통화량 (top-left)
  { angleDeg: -90, hubDist: 145, leafDist: 258, leafSpreadDeg: 40 },  // 유동성 (top)
  { angleDeg: -30, hubDist: 165, leafDist: 315, leafSpreadDeg: 24 },  // 금리 (top-right)
  { angleDeg: 30, hubDist: 165, leafDist: 315, leafSpreadDeg: 24 },   // 경기 (bottom-right)
  { angleDeg: 90, hubDist: 145, leafDist: 258, leafSpreadDeg: 40 },   // 물가 (bottom)
  { angleDeg: 150, hubDist: 170, leafDist: 328, leafSpreadDeg: 25 },  // 자산시장 (bottom-left)
];

function polar(cx: number, cy: number, angleDeg: number, r: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function quadCurve(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${mx.toFixed(1)} ${a.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

export const M2DetailView: React.FC<M2DetailViewProps> = ({
  data,
  animateReveal = true,
  isPending = false,
}) => {
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [hoveredLeaf, setHoveredLeaf] = useState<MacroMindMapLeaf | null>(null);

  const centerPolarity = getValuePolarity(data.center.yoyPct);
  const centerColor = getPolarityColor(centerPolarity);

  return (
    <div className="w-full space-y-4">
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
          role="img"
          aria-label="M2 증가율 중심 거시경제 마인드맵"
          className="w-full min-w-[720px] max-h-[600px] block mx-auto select-none outline-none focus:outline-none"
        >
          {animateReveal && (
            <defs>
              {data.groups.map((group, gIdx) => {
                const cfg = GROUP_LAYOUT[gIdx % GROUP_LAYOUT.length];
                const hubPos = polar(CX, CY, cfg.angleDeg, cfg.hubDist);
                const count = group.nodes.length;
                return (
                  <React.Fragment key={`m2-masks-${group.id}`}>
                    <mask
                      id={`m2-hub-mask-${group.id}`}
                      maskUnits="userSpaceOnUse"
                      x={0}
                      y={0}
                      width={STAGE_W}
                      height={STAGE_H}
                    >
                      <path
                        d={quadCurve({ x: CX, y: CY }, hubPos)}
                        fill="none"
                        pathLength={100}
                        stroke="#FFFFFF"
                        strokeWidth={16}
                        strokeLinecap="round"
                        className="detail-reveal-line"
                        style={revealStyle(true, 120 + gIdx * 55, 260)}
                      />
                    </mask>
                    {group.nodes.map((leaf, lIdx) => {
                      const offset = (lIdx - (count - 1) / 2) * cfg.leafSpreadDeg;
                      const lp = polar(CX, CY, cfg.angleDeg + offset, cfg.leafDist);
                      return (
                        <mask
                          key={`m2-leaf-mask-${leaf.id}`}
                          id={`m2-leaf-mask-${leaf.id}`}
                          maskUnits="userSpaceOnUse"
                          x={0}
                          y={0}
                          width={STAGE_W}
                          height={STAGE_H}
                        >
                          <path
                            d={quadCurve(hubPos, lp)}
                            fill="none"
                            pathLength={100}
                            stroke="#FFFFFF"
                            strokeWidth={16}
                            strokeLinecap="round"
                            className="detail-reveal-line"
                            style={revealStyle(true, 310 + gIdx * 55 + lIdx * 40, 260)}
                          />
                        </mask>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </defs>
          )}

          {/* Subtle radial guide rings */}
          <g
            aria-hidden="true"
            pointerEvents="none"
            className={animateReveal ? 'detail-reveal-fade' : undefined}
            style={revealStyle(animateReveal, 40, 320)}
          >
            <circle
              cx={CX}
              cy={CY}
              r={160}
              fill="none"
              stroke={HOME_FUI_COLORS.white}
              strokeOpacity={0.05}
              strokeDasharray="2 6"
            />
            <circle
              cx={CX}
              cy={CY}
              r={315}
              fill="none"
              stroke={HOME_FUI_COLORS.white}
              strokeOpacity={0.04}
            />
          </g>

          {/* 6 Macro Branch Groups */}
          {data.groups.map((group, gIdx) => {
            const cfg = GROUP_LAYOUT[gIdx % GROUP_LAYOUT.length];
            const hubPos = polar(CX, CY, cfg.angleDeg, cfg.hubDist);
            const isGroupHovered = hoveredGroupId === group.id;
            const dimmed = hoveredGroupId !== null && !isGroupHovered;

            const count = group.nodes.length;
            const leafCoords = group.nodes.map((_, nIdx) => {
              const offset = (nIdx - (count - 1) / 2) * cfg.leafSpreadDeg;
              return polar(CX, CY, cfg.angleDeg + offset, cfg.leafDist);
            });

            return (
              <g
                key={group.id}
                onMouseEnter={() => setHoveredGroupId(group.id)}
                onMouseLeave={() =>
                  setHoveredGroupId((prev) => (prev === group.id ? null : prev))
                }
                style={{
                  opacity: dimmed ? 0.28 : 1,
                  transition: 'opacity 180ms ease',
                }}
              >
                {/* Center -> Group Hub line */}
                <path
                  d={quadCurve({ x: CX, y: CY }, hubPos)}
                  fill="none"
                  stroke={HOME_FUI_COLORS.white}
                  strokeOpacity={isGroupHovered ? 0.65 : 0.25}
                  strokeWidth={isGroupHovered ? 1.8 : 1.2}
                  mask={animateReveal ? `url(#m2-hub-mask-${group.id})` : undefined}
                />

                {/* Hub -> Leaf lines & Leaf Nodes */}
                {group.nodes.map((leaf, lIdx) => {
                  const lp = leafCoords[lIdx];
                  const leafPolarity =
                    leaf.status === 'unlinked' ? 'neutral' : getValuePolarity(leaf.directionValue);
                  const leafColor = getPolarityColor(leafPolarity);
                  const isLeafActive = hoveredLeaf?.id === leaf.id;
                  const leafDelay = 450 + gIdx * 55 + lIdx * 40;

                  return (
                    <g
                      key={leaf.id}
                      onMouseEnter={() => setHoveredLeaf(leaf)}
                      onMouseLeave={() =>
                        setHoveredLeaf((prev) => (prev?.id === leaf.id ? null : prev))
                      }
                      onMouseDown={(e) => e.preventDefault()}
                      style={{ cursor: 'default' }}
                    >
                      <path
                        d={quadCurve(hubPos, lp)}
                        fill="none"
                        stroke={leafColor}
                        strokeOpacity={
                          leaf.status === 'unlinked' ? 0.16 : isLeafActive ? 0.9 : 0.42
                        }
                        strokeWidth={isLeafActive ? 1.8 : 1.15}
                        strokeDasharray={leaf.status === 'unlinked' ? '4 4' : undefined}
                        mask={animateReveal ? `url(#m2-leaf-mask-${leaf.id})` : undefined}
                      />

                      <g
                        className={animateReveal ? 'detail-reveal-scale' : undefined}
                        style={revealStyle(animateReveal, leafDelay, 280)}
                      >
                        <rect
                          x={lp.x - 68}
                          y={lp.y - 26}
                          width={136}
                          height={52}
                          rx={8}
                          fill={isLeafActive ? '#0E1729' : '#080E1A'}
                          stroke={rgbaFromPolarity(
                            leafPolarity,
                            leaf.status === 'unlinked' ? 0.2 : isLeafActive ? 0.9 : 0.44,
                          )}
                          strokeWidth={isLeafActive ? 1.5 : 1}
                          strokeDasharray={leaf.status === 'unlinked' ? '3 3' : undefined}
                        />
                        <text
                          x={lp.x}
                          y={lp.y - 8}
                          textAnchor="middle"
                          fill={HOME_FUI_COLORS.white}
                          fillOpacity={0.85}
                          fontSize={10.5}
                          fontWeight={600}
                        >
                          {leaf.labelKo}
                        </text>
                        <text
                          x={lp.x}
                          y={lp.y + 8}
                          textAnchor="middle"
                          fill={
                            leaf.status === 'unlinked' ? 'rgba(242,245,247,0.45)' : leafColor
                          }
                          fontSize={12}
                          fontWeight={700}
                          style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                        >
                          {leaf.valueText}
                        </text>
                        <text
                          x={lp.x}
                          y={lp.y + 21}
                          textAnchor="middle"
                          fill={HOME_FUI_COLORS.white}
                          fillOpacity={0.48}
                          fontSize={8.5}
                          style={{ fontFamily: 'var(--font-mono)' }}
                        >
                          {leaf.subText.length > 20 ? `${leaf.subText.slice(0, 19)}…` : leaf.subText}
                        </text>
                      </g>
                    </g>
                  );
                })}

                {/* Group Hub Pill/Circle */}
                <g
                  className={animateReveal ? 'detail-reveal-scale' : undefined}
                  style={revealStyle(animateReveal, 250 + gIdx * 55, 260)}
                >
                  <rect
                    x={hubPos.x - 42}
                    y={hubPos.y - 14}
                    width={84}
                    height={28}
                    rx={14}
                    fill="#091120"
                    stroke={HOME_FUI_COLORS.white}
                    strokeOpacity={isGroupHovered ? 0.72 : 0.34}
                    strokeWidth={1.1}
                  />
                  <text
                    x={hubPos.x}
                    y={hubPos.y + 4}
                    textAnchor="middle"
                    fill={HOME_FUI_COLORS.white}
                    fontSize={11.5}
                    fontWeight={600}
                  >
                    {group.labelKo}
                  </text>
                </g>
              </g>
            );
          })}

          {/* Center M2 증가율 Hub */}
          <g
            className={animateReveal ? 'detail-reveal-scale' : undefined}
            style={revealStyle(animateReveal, 0, 280)}
          >
            <circle
              cx={CX}
              cy={CY}
              r={64}
              fill="#091120"
              stroke={rgbaFromPolarity(centerPolarity, 0.75)}
              strokeWidth={1.7}
            />
            <text
              x={CX}
              y={CY - 22}
              textAnchor="middle"
              fill={HOME_FUI_COLORS.white}
              fillOpacity={0.55}
              fontSize={9.5}
            >
              거시 유동성 중심
            </text>
            <text
              x={CX}
              y={CY - 4}
              textAnchor="middle"
              fill={HOME_FUI_COLORS.white}
              fontSize={14}
              fontWeight={700}
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {data.center.labelKo}
            </text>
            <text
              x={CX}
              y={CY + 16}
              textAnchor="middle"
              fill={centerColor}
              fontSize={15}
              fontWeight={700}
              style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
            >
              {data.center.yoyPct !== null
                ? `${data.center.yoyPct >= 0 ? '+' : ''}${data.center.yoyPct.toFixed(2)}%`
                : isPending
                  ? '—'
                  : 'N/A'}
            </text>
            <text
              x={CX}
              y={CY + 34}
              textAnchor="middle"
              fill={HOME_FUI_COLORS.white}
              fillOpacity={0.55}
              fontSize={9.5}
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {data.center.levelBillionsUsd !== null
                ? `${data.center.levelBillionsUsd.toLocaleString('en-US', {
                    maximumFractionDigits: 0,
                  })}B`
                : 'M2SL'}
            </text>
          </g>
        </svg>
      </div>

      {/* Concise Bottom Status Strip */}
      <div
        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-[#F2F5F7]/12 text-[11px] text-[#F2F5F7]/65 ${
          animateReveal ? 'detail-reveal-fade' : ''
        }`}
        style={revealStyle(animateReveal, 680, 320)}
      >
        <div>
          {hoveredLeaf && !isPending ? (
            <span>
              <strong className="text-[#F2F5F7]">{hoveredLeaf.labelKo}</strong> ({hoveredLeaf.seriesCode}) ·{' '}
              {hoveredLeaf.sourceLabel} · 기준일 {hoveredLeaf.observationDate ?? '미연결'}
            </span>
          ) : (
            <span>{data.methodologyNote}</span>
          )}
        </div>
        <span className="font-mono-tabular text-[#F2F5F7]/50 shrink-0">
          기준 M2 {data.center.latestDate ?? (isPending ? '—' : 'N/A')}
        </span>
      </div>
    </div>
  );
};
