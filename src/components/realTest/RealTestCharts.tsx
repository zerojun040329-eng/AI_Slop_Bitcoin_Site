import React, { useMemo, useState } from 'react';
import type { HalvingCycleBacktest } from '../../types/realTest';

function formatUsdShort(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatUsdExact(v: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2,
  }).format(v);
}

/* --------------------------------------------------------------------------
 * Strategy 1 Chart A: Cycle BTC Daily Price + DCA Window & Option Markers
 * -------------------------------------------------------------------------- */
export const SpotDcaPriceWindowChart: React.FC<{ cycle: HalvingCycleBacktest }> = ({ cycle }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const { schedule, spotDca, putOption, priceContextSeries } = cycle;

  const width = 760;
  const height = 270;
  const pad = { top: 24, right: 20, bottom: 32, left: 66 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const { minP, maxP, dcaStartIdx, dcaEndIdx, optEntryIdx, optExpiryIdx } = useMemo(() => {
    if (priceContextSeries.length === 0) {
      return { minP: 0, maxP: 1, dcaStartIdx: -1, dcaEndIdx: -1, optEntryIdx: -1, optExpiryIdx: -1 };
    }
    let lo = Infinity;
    let hi = -Infinity;
    let ds = -1;
    let de = -1;
    let oe = -1;
    let ox = -1;

    for (let i = 0; i < priceContextSeries.length; i++) {
      const r = priceContextSeries[i];
      if (r.priceUsd < lo) lo = r.priceUsd;
      if (r.priceUsd > hi) hi = r.priceUsd;
      if (ds === -1 && r.date >= schedule.dcaStartDate) ds = i;
      if (r.date <= schedule.dcaLastScheduledBuyDate) de = i;
      if (oe === -1 && r.date >= schedule.optionEntryDate) oe = i;
      if (ox === -1 && r.date >= schedule.optionExpiryDate) ox = i;
    }

    if (spotDca.averageEntryPriceUsd && spotDca.averageEntryPriceUsd > 0) {
      lo = Math.min(lo, spotDca.averageEntryPriceUsd);
      hi = Math.max(hi, spotDca.averageEntryPriceUsd);
    }

    const span = Math.max(hi - lo, lo * 0.1, 1);
    return {
      minP: Math.max(0, lo - span * 0.08),
      maxP: hi + span * 0.1,
      dcaStartIdx: ds,
      dcaEndIdx: de,
      optEntryIdx: oe,
      optExpiryIdx: ox,
    };
  }, [priceContextSeries, schedule, spotDca.averageEntryPriceUsd]);

  if (priceContextSeries.length < 2) {
    return (
      <div className="h-[270px] flex items-center justify-center text-xs text-slate-500">
        표시할 사이클 일봉 데이터가 부족합니다.
      </div>
    );
  }

  const xOf = (idx: number) =>
    pad.left + (idx / Math.max(1, priceContextSeries.length - 1)) * plotW;
  const yOf = (p: number) =>
    pad.top + plotH - ((p - minP) / Math.max(1e-9, maxP - minP)) * plotH;

  const linePath = priceContextSeries
    .map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${xOf(idx).toFixed(1)},${yOf(pt.priceUsd).toFixed(1)}`)
    .join(' ');

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => minP + (maxP - minP) * t);
  const activePoint = hoverIdx !== null ? priceContextSeries[hoverIdx] : null;
  const avgY =
    spotDca.averageEntryPriceUsd !== null ? yOf(spotDca.averageEntryPriceUsd) : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto select-none"
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * width;
          const t = Math.max(0, Math.min(1, (relX - pad.left) / plotW));
          const idx = Math.round(t * (priceContextSeries.length - 1));
          setHoverIdx(idx);
        }}
      >
        {/* DCA Buy Window Shading (+24M ~ +36M) */}
        {dcaStartIdx >= 0 && dcaEndIdx >= dcaStartIdx && (
          <rect
            x={xOf(dcaStartIdx)}
            y={pad.top}
            width={Math.max(2, xOf(dcaEndIdx) - xOf(dcaStartIdx))}
            height={plotH}
            fill="#0EA5E9"
            fillOpacity={0.09}
          />
        )}

        {/* Horizontal grid */}
        {yTicks.map((tick, i) => {
          const y = yOf(tick);
          return (
            <g key={i}>
              <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke="#1E293B" strokeWidth={1} />
              <text
                x={pad.left - 8}
                y={y + 3.5}
                textAnchor="end"
                className="fill-slate-500 text-[10px] font-mono-tabular"
              >
                {formatUsdShort(tick)}
              </text>
            </g>
          );
        })}

        {/* Average Entry Price Reference Line */}
        {avgY !== null && avgY >= pad.top && avgY <= pad.top + plotH && (
          <g>
            <line
              x1={pad.left}
              y1={avgY}
              x2={width - pad.right}
              y2={avgY}
              stroke="#38BDF8"
              strokeWidth={1.2}
              strokeDasharray="4 4"
            />
            <text
              x={width - pad.right - 4}
              y={avgY - 5}
              textAnchor="end"
              className="fill-sky-300 text-[10px] font-mono-tabular"
            >
              평균 단가 {formatUsdExact(spotDca.averageEntryPriceUsd!)}
            </text>
          </g>
        )}

        {/* Option Entry (+18M) & Expiry (+30M) vertical markers */}
        {optEntryIdx >= 0 && (
          <g>
            <line
              x1={xOf(optEntryIdx)}
              y1={pad.top}
              x2={xOf(optEntryIdx)}
              y2={pad.top + plotH}
              stroke="#F59E0B"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text
              x={xOf(optEntryIdx) + 4}
              y={pad.top + 12}
              className="fill-amber-400 text-[10px] font-mono-tabular"
            >
              +18M 옵션진입
            </text>
          </g>
        )}

        {optExpiryIdx >= 0 && putOption.status === 'completed' && (
          <g>
            <line
              x1={xOf(optExpiryIdx)}
              y1={pad.top}
              x2={xOf(optExpiryIdx)}
              y2={pad.top + plotH}
              stroke="#A78BFA"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text
              x={xOf(optExpiryIdx) + 4}
              y={pad.top + 24}
              className="fill-violet-300 text-[10px] font-mono-tabular"
            >
              +30M 옵션만기
            </text>
          </g>
        )}

        {/* BTC Daily Close Line */}
        <path d={linePath} fill="none" stroke="#E2E8F0" strokeWidth={1.6} />

        {/* X Axis Date Labels */}
        <text x={pad.left} y={height - 8} className="fill-slate-500 text-[10px] font-mono-tabular">
          {priceContextSeries[0].date} (반감기)
        </text>
        {dcaStartIdx >= 0 && (
          <text
            x={xOf(dcaStartIdx)}
            y={height - 8}
            textAnchor="middle"
            className="fill-sky-400 text-[10px] font-mono-tabular"
          >
            {schedule.dcaStartDate} (+24M 매수개시)
          </text>
        )}
        <text
          x={width - pad.right}
          y={height - 8}
          textAnchor="end"
          className="fill-slate-500 text-[10px] font-mono-tabular"
        >
          {priceContextSeries[priceContextSeries.length - 1].date}
        </text>

        {/* Crosshair */}
        {hoverIdx !== null && activePoint && (
          <g>
            <line
              x1={xOf(hoverIdx)}
              y1={pad.top}
              x2={xOf(hoverIdx)}
              y2={pad.top + plotH}
              stroke="#64748B"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <circle
              cx={xOf(hoverIdx)}
              cy={yOf(activePoint.priceUsd)}
              r={4}
              fill="#38BDF8"
              stroke="#090D16"
              strokeWidth={1.5}
            />
          </g>
        )}
      </svg>

      {activePoint && (
        <div className="mt-1.5 flex flex-wrap items-center justify-between text-[11px] text-slate-400 font-mono-tabular px-1">
          <span>
            일자 <strong className="text-slate-100">{activePoint.date} UTC</strong> · 종가{' '}
            <strong className="text-slate-100">{formatUsdExact(activePoint.priceUsd)}</strong>
          </span>
          <span className="text-sky-400">
            {activePoint.date >= schedule.dcaStartDate && activePoint.date <= schedule.dcaLastScheduledBuyDate
              ? '적립식 매수 구간 (+24~36M)'
              : '매수 대기/사전 구간'}
          </span>
        </div>
      )}
    </div>
  );
};

/* --------------------------------------------------------------------------
 * Strategy 1 Chart B: Cumulative Invested vs Valuation & Cumulative BTC
 * -------------------------------------------------------------------------- */
export const SpotDcaEquityChart: React.FC<{ cycle: HalvingCycleBacktest }> = ({ cycle }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const executions = cycle.spotDca.executions;

  const width = 760;
  const height = 270;
  const pad = { top: 24, right: 64, bottom: 32, left: 66 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const { maxUsd, maxBtc } = useMemo(() => {
    let mu = 1;
    let mb = 0.0001;
    for (const ex of executions) {
      if (ex.cumulativeGrossInvestedUsd > mu) mu = ex.cumulativeGrossInvestedUsd;
      if (ex.portfolioValueUsd > mu) mu = ex.portfolioValueUsd;
      if (ex.cumulativeBtc > mb) mb = ex.cumulativeBtc;
    }
    return { maxUsd: mu * 1.12, maxBtc: mb * 1.12 };
  }, [executions]);

  if (executions.length < 2) {
    return (
      <div className="h-[270px] flex items-center justify-center text-xs text-slate-500">
        아직 누적 매수 체결 내역이 충분하지 않습니다.
      </div>
    );
  }

  const xOf = (idx: number) =>
    pad.left + (idx / Math.max(1, executions.length - 1)) * plotW;
  const yUsd = (v: number) => pad.top + plotH - (v / maxUsd) * plotH;
  const yBtc = (b: number) => pad.top + plotH - (b / maxBtc) * plotH;

  const investedPath = executions
    .map((ex, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yUsd(ex.cumulativeGrossInvestedUsd).toFixed(1)}`)
    .join(' ');
  const valuePath = executions
    .map((ex, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yUsd(ex.portfolioValueUsd).toFixed(1)}`)
    .join(' ');
  const btcPath = executions
    .map((ex, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yBtc(ex.cumulativeBtc).toFixed(1)}`)
    .join(' ');

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const active = hoverIdx !== null ? executions[hoverIdx] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto select-none"
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * width;
          const t = Math.max(0, Math.min(1, (relX - pad.left) / plotW));
          setHoverIdx(Math.round(t * (executions.length - 1)));
        }}
      >
        {ticks.map((t, i) => {
          const usdVal = maxUsd * t;
          const btcVal = maxBtc * t;
          const y = pad.top + plotH - t * plotH;
          return (
            <g key={i}>
              <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke="#1E293B" strokeWidth={1} />
              <text
                x={pad.left - 8}
                y={y + 3.5}
                textAnchor="end"
                className="fill-slate-500 text-[10px] font-mono-tabular"
              >
                {formatUsdShort(usdVal)}
              </text>
              <text
                x={width - pad.right + 8}
                y={y + 3.5}
                textAnchor="start"
                className="fill-amber-400/80 text-[10px] font-mono-tabular"
              >
                {btcVal.toFixed(2)} BTC
              </text>
            </g>
          );
        })}

        <path d={investedPath} fill="none" stroke="#64748B" strokeWidth={1.5} strokeDasharray="4 3" />
        <path d={valuePath} fill="none" stroke="#10B981" strokeWidth={1.8} />
        <path d={btcPath} fill="none" stroke="#F59E0B" strokeWidth={1.5} />

        <text x={pad.left} y={height - 8} className="fill-slate-500 text-[10px] font-mono-tabular">
          {executions[0].date} (1일차)
        </text>
        <text
          x={width - pad.right}
          y={height - 8}
          textAnchor="end"
          className="fill-slate-500 text-[10px] font-mono-tabular"
        >
          {executions[executions.length - 1].date} ({executions.length}일차)
        </text>

        {hoverIdx !== null && active && (
          <g>
            <line
              x1={xOf(hoverIdx)}
              y1={pad.top}
              x2={xOf(hoverIdx)}
              y2={pad.top + plotH}
              stroke="#64748B"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <circle cx={xOf(hoverIdx)} cy={yUsd(active.portfolioValueUsd)} r={3.5} fill="#10B981" />
            <circle cx={xOf(hoverIdx)} cy={yBtc(active.cumulativeBtc)} r={3.5} fill="#F59E0B" />
          </g>
        )}
      </svg>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 font-mono-tabular px-1">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3 bg-emerald-400 inline-block" /> 평가금액
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3 bg-slate-500 inline-block" /> 누적 투자원금
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3 bg-amber-400 inline-block" /> 누적 보유 BTC
          </span>
        </div>
        {active && (
          <span>
            {active.date} · 투자 {formatUsdExact(active.cumulativeGrossInvestedUsd)} · 평가{' '}
            <strong className="text-emerald-300">{formatUsdExact(active.portfolioValueUsd)}</strong> ·{' '}
            <strong className="text-amber-300">{active.cumulativeBtc.toFixed(4)} BTC</strong>
          </span>
        )}
      </div>
    </div>
  );
};

