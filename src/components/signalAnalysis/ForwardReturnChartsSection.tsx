import React, { useState } from 'react';
import type { HorizonKey, HorizonReturnStats } from '../../types/signalAnalysis';

interface ForwardReturnChartsSectionProps {
  horizonStats: HorizonReturnStats[];
}

function fmtPct(v: number | null, digits = 3, withSign = true): string {
  if (v === null || !Number.isFinite(v)) return 'N/A';
  const sign = withSign && v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

function fmtPVal(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return 'N/A';
  if (v < 0.0001) return '<0.0001';
  return v.toFixed(4);
}

export const ForwardReturnChartsSection: React.FC<ForwardReturnChartsSectionProps> = ({
  horizonStats,
}) => {
  const [selectedHistHorizon, setSelectedHistHorizon] = useState<HorizonKey>('24h');
  const activeHist =
    horizonStats.find((h) => h.horizon === selectedHistHorizon) ?? horizonStats[horizonStats.length - 1];

  // Chart 1: Mean + 95% CI vs Baseline
  const renderMeanCiChart = () => {
    const w = 520;
    const h = 230;
    const pad = { top: 20, right: 20, bottom: 30, left: 48 };
    const iw = w - pad.left - pad.right;
    const ih = h - pad.top - pad.bottom;

    let minY = -0.3;
    let maxY = 0.3;
    for (const s of horizonStats) {
      if (s.ci95LowPct !== null) minY = Math.min(minY, s.ci95LowPct);
      if (s.ci95HighPct !== null) maxY = Math.max(maxY, s.ci95HighPct);
      if (s.baselineMeanPct !== null) {
        minY = Math.min(minY, s.baselineMeanPct);
        maxY = Math.max(maxY, s.baselineMeanPct);
      }
    }
    const margin = Math.max(0.1, (maxY - minY) * 0.15);
    minY -= margin;
    maxY += margin;
    const spanY = maxY - minY;
    const yOf = (v: number) => pad.top + ih - ((v - minY) / spanY) * ih;
    const zeroY = yOf(0);
    const colW = iw / Math.max(1, horizonStats.length);

    return (
      <div className="rounded-lg border border-slate-800 bg-[#0C121E] p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-slate-200">
            시계별 평균 수익률 및 95% 블록 부트스트랩 신뢰구간
          </h3>
          <span className="text-[11px] text-slate-400">점선 마커: 전체 시장 무조건부 평균</span>
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
          {[minY, 0, maxY].map((val, i) => (
            <g key={i}>
              <line
                x1={pad.left}
                x2={w - pad.right}
                y1={yOf(val)}
                y2={yOf(val)}
                stroke={val === 0 ? '#475569' : '#1E293B'}
                strokeDasharray={val === 0 ? undefined : '3 3'}
              />
              <text
                x={pad.left - 6}
                y={yOf(val) + 3}
                textAnchor="end"
                fill="#64748B"
                fontSize="10"
                className="font-mono-tabular"
              >
                {val >= 0 ? '+' : ''}
                {val.toFixed(2)}%
              </text>
            </g>
          ))}

          {horizonStats.map((s, idx) => {
            const cx = pad.left + idx * colW + colW * 0.5;
            const mean = s.meanReturnPct;
            const lo = s.ci95LowPct;
            const hi = s.ci95HighPct;
            const base = s.baselineMeanPct;

            const barColor =
              mean === null
                ? '#475569'
                : mean >= 0
                  ? '#10B981'
                  : '#F43F5E';

            return (
              <g key={s.horizon}>
                {mean !== null && (
                  <>
                    <rect
                      x={cx - 14}
                      y={Math.min(zeroY, yOf(mean))}
                      width={28}
                      height={Math.max(2, Math.abs(yOf(mean) - zeroY))}
                      fill={barColor}
                      fillOpacity={0.35}
                      stroke={barColor}
                      strokeWidth="1"
                    />
                    {lo !== null && hi !== null && (
                      <>
                        <line
                          x1={cx}
                          x2={cx}
                          y1={yOf(hi)}
                          y2={yOf(lo)}
                          stroke="#E2E8F0"
                          strokeWidth="1.3"
                        />
                        <line x1={cx - 5} x2={cx + 5} y1={yOf(hi)} y2={yOf(hi)} stroke="#E2E8F0" strokeWidth="1.3" />
                        <line x1={cx - 5} x2={cx + 5} y1={yOf(lo)} y2={yOf(lo)} stroke="#E2E8F0" strokeWidth="1.3" />
                      </>
                    )}
                  </>
                )}

                {base !== null && (
                  <line
                    x1={cx - 18}
                    x2={cx + 18}
                    y1={yOf(base)}
                    y2={yOf(base)}
                    stroke="#F59E0B"
                    strokeWidth="1.6"
                    strokeDasharray="3 2"
                  />
                )}

                <text
                  x={cx}
                  y={h - 10}
                  textAnchor="middle"
                  fill="#94A3B8"
                  fontSize="10.5"
                  className="font-mono-tabular"
                >
                  {s.horizon}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  // Chart 2: Win Rate vs Baseline Win Rate
  const renderWinRateChart = () => {
    const w = 520;
    const h = 230;
    const pad = { top: 20, right: 20, bottom: 30, left: 48 };
    const iw = w - pad.left - pad.right;
    const ih = h - pad.top - pad.bottom;

    const minY = 25;
    const maxY = 75;
    const yOf = (v: number) => pad.top + ih - ((Math.max(minY, Math.min(maxY, v)) - minY) / (maxY - minY)) * ih;
    const colW = iw / Math.max(1, horizonStats.length);

    return (
      <div className="rounded-lg border border-slate-800 bg-[#0C121E] p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-slate-200">
            시계별 상승 승률(%) vs 전체 시장 기준 승률
          </h3>
          <span className="text-[11px] text-slate-400">기준선: 50.0% / 주황: 시장 평균</span>
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
          {[30, 40, 50, 60, 70].map((val) => (
            <g key={val}>
              <line
                x1={pad.left}
                x2={w - pad.right}
                y1={yOf(val)}
                y2={yOf(val)}
                stroke={val === 50 ? '#475569' : '#1E293B'}
                strokeDasharray={val === 50 ? undefined : '3 3'}
              />
              <text
                x={pad.left - 6}
                y={yOf(val) + 3}
                textAnchor="end"
                fill="#64748B"
                fontSize="10"
                className="font-mono-tabular"
              >
                {val}%
              </text>
            </g>
          ))}

          {horizonStats.map((s, idx) => {
            const cx = pad.left + idx * colW + colW * 0.5;
            const win = s.winRatePct;
            const baseWin = s.baselineWinRatePct;
            const barColor =
              win === null
                ? '#475569'
                : win >= (baseWin ?? 50)
                  ? '#38BDF8'
                  : '#94A3B8';

            return (
              <g key={s.horizon}>
                {win !== null && (
                  <>
                    <rect
                      x={cx - 14}
                      y={yOf(win)}
                      width={28}
                      height={Math.max(2, yOf(minY) - yOf(win))}
                      fill={barColor}
                      fillOpacity={0.38}
                      stroke={barColor}
                      strokeWidth="1"
                    />
                    <text
                      x={cx}
                      y={yOf(win) - 5}
                      textAnchor="middle"
                      fill="#E2E8F0"
                      fontSize="9.5"
                      className="font-mono-tabular"
                    >
                      {win.toFixed(1)}%
                    </text>
                  </>
                )}
                {baseWin !== null && (
                  <line
                    x1={cx - 18}
                    x2={cx + 18}
                    y1={yOf(baseWin)}
                    y2={yOf(baseWin)}
                    stroke="#F59E0B"
                    strokeWidth="1.6"
                    strokeDasharray="3 2"
                  />
                )}
                <text
                  x={cx}
                  y={h - 10}
                  textAnchor="middle"
                  fill="#94A3B8"
                  fontSize="10.5"
                  className="font-mono-tabular"
                >
                  {s.horizon}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  // Chart 3: Percentile Box-Whisker (p05, p25, median, p75, p95)
  const renderBoxplotChart = () => {
    const w = 520;
    const h = 230;
    const pad = { top: 20, right: 20, bottom: 30, left: 48 };
    const iw = w - pad.left - pad.right;
    const ih = h - pad.top - pad.bottom;

    let minY = -1;
    let maxY = 1;
    for (const s of horizonStats) {
      if (s.p05Pct !== null) minY = Math.min(minY, s.p05Pct);
      if (s.p95Pct !== null) maxY = Math.max(maxY, s.p95Pct);
    }
    const margin = Math.max(0.2, (maxY - minY) * 0.1);
    minY -= margin;
    maxY += margin;
    const yOf = (v: number) => pad.top + ih - ((v - minY) / (maxY - minY)) * ih;
    const colW = iw / Math.max(1, horizonStats.length);

    return (
      <div className="rounded-lg border border-slate-800 bg-[#0C121E] p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-slate-200">
            수익률 분위수 분포 (5% · 25% · 중앙값 · 75% · 95%)
          </h3>
          <span className="text-[11px] text-slate-400">꼬리 위험(Tail Risk) 비대칭 확인</span>
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
          {[minY, 0, maxY].map((val, i) => (
            <g key={i}>
              <line
                x1={pad.left}
                x2={w - pad.right}
                y1={yOf(val)}
                y2={yOf(val)}
                stroke={val === 0 ? '#475569' : '#1E293B'}
                strokeDasharray={val === 0 ? undefined : '3 3'}
              />
              <text
                x={pad.left - 6}
                y={yOf(val) + 3}
                textAnchor="end"
                fill="#64748B"
                fontSize="10"
                className="font-mono-tabular"
              >
                {val >= 0 ? '+' : ''}
                {val.toFixed(1)}%
              </text>
            </g>
          ))}

          {horizonStats.map((s, idx) => {
            const cx = pad.left + idx * colW + colW * 0.5;
            if (
              s.p05Pct === null ||
              s.p25Pct === null ||
              s.medianReturnPct === null ||
              s.p75Pct === null ||
              s.p95Pct === null
            ) {
              return (
                <text
                  key={s.horizon}
                  x={cx}
                  y={h - 10}
                  textAnchor="middle"
                  fill="#64748B"
                  fontSize="10"
                >
                  {s.horizon}
                </text>
              );
            }

            const y05 = yOf(s.p05Pct);
            const y25 = yOf(s.p25Pct);
            const y50 = yOf(s.medianReturnPct);
            const y75 = yOf(s.p75Pct);
            const y95 = yOf(s.p95Pct);

            return (
              <g key={s.horizon}>
                <line x1={cx} x2={cx} y1={y95} y2={y05} stroke="#64748B" strokeWidth="1.2" />
                <line x1={cx - 6} x2={cx + 6} y1={y95} y2={y95} stroke="#64748B" strokeWidth="1.2" />
                <line x1={cx - 6} x2={cx + 6} y1={y05} y2={y05} stroke="#64748B" strokeWidth="1.2" />
                <rect
                  x={cx - 13}
                  y={y75}
                  width={26}
                  height={Math.max(2, y25 - y75)}
                  fill="#38BDF8"
                  fillOpacity={0.22}
                  stroke="#38BDF8"
                  strokeWidth="1.2"
                />
                <line x1={cx - 13} x2={cx + 13} y1={y50} y2={y50} stroke="#F8FAFC" strokeWidth="2" />
                <text
                  x={cx}
                  y={h - 10}
                  textAnchor="middle"
                  fill="#94A3B8"
                  fontSize="10.5"
                  className="font-mono-tabular"
                >
                  {s.horizon}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  // Chart 4: Interactive Horizon Histogram
  const renderHistogramChart = () => {
    const w = 520;
    const h = 230;
    const pad = { top: 20, right: 20, bottom: 32, left: 36 };
    const iw = w - pad.left - pad.right;
    const ih = h - pad.top - pad.bottom;

    const bins = activeHist?.histogramBins ?? [];
    const maxCount = Math.max(1, ...bins.map((b) => b.count));

    return (
      <div className="rounded-lg border border-slate-800 bg-[#0C121E] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="text-xs font-semibold text-slate-200">
            후행 수익률 히스토그램 ({activeHist?.koreanLabel})
          </h3>
          <div className="flex items-center gap-1">
            {horizonStats.map((s) => (
              <button
                key={s.horizon}
                type="button"
                onClick={() => setSelectedHistHorizon(s.horizon)}
                className={`px-2 py-0.5 text-[11px] rounded font-mono-tabular cursor-pointer transition-colors ${
                  selectedHistHorizon === s.horizon
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                {s.horizon}
              </button>
            ))}
          </div>
        </div>

        {bins.length > 0 ? (
          <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
            <line
              x1={pad.left + iw * 0.5}
              x2={pad.left + iw * 0.5}
              y1={pad.top}
              y2={h - pad.bottom}
              stroke="#475569"
              strokeDasharray="3 3"
            />
            {bins.map((bin, idx) => {
              const bw = iw / bins.length;
              const x = pad.left + idx * bw + 2;
              const barH = (bin.count / maxCount) * ih;
              const y = pad.top + ih - barH;
              const mid = (bin.from + bin.to) * 0.5;
              const color = mid >= 0 ? '#10B981' : '#F43F5E';
              return (
                <g key={idx}>
                  <rect
                    x={x}
                    y={y}
                    width={Math.max(4, bw - 4)}
                    height={barH}
                    fill={color}
                    fillOpacity={0.45}
                    stroke={color}
                    strokeWidth="0.8"
                  />
                  {bin.count > 0 && (
                    <text
                      x={x + Math.max(2, (bw - 4) * 0.5)}
                      y={Math.max(pad.top + 8, y - 3)}
                      textAnchor="middle"
                      fill="#94A3B8"
                      fontSize="9"
                      className="font-mono-tabular"
                    >
                      {bin.count}
                    </text>
                  )}
                  {(idx === 0 || idx === Math.floor(bins.length / 2) || idx === bins.length - 1) && (
                    <text
                      x={x + bw * 0.5}
                      y={h - 10}
                      textAnchor="middle"
                      fill="#64748B"
                      fontSize="9.5"
                      className="font-mono-tabular"
                    >
                      {mid >= 0 ? '+' : ''}
                      {mid.toFixed(1)}%
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        ) : (
          <div className="h-[180px] flex items-center justify-center text-xs text-slate-500">
            유효 표본이 없어 분포를 표시할 수 없습니다.
          </div>
        )}
      </div>
    );
  };

  return (
    <section
      id="forward-returns"
      className="mx-auto w-full max-w-[1440px] px-5 py-6 border-b border-slate-800/80 space-y-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-100">
            유사 구간 이후 수익률 분포 및 다중 검정(FDR) 통계 분석
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            중복 제거된 독립 매치만 집계하며, 블록 부트스트랩 95% 신뢰구간·Newey-West HAC·Welch t·Mann-Whitney U·Benjamini-Hochberg 다중검정 보정을 적용합니다.
          </p>
        </div>
      </div>

      {/* Statistical Summary Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#0C121E]">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400 bg-[#090D16]/60">
              <th className="px-3 py-2.5 whitespace-nowrap">시계</th>
              <th className="px-3 py-2.5 whitespace-nowrap text-right">표본 (ESS)</th>
              <th className="px-3 py-2.5 whitespace-nowrap text-right">평균 수익률</th>
              <th className="px-3 py-2.5 whitespace-nowrap text-right">중앙값</th>
              <th className="px-3 py-2.5 whitespace-nowrap text-right">승률</th>
              <th className="px-3 py-2.5 whitespace-nowrap text-right">95% 신뢰구간 (Block)</th>
              <th className="px-3 py-2.5 whitespace-nowrap text-right">시장 평균</th>
              <th className="px-3 py-2.5 whitespace-nowrap text-right">초과 수익</th>
              <th className="px-3 py-2.5 whitespace-nowrap text-right">HAC p</th>
              <th className="px-3 py-2.5 whitespace-nowrap text-right">MW-U p</th>
              <th className="px-3 py-2.5 whitespace-nowrap text-right">FDR 보정 p</th>
              <th className="px-3 py-2.5 whitespace-nowrap">통계적 판정</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70 font-mono-tabular">
            {horizonStats.map((h) => {
              const excess = h.excessReturnPct;
              const verdictColor =
                h.significance.verdict === 'significant_fdr'
                  ? 'text-emerald-400 font-semibold'
                  : h.significance.verdict === 'marginal_uncorrected'
                    ? 'text-amber-300'
                    : h.significance.verdict === 'insufficient_sample'
                      ? 'text-rose-300'
                      : 'text-slate-400';

              return (
                <tr key={h.horizon} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-3 py-2.5 font-sans font-semibold text-slate-200 whitespace-nowrap">
                    {h.horizon} <span className="text-[11px] font-normal text-slate-500">({h.koreanLabel})</span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-200 whitespace-nowrap">
                    {h.sampleCount}
                    <span className="text-slate-500"> ({h.significance.effectiveSampleSize.toFixed(0)})</span>
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-semibold whitespace-nowrap ${
                      h.meanReturnPct === null
                        ? 'text-slate-500'
                        : h.meanReturnPct >= 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                    }`}
                  >
                    {fmtPct(h.meanReturnPct)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-300 whitespace-nowrap">
                    {fmtPct(h.medianReturnPct)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-200 whitespace-nowrap">
                    {fmtPct(h.winRatePct, 1, false)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-300 whitespace-nowrap">
                    {h.ci95LowPct !== null && h.ci95HighPct !== null
                      ? `[${fmtPct(h.ci95LowPct, 2)}, ${fmtPct(h.ci95HighPct, 2)}]`
                      : 'N/A'}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-400 whitespace-nowrap">
                    {fmtPct(h.baselineMeanPct)}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-medium whitespace-nowrap ${
                      excess === null
                        ? 'text-slate-500'
                        : excess >= 0
                          ? 'text-sky-300'
                          : 'text-amber-300'
                    }`}
                  >
                    {fmtPct(excess)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-300 whitespace-nowrap">
                    {fmtPVal(h.significance.hacPValue)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-300 whitespace-nowrap">
                    {fmtPVal(h.significance.mannWhitneyPValue)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-200 font-semibold whitespace-nowrap">
                    {fmtPVal(h.significance.fdrAdjustedPValue)}
                  </td>
                  <td className={`px-3 py-2.5 font-sans whitespace-nowrap ${verdictColor}`}>
                    {h.significance.verdictLabel}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 2x2 Statistical Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {renderMeanCiChart()}
        {renderWinRateChart()}
        {renderBoxplotChart()}
        {renderHistogramChart()}
      </div>
    </section>
  );
};
