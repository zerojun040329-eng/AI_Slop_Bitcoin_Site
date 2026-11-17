import React, { useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type {
  HalvingEvent,
  HashratePoint,
  MiningAssumptions,
} from '../../types/longTerm';
import { calculateMiningEconomics } from '../../utils/longTermAnalytics';
import { formatPercent, formatSignedUsd, formatUsd } from '../../utils/analytics';

interface MiningEconomicsSectionProps {
  currentSpotPrice: number;
  avgTotalRewardBtc: number;
  avgFeePerBlockBtc: number;
  hashrateHistory: HashratePoint[];
  defaultAssumptions: MiningAssumptions;
  halvings: HalvingEvent[];
  historicalFeesArchiveSupported: boolean;
  historicalFeesArchiveReason: string;
}

export const MiningEconomicsSection: React.FC<MiningEconomicsSectionProps> = ({
  currentSpotPrice,
  avgTotalRewardBtc,
  avgFeePerBlockBtc,
  hashrateHistory,
  defaultAssumptions,
  halvings,
  historicalFeesArchiveSupported,
  historicalFeesArchiveReason,
}) => {
  const [assumptions, setAssumptions] = useState<MiningAssumptions>(defaultAssumptions);
  const [showDifficulty, setShowDifficulty] = useState(true);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const blockRewardBtc = 3.125;

  const summary = useMemo(
    () =>
      calculateMiningEconomics(
        currentSpotPrice,
        blockRewardBtc,
        avgTotalRewardBtc,
        avgFeePerBlockBtc,
        hashrateHistory,
        assumptions,
      ),
    [
      currentSpotPrice,
      blockRewardBtc,
      avgTotalRewardBtc,
      avgFeePerBlockBtc,
      hashrateHistory,
      assumptions,
    ],
  );

  // Sample hashrate chart points for clean SVG rendering (~250 points)
  const chartPoints = useMemo(() => {
    const stride = Math.max(1, Math.floor(hashrateHistory.length / 260));
    const sampled: HashratePoint[] = [];
    for (let i = 0; i < hashrateHistory.length; i += stride) {
      sampled.push(hashrateHistory[i]);
    }
    const last = hashrateHistory[hashrateHistory.length - 1];
    if (last && sampled[sampled.length - 1]?.date !== last.date) {
      sampled.push(last);
    }
    return sampled;
  }, [hashrateHistory]);

  const svgW = 1000;
  const svgH = 260;
  const padL = 16;
  const padR = 72;
  const padT = 22;
  const padB = 30;
  const innerW = svgW - padL - padR;
  const innerH = svgH - padT - padB;

  const maxHash = useMemo(() => {
    let m = 100;
    for (const p of chartPoints) m = Math.max(m, p.hashrateEh);
    return m * 1.08;
  }, [chartPoints]);

  const maxDiff = useMemo(() => {
    let m = 10;
    for (const p of chartPoints) {
      if (p.difficultyT !== null && Number.isFinite(p.difficultyT)) {
        m = Math.max(m, p.difficultyT);
      }
    }
    return m * 1.08;
  }, [chartPoints]);

  const hashratePolyline = useMemo(
    () =>
      chartPoints
        .map((p, idx) => {
          const x = padL + (idx / Math.max(1, chartPoints.length - 1)) * innerW;
          const y = padT + innerH - (p.hashrateEh / maxHash) * innerH;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' '),
    [chartPoints, innerW, innerH, maxHash],
  );

  const hashrateAreaPath = useMemo(() => {
    if (chartPoints.length === 0 || !hashratePolyline) return '';
    const lastX = padL + innerW;
    return `M ${padL} ${padT + innerH} L ${hashratePolyline.replace(/ /g, ' L ')} L ${lastX} ${
      padT + innerH
    } Z`;
  }, [chartPoints.length, hashratePolyline, innerW, innerH]);

  const difficultyPolyline = useMemo(
    () =>
      chartPoints
        .map((p, idx) => ({ p, idx }))
        .filter(
          (item): item is { p: HashratePoint & { difficultyT: number }; idx: number } =>
            item.p.difficultyT !== null && Number.isFinite(item.p.difficultyT),
        )
        .map(({ p, idx }) => {
          const x = padL + (idx / Math.max(1, chartPoints.length - 1)) * innerW;
          const y = padT + innerH - (p.difficultyT / maxDiff) * innerH;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' '),
    [chartPoints, innerW, innerH, maxDiff],
  );

  const handleChartMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || chartPoints.length === 0) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    let relX: number;
    const ctm = svg.getScreenCTM();
    if (ctm) {
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      relX = pt.x;
    } else {
      const scale = Math.min(rect.width / svgW, rect.height / svgH);
      const offsetX = (rect.width - svgW * scale) / 2;
      relX = (e.clientX - rect.left - offsetX) / scale;
    }

    const frac = Math.min(1, Math.max(0, (relX - padL) / innerW));
    const idx = Math.round(frac * (chartPoints.length - 1));
    setHoverIdx(idx);
  };

  const hoveredPoint = hoverIdx !== null ? chartPoints[hoverIdx] : null;
  const hoveredX =
    hoverIdx !== null ? padL + (hoverIdx / Math.max(1, chartPoints.length - 1)) * innerW : 0;
  const hoveredY =
    hoveredPoint != null ? padT + innerH - (hoveredPoint.hashrateEh / maxHash) * innerH : 0;

  const isDefaultAssumptions =
    Math.abs(assumptions.electricityUsdPerKwh - defaultAssumptions.electricityUsdPerKwh) < 0.0001 &&
    Math.abs(assumptions.fleetEfficiencyJPerTh - defaultAssumptions.fleetEfficiencyJPerTh) < 0.05;

  const epochRevenueTable = useMemo(
    () => [
      { epoch: 'Epoch 1 (제네시스)', period: '2009.01 ~ 2012.11', reward: 50, dailyBtc: 7200, annualInflation: '~33%+', status: 'past' as const },
      { epoch: 'Epoch 2 (1차 반감기)', period: '2012.11 ~ 2016.07', reward: 25, dailyBtc: 3600, annualInflation: '~10.5%', status: 'past' as const },
      { epoch: 'Epoch 3 (2차 반감기)', period: '2016.07 ~ 2020.05', reward: 12.5, dailyBtc: 1800, annualInflation: '~4.0%', status: 'past' as const },
      { epoch: 'Epoch 4 (3차 반감기)', period: '2020.05 ~ 2024.04', reward: 6.25, dailyBtc: 900, annualInflation: '~1.75%', status: 'past' as const },
      { epoch: 'Epoch 5 (4차 · 현재)', period: '2024.04 ~ 2028(예상)', reward: 3.125, dailyBtc: 450, annualInflation: '~0.83%', current: true, status: 'current' as const },
      { epoch: 'Epoch 6 (5차 · 예정)', period: '2028 ~ 2032(예상)', reward: 1.5625, dailyBtc: 225, annualInflation: '~0.40%', status: 'future' as const },
    ],
    [],
  );

  // Reference halvings info for year tick alignment
  void halvings;

  return (
    <section
      id="mining-economics"
      className="mx-auto w-full max-w-[1440px] px-5 py-8 space-y-10"
      aria-label="비트코인 채굴 경제성 분석"
    >
      {/* Section Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-slate-800/80 pb-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-100">
            채굴 경제성 및 네트워크 해시레이트 분석
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            전력비 기반 직접 채굴 원가와 총 운영비(OpEx) 기반 원가를 구분하고, 채굴자 프리미엄·해시레이트·블록 보조금 지표를 분석합니다.
          </p>
        </div>

        {/* Assumption Tuning Inputs */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="inline-flex items-center gap-1.5 text-slate-400">
            <span>전력 단가 ($/kWh)</span>
            <input
              type="number"
              step="0.005"
              min="0.01"
              max="0.20"
              value={assumptions.electricityUsdPerKwh}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0) {
                  setAssumptions((prev) => ({ ...prev, electricityUsdPerKwh: v }));
                }
              }}
              className="w-20 rounded border border-slate-800 bg-[#0C121E] px-2 py-1 font-mono-tabular text-slate-100 focus:border-slate-600 focus:outline-none"
            />
          </label>
          <label className="inline-flex items-center gap-1.5 text-slate-400">
            <span>장비 효율 (J/TH)</span>
            <input
              type="number"
              step="0.5"
              min="10"
              max="60"
              value={assumptions.fleetEfficiencyJPerTh}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0) {
                  setAssumptions((prev) => ({ ...prev, fleetEfficiencyJPerTh: v }));
                }
              }}
              className="w-18 rounded border border-slate-800 bg-[#0C121E] px-2 py-1 font-mono-tabular text-slate-100 focus:border-slate-600 focus:outline-none"
            />
          </label>
          <button
            type="button"
            disabled={isDefaultAssumptions}
            onClick={() => setAssumptions(defaultAssumptions)}
            className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors whitespace-nowrap shrink-0 ${
              isDefaultAssumptions
                ? 'border-slate-800/50 text-slate-600 cursor-not-allowed'
                : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 cursor-pointer'
            }`}
          >
            <RotateCcw className="h-3 w-3" />
            <span>가정 초기화</span>
          </button>
        </div>
      </div>

      {/* A & B: Mining Cost per BTC + Miner Premium Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-12 border border-slate-800/80 bg-[#0C121E] divide-y lg:divide-y-0 lg:divide-x divide-slate-800/80">
        {/* A. BTC 1개당 추정 채굴 원가 (전력비 vs 총 운영비 구분) */}
        <div className="lg:col-span-7 p-5 space-y-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-200">
              A. 비트코인 1개당 추정 채굴 원가 vs 현재 시장 가격
            </h3>
            <span className="font-mono-tabular text-xs text-slate-400">
              현재 시장가 {formatUsd(summary.currentSpotUsd, 0)}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Electricity-Only Cost */}
            <div className="border border-slate-800/80 bg-[#090D16] p-4 space-y-2">
              <div className="text-xs text-slate-400">1) 순수 전력비 기반 추정 원가 (Electricity-Only)</div>
              <div className="font-mono-tabular text-2xl font-semibold text-slate-100">
                {formatUsd(summary.electricityCostPerBtcUsd, 0)}
              </div>
              <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/70">
                <span className="text-slate-400">시장가 대비 차이</span>
                <span className="font-mono-tabular text-slate-200">
                  {formatSignedUsd(summary.electricityDiffUsd, 0)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">원가 대비 상태</span>
                <span
                  className={`font-mono-tabular font-medium ${
                    summary.electricityPremiumPct >= 0 ? 'text-slate-200' : 'text-rose-300'
                  }`}
                >
                  {summary.electricityPremiumPct >= 0 ? '프리미엄 +' : '디스카운트 '}
                  {Math.abs(summary.electricityPremiumPct).toFixed(1)}%
                </span>
              </div>
            </div>

            {/* All-In OpEx Cost */}
            <div className="border border-slate-800/80 bg-[#090D16] p-4 space-y-2">
              <div className="text-xs text-slate-400">2) 총 운영비 포함 추정 원가 (All-In OpEx ×{assumptions.allInOpExMultiplier})</div>
              <div className="font-mono-tabular text-2xl font-semibold text-slate-100">
                {formatUsd(summary.allInCostPerBtcUsd, 0)}
              </div>
              <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/70">
                <span className="text-slate-400">시장가 대비 차이</span>
                <span className="font-mono-tabular text-slate-200">
                  {formatSignedUsd(summary.allInDiffUsd, 0)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">원가 대비 상태</span>
                <span
                  className={`font-mono-tabular font-medium ${
                    summary.allInPremiumPct >= 0 ? 'text-slate-200' : 'text-rose-300'
                  }`}
                >
                  {summary.allInPremiumPct >= 0 ? '프리미엄 +' : '디스카운트 '}
                  {Math.abs(summary.allInPremiumPct).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            <strong className="text-slate-400">모델 추정치:</strong> 실제 온체인 해시레이트({summary.currentHashrateEh.toFixed(1)} EH/s · Mempool.space) 및 일일 발행량({summary.dailyNewIssuanceBtc} BTC)에 사용자 설정 가정(평균 효율 {assumptions.fleetEfficiencyJPerTh} J/TH · 전력 단가 ${assumptions.electricityUsdPerKwh.toFixed(3)}/kWh · 총 운영비 계수 {assumptions.allInOpExMultiplier}x)을 결합해 산출합니다.
          </p>
        </div>

        {/* B. Miner Premium (%) */}
        <div className="lg:col-span-5 p-5 flex flex-col justify-between space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">
              B. 채굴자 마진 (Miner Premium)
            </h3>
            <p className="mt-1 font-mono-tabular text-[11px] text-slate-400">
              Miner Premium (%) = (현재 BTC 가격 / 1 BTC 채굴 원가 - 1) × 100
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex items-baseline justify-between border-b border-slate-800/70 pb-3">
              <div>
                <div className="text-xs text-slate-400">총 운영비 기준 현재 프리미엄</div>
                <div className="mt-1 font-mono-tabular text-3xl font-semibold text-slate-50">
                  {summary.allInPremiumPct >= 0 ? '+' : ''}
                  {summary.allInPremiumPct.toFixed(2)}%
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-400">전력비 기준 프리미엄</div>
                <div className="mt-1 font-mono-tabular text-lg font-medium text-slate-300">
                  {summary.electricityPremiumPct >= 0 ? '+' : ''}
                  {summary.electricityPremiumPct.toFixed(2)}%
                </div>
              </div>
            </div>

            {/* Break-even & Historical Average Comparison Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">역사적 평균 프리미엄 (장기 시계열)</span>
                {summary.historicalAvgPremiumPct !== null ? (
                  <span className="font-mono-tabular font-medium text-slate-200">
                    +{summary.historicalAvgPremiumPct.toFixed(1)}%
                  </span>
                ) : (
                  <span className="font-mono-tabular text-[11px] text-amber-300">
                    미지원 (과거 ASIC 효율·전력단가 시계열 API 미연결)
                  </span>
                )}
              </div>

              <div className="relative h-2.5 w-full bg-slate-900 border border-slate-800 overflow-hidden">
                {/* Current All-In Premium Fill */}
                <div
                  className="h-full bg-slate-300 transition-all"
                  style={{
                    width: `${Math.min(100, Math.max(0, ((summary.allInPremiumPct + 30) / 180) * 100))}%`,
                  }}
                />
                {/* 0% Break-even Marker */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-sky-400/80"
                  style={{
                    left: `${((0 + 30) / 180) * 100}%`,
                  }}
                  title="손익분기점 (0%)"
                />
                {/* Historical Average Vertical Marker only when real benchmark exists */}
                {summary.historicalAvgPremiumPct !== null && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-amber-400"
                    style={{
                      left: `${Math.min(100, Math.max(0, ((summary.historicalAvgPremiumPct + 30) / 180) * 100))}%`,
                    }}
                    title={`역사적 평균 +${summary.historicalAvgPremiumPct}%`}
                  />
                )}
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono-tabular">
                <span>-30% (항복 구간)</span>
                <span>파란선: 0% 손익분기점</span>
                <span>+150%</span>
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-400 border-t border-slate-800/70 pt-3">
            {summary.allInPremiumPct >= 0
              ? '현재 시장 가격이 설정된 총 운영비 추정 원가를 상회하여 채굴 마진이 플러스(+) 구간에 있습니다.'
              : '현재 시장 가격이 설정된 총 운영비 추정 원가를 하회하여 한계 채굴자 수익성 압박이 발생하고 있습니다.'}
          </div>
        </div>
      </div>

      {/* C. Total Network Hashrate & Difficulty Shared-Time Chart */}
      <div className="border border-slate-800/80 bg-[#0C121E] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">
              C. 총 네트워크 해시레이트 및 채굴 난이도 장기 추이
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Mempool.space 실제 온체인 해시레이트(EH/s)와 난이도(T) 장기 시계열 ({hashrateHistory.length.toLocaleString()}개 관측점)
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowDifficulty((v) => !v)}
              aria-pressed={showDifficulty}
              className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showDifficulty
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                  : 'border-slate-800 bg-slate-900 text-slate-400'
              }`}
            >
              채굴 난이도(T) {showDifficulty ? '표시 중' : '숨김'}
            </button>
          </div>
        </div>

        {/* Hashrate KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 border-b border-slate-800/70 pb-4">
          <div>
            <div className="text-[11px] text-slate-400">현재 해시레이트</div>
            <div className="mt-0.5 font-mono-tabular text-lg font-semibold text-slate-100">
              {summary.currentHashrateEh.toFixed(1)} EH/s
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-400">역대 최고 해시레이트 (ATH)</div>
            <div className="mt-0.5 font-mono-tabular text-lg font-semibold text-slate-100">
              {summary.athHashrateEh.toFixed(1)} EH/s
              <span className="ml-1.5 text-[11px] font-normal text-slate-500">
                ({summary.athHashrateDate})
              </span>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-400">최근 30일 변화율</div>
            <div
              className={`mt-0.5 font-mono-tabular text-lg font-semibold ${
                summary.hashrateChange30dPct >= 0 ? 'text-slate-100' : 'text-rose-300'
              }`}
            >
              {formatPercent(summary.hashrateChange30dPct, 2, true)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-400">최근 1년 변화율</div>
            <div
              className={`mt-0.5 font-mono-tabular text-lg font-semibold ${
                summary.hashrateChange1yPct >= 0 ? 'text-slate-100' : 'text-rose-300'
              }`}
            >
              {formatPercent(summary.hashrateChange1yPct, 2, true)}
            </div>
          </div>
        </div>

        {/* Interactive Shared-Time SVG Chart */}
        <div className="relative w-full">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${svgW} ${svgH}`}
            onMouseMove={handleChartMove}
            onMouseLeave={() => setHoverIdx(null)}
            className="w-full h-64 cursor-crosshair select-none"
          >
            <defs>
              <linearGradient id="hashrate-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#94A3B8" stopOpacity="0.20" />
                <stop offset="100%" stopColor="#94A3B8" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal Gridlines */}
            {[0.25, 0.5, 0.75, 1].map((frac) => {
              const y = padT + innerH - frac * innerH;
              const val = Math.round(maxHash * frac);
              return (
                <g key={frac}>
                  <line
                    x1={padL}
                    y1={y}
                    x2={padL + innerW}
                    y2={y}
                    stroke="#1E293B"
                    strokeDasharray="2 4"
                  />
                  <text
                    x={padL + innerW + 8}
                    y={y + 3.5}
                    fill="#94A3B8"
                    fontSize={10}
                    fontFamily="var(--font-mono)"
                  >
                    {val} EH/s
                  </text>
                </g>
              );
            })}

            {/* Hashrate Area + Line */}
            <path d={hashrateAreaPath} fill="url(#hashrate-area)" />
            <polyline
              points={hashratePolyline}
              fill="none"
              stroke="#E2E8F0"
              strokeWidth={1.75}
            />

            {/* Difficulty Overlay Line */}
            {showDifficulty && (
              <polyline
                points={difficultyPolyline}
                fill="none"
                stroke="#F59E0B"
                strokeWidth={1.4}
                strokeDasharray="4 2"
                opacity={0.85}
              />
            )}

            {/* Bottom Year Labels */}
            {[0, 0.2, 0.4, 0.6, 0.8, 1].map((frac) => {
              const idx = Math.min(
                chartPoints.length - 1,
                Math.floor(frac * (chartPoints.length - 1)),
              );
              const pt = chartPoints[idx];
              if (!pt) return null;
              const x = padL + frac * innerW;
              return (
                <text
                  key={pt.date}
                  x={x}
                  y={svgH - 8}
                  textAnchor={frac === 0 ? 'start' : frac === 1 ? 'end' : 'middle'}
                  fill="#64748B"
                  fontSize={10}
                  fontFamily="var(--font-mono)"
                >
                  {pt.date.slice(0, 7)}
                </text>
              );
            })}

            {/* Hover Crosshair */}
            {hoveredPoint && (
              <g className="pointer-events-none">
                <line
                  x1={hoveredX}
                  y1={padT}
                  x2={hoveredX}
                  y2={padT + innerH}
                  stroke="#64748B"
                  strokeDasharray="3 3"
                />
                <circle cx={hoveredX} cy={hoveredY} r={4} fill="#E2E8F0" stroke="#090D16" strokeWidth={1.5} />
              </g>
            )}
          </svg>

          {/* Hover Readout Strip */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 border-t border-slate-800/70 pt-2">
            <div className="flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-3.5 bg-slate-200 inline-block" /> 총 해시레이트 (EH/s)
              </span>
              {showDifficulty && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-3.5 border-t-2 border-dashed border-amber-400 inline-block" />{' '}
                  채굴 난이도 (T)
                </span>
              )}
            </div>
            {hoveredPoint ? (
              <div className="font-mono-tabular text-slate-200">
                {hoveredPoint.date} · 해시레이트 {hoveredPoint.hashrateEh.toFixed(1)} EH/s · 난이도{' '}
                {hoveredPoint.difficultyT !== null
                  ? `${hoveredPoint.difficultyT.toFixed(2)} T`
                  : '미제공'}
              </div>
            ) : (
              <div className="text-slate-500">차트 위에 마우스를 올리면 일자별 해시레이트·난이도를 확인할 수 있습니다.</div>
            )}
          </div>
        </div>
      </div>

      {/* D. Additional Mining Indicators & Halving Epoch Revenue Table */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-200">
            D. 추가 채굴 지표 및 반감기별 채굴 수익 변화
          </h3>
          {!historicalFeesArchiveSupported && (
            <span className="text-[11px] text-slate-400">
              {historicalFeesArchiveReason}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 border border-slate-800/80 bg-[#0C121E] divide-y sm:divide-y-0 sm:divide-x divide-slate-800/80">
          <div className="p-4">
            <div className="text-[11px] text-slate-400">네트워크 채굴 난이도</div>
            <div className="mt-1 font-mono-tabular text-base font-semibold text-slate-100">
              {summary.currentDifficultyT.toFixed(2)} T
            </div>
            <div className="mt-1 text-[11px] text-slate-500">Mempool.space 실제 데이터</div>
          </div>

          <div className="p-4">
            <div className="text-[11px] text-slate-400">블록당 총 보상 (24h 평균)</div>
            <div className="mt-1 font-mono-tabular text-base font-semibold text-slate-100">
              {summary.avgTotalRewardPerBlockBtc.toFixed(4)} BTC
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              보조금 {summary.blockRewardBtc} + 24h 수수료 {summary.avgFeePerBlockBtc.toFixed(4)} BTC
            </div>
          </div>

          <div className="p-4">
            <div className="text-[11px] text-slate-400">일일 신규 BTC 발행량</div>
            <div className="mt-1 font-mono-tabular text-base font-semibold text-slate-100">
              {summary.dailyNewIssuanceBtc} BTC/일
            </div>
            <div className="mt-1 text-[11px] text-slate-500">평균 144블록 기준 (보조금)</div>
          </div>

          <div className="p-4">
            <div className="text-[11px] text-slate-400">일일 채굴자 총수익 (24h 수수료 포함)</div>
            <div className="mt-1 font-mono-tabular text-base font-semibold text-emerald-300">
              {formatUsd(summary.dailyTotalRevenueUsd, 0)}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              보조금 기준 {formatUsd(summary.dailySubsidyRevenueUsd, 0)} · Mempool 24h 실측
            </div>
          </div>

          <div className="p-4">
            <div className="text-[11px] text-slate-400">Hashprice (24h 수수료 포함)</div>
            <div className="mt-1 font-mono-tabular text-base font-semibold text-sky-300">
              ${summary.totalHashpriceUsdPerThDay.toFixed(4)} /TH/일
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              보조금 기준 ${summary.subsidyHashpriceUsdPerThDay.toFixed(4)} /TH/일
            </div>
          </div>
        </div>

        {/* Halving Epoch Revenue / Issuance Comparison Table */}
        <div className="overflow-x-auto border border-slate-800/80 bg-[#0C121E]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                <th className="py-2.5 px-3">반감기 에포크</th>
                <th className="py-2.5 px-3">기간</th>
                <th className="py-2.5 px-3 text-right">블록 보상</th>
                <th className="py-2.5 px-3 text-right">일일 신규 발행량</th>
                <th className="py-2.5 px-3 text-right">연간 공급 인플레이션</th>
                <th className="py-2.5 px-3 text-right">수수료 포함 실제 채굴 수익</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs">
              {epochRevenueTable.map((row) => (
                <tr
                  key={row.epoch}
                  className={
                    row.current
                      ? 'bg-slate-800/45 text-slate-100 font-medium'
                      : 'hover:bg-slate-800/30 text-slate-300'
                  }
                >
                  <td className="py-2.5 px-3">{row.epoch}</td>
                  <td className="py-2.5 px-3 font-mono-tabular text-slate-400">{row.period}</td>
                  <td className="py-2.5 px-3 text-right font-mono-tabular">
                    {row.reward} BTC
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono-tabular">
                    {row.dailyBtc.toLocaleString()} BTC
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono-tabular text-slate-400">
                    {row.annualInflation}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono-tabular">
                    {row.status === 'current' ? (
                      <span className="text-emerald-300">
                        {formatUsd(summary.dailyTotalRevenueUsd, 0)}/일 (24h 수수료 포함 실측)
                      </span>
                    ) : row.status === 'past' ? (
                      <span className="text-slate-500">미지원 (Coin Metrics 무료 플랜 403 제한)</span>
                    ) : (
                      <span className="text-slate-500">미도래 (2028년 이후 예정)</span>
                    )}
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
