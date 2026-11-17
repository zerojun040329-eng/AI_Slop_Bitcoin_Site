import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw, Eye, EyeOff, RefreshCw } from 'lucide-react';
import type {
  DailyClosePoint,
  ExpectedMovePoint,
  LayerVisibility,
  LiquidationBin,
  LiquidationSummary,
  MarketSnapshot,
  MaturityMaxPainPoint,
  MaxPainAnalysis,
} from '../types/derivatives';
import {
  formatPercent,
  formatSignedUsd,
  formatUsd,
  formatUsdMillions,
} from '../utils/analytics';

interface UnifiedDerivativesChartProps {
  snapshot: MarketSnapshot;
  expectedMoves: ExpectedMovePoint[];
  maxPain: MaxPainAnalysis;
  maturityMaxPains: MaturityMaxPainPoint[];
  liquidationSummary: LiquidationSummary;
  visibility: LayerVisibility;
  onToggleLayer: (key: keyof LayerVisibility) => void;
  selectedTenor: string | null;
  onSelectTenor: (tenor: string | null) => void;
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

function niceStep(range: number, targetTicks: number): number {
  const raw = range / Math.max(1, targetTicks);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step = 1;
  if (norm >= 5) step = 5;
  else if (norm >= 2.5) step = 2.5;
  else if (norm >= 2) step = 2;
  return step * mag;
}

export const UnifiedDerivativesChart: React.FC<UnifiedDerivativesChartProps> = ({
  snapshot,
  expectedMoves,
  maxPain,
  maturityMaxPains,
  liquidationSummary,
  visibility,
  onToggleLayer,
  selectedTenor,
  onSelectTenor,
  onRefresh,
  isRefreshing = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [size, setSize] = useState({ width: 1280, height: 640 });
  const [view, setView] = useState<ViewTransform>(DEFAULT_VIEW);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  // ResizeObserver for crisp responsive SVG scaling
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

  // Layout bounds inside SVG
  const margin = useMemo(
    () => ({
      top: 40,
      bottom: 42,
      left: 20,
      right: 92,
    }),
    [],
  );

  const plotLeft = margin.left;
  const plotRight = Math.max(plotLeft + 300, size.width - margin.right);
  const plotTop = margin.top;
  const plotBottom = Math.max(plotTop + 260, size.height - margin.bottom);
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  // Base price half-span computed from FULL dataset (independent of layer toggles!)
  // Symmetric around currentPrice so currentPrice sits at exact vertical center (50%).
  const halfSpanBase = useMemo(() => {
    const spot = snapshot.currentPrice;
    let maxDev = spot * 0.32;

    for (const pt of snapshot.history30d) {
      maxDev = Math.max(maxDev, Math.abs(pt.close - spot) * 1.35);
    }
    for (const m of expectedMoves) {
      maxDev = Math.max(maxDev, m.upper1Sigma - spot, spot - m.lower1Sigma);
    }
    maxDev = Math.max(maxDev, Math.abs(maxPain.maxPainPrice - spot) * 1.4);
    for (const mp of maturityMaxPains) {
      maxDev = Math.max(maxDev, Math.abs(mp.maxPainPrice - spot) * 1.4);
    }

    for (const bin of snapshot.liquidationBins) {
      const total =
        bin.estimatedLongUsdM +
        bin.estimatedShortUsdM +
        bin.realizedLongUsdM +
        bin.realizedShortUsdM;
      if (total > liquidationSummary.maxBinTotalUsdM * 0.22) {
        maxDev = Math.max(maxDev, Math.abs(bin.midPrice - spot));
      }
    }

    return maxDev * 1.07;
  }, [snapshot, expectedMoves, maxPain, maturityMaxPains, liquidationSummary.maxBinTotalUsdM]);

  // Anchor pixel coordinates: Spot sits at 1/3 width and 1/2 height at default view
  const xAnchorBase = plotLeft + plotW / 3;
  const yAnchorBase = plotTop + plotH / 2;

  const xAnchor = xAnchorBase + view.panX;
  const yAnchor = yAnchorBase + view.panY;

  const leftSpanBase = Math.max(100, plotW / 3 - 22);
  // Right zone splits into: [0D..365D IV Cone (~47% plotW)] + [Liquidation Profile (~19% plotW)]
  const coneSpanBase = plotW * 0.46;
  const liqBarMaxWidth = Math.max(96, plotW * 0.175);

  const pxPerUsd = (plotH / (2 * halfSpanBase)) * view.zoomY;

  const priceToY = useCallback(
    (price: number) => yAnchor - (price - snapshot.currentPrice) * pxPerUsd,
    [yAnchor, snapshot.currentPrice, pxPerUsd],
  );

  const yToPrice = useCallback(
    (y: number) => snapshot.currentPrice + (yAnchor - y) / pxPerUsd,
    [snapshot.currentPrice, yAnchor, pxPerUsd],
  );

  const dayToX = useCallback(
    (dayOffset: number) => {
      const totalDays = Math.max(1, snapshot.history30d.length - 1);
      return xAnchor + (dayOffset / totalDays) * leftSpanBase * view.zoomX;
    },
    [xAnchor, snapshot.history30d.length, leftSpanBase, view.zoomX],
  );

  const expiryDaysToX = useCallback(
    (days: number) => xAnchor + Math.sqrt(Math.max(0, days) / 365) * coneSpanBase * view.zoomX,
    [xAnchor, coneSpanBase, view.zoomX],
  );

  // Reset view when snapshot feed origin changes
  useEffect(() => {
    setView(DEFAULT_VIEW);
  }, [snapshot.id]);

  const handleResetView = useCallback(() => {
    setView(DEFAULT_VIEW);
  }, []);

  const handleZoomStep = useCallback((factor: number) => {
    setView((prev) => {
      const nextZoomY = Math.min(5, Math.max(0.55, prev.zoomY * factor));
      const nextZoomX = Math.min(3.5, Math.max(0.65, prev.zoomX * Math.pow(factor, 0.55)));
      return {
        ...prev,
        zoomX: nextZoomX,
        zoomY: nextZoomY,
      };
    });
  }, []);

  const handleFocusShortTerm = useCallback(() => {
    // Zooms Y-axis ~1.85x and X-axis ~1.35x while keeping spot anchored at (1/3, 1/2)
    setView({
      zoomX: 1.35,
      zoomY: 1.9,
      panX: 0,
      panY: 0,
    });
  }, []);

  // Mouse wheel zoom centered on cursor
  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const scaleFactor = e.deltaY < 0 ? 1.12 : 0.89;

      setView((prev) => {
        if (e.shiftKey) {
          // Horizontal time zoom only
          const nextZoomX = Math.min(4, Math.max(0.6, prev.zoomX * scaleFactor));
          const ratioX = nextZoomX / prev.zoomX;
          const curAnchorX = xAnchorBase + prev.panX;
          const nextAnchorX = mx - (mx - curAnchorX) * ratioX;
          return {
            ...prev,
            zoomX: nextZoomX,
            panX: nextAnchorX - xAnchorBase,
          };
        }

        // Price Y-axis + gentle X-axis zoom around cursor
        const nextZoomY = Math.min(6, Math.max(0.55, prev.zoomY * scaleFactor));
        const nextZoomX = Math.min(3.8, Math.max(0.65, prev.zoomX * Math.pow(scaleFactor, 0.45)));

        const ratioY = nextZoomY / prev.zoomY;
        const ratioX = nextZoomX / prev.zoomX;

        const curAnchorX = xAnchorBase + prev.panX;
        const curAnchorY = yAnchorBase + prev.panY;

        const nextAnchorX = mx - (mx - curAnchorX) * ratioX;
        const nextAnchorY = my - (my - curAnchorY) * ratioY;

        return {
          zoomX: nextZoomX,
          zoomY: nextZoomY,
          panX: nextAnchorX - xAnchorBase,
          panY: nextAnchorY - yAnchorBase,
        };
      });
    },
    [xAnchorBase, yAnchorBase],
  );

