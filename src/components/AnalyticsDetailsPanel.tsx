import React, { useMemo, useState } from 'react';
import type {
  ExpectedMovePoint,
  LiquidationSummary,
  MarketSnapshot,
  MaxPainAnalysis,
} from '../types/derivatives';
import {
  formatPercent,
  formatSignedUsd,
  formatUsd,
  formatUsdMillions,
} from '../utils/analytics';

interface AnalyticsDetailsPanelProps {
  snapshot: MarketSnapshot;
  expectedMoves: ExpectedMovePoint[];
  maxPain: MaxPainAnalysis;
  liquidationSummary: LiquidationSummary;
  selectedTenor: string | null;
  onSelectTenor: (tenor: string | null) => void;
}

type LiqFilter = 'all' | 'short_above' | 'long_below';

export const AnalyticsDetailsPanel: React.FC<AnalyticsDetailsPanelProps> = ({
  snapshot,
  expectedMoves,
  maxPain,
  liquidationSummary,
  selectedTenor,
  onSelectTenor,
}) => {
  const [liqFilter, setLiqFilter] = useState<LiqFilter>('all');

  const filteredLiqBins = useMemo(() => {
    const sorted = [...snapshot.liquidationBins].sort((a, b) => b.midPrice - a.midPrice);
    if (liqFilter === 'short_above') {
      return sorted.filter((b) => b.midPrice >= snapshot.currentPrice);
    }
    if (liqFilter === 'long_below') {
      return sorted.filter((b) => b.midPrice < snapshot.currentPrice);
    }
    // Show relevant active range around spot (+/- 28%) to keep table scannable
    return sorted.filter(
      (b) =>
        b.midPrice >= snapshot.currentPrice * 0.74 &&
        b.midPrice <= snapshot.currentPrice * 1.28,
    );
  }, [snapshot.liquidationBins, snapshot.currentPrice, liqFilter]);

  // Precompute max settlement value for inline Max Pain curve SVG
  const maxSettlement = useMemo(() => {
    let m = 1;
    for (const pt of maxPain.curve) {
      if (pt.totalSettlementUsdM > m) m = pt.totalSettlementUsdM;
    }
    return m;
  }, [maxPain.curve]);

  const maxStrikeOi = useMemo(() => {
    let m = 1;
    for (const pt of maxPain.curve) {
      m = Math.max(m, pt.callOiBtc, pt.putOiBtc);
    }
    return m;
  }, [maxPain.curve]);

  return (
    <div className="mx-auto w-full max-w-[1440px] px-5 py-8 space-y-12">
      {/* Section 1: Option IV & Expected Volatility Table */}
      <section id="iv-analysis" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-slate-800/80 pb-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-100">
              만기별 옵션 IV 및 기대 변동성 범위 (최대 365일)
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              기대 변동폭 = 현재 BTC 가격 × ATM IV × √(만기까지 남은 일수 / 365) · 행을 클릭하면 상단 통합 차트에서 해당 만기가 강조됩니다.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400 font-mono-tabular">
            <span>기준가 {formatUsd(snapshot.currentPrice, 0)}</span>
            <span aria-hidden="true">·</span>
            <span>분석 만기 {expectedMoves.length}개</span>
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-800/80 bg-[#0C121E]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                <th className="py-2.5 px-3">만기</th>
                <th className="py-2.5 px-3">만기일</th>
                <th className="py-2.5 px-3 text-right">잔여 일수</th>
                <th className="py-2.5 px-3 text-right">대표 ATM IV</th>
                <th className="py-2.5 px-3 text-right">Call / Put IV</th>
                <th className="py-2.5 px-3">IV 기준</th>
                <th className="py-2.5 px-3 text-right">1σ 기대 변동폭</th>
                <th className="py-2.5 px-3 text-right">기대 상단 (+1σ)</th>
                <th className="py-2.5 px-3 text-right">기대 하단 (-1σ)</th>
                <th className="py-2.5 px-3 text-right">만기 OI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs">
              {expectedMoves.map((row) => {
                const isSelected = selectedTenor === row.tenor;
                return (
                  <tr
                    key={row.tenor}
                    onClick={() => onSelectTenor(isSelected ? null : row.tenor)}
                    className={`transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-sky-500/12 text-slate-100'
                        : 'hover:bg-slate-800/40 text-slate-300'
                    }`}
                  >
                    <td className="py-2.5 px-3 font-mono-tabular font-semibold text-sky-300">
                      {row.tenor}
                    </td>
                    <td className="py-2.5 px-3 font-mono-tabular text-slate-400">
                      {row.expiryDate}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-tabular">
                      {row.daysToExpiry < 2
                        ? `${row.daysToExpiry.toFixed(1)}일`
                        : `${Math.round(row.daysToExpiry)}일`}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-tabular font-semibold text-slate-100">
                      {(row.atmIv * 100).toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-tabular text-slate-400">
                      {(row.callIv * 100).toFixed(1)}% / {(row.putIv * 100).toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-3 text-slate-400">
                      {row.ivSource === 'atm_direct' ? 'ATM 직접 관측' : '만기 보간'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-tabular text-sky-300">
                      ±{formatUsd(row.expectedMoveUsd, 0)} (±{formatPercent(row.expectedMovePct, 1)})
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-tabular text-emerald-300">
                      {formatUsd(row.upper1Sigma, 0)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-tabular text-rose-300">
                      {formatUsd(row.lower1Sigma, 0)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-tabular text-slate-400">
                      {row.tenorOiBtc.toLocaleString(undefined, { maximumFractionDigits: 1 })} BTC
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 2: OI-Based Max Pain Analysis */}
      <section id="max-pain" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-slate-800/80 pb-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-100">
              옵션 미결제약정(OI) 기반 Max Pain 분포
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              행사가별 콜·풋 미결제약정을 합산해 만기 정산 시 옵션 매수자 만기 손실(결제 가치) 합계가 최소가 되는 지점을 산출합니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono-tabular">
            <span className="text-amber-300 font-semibold">
              Max Pain {formatUsd(maxPain.maxPainPrice, 0)}
            </span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span className="text-slate-300">
              현재가 괴리 {formatSignedUsd(maxPain.diffFromSpotUsd, 0)} ({formatPercent(maxPain.diffFromSpotPct, 2, true)})
            </span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span className="text-slate-400">
              P/C Ratio {maxPain.putCallRatio.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Compact Inline Settlement Loss & OI Visualization */}
          <div className="lg:col-span-5 border border-slate-800/80 bg-[#0C121E] p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-300">
                행사가별 콜/풋 OI 및 만기 손실 합계 곡선
              </span>
              <span className="text-[11px] font-mono-tabular text-amber-300">
                최소점: {formatUsd(maxPain.maxPainPrice, 0)}
              </span>
            </div>

            <div className="w-full overflow-hidden">
              <svg viewBox="0 0 460 220" className="w-full h-56">
                {maxPain.curve.map((pt, idx) => {
                  const n = maxPain.curve.length;
                  const xBand = 380 / Math.max(1, n);
                  const cx = 42 + idx * xBand + xBand / 2;
                  const barW = Math.max(1.5, xBand * 0.36);
                  const labelStep = Math.max(1, Math.ceil(n / 10));

                  const callH = (pt.callOiBtc / maxStrikeOi) * 145;
                  const putH = (pt.putOiBtc / maxStrikeOi) * 145;
                  const isMaxPain = pt.strike === maxPain.maxPainPrice;

                  return (
                    <g key={pt.strike}>
                      {isMaxPain && (
                        <rect
                          x={cx - xBand / 2}
                          y={14}
                          width={Math.max(2, xBand)}
                          height={172}
                          fill="#F59E0B"
                          opacity={0.14}
                        />
                      )}
                      {/* Call OI Bar */}
                      <rect
                        x={cx - barW - 0.5}
                        y={186 - callH}
                        width={barW}
                        height={callH}
                        fill="#38BDF8"
                        opacity={0.65}
                      />
                      {/* Put OI Bar */}
                      <rect
                        x={cx + 0.5}
                        y={186 - putH}
                        width={barW}
                        height={putH}
                        fill="#FB7185"
                        opacity={0.65}
                      />
                      {idx % labelStep === 0 && (
                        <text
                          x={cx}
                          y={204}
                          textAnchor="middle"
                          fill="#64748B"
                          fontSize={9}
                          fontFamily="var(--font-mono)"
                        >
                          {pt.strike >= 1000 ? `${Math.round(pt.strike / 1000)}k` : pt.strike}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Settlement Value Curve (U-shape whose minimum = Max Pain) */}
                <polyline
                  points={maxPain.curve
                    .map((pt, idx) => {
                      const n = maxPain.curve.length;
                      const xBand = 380 / Math.max(1, n);
                      const cx = 42 + idx * xBand + xBand / 2;
                      const cy = 180 - (pt.totalSettlementUsdM / maxSettlement) * 155;
                      return `${cx.toFixed(1)},${cy.toFixed(1)}`;
                    })
                    .join(' ')}
                  fill="none"
                  stroke="#F59E0B"
                  strokeWidth={2}
                />

                {/* Highlight Max Pain Minimum Point */}
                {(() => {
                  const idx = maxPain.curve.findIndex((c) => c.strike === maxPain.maxPainPrice);
                  if (idx < 0) return null;
                  const pt = maxPain.curve[idx];
                  const n = maxPain.curve.length;
                  const xBand = 380 / Math.max(1, n);
                  const cx = 42 + idx * xBand + xBand / 2;
                  const cy = 180 - (pt.totalSettlementUsdM / maxSettlement) * 155;
                  return (
                    <g>
                      <circle cx={cx} cy={cy} r={4.5} fill="#F59E0B" stroke="#090D16" strokeWidth={1.5} />
                      <text
                        x={cx}
                        y={cy - 10}
                        textAnchor="middle"
                        fill="#FCD34D"
                        fontSize={10}
                        fontWeight={600}
                        fontFamily="var(--font-mono)"
                      >
                        최소 {formatUsd(pt.strike, 0)}
                      </text>
                    </g>
                  );
                })()}
              </svg>
            </div>

            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/70 pt-2">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 bg-sky-400 inline-block" /> Call OI
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 bg-rose-400 inline-block" /> Put OI
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-0.5 w-3 bg-amber-400 inline-block" /> 만기 정산 합계
                </span>
              </div>
              <span className="font-mono-tabular">
                총 OI{' '}
                {(maxPain.totalCallOiBtc + maxPain.totalPutOiBtc).toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                })}{' '}
                BTC
              </span>
            </div>
          </div>

          {/* Strike OI & Settlement Table */}
          <div className="lg:col-span-7 overflow-x-auto border border-slate-800/80 bg-[#0C121E] max-h-[320px] overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-[#0C121E] z-10">
                <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                  <th className="py-2.5 px-3">행사가 (Strike)</th>
                  <th className="py-2.5 px-3 text-right">Call OI</th>
                  <th className="py-2.5 px-3 text-right">Put OI</th>
                  <th className="py-2.5 px-3 text-right">Call 정산액</th>
                  <th className="py-2.5 px-3 text-right">Put 정산액</th>
                  <th className="py-2.5 px-3 text-right">총 정산 손실 합계</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {maxPain.curve.map((row) => {
                  const isMp = row.strike === maxPain.maxPainPrice;
                  return (
                    <tr
                      key={row.strike}
                      className={
                        isMp
                          ? 'bg-amber-500/14 text-amber-200 font-semibold'
                          : 'hover:bg-slate-800/40 text-slate-300'
                      }
                    >
                      <td className="py-2 px-3 font-mono-tabular">
                        {formatUsd(row.strike, 0)}
                        {isMp && (
                          <span className="ml-2 text-[10px] text-amber-300 font-sans">
                            Max Pain
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-mono-tabular text-sky-300">
                        {row.callOiBtc.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right font-mono-tabular text-rose-300">
                        {row.putOiBtc.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right font-mono-tabular text-slate-400">
                        {formatUsdMillions(row.callSettlementUsdM)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono-tabular text-slate-400">
                        {formatUsdMillions(row.putSettlementUsdM)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono-tabular">
                        {formatUsdMillions(row.totalSettlementUsdM)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Section 3: Price-Bucketed Liquidation Table or Explicit Unsupported Notice */}
      <section id="liquidations" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-100">
              가격 구간별 청산 물량 분포
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              레버리지 미결제약정 기반의 <strong>추정 청산 유동성</strong>과 <strong>실제 청산 체결</strong>은 실제 거래소·청산 피드가 연결된 경우에만 표시됩니다.
            </p>
          </div>

          {snapshot.liquidationSupport.supported && (
            <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-slate-900/90 p-0.5">
              {(
                [
                  { id: 'all', label: '전체 주요 구간' },
                  { id: 'short_above', label: '상방 숏 청산' },
                  { id: 'long_below', label: '하방 롱 청산' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setLiqFilter(tab.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    liqFilter === tab.id
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {!snapshot.liquidationSupport.supported ? (
          <div className="border border-slate-800/80 bg-[#0C121E] p-5 space-y-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-amber-300">
                데이터 미지원 · 실제 가격 구간별 청산 API 미연결
              </span>
              <span className="font-mono-tabular text-slate-500">
                유료 파생상품 데이터 키 필요 (CoinGlass / Hyblock 등)
              </span>
            </div>
            <p className="text-slate-300 leading-relaxed">
              {snapshot.liquidationSupport.reason}
            </p>
            <p className="text-slate-500 leading-relaxed">
              실제 가격별 레버리지 포지션 분포 데이터가 확보되지 않은 상태에서 임의의 청산 바나 추정치를 생성하지 않습니다.
            </p>
          </div>
        ) : (
          <>
            {/* Summary strip (unboxed hairline grid) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 border border-slate-800/80 bg-[#0C121E] divide-y lg:divide-y-0 lg:divide-x divide-slate-800/80">
              <div className="p-3.5">
                <div className="text-[11px] text-slate-400">추정 숏 청산 대기 (Estimated)</div>
                <div className="mt-1 font-mono-tabular text-base font-semibold text-rose-300">
                  {formatUsdMillions(liquidationSummary.totalEstimatedShortUsdM)}
                </div>
              </div>
              <div className="p-3.5">
                <div className="text-[11px] text-slate-400">추정 롱 청산 대기 (Estimated)</div>
                <div className="mt-1 font-mono-tabular text-base font-semibold text-emerald-300">
                  {formatUsdMillions(liquidationSummary.totalEstimatedLongUsdM)}
                </div>
              </div>
              <div className="p-3.5">
                <div className="text-[11px] text-slate-400">24h 실제 숏 청산 (Realized)</div>
                <div className="mt-1 font-mono-tabular text-base font-semibold text-rose-400">
                  {formatUsdMillions(liquidationSummary.totalRealizedShortUsdM)}
                </div>
              </div>
              <div className="p-3.5">
                <div className="text-[11px] text-slate-400">24h 실제 롱 청산 (Realized)</div>
                <div className="mt-1 font-mono-tabular text-base font-semibold text-emerald-400">
                  {formatUsdMillions(liquidationSummary.totalRealizedLongUsdM)}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-800/80 bg-[#0C121E] max-h-[340px] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-[#0C121E] z-10">
                  <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400">
                    <th className="py-2.5 px-3">가격 구간</th>
                    <th className="py-2.5 px-3 text-right">현재가 대비</th>
                    <th className="py-2.5 px-3">추정 레버리지</th>
                    <th className="py-2.5 px-3 text-right">숏 추정 (Estimated)</th>
                    <th className="py-2.5 px-3 text-right">롱 추정 (Estimated)</th>
                    <th className="py-2.5 px-3 text-right">숏 실제 24h (Realized)</th>
                    <th className="py-2.5 px-3 text-right">롱 실제 24h (Realized)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 text-xs">
                  {filteredLiqBins.map((bin) => {
                    const pctDiff = (bin.midPrice - snapshot.currentPrice) / snapshot.currentPrice;
                    const isHighCluster =
                      bin.estimatedShortUsdM + bin.estimatedLongUsdM >
                      liquidationSummary.maxBinTotalUsdM * 0.58;
                    return (
                      <tr
                        key={bin.priceFrom}
                        className={
                          isHighCluster
                            ? 'bg-slate-800/35 text-slate-100'
                            : 'hover:bg-slate-800/30 text-slate-300'
                        }
                      >
                        <td className="py-2 px-3 font-mono-tabular">
                          {formatUsd(bin.priceFrom, 0)} – {formatUsd(bin.priceTo, 0)}
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-mono-tabular ${
                            pctDiff >= 0 ? 'text-rose-300' : 'text-emerald-300'
                          }`}
                        >
                          {formatPercent(pctDiff, 1, true)}
                        </td>
                        <td className="py-2 px-3 font-mono-tabular text-slate-400">
                          {bin.dominantLeverage}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-tabular text-rose-300">
                          {bin.estimatedShortUsdM > 0 ? formatUsdMillions(bin.estimatedShortUsdM) : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-tabular text-emerald-300">
                          {bin.estimatedLongUsdM > 0 ? formatUsdMillions(bin.estimatedLongUsdM) : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-tabular text-rose-400">
                          {bin.realizedShortUsdM > 0 ? formatUsdMillions(bin.realizedShortUsdM) : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-tabular text-emerald-400">
                          {bin.realizedLongUsdM > 0 ? formatUsdMillions(bin.realizedLongUsdM) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Section 4: Live Data Provenance & Quantitative Methodology */}
      <section
        id="architecture"
        className="border-t border-slate-800/80 pt-8 pb-6 grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-slate-400"
      >
        <div>
          <h3 className="text-sm font-semibold text-slate-200 mb-1.5">
            실제 API 연동 출처 및 갱신 주기
          </h3>
          <ul className="space-y-1.5 leading-relaxed">
            <li>
              <strong className="text-slate-200">현물 지수:</strong> {snapshot.provenance.spot.provider} ·{' '}
              {snapshot.provenance.spot.cadence}
            </li>
            <li>
              <strong className="text-slate-200">30일 일봉:</strong> {snapshot.provenance.history30d.provider} ·{' '}
              {snapshot.provenance.history30d.cadence}
            </li>
            <li>
              <strong className="text-slate-200">옵션 체인:</strong> {snapshot.provenance.options.provider} ·{' '}
              {snapshot.provenance.options.cadence}
            </li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-200 mb-1.5">
            실제 관측 vs 직접 계산 vs 미지원
          </h3>
          <p className="leading-relaxed">
            30일 종가·현물 지수·만기별 ATM IV·행사가별 OI(<span className="font-mono-tabular text-slate-300">open_interest × contract_size</span>)는{' '}
            <strong className="text-slate-200">실제 API 데이터</strong>이며, ±1σ 기대 변동범위와 Max Pain 정산가는 실제 옵션 데이터 기반 <strong className="text-slate-200">직접 계산치</strong>입니다. 가격별 청산 히트맵은 공개 API 미제공으로 <strong className="text-amber-300">미지원</strong> 표기합니다.
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-200 mb-1.5">
            단일 가격 좌표계 원칙
          </h3>
          <p className="leading-relaxed">
            과거 30일 일봉 라인, 만기별 옵션 기대 변동성 콘, 전체 및 만기별 OI Max Pain 포인트가 모두 동일한 Y축 가격 변환 함수를 공유하므로 각 레이어 토글 시에도 기준점(가로 1/3 · 세로 1/2)과 상대 위치가 왜곡되지 않습니다.
          </p>
        </div>
      </section>
    </div>
  );
};
