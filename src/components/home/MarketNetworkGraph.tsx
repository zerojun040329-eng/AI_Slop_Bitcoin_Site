import React, { useEffect, useRef, useState } from 'react';
import {
  HOME_FUI_COLORS,
  getPolarityColor,
  getValuePolarity,
  rgbaFromPolarity,
  type FuiPolarity,
} from './homeTokens';
import type {
  HomeMarketNetworkViewModel,
  NetworkAssetId,
  NetworkAssetNodeData,
  NetworkNodeId,
} from './marketNetworkAdapter';

export type HomeRevealMode = 'initial' | 'reentry' | 'none';

export interface NodeScreenSnapshot {
  rect: DOMRect;
  label: string;
  primaryText: string;
  secondaryText: string;
  secondaryColor: string;
  strokeColor: string;
  fillColor: string;
  polarityColor: string;
}

export interface MarketNetworkGraphProps {
  model: HomeMarketNetworkViewModel;
  selectedNodeId: NetworkNodeId | null;
  onSelectNode: (nodeId: NetworkNodeId | null, snapshot?: NodeScreenSnapshot | null) => void;
  nodeSnapshotGetterRef?: React.MutableRefObject<
    ((id: NetworkNodeId) => NodeScreenSnapshot | null) | null
  >;
  returningNodeId?: NetworkNodeId | null;
  revealMode?: HomeRevealMode;
  revealRunId?: number;
}

interface Point {
  x: number;
  y: number;
}

interface RevealProfile {
  orbitDelayMs: number;
  orbitDurMs: number;
  centerNodeDelayMs: number;
  centerNodeDurMs: number;
  centerGlowDelayMs: number;
  centerGlowDurMs: number;
  centerTextDelayMs: number;
  centerTextDurMs: number;
  edgeStartDelayMs: number;
  edgeStaggerMs: number;
  edgeDrawDurMs: number;
  edgeBadgeOffsetMs: number;
  edgeBadgeDurMs: number;
  outerNodeOffsetMs: number;
  outerNodeDurMs: number;
  outerTextOffsetMs: number;
  outerTextDurMs: number;
  settleAfterMs: number;
}

const REVEAL_PROFILES: Record<'initial' | 'reentry', RevealProfile> = {
  // ~2.0s progressive center-outward reveal on first Home entry
  initial: {
    orbitDelayMs: 90,
    orbitDurMs: 460,
    centerNodeDelayMs: 0,
    centerNodeDurMs: 420,
    centerGlowDelayMs: 80,
    centerGlowDurMs: 720,
    centerTextDelayMs: 260,
    centerTextDurMs: 360,
    edgeStartDelayMs: 360,
    edgeStaggerMs: 110,
    edgeDrawDurMs: 520,
    edgeBadgeOffsetMs: 360,
    edgeBadgeDurMs: 280,
    outerNodeOffsetMs: 380,
    outerNodeDurMs: 400,
    outerTextOffsetMs: 560,
    outerTextDurMs: 340,
    settleAfterMs: 1950,
  },
  // ~0.62s crisp progressive reveal when returning to Home
  reentry: {
    orbitDelayMs: 20,
    orbitDurMs: 180,
    centerNodeDelayMs: 0,
    centerNodeDurMs: 160,
    centerGlowDelayMs: 25,
    centerGlowDurMs: 260,
    centerTextDelayMs: 85,
    centerTextDurMs: 150,
    edgeStartDelayMs: 110,
    edgeStaggerMs: 35,
    edgeDrawDurMs: 190,
    edgeBadgeOffsetMs: 135,
    edgeBadgeDurMs: 120,
    outerNodeOffsetMs: 130,
    outerNodeDurMs: 160,
    outerTextOffsetMs: 205,
    outerTextDurMs: 140,
    settleAfterMs: 660,
  },
};

const NODE_REVEAL_INDEX: Record<Exclude<NetworkNodeId, 'BTC' | 'DGS10'>, number> = {
  QQQ: 0,
  M2: 1,
  TLT: 2,
  WTI: 3,
  XAU: 4,
  SPY: 5,
};

const CANVAS_WIDTH = 1160;
const CANVAS_HEIGHT = 650;

const BTC_POS: Point = { x: 580, y: 325 };
const BTC_RADIUS = 68;
const ORBIT_RADIUS = 228;

