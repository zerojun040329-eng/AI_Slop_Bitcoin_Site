import React, { useMemo, useRef, useState } from 'react';
import {
  INDICATOR_DEFINITIONS,
  type MatchDetailResponse,
  type PriceContextPoint,
  type SimilarityMatch,
} from '../../types/signalAnalysis';

interface SignalPriceMatchesChartProps {
  overviewSeries: PriceContextPoint[];
  matches: SimilarityMatch[];
  targetTimestampMs: number;
  targetClose: number;
  selectedMatchRank: number | null;
  selectedMatchDetail: MatchDetailResponse | null;
  loadingMatchDetail: boolean;
  onSelectMatch: (match: SimilarityMatch) => void;
}

function formatUtcShort(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
}

function formatDateYmd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export const SignalPriceMatchesChart: React.FC<SignalPriceMatchesChartProps> = ({
  overviewSeries,
  matches,
  targetTimestampMs,
  targetClose,
  selectedMatchRank,
  selectedMatchDetail,
  loadingMatchDetail,
  onSelectMatch,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const width = 960;
  const height = 310;
  const pad = { top: 20, right: 64, bottom: 32, left: 16 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const chartModel = useMemo(() => {
    if (overviewSeries.length < 2) return null;
    const minT = overviewSeries[0].openTimeMs;
    const maxT = Math.max(overviewSeries[overviewSeries.length - 1].openTimeMs, targetTimestampMs);
    const spanT = Math.max(1, maxT - minT);

    let minP = Infinity;
    let maxP = -Infinity;
    for (const pt of overviewSeries) {
      if (pt.low < minP) minP = pt.low;
      if (pt.high > maxP) maxP = pt.high;
    }
    minP = Math.max(1, minP * 0.94);
    maxP = maxP * 1.06;
    const logMin = Math.log10(minP);
    const logMax = Math.log10(maxP);
    const logSpan = Math.max(1e-6, logMax - logMin);

    const xOf = (ms: number) => pad.left + ((ms - minT) / spanT) * innerW;
    const yOf = (price: number) => {
      const lp = Math.log10(Math.max(1, price));
      return pad.top + innerH - ((lp - logMin) / logSpan) * innerH;
    };

    const linePath = overviewSeries
      .map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(pt.openTimeMs).toFixed(1)},${yOf(pt.close).toFixed(1)}`)
      .join(' ');

    // Y ticks
    const yTicks: number[] = [];
    const tickCount = 5;
    for (let i = 0; i < tickCount; i++) {
      const lp = logMin + (i / (tickCount - 1)) * logSpan;
      yTicks.push(Math.pow(10, lp));
    }

    // X year ticks
    const xTicks: Array<{ ms: number; label: string }> = [];
    const startYear = new Date(minT).getUTCFullYear();
    const endYear = new Date(maxT).getUTCFullYear();
    for (let yr = startYear; yr <= endYear; yr++) {
      const ms = Date.UTC(yr, 0, 1);
      if (ms >= minT && ms <= maxT) {
        xTicks.push({ ms, label: String(yr) });
      }
    }

    return { minT, maxT, spanT, xOf, yOf, linePath, yTicks, xTicks };
  }, [overviewSeries, targetTimestampMs, innerW, innerH, pad.left, pad.top]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || !chartModel || overviewSeries.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * width;
    const tRatio = Math.max(0, Math.min(1, (svgX - pad.left) / innerW));
    const targetMs = chartModel.minT + tRatio * chartModel.spanT;

    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < overviewSeries.length; i++) {
      const d = Math.abs(overviewSeries[i].openTimeMs - targetMs);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = i;
      }
    }
    setHoverIdx(bestIdx);
  };

  // Trajectory mini-chart geometry for selected match (-1h to +24h)
  const trajModel = useMemo(() => {
    if (!selectedMatchDetail || selectedMatchDetail.contextSeries.length < 2) return null;
    const pts = selectedMatchDetail.contextSeries;
    const w = 440;
    const h = 190;
    const p = { top: 16, right: 44, bottom: 26, left: 12 };
    const iw = w - p.left - p.right;
    const ih = h - p.top - p.bottom;

    const minOff = pts[0].offsetBars;
    const maxOff = pts[pts.length - 1].offsetBars;
    const spanOff = Math.max(1, maxOff - minOff);

    let minR = -0.5;
    let maxR = 0.5;
    for (const pt of pts) {
      if (pt.returnFromMatchPct < minR) minR = pt.returnFromMatchPct;
      if (pt.returnFromMatchPct > maxR) maxR = pt.returnFromMatchPct;
    }
    const padR = Math.max(0.25, (maxR - minR) * 0.12);
    minR -= padR;
    maxR += padR;
    const spanR = maxR - minR;

    const xOf = (off: number) => p.left + ((off - minOff) / spanOff) * iw;
    const yOf = (r: number) => p.top + ih - ((r - minR) / spanR) * ih;
    const path = pts
      .map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(pt.offsetBars).toFixed(1)},${yOf(pt.returnFromMatchPct).toFixed(1)}`)
      .join(' ');

    return { w, h, p, iw, ih, xOf, yOf, path, zeroX: xOf(0), zeroY: yOf(0), minR, maxR, pts };
  }, [selectedMatchDetail]);

  const hoverPoint = hoverIdx !== null ? overviewSeries[hoverIdx] : null;

  return (
    <section
      id="similarity-price-map"
      className="mx-auto w-full max-w-[1440px] px-5 py-6 border-b border-slate-800/80"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-100">
            4년 BTCUSDT 5분봉 히스토리 및 유사 구간 매치 분포
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            중복 제거된 독립 유사 시점({matches.length}건 표시)을 가격 차트 위 마커로 표시합니다. 마커를 클릭하면 해당 시점의 지표 벡터와 이후 24시간 가격 궤적을 확인할 수 있습니다.
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            24h 수익 (+)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-rose-400" />
            24h 수익 (-)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-amber-300 bg-amber-400/30" />
            선택 매치
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-0.5 bg-sky-400" />
            기준 시점
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Main 4-Year Price & Match Location SVG */}
        <div className="xl:col-span-8 rounded-lg border border-slate-800 bg-[#0C121E] p-3">
          {chartModel ? (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-auto select-none cursor-crosshair"
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setHoverIdx(null)}
            >
              {/* Horizontal log grid */}
              {chartModel.yTicks.map((val, idx) => {
                const y = chartModel.yOf(val);
                return (
                  <g key={idx}>
                    <line
                      x1={pad.left}
                      x2={width - pad.right}
                      y1={y}
                      y2={y}
                      stroke="#1E293B"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={width - pad.right + 6}
                      y={y + 3}
                      fill="#64748B"
                      fontSize="10"
                      className="font-mono-tabular"
                    >
                      ${Math.round(val).toLocaleString()}
                    </text>
                  </g>
                );
              })}

              {/* Vertical year markers */}
              {chartModel.xTicks.map((t) => {
                const x = chartModel.xOf(t.ms);
                return (
                  <g key={t.label}>
                    <line
                      x1={x}
                      x2={x}
                      y1={pad.top}
                      y2={height - pad.bottom}
                      stroke="#1E293B"
                      strokeOpacity="0.6"
                    />
                    <text
                      x={x}
                      y={height - 10}
                      textAnchor="middle"
                      fill="#64748B"
                      fontSize="10"
                      className="font-mono-tabular"
                    >
                      {t.label}
                    </text>
                  </g>
                );
              })}

              {/* BTC Price Path */}
              <path
                d={chartModel.linePath}
                fill="none"
                stroke="#64748B"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />

              {/* Target timestamp vertical & marker */}
              <line
                x1={chartModel.xOf(targetTimestampMs)}
                x2={chartModel.xOf(targetTimestampMs)}
                y1={pad.top}
                y2={height - pad.bottom}
                stroke="#38BDF8"
                strokeWidth="1.2"
                strokeDasharray="4 3"
              />
              <circle
                cx={chartModel.xOf(targetTimestampMs)}
                cy={chartModel.yOf(targetClose)}
                r={5}
                fill="#38BDF8"
                stroke="#090D16"
                strokeWidth="1.5"
              />

              {/* Matched Historical Timestamps */}
              {matches.map((m) => {
                const cx = chartModel.xOf(m.openTimeMs);
                const cy = chartModel.yOf(m.closePrice);
                const ret24 = m.forwardReturnsPct['24h'];
                const isSelected = m.matchRank === selectedMatchRank;
                const fill =
                  ret24 === null
                    ? '#94A3B8'
                    : ret24 >= 0
                      ? '#10B981'
                      : '#F43F5E';

                return (
                  <g
                    key={m.index}
                    className="cursor-pointer"
                    onClick={() => onSelectMatch(m)}
                  >
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isSelected ? 7.5 : 4}
                      fill={fill}
                      fillOpacity={isSelected ? 0.95 : 0.72}
                      stroke={isSelected ? '#FCD34D' : '#090D16'}
                      strokeWidth={isSelected ? 2 : 1}
                    />
                  </g>
                );
              })}

              {/* Hover crosshair */}
              {hoverPoint && (
                <g pointerEvents="none">
                  <line
                    x1={chartModel.xOf(hoverPoint.openTimeMs)}
                    x2={chartModel.xOf(hoverPoint.openTimeMs)}
                    y1={pad.top}
                    y2={height - pad.bottom}
                    stroke="#94A3B8"
                    strokeWidth="0.9"
                    strokeDasharray="2 2"
                  />
                  <rect
                    x={Math.min(width - 210, Math.max(pad.left + 8, chartModel.xOf(hoverPoint.openTimeMs) + 8))}
                    y={pad.top + 6}
                    width={194}
                    height={36}
                    rx={4}
                    fill="#090D16"
                    fillOpacity="0.92"
                    stroke="#334155"
                  />
                  <text
                    x={Math.min(width - 202, Math.max(pad.left + 16, chartModel.xOf(hoverPoint.openTimeMs) + 16))}
                    y={pad.top + 21}
                    fill="#94A3B8"
                    fontSize="10"
                    className="font-mono-tabular"
                  >
                    {formatDateYmd(hoverPoint.openTimeMs)} UTC
                  </text>
                  <text
                    x={Math.min(width - 202, Math.max(pad.left + 16, chartModel.xOf(hoverPoint.openTimeMs) + 16))}
                    y={pad.top + 35}
                    fill="#F8FAFC"
                    fontSize="11"
                    fontWeight="600"
                    className="font-mono-tabular"
                  >
                    BTC ${hoverPoint.close.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </text>
                </g>
              )}
            </svg>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-xs text-slate-500">
              가격 시계열 데이터가 없습니다.
            </div>
          )}
        </div>

        {/* Selected Match Post-Event Trajectory & Indicator Comparison */}
        <div className="xl:col-span-4 rounded-lg border border-slate-800 bg-[#0C121E] p-4 flex flex-col justify-between">
          {loadingMatchDetail ? (
            <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
              선택된 유사 구간 궤적을 불러오는 중...
            </div>
          ) : selectedMatchDetail && trajModel ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                <div>
                  <div className="text-[11px] font-medium text-amber-300">
                    매치 #{selectedMatchRank} 상세 궤적 (-1h ~ +24h)
                  </div>
                  <div className="font-mono-tabular text-xs font-semibold text-slate-100 mt-0.5">
                    {formatUtcShort(selectedMatchDetail.openTimeMs)} UTC
                  </div>
                </div>
                <div className="text-right font-mono-tabular text-xs">
                  <div className="text-slate-100 font-semibold">
                    ${selectedMatchDetail.closePrice.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {selectedMatchDetail.regimeLabel} · d={selectedMatchDetail.mahalanobisDistance.toFixed(2)}
                  </div>
                </div>
              </div>

              <svg viewBox={`0 0 ${trajModel.w} ${trajModel.h}`} className="w-full h-auto">
                {/* 0% return line */}
                <line
                  x1={trajModel.p.left}
                  x2={trajModel.w - trajModel.p.right}
                  y1={trajModel.zeroY}
                  y2={trajModel.zeroY}
                  stroke="#334155"
                  strokeDasharray="3 3"
                />
                {/* Event trigger time (offset=0) */}
                <line
                  x1={trajModel.zeroX}
                  x2={trajModel.zeroX}
                  y1={trajModel.p.top}
                  y2={trajModel.h - trajModel.p.bottom}
                  stroke="#F59E0B"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <text
                  x={trajModel.zeroX}
                  y={trajModel.h - 8}
                  textAnchor="middle"
                  fill="#F59E0B"
                  fontSize="9.5"
                  className="font-mono-tabular"
                >
                  0h (매치)
                </text>
                <text
                  x={trajModel.w - trajModel.p.right}
                  y={trajModel.h - 8}
                  textAnchor="end"
                  fill="#64748B"
                  fontSize="9.5"
                  className="font-mono-tabular"
                >
                  +24h
                </text>

                {[trajModel.maxR, 0, trajModel.minR].map((val, i) => (
                  <text
                    key={i}
                    x={trajModel.w - trajModel.p.right + 5}
                    y={trajModel.yOf(val) + 3}
                    fill="#64748B"
                    fontSize="9.5"
                    className="font-mono-tabular"
                  >
                    {val >= 0 ? '+' : ''}
                    {val.toFixed(1)}%
                  </text>
                ))}

                <path
                  d={trajModel.path}
                  fill="none"
                  stroke={
                    (selectedMatchDetail.forwardReturnsPct['24h'] ?? 0) >= 0 ? '#10B981' : '#F43F5E'
                  }
                  strokeWidth="1.75"
                  strokeLinejoin="round"
                />
              </svg>

              {/* Horizon Returns Mini Strip */}
              <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-slate-800/80 text-[11px] font-mono-tabular">
                {(['30m', '1h', '3h', '6h', '12h', '24h'] as const).map((hk) => {
                  const v = selectedMatchDetail.forwardReturnsPct[hk];
                  return (
                    <div
                      key={hk}
                      className="flex items-center justify-between rounded bg-[#090D16] px-2 py-1 border border-slate-800/70"
                    >
                      <span className="text-slate-400">{hk}</span>
                      <span
                        className={
                          v === null
                            ? 'text-slate-500'
                            : v >= 0
                              ? 'text-emerald-400 font-medium'
                              : 'text-rose-400 font-medium'
                        }
                      >
                        {v === null ? 'N/A' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Quick 8-Indicator raw summary */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1 text-[11px]">
                {selectedMatchDetail.indicators.map((ind) => (
                  <div key={ind.id} className="flex items-center justify-between text-slate-400">
                    <span>{INDICATOR_DEFINITIONS[ind.id].shortLabel}</span>
                    <span className="font-mono-tabular text-slate-200">
                      {ind.rawValue === null ? 'N/A' : ind.rawValue.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-slate-500 text-center px-3">
              차트 또는 매치 표에서 유사 구간을 선택하면 해당 시점의 지표 상태와 이후 24h 가격 경로가 표시됩니다.
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
