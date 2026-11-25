import React from 'react';
import type { StrategyBacktestResponse } from '../../types/strategyBacktest';

interface PerformanceOverviewProps {
  result: StrategyBacktestResponse;
}

function fmtSignedPct(v: number | null, digits = 2): string {
  if (v === null || !Number.isFinite(v)) return 'N/A';
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

function fmtUsd(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return 'N/A';
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const PerformanceOverview: React.FC<PerformanceOverviewProps> = ({ result }) => {
  const { performance: p, risk: r, validation: v, dataSpan } = result;

  const kpis = [
    {
      label: '총 수익률 (순손익)',
      value: fmtSignedPct(p.totalReturnPct),
      sub: `${fmtUsd(p.netProfitUsd)} · CAGR ${fmtSignedPct(p.annualizedReturnPct)}`,
      tone: p.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400',
    },
    {
      label: 'Profit Factor',
      value: p.profitFactorDisplay,
      sub: `평균 손익비 ${p.payoffRatio !== null ? p.payoffRatio.toFixed(2) : 'N/A'}`,
      tone:
        p.profitFactor !== null && p.profitFactor >= 1.2
          ? 'text-emerald-400'
          : p.profitFactor !== null && p.profitFactor >= 1
            ? 'text-sky-300'
            : 'text-rose-400',
    },
    {
      label: '승률 (Win Rate)',
      value: p.winRatePct !== null ? `${p.winRatePct.toFixed(1)}%` : 'N/A',
      sub: `${p.winningTrades}승 / ${p.losingTrades}패`,
      tone: 'text-slate-100',
    },
    {
      label: 'Expectancy (증거금 대비)',
      value: fmtSignedPct(p.expectancyPct, 3),
      sub: `거래당 평균 ${fmtUsd(p.expectancyUsd)}`,
      tone:
        p.expectancyPct === null
          ? 'text-slate-400'
          : p.expectancyPct >= 0
            ? 'text-emerald-400'
            : 'text-rose-400',
    },
    {
      label: '최대 낙폭 (MDD)',
      value: `-${r.maxDrawdownPct.toFixed(2)}%`,
      sub: `-$${r.maxDrawdownUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} · 최장 ${r.maxConsecutiveLosses}연패`,
      tone: 'text-rose-400',
    },
    {
      label: '총 거래 횟수',
      value: `${p.totalTrades.toLocaleString()}회`,
      sub: `스윙 ${dataSpan.pivotsDetectedCount.toLocaleString()}개 · 보유 중 무시 ${dataSpan.signalsIgnoredWhileInPosition.toLocaleString()}회`,
      tone: 'text-slate-100',
    },
    {
      label: 'Sharpe / Sortino',
      value: r.sharpeRatio !== null ? r.sharpeRatio.toFixed(2) : 'N/A',
      sub: `Sortino ${r.sortinoRatio !== null ? r.sortinoRatio.toFixed(2) : 'N/A'} · 평균보유 ${
        r.avgHoldingMinutes !== null ? `${r.avgHoldingMinutes.toFixed(0)}분` : 'N/A'
      }`,
      tone:
        r.sharpeRatio !== null && r.sharpeRatio >= 1
          ? 'text-emerald-400'
          : r.sharpeRatio !== null && r.sharpeRatio >= 0
            ? 'text-sky-300'
            : 'text-rose-400',
    },
  ];

  return (
    <section
      id="strategy-performance"
      className="mx-auto w-full max-w-[1440px] px-5 py-6 border-b border-slate-800/80 space-y-5"
    >
      {/* Top KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-slate-800 bg-[#0C121E] p-3.5">
            <div className="text-[11px] font-medium text-slate-400 truncate">{k.label}</div>
            <div className={`mt-1.5 font-mono-tabular text-lg font-semibold ${k.tone}`}>
              {k.value}
            </div>
            <div className="mt-1 text-[10.5px] font-mono-tabular text-slate-500 truncate" title={k.sub}>
              {k.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Statistical Validation, Costs & In-Sample vs Out-of-Sample Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
        {/* Statistical Inference & Cost Breakdown */}
        <div className="lg:col-span-6 rounded-lg border border-slate-800 bg-[#0C121E] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xs font-semibold text-slate-100">
              기대수익 통계적 신뢰구간 및 거래 비용 검증
            </h2>
            <span
              className={`text-[11px] font-medium ${
                !v.isSampleSufficient
                  ? 'text-amber-300'
                  : v.blockBootstrapCi95LowPct !== null && v.blockBootstrapCi95LowPct > 0
                    ? 'text-emerald-400'
                    : 'text-slate-400'
              }`}
            >
              {v.reliabilityLabel}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1 font-mono-tabular">
            <div>
              <div className="font-sans text-[11px] text-slate-400">Expectancy 95% CI (모수)</div>
              <div className="text-slate-200 mt-0.5">
                {v.parametricCi95LowPct !== null && v.parametricCi95HighPct !== null
                  ? `[${fmtSignedPct(v.parametricCi95LowPct, 3)}, ${fmtSignedPct(v.parametricCi95HighPct, 3)}]`
                  : 'N/A'}
              </div>
            </div>
            <div>
              <div className="font-sans text-[11px] text-slate-400">
                Block Bootstrap CI (블록={v.bootstrapBlockLength})
              </div>
              <div className="text-sky-300 mt-0.5">
                {v.blockBootstrapCi95LowPct !== null && v.blockBootstrapCi95HighPct !== null
                  ? `[${fmtSignedPct(v.blockBootstrapCi95LowPct, 3)}, ${fmtSignedPct(v.blockBootstrapCi95HighPct, 3)}]`
                  : 'N/A'}
              </div>
            </div>
            <div>
              <div className="font-sans text-[11px] text-slate-400">평균 이익 / 평균 손실</div>
              <div className="text-slate-200 mt-0.5">
                <span className="text-emerald-400">{fmtSignedPct(p.avgWinPct, 2)}</span>
                <span className="text-slate-500"> / </span>
                <span className="text-rose-400">{fmtSignedPct(p.avgLossPct, 2)}</span>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 font-mono-tabular">
            <span>
              누적 수수료 ${p.totalFeesPaidUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} · 누적 슬리피지 $
              {p.totalSlippagePaidUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            <span className={result.reconciliationOk ? 'text-emerald-400' : 'text-rose-400'}>
              원장 정합성 {result.reconciliationOk ? '일치' : '불일치'} (오차 ${result.reconciliationDiffUsd.toFixed(4)})
            </span>
          </div>
        </div>

        {/* In-Sample vs Out-of-Sample Comparison */}
        <div className="lg:col-span-6 rounded-lg border border-slate-800 bg-[#0C121E] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xs font-semibold text-slate-100">
              학습 구간 (전반 60%) vs 검증 구간 (후반 40%) 성과 비교
            </h2>
            <span className="text-[11px] text-slate-500">{r.annualizationNote.slice(0, 32)}...</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono-tabular">
            {[v.inSample, v.outOfSample].map((seg) => (
              <div
                key={seg.label}
                className="rounded border border-slate-800 bg-[#090D16] p-3 space-y-1"
              >
                <div className="font-sans text-[11px] font-medium text-slate-300">{seg.label}</div>
                <div className="flex items-baseline justify-between">
                  <span
                    className={`text-sm font-semibold ${
                      seg.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {fmtSignedPct(seg.totalReturnPct, 2)}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {seg.trades.toLocaleString()}건 · PF {seg.profitFactorDisplay}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">
                  승률 {seg.winRatePct !== null ? `${seg.winRatePct.toFixed(1)}%` : 'N/A'} · Expectancy{' '}
                  {fmtSignedPct(seg.expectancyPct, 3)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