function radialPoint(angleDeg: number, radius = ORBIT_RADIUS): Point {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: Math.round(BTC_POS.x + radius * Math.cos(rad)),
    y: Math.round(BTC_POS.y + radius * Math.sin(rad)),
  };
}

// Uniform 60° radial alignment around center BTC
const ASSET_RADIUS = 54;
const ASSET_POSITIONS: Record<Exclude<NetworkAssetId, 'BTC'>, Point> = {
  QQQ: radialPoint(-90),
  TLT: radialPoint(30),
  WTI: radialPoint(90),
  XAU: radialPoint(150),
  SPY: radialPoint(-150),
};

const M2_POS: Point = radialPoint(-30);
const MACRO_RADIUS = 58;

function prefersReducedMotionMatch(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isNodeRelatedTo(nodeId: NetworkNodeId, selectedId: NetworkNodeId | null): boolean {
  if (!selectedId) return true;
  if (nodeId === selectedId) return true;
  if (selectedId === 'BTC') {
    return nodeId !== 'DGS10';
  }
  return nodeId === 'BTC';
}

function isAssetEdgeRelated(targetId: NetworkAssetId, focusId: NetworkNodeId | null): boolean {
  if (!focusId) return true;
  return focusId === 'BTC' || focusId === targetId;
}

function isBtcM2EdgeRelated(focusId: NetworkNodeId | null): boolean {
  if (!focusId) return true;
  return focusId === 'BTC' || focusId === 'M2';
}

function formatAssetPrice(
  price: number | null,
  status?: NetworkAssetNodeData['status'],
): string {
  if (price === null || !Number.isFinite(price)) {
    return status === 'syncing' ? '대기 중' : 'N/A';
  }
  return `$${price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatChange24h(
  val: number | null,
  status?: NetworkAssetNodeData['status'],
): { text: string; color: string } {
  if (val === null || !Number.isFinite(val)) {
    return {
      text: status === 'syncing' ? '—' : 'N/A',
      color: 'rgba(242, 245, 247, 0.45)',
    };
  }
  const sign = val > 0 ? '+' : '';
  const polarity = getValuePolarity(val);
  return {
    text: `${sign}${val.toFixed(2)}%`,
    color:
      polarity === 'neutral' ? 'rgba(242, 245, 247, 0.72)' : getPolarityColor(polarity),
  };
}

function formatCorrelation(r: number | null): string {
  if (r === null || !Number.isFinite(r)) return '—';
  const sign = r > 0 ? '+' : '';
  return `${sign}${r.toFixed(2)}`;
}

function edgeStrokeWidth(r: number): number {
  const absR = Math.min(1, Math.abs(r));
  return 1.4 + absR * 4.8;
}

function edgeStrokeOpacity(r: number): number {
  const absR = Math.min(1, Math.abs(r));
  return 0.28 + absR * 0.6;
}

function pointAlongLine(a: Point, b: Point, t: number): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function getNodeGlowFilter(
  polarity: FuiPolarity,
  isSelected: boolean,
  isHovered: boolean,
): string | undefined {
  if (isSelected) return `url(#fui-glow-active-${polarity})`;
  if (isHovered) return `url(#fui-glow-hover-${polarity})`;
  if (polarity === 'positive' || polarity === 'negative') {
    return `url(#fui-glow-rest-${polarity})`;
  }
  return undefined;
}

function fadeStyle(
  active: boolean,
  delayMs: number,
  durationMs: number,
): React.CSSProperties | undefined {
  if (!active) return undefined;
  return {
    animationDelay: `${delayMs}ms`,
    animationDuration: `${durationMs}ms`,
  };
}

export const MarketNetworkGraph: React.FC<MarketNetworkGraphProps> = ({
  model,
  selectedNodeId,
  onSelectNode,
  nodeSnapshotGetterRef,
  returningNodeId = null,
  revealMode = 'none',
  revealRunId = 0,
}) => {
  const [hoveredNodeId, setHoveredNodeId] = useState<NetworkNodeId | null>(null);
  const [settledRunId, setSettledRunId] = useState<number>(0);
  const circleRefs = useRef<Partial<Record<NetworkNodeId, SVGCircleElement | null>>>({});

  // Full center-outward progressive reveal ONLY runs on 'initial' entry.
  // 'reentry' keeps all nodes & edges visible without ever dropping them to opacity: 0.
  const isInitialRevealMode = revealMode === 'initial';
  const profile = isInitialRevealMode ? REVEAL_PROFILES.initial : null;
  const isRevealing = Boolean(
    profile && revealRunId > 0 && settledRunId !== revealRunId && !prefersReducedMotionMatch(),
  );
  const isReentryHaloActive = Boolean(
    revealMode === 'reentry' &&
      revealRunId > 0 &&
      settledRunId !== revealRunId &&
      !prefersReducedMotionMatch(),
  );

  useEffect(() => {
    if (revealMode === 'none' || revealRunId <= 0 || prefersReducedMotionMatch()) {
      return;
    }

    const activeProfile = REVEAL_PROFILES[revealMode];
    const timer = window.setTimeout(() => {
      setSettledRunId(revealRunId);
    }, activeProfile.settleAfterMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [revealMode, revealRunId]);

  const edgeMap = new Map(model.assetEdges.map((edge) => [edge.targetId, edge]));
  const btcM2Mid = pointAlongLine(BTC_POS, M2_POS, 0.53);

  const buildNodeSnapshot = (nodeId: NetworkNodeId): NodeScreenSnapshot | null => {
    const circle = circleRefs.current[nodeId];
    if (!circle) return null;
    const rect = circle.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    if (nodeId === 'M2') {
      const polarity = getValuePolarity(model.m2Node.changeValue);
      const polarityColor = getPolarityColor(polarity);
      return {
        rect,
        label: model.m2Node.label,
        primaryText: model.m2Node.primaryValueText,
        secondaryText: model.m2Node.secondaryValueText,
        secondaryColor: polarityColor,
        strokeColor: rgbaFromPolarity(polarity, 0.72),
        fillColor: '#0E1729',
        polarityColor,
      };
    }

    const assetNode =
      nodeId === 'BTC'
        ? model.centerBtc
        : model.surroundingAssets.find((a) => a.id === nodeId) ?? null;
    if (!assetNode) return null;

    const polarity = getValuePolarity(assetNode.change24hPct);
    const polarityColor = getPolarityColor(polarity);
    const change = formatChange24h(assetNode.change24hPct, assetNode.status);
    return {
      rect,
      label: assetNode.id,
      primaryText: formatAssetPrice(assetNode.latestPrice, assetNode.status),
      secondaryText: change.text,
      secondaryColor: change.color,
      strokeColor: rgbaFromPolarity(polarity, 0.72),
      fillColor: '#0E1729',
      polarityColor,
    };
  };

  if (nodeSnapshotGetterRef) {
    nodeSnapshotGetterRef.current = buildNodeSnapshot;
  }

  const handleNodeActivate = (
    e: React.MouseEvent | React.KeyboardEvent,
    nodeId: NetworkNodeId,
  ) => {
    e.stopPropagation();
    onSelectNode(nodeId, buildNodeSnapshot(nodeId));
  };

  const renderAssetNode = (
    node: NetworkAssetNodeData,
    pos: Point,
    radius: number,
    isCenter: boolean,
  ) => {
    const isPendingData = node.status === 'syncing' && node.latestPrice === null;
    const priceText = formatAssetPrice(node.latestPrice, node.status);
    const change = formatChange24h(node.change24hPct, node.status);
    const polarity = getValuePolarity(node.change24hPct);
    const isSelected = selectedNodeId === node.id;
    const isHovered = hoveredNodeId === node.id;
    const isRelated = isNodeRelatedTo(node.id, selectedNodeId);

    const baseDataOpacity = isPendingData ? 0.48 : 1;
    const nodeOpacity = selectedNodeId ? (isRelated ? baseDataOpacity : 0.24) : baseDataOpacity;

    const strokeAlpha = isPendingData
      ? 0.22
      : isSelected
        ? 0.92
        : isHovered
          ? 0.72
          : polarity === 'neutral'
            ? isCenter
              ? 0.42
              : 0.22
            : isCenter
              ? 0.56
              : 0.42;

    const strokeColor = rgbaFromPolarity(polarity, strokeAlpha);
    const fillColor = isSelected
      ? '#0E1729'
      : isHovered
        ? '#0B1323'
        : isCenter
          ? '#091120'
          : HOME_FUI_COLORS.bgSurface;

    const revealIdx = node.id === 'BTC' ? -1 : NODE_REVEAL_INDEX[node.id];
    const nodeDelay =
      profile && revealIdx >= 0
        ? profile.edgeStartDelayMs + revealIdx * profile.edgeStaggerMs + profile.outerNodeOffsetMs
        : profile?.centerNodeDelayMs ?? 0;
    const nodeDur = profile
      ? isCenter
        ? profile.centerNodeDurMs
        : profile.outerNodeDurMs
      : 0;

    const textDelay =
      profile && revealIdx >= 0
        ? profile.edgeStartDelayMs + revealIdx * profile.edgeStaggerMs + profile.outerTextOffsetMs
        : profile?.centerTextDelayMs ?? 0;
    const textDur = profile
      ? isCenter
        ? profile.centerTextDurMs
        : profile.outerTextDurMs
      : 0;

    return (
      <g
        key={node.id}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        aria-label={`${node.id} 노드 상세 보기`}
        className="outline-none focus:outline-none"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => handleNodeActivate(e, node.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleNodeActivate(e, node.id);
          }
        }}
        onMouseEnter={() => setHoveredNodeId(node.id)}
        onMouseLeave={() => setHoveredNodeId((prev) => (prev === node.id ? null : prev))}
        filter={isPendingData ? undefined : getNodeGlowFilter(polarity, isSelected, isHovered)}
        style={{
          cursor: 'pointer',
          outline: 'none',
          opacity: nodeOpacity,
          transition: 'opacity 320ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Brief entrance highlight halo on center BTC that settles cleanly */}
        {isCenter && (isRevealing || isReentryHaloActive) && (
          <circle
            cx={pos.x}
            cy={pos.y}
            r={radius + 10}
            fill="none"
            stroke={HOME_FUI_COLORS.cyan}
            strokeWidth={1.25}
            className="home-reveal-glow-pulse"
            style={fadeStyle(
              true,
              profile ? profile.centerGlowDelayMs : 0,
              profile ? profile.centerGlowDurMs : 520,
            )}
          />
        )}

        {/* Calm return settle halo when returning from Detail View */}
        {returningNodeId === node.id && (
          <circle
            cx={pos.x}
            cy={pos.y}
            r={radius + 10}
            fill="none"
            stroke={getPolarityColor(polarity)}
            strokeWidth={1.3}
            className="home-reveal-glow-pulse"
            style={fadeStyle(true, 0, 560)}
          />
        )}

        {/* Node circle shell (Phase 1 for center, Phase 3 for surrounding nodes) */}
        <g
          className={isRevealing ? 'home-reveal-fade' : undefined}
          style={fadeStyle(isRevealing, nodeDelay, nodeDur)}
        >
          {(isSelected || isHovered) && (
            <circle
              cx={pos.x}
              cy={pos.y}
              r={radius + 6}
              fill="none"
              stroke={getPolarityColor(polarity)}
              strokeOpacity={isSelected ? 0.5 : 0.28}
              strokeWidth={1}
              strokeDasharray={isSelected ? undefined : '3 4'}
            />
          )}

          <circle
            ref={(el) => {
              circleRefs.current[node.id] = el;
            }}
            cx={pos.x}
            cy={pos.y}
            r={radius}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={isSelected ? 1.75 : isCenter ? 1.45 : 1.1}
            strokeDasharray={isPendingData ? '4 4' : undefined}
            style={{ transition: 'fill 240ms ease, stroke 280ms ease' }}
          />
        </g>

        {/* Node labels & values (Phase 4) */}
        <g
          className={isRevealing ? 'home-reveal-fade' : undefined}
          style={fadeStyle(isRevealing, textDelay, textDur)}
        >
          <text
            x={pos.x}
            y={pos.y - (isCenter ? 20 : 16)}
            textAnchor="middle"
            fill={HOME_FUI_COLORS.white}
            fillOpacity={isSelected || isHovered ? 1 : 0.92}
            fontSize={isCenter ? 16 : 13}
            fontWeight={700}
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {node.id}
          </text>
          <text
            x={pos.x}
            y={pos.y + (isCenter ? 3 : 2)}
            textAnchor="middle"
            fill={HOME_FUI_COLORS.white}
            fillOpacity={isPendingData ? 0.52 : isSelected || isHovered ? 1 : 0.88}
            fontSize={isCenter ? 14 : 12}
            fontWeight={500}
            style={{
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
              transition: 'fill-opacity 280ms ease',
            }}
          >
            {priceText}
          </text>
          <text
            x={pos.x}
            y={pos.y + (isCenter ? 24 : 20)}
            textAnchor="middle"
            fill={change.color}
            fontSize={isCenter ? 12 : 11}
            fontWeight={600}
            style={{
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
              transition: 'fill 280ms ease',
            }}
          >
            {change.text}
          </text>
        </g>
      </g>
    );
  };

  const renderM2Node = () => {
    const id: NetworkNodeId = 'M2';
    const isPendingData = model.m2Node.status === 'syncing' && model.m2Node.changeValue === null;
    const polarity = getValuePolarity(model.m2Node.changeValue);
    const isSelected = selectedNodeId === id;
    const isHovered = hoveredNodeId === id;
    const isRelated = isNodeRelatedTo(id, selectedNodeId);
    const baseDataOpacity = isPendingData ? 0.48 : 1;
    const nodeOpacity = selectedNodeId ? (isRelated ? baseDataOpacity : 0.24) : baseDataOpacity;

    const strokeAlpha = isPendingData
      ? 0.22
      : isSelected
        ? 0.92
        : isHovered
          ? 0.72
          : polarity === 'neutral'
            ? 0.22
            : 0.42;

    const strokeColor = rgbaFromPolarity(polarity, strokeAlpha);
    const fillColor = isSelected
      ? '#0E1729'
      : isHovered
        ? '#0B1323'
        : HOME_FUI_COLORS.bgSurface;

    const primaryColor =
      model.m2Node.primaryValueText === 'N/A' || isPendingData
        ? 'rgba(242, 245, 247, 0.45)'
        : getPolarityColor(polarity);

    const m2Idx = NODE_REVEAL_INDEX.M2;
    const nodeDelay = profile
      ? profile.edgeStartDelayMs + m2Idx * profile.edgeStaggerMs + profile.outerNodeOffsetMs
      : 0;
    const textDelay = profile
      ? profile.edgeStartDelayMs + m2Idx * profile.edgeStaggerMs + profile.outerTextOffsetMs
      : 0;

    return (
      <g
        key={id}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        aria-label={`${model.m2Node.label} 노드 상세 보기`}
        className="outline-none focus:outline-none"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => handleNodeActivate(e, id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleNodeActivate(e, id);
          }
        }}
        onMouseEnter={() => setHoveredNodeId(id)}
        onMouseLeave={() => setHoveredNodeId((prev) => (prev === id ? null : prev))}
        filter={isPendingData ? undefined : getNodeGlowFilter(polarity, isSelected, isHovered)}
        style={{
          cursor: 'pointer',
          outline: 'none',
          opacity: nodeOpacity,
          transition: 'opacity 320ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {returningNodeId === id && (
          <circle
            cx={M2_POS.x}
            cy={M2_POS.y}
            r={MACRO_RADIUS + 10}
            fill="none"
            stroke={getPolarityColor(polarity)}
            strokeWidth={1.3}
            className="home-reveal-glow-pulse"
            style={fadeStyle(true, 0, 560)}
          />
        )}

        <g
          className={isRevealing ? 'home-reveal-fade' : undefined}
          style={fadeStyle(isRevealing, nodeDelay, profile?.outerNodeDurMs ?? 0)}
        >
          {(isSelected || isHovered) && (
            <circle
              cx={M2_POS.x}
              cy={M2_POS.y}
              r={MACRO_RADIUS + 6}
              fill="none"
              stroke={getPolarityColor(polarity)}
              strokeOpacity={isSelected ? 0.5 : 0.28}
              strokeWidth={1}
              strokeDasharray={isSelected ? undefined : '3 4'}
            />
          )}

          <circle
            ref={(el) => {
              circleRefs.current[id] = el;
            }}
            cx={M2_POS.x}
            cy={M2_POS.y}
            r={MACRO_RADIUS}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={isSelected ? 1.75 : 1.1}
            strokeDasharray={isPendingData ? '4 4' : undefined}
            style={{ transition: 'fill 240ms ease, stroke 280ms ease' }}
          />
        </g>

        <g
          className={isRevealing ? 'home-reveal-fade' : undefined}
          style={fadeStyle(isRevealing, textDelay, profile?.outerTextDurMs ?? 0)}
        >
          <text
            x={M2_POS.x}
            y={M2_POS.y - 25}
            textAnchor="middle"
            fill={HOME_FUI_COLORS.white}
            fillOpacity={0.55}
            fontSize={9.5}
            fontWeight={500}
            style={{ fontFamily: 'var(--font-sans)' }}
          >
            거시경제
          </text>
          <text
            x={M2_POS.x}
            y={M2_POS.y - 9}
            textAnchor="middle"
            fill={HOME_FUI_COLORS.white}
            fillOpacity={isSelected || isHovered ? 1 : 0.92}
            fontSize={12.5}
            fontWeight={700}
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {model.m2Node.label}
          </text>
          <text
            x={M2_POS.x}
            y={M2_POS.y + 11}
            textAnchor="middle"
            fill={primaryColor}
            fontSize={13.5}
            fontWeight={600}
            style={{
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
              transition: 'fill 280ms ease',
            }}
          >
            {isPendingData ? '대기 중' : model.m2Node.primaryValueText}
          </text>
          <text
            x={M2_POS.x}
            y={M2_POS.y + 29}
            textAnchor="middle"
            fill="rgba(242, 245, 247, 0.58)"
            fontSize={9.5}
            fontWeight={500}
            style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
          >
            {model.m2Node.secondaryValueText}
          </text>
        </g>
      </g>
    );
  };

  const renderEdge = (
    key: string,
    revealIdx: number,
    a: Point,
    b: Point,
    labelPos: Point,
    r: number | null,
    isSelectedEdge: boolean,
    groupOpacity: number,
    dashed: boolean,
    ariaLabel?: string,
  ) => {
    const polarity = getValuePolarity(r);
    const strokeColor = r === null ? HOME_FUI_COLORS.white : getPolarityColor(polarity);
    const labelColor =
      r === null
        ? 'rgba(242, 245, 247, 0.42)'
        : polarity === 'neutral'
          ? 'rgba(242, 245, 247, 0.8)'
          : strokeColor;

    const edgeDelay = profile ? profile.edgeStartDelayMs + revealIdx * profile.edgeStaggerMs : 0;
    const badgeDelay = profile ? edgeDelay + profile.edgeBadgeOffsetMs : 0;
    const maskId = `fui-reveal-mask-${key}`;

    return (
      <g
        key={key}
        aria-label={ariaLabel}
        style={{
          opacity: groupOpacity,
          transition: 'opacity 320ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <line
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={strokeColor}
          strokeWidth={r === null ? 1.05 : edgeStrokeWidth(r)}
          strokeOpacity={
            r === null ? 0.16 : isSelectedEdge ? 0.94 : edgeStrokeOpacity(r)
          }
          strokeDasharray={r === null ? '3 5' : dashed ? '6 4' : undefined}
          strokeLinecap="round"
          mask={isRevealing ? `url(#${maskId})` : undefined}
          filter={
            r !== null && isSelectedEdge && polarity !== 'neutral'
              ? `url(#fui-edge-glow-${polarity})`
              : undefined
          }
          style={{ transition: 'stroke 280ms ease, stroke-opacity 280ms ease, stroke-width 280ms ease' }}
        />

        <g
          className={isRevealing ? 'home-reveal-fade' : undefined}
          style={fadeStyle(isRevealing, badgeDelay, profile?.edgeBadgeDurMs ?? 0)}
        >
          <rect
            x={labelPos.x - 28}
            y={labelPos.y - 11}
            width={56}
            height={22}
            rx={4}
            fill={HOME_FUI_COLORS.bgCanvas}
            stroke={rgbaFromPolarity(polarity, r === null ? 0.14 : isSelectedEdge ? 0.55 : 0.2)}
            strokeWidth={0.9}
            style={{ transition: 'stroke 280ms ease' }}
          />
          <text
            x={labelPos.x}
            y={labelPos.y + 4}
            textAnchor="middle"
            fill={labelColor}
            fontSize={11}
            fontWeight={600}
            style={{
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
              transition: 'fill 280ms ease',
            }}
          >
            {formatCorrelation(r)}
          </text>
        </g>
      </g>
    );
  };

  const focusNode = selectedNodeId ?? hoveredNodeId;

  const edgeTargets: Array<{ key: string; idx: number; pos: Point }> = [
    { key: 'edge-btc-QQQ', idx: NODE_REVEAL_INDEX.QQQ, pos: ASSET_POSITIONS.QQQ },
    { key: 'edge-btc-m2', idx: NODE_REVEAL_INDEX.M2, pos: M2_POS },
    { key: 'edge-btc-TLT', idx: NODE_REVEAL_INDEX.TLT, pos: ASSET_POSITIONS.TLT },
    { key: 'edge-btc-WTI', idx: NODE_REVEAL_INDEX.WTI, pos: ASSET_POSITIONS.WTI },
    { key: 'edge-btc-XAU', idx: NODE_REVEAL_INDEX.XAU, pos: ASSET_POSITIONS.XAU },
    { key: 'edge-btc-SPY', idx: NODE_REVEAL_INDEX.SPY, pos: ASSET_POSITIONS.SPY },
  ];

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
        role="img"
        aria-label="BTC 중심 글로벌 자산시장 및 거시경제 통합 네트워크"
        onClick={() => onSelectNode(null)}
        className="w-full min-w-[740px] h-full max-h-[640px] block mx-auto select-none outline-none focus:outline-none"
      >
        <defs>
          {/* SVG userSpaceOnUse line-drawing masks active only during progressive reveal */}
          {isRevealing &&
            profile &&
            edgeTargets.map(({ key, idx, pos }) => (
              <mask
                key={`mask-${key}-${revealRunId}`}
                id={`fui-reveal-mask-${key}`}
                maskUnits="userSpaceOnUse"
                x={0}
                y={0}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
              >
                <line
                  x1={BTC_POS.x}
                  y1={BTC_POS.y}
                  x2={pos.x}
                  y2={pos.y}
                  pathLength={100}
                  stroke="#FFFFFF"
                  strokeWidth={24}
                  strokeLinecap="round"
                  className="home-reveal-line-mask"
                  style={fadeStyle(
                    true,
                    profile.edgeStartDelayMs + idx * profile.edgeStaggerMs,
                    profile.edgeDrawDurMs,
                  )}
                />
              </mask>
            ))}

          {/* Rest state minimal directional glow */}
          <filter id="fui-glow-rest-positive" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="2"
              floodColor={HOME_FUI_COLORS.cyan}
              floodOpacity="0.14"
            />
          </filter>
          <filter id="fui-glow-rest-negative" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="2"
              floodColor={HOME_FUI_COLORS.coral}
              floodOpacity="0.14"
            />
          </filter>

          {/* Hover state subtle glow */}
          <filter id="fui-glow-hover-positive" x="-35%" y="-35%" width="170%" height="170%">
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="3.5"
              floodColor={HOME_FUI_COLORS.cyan}
              floodOpacity="0.3"
            />
          </filter>
          <filter id="fui-glow-hover-negative" x="-35%" y="-35%" width="170%" height="170%">
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="3.5"
              floodColor={HOME_FUI_COLORS.coral}
              floodOpacity="0.3"
            />
          </filter>
          <filter id="fui-glow-hover-neutral" x="-35%" y="-35%" width="170%" height="170%">
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="3"
              floodColor={HOME_FUI_COLORS.white}
              floodOpacity="0.22"
            />
          </filter>

          {/* Active/clicked state calibrated glow */}
          <filter id="fui-glow-active-positive" x="-45%" y="-45%" width="190%" height="190%">
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="5"
              floodColor={HOME_FUI_COLORS.cyan}
              floodOpacity="0.45"
            />
          </filter>
          <filter id="fui-glow-active-negative" x="-45%" y="-45%" width="190%" height="190%">
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="5"
              floodColor={HOME_FUI_COLORS.coral}
              floodOpacity="0.45"
            />
          </filter>
          <filter id="fui-glow-active-neutral" x="-45%" y="-45%" width="190%" height="190%">
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="4.5"
              floodColor={HOME_FUI_COLORS.white}
              floodOpacity="0.35"
            />
          </filter>

          {/* Connected edge emphasis glow */}
          <filter id="fui-edge-glow-positive" x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="2.2"
              floodColor={HOME_FUI_COLORS.cyan}
              floodOpacity="0.36"
            />
          </filter>
          <filter id="fui-edge-glow-negative" x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="2.2"
              floodColor={HOME_FUI_COLORS.coral}
              floodOpacity="0.36"
            />
          </filter>
        </defs>

        {/* Minimal FUI orbital reference hairlines in Soft White (Phase 1 fade) */}
        <g
          aria-hidden="true"
          pointerEvents="none"
          className={isRevealing ? 'home-reveal-fade' : undefined}
          style={fadeStyle(isRevealing, profile?.orbitDelayMs ?? 0, profile?.orbitDurMs ?? 0)}
        >
          <circle
            cx={BTC_POS.x}
            cy={BTC_POS.y}
            r={138}
            fill="none"
            stroke={HOME_FUI_COLORS.white}
            strokeOpacity={0.06}
            strokeWidth={0.75}
            strokeDasharray="2 7"
          />
          <circle
            cx={BTC_POS.x}
            cy={BTC_POS.y}
            r={ORBIT_RADIUS}
            fill="none"
            stroke={HOME_FUI_COLORS.white}
            strokeOpacity={0.05}
            strokeWidth={0.75}
          />
          <line
            x1={BTC_POS.x - 252}
            y1={BTC_POS.y}
            x2={BTC_POS.x - 242}
            y2={BTC_POS.y}
            stroke={HOME_FUI_COLORS.white}
            strokeOpacity={0.14}
            strokeWidth={1}
          />
          <line
            x1={BTC_POS.x + 242}
            y1={BTC_POS.y}
            x2={BTC_POS.x + 252}
            y2={BTC_POS.y}
            stroke={HOME_FUI_COLORS.white}
            strokeOpacity={0.14}
            strokeWidth={1}
          />
        </g>

        {/* 1. BTC <-> Surrounding asset edges */}
        {model.surroundingAssets.map((asset) => {
          if (asset.id === 'BTC') return null;
          const pos = ASSET_POSITIONS[asset.id];
          const edge = edgeMap.get(asset.id);
          const r = edge?.correlation ?? null;
          const labelPos = pointAlongLine(BTC_POS, pos, 0.53);
          const isSelectedEdge = Boolean(selectedNodeId && isAssetEdgeRelated(asset.id, selectedNodeId));
          const groupOpacity = selectedNodeId
            ? isSelectedEdge
              ? 1
              : 0.14
            : hoveredNodeId
              ? isAssetEdgeRelated(asset.id, focusNode)
                ? 1
                : 0.42
              : 1;

          return renderEdge(
            `edge-btc-${asset.id}`,
            NODE_REVEAL_INDEX[asset.id],
            BTC_POS,
            pos,
            labelPos,
            r,
            isSelectedEdge,
            groupOpacity,
            false,
          );
        })}

        {/* 2. BTC <-> M2 cross-correlation edge */}
        {renderEdge(
          'edge-btc-m2',
          NODE_REVEAL_INDEX.M2,
          BTC_POS,
          M2_POS,
          btcM2Mid,
          model.btcM2CrossEdge.correlation,
          Boolean(selectedNodeId && isBtcM2EdgeRelated(selectedNodeId)),
          selectedNodeId
            ? isBtcM2EdgeRelated(selectedNodeId)
              ? 1
              : 0.14
            : hoveredNodeId
              ? isBtcM2EdgeRelated(hoveredNodeId)
                ? 1
                : 0.42
              : 1,
          true,
          'BTC와 M2 장기 교차 상관관계',
        )}

        {/* 3. Surrounding asset nodes */}
        {model.surroundingAssets.map((asset) => {
          if (asset.id === 'BTC') return null;
          return renderAssetNode(asset, ASSET_POSITIONS[asset.id], ASSET_RADIUS, false);
        })}

        {/* 4. Center BTC node */}
        {renderAssetNode(model.centerBtc, BTC_POS, BTC_RADIUS, true)}

        {/* 5. Macro node: M2 증가율 */}
        {renderM2Node()}
      </svg>
    </div>
  );
};