  // Pointer drag pan
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        // Ignore synthetic pointer events without active pointer capture
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
      // Ignore if pointer capture already ended
    }
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  const handlePointerLeave = useCallback(() => {
    setPointer(null);
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  // Visible price Y-axis ticks
  const yTicks = useMemo(() => {
    const topPrice = yToPrice(plotTop);
    const bottomPrice = yToPrice(plotBottom);
    const range = Math.max(1000, topPrice - bottomPrice);
    const step = niceStep(range, 8);
    const start = Math.ceil(bottomPrice / step) * step;
    const ticks: number[] = [];
    for (let p = start; p <= topPrice; p += step) {
      if (p > 0) ticks.push(p);
    }
    return ticks;
  }, [yToPrice, plotTop, plotBottom]);

  // 30-day polyline points (straight linear segments, faithful to raw closes)
  const historyCoords = useMemo(
    () =>
      snapshot.history30d.map((pt) => ({
        ...pt,
        x: dayToX(pt.dayOffset),
        y: priceToY(pt.close),
      })),
    [snapshot.history30d, dayToX, priceToY],
  );

  const historyPolyline = useMemo(
    () => historyCoords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
    [historyCoords],
  );

  const historyAreaPath = useMemo(() => {
    if (historyCoords.length === 0) return '';
    const first = historyCoords[0];
    const last = historyCoords[historyCoords.length - 1];
    const lineSegs = historyCoords
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');
    return `${lineSegs} L ${last.x.toFixed(1)} ${plotBottom} L ${first.x.toFixed(1)} ${plotBottom} Z`;
  }, [historyCoords, plotBottom]);

  // IV Cone geometry starting seamlessly from (xAnchor, yAnchor)
  const conePoints = useMemo(() => {
    return expectedMoves.map((m) => ({
      ...m,
      x: expiryDaysToX(m.daysToExpiry),
      yUpper1: priceToY(m.upper1Sigma),
      yLower1: priceToY(m.lower1Sigma),
      yUpperHalf: priceToY(m.upperHalfSigma),
      yLowerHalf: priceToY(m.lowerHalfSigma),
    }));
  }, [expectedMoves, expiryDaysToX, priceToY]);

  const cone1SigmaAreaPath = useMemo(() => {
    if (conePoints.length === 0) return '';
    const upper = conePoints
      .map((p) => `L ${p.x.toFixed(1)} ${p.yUpper1.toFixed(1)}`)
      .join(' ');
    const lower = [...conePoints]
      .reverse()
      .map((p) => `L ${p.x.toFixed(1)} ${p.yLower1.toFixed(1)}`)
      .join(' ');
    return `M ${xAnchor.toFixed(1)} ${yAnchor.toFixed(1)} ${upper} ${lower} Z`;
  }, [conePoints, xAnchor, yAnchor]);

  const coneHalfSigmaAreaPath = useMemo(() => {
    if (conePoints.length === 0) return '';
    const upper = conePoints
      .map((p) => `L ${p.x.toFixed(1)} ${p.yUpperHalf.toFixed(1)}`)
      .join(' ');
    const lower = [...conePoints]
      .reverse()
      .map((p) => `L ${p.x.toFixed(1)} ${p.yLowerHalf.toFixed(1)}`)
      .join(' ');
    return `M ${xAnchor.toFixed(1)} ${yAnchor.toFixed(1)} ${upper} ${lower} Z`;
  }, [conePoints, xAnchor, yAnchor]);

  const coneUpperPolyline = useMemo(() => {
    const pts = [`${xAnchor.toFixed(1)},${yAnchor.toFixed(1)}`];
    for (const p of conePoints) pts.push(`${p.x.toFixed(1)},${p.yUpper1.toFixed(1)}`);
    return pts.join(' ');
  }, [conePoints, xAnchor, yAnchor]);

  const coneLowerPolyline = useMemo(() => {
    const pts = [`${xAnchor.toFixed(1)},${yAnchor.toFixed(1)}`];
    for (const p of conePoints) pts.push(`${p.x.toFixed(1)},${p.yLower1.toFixed(1)}`);
    return pts.join(' ');
  }, [conePoints, xAnchor, yAnchor]);

  // Max Pain Y coordinate & per-maturity Max Pain points
  const yMaxPain = priceToY(maxPain.maxPainPrice);

  const maturityMaxPainCoords = useMemo(
    () =>
      maturityMaxPains.map((mp) => ({
        ...mp,
        x: expiryDaysToX(mp.daysToExpiry),
        y: priceToY(mp.maxPainPrice),
      })),
    [maturityMaxPains, expiryDaysToX, priceToY],
  );

  const maturityMaxPainPolyline = useMemo(
    () => maturityMaxPainCoords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
    [maturityMaxPainCoords],
  );

  // Liquidation bin geometry mapped to identical Y-axis
  const liqBarCoords = useMemo(() => {
    const maxTotal = liquidationSummary.maxBinTotalUsdM;
    return snapshot.liquidationBins.map((bin) => {
      const yTop = priceToY(bin.priceTo);
      const yBot = priceToY(bin.priceFrom);
      const height = Math.max(2, yBot - yTop - 1);
      const totalLong = bin.estimatedLongUsdM + bin.realizedLongUsdM;
      const totalShort = bin.estimatedShortUsdM + bin.realizedShortUsdM;
      const dominantSide: 'short' | 'long' = totalShort >= totalLong ? 'short' : 'long';
      const estVal = dominantSide === 'short' ? bin.estimatedShortUsdM : bin.estimatedLongUsdM;
      const realVal = dominantSide === 'short' ? bin.realizedShortUsdM : bin.realizedLongUsdM;
      const totalVal = estVal + realVal;
      const totalWidth = (totalVal / maxTotal) * liqBarMaxWidth;
      const realWidth = (realVal / maxTotal) * liqBarMaxWidth;
      const intensity = totalVal / maxTotal;
      return {
        bin,
        yTop,
        yMid: (yTop + yBot) / 2,
        height,
        dominantSide,
        estVal,
        realVal,
        totalVal,
        totalWidth,
        realWidth,
        intensity,
      };
    });
  }, [snapshot.liquidationBins, liquidationSummary.maxBinTotalUsdM, priceToY, liqBarMaxWidth]);

  // Hover inspection logic
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

    const hoveredPrice = yToPrice(pointer.y);
    const pctFromSpot =
      snapshot.currentPrice > 0
        ? (hoveredPrice - snapshot.currentPrice) / snapshot.currentPrice
        : 0;

    // Left zone: find nearest historical day
    let nearestHistory: (DailyClosePoint & { x: number; y: number; prevClose?: number }) | null =
      null;
    if (pointer.x <= xAnchor + 8) {
      let bestDist = Infinity;
      for (let i = 0; i < historyCoords.length; i++) {
        const d = Math.abs(pointer.x - historyCoords[i].x);
        if (d < bestDist) {
          bestDist = d;
          nearestHistory = {
            ...historyCoords[i],
            prevClose: i > 0 ? historyCoords[i - 1].close : undefined,
          };
        }
      }
    }

    // Right zone: nearest option maturity (if showIV)
    let nearestMaturity: (ExpectedMovePoint & { x: number; yUpper1: number; yLower1: number }) | null =
      null;
    if (pointer.x > xAnchor + 4 && visibility.showIV && conePoints.length > 0) {
      let bestDist = Infinity;
      for (const c of conePoints) {
        const d = Math.abs(pointer.x - c.x);
        if (d < bestDist) {
          bestDist = d;
          nearestMaturity = c;
        }
      }
      if (bestDist > 85) {
        nearestMaturity = null;
      }
    }

    // Right zone: nearest maturity Max Pain dot (if showMaxPain)
    let nearestMaturityMaxPain: (MaturityMaxPainPoint & { x: number; y: number }) | null = null;
    if (pointer.x > xAnchor + 4 && visibility.showMaxPain && maturityMaxPainCoords.length > 0) {
      let bestDist = Infinity;
      for (const mp of maturityMaxPainCoords) {
        const d = Math.abs(pointer.x - mp.x);
        if (d < bestDist) {
          bestDist = d;
          nearestMaturityMaxPain = mp;
        }
      }
      if (bestDist > 85) {
        nearestMaturityMaxPain = null;
      }
    }

    // Nearest liquidation bin at hovered price (if showLiquidations)
    let hoveredLiq: LiquidationBin | null = null;
    if (visibility.showLiquidations) {
      for (const b of snapshot.liquidationBins) {
        if (hoveredPrice >= b.priceFrom && hoveredPrice < b.priceTo) {
          hoveredLiq = b;
          break;
        }
      }
    }

    return {
      x: pointer.x,
      y: pointer.y,
      hoveredPrice,
      pctFromSpot,
      nearestHistory,
      nearestMaturity,
      nearestMaturityMaxPain,
      hoveredLiq,
      inRightZone: pointer.x > xAnchor,
    };
  }, [
    pointer,
    isDragging,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
    yToPrice,
    snapshot.currentPrice,
    snapshot.liquidationBins,
    xAnchor,
    historyCoords,
    visibility.showIV,
    visibility.showMaxPain,
    visibility.showLiquidations,
    conePoints,
    maturityMaxPainCoords,
  ]);

  const firstClose = snapshot.history30d[0]?.close ?? snapshot.currentPrice;
  const change30dUsd = snapshot.currentPrice - firstClose;
  const change30dPct = firstClose > 0 ? change30dUsd / firstClose : 0;

  const isDefaultView =
    Math.abs(view.zoomX - 1) < 0.01 &&
    Math.abs(view.zoomY - 1) < 0.01 &&
    Math.abs(view.panX) < 1 &&
    Math.abs(view.panY) < 1;

  // Dynamic horizontal collision avoidance for inline IV & Max Pain labels across live Deribit expiries
  const labeledConeTenors = useMemo(() => {
    const kept = new Set<string>();
    let lastX = -Infinity;
    for (let i = 0; i < conePoints.length; i++) {
      const pt = conePoints[i];
      const isLast = i === conePoints.length - 1;
      if (pt.x - lastX >= 74 || isLast) {
        if (isLast && lastX > -Infinity && pt.x - lastX < 52 && conePoints[i - 1]) {
          kept.delete(conePoints[i - 1].tenor);
        }
        kept.add(pt.tenor);
        lastX = pt.x;
      }
    }
    return kept;
  }, [conePoints]);

  const labeledMpTenors = useMemo(() => {
    const kept = new Set<string>();
    let lastX = -Infinity;
    for (let i = 0; i < maturityMaxPainCoords.length; i++) {
      const mp = maturityMaxPainCoords[i];
      const isLast = i === maturityMaxPainCoords.length - 1;
      if (mp.x - lastX >= 76 || isLast) {
        if (isLast && lastX > -Infinity && mp.x - lastX < 54 && maturityMaxPainCoords[i - 1]) {
          kept.delete(maturityMaxPainCoords[i - 1].tenor);
        }
        kept.add(mp.tenor);
        lastX = mp.x;
      }
    }
    return kept;
  }, [maturityMaxPainCoords]);

  const visibleTenorTicks = useMemo(() => {
    const list: Array<{ tenor: string; x: number }> = [];
    let lastX = xAnchor + 20;
    for (const m of expectedMoves) {
      const x = expiryDaysToX(m.daysToExpiry);
      if (x <= xAnchor + 20 || x > plotRight - 10) continue;
      if (x - lastX >= 38) {
        list.push({ tenor: m.tenor, x });
        lastX = x;
      }
    }
    return list;
  }, [expectedMoves, expiryDaysToX, xAnchor, plotRight]);

  return (
    <section
      id="unified-chart"
      className="w-full border-b border-slate-800/80 bg-[#090D16]"
      aria-label="비트코인 통합 파생상품 분석 차트"
    >
      {/* Top Integrated Workspace Control Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 bg-[#0C121E] px-5 py-3">
        {/* Left: Core Price & Max Pain Comparison Telemetry */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-2.5">
            <span className="text-xs font-medium text-slate-400">BTC/USD 현물 기준가</span>
            <span className="font-mono-tabular text-xl font-semibold tracking-tight text-slate-50">
              {formatUsd(snapshot.currentPrice, 0)}
            </span>
            <span
              className={`font-mono-tabular text-xs font-medium ${
                change30dPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              30D {formatSignedUsd(change30dUsd, 0)} ({formatPercent(change30dPct, 2, true)})
            </span>
          </div>

          <span className="hidden h-4 w-px bg-slate-800 sm:inline-block" aria-hidden="true" />

          <div className="flex items-baseline gap-2">
            <span className="text-xs font-medium text-amber-400/90">OI Max Pain</span>
            <span className="font-mono-tabular text-sm font-semibold text-amber-300">
              {formatUsd(maxPain.maxPainPrice, 0)}
            </span>
            <span className="font-mono-tabular text-xs text-slate-400">
              (현재가 대비 {formatSignedUsd(maxPain.diffFromSpotUsd, 0)} /{' '}
              {formatPercent(maxPain.diffFromSpotPct, 2, true)})
            </span>
          </div>

          <span className="hidden h-4 w-px bg-slate-800 xl:inline-block" aria-hidden="true" />

          <div className="flex items-baseline gap-2 text-xs text-slate-400">
            <span>활성 만기</span>
            <span className="font-mono-tabular font-semibold text-sky-300">
              {expectedMoves.length}개
            </span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span>총 옵션 OI</span>
            <span className="font-mono-tabular text-slate-200">
              {(maxPain.totalCallOiBtc + maxPain.totalPutOiBtc).toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })}{' '}
              BTC
            </span>
          </div>
        </div>

        {/* Right: 3 Independent Layer Toggles + Zoom/Pan Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Layer Toggles */}
          <div className="flex items-center gap-1.5" role="group" aria-label="파생상품 분석 레이어 표시 설정">
            <button
              type="button"
              onClick={() => onToggleLayer('showIV')}
              aria-pressed={visibility.showIV}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                visibility.showIV
                  ? 'border-sky-500/40 bg-sky-500/12 text-sky-200'
                  : 'border-slate-800 bg-slate-900/60 text-slate-500 hover:text-slate-300'
              }`}
            >
              {visibility.showIV ? (
                <Eye className="h-3.5 w-3.5 text-sky-400" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" />
              )}
              <span>옵션 IV / 기대 변동성</span>
            </button>

            <button
              type="button"
              onClick={() => onToggleLayer('showMaxPain')}
              aria-pressed={visibility.showMaxPain}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                visibility.showMaxPain
                  ? 'border-amber-500/40 bg-amber-500/12 text-amber-200'
                  : 'border-slate-800 bg-slate-900/60 text-slate-500 hover:text-slate-300'
              }`}
            >
              {visibility.showMaxPain ? (
                <Eye className="h-3.5 w-3.5 text-amber-400" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" />
              )}
              <span>Max Pain</span>
            </button>

            <button
              type="button"
              onClick={() => onToggleLayer('showLiquidations')}
              aria-pressed={visibility.showLiquidations}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                visibility.showLiquidations
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-slate-800 bg-slate-900/60 text-slate-500 hover:text-slate-300'
              }`}
            >
              {visibility.showLiquidations ? (
                <Eye className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" />
              )}
              <span>청산 물량</span>
            </button>
          </div>

          <span className="h-4 w-px bg-slate-800" aria-hidden="true" />

          {/* Zoom & Anchor Reset Controls */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleFocusShortTerm}
              title="단기(7D–90D), Max Pain 괴리, 청산 구간 확대 보기"
              className="rounded-md border border-slate-800 bg-slate-900/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              중단기 확대
            </button>
            <button
              type="button"
              onClick={() => handleZoomStep(1.25)}
              aria-label="차트 확대"
              title="확대 (마우스 휠 위)"
              className="rounded-md border border-slate-800 bg-slate-900/80 p-1.5 text-slate-300 hover:border-slate-700 hover:text-white transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleZoomStep(0.8)}
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
              title="현재가 기준점(1/3 가로, 1/2 세로) 복원"
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                isDefaultView
                  ? 'border-slate-800/60 bg-slate-900/40 text-slate-600 cursor-not-allowed'
                  : 'border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700 cursor-pointer'
              }`}
            >
              <RotateCcw className="h-3 w-3" />
              <span>기준점 복원</span>
            </button>
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={isRefreshing}
                title="Deribit 실시간 데이터 새로고침"
                className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-slate-900/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>새로고침</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Full-Width Interactive Integrated Chart Canvas */}
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
            <clipPath id="unified-plot-clip">
              <rect x={plotLeft} y={plotTop} width={plotW} height={plotH} />
            </clipPath>

            <linearGradient id="history-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.0" />
            </linearGradient>

            <linearGradient id="iv-cone-outer" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.16" />
              <stop offset="55%" stopColor="#6366F1" stopOpacity="0.11" />
              <stop offset="100%" stopColor="#6366F1" stopOpacity="0.06" />
            </linearGradient>

            <linearGradient id="iv-cone-inner" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#818CF8" stopOpacity="0.05" />
            </linearGradient>

            <pattern
              id="maxpain-delta-hatch"
              width="8"
              height="8"
              patternTransform="rotate(45 0 0)"
              patternUnits="userSpaceOnUse"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="8"
                stroke="#F59E0B"
                strokeWidth="1"
                strokeOpacity="0.16"
              />
            </pattern>
          </defs>

          {/* Subtle Left vs Right Zone Backdrop */}
          <rect
            x={plotLeft}
            y={plotTop}
            width={Math.max(0, Math.min(plotRight, xAnchor) - plotLeft)}
            height={plotH}
            fill="#0B111E"
            opacity="0.55"
          />

          {/* Top Zone Labels */}
          <g className="pointer-events-none">
            <text
              x={plotLeft + 8}
              y={24}
              fill="#94A3B8"
              fontSize={11}
              fontWeight={500}
            >
              과거 30일 일봉 종가 (실제 데이터 흐름)
            </text>
            <text
              x={Math.max(plotLeft + 240, xAnchor + 14)}
              y={24}
              fill="#94A3B8"
              fontSize={11}
              fontWeight={500}
            >
              통합 파생상품 분석 공간 — 만기별 옵션 IV 기대범위 · OI Max Pain · 가격대별 청산 유동성
            </text>
          </g>

          {/* Horizontal Price Gridlines (Shared Price Coordinate System) */}
          <g clipPath="url(#unified-plot-clip)">
            {yTicks.map((price) => {
              const y = priceToY(price);
              return (
                <line
                  key={price}
                  x1={plotLeft}
                  y1={y}
                  x2={plotRight}
                  y2={y}
                  stroke="#1E293B"
                  strokeWidth={1}
                  strokeDasharray="2 4"
                  opacity={0.75}
                />
              );
            })}

            {/* Vertical Separator at Current Spot Anchor (1/3 width at default) */}
            <line
              x1={xAnchor}
              y1={plotTop}
              x2={xAnchor}
              y2={plotBottom}
              stroke="#334155"
              strokeWidth={1}
              strokeDasharray="4 4"
            />

            {/* Current Spot Horizontal Reference Line across entire chart */}
            <line
              x1={plotLeft}
              y1={yAnchor}
              x2={plotRight}
              y2={yAnchor}
              stroke="#38BDF8"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.45}
            />

            {/* === LAYER 3A: Liquidation Cluster Subtle Horizontal Heat Bands (Underlay) === */}
            {visibility.showLiquidations &&
              liqBarCoords.map((item) => {
                if (item.intensity < 0.52) return null;
                const fillColor =
                  item.dominantSide === 'short' ? '#FB7185' : '#34D399';
                const bandOpacity = (item.intensity - 0.45) * 0.14;
                return (
                  <rect
                    key={`heat-${item.bin.priceFrom}`}
                    x={xAnchor}
                    y={item.yTop}
                    width={Math.max(0, plotRight - xAnchor)}
                    height={item.height}
                    fill={fillColor}
                    opacity={bandOpacity}
                  />
                );
              })}

            {/* === LAYER 1: Option IV & Expected Volatility Cone (Rightwards from xAnchor) === */}
            {visibility.showIV && conePoints.length > 0 && (
              <g>
                {/* 1-Sigma Expected Volatility Cone */}
                <path d={cone1SigmaAreaPath} fill="url(#iv-cone-outer)" />
                {/* 0.5-Sigma Inner Expected Move Core */}
                <path d={coneHalfSigmaAreaPath} fill="url(#iv-cone-inner)" />

                {/* Upper & Lower 1-Sigma Curves */}
                <polyline
                  points={coneUpperPolyline}
                  fill="none"
                  stroke="#38BDF8"
                  strokeWidth={1.75}
                />
                <polyline
                  points={coneLowerPolyline}
                  fill="none"
                  stroke="#38BDF8"
                  strokeWidth={1.75}
                />

                {/* Maturity Vertical Stems, Nodes, and Distinct Tenor Markers */}
                {conePoints.map((pt) => {
                  const isSelected = selectedTenor === pt.tenor;
                  const isHovered = hoverInfo?.nearestMaturity?.tenor === pt.tenor;
                  const active = isSelected || isHovered;
                  const showInlineLabel = labeledConeTenors.has(pt.tenor) || active;

                  return (
                    <g
                      key={pt.tenor}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectTenor(selectedTenor === pt.tenor ? null : pt.tenor);
                      }}
                      className="cursor-pointer"
                    >
                      {/* Vertical volatility span stem at this maturity */}
                      <line
                        x1={pt.x}
                        y1={pt.yUpper1}
                        x2={pt.x}
                        y2={pt.yLower1}
                        stroke={active ? '#7DD3FC' : '#38BDF8'}
                        strokeWidth={active ? 1.6 : 1}
                        strokeDasharray={active ? undefined : '2 3'}
                        opacity={active ? 0.95 : 0.45}
                      />

                      {/* Upper & Lower Bound Nodes */}
                      <circle
                        cx={pt.x}
                        cy={pt.yUpper1}
                        r={active ? 4.5 : 3}
                        fill={active ? '#E0F2FE' : '#090D16'}
                        stroke="#38BDF8"
                        strokeWidth={1.75}
                      />
                      <circle
                        cx={pt.x}
                        cy={pt.yLower1}
                        r={active ? 4.5 : 3}
                        fill={active ? '#E0F2FE' : '#090D16'}
                        stroke="#38BDF8"
                        strokeWidth={1.75}
                      />

                      {/* Inline IV & Upper/Lower price labels for key maturities */}
                      {showInlineLabel && (
                        <g className="pointer-events-none">
                          <text
                            x={pt.x}
                            y={pt.yUpper1 - 8}
                            textAnchor="middle"
                            fill={active ? '#E0F2FE' : '#7DD3FC'}
                            fontSize={10}
                            fontFamily="var(--font-mono)"
                          >
                            {pt.tenor} · IV {(pt.atmIv * 100).toFixed(1)}%
                          </text>
                          {active && (
                            <>
                              <text
                                x={pt.x}
                                y={pt.yUpper1 - 21}
                                textAnchor="middle"
                                fill="#BAE6FD"
                                fontSize={10}
                                fontFamily="var(--font-mono)"
                              >
                                +{formatPercent(pt.expectedMovePct, 1)} ({formatUsd(pt.upper1Sigma, 0)})
                              </text>
                              <text
                                x={pt.x}
                                y={pt.yLower1 + 16}
                                textAnchor="middle"
                                fill="#BAE6FD"
                                fontSize={10}
                                fontFamily="var(--font-mono)"
                              >
                                -{formatPercent(pt.expectedMovePct, 1)} ({formatUsd(pt.lower1Sigma, 0)})
                              </text>
                            </>
                          )}
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>
            )}

            {/* === LAYER 2: OI-Based Max Pain Horizontal Reference & Spot Comparison === */}
            {visibility.showMaxPain && (
              <g>
                {/* Visual Divergence Zone between Spot and Max Pain */}
                <rect
                  x={xAnchor}
                  y={Math.min(yAnchor, yMaxPain)}
                  width={Math.max(0, plotRight - xAnchor)}
                  height={Math.max(2, Math.abs(yMaxPain - yAnchor))}
                  fill="url(#maxpain-delta-hatch)"
                />
                <rect
                  x={xAnchor}
                  y={Math.min(yAnchor, yMaxPain)}
                  width={Math.max(0, plotRight - xAnchor)}
                  height={Math.max(2, Math.abs(yMaxPain - yAnchor))}
                  fill="#F59E0B"
                  opacity={0.07}
                />

                {/* Max Pain Horizontal Reference Line */}
                <line
                  x1={xAnchor}
                  y1={yMaxPain}
                  x2={plotRight}
                  y2={yMaxPain}
                  stroke="#F59E0B"
                  strokeWidth={1.75}
                  strokeDasharray="6 3"
                />

                {/* Vertical Comparison Bracket between Spot & Max Pain */}
                {Math.abs(yMaxPain - yAnchor) > 4 && (
                  <g className="pointer-events-none">
                    <line
                      x1={xAnchor + 18}
                      y1={yAnchor}
                      x2={xAnchor + 18}
                      y2={yMaxPain}
                      stroke="#FBBF24"
                      strokeWidth={1.5}
                    />
                    <line
                      x1={xAnchor + 14}
                      y1={yAnchor}
                      x2={xAnchor + 22}
                      y2={yAnchor}
                      stroke="#FBBF24"
                      strokeWidth={1.5}
                    />
                    <line
                      x1={xAnchor + 14}
                      y1={yMaxPain}
                      x2={xAnchor + 22}
                      y2={yMaxPain}
                      stroke="#FBBF24"
                      strokeWidth={1.5}
                    />
                  </g>
                )}

                {/* Max Pain Diamond Marker */}
                <g transform={`translate(${xAnchor + 42}, ${yMaxPain})`}>
                  <polygon
                    points="0,-6 6,0 0,6 -6,0"
                    fill="#F59E0B"
                    stroke="#090D16"
                    strokeWidth={1.5}
                  />
                </g>

                {/* Max Pain Inline Label (smart offset away from Spot line) */}
                <g className="pointer-events-none">
                  {(() => {
                    const isBelowSpot = yMaxPain >= yAnchor;
                    const labelY = isBelowSpot
                      ? Math.max(yMaxPain + 16, yAnchor + 22)
                      : Math.min(yMaxPain - 10, yAnchor - 16);
                    return (
                      <text
                        x={xAnchor + 56}
                        y={labelY}
                        fill="#FCD34D"
                        fontSize={11}
                        fontWeight={600}
                        fontFamily="var(--font-mono)"
                      >
                        MAX PAIN {formatUsd(maxPain.maxPainPrice, 0)} ({formatSignedUsd(maxPain.diffFromSpotUsd, 0)} /{' '}
                        {formatPercent(maxPain.diffFromSpotPct, 2, true)})
                      </text>
                    );
                  })()}
                </g>

                {/* Per-Maturity Max Pain Connecting Curve & Dots (7D..365D matching IV tenors) */}
                {maturityMaxPainCoords.length > 0 && (
                  <g>
                    <polyline
                      points={maturityMaxPainPolyline}
                      fill="none"
                      stroke="#F59E0B"
                      strokeWidth={1.5}
                      opacity={0.72}
                    />
                    {maturityMaxPainCoords.map((mp) => {
                      const isSelected = selectedTenor === mp.tenor;
                      const isHovered = hoverInfo?.nearestMaturityMaxPain?.tenor === mp.tenor;
                      const active = isSelected || isHovered;
                      const showLabel = labeledMpTenors.has(mp.tenor) || active;
                      return (
                        <g
                          key={`mp-${mp.tenor}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectTenor(selectedTenor === mp.tenor ? null : mp.tenor);
                          }}
                          className="cursor-pointer"
                        >
                          <circle
                            cx={mp.x}
                            cy={mp.y}
                            r={active ? 6.5 : 4.2}
                            fill="#F59E0B"
                            opacity={active ? 0.25 : 0}
                          />
                          <circle
                            cx={mp.x}
                            cy={mp.y}
                            r={active ? 4.5 : 3.5}
                            fill={active ? '#FEF3C7' : '#F59E0B'}
                            stroke="#090D16"
                            strokeWidth={1.5}
                          />
                          {showLabel && (
                            <text
                              x={mp.x}
                              y={mp.y + (mp.y >= yAnchor ? 14 : -10)}
                              textAnchor="middle"
                              fill={active ? '#FEF3C7' : '#FBBF24'}
                              fontSize={9.5}
                              fontWeight={active ? 700 : 500}
                              fontFamily="var(--font-mono)"
                              className="pointer-events-none"
                            >
                              {mp.tenor} {formatUsd(mp.maxPainPrice, 0)}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>
                )}
              </g>
            )}

            {/* === LAYER 3B: Right-Aligned Price-Bucketed Liquidation Profile Bars or Unsupported Status === */}
            {visibility.showLiquidations && (
              <g>
                {/* Right profile subtle axis spine */}
                <line
                  x1={plotRight - liqBarMaxWidth - 8}
                  y1={plotTop}
                  x2={plotRight - liqBarMaxWidth - 8}
                  y2={plotBottom}
                  stroke="#1E293B"
                  strokeWidth={1}
                  strokeDasharray="2 4"
                  opacity={0.7}
                />

                {!snapshot.liquidationSupport.supported || liqBarCoords.length === 0 ? (
                  <g className="pointer-events-none">
                    <rect
                      x={plotRight - liqBarMaxWidth - 4}
                      y={plotTop + 14}
                      width={liqBarMaxWidth}
                      height={70}
                      rx={4}
                      fill="#0C121E"
                      stroke="#1E293B"
                      strokeWidth={1}
                      opacity={0.92}
                    />
                    <text
                      x={plotRight - liqBarMaxWidth / 2 - 4}
                      y={plotTop + 34}
                      textAnchor="middle"
                      fill="#94A3B8"
                      fontSize={10.5}
                      fontWeight={600}
                    >
                      가격별 청산 물량
                    </text>
                    <text
                      x={plotRight - liqBarMaxWidth / 2 - 4}
                      y={plotTop + 52}
                      textAnchor="middle"
                      fill="#FBBF24"
                      fontSize={10}
                      fontWeight={600}
                    >
                      데이터 미지원
                    </text>
                    <text
                      x={plotRight - liqBarMaxWidth / 2 - 4}
                      y={plotTop + 68}
                      textAnchor="middle"
                      fill="#64748B"
                      fontSize={9.5}
                    >
                      유료 히트맵 API 필요
                    </text>
                  </g>
                ) : (
                  <>
                    {liqBarCoords.map((item) => {
                      const isHovered =
                        hoverInfo?.hoveredLiq?.priceFrom === item.bin.priceFrom;
                      const estColor = item.dominantSide === 'short' ? '#FB7185' : '#34D399';
                      const realColor = item.dominantSide === 'short' ? '#E11D48' : '#059669';
                      const estWidth = Math.max(0, item.totalWidth - item.realWidth);

                      return (
                        <g key={`liq-${item.bin.priceFrom}`}>
                          {/* Estimated Liquidation Bar (Left portion) */}
                          {estWidth > 0.5 && (
                            <rect
                              x={plotRight - item.totalWidth}
                              y={item.yTop}
                              width={estWidth}
                              height={item.height}
                              fill={estColor}
                              opacity={isHovered ? 0.95 : 0.45 + item.intensity * 0.4}
                              rx={1}
                            />
                          )}
                          {/* Realized 24h Liquidation Segment (Solid core anchored on right) */}
                          {item.realWidth > 0.5 && (
                            <rect
                              x={plotRight - item.realWidth}
                              y={item.yTop}
                              width={item.realWidth}
                              height={item.height}
                              fill={realColor}
                              opacity={0.95}
                              rx={1}
                            />
                          )}
                        </g>
                      );
                    })}

                    {/* Peak Short & Peak Long Cluster Callouts */}
                    {liquidationSummary.peakShortCluster && (
                      <g className="pointer-events-none">
                        {(() => {
                          const c = liquidationSummary.peakShortCluster!;
                          const cy = priceToY(c.midPrice);
                          const totalS = c.estimatedShortUsdM + c.realizedShortUsdM;
                          return (
                            <text
                              x={plotRight - liqBarMaxWidth - 12}
                              y={cy + 3}
                              textAnchor="end"
                              fill="#FDA4AF"
                              fontSize={10}
                              fontFamily="var(--font-mono)"
                            >
                              숏 집중 {formatUsd(c.midPrice, 0)} ({formatUsdMillions(totalS)})
                            </text>
                          );
                        })()}
                      </g>
                    )}

                    {liquidationSummary.peakLongCluster && (
                      <g className="pointer-events-none">
                        {(() => {
                          const c = liquidationSummary.peakLongCluster!;
                          const cy = priceToY(c.midPrice);
                          const totalL = c.estimatedLongUsdM + c.realizedLongUsdM;
                          return (
                            <text
                              x={plotRight - liqBarMaxWidth - 12}
                              y={cy + 3}
                              textAnchor="end"
                              fill="#6EE7B7"
                              fontSize={10}
                              fontFamily="var(--font-mono)"
                            >
                              롱 집중 {formatUsd(c.midPrice, 0)} ({formatUsdMillions(totalL)})
                            </text>
                          );
                        })()}
                      </g>
                    )}
                  </>
                )}
              </g>
            )}

            {/* === LEFT ZONE: 30-Day Historical Daily Close Line Chart === */}
            <g>
              <path d={historyAreaPath} fill="url(#history-fill)" />
              <polyline
                points={historyPolyline}
                fill="none"
                stroke="#E2E8F0"
                strokeWidth={2}
                strokeLinejoin="miter"
              />

              {/* Subtle data vertex ticks */}
              {historyCoords.map((pt, idx) => {
                const isLast = idx === historyCoords.length - 1;
                const isHovered = hoverInfo?.nearestHistory?.date === pt.date;
                if (isLast) return null;
                return (
                  <circle
                    key={pt.date}
                    cx={pt.x}
                    cy={pt.y}
                    r={isHovered ? 4 : 1.75}
                    fill={isHovered ? '#38BDF8' : '#94A3B8'}
                    opacity={isHovered ? 1 : 0.6}
                  />
                );
              })}

              {/* Highlighted Final Close / Current Spot Anchor Marker at (xAnchor, yAnchor) */}
              <circle cx={xAnchor} cy={yAnchor} r={11} fill="#38BDF8" opacity={0.14} />
              <circle
                cx={xAnchor}
                cy={yAnchor}
                r={5.5}
                fill="#38BDF8"
                stroke="#090D16"
                strokeWidth={2}
              />
              <text
                x={xAnchor - 10}
                y={yAnchor - 12}
                textAnchor="end"
                fill="#E0F2FE"
                fontSize={11}
                fontWeight={600}
                fontFamily="var(--font-mono)"
              >
                현재 기준가 {formatUsd(snapshot.currentPrice, 0)}
              </text>
            </g>

            {/* === INTERACTIVE CROSSHAIR === */}
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
                  x1={hoverInfo.x}
                  y1={plotTop}
                  x2={hoverInfo.x}
                  y2={plotBottom}
                  stroke="#64748B"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
              </g>
            )}
          </g>

          {/* Outer Plot Frame Hairlines */}
          <rect
            x={plotLeft}
            y={plotTop}
            width={plotW}
            height={plotH}
            fill="none"
            stroke="#1E293B"
            strokeWidth={1}
          />

          {/* === RIGHT Y-AXIS: Shared Price Scale === */}
          <g className="pointer-events-none">
            {yTicks.map((price) => {
              const y = priceToY(price);
              if (y < plotTop + 8 || y > plotBottom - 8) return null;
              return (
                <g key={`ytick-${price}`}>
                  <line x1={plotRight} y1={y} x2={plotRight + 5} y2={y} stroke="#334155" />
                  <text
                    x={plotRight + 9}
                    y={y + 3.5}
                    fill="#94A3B8"
                    fontSize={11}
                    fontFamily="var(--font-mono)"
                  >
                    {formatUsd(price, 0)}
                  </text>
                </g>
              );
            })}

            {/* Max Pain Y-Axis Tag */}
            {visibility.showMaxPain && yMaxPain >= plotTop && yMaxPain <= plotBottom && (
              <g transform={`translate(${plotRight + 2}, ${yMaxPain})`}>
                <rect x={0} y={-10} width={86} height={20} rx={3} fill="#D97706" />
                <text
                  x={6}
                  y={3.5}
                  fill="#090D16"
                  fontSize={11}
                  fontWeight={700}
                  fontFamily="var(--font-mono)"
                >
                  {formatUsd(maxPain.maxPainPrice, 0)}
                </text>
              </g>
            )}

            {/* Current Spot Price Y-Axis Tag */}
            {yAnchor >= plotTop && yAnchor <= plotBottom && (
              <g transform={`translate(${plotRight + 2}, ${yAnchor})`}>
                <rect x={0} y={-10} width={86} height={20} rx={3} fill="#38BDF8" />
                <text
                  x={6}
                  y={3.5}
                  fill="#090D16"
                  fontSize={11}
                  fontWeight={700}
                  fontFamily="var(--font-mono)"
                >
                  {formatUsd(snapshot.currentPrice, 0)}
                </text>
              </g>
            )}

            {/* Crosshair Hovered Price Tag */}
            {hoverInfo && (
              <g transform={`translate(${plotRight + 2}, ${hoverInfo.y})`}>
                <rect x={0} y={-10} width={86} height={20} rx={3} fill="#334155" />
                <text
                  x={6}
                  y={3.5}
                  fill="#F8FAFC"
                  fontSize={11}
                  fontWeight={600}
                  fontFamily="var(--font-mono)"
                >
                  {formatUsd(hoverInfo.hoveredPrice, 0)}
                </text>
              </g>
            )}
          </g>

          {/* === BOTTOM X-AXIS: Left 30D Dates + Current Anchor + Right Option Tenors === */}
          <g className="pointer-events-none">
            {/* Historical ticks: -29d, -20d, -10d */}
            {[-29, -20, -10].map((offset) => {
              const pt = snapshot.history30d.find((d) => d.dayOffset === offset);
              if (!pt) return null;
              const x = dayToX(offset);
              if (x < plotLeft || x > xAnchor - 24) return null;
              return (
                <g key={`hx-${offset}`}>
                  <line x1={x} y1={plotBottom} x2={x} y2={plotBottom + 5} stroke="#334155" />
                  <text
                    x={x}
                    y={plotBottom + 19}
                    textAnchor="middle"
                    fill="#64748B"
                    fontSize={11}
                    fontFamily="var(--font-mono)"
                  >
                    {pt.label}
                  </text>
                </g>
              );
            })}

            {/* Current Spot Anchor X Tick */}
            {xAnchor >= plotLeft && xAnchor <= plotRight && (
              <g>
                <line x1={xAnchor} y1={plotBottom} x2={xAnchor} y2={plotBottom + 6} stroke="#38BDF8" />
                <text
                  x={xAnchor}
                  y={plotBottom + 20}
                  textAnchor="middle"
                  fill="#38BDF8"
                  fontSize={11}
                  fontWeight={600}
                  fontFamily="var(--font-mono)"
                >
                  현재 (0D)
                </text>
              </g>
            )}

            {/* Right Option Maturity Ticks (collision-free across live expiries) */}
            {visibleTenorTicks.map((t) => (
              <g key={`mx-${t.tenor}`}>
                <line x1={t.x} y1={plotBottom} x2={t.x} y2={plotBottom + 5} stroke="#334155" />
                <text
                  x={t.x}
                  y={plotBottom + 19}
                  textAnchor="middle"
                  fill={selectedTenor === t.tenor ? '#7DD3FC' : '#94A3B8'}
                  fontSize={11}
                  fontFamily="var(--font-mono)"
                >
                  {t.tenor}
                </text>
              </g>
            ))}

            {/* Liquidation Zone Axis Label */}
            {visibility.showLiquidations && (
              <text
                x={plotRight - liqBarMaxWidth / 2}
                y={plotBottom + 19}
                textAnchor="middle"
                fill="#64748B"
                fontSize={10}
              >
                {snapshot.liquidationSupport.supported ? '청산 분포 (USD)' : '청산 (미지원)'}
              </text>
            )}
          </g>
        </svg>

        {/* Floating Context-Aware Hover Tooltip */}
        {hoverInfo && (
          <div
            className="pointer-events-none absolute z-20 w-72 rounded-lg border border-slate-700/90 bg-[#0D1320]/95 p-3 text-xs text-slate-200 shadow-2xl backdrop-blur-sm"
            style={{
              left:
                hoverInfo.x + 310 > size.width - margin.right
                  ? Math.max(12, hoverInfo.x - 302)
                  : hoverInfo.x + 16,
              top:
                hoverInfo.y + 210 > size.height
                  ? Math.max(12, hoverInfo.y - 190)
                  : Math.max(12, hoverInfo.y + 12),
            }}
          >
            {/* Hovered Price Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2">
              <span className="font-medium text-slate-400">커서 가격</span>
              <div className="text-right font-mono-tabular">
                <span className="font-semibold text-slate-50">
                  {formatUsd(hoverInfo.hoveredPrice, 0)}
                </span>
                <span
                  className={`ml-1.5 ${
                    hoverInfo.pctFromSpot >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  ({formatPercent(hoverInfo.pctFromSpot, 2, true)})
                </span>
              </div>
            </div>

            {/* Historical Day Info */}
            {hoverInfo.nearestHistory && (
              <div className="space-y-1 mb-2 pb-2 border-b border-slate-800/80">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">과거 일봉 ({hoverInfo.nearestHistory.date})</span>
                  <span className="font-mono-tabular font-semibold text-sky-300">
                    {formatUsd(hoverInfo.nearestHistory.close, 0)}
                  </span>
                </div>
                {hoverInfo.nearestHistory.prevClose && (
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>전일 대비</span>
                    <span className="font-mono-tabular">
                      {formatPercent(
                        (hoverInfo.nearestHistory.close - hoverInfo.nearestHistory.prevClose) /
                          hoverInfo.nearestHistory.prevClose,
                        2,
                        true,
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Option Maturity IV Info */}
            {hoverInfo.nearestMaturity && (
              <div className="space-y-1 mb-2 pb-2 border-b border-slate-800/80">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sky-300">
                    옵션 만기 {hoverInfo.nearestMaturity.tenor} ({hoverInfo.nearestMaturity.expiryDate})
                  </span>
                  <span className="font-mono-tabular text-sky-200">
                    IV {(hoverInfo.nearestMaturity.atmIv * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">1σ 기대 변동폭</span>
                  <span className="font-mono-tabular text-slate-200">
                    ±{formatUsd(hoverInfo.nearestMaturity.expectedMoveUsd, 0)} (±
                    {formatPercent(hoverInfo.nearestMaturity.expectedMovePct, 1)})
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">예상 상단 / 하단</span>
                  <span className="font-mono-tabular text-slate-300">
                    {formatUsd(hoverInfo.nearestMaturity.upper1Sigma, 0)} /{' '}
                    {formatUsd(hoverInfo.nearestMaturity.lower1Sigma, 0)}
                  </span>
                </div>
              </div>
            )}

            {/* Max Pain Comparison */}
            {visibility.showMaxPain && (
              <div className="space-y-1 mb-2 pb-2 border-b border-slate-800/80">
                <div className="flex items-center justify-between">
                  <span className="text-amber-300">전체 OI Max Pain</span>
                  <span className="font-mono-tabular font-semibold text-amber-200">
                    {formatUsd(maxPain.maxPainPrice, 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>현재가 괴리</span>
                  <span className="font-mono-tabular">
                    {formatSignedUsd(maxPain.diffFromSpotUsd, 0)} (
                    {formatPercent(maxPain.diffFromSpotPct, 2, true)})
                  </span>
                </div>
                {hoverInfo.nearestMaturityMaxPain && (
                  <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-800/60">
                    <span className="text-amber-300">
                      만기 {hoverInfo.nearestMaturityMaxPain.tenor} Max Pain
                    </span>
                    <span className="font-mono-tabular font-semibold text-amber-200">
                      {formatUsd(hoverInfo.nearestMaturityMaxPain.maxPainPrice, 0)} (
                      {formatPercent(hoverInfo.nearestMaturityMaxPain.diffFromSpotPct, 2, true)})
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Liquidation Bucket Breakdown (Estimated vs Realized clearly distinguished) */}
            {hoverInfo.hoveredLiq && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 font-medium">
                    청산 구간 ({formatUsd(hoverInfo.hoveredLiq.priceFrom, 0)}–
                    {formatUsd(hoverInfo.hoveredLiq.priceTo, 0)})
                  </span>
                  <span className="font-mono-tabular text-[11px] text-slate-400">
                    {hoverInfo.hoveredLiq.dominantLeverage}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-rose-300">숏 추정 청산 (Estimated)</span>
                  <span className="font-mono-tabular text-rose-200">
                    {formatUsdMillions(hoverInfo.hoveredLiq.estimatedShortUsdM)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-emerald-300">롱 추정 청산 (Estimated)</span>
                  <span className="font-mono-tabular text-emerald-200">
                    {formatUsdMillions(hoverInfo.hoveredLiq.estimatedLongUsdM)}
                  </span>
                </div>
                {(hoverInfo.hoveredLiq.realizedShortUsdM > 0 ||
                  hoverInfo.hoveredLiq.realizedLongUsdM > 0) && (
                  <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-800/60">
                    <span className="text-slate-300">24h 실제 청산 (Realized)</span>
                    <span className="font-mono-tabular text-slate-100">
                      숏 {formatUsdMillions(hoverInfo.hoveredLiq.realizedShortUsdM)} · 롱{' '}
                      {formatUsdMillions(hoverInfo.hoveredLiq.realizedLongUsdM)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Quiet Inline Legend & Interaction Hint Strip at Bottom-Left */}
        <div className="pointer-events-none absolute bottom-11 left-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 bg-slate-200 inline-block" />
            30D 종가
          </span>
          {visibility.showIV && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3.5 bg-sky-400/30 border border-sky-400 inline-block" />
              옵션 IV ±1σ 기대범위
            </span>
          )}
          {visibility.showMaxPain && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3.5 border-t-2 border-dashed border-amber-400 inline-block" />
              Max Pain 기준선 · 만기별 포인트
            </span>
          )}
          {visibility.showLiquidations && (
            snapshot.liquidationSupport.supported ? (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 bg-rose-400/80 inline-block rounded-[1px]" />
                  숏 청산 (추정/실제)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 bg-emerald-400/80 inline-block rounded-[1px]" />
                  롱 청산 (추정/실제)
                </span>
              </>
            ) : (
              <span className="text-amber-300/90">
                청산 물량: 미지원 (유료 API 필요)
              </span>
            )
          )}
          <span className="text-slate-500 hidden md:inline">
            · 휠: 가격/전체 확대·축소 · Shift+휠: 시간축 확대·축소 · 드래그: 이동 · 더블클릭: 기준점 복원
          </span>
        </div>
      </div>
    </section>
  );
};
