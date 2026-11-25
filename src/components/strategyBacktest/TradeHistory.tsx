import React, { useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type {
  ExitReason,
  TradeChartCandle,
  TradeDetailWindowResponse,
  TradeDirection,
  TradeRecord,
} from '../../types/strategyBacktest';

interface TradeHistoryProps {
  trades: TradeRecord[];
  totalTradesRecorded: number;
  selectedTradeWindow: TradeDetailWindowResponse | null;
  loadingTradeWindow: boolean;
  onSelectTrade: (trade: TradeRecord) => void;
}

function fmtTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

function fmtPrice(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}

function fmtSignedUsd(v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function findNearestCandleIdx(candles: TradeChartCandle[], targetMs: number): number {
  if (candles.length === 0) return 0;
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < candles.length; i++) {
    const d = Math.abs(candles[i].openTimeMs - targetMs);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

const EXIT_REASON_FILTERS: Array<{ value: 'ALL' | ExitReason; label: string }> = [
  { value: 'ALL', label: '전체 사유' },
  { value: 'TP2_FULL_TARGET', label: '2차 익절' },
  { value: 'BREAKEVEN_STOP', label: '본절 스탑' },
  { value: 'CLOSE_STOP_LOSS', label: '종가 손절' },
  { value: 'END_OF_DATA', label: '기간 종료' },
];

export const TradeHistory: React.FC<TradeHistoryProps> = ({
  trades,
  totalTradesRecorded,
  selectedTradeWindow,
  loadingTradeWindow,
  onSelectTrade,
}) => {
  const [directionFilter, setDirectionFilter] = useState<'ALL' | TradeDirection>('ALL');
  const [exitFilter, setExitFilter] = useState<'ALL' | ExitReason>('ALL');
  const [newestFirst, setNewestFirst] = useState<boolean>(true);
  const [page, setPage] = useState<number>(1);
  const [hoverCandleIdx, setHoverCandleIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const pageSize = 50;

  const filteredTrades = useMemo(() => {
    const filtered = trades.filter((t) => {
      if (directionFilter !== 'ALL' && t.direction !== directionFilter) return false;
      if (exitFilter !== 'ALL' && t.exitReason !== exitFilter) return false;
      return true;
    });
    return newestFirst ? [...filtered].reverse() : filtered;
  }, [trades, directionFilter, exitFilter, newestFirst]);

  const totalPages = Math.max(1, Math.ceil(filteredTrades.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageTrades = filteredTrades.slice((safePage - 1) * pageSize, safePage * pageSize);

  const selectedTrade = selectedTradeWindow?.trade ?? null;

  // Candlestick SVG model
  const chartW = 1120;
  const chartH = 340;
  const pad = { top: 20, right: 76, bottom: 26, left: 16 };
  const innerW = chartW - pad.left - pad.right;
  const innerH = chartH - pad.top - pad.bottom;

  const chartModel = useMemo(() => {
    if (!selectedTradeWindow || selectedTradeWindow.candles.length === 0) return null;
    const { candles, trade } = selectedTradeWindow;

    let minP = Math.min(trade.initialStopPrice, trade.entryPrice, trade.tp1Price, trade.tp2Price);
    let maxP = Math.max(trade.initialStopPrice, trade.entryPrice, trade.tp1Price, trade.tp2Price);
    let maxVol = 1;

    for (const c of candles) {
      if (c.low < minP) minP = c.low;
      if (c.high > maxP) maxP = c.high;
      if (c.volume > maxVol) maxVol = c.volume;
    }

    const pPad = Math.max(10, (maxP - minP) * 0.08);
    minP -= pPad;
    maxP += pPad;
    const spanP = Math.max(1e-6, maxP - minP);

    const stepX = innerW / Math.max(1, candles.length);
    const bodyW = Math.max(2, Math.min(9, stepX * 0.65));
    const xAt = (idx: number) => pad.left + (idx + 0.5) * stepX;
    const yOf = (price: number) => pad.top + innerH - ((price - minP) / spanP) * innerH;

    const entryIdx = findNearestCandleIdx(candles, trade.entryTimeMs);
    const exitIdx = findNearestCandleIdx(candles, trade.exitTimeMs);
    const tp1Idx = trade.tp1TimeMs !== null ? findNearestCandleIdx(candles, trade.tp1TimeMs) : null;

    const ticks = [minP, minP + spanP * 0.33, minP + spanP * 0.66, maxP];

    return {
      candles,
      trade,
      stepX,
      bodyW,
      xAt,
      yOf,
      maxVol,
      entryIdx,
      exitIdx,
      tp1Idx,
      ticks,
    };
  }, [selectedTradeWindow, innerW, innerH, pad.left, pad.top]);

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || !chartModel) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * chartW;
    const idx = Math.floor((svgX - pad.left) / chartModel.stepX);
    if (idx >= 0 && idx < chartModel.candles.length) {
      setHoverCandleIdx(idx);
    } else {
      setHoverCandleIdx(null);
    }
  };

  const hoverCandle =
    chartModel && hoverCandleIdx !== null ? chartModel.candles[hoverCandleIdx] : null;

  return (
    <section
      id="strategy-trades"
      className="mx-auto w-full max-w-[1440px] px-5 py-6 space-y-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-100">
            거래 내역 및 개별 매매 5분봉 캔들 검증
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            아래 표에서 거래 행을 클릭하면 해당 거래의 기준선(Pivot), 진입가, TP1, TP2, 실제 청산 시점을 5분봉 차트와 체결 원장으로 검증할 수 있습니다.
          </p>
        </div>
        <span className="text-[11px] font-mono-tabular text-slate-400">
          전체 {totalTradesRecorded.toLocaleString()}건 중 {trades.length.toLocaleString()}건 로드됨
        </span>
      </div>

      {/* Selected Trade 5m Candlestick Chart & Execution Legs */}
      <div className="rounded-lg border border-slate-800 bg-[#0C121E] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {selectedTrade ? (
            <div className="flex flex-wrap items-center gap-4 text-xs font-mono-tabular">
              <span className="font-sans font-semibold text-slate-100">
                거래 #{selectedTrade.tradeId}
              </span>
              <span
                className={`font-semibold ${
                  selectedTrade.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {selectedTrade.direction}
              </span>
              <span className="text-slate-300">진입 {fmtPrice(selectedTrade.entryPrice)}</span>
              <span className="text-amber-300">기준선(SL) {fmtPrice(selectedTrade.initialStopPrice)}</span>
              <span className="text-emerald-300">TP1 {fmtPrice(selectedTrade.tp1Price)}</span>
              <span className="text-sky-300">TP2 {fmtPrice(selectedTrade.tp2Price)}</span>
              <span
                className={`font-semibold ${
                  selectedTrade.netPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                순손익 {fmtSignedUsd(selectedTrade.netPnlUsd)} ({selectedTrade.exitReasonLabel})
              </span>
            </div>
          ) : (
            <span className="text-xs text-slate-400">표시할 선택 거래가 없습니다.</span>
          )}

          {hoverCandle && (
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono-tabular text-slate-300">
              <span>{fmtTime(hoverCandle.openTimeMs)} UTC</span>
              <span>O {hoverCandle.open.toFixed(1)}</span>
              <span>H {hoverCandle.high.toFixed(1)}</span>
              <span>L {hoverCandle.low.toFixed(1)}</span>
              <span>C {hoverCandle.close.toFixed(1)}</span>
            </div>
          )}
        </div>

        <div className="relative rounded border border-slate-800/80 bg-[#090D16] p-2">
          {loadingTradeWindow && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#090D16]/70 text-xs text-slate-300 gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-sky-400" />
              <span>5분봉 캔들 로딩 중...</span>
            </div>
          )}

          {chartModel ? (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${chartW} ${chartH}`}
              className="w-full h-auto select-none cursor-crosshair"
              onMouseMove={handleSvgMouseMove}
              onMouseLeave={() => setHoverCandleIdx(null)}
            >
              {/* Horizontal price grid */}
              {chartModel.ticks.map((p, idx) => {
                const y = chartModel.yOf(p);
                return (
                  <g key={idx}>
                    <line
                      x1={pad.left}
                      x2={chartW - pad.right}
                      y1={y}
                      y2={y}
                      stroke="#1E293B"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={chartW - pad.right + 6}
                      y={y + 3}
                      fill="#64748B"
                      fontSize="10"
                      className="font-mono-tabular"
                    >
                      ${p.toFixed(0)}
                    </text>
                  </g>
                );
              })}

              {/* Strategy Reference Levels: Pivot/SL, Entry, TP1, TP2 */}
              {[
                {
                  label: 'Pivot/SL',
                  price: chartModel.trade.initialStopPrice,
                  color: '#F59E0B',
                  dash: '4 3',
                },
                {
                  label: 'Entry',
                  price: chartModel.trade.entryPrice,
                  color: '#38BDF8',
                  dash: undefined,
                },
                {
                  label: 'TP1',
                  price: chartModel.trade.tp1Price,
                  color: '#10B981',
                  dash: '4 3',
                },
                {
                  label: 'TP2',
                  price: chartModel.trade.tp2Price,
                  color: '#34D399',
                  dash: '2 2',
                },
              ].map((lvl) => {
                const y = chartModel.yOf(lvl.price);
                return (
                  <g key={lvl.label}>
                    <line
                      x1={pad.left}
                      x2={chartW - pad.right}
                      y1={y}
                      y2={y}
                      stroke={lvl.color}
                      strokeWidth="1"
                      strokeOpacity={0.75}
                      strokeDasharray={lvl.dash}
                    />
                    <text
                      x={pad.left + 4}
                      y={y - 3}
                      fill={lvl.color}
                      fontSize="9.5"
                      fontWeight="600"
                      className="font-mono-tabular"
                    >
                      {lvl.label} ${lvl.price.toFixed(1)}
                    </text>
                  </g>
                );
              })}

              {/* Candles & Volume */}
              {chartModel.candles.map((c, idx) => {
                const x = chartModel.xAt(idx);
                const isUp = c.close >= c.open;
                const col = isUp ? '#10B981' : '#F43F5E';
                const yHigh = chartModel.yOf(c.high);
                const yLow = chartModel.yOf(c.low);
                const yOpen = chartModel.yOf(c.open);
                const yClose = chartModel.yOf(c.close);
                const topBody = Math.min(yOpen, yClose);
                const bodyH = Math.max(1.2, Math.abs(yClose - yOpen));

                const volH = (c.volume / chartModel.maxVol) * 34;

                return (
                  <g key={c.openTimeMs}>
                    <rect
                      x={x - chartModel.bodyW / 2}
                      y={chartH - pad.bottom - volH}
                      width={chartModel.bodyW}
                      height={volH}
                      fill={col}
                      fillOpacity={0.14}
                    />
                    <line x1={x} x2={x} y1={yHigh} y2={yLow} stroke={col} strokeWidth="1" />
                    <rect
                      x={x - chartModel.bodyW / 2}
                      y={topBody}
                      width={chartModel.bodyW}
                      height={bodyH}
                      fill={col}
                      fillOpacity={isUp ? 0.85 : 0.9}
                    />
                  </g>
                );
              })}

              {/* Entry, TP1, Exit Event Markers */}
              {(() => {
                const ex = chartModel.xAt(chartModel.entryIdx);
                const ey = chartModel.yOf(chartModel.trade.entryPrice);
                const fx = chartModel.xAt(chartModel.exitIdx);
                const fy = chartModel.yOf(chartModel.trade.finalExitPrice);
                const t1x =
                  chartModel.tp1Idx !== null ? chartModel.xAt(chartModel.tp1Idx) : null;
                const t1y =
                  chartModel.trade.tp1FillPrice !== null
                    ? chartModel.yOf(chartModel.trade.tp1FillPrice)
                    : null;

                return (
                  <g pointerEvents="none">
                    <circle cx={ex} cy={ey} r={4.5} fill="#38BDF8" stroke="#090D16" strokeWidth="1.5" />
                    <text x={ex} y={ey - 8} textAnchor="middle" fill="#7DD3FC" fontSize="9.5" fontWeight="700">
                      진입
                    </text>

                    {t1x !== null && t1y !== null && (
                      <>
                        <circle cx={t1x} cy={t1y} r={4} fill="#10B981" stroke="#090D16" strokeWidth="1.5" />
                        <text x={t1x} y={t1y - 8} textAnchor="middle" fill="#6EE7B7" fontSize="9.5" fontWeight="700">
                          TP1
                        </text>
                      </>
                    )}

                    <circle
                      cx={fx}
                      cy={fy}
                      r={4.5}
                      fill={chartModel.trade.netPnlUsd >= 0 ? '#34D399' : '#FB7185'}
                      stroke="#090D16"
                      strokeWidth="1.5"
                    />
                    <text
                      x={fx}
                      y={fy + 14}
                      textAnchor="middle"
                      fill={chartModel.trade.netPnlUsd >= 0 ? '#6EE7B7' : '#FDA4AF'}
                      fontSize="9.5"
                      fontWeight="700"
                    >
                      청산
                    </text>
                  </g>
                );
              })()}

              {/* Hover vertical crosshair */}
              {hoverCandleIdx !== null && (
                <line
                  x1={chartModel.xAt(hoverCandleIdx)}
                  x2={chartModel.xAt(hoverCandleIdx)}
                  y1={pad.top}
                  y2={chartH - pad.bottom}
                  stroke="#94A3B8"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                  pointerEvents="none"
                />
              )}
            </svg>
          ) : (
            <div className="h-[240px] flex items-center justify-center text-xs text-slate-500">
              거래 행을 선택하면 5분봉 진입/청산 상세 차트가 표시됩니다.
            </div>
          )}
        </div>

        {/* Execution Legs Breakdown for Selected Trade */}
        {selectedTrade && selectedTrade.legs.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] border-collapse font-mono-tabular">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-sans">
                  <th className="py-1.5 pr-3">체결 단계</th>
                  <th className="py-1.5 px-3">일시 (UTC)</th>
                  <th className="py-1.5 px-3 text-right">체결 가격</th>
                  <th className="py-1.5 px-3 text-right">수량 비중</th>
                  <th className="py-1.5 px-3 text-right">수수료 (USDT)</th>
                  <th className="py-1.5 px-3 text-right">슬리피지 (USDT)</th>
                  <th className="py-1.5 pl-3 text-right">단계 실현 순손익</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {selectedTrade.legs.map((leg, i) => (
                  <tr key={`${leg.type}-${i}`}>
                    <td className="py-1.5 pr-3 font-sans font-medium text-slate-200">
                      {leg.type === 'ENTRY'
                        ? '진입 체결'
                        : leg.type === 'TP1_PARTIAL'
                          ? '1차 익절 (50%)'
                          : '최종 청산'}
                    </td>
                    <td className="py-1.5 px-3 text-slate-300">{fmtTime(leg.timestampMs)}</td>
                    <td className="py-1.5 px-3 text-right text-slate-100">{fmtPrice(leg.price)}</td>
                    <td className="py-1.5 px-3 text-right text-slate-300">
                      {(leg.qtyRatio * 100).toFixed(0)}%
                    </td>
                    <td className="py-1.5 px-3 text-right text-slate-400">
                      ${leg.feeUsd.toFixed(2)}
                    </td>
                    <td className="py-1.5 px-3 text-right text-slate-400">
                      ${leg.slippageCostUsd.toFixed(2)}
                    </td>
                    <td
                      className={`py-1.5 pl-3 text-right font-semibold ${
                        leg.realizedPnlUsd > 0
                          ? 'text-emerald-400'
                          : leg.realizedPnlUsd < 0
                            ? 'text-rose-400'
                            : 'text-slate-400'
                      }`}
                    >
                      {fmtSignedUsd(leg.realizedPnlUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Filters & Trade Ledger Table */}
      <div className="rounded-lg border border-slate-800 bg-[#0C121E] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-400">방향</span>
            {(['ALL', 'LONG', 'SHORT'] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => {
                  setDirectionFilter(dir);
                  setPage(1);
                }}
                className={`px-2.5 py-1 rounded border text-[11px] cursor-pointer ${
                  directionFilter === dir
                    ? 'border-sky-500/60 bg-sky-500/15 text-sky-300'
                    : 'border-slate-800 bg-[#090D16] text-slate-400 hover:text-slate-200'
                }`}
              >
                {dir === 'ALL' ? '전체' : dir}
              </button>
            ))}

            <span className="text-[11px] text-slate-400 ml-2">청산 사유</span>
            <select
              value={exitFilter}
              onChange={(e) => {
                setExitFilter(e.target.value as 'ALL' | ExitReason);
                setPage(1);
              }}
              className="rounded border border-slate-700 bg-[#090D16] px-2.5 py-1 text-[11px] text-slate-200 focus:border-sky-400 focus:outline-none"
            >
              {EXIT_REASON_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 text-[11px] font-mono-tabular text-slate-400">
            <button
              type="button"
              onClick={() => {
                setNewestFirst((v) => !v);
                setPage(1);
              }}
              className="rounded border border-slate-700 bg-[#090D16] px-2.5 py-1 text-slate-300 hover:text-white cursor-pointer"
            >
              정렬: {newestFirst ? '최신순' : '과거순'}
            </button>
            <span>필터 결과 {filteredTrades.length.toLocaleString()}건</span>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
          <table className="w-full text-left text-xs border-collapse font-mono-tabular">
            <thead className="sticky top-0 bg-[#0C121E] z-10">
              <tr className="border-b border-slate-800 text-[11px] text-slate-400 font-sans">
                <th className="py-2 pr-2">#</th>
                <th className="py-2 px-2">진입 일시 (UTC)</th>
                <th className="py-2 px-2">청산 일시 (UTC)</th>
                <th className="py-2 px-2">방향</th>
                <th className="py-2 px-2 text-right">진입가</th>
                <th className="py-2 px-2 text-right">손절가 (Pivot)</th>
                <th className="py-2 px-2 text-center">1차 익절</th>
                <th className="py-2 px-2 text-center">2차 익절</th>
                <th className="py-2 px-2 text-right">청산가</th>
                <th className="py-2 px-2 text-right">순손익</th>
                <th className="py-2 px-2 text-right">증거금 수익률</th>
                <th className="py-2 px-2 text-right">보유</th>
                <th className="py-2 pl-2">청산 사유</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {pageTrades.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-10 text-center font-sans text-slate-500">
                    조건에 일치하는 거래 내역이 없습니다.
                  </td>
                </tr>
              ) : (
                pageTrades.map((t) => {
                  const isSelected = selectedTrade?.tradeId === t.tradeId;
                  return (
                    <tr
                      key={t.tradeId}
                      onClick={() => onSelectTrade(t)}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-sky-500/15' : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-2 pr-2 text-slate-400">{t.tradeId}</td>
                      <td className="py-2 px-2 text-slate-300 whitespace-nowrap">
                        {fmtTime(t.entryTimeMs)}
                      </td>
                      <td className="py-2 px-2 text-slate-300 whitespace-nowrap">
                        {fmtTime(t.exitTimeMs)}
                      </td>
                      <td
                        className={`py-2 px-2 font-sans font-semibold ${
                          t.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {t.direction}
                      </td>
                      <td className="py-2 px-2 text-right text-slate-100">{fmtPrice(t.entryPrice)}</td>
                      <td className="py-2 px-2 text-right text-amber-300/90">
                        {fmtPrice(t.initialStopPrice)}
                      </td>
                      <td className="py-2 px-2 text-center text-slate-300">
                        {t.tp1Hit ? (
                          <span className="text-emerald-400">O</span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-center text-slate-300">
                        {t.tp2Hit ? (
                          <span className="text-emerald-300">O</span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right text-slate-200">
                        {fmtPrice(t.finalExitPrice)}
                      </td>
                      <td
                        className={`py-2 px-2 text-right font-semibold ${
                          t.netPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {fmtSignedUsd(t.netPnlUsd)}
                      </td>
                      <td
                        className={`py-2 px-2 text-right ${
                          t.netReturnOnMarginPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {t.netReturnOnMarginPct >= 0 ? '+' : ''}
                        {t.netReturnOnMarginPct.toFixed(2)}%
                      </td>
                      <td className="py-2 px-2 text-right text-slate-400">
                        {t.holdingMinutes}m
                      </td>
                      <td className="py-2 pl-2 font-sans text-slate-300 whitespace-nowrap">
                        {t.exitReasonLabel}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[11px] font-mono-tabular text-slate-400">
            <span>
              페이지 {safePage} / {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-slate-700 bg-[#090D16] px-2.5 py-1 text-slate-300 hover:text-white disabled:opacity-40 cursor-pointer"
              >
                이전
              </button>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded border border-slate-700 bg-[#090D16] px-2.5 py-1 text-slate-300 hover:text-white disabled:opacity-40 cursor-pointer"
              >
                다음
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
