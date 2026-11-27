import React, { useMemo, useState } from 'react';
import type { TltDetailPayload, TreasuryMaturityKey } from '../../../types/marketNetwork';
import {
  HOME_FUI_COLORS,
  getPolarityColor,
  getValuePolarity,
} from '../homeTokens';

export interface TLTDetailViewProps {
  data: TltDetailPayload;
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

const CHART_W = 860;
const CHART_H = 380;
const PAD_L = 54;
const PAD_R = 24;
const PAD_T = 24;
const PAD_B = 42;

const MATURITY_ORDER: readonly TreasuryMaturityKey[] = ['2Y', '5Y', '10Y', '20Y', '30Y'];

const MATURITY_STYLES: Record<
  TreasuryMaturityKey,
  { stroke: string; opacity: number; dash?: string; width: number; label: string }
> = {
  '2Y': { stroke: HOME_FUI_COLORS.coral, opacity: 0.92, width: 1.9, label: '2년물 (DGS2)' },
  '5Y': { stroke: HOME_FUI_COLORS.white, opacity: 0.52, dash: '2 3', width: 1.5, label: '5년물 (DGS5)' },
  '10Y': { stroke: HOME_FUI_COLORS.cyan, opacity: 0.96, width: 2.4, label: '10년물 (DGS10)' },
  '20Y': { stroke: HOME_FUI_COLORS.cyan, opacity: 0.65, dash: '6 3', width: 1.7, label: '20년물 (DGS20)' },
  '30Y': { stroke: HOME_FUI_COLORS.white, opacity: 0.88, width: 2.0, label: '30년물 (DGS30)' },
};

function formatYield(val: number | null, isPending = false): string {
  if (val === null || !Number.isFinite(val)) return isPending ? '—' : 'N/A';
  return `${val.toFixed(2)}%`;
}

function formatDeltaPp(val: number | null, isPending = false): string {
  if (val === null || !Number.isFinite(val)) return isPending ? '—' : 'N/A';
  return `${val > 0 ? '+' : ''}${val.toFixed(2)}%p`;
}

export const TLTDetailView: React.FC<TLTDetailViewProps> = ({
  data,
  animateReveal = true,
  isPending = false,
}) => {
  const [focusedMaturity, setFocusedMaturity] = useState<TreasuryMaturityKey | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { minY, maxY, paths, yTicks, xTicks } = useMemo(() => {
    const allValues: number[] = [];
    for (const m of MATURITY_ORDER) {
      for (const v of data.seriesByMaturity[m] ?? []) {
        if (v !== null && Number.isFinite(v)) allValues.push(v);
      }
    }
    const rawMin = allValues.length > 0 ? Math.min(...allValues) : 3.5;
    const rawMax = allValues.length > 0 ? Math.max(...allValues) : 5.5;
    const pad = Math.max(0.15, (rawMax - rawMin) * 0.14);
    const min = Math.floor((rawMin - pad) * 10) / 10;
    const max = Math.ceil((rawMax + pad) * 10) / 10;

    const plotW = CHART_W - PAD_L - PAD_R;
    const plotH = CHART_H - PAD_T - PAD_B;
    const n = Math.max(2, data.seriesDates.length);

    const toX = (i: number) => PAD_L + (i / (n - 1)) * plotW;
    const toY = (v: number) => PAD_T + ((max - v) / Math.max(0.01, max - min)) * plotH;

    const builtPaths: Record<TreasuryMaturityKey, string> = {
      '2Y': '',
      '5Y': '',
      '10Y': '',
      '20Y': '',
      '30Y': '',
    };

    for (const m of MATURITY_ORDER) {
      const series = data.seriesByMaturity[m] ?? [];
      let d = '';
      let penDown = false;
      for (let i = 0; i < series.length; i++) {
        const val = series[i];
        if (val === null || !Number.isFinite(val)) {
          penDown = false;
          continue;
        }
        const x = toX(i).toFixed(1);
        const y = toY(val).toFixed(1);
        d += penDown ? ` L ${x} ${y}` : ` M ${x} ${y}`;
        penDown = true;
      }
      builtPaths[m] = d;
    }

    const tickCountY = 5;
    const builtYTicks: Array<{ val: number; y: number }> = [];
    for (let i = 0; i < tickCountY; i++) {
      const val = min + ((max - min) * i) / (tickCountY - 1);
      builtYTicks.push({ val, y: toY(val) });
    }

    const builtXTicks: Array<{ label: string; x: number }> = [];
    if (data.seriesDates.length > 0) {
      const stepIndices = [0, Math.floor((n - 1) * 0.25), Math.floor((n - 1) * 0.5), Math.floor((n - 1) * 0.75), n - 1];
      const used = new Set<number>();
      for (const idx of stepIndices) {
        if (idx >= 0 && idx < data.seriesDates.length && !used.has(idx)) {
          used.add(idx);
          builtXTicks.push({ label: data.seriesDates[idx].slice(2), x: toX(idx) });
        }
      }
    }

    return { minY: min, maxY: max, paths: builtPaths, yTicks: builtYTicks, xTicks: builtXTicks };
  }, [data]);

  const activeIdx =
    hoverIdx !== null && hoverIdx >= 0 && hoverIdx < data.seriesDates.length
      ? hoverIdx
      : Math.max(0, data.seriesDates.length - 1);
  const activeDate = data.seriesDates[activeIdx] ?? null;

  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = CHART_H - PAD_T - PAD_B;
  const activeX =
    data.seriesDates.length > 1
      ? PAD_L + (activeIdx / (data.seriesDates.length - 1)) * plotW
      : PAD_L;

  const spreadColor = getPolarityColor(getValuePolarity(data.spread10y2yPp));
  const tltChangeColor = getPolarityColor(getValuePolarity(data.tltReference.change24hPct));

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (data.seriesDates.length < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * CHART_W;
    const rel = Math.max(0, Math.min(1, (svgX - PAD_L) / plotW));
    const idx = Math.round(rel * (data.seriesDates.length - 1));
    setHoverIdx(idx);
  };

  return (
    <div className="w-full space-y-5">
      {/* Explicit TLT ETF vs US Treasury Yield Distinction Notice + Reference Strip */}
      <div
        className={`flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-[#F2F5F7]/12 ${
          animateReveal ? 'detail-reveal-fade' : ''
        }`}
        style={revealStyle(animateReveal, 0, 280)}
      >
        <p className="text-xs text-[#F2F5F7]/75 leading-relaxed max-w-3xl">
          {data.etfDistinctionNote}
        </p>

        <div className="flex flex-wrap items-center gap-5 shrink-0 font-mono-tabular text-xs">
          <div>
            <div className="text-[10px] text-[#F2F5F7]/50 font-sans">TLT ETF (참고 가격)</div>
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-[#F2F5F7]">
                {data.tltReference.priceUsd !== null
                  ? `$${data.tltReference.priceUsd.toFixed(2)}`
                  : isPending
                    ? '—'
                    : 'N/A'}
              </span>
              <span style={{ color: tltChangeColor }}>
                {data.tltReference.change24hPct !== null
                  ? `${data.tltReference.change24hPct > 0 ? '+' : ''}${data.tltReference.change24hPct.toFixed(2)}%`
                  : isPending
                    ? '—'
                    : 'N/A'}
              </span>
            </div>
          </div>

          <div className="pl-4 border-l border-[#F2F5F7]/15">
            <div className="text-[10px] text-[#F2F5F7]/50 font-sans">10Y – 2Y 스프레드</div>
            <div className="font-semibold" style={{ color: spreadColor }}>
              {formatDeltaPp(data.spread10y2yPp, isPending)}
            </div>
          </div>
        </div>
      </div>

      {/* Maturity Current Values & Legend Controls */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        {data.maturities.map((m, idx) => {
          const st = MATURITY_STYLES[m.maturity];
          const isFocused = focusedMaturity === m.maturity;
          const deltaColor = getPolarityColor(getValuePolarity(m.change1dPp));
          return (
            <button
              key={m.maturity}
              type="button"
              onClick={() =>
                setFocusedMaturity((prev) => (prev === m.maturity ? null : m.maturity))
              }
              onMouseDown={(e) => e.preventDefault()}
              className={`text-left px-3 py-2 rounded border transition-colors cursor-pointer focus:outline-none ${
                isFocused
                  ? 'border-[#35D6E8]/70 bg-[#0E1729]'
                  : 'border-[#F2F5F7]/14 bg-[#080E1A]/75 hover:border-[#F2F5F7]/30'
              } ${animateReveal ? 'detail-reveal-fade' : ''}`}
              style={revealStyle(animateReveal, 110 + idx * 45, 280)}
            >
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-[#F2F5F7]">{m.maturity}</span>
                <span
                  className="inline-block w-5 h-0.5"
                  style={{
                    backgroundColor: st.stroke,
                    opacity: st.opacity,
                    borderTop: st.dash ? `1.5px dashed ${st.stroke}` : undefined,
                  }}
                />
              </div>
              <div className="mt-1 flex items-baseline justify-between font-mono-tabular">
                <span className="text-sm font-semibold text-[#F2F5F7]">
                  {formatYield(m.latestYieldPct, isPending)}
                </span>
                <span className="text-[11px]" style={{ color: deltaColor }}>
                  {formatDeltaPp(m.change1dPp, isPending)}
                </span>
              </div>
              <div className="text-[10px] font-mono-tabular text-[#F2F5F7]/48 mt-0.5">
                1M {formatDeltaPp(m.change1mPp, isPending)}
              </div>
            </button>
          );
        })}
      </div>

      {/* Multi-Maturity Time-Series SVG Chart */}
      <div
        className={`w-full overflow-x-auto ${animateReveal ? 'detail-reveal-fade' : ''}`}
        style={revealStyle(animateReveal, 220, 320)}
      >
        <div className="flex items-center justify-between text-[11px] text-[#F2F5F7]/65 mb-1.5 px-1">
          <span className="font-mono-tabular">
            기준일: {activeDate ?? (isPending ? '—' : 'N/A')}
          </span>
          <div className="flex flex-wrap items-center gap-3 font-mono-tabular">
            {MATURITY_ORDER.map((m) => {
              const val = data.seriesByMaturity[m]?.[activeIdx] ?? null;
              return (
                <span key={m} className="text-[#F2F5F7]/85">
                  <span className="text-[#F2F5F7]/50">{m} </span>
                  {formatYield(val, isPending)}
                </span>
              );
            })}
          </div>
        </div>

        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          role="img"
          aria-label="미국 국채 만기별 수익률 시계열 차트"
          onMouseMove={handleSvgMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
          className="w-full min-w-[560px] max-h-[390px] block mx-auto select-none outline-none focus:outline-none"
        >
          {animateReveal && (
            <defs>
              {MATURITY_ORDER.map((m, idx) => (
                <mask
                  key={`tlt-mask-${m}`}
                  id={`tlt-line-mask-${m}`}
                  maskUnits="userSpaceOnUse"
                  x={0}
                  y={0}
                  width={CHART_W}
                  height={CHART_H}
                >
                  <line
                    x1={PAD_L}
                    y1={CHART_H / 2}
                    x2={CHART_W - PAD_R}
                    y2={CHART_H / 2}
                    pathLength={100}
                    stroke="#FFFFFF"
                    strokeWidth={CHART_H}
                    className="detail-reveal-line"
                    style={revealStyle(true, 300 + idx * 65, 520)}
                  />
                </mask>
              ))}
            </defs>
          )}

          {/* Horizontal yield gridlines */}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line
                x1={PAD_L}
                y1={t.y}
                x2={CHART_W - PAD_R}
                y2={t.y}
                stroke={HOME_FUI_COLORS.white}
                strokeOpacity={0.08}
                strokeWidth={0.75}
              />
              <text
                x={PAD_L - 8}
                y={t.y + 4}
                textAnchor="end"
                fill={HOME_FUI_COLORS.white}
                fillOpacity={0.55}
                fontSize={10.5}
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {t.val.toFixed(2)}%
              </text>
            </g>
          ))}

          {/* X-axis dates */}
          {xTicks.map((t, i) => (
            <text
              key={i}
              x={t.x}
              y={CHART_H - 12}
              textAnchor="middle"
              fill={HOME_FUI_COLORS.white}
              fillOpacity={0.52}
              fontSize={10}
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {t.label}
            </text>
          ))}

          {/* Chart boundary axes */}
          <line
            x1={PAD_L}
            y1={PAD_T}
            x2={PAD_L}
            y2={PAD_T + plotH}
            stroke={HOME_FUI_COLORS.white}
            strokeOpacity={0.18}
          />
          <line
            x1={PAD_L}
            y1={PAD_T + plotH}
            x2={CHART_W - PAD_R}
            y2={PAD_T + plotH}
            stroke={HOME_FUI_COLORS.white}
            strokeOpacity={0.18}
          />

          {/* Maturity yield lines */}
          {MATURITY_ORDER.map((m) => {
            const st = MATURITY_STYLES[m];
            const dimmed = focusedMaturity !== null && focusedMaturity !== m;
            return (
              <path
                key={m}
                d={paths[m]}
                fill="none"
                stroke={st.stroke}
                strokeOpacity={dimmed ? 0.16 : st.opacity}
                strokeWidth={focusedMaturity === m ? st.width + 0.8 : st.width}
                strokeDasharray={st.dash}
                strokeLinejoin="round"
                strokeLinecap="round"
                mask={animateReveal ? `url(#tlt-line-mask-${m})` : undefined}
              />
            );
          })}

          {/* Hover crosshair & active dots */}
          {data.seriesDates.length > 0 && (
            <g
              pointerEvents="none"
              className={animateReveal ? 'detail-reveal-fade' : undefined}
              style={revealStyle(animateReveal, 640, 260)}
            >
              <line
                x1={activeX}
                y1={PAD_T}
                x2={activeX}
                y2={PAD_T + plotH}
                stroke={HOME_FUI_COLORS.white}
                strokeOpacity={0.28}
                strokeDasharray="3 3"
              />
              {MATURITY_ORDER.map((m) => {
                const v = data.seriesByMaturity[m]?.[activeIdx];
                if (v === null || v === undefined || !Number.isFinite(v)) return null;
                const y = PAD_T + ((maxY - v) / Math.max(0.01, maxY - minY)) * plotH;
                const st = MATURITY_STYLES[m];
                const dimmed = focusedMaturity !== null && focusedMaturity !== m;
                return (
                  <circle
                    key={m}
                    cx={activeX}
                    cy={y}
                    r={focusedMaturity === m ? 4.2 : 3}
                    fill={st.stroke}
                    fillOpacity={dimmed ? 0.2 : 1}
                  />
                );
              })}
            </g>
          )}
        </svg>
      </div>

      <div
        className={`flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#F2F5F7]/50 pt-1 border-t border-[#F2F5F7]/10 ${
          animateReveal ? 'detail-reveal-fade' : ''
        }`}
        style={revealStyle(animateReveal, 660, 280)}
      >
        <span>가로축: 최근 거래일 · 세로축: 미국 국채 수익률 (%) · 카드 클릭 시 해당 만기 강조</span>
        <span>출처: {data.sourceLabel}</span>
      </div>
    </div>
  );
};