/* --------------------------------------------------------------------------
 * Strategy 2 Chart A: 5-Strike Put Payoff Curve (Expiry BTC Price vs Net P&L)
 * -------------------------------------------------------------------------- */
export const PutPayoffCurveChart: React.FC<{ cycle: HalvingCycleBacktest }> = ({ cycle }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const { putOption } = cycle;
  const curve = putOption.payoffCurve;

  const width = 760;
  const height = 270;
  const pad = { top: 24, right: 24, bottom: 32, left: 68 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const { minP, maxP, minY, maxY } = useMemo(() => {
    if (curve.length === 0) return { minP: 0, maxP: 1, minY: -1, maxY: 1 };
    let loP = curve[0].btcPriceUsd;
    let hiP = curve[curve.length - 1].btcPriceUsd;
    let loY = 0;
    let hiY = 0;
    for (const pt of curve) {
      if (pt.netProfitUsd < loY) loY = pt.netProfitUsd;
      if (pt.netProfitUsd > hiY) hiY = pt.netProfitUsd;
    }
    const padY = Math.max((hiY - loY) * 0.12, 100);
    return { minP: loP, maxP: hiP, minY: loY - padY, maxY: hiY + padY };
  }, [curve]);

  if (curve.length < 2 || putOption.entrySpotUsd === null) {
    return (
      <div className="h-[270px] flex items-center justify-center text-xs text-slate-500">
        {putOption.statusLabel} — 진입일 데이터가 준비되면 Payoff 곡선이 계산됩니다.
      </div>
    );
  }

  const xOf = (price: number) =>
    pad.left + ((price - minP) / Math.max(1e-9, maxP - minP)) * plotW;
  const yOf = (pnl: number) =>
    pad.top + plotH - ((pnl - minY) / Math.max(1e-9, maxY - minY)) * plotH;

  const zeroY = yOf(0);
  const netPath = curve
    .map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(pt.btcPriceUsd).toFixed(1)},${yOf(pt.netProfitUsd).toFixed(1)}`)
    .join(' ');

  const active = hoverIdx !== null ? curve[hoverIdx] : null;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => minY + (maxY - minY) * t);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto select-none"
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * width;
          const targetP = minP + Math.max(0, Math.min(1, (relX - pad.left) / plotW)) * (maxP - minP);
          let best = 0;
          let bestDist = Infinity;
          for (let i = 0; i < curve.length; i++) {
            const d = Math.abs(curve[i].btcPriceUsd - targetP);
            if (d < bestDist) {
              bestDist = d;
              best = i;
            }
          }
          setHoverIdx(best);
        }}
      >
        {yTicks.map((tick, i) => {
          const y = yOf(tick);
          return (
            <g key={i}>
              <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke="#1E293B" strokeWidth={1} />
              <text
                x={pad.left - 8}
                y={y + 3.5}
                textAnchor="end"
                className="fill-slate-500 text-[10px] font-mono-tabular"
              >
                {formatUsdShort(tick)}
              </text>
            </g>
          );
        })}

        {/* Zero P&L Line */}
        {zeroY >= pad.top && zeroY <= pad.top + plotH && (
          <line x1={pad.left} y1={zeroY} x2={width - pad.right} y2={zeroY} stroke="#475569" strokeWidth={1.2} />
        )}

        {/* 5 Strike vertical ticks */}
        {putOption.strikes.map((s) => {
          const sx = xOf(s.strikePriceUsd);
          if (sx < pad.left || sx > width - pad.right) return null;
          return (
            <line
              key={s.strikeIndex}
              x1={sx}
              y1={pad.top}
              x2={sx}
              y2={pad.top + plotH}
              stroke="#334155"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          );
        })}

        {/* Entry Spot S */}
        <line
          x1={xOf(putOption.entrySpotUsd)}
          y1={pad.top}
          x2={xOf(putOption.entrySpotUsd)}
          y2={pad.top + plotH}
          stroke="#F59E0B"
          strokeWidth={1.1}
          strokeDasharray="4 3"
        />
        <text
          x={xOf(putOption.entrySpotUsd) + 4}
          y={pad.top + 12}
          className="fill-amber-400 text-[10px] font-mono-tabular"
        >
          진입 S {formatUsdShort(putOption.entrySpotUsd)}
        </text>

        {/* Actual Expiry Spot ST (only if matured & completed) */}
        {putOption.status === 'completed' &&
          putOption.expirySpotUsd !== null &&
          putOption.netProfitUsd !== null && (
            <g>
              <line
                x1={xOf(putOption.expirySpotUsd)}
                y1={pad.top}
                x2={xOf(putOption.expirySpotUsd)}
                y2={pad.top + plotH}
                stroke={putOption.netProfitUsd >= 0 ? '#10B981' : '#F43F5E'}
                strokeWidth={1.5}
              />
              <circle
                cx={xOf(putOption.expirySpotUsd)}
                cy={yOf(putOption.netProfitUsd)}
                r={5}
                fill={putOption.netProfitUsd >= 0 ? '#10B981' : '#F43F5E'}
                stroke="#090D16"
                strokeWidth={1.5}
              />
              <text
                x={Math.min(width - pad.right - 90, xOf(putOption.expirySpotUsd) + 6)}
                y={pad.top + 25}
                className="fill-slate-100 text-[10px] font-mono-tabular"
              >
                실제 만기 ST {formatUsdShort(putOption.expirySpotUsd)}
              </text>
            </g>
          )}

        {/* Payoff Curve Path */}
        <path d={netPath} fill="none" stroke="#A78BFA" strokeWidth={2} />

        <text x={pad.left} y={height - 8} className="fill-slate-500 text-[10px] font-mono-tabular">
          {formatUsdShort(minP)}
        </text>
        <text
          x={width - pad.right}
          y={height - 8}
          textAnchor="end"
          className="fill-slate-500 text-[10px] font-mono-tabular"
        >
          {formatUsdShort(maxP)} (만기 BTC 가격 가정)
        </text>

        {hoverIdx !== null && active && (
          <g>
            <circle
              cx={xOf(active.btcPriceUsd)}
              cy={yOf(active.netProfitUsd)}
              r={4}
              fill="#C4B5FD"
              stroke="#090D16"
              strokeWidth={1.5}
            />
          </g>
        )}
      </svg>

      {active && (
        <div className="mt-1.5 flex flex-wrap items-center justify-between text-[11px] text-slate-400 font-mono-tabular px-1">
          <span>
            가정 만기가 <strong className="text-slate-100">{formatUsdExact(active.btcPriceUsd)}</strong> · 총 페이오프{' '}
            <strong className="text-slate-200">{formatUsdExact(active.grossPayoffUsd)}</strong>
          </span>
          <span className={active.netProfitUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
            순손익 {active.netProfitUsd >= 0 ? '+' : ''}
            {formatUsdExact(active.netProfitUsd)}
          </span>
        </div>
      )}
    </div>
  );
};

/* --------------------------------------------------------------------------
 * Strategy 2 Chart B: Per-Strike Premium vs Expiry Payoff Bars
 * -------------------------------------------------------------------------- */
export const PutStrikeBarsChart: React.FC<{ cycle: HalvingCycleBacktest }> = ({ cycle }) => {
  const { putOption } = cycle;
  const strikes = putOption.strikes;

  if (strikes.length === 0) {
    return (
      <div className="h-[270px] flex items-center justify-center text-xs text-slate-500">
        {putOption.statusLabel}
      </div>
    );
  }

  const maxVal = Math.max(
    1,
    ...strikes.map((s) => Math.max(s.premiumUsd, s.expiryPayoffUsd ?? 0)),
  );

  return (
    <div className="space-y-3 py-2">
      {strikes.map((s) => {
        const premW = Math.min(100, (s.premiumUsd / maxVal) * 100);
        const payW =
          s.expiryPayoffUsd !== null ? Math.min(100, (s.expiryPayoffUsd / maxVal) * 100) : 0;
        return (
          <div key={s.strikeIndex} className="space-y-1">
            <div className="flex items-center justify-between text-xs font-mono-tabular">
              <span className="text-slate-200 font-medium">
                {s.label}{' '}
                <span className="text-slate-500">({formatUsdExact(s.strikePriceUsd)})</span>
              </span>
              <span className="text-slate-400">
                프리미엄 {formatUsdExact(s.premiumUsd)}
                {s.expiryPayoffUsd !== null && (
                  <>
                    {' '}
                    · 페이오프{' '}
                    <strong className={s.expiryPayoffUsd > s.premiumUsd ? 'text-emerald-400' : 'text-slate-200'}>
                      {formatUsdExact(s.expiryPayoffUsd)}
                    </strong>
                  </>
                )}
              </span>
            </div>
            <div className="space-y-1">
              <div className="h-2 w-full rounded bg-slate-800/80 overflow-hidden">
                <div
                  className="h-full bg-amber-500/80 rounded"
                  style={{ width: `${premW}%` }}
                  title={`프리미엄 ${formatUsdExact(s.premiumUsd)}`}
                />
              </div>
              {s.expiryPayoffUsd !== null ? (
                <div className="h-2 w-full rounded bg-slate-800/80 overflow-hidden">
                  <div
                    className={`h-full rounded ${
                      s.expiryPayoffUsd >= s.premiumUsd ? 'bg-emerald-500' : 'bg-violet-400'
                    }`}
                    style={{ width: `${payW}%` }}
                    title={`만기 페이오프 ${formatUsdExact(s.expiryPayoffUsd)}`}
                  />
                </div>
              ) : (
                <div className="text-[10px] text-slate-500 font-mono-tabular">
                  {putOption.statusLabel} (만기 페이오프 미확정)
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div className="pt-2 flex items-center gap-5 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2.5 rounded-sm bg-amber-500/80 inline-block" /> 지급 프리미엄
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2.5 rounded-sm bg-emerald-500 inline-block" /> 만기 페이오프 (수익)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2.5 rounded-sm bg-violet-400 inline-block" /> 만기 페이오프 (부분 회수)
        </span>
      </div>
    </div>
  );
};

/* --------------------------------------------------------------------------
 * Integrated Comparison Chart: Spot vs Option vs Combined Net Profit by Cycle
 * -------------------------------------------------------------------------- */
export const IntegratedCycleComparisonChart: React.FC<{
  cycles: readonly HalvingCycleBacktest[];
}> = ({ cycles }) => {
  const width = 760;
  const height = 240;
  const pad = { top: 24, right: 24, bottom: 34, left: 72 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  let minV = 0;
  let maxV = 0;
  for (const c of cycles) {
    const vals = [
      c.integrated.spotNetProfitUsd,
      c.integrated.optionNetProfitUsd ?? 0,
      c.integrated.combinedNetProfitUsd ?? c.integrated.spotNetProfitUsd,
    ];
    for (const v of vals) {
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }
  const span = Math.max(maxV - minV, 1000);
  const lo = minV - span * 0.1;
  const hi = maxV + span * 0.12;
  const yOf = (v: number) => pad.top + plotH - ((v - lo) / Math.max(1e-9, hi - lo)) * plotH;
  const zeroY = yOf(0);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => lo + (hi - lo) * t);

  const groupW = plotW / Math.max(1, cycles.length);
  const barW = Math.min(34, groupW * 0.2);

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto select-none">
        {yTicks.map((t, i) => {
          const y = yOf(t);
          return (
            <g key={i}>
              <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke="#1E293B" strokeWidth={1} />
              <text
                x={pad.left - 8}
                y={y + 3.5}
                textAnchor="end"
                className="fill-slate-500 text-[10px] font-mono-tabular"
              >
                {formatUsdShort(t)}
              </text>
            </g>
          );
        })}

        <line x1={pad.left} y1={zeroY} x2={width - pad.right} y2={zeroY} stroke="#475569" strokeWidth={1.2} />

        {cycles.map((c, idx) => {
          const cx = pad.left + groupW * idx + groupW / 2;
          const bars = [
            {
              label: '현물',
              val: c.integrated.spotNetProfitUsd,
              color: '#38BDF8',
              x: cx - barW * 1.6,
            },
            {
              label: '풋옵션',
              val: c.integrated.optionNetProfitUsd,
              color: '#A78BFA',
              x: cx - barW * 0.5,
            },
            {
              label: '통합',
              val: c.integrated.combinedNetProfitUsd,
              color: '#10B981',
              x: cx + barW * 0.6,
            },
          ];

          return (
            <g key={c.schedule.epoch}>
              {bars.map((b) => {
                if (b.val === null) {
                  return (
                    <text
                      key={b.label}
                      x={b.x + barW / 2}
                      y={zeroY - 6}
                      textAnchor="middle"
                      className="fill-slate-500 text-[9px] font-mono-tabular"
                    >
                      미확정
                    </text>
                  );
                }
                const topY = Math.min(zeroY, yOf(b.val));
                const h = Math.max(2, Math.abs(yOf(b.val) - zeroY));
                return (
                  <g key={b.label}>
                    <rect x={b.x} y={topY} width={barW} height={h} rx={2} fill={b.color} fillOpacity={0.85} />
                    <text
                      x={b.x + barW / 2}
                      y={b.val >= 0 ? topY - 5 : topY + h + 11}
                      textAnchor="middle"
                      className="fill-slate-300 text-[9px] font-mono-tabular"
                    >
                      {formatUsdShort(b.val)}
                    </text>
                  </g>
                );
              })}

              <text
                x={cx}
                y={height - 10}
                textAnchor="middle"
                className="fill-slate-300 text-[11px] font-medium"
              >
                {c.schedule.cycleLabel}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1.5 flex flex-wrap items-center gap-5 text-[11px] text-slate-400 px-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-sky-400 inline-block" /> 전략 1: 현물 적립식 순손익
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-violet-400 inline-block" /> 전략 2: 5-행사가 풋옵션 만기 순손익
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-400 inline-block" /> 통합 포트폴리오 순손익 (사후 정규화 수량 Q)
        </span>
      </div>
    </div>
  );
};
