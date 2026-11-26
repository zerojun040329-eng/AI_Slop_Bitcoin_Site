import React, { useState } from 'react';
import type {
  HomeMarketNetworkViewModel,
  NetworkAssetId,
  NetworkAssetNodeData,
  NetworkNodeId,
} from './marketNetworkAdapter';

export interface MarketNetworkGraphProps {
  model: HomeMarketNetworkViewModel;
  selectedNodeId: NetworkNodeId | null;
  onSelectNode: (nodeId: NetworkNodeId | null) => void;
}

interface Point {
  x: number;
  y: number;
}

const CANVAS_WIDTH = 1160;
const CANVAS_HEIGHT = 650;

const BTC_POS: Point = { x: 560, y: 330 };
const BTC_RADIUS = 68;

const ASSET_RADIUS = 54;
const ASSET_POSITIONS: Record<Exclude<NetworkAssetId, 'BTC'>, Point> = {
  SPY: { x: 382, y: 181 },
  QQQ: { x: 575, y: 108 },
  XAU: { x: 314, y: 365 },
  WTI: { x: 428, y: 526 },
  TLT: { x: 645, y: 540 },
};

const M2_POS: Point = { x: 800, y: 235 };
const DGS10_POS: Point = { x: 820, y: 465 };
const MACRO_RADIUS = 58;

function isNodeRelatedTo(nodeId: NetworkNodeId, selectedId: NetworkNodeId | null): boolean {
  if (!selectedId) return true;
  if (nodeId === selectedId) return true;
  if (selectedId === 'BTC') {
    return nodeId !== 'DGS10';
  }
  if (selectedId === 'M2') {
    return nodeId === 'BTC' || nodeId === 'DGS10';
  }
  if (selectedId === 'DGS10') {
    return nodeId === 'M2';
  }
  // Surrounding assets connect directly to BTC
  return nodeId === 'BTC';
}

function isAssetEdgeRelated(
  targetId: NetworkAssetId,
  focusId: NetworkNodeId | null,
): boolean {
  if (!focusId) return true;
  return focusId === 'BTC' || focusId === targetId;
}

function isBtcM2EdgeRelated(focusId: NetworkNodeId | null): boolean {
  if (!focusId) return true;
  return focusId === 'BTC' || focusId === 'M2';
}

function isMacroPairEdgeRelated(focusId: NetworkNodeId | null): boolean {
  if (!focusId) return true;
  return focusId === 'M2' || focusId === 'DGS10';
}

