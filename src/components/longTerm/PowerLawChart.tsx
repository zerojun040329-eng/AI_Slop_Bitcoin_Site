import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Minus, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import type {
  HalvingEvent,
  HistoricalPricePoint,
  LongTermScaleMode,
  PowerLawModelSummary,
} from '../../types/longTerm';
import {
  addCalendarMonthsUtc,
  calculatePowerLawPrice,
  calculatePowerLawPriceAtSigma,
  daysSinceGenesisFromIso,
  evaluatePowerLawPoint,
} from '../../utils/longTermAnalytics';
import { formatPercent, formatUsd } from '../../utils/analytics';

interface PowerLawChartProps {
  priceHistory: HistoricalPricePoint[];
  halvings: HalvingEvent[];
  modelSummary: PowerLawModelSummary;
  currentDate: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

interface ViewTransform {
  zoomX: number;
  zoomY: number;
  panX: number;
  panY: number;
}

const DEFAULT_VIEW: ViewTransform = {
  zoomX: 1,
  zoomY: 1,
  panX: 0,
  panY: 0,
};

function formatCompactPrice(price: number): string {
  if (price >= 1_000_000) return `$${(price / 1_000_000).toFixed(1)}M`;
  if (price >= 1000) return `$${Math.round(price / 1000).toLocaleString()}k`;
  if (price >= 1) return `$${price.toFixed(0)}`;
  return `$${price.toFixed(2)}`;
}

function formatTooltipPrice(price: number): string {
  if (price >= 100) return formatUsd(price, 0);
  if (price >= 1) return formatUsd(price, 2);
  return `$${price.toFixed(3)}`;
}

export const PowerLawChart: React.FC<PowerLawChartProps> = ({
  priceHistory,
  halvings,
  modelSummary,
  currentDate,
  onRefresh,
  isRefreshing = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [size, setSize] = useState({ width: 1280, height: 640 });
  const [scaleMode, setScaleMode] = useState<LongTermScaleMode>('log_log');
  const [showPowerLaw, setShowPowerLaw] = useState(true);
  const [showBands, setShowBands] = useState(true);
  const [showHalvings, setShowHalvings] = useState(true);
  const [view, setView] = useState<ViewTransform>(DEFAULT_VIEW);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(640, Math.floor(entry.contentRect.width));
        const h = Math.max(520, Math.floor(entry.contentRect.height));
        setSize({ width: w, height: h });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Reset pan/zoom when switching scale mode so bounds stay well-framed
  const handleScaleChange = useCallback((mode: LongTermScaleMode) => {
    setScaleMode(mode);
    setView(DEFAULT_VIEW);
  }, []);

  const margin = useMemo(
    () => ({
      top: 38,
      bottom: 42,
      left: 22,
      right: 84,
    }),
    [],
  );

  const plotLeft = margin.left;
  const plotRight = Math.max(plotLeft + 300, size.width - margin.right);
  const plotTop = margin.top;
  const plotBottom = Math.max(plotTop + 260, size.height - margin.bottom);
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  const minDays = priceHistory[0]?.daysSinceGenesis ?? 561;
  const lastHistDays = priceHistory[priceHistory.length - 1]?.daysSinceGenesis ?? 6527;
  // Extend slightly to include 5th projected halving in 2028
  const maxDays = Math.max(lastHistDays + 550, 7100);

  const logMinX = Math.log10(minDays);
  const logMaxX = Math.log10(maxDays);

  // Price domain bounds
  const logMinY = Math.log10(0.03);
  const logMaxY = Math.log10(2_500_000);
  const linearMinY = 0;
  const linearMaxY = 280_000;

  const daysToX = useCallback(
    (d: number) => {
      const clamped = Math.max(1, d);
      const frac =
        scaleMode === 'log_log'
          ? (Math.log10(clamped) - logMinX) / (logMaxX - logMinX)
          : (clamped - minDays) / (maxDays - minDays);
      return plotLeft + frac * plotW * view.zoomX + view.panX;
    },
    [scaleMode, logMinX, logMaxX, minDays, maxDays, plotLeft, plotW, view.zoomX, view.panX],
  );

  const xToDays = useCallback(
    (x: number) => {
      const frac = (x - plotLeft - view.panX) / (plotW * view.zoomX);
      if (scaleMode === 'log_log') {
        const logD = logMinX + frac * (logMaxX - logMinX);
        return Math.pow(10, logD);
      }
      return minDays + frac * (maxDays - minDays);
    },
    [plotLeft, view.panX, plotW, view.zoomX, scaleMode, logMinX, logMaxX, minDays, maxDays],
  );

  const priceToY = useCallback(
    (price: number) => {
      if (scaleMode === 'linear') {
        const frac = (price - linearMinY) / (linearMaxY - linearMinY);
        return plotBottom - frac * plotH * view.zoomY + view.panY;
      }
      const safeP = Math.max(0.01, price);
      const frac = (Math.log10(safeP) - logMinY) / (logMaxY - logMinY);
      return plotBottom - frac * plotH * view.zoomY + view.panY;
    },
    [scaleMode, linearMinY, linearMaxY, logMinY, logMaxY, plotBottom, plotH, view.zoomY, view.panY],
  );

  const yToPrice = useCallback(
    (y: number) => {
      const frac = (plotBottom + view.panY - y) / (plotH * view.zoomY);
      if (scaleMode === 'linear') {
        return Math.max(0, linearMinY + frac * (linearMaxY - linearMinY));
      }
      const logP = logMinY + frac * (logMaxY - logMinY);
      return Math.pow(10, logP);
    },
    [plotBottom, view.panY, plotH, view.zoomY, scaleMode, linearMinY, linearMaxY, logMinY, logMaxY],
  );

  // Wheel Zoom centered on pointer
  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.14 : 0.88;

    setView((prev) => {
      if (e.shiftKey) {
        const nextZoomX = Math.min(12, Math.max(0.8, prev.zoomX * factor));
        const ratioX = nextZoomX / prev.zoomX;
        const nextPanX = mx - plotLeft - (mx - plotLeft - prev.panX) * ratioX;
        return { ...prev, zoomX: nextZoomX, panX: nextPanX };
      }

      const nextZoomX = Math.min(12, Math.max(0.8, prev.zoomX * factor));
      const nextZoomY = Math.min(12, Math.max(0.8, prev.zoomY * factor));
      const ratioX = nextZoomX / prev.zoomX;
      const ratioY = nextZoomY / prev.zoomY;

      const nextPanX = mx - plotLeft - (mx - plotLeft - prev.panX) * ratioX;
      const nextPanY = my - plotBottom - (my - plotBottom - prev.panY) * ratioY;

      return {
        zoomX: nextZoomX,
        zoomY: nextZoomY,
        panX: nextPanX,
        panY: nextPanY,
      };
    });
  }, [plotLeft, plotBottom]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        // Ignore synthetic pointer events
      }
      setIsDragging(true);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: view.panX,
        panY: view.panY,
      };
    },
    [view.panX, view.panY],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (svg) {
        const rect = svg.getBoundingClientRect();
        setPointer({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
      }

      const dragOrigin = dragStartRef.current;
      if (isDragging && dragOrigin) {
        const nextPanX = dragOrigin.panX + (e.clientX - dragOrigin.x);
        const nextPanY = dragOrigin.panY + (e.clientY - dragOrigin.y);
        setView((prev) => ({
          ...prev,
          panX: nextPanX,
          panY: nextPanY,
        }));
      }
    },
    [isDragging],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    try {
      if ((e.currentTarget as Element).hasPointerCapture(e.pointerId)) {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  const handlePointerLeave = useCallback(() => {
    setPointer(null);
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  const handleZoomStep = useCallback(
    (factor: number) => {
      const cx = plotLeft + plotW / 2;
      const cy = plotTop + plotH / 2;
      setView((prev) => {
        const nextZoomX = Math.min(12, Math.max(0.8, prev.zoomX * factor));
        const nextZoomY = Math.min(12, Math.max(0.8, prev.zoomY * factor));
        const ratioX = nextZoomX / prev.zoomX;
        const ratioY = nextZoomY / prev.zoomY;
        return {
          zoomX: nextZoomX,
          zoomY: nextZoomY,
          panX: cx - plotLeft - (cx - plotLeft - prev.panX) * ratioX,
          panY: cy - plotBottom - (cy - plotBottom - prev.panY) * ratioY,
        };
      });
    },
    [plotLeft, plotW, plotTop, plotH, plotBottom],
  );

  const handleResetView = useCallback(() => {
    setView(DEFAULT_VIEW);
  }, []);

  // Sample days along [minDays..maxDays] for smooth Power Law curves & 9-tier bands
  const modelSampleDays = useMemo(() => {
    const samples: number[] = [];
    const steps = 110;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const d =
        scaleMode === 'log_log'
          ? Math.pow(10, logMinX + t * (logMaxX - logMinX))
          : minDays + t * (maxDays - minDays);
      samples.push(d);
    }
    return samples;
  }, [scaleMode, logMinX, logMaxX, minDays, maxDays]);

  // 9-Tier Standard Deviation Band Polygons
  const bandPolygons = useMemo(() => {
    if (!showBands) return [];
    const { sigmaLog10, tiers } = modelSummary;
    return tiers.map((tier) => {
      const upperPts: string[] = [];
      const lowerPts: string[] = [];
      for (const d of modelSampleDays) {
        const x = daysToX(d);
        const pMax = calculatePowerLawPriceAtSigma(d, sigmaLog10, tier.sigmaMax);
        const pMin = calculatePowerLawPriceAtSigma(d, sigmaLog10, tier.sigmaMin);
        upperPts.push(`${x.toFixed(1)},${priceToY(pMax).toFixed(1)}`);
        lowerPts.push(`${x.toFixed(1)},${priceToY(pMin).toFixed(1)}`);
      }
      const pts = [...upperPts, ...lowerPts.reverse()].join(' ');
      return {
        tier,
        points: pts,
      };
    });
  }, [showBands, modelSummary, modelSampleDays, daysToX, priceToY]);

  // Key Sigma Reference Lines (-2σ, -1σ, +1σ, +2σ)
  const sigmaBoundaryLines = useMemo(() => {
    if (!showBands) return [];
    const { sigmaLog10 } = modelSummary;
    const levels = [-2, -1, 1, 2];
    return levels.map((sig) => {
      const pts = modelSampleDays
        .map((d) => {
          const x = daysToX(d);
          const p = calculatePowerLawPriceAtSigma(d, sigmaLog10, sig);
          return `${x.toFixed(1)},${priceToY(p).toFixed(1)}`;
        })
        .join(' ');
      return { sig, points: pts };
    });
  }, [showBands, modelSummary, modelSampleDays, daysToX, priceToY]);

  // Power Law Trendline
  const trendlinePoints = useMemo(() => {
    if (!showPowerLaw) return '';
    return modelSampleDays
      .map((d) => {
        const x = daysToX(d);
        const p = calculatePowerLawPrice(d);
        return `${x.toFixed(1)},${priceToY(p).toFixed(1)}`;
      })
      .join(' ');
  }, [showPowerLaw, modelSampleDays, daysToX, priceToY]);

  // Downsample historical daily polyline slightly for crisp <3ms SVG rendering while keeping exact endpoints
  const pricePolyline = useMemo(() => {
    const stride = priceHistory.length > 2500 ? 2 : 1;
    const pts: string[] = [];
    for (let i = 0; i < priceHistory.length; i += stride) {
      const pt = priceHistory[i];
      pts.push(`${daysToX(pt.daysSinceGenesis).toFixed(1)},${priceToY(pt.close).toFixed(1)}`);
    }
    const last = priceHistory[priceHistory.length - 1];
    if (last) {
      pts.push(`${daysToX(last.daysSinceGenesis).toFixed(1)},${priceToY(last.close).toFixed(1)}`);
    }
    return pts.join(' ');
  }, [priceHistory, daysToX, priceToY]);

  // Y-axis ticks depending on scaleMode
  const yTicks = useMemo(() => {
    if (scaleMode === 'linear') {
      return [0, 25000, 50000, 75000, 100000, 125000, 150000, 175000, 200000, 250000];
    }
    return [0.1, 1, 10, 100, 1000, 10_000, 100_000, 1_000_000];
  }, [scaleMode]);

  // X-axis year markers
  const xTicks = useMemo(() => {
    const years = [2011, 2012, 2013, 2014, 2016, 2018, 2020, 2022, 2024, 2026, 2028];
    const genesisMs = Date.UTC(2009, 0, 3);
    return years.map((yr) => {
      const ms = Date.UTC(yr, 0, 1);
      const d = Math.round((ms - genesisMs) / 86_400_000);
      return { year: String(yr), d, x: daysToX(d) };
    });
  }, [daysToX]);

  // Hover binary search on daily price history
  const hoverInfo = useMemo(() => {
    if (!pointer || isDragging) return null;
    if (
      pointer.x < plotLeft ||
      pointer.x > plotRight ||
      pointer.y < plotTop ||
      pointer.y > plotBottom
    ) {
      return null;
    }

    const cursorDays = xToDays(pointer.x);
    const cursorPrice = yToPrice(pointer.y);

    // Binary search nearest point in priceHistory
    let lo = 0;
    let hi = priceHistory.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (priceHistory[mid].daysSinceGenesis < cursorDays) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    let nearest = priceHistory[lo];
    if (lo > 0) {
      const prev = priceHistory[lo - 1];
      if (
        Math.abs(prev.daysSinceGenesis - cursorDays) <
        Math.abs(nearest.daysSinceGenesis - cursorDays)
      ) {
        nearest = prev;
      }
    }

    const withinHistory = cursorDays <= lastHistDays + 45 && nearest != null;
    const evaluation = withinHistory
      ? evaluatePowerLawPoint(nearest, modelSummary.sigmaLog10)
      : null;

    const snappedX = withinHistory ? daysToX(nearest.daysSinceGenesis) : pointer.x;
    const snappedY = withinHistory ? priceToY(nearest.close) : pointer.y;
    const forwardDays = Math.max(minDays, Math.round(cursorDays));
    const forwardTrend = calculatePowerLawPrice(forwardDays);

    return {
      x: pointer.x,
      y: pointer.y,
      snappedX,
      snappedY,
      cursorPrice,
      withinHistory,
      evaluation,
      forwardDays,
      forwardTrend,
    };
  }, [
    pointer,
    isDragging,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    xToDays,
    yToPrice,
    priceHistory,
    lastHistDays,
    modelSummary.sigmaLog10,
    daysToX,
    priceToY,
    minDays,
  ]);

  const currentEval = modelSummary.currentEval;
  const currentSpotX = daysToX(currentEval.daysSinceGenesis);
  const currentSpotY = priceToY(currentEval.price);

  const halving4 = halvings.find((h) => h.epoch === 4);
  const halving5 = halvings.find((h) => h.epoch === 5);

  // Cycle transition vertical dashed lines (+18M Red Bear start, +30M Green Bull start)
  const cycleLines = useMemo(() => {
    if (!showHalvings) return [];
    const items: Array<{
      key: string;
      epoch: number;
      phase: 'bear' | 'bull';
      date: string;
      days: number;
      x: number;
      showLabel: boolean;
    }> = [];

    for (const h of halvings) {
      if (h.isProjected) continue;
      const [y, m, d] = h.date.split('-').map(Number);
      const baseMs = Date.UTC(y, m - 1, d, 0, 0, 0);

      const bearDate = new Date(addCalendarMonthsUtc(baseMs, 18)).toISOString().slice(0, 10);
      const bearDays = daysSinceGenesisFromIso(bearDate);
      if (bearDays >= minDays && bearDays <= maxDays) {
        items.push({
          key: `bear-${h.epoch}`,
          epoch: h.epoch,
          phase: 'bear',
          date: bearDate,
          days: bearDays,
          x: daysToX(bearDays),
          showLabel: false,
        });
      }

      const bullDate = new Date(addCalendarMonthsUtc(baseMs, 30)).toISOString().slice(0, 10);
      const bullDays = daysSinceGenesisFromIso(bullDate);
      if (bullDays >= minDays && bullDays <= maxDays) {
        items.push({
          key: `bull-${h.epoch}`,
          epoch: h.epoch,
          phase: 'bull',
          date: bullDate,
          days: bullDays,
          x: daysToX(bullDays),
          showLabel: false,
        });
      }
    }

    items.sort((a, b) => a.x - b.x);
    let lastLabelX = -Infinity;
    for (const item of items) {
      if (item.x - lastLabelX >= 48) {
        item.showLabel = true;
        lastLabelX = item.x;
      }
    }
    return items;
  }, [showHalvings, halvings, minDays, maxDays, daysToX]);

  const isDefaultView =
    Math.abs(view.zoomX - 1) < 0.01 &&
    Math.abs(view.zoomY - 1) < 0.01 &&
    Math.abs(view.panX) < 1 &&
    Math.abs(view.panY) < 1;

  return (
    <section
      id="powerlaw-chart"
      className="w-full border-b border-slate-800/80 bg-[#090D16]"
      aria-label="비트코인 초장기 Power Law 가격 차트"
    >
      {/* Top Chart Control Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 bg-[#0C121E] px-5 py-3">
        {/* Left: Scale Mode & Formula Summary */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-1.5" role="group" aria-label="차트 축 스케일 전환">
            <span className="mr-1 text-xs text-slate-400 whitespace-nowrap">스케일</span>
            <div className="flex items-center rounded-md border border-slate-800 bg-slate-900/90 p-0.5">
              {(
                [
                  { id: 'log_log', label: '로그-로그 (Log-Log)' },
                  { id: 'semi_log', label: '가격 로그 (Semi-Log)' },
                  { id: 'linear', label: '일반 선형 (Linear)' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleScaleChange(m.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    scaleMode === m.id
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <span className="hidden h-4 w-px bg-slate-800 lg:inline-block" aria-hidden="true" />

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
            <span className="text-slate-400">Power Law 공정가치</span>
            <span className="font-mono-tabular font-semibold text-amber-300">
              {formatUsd(currentEval.trendPrice, 0)}
            </span>
            <span className="font-mono-tabular text-slate-400">
              (현재가 {formatUsd(currentEval.price, 0)} · 추세 대비{' '}
              <span className={currentEval.pctFromTrend >= 0 ? 'text-amber-300' : 'text-sky-300'}>
                {formatPercent(currentEval.pctFromTrend, 1, true)}
              </span>{' '}
              / {currentEval.zScore >= 0 ? '+' : ''}
              {currentEval.zScore.toFixed(2)}σ)
            </span>
          </div>
        </div>

        {/* Right: Layer Toggles & Zoom/Reset */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5" role="group" aria-label="장기 차트 레이어 표시 설정">
            <button
              type="button"
              onClick={() => setShowPowerLaw((v) => !v)}
              aria-pressed={showPowerLaw}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showPowerLaw
                  ? 'border-amber-500/40 bg-amber-500/12 text-amber-200'
                  : 'border-slate-800 bg-slate-900/60 text-slate-500 hover:text-slate-300'
              }`}
            >
              {showPowerLaw ? <Eye className="h-3.5 w-3.5 text-amber-400" /> : <EyeOff className="h-3.5 w-3.5" />}
              <span>Power Law</span>
            </button>

            <button
              type="button"
              onClick={() => setShowBands((v) => !v)}
              aria-pressed={showBands}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showBands
                  ? 'border-sky-500/40 bg-sky-500/12 text-sky-200'
                  : 'border-slate-800 bg-slate-900/60 text-slate-500 hover:text-slate-300'
              }`}
            >
              {showBands ? <Eye className="h-3.5 w-3.5 text-sky-400" /> : <EyeOff className="h-3.5 w-3.5" />}
              <span>표준편차 밴드</span>
            </button>

            <button
              type="button"
              onClick={() => setShowHalvings((v) => !v)}
              aria-pressed={showHalvings}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showHalvings
                  ? 'border-indigo-500/40 bg-indigo-500/12 text-indigo-200'
                  : 'border-slate-800 bg-slate-900/60 text-slate-500 hover:text-slate-300'
              }`}
            >
              {showHalvings ? <Eye className="h-3.5 w-3.5 text-indigo-400" /> : <EyeOff className="h-3.5 w-3.5" />}
              <span>반감기 표시</span>
            </button>
          </div>

          <span className="h-4 w-px bg-slate-800" aria-hidden="true" />

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleZoomStep(1.3)}
              aria-label="차트 확대"
              title="확대 (마우스 휠 위)"
              className="rounded-md border border-slate-800 bg-slate-900/80 p-1.5 text-slate-300 hover:border-slate-700 hover:text-white transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleZoomStep(0.77)}
              aria-label="차트 축소"
              title="축소 (마우스 휠 아래)"
              className="rounded-md border border-slate-800 bg-slate-900/80 p-1.5 text-slate-300 hover:border-slate-700 hover:text-white transition-colors cursor-pointer"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleResetView}
              disabled={isDefaultView}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                isDefaultView
                  ? 'border-slate-800/60 bg-slate-900/40 text-slate-600 cursor-not-allowed'
                  : 'border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700 cursor-pointer'
              }`}
            >
              <RotateCcw className="h-3 w-3" />
              <span>전체 기간 초기화</span>
            </button>
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={isRefreshing}
                title="장기투자 시계열 및 블록 데이터 새로고침"
                className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-slate-900/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>새로고침</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Full-Width Long-Term Interactive SVG Chart */}
      <div
        ref={containerRef}
        className="relative w-full h-[68vh] min-h-[540px] max-h-[820px] select-none overflow-hidden bg-[#090D16]"
      >
        <svg
          ref={svgRef}
          width={size.width}
          height={size.height}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          onDoubleClick={handleResetView}
          className={`block w-full h-full ${isDragging ? 'cursor-grabbing' : 'cursor-crosshair'}`}
        >
          <defs>
            <clipPath id="powerlaw-plot-clip">
              <rect x={plotLeft} y={plotTop} width={plotW} height={plotH} />
            </clipPath>
          </defs>

          {/* Top Chart Title & Scale Caption */}
          <g className="pointer-events-none">
            <text x={plotLeft + 8} y={24} fill="#94A3B8" fontSize={11} fontWeight={500}>
              비트코인 초장기 일봉 가격 &amp; Power Law 9단계 표준편차 채널 (Genesis 2009-01-03 기준 · {currentDate})
            </text>
          </g>

          <g clipPath="url(#powerlaw-plot-clip)">
            {/* Horizontal Price Gridlines */}
            {yTicks.map((price) => {
              const y = priceToY(price);
              return (
                <line
                  key={`gy-${price}`}
                  x1={plotLeft}
                  y1={y}
                  x2={plotRight}
                  y2={y}
                  stroke="#1E293B"
                  strokeWidth={1}
                  strokeDasharray="2 4"
                  opacity={0.65}
                />
              );
            })}

            {/* Vertical Year Gridlines */}
            {xTicks.map((t) => (
              <line
                key={`gx-${t.year}`}
                x1={t.x}
                y1={plotTop}
                x2={t.x}
                y2={plotBottom}
                stroke="#1E293B"
                strokeWidth={1}
                strokeDasharray="2 4"
                opacity={0.5}
              />
            ))}

            {/* 9-Tier Power Law Standard Deviation Colored Bands */}
            {bandPolygons.map(({ tier, points }) => (
              <polygon
                key={`band-${tier.id}`}
                points={points}
                fill={tier.color}
                fillOpacity={tier.fillOpacity}
              />
            ))}

            {/* Key Sigma Reference Hairlines (-2σ, -1σ, +1σ, +2σ) */}
            {sigmaBoundaryLines.map(({ sig, points }) => (
              <polyline
                key={`sig-${sig}`}
                points={points}
                fill="none"
                stroke={sig > 0 ? '#F97316' : '#38BDF8'}
                strokeWidth={1}
                strokeDasharray="4 4"
                opacity={0.45}
              />
            ))}

            {/* Current Active Halving Cycle Shading (Epoch 5: Halving 4 -> Current/Halving 5) */}
            {showHalvings && halving4 && (
              <rect
                x={daysToX(halving4.daysSinceGenesis)}
                y={plotTop}
                width={Math.max(
                  0,
                  (halving5 ? daysToX(halving5.daysSinceGenesis) : currentSpotX) -
                    daysToX(halving4.daysSinceGenesis),
                )}
                height={plotH}
                fill="#6366F1"
                opacity={0.07}
              />
            )}

            {/* Cycle Transition Dashed Vertical Lines: +18M Bear (Red) & +30M Bull (Green) */}
            {showHalvings &&
              cycleLines.map((c) => {
                const isBear = c.phase === 'bear';
                const strokeColor = isBear ? '#F43F5E' : '#10B981';
                return (
                  <g key={c.key} className="pointer-events-none">
                    <line
                      x1={c.x}
                      y1={plotTop}
                      x2={c.x}
                      y2={plotBottom}
                      stroke={strokeColor}
                      strokeWidth={1.15}
                      strokeDasharray="4 4"
                      opacity={0.72}
                    />
                    {c.showLabel && (
                      <text
                        x={c.x + 4}
                        y={plotBottom - 10}
                        fill={isBear ? '#FDA4AF' : '#6EE7B7'}
                        fontSize={9.5}
                        fontFamily="var(--font-mono)"
                        opacity={0.9}
                      >
                        {isBear ? '+18M 하락' : '+30M 상승'}
                      </text>
                    )}
                  </g>
                );
              })}

            {/* Halving Vertical Markers */}
            {showHalvings &&
              halvings.map((h) => {
                const hx = daysToX(h.daysSinceGenesis);
                return (
                  <g key={`halv-${h.epoch}`}>
                    <line
                      x1={hx}
                      y1={plotTop}
                      x2={hx}
                      y2={plotBottom}
                      stroke={h.isCurrentEpoch ? '#818CF8' : h.isProjected ? '#64748B' : '#475569'}
                      strokeWidth={h.isCurrentEpoch ? 1.5 : 1}
                      strokeDasharray={h.isProjected ? '4 4' : '6 3'}
                    />
                    <text
                      x={hx + 5}
                      y={plotTop + 16}
                      fill={h.isCurrentEpoch ? '#C7D2FE' : '#94A3B8'}
                      fontSize={10}
                      fontWeight={h.isCurrentEpoch ? 600 : 400}
                      fontFamily="var(--font-mono)"
                    >
                      {h.epoch}차 {h.date.slice(2, 7)}
                      {h.isCurrentEpoch ? ' (진행중)' : h.isProjected ? ' (예상)' : ''}
                    </text>
                  </g>
                );
              })}

            {/* Power Law Trendline: P = 3.096e-17 * d^5.690 */}
            {showPowerLaw && trendlinePoints && (
              <polyline
                points={trendlinePoints}
                fill="none"
                stroke="#F59E0B"
                strokeWidth={2}
              />
            )}

            {/* Historical BTC Daily Close Line */}
            <polyline
              points={pricePolyline}
              fill="none"
              stroke="#E2E8F0"
              strokeWidth={1.6}
              strokeLinejoin="miter"
            />

            {/* Current Spot Price Marker */}
            <circle cx={currentSpotX} cy={currentSpotY} r={8} fill="#38BDF8" opacity={0.18} />
            <circle
              cx={currentSpotX}
              cy={currentSpotY}
              r={4}
              fill="#38BDF8"
              stroke="#090D16"
              strokeWidth={1.5}
            />

            {/* Interactive Hover Crosshair */}
            {hoverInfo && (
              <g className="pointer-events-none">
                <line
                  x1={plotLeft}
                  y1={hoverInfo.y}
                  x2={plotRight}
                  y2={hoverInfo.y}
                  stroke="#64748B"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <line
                  x1={hoverInfo.snappedX}
                  y1={plotTop}
                  x2={hoverInfo.snappedX}
                  y2={plotBottom}
                  stroke="#64748B"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                {hoverInfo.withinHistory && (
                  <circle
                    cx={hoverInfo.snappedX}
                    cy={hoverInfo.snappedY}
                    r={4}
                    fill="#F8FAFC"
                    stroke="#090D16"
                    strokeWidth={1.5}
                  />
                )}
              </g>
            )}
          </g>

          {/* Plot Border Hairline */}
          <rect
            x={plotLeft}
            y={plotTop}
            width={plotW}
            height={plotH}
            fill="none"
            stroke="#1E293B"
            strokeWidth={1}
          />

          {/* Right Price Y-Axis */}
          <g className="pointer-events-none">
            {yTicks.map((price) => {
              const y = priceToY(price);
              if (y < plotTop + 8 || y > plotBottom - 8) return null;
              return (
                <g key={`yt-${price}`}>
                  <line x1={plotRight} y1={y} x2={plotRight + 5} y2={y} stroke="#334155" />
                  <text
                    x={plotRight + 9}
                    y={y + 3.5}
                    fill="#94A3B8"
                    fontSize={11}
                    fontFamily="var(--font-mono)"
                  >
                    {formatCompactPrice(price)}
                  </text>
                </g>
              );
            })}

            {/* Current Price Y-Axis Tag */}
            {currentSpotY >= plotTop && currentSpotY <= plotBottom && (
              <g transform={`translate(${plotRight + 2}, ${currentSpotY})`}>
                <rect x={0} y={-10} width={78} height={20} rx={3} fill="#38BDF8" />
                <text
                  x={6}
                  y={3.5}
                  fill="#090D16"
                  fontSize={11}
                  fontWeight={700}
                  fontFamily="var(--font-mono)"
                >
                  {formatUsd(currentEval.price, 0)}
                </text>
              </g>
            )}

            {/* Hovered Price Y-Axis Tag */}
            {hoverInfo && (
              <g transform={`translate(${plotRight + 2}, ${hoverInfo.y})`}>
                <rect x={0} y={-10} width={78} height={20} rx={3} fill="#334155" />
                <text
                  x={6}
                  y={3.5}
                  fill="#F8FAFC"
                  fontSize={11}
                  fontWeight={600}
                  fontFamily="var(--font-mono)"
                >
                  {formatCompactPrice(hoverInfo.cursorPrice)}
                </text>
              </g>
            )}
          </g>

          {/* Bottom Time X-Axis */}
          <g className="pointer-events-none">
            {xTicks.map((t) => {
              if (t.x < plotLeft + 16 || t.x > plotRight - 16) return null;
              return (
                <g key={`xt-${t.year}`}>
                  <line x1={t.x} y1={plotBottom} x2={t.x} y2={plotBottom + 5} stroke="#334155" />
                  <text
                    x={t.x}
                    y={plotBottom + 19}
                    textAnchor="middle"
                    fill="#94A3B8"
                    fontSize={11}
                    fontFamily="var(--font-mono)"
                  >
                    {t.year}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Compact Overlay Diagnostics Panel (Top-Left inside Chart) */}
        <div className="pointer-events-none absolute top-12 left-7 z-10 w-80 rounded-md border border-slate-800/90 bg-[#0B101B]/88 p-3 text-xs backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5 mb-2">
            <span className="font-medium text-slate-300">Power Law 추세 모델</span>
            <span className="font-mono-tabular text-[11px] text-amber-300">
              P = 3.096×10⁻¹⁷ × d⁵·⁶⁹⁰
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <div>
              <div className="text-[11px] text-slate-400">추세선 대비 위치</div>
              <div className="font-mono-tabular font-semibold text-slate-100">
                {formatPercent(currentEval.pctFromTrend, 1, true)} ({currentEval.ratioToTrend.toFixed(2)}x)
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-400">표준편차 편차 (1σ={modelSummary.sigmaLog10.toFixed(2)})</div>
              <div className="font-mono-tabular font-semibold text-sky-300">
                {currentEval.zScore >= 0 ? '+' : ''}
                {currentEval.zScore.toFixed(2)}σ
              </div>
            </div>
          </div>

          {/* 9-Tier Valuation Band Indicator */}
          <div className="mt-2.5 pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between text-[11px] mb-1.5">
              <span className="text-slate-400">현재 9단계 가치 구간</span>
              <span className="font-semibold text-slate-100">{currentEval.tier.name}</span>
            </div>
            <div className="grid grid-cols-9 gap-0.5 h-2">
              {modelSummary.tiers.map((t) => {
                const isActive = t.id === currentEval.tier.id;
                return (
                  <div
                    key={t.id}
                    style={{
                      backgroundColor: t.color,
                      opacity: isActive ? 1 : 0.35,
                    }}
                    className={`rounded-[1px] ${isActive ? 'ring-1 ring-white' : ''}`}
                    title={t.name}
                  />
                );
              })}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-slate-500">
              <span>-2.25σ 극단 저평가</span>
              <span>0σ 공정</span>
              <span>+2.25σ 극단 버블</span>
            </div>
          </div>
        </div>

        {/* Interactive Hover Tooltip */}
        {hoverInfo && (
          <div
            className="pointer-events-none absolute z-20 w-68 rounded-md border border-slate-700/90 bg-[#0D1320]/95 p-3 text-xs text-slate-200 shadow-2xl backdrop-blur-sm"
            style={{
              left:
                hoverInfo.x + 290 > size.width - margin.right
                  ? Math.max(12, hoverInfo.x - 284)
                  : hoverInfo.x + 16,
              top:
                hoverInfo.y + 185 > size.height
                  ? Math.max(12, hoverInfo.y - 170)
                  : Math.max(12, hoverInfo.y + 12),
            }}
          >
            {hoverInfo.evaluation ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                  <span className="font-mono-tabular font-semibold text-slate-100">
                    {hoverInfo.evaluation.date}
                  </span>
                  <span className="font-mono-tabular text-[11px] text-slate-400">
                    d = {hoverInfo.evaluation.daysSinceGenesis.toLocaleString()}일
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">BTC 종가</span>
                  <span className="font-mono-tabular font-semibold text-slate-50">
                    {formatTooltipPrice(hoverInfo.evaluation.price)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Power Law 추세선</span>
                  <span className="font-mono-tabular text-amber-300">
                    {formatTooltipPrice(hoverInfo.evaluation.trendPrice)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">추세 대비 / 편차</span>
                  <span className="font-mono-tabular text-sky-300">
                    {formatPercent(hoverInfo.evaluation.pctFromTrend, 1, true)} (
                    {hoverInfo.evaluation.zScore >= 0 ? '+' : ''}
                    {hoverInfo.evaluation.zScore.toFixed(2)}σ)
                  </span>
                </div>
                <div className="pt-1 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">평가 구간</span>
                  <span className="font-medium text-slate-100">
                    {hoverInfo.evaluation.tier.name}
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-300 font-medium">미래 추세 투영</span>
                  <span className="font-mono-tabular text-[11px] text-slate-400">
                    d = {hoverInfo.forwardDays.toLocaleString()}일
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Power Law 예상 추세</span>
                  <span className="font-mono-tabular font-semibold text-amber-300">
                    {formatTooltipPrice(hoverInfo.forwardTrend)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">커서 가격</span>
                  <span className="font-mono-tabular text-slate-200">
                    {formatTooltipPrice(hoverInfo.cursorPrice)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Quiet Bottom-Left Hint */}
        <div className="pointer-events-none absolute bottom-11 left-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 bg-slate-200 inline-block" /> BTC 일봉 종가
          </span>
          {showPowerLaw && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3.5 bg-amber-400 inline-block" /> Power Law 추세선
            </span>
          )}
          {showBands && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3.5 bg-gradient-to-r from-blue-600 via-emerald-500 to-red-600 inline-block opacity-80" />{' '}
              9단계 표준편차 밴드
            </span>
          )}
          {showHalvings && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-3.5 border-t-2 border-dashed border-emerald-500 inline-block" />{' '}
                상승 전환 (+30M)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-3.5 border-t-2 border-dashed border-rose-500 inline-block" />{' '}
                하락 시작 (+18M)
              </span>
            </>
          )}
          <span className="text-slate-500 hidden md:inline">
            · 휠: 확대/축소 · Shift+휠: 시간축 줌 · 드래그: 이동 · 더블클릭: 초기화
          </span>
        </div>
      </div>
    </section>
  );
};
