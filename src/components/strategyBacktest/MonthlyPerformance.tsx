import React from 'react';
import type { StrategyBacktestResponse } from '../../types/strategyBacktest';

interface MonthlyPerformanceProps {
  result: StrategyBacktestResponse;
}

export const MonthlyPerformance: React.FC<MonthlyPerformanceProps> = ({ result }) => {
  const { validation, directionBreakdown, regimeBreakdown } = result;
  const { yearlyBreakdown, monthlyReturns } = validation;

  const years = Array.from(new Set(monthlyReturns.map((m) => m.year))).sort((a, b) => a - b);
  const monthMap = new Map<string, (typeof monthlyReturns)[number]>();
  for (const m of monthlyReturns) {
    monthMap.set(`${m.year}-${m.month}`, m);
  }

  return (
    <section
      id="strategy-breakdowns"
      className="mx-auto w-full max-w-[1440px] px-5 py-6 border-b border-slate-800/80 space-y-5"
    >
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Monthly Returns Heatmap (8 cols) */}
        <div className="xl:col-span-8 rounded-lg border border-slate-800 bg-[#0C121E] p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-display text-sm font-semibold text-slate-100">
              월별 수익률 히트맵 (Monthly Returns)
            </h2>
            <span className="text-[11px] text-slate-400">셀 기준: 월초 자산 대비 순수익률 (%)</span>
          </div>

          {years.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              거래 내역이 없어 월별 히트맵을 표시할 수 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-center text-[11px] border-collapse font-mono-tabular">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 pr-2 text-left font-sans">연도</th>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((mo) => (
                      <th key={mo} className="py-2 px-1.5">
                        {mo}월
                      </th>
                    ))}
                    <th className="py-2 pl-2 text-right font-sans">연간</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {years.map((yr) => {
                    const yrSummary = yearlyBreakdown.find((y) => y.year === String(yr));
                    return (
                      <tr key={yr}>
                        <td className="py-2 pr-2 text-left font-semibold text-slate-200">{yr}</td>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((mo) => {
                          const cell = monthMap.get(`${yr}-${mo}`);
                          if (!cell) {
                            return (
                              <td key={mo} className="py-2 px-1 text-slate-600">
                                —
                              </td>
                            );
                          }
                          const intensity = Math.min(0.45, Math.abs(cell.returnPct) * 0.03 + 0.08);
                          const bg =
                            cell.returnPct >= 0
                              ? `rgba(16, 185, 129, ${intensity})`
                              : `rgba(244, 63, 94, ${intensity})`;
                          return (
                            <td
                              key={mo}
                              style={{ backgroundColor: bg }}
                              title={`${yr}년 ${mo}월 · ${cell.trades}거래 · ${cell.netPnlUsd >= 0 ? '+' : ''}$${cell.netPnlUsd.toFixed(1)}`}
                              className={`py-2 px-1 border border-slate-900/60 ${
                                cell.returnPct >= 0 ? 'text-emerald-200' : 'text-rose-200'
                              }`}
                            >
                              {cell.returnPct >= 0 ? '+' : ''}
                              {cell.returnPct.toFixed(1)}%
                            </td>
                          );
                        })}
                        <td
                          className={`py-2 pl-2 text-right font-semibold ${
                            (yrSummary?.returnPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {yrSummary
                            ? `${yrSummary.returnPct >= 0 ? '+' : ''}${yrSummary.returnPct.toFixed(1)}%`
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Yearly Consistency + LONG/SHORT Comparison (4 cols) */}
        <div className="xl:col-span-4 rounded-lg border border-slate-800 bg-[#0C121E] p-4 space-y-4">
          <div className="space-y-2">
            <h2 className="font-display text-sm font-semibold text-slate-100">
              LONG / SHORT 방향별 성과
            </h2>
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                  <th className="py-1.5">방향</th>
                  <th className="py-1.5 text-right">거래수</th>
                  <th className="py-1.5 text-right">승률</th>
                  <th className="py-1.5 text-right">PF</th>
                  <th className="py-1.5 text-right">누적 손익</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono-tabular">
                {directionBreakdown.map((d) => (
                  <tr key={d.key}>
                    <td className="py-2 font-sans font-semibold text-slate-200">{d.label}</td>
                    <td className="py-2 text-right text-slate-300">{d.trades.toLocaleString()}</td>
                    <td className="py-2 text-right text-slate-200">
                      {d.winRatePct !== null ? `${d.winRatePct.toFixed(1)}%` : 'N/A'}
                    </td>
                    <td className="py-2 text-right text-slate-300">{d.profitFactorDisplay}</td>
                    <td
                      className={`py-2 text-right font-semibold ${
                        d.netPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {d.netPnlUsd >= 0 ? '+' : '-'}${Math.abs(d.netPnlUsd).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-800">
            <h3 className="text-xs font-semibold text-slate-200">연도별 일관성 요약</h3>
            <table className="w-full text-left text-xs border-collapse font-mono-tabular">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400 font-sans">
                  <th className="py-1.5">연도</th>
                  <th className="py-1.5 text-right">거래</th>
                  <th className="py-1.5 text-right">승률</th>
                  <th className="py-1.5 text-right">PF</th>
                  <th className="py-1.5 text-right">수익률</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {yearlyBreakdown.map((y) => (
                  <tr key={y.year}>
                    <td className="py-1.5 text-slate-200">{y.year}</td>
                    <td className="py-1.5 text-right text-slate-300">{y.trades}</td>
                    <td className="py-1.5 text-right text-slate-300">
                      {y.winRatePct !== null ? `${y.winRatePct.toFixed(1)}%` : 'N/A'}
                    </td>
                    <td className="py-1.5 text-right text-slate-300">{y.profitFactorDisplay}</td>
                    <td
                      className={`py-1.5 text-right font-semibold ${
                        y.returnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {y.returnPct >= 0 ? '+' : ''}
                      {y.returnPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Market Regime Breakdown */}
      <div className="rounded-lg border border-slate-800 bg-[#0C121E] p-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-sm font-semibold text-slate-100">
            진입 시점 시장 상황별 성과 비교 (인과적 사전 분류 기준)
          </h2>
          <span className="text-[11px] text-slate-400">
            진입 직전 완성 5분봉 데이터만으로 추세(ER 48)·변동성(ATR% vs 24h 평균)·거래량(vs 4h 평균)을 분류합니다.
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                <th className="py-2 pr-3">시장 국면</th>
                <th className="py-2 px-3 text-right">거래 횟수</th>
                <th className="py-2 px-3 text-right">승률</th>
                <th className="py-2 px-3 text-right">Expectancy (증거금 대비)</th>
                <th className="py-2 px-3 text-right">Profit Factor</th>
                <th className="py-2 pl-3 text-right">누적 순손익 (USDT)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono-tabular">
              {regimeBreakdown.map((rb) => (
                <tr key={rb.key} className="hover:bg-slate-800/30">
                  <td className="py-2 pr-3 font-sans font-medium text-slate-200">{rb.label}</td>
                  <td className="py-2 px-3 text-right text-slate-300">{rb.trades.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right text-slate-200">
                    {rb.winRatePct !== null ? `${rb.winRatePct.toFixed(1)}%` : 'N/A'}
                  </td>
                  <td
                    className={`py-2 px-3 text-right ${
                      rb.expectancyPct === null
                        ? 'text-slate-500'
                        : rb.expectancyPct >= 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                    }`}
                  >
                    {rb.expectancyPct !== null
                      ? `${rb.expectancyPct >= 0 ? '+' : ''}${rb.expectancyPct.toFixed(3)}%`
                      : 'N/A'}
                  </td>
                  <td className="py-2 px-3 text-right text-slate-300">{rb.profitFactorDisplay}</td>
                  <td
                    className={`py-2 pl-3 text-right font-semibold ${
                      rb.netPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {rb.netPnlUsd >= 0 ? '+' : '-'}${Math.abs(rb.netPnlUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