function formatAssetPrice(
  price: number | null,
  status?: NetworkAssetNodeData['status'],
): string {
  if (price === null || !Number.isFinite(price)) {
    return status === 'syncing' ? '로딩 중' : 'N/A';
  }
  return `$${price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatChange24h(val: number | null): { text: string; color: string } {
  if (val === null || !Number.isFinite(val)) {
    return { text: 'N/A', color: '#64748B' };
  }
  const sign = val > 0 ? '+' : '';
  const color = val > 0 ? '#34D399' : val < 0 ? '#FB7185' : '#94A3B8';
  return { text: `${sign}${val.toFixed(2)}%`, color };
}

function formatCorrelation(r: number | null): string {
  if (r === null || !Number.isFinite(r)) return 'N/A';
  const sign = r > 0 ? '+' : '';
  return `${sign}${r.toFixed(2)}`;
}

function edgeStrokeColor(r: number): string {
  return r >= 0 ? '#34D399' : '#FB7185';
}

function edgeStrokeWidth(r: number): number {
  const absR = Math.min(1, Math.abs(r));
  return 1.5 + absR * 5.0;
}

function edgeStrokeOpacity(r: number): number {
  const absR = Math.min(1, Math.abs(r));
  return 0.44 + absR * 0.44;
}

function pointAlongLine(a: Point, b: Point, t: number): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

export const MarketNetworkGraph: React.FC<MarketNetworkGraphProps> = ({
  model,
  selectedNodeId,
  onSelectNode,
}) => {
  const [hoveredNodeId, setHoveredNodeId] = useState<NetworkNodeId | null>(null);

  const edgeMap = new Map(model.assetEdges.map((edge) => [edge.targetId, edge]));
  const btcM2Mid = pointAlongLine(BTC_POS, M2_POS, 0.52);
  const macroMid = pointAlongLine(M2_POS, DGS10_POS, 0.5);

  const m2ChangeColor =
    model.m2Node.primaryValueText === 'N/A'
      ? '#64748B'
      : model.m2Node.primaryValueText.startsWith('-')
        ? '#FB7185'
        : '#34D399';

  const handleToggleNode = (
    e: React.MouseEvent | React.KeyboardEvent,
    nodeId: NetworkNodeId,
  ) => {
    e.stopPropagation();
    onSelectNode(selectedNodeId === nodeId ? null : nodeId);
  };

  const renderAssetNode = (
    node: NetworkAssetNodeData,
    pos: Point,
    radius: number,
    isCenter: boolean,
  ) => {
    const priceText = formatAssetPrice(node.latestPrice, node.status);
    const change = formatChange24h(node.change24hPct);
    const isSelected = selectedNodeId === node.id;
    const isHovered = hoveredNodeId === node.id;
    const isRelated = isNodeRelatedTo(node.id, selectedNodeId);
    const nodeOpacity = selectedNodeId ? (isRelated ? 1 : 0.28) : 1;

    const strokeColor = isSelected
      ? '#22D3EE'
      : isHovered
        ? '#38BDF8'
        : isCenter
          ? '#0EA5E9'
          : '#253954';

    const fillColor = isSelected
      ? '#0D192B'
      : isHovered
        ? '#0B1626'
        : isCenter
          ? '#0A1322'
          : '#080E1A';

    return (
      <g
        key={node.id}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        aria-label={`${node.id} 노드 상세 보기`}
        className="outline-none focus:outline-none"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => handleToggleNode(e, node.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleToggleNode(e, node.id);
          }
        }}
        onMouseEnter={() => setHoveredNodeId(node.id)}
        onMouseLeave={() => setHoveredNodeId((prev) => (prev === node.id ? null : prev))}
        filter={
          isSelected
            ? 'url(#fui-glow-active)'
            : isHovered
              ? 'url(#fui-glow-soft)'
              : undefined
        }
        style={{
          cursor: 'pointer',
          outline: 'none',
          opacity: nodeOpacity,
          transition: 'opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Subtle outer FUI focus ring on selected or hovered node */}
        {(isSelected || isHovered) && (
          <circle
            cx={pos.x}
            cy={pos.y}
            r={radius + 6}
            fill="none"
            stroke={isSelected ? '#22D3EE' : '#38BDF8'}
            strokeOpacity={isSelected ? 0.55 : 0.28}
            strokeWidth={1}
            strokeDasharray={isSelected ? undefined : '3 4'}
          />
        )}

        <circle
          cx={pos.x}
          cy={pos.y}
          r={radius}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={isSelected ? 1.8 : isCenter ? 1.5 : 1.15}
          style={{
            transition: 'fill 180ms ease, stroke 180ms ease',
          }}
        />
        <text
          x={pos.x}
          y={pos.y - (isCenter ? 20 : 16)}
          textAnchor="middle"
          fill={isSelected || isHovered ? '#F8FAFC' : '#E2E8F0'}
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
          fill={isSelected || isHovered ? '#FFFFFF' : '#E2E8F0'}
          fontSize={isCenter ? 14 : 12}
          fontWeight={500}
          style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
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
          style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
        >
          {change.text}
        </text>
      </g>
    );
  };

  const renderMacroNode = (
    id: 'M2' | 'DGS10',
    pos: Point,
    label: string,
    primaryText: string,
    primaryColor: string,
    secondaryText: string,
    titleFontSize: number,
  ) => {
    const isSelected = selectedNodeId === id;
    const isHovered = hoveredNodeId === id;
    const isRelated = isNodeRelatedTo(id, selectedNodeId);
    const nodeOpacity = selectedNodeId ? (isRelated ? 1 : 0.28) : 1;

    const strokeColor = isSelected
      ? '#22D3EE'
      : isHovered
        ? '#38BDF8'
        : '#8A6732';

    const fillColor = isSelected ? '#0D192B' : isHovered ? '#0B1626' : '#090F1C';

    return (
      <g
        key={id}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        aria-label={`${label} 노드 상세 보기`}
        className="outline-none focus:outline-none"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => handleToggleNode(e, id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleToggleNode(e, id);
          }
        }}
        onMouseEnter={() => setHoveredNodeId(id)}
        onMouseLeave={() => setHoveredNodeId((prev) => (prev === id ? null : prev))}
        filter={
          isSelected
            ? 'url(#fui-glow-active)'
            : isHovered
              ? 'url(#fui-glow-soft)'
              : undefined
        }
        style={{
          cursor: 'pointer',
          outline: 'none',
          opacity: nodeOpacity,
          transition: 'opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {(isSelected || isHovered) && (
          <circle
            cx={pos.x}
            cy={pos.y}
            r={MACRO_RADIUS + 6}
            fill="none"
            stroke={isSelected ? '#22D3EE' : '#38BDF8'}
            strokeOpacity={isSelected ? 0.55 : 0.28}
            strokeWidth={1}
            strokeDasharray={isSelected ? undefined : '3 4'}
          />
        )}

        <circle
          cx={pos.x}
          cy={pos.y}
          r={MACRO_RADIUS}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={isSelected ? 1.8 : 1.15}
          style={{ transition: 'fill 180ms ease, stroke 180ms ease' }}
        />
        <text
          x={pos.x}
          y={pos.y - 25}
          textAnchor="middle"
          fill={isSelected ? '#67E8F9' : '#D99B4E'}
          fontSize={9.5}
          fontWeight={600}
          style={{ fontFamily: 'var(--font-sans)' }}
        >
          거시경제
        </text>
        <text
          x={pos.x}
          y={pos.y - 9}
          textAnchor="middle"
          fill={isSelected || isHovered ? '#F8FAFC' : '#E2E8F0'}
          fontSize={titleFontSize}
          fontWeight={700}
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {label}
        </text>
        <text
          x={pos.x}
          y={pos.y + 11}
          textAnchor="middle"
          fill={primaryColor}
          fontSize={13.5}
          fontWeight={600}
          style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
        >
          {primaryText}
        </text>
        <text
          x={pos.x}
          y={pos.y + 29}
          textAnchor="middle"
          fill="#94A3B8"
          fontSize={9.5}
          style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
        >
          {secondaryText}
        </text>
      </g>
    );
  };

  const focusNode = selectedNodeId ?? hoveredNodeId;

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
          <filter id="fui-glow-soft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="fui-glow-active" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Minimal FUI orbital command hairlines centered on BTC (open space, no boxes) */}
        <g aria-hidden="true" pointerEvents="none">
          <circle
            cx={BTC_POS.x}
            cy={BTC_POS.y}
            r={144}
            fill="none"
            stroke="#38BDF8"
            strokeOpacity={0.07}
            strokeWidth={0.75}
            strokeDasharray="2 7"
          />
          <circle
            cx={BTC_POS.x}
            cy={BTC_POS.y}
            r={244}
            fill="none"
            stroke="#38BDF8"
            strokeOpacity={0.06}
            strokeWidth={0.75}
          />
          {/* Faint radial orientation ticks */}
          <line
            x1={BTC_POS.x - 262}
            y1={BTC_POS.y}
            x2={BTC_POS.x - 252}
            y2={BTC_POS.y}
            stroke="#38BDF8"
            strokeOpacity={0.18}
            strokeWidth={1}
          />
          <line
            x1={BTC_POS.x + 252}
            y1={BTC_POS.y}
            x2={BTC_POS.x + 262}
            y2={BTC_POS.y}
            stroke="#38BDF8"
            strokeOpacity={0.18}
            strokeWidth={1}
          />
          <line
            x1={BTC_POS.x}
            y1={BTC_POS.y - 262}
            x2={BTC_POS.x}
            y2={BTC_POS.y - 252}
            stroke="#38BDF8"
            strokeOpacity={0.18}
            strokeWidth={1}
          />
          <line
            x1={BTC_POS.x}
            y1={BTC_POS.y + 252}
            x2={BTC_POS.x}
            y2={BTC_POS.y + 262}
            stroke="#38BDF8"
            strokeOpacity={0.18}
            strokeWidth={1}
          />
        </g>

        {/* 1. Straight edges: BTC <-> surrounding asset nodes */}
        {model.surroundingAssets.map((asset) => {
          if (asset.id === 'BTC') return null;
          const pos = ASSET_POSITIONS[asset.id];
          const edge = edgeMap.get(asset.id);
          const r = edge?.correlation ?? null;
          const labelPos = pointAlongLine(BTC_POS, pos, 0.53);

          const isRelated = isAssetEdgeRelated(asset.id, focusNode);
          const groupOpacity = selectedNodeId
            ? isAssetEdgeRelated(asset.id, selectedNodeId)
              ? 1
              : 0.16
            : hoveredNodeId
              ? isRelated
                ? 1
                : 0.45
              : 1;

          return (
            <g
              key={`edge-btc-${asset.id}`}
              style={{
                opacity: groupOpacity,
                transition: 'opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              {r !== null && (
                <line
                  x1={BTC_POS.x}
                  y1={BTC_POS.y}
                  x2={pos.x}
                  y2={pos.y}
                  stroke={edgeStrokeColor(r)}
                  strokeWidth={edgeStrokeWidth(r)}
                  strokeOpacity={
                    selectedNodeId && isAssetEdgeRelated(asset.id, selectedNodeId)
                      ? 0.92
                      : edgeStrokeOpacity(r)
                  }
                  strokeLinecap="round"
                  filter={
                    selectedNodeId && isAssetEdgeRelated(asset.id, selectedNodeId)
                      ? 'url(#fui-glow-soft)'
                      : undefined
                  }
                />
              )}
              <rect
                x={labelPos.x - 27}
                y={labelPos.y - 11}
                width={54}
                height={22}
                rx={4}
                fill="#060A14"
                stroke={
                  selectedNodeId && isAssetEdgeRelated(asset.id, selectedNodeId)
                    ? '#0891B2'
                    : '#1E293B'
                }
                strokeWidth={0.9}
              />
              <text
                x={labelPos.x}
                y={labelPos.y + 4}
                textAnchor="middle"
                fill={r === null ? '#64748B' : r >= 0 ? '#6EE7B7' : '#FDA4AF'}
                fontSize={11}
                fontWeight={600}
                style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
              >
                {formatCorrelation(r)}
              </text>
            </g>
          );
        })}

        {/* 2. Straight cross-correlation edge: BTC <-> M2 */}
        <g
          aria-label="BTC와 M2 장기 교차 상관관계"
          style={{
            opacity: selectedNodeId
              ? isBtcM2EdgeRelated(selectedNodeId)
                ? 1
                : 0.16
              : hoveredNodeId
                ? isBtcM2EdgeRelated(hoveredNodeId)
                  ? 1
                  : 0.45
                : 1,
            transition: 'opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {model.btcM2CrossEdge.correlation !== null && (
            <line
              x1={BTC_POS.x}
              y1={BTC_POS.y}
              x2={M2_POS.x}
              y2={M2_POS.y}
              stroke={edgeStrokeColor(model.btcM2CrossEdge.correlation)}
              strokeWidth={edgeStrokeWidth(model.btcM2CrossEdge.correlation)}
              strokeOpacity={
                selectedNodeId && isBtcM2EdgeRelated(selectedNodeId)
                  ? 0.92
                  : edgeStrokeOpacity(model.btcM2CrossEdge.correlation)
              }
              strokeDasharray="6 4"
              strokeLinecap="round"
              filter={
                selectedNodeId && isBtcM2EdgeRelated(selectedNodeId)
                  ? 'url(#fui-glow-soft)'
                  : undefined
              }
            />
          )}
          <rect
            x={btcM2Mid.x - 28}
            y={btcM2Mid.y - 11}
            width={56}
            height={22}
            rx={4}
            fill="#060A14"
            stroke={
              selectedNodeId && isBtcM2EdgeRelated(selectedNodeId)
                ? '#0891B2'
                : '#1E293B'
            }
            strokeWidth={0.9}
          />
          <text
            x={btcM2Mid.x}
            y={btcM2Mid.y + 4}
            textAnchor="middle"
            fill={
              model.btcM2CrossEdge.correlation === null
                ? '#64748B'
                : model.btcM2CrossEdge.correlation >= 0
                  ? '#6EE7B7'
                  : '#FDA4AF'
            }
            fontSize={11}
            fontWeight={600}
            style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
          >
            {formatCorrelation(model.btcM2CrossEdge.correlation)}
          </text>
        </g>

        {/* 3. Straight edge between M2 and DGS10 */}
        <g
          aria-label="M2 증가율과 미국 10년물 금리 장기 상관관계"
          style={{
            opacity: selectedNodeId
              ? isMacroPairEdgeRelated(selectedNodeId)
                ? 1
                : 0.16
              : hoveredNodeId
                ? isMacroPairEdgeRelated(hoveredNodeId)
                  ? 1
                  : 0.45
                : 1,
            transition: 'opacity 220ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {model.macroPairEdge.correlation !== null && (
            <line
              x1={M2_POS.x}
              y1={M2_POS.y}
              x2={DGS10_POS.x}
              y2={DGS10_POS.y}
              stroke={edgeStrokeColor(model.macroPairEdge.correlation)}
              strokeWidth={edgeStrokeWidth(model.macroPairEdge.correlation)}
              strokeOpacity={
                selectedNodeId && isMacroPairEdgeRelated(selectedNodeId)
                  ? 0.92
                  : edgeStrokeOpacity(model.macroPairEdge.correlation)
              }
              strokeLinecap="round"
              filter={
                selectedNodeId && isMacroPairEdgeRelated(selectedNodeId)
                  ? 'url(#fui-glow-soft)'
                  : undefined
              }
            />
          )}
          <rect
            x={macroMid.x - 28}
            y={macroMid.y - 11}
            width={56}
            height={22}
            rx={4}
            fill="#060A14"
            stroke={
              selectedNodeId && isMacroPairEdgeRelated(selectedNodeId)
                ? '#0891B2'
                : '#1E293B'
            }
            strokeWidth={0.9}
          />
          <text
            x={macroMid.x}
            y={macroMid.y + 4}
            textAnchor="middle"
            fill={
              model.macroPairEdge.correlation === null
                ? '#64748B'
                : model.macroPairEdge.correlation >= 0
                  ? '#6EE7B7'
                  : '#FDA4AF'
            }
            fontSize={11}
            fontWeight={600}
            style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
          >
            {formatCorrelation(model.macroPairEdge.correlation)}
          </text>
        </g>

        {/* 4. Surrounding asset nodes */}
        {model.surroundingAssets.map((asset) => {
          if (asset.id === 'BTC') return null;
          return renderAssetNode(asset, ASSET_POSITIONS[asset.id], ASSET_RADIUS, false);
        })}

        {/* 5. Center BTC node */}
        {renderAssetNode(model.centerBtc, BTC_POS, BTC_RADIUS, true)}

        {/* 6. Macro node: M2 증가율 */}
        {renderMacroNode(
          'M2',
          M2_POS,
          model.m2Node.label,
          model.m2Node.primaryValueText,
          m2ChangeColor,
          model.m2Node.secondaryValueText,
          12.5,
        )}

        {/* 7. Macro node: 미국 10년물 금리 (DGS10) */}
        {renderMacroNode(
          'DGS10',
          DGS10_POS,
          model.dgs10Node.label,
          model.dgs10Node.primaryValueText,
          '#E2E8F0',
          model.dgs10Node.secondaryValueText,
          11.5,
        )}
      </svg>
    </div>
  );
};
