import React, { useMemo, useRef, useState } from 'react';
import type { EquityPoint } from '../../types/strategyBacktest';

interface DrawdownChartProps {
  equityCurve: EquityPoint[];
  initialCapitalUsd: number;
  maxDrawdownPct: number;
}

export const DrawdownChart: React.FC<DrawdownChartProps> = ({
  equityCurve,
  initialCapitalUsd,
  maxDrawdownPct,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const width = 1120;
  const height = 340;
  const pad = { top: 20, right: 64, bottom: 26, left: 16 };
  const eqH = 185;
  const gapY = 26;
  const ddTop = pad.top + eqH + gapY;
  const ddH = height - ddTop - pad.bottom;
  const innerW = width - pad.left - pad.right;

  const model = useMemo(() => {
    if (equityCurve.length < 2) return null;

    const minT = equityCurve[0].timestampMs;
    const maxT = equityCurve[equityCurve.length - 1].timestampMs;
    const spanT = Math.max(1, maxT - minT);

    let minEq = initialCapitalUsd;
    let maxEq = initialCapitalUsd;
    let minDd = -Math.max(5, maxDrawdownPct);

    for (const pt of equityCurve) {
      if (pt.equityUsd < minEq) minEq = pt.equityUsd;
      if (pt.equityUsd > maxEq) maxEq = pt.equityUsd;
      if (pt.drawdownPct < minDd) minDd = pt.drawdownPct;
    }

    const eqPad = Math.max(initialCapitalUsd * 0.05, (maxEq - minEq) * 0.1);
    minEq = Math.max(0, minEq - eqPad);
    maxEq += eqPad;
    const spanEq = Math.max(1, maxEq - minEq);
    const spanDd = Math.max(1, -minDd);

    const xOf = (t: number) => pad.left + ((t - minT) / spanT) * innerW;
    const yEq = (eq: number) => pad.top + eqH - ((eq - minEq) / spanEq) * eqH;
    const yDd = (dd: number) => ddTop + (Math.abs(dd) / spanDd) * ddH;

    const eqPath = equityCurve
      .map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(pt.timestampMs).toFixed(1)},${yEq(pt.equityUsd).toFixed(1)}`)
      .join(' ');

    const ddLinePath = equityCurve
      .map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(pt.timestampMs).toFixed(1)},${yDd(pt.drawdownPct).toFixed(1)}`)
      .join(' ');

    const ddAreaPath = `${ddLinePath} L${xOf(maxT).toFixed(1)},${ddTop.toFixed(1)} L${xOf(minT).toFixed(1)},${ddTop.toFixed(1)} Z`;

    const eqTicks = [minEq, (minEq + maxEq) * 0.5, maxEq];
    const ddTicks = [0, minDd * 0.5, minDd];

    const yearTicks: Array<{ ms: number; label: string }> = [];
    const y0 = new Date(minT).getUTCFullYear();
    const y1 = new Date(maxT).getUTCFullYear();
    for (let yr = y0; yr <= y1; yr++) {
      const ms = Date.UTC(yr, 0, 1);
      if (ms >= minT && ms <= maxT) yearTicks.push({ ms, label: String(yr) });
    }

    return {
      minT,
      spanT,
      xOf,
      yEq,
      yDd,
      eqPath,
      ddLinePath,
      ddAreaPath,
      eqTicks,
      ddTicks,
      yearTicks,
      baseLineY: yEq(initialCapitalUsd),
    };
  }, [equityCurve, initialCapitalUsd, maxDrawdownPct, innerW, ddTop, ddH, pad.left, pad.top]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || !model || equityCurve.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * width;
    const ratio = Math.max(0, Math.min(1, (svgX - pad.left) / innerW));
    const targetMs = model.minT + ratio * model.spanT;

    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < equityCurve.length; i++) {
      const d = Math.abs(equityCurve[i].timestampMs - targetMs);
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    }
    setHoverIdx(best);
  };

  const hoverPt = hoverIdx !== null ? equityCurve[hoverIdx] : null;
  const lastPt = equityCurve[equityCurve.length - 1];
  const isOverallPositive = (lastPt?.equityUsd ?? initialCapitalUsd) >= initialCapitalUsd;

  return (
    <section
      id="strategy-equity-drawdown"
      className="mx-auto w-full max-w-[1440px] px-5 py-6 border-b border-slate-800/80 space-y-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-100">
            포트폴리오 자산 곡선 (Equity Curve) 및 낙폭 (Drawdown)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            수수료·슬리피지 차감 후 순자산 추이(상단)와 최고점 대비 낙폭 비율(하단)을 동기화하여 표시합니다.
          </p>
        </div>
        {hoverPt && (
          <div className="flex flex-wrap items-center gap-4 text-xs font-mono-tabular text-slate-300">
            <span>{new Date(hoverPt.timestampMs).toISOString().slice(0, 16).replace('T', ' ')} UTC</span>
            <span className="text-slate-100 font-semibold">
              자산 ${hoverPt.equityUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            <span className="text-rose-400">DD {hoverPt.drawdownPct.toFixed(2)}%</span>
            <span className="text-slate-400">
              BTC ${hoverPt.btcClose.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </span>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-800 bg-[#0C121E] p-3">
        {model ? (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto select-none cursor-crosshair"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverIdx(null)}
          >
            {/* Equity grid */}
            {model.eqTicks.map((val, idx) => {
              const y = model.yEq(val);
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

            {/* Initial capital baseline */}
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={model.baseLineY}
              y2={model.baseLineY}
              stroke="#475569"
              strokeDasharray="4 3"
            />

            {/* Equity path */}
            <path
              d={model.eqPath}
              fill="none"
              stroke={isOverallPositive ? '#10B981' : '#38BDF8'}
              strokeWidth="1.7"
              strokeLinejoin="round"
            />

            {/* Divider & Drawdown label */}
            <text x={pad.left} y={ddTop - 8} fill="#94A3B8" fontSize="10.5" fontWeight="600">
              Drawdown (%)
            </text>

            {/* Drawdown grid */}
            {model.ddTicks.map((val, idx) => {
              const y = model.yDd(val);
              return (
                <g key={idx}>
                  <line
                    x1={pad.left}
                    x2={width - pad.right}
                    y1={y}
                    y2={y}
                    stroke="#1E293B"
                    strokeDasharray={val === 0 ? undefined : '3 3'}
                  />
                  <text
                    x={width - pad.right + 6}
                    y={y + 3}
                    fill="#64748B"
                    fontSize="10"
                    className="font-mono-tabular"
                  >
                    {val.toFixed(1)}%
                  </text>
                </g>
              );
            })}

            {/* Drawdown area & line */}
            <path d={model.ddAreaPath} fill="#F43F5E" fillOpacity={0.18} />
            <path d={model.ddLinePath} fill="none" stroke="#F43F5E" strokeWidth="1.2" />

            {/* Year axis ticks */}
            {model.yearTicks.map((yt) => {
              const x = model.xOf(yt.ms);
              return (
                <g key={yt.label}>
                  <line x1={x} x2={x} y1={pad.top} y2={height - pad.bottom} stroke="#1E293B" strokeOpacity={0.5} />
                  <text
                    x={x}
                    y={height - 7}
                    textAnchor="middle"
                    fill="#64748B"
                    fontSize="10"
                    className="font-mono-tabular"
                  >
                    {yt.label}
                  </text>
                </g>
              );
            })}

            {/* Synchronized Hover Crosshair */}
            {hoverPt && (
              <g pointerEvents="none">
                <line
                  x1={model.xOf(hoverPt.timestampMs)}
                  x2={model.xOf(hoverPt.timestampMs)}
                  y1={pad.top}
                  y2={height - pad.bottom}
                  stroke="#94A3B8"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
                <circle
                  cx={model.xOf(hoverPt.timestampMs)}
                  cy={model.yEq(hoverPt.equityUsd)}
                  r={4}
                  fill="#38BDF8"
                  stroke="#090D16"
                  strokeWidth="1.5"
                />
                <circle
                  cx={model.xOf(hoverPt.timestampMs)}
                  cy={model.yDd(hoverPt.drawdownPct)}
                  r={3.5}
                  fill="#F43F5E"
                  stroke="#090D16"
                  strokeWidth="1.2"
                />
              </g>
            )}
          </svg>
        ) : (
          <div className="h-[260px] flex items-center justify-center text-xs text-slate-500">
            자산 곡선 데이터가 없습니다.
          </div>
        )}
      </div>
    </section>
  );
};
