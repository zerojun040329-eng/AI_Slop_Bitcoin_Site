import type {
  AssetId,
  AssetMarketSummary,
  MacroIndicatorSummary,
  MarketNetworkOverviewResponse,
} from '../../types/marketNetwork';

export type NetworkAssetId = 'BTC' | 'SPY' | 'QQQ' | 'XAU' | 'WTI' | 'TLT';
export type NetworkNodeId = NetworkAssetId | 'M2' | 'DGS10';

export const NETWORK_SURROUNDING_ASSETS: readonly NetworkAssetId[] = [
  'SPY',
  'QQQ',
  'XAU',
  'WTI',
  'TLT',
];

export interface NetworkAssetNodeData {
  id: NetworkAssetId;
  name: string;
  symbol: string | null;
  instrumentType: AssetMarketSummary['instrumentType'];
  providerLabel: string;
  latestPrice: number | null;
  change1hPct: number | null;
  change4hPct: number | null;
  change24hPct: number | null;
  storedBars: number;
  latestTimestampIso: string | null;
  status: AssetMarketSummary['status'];
}

export interface NetworkAssetEdgeData {
  targetId: NetworkAssetId;
  correlation: number | null;
  sampleCount: number;
  correlation24h: number | null;
  sampleCount24h: number;
  correlation30d: number | null;
  sampleCount30d: number;
}

export interface NetworkMacroNodeData {
  id: 'M2' | 'DGS10';
  label: string;
  seriesCode: string;
  providerLabel: string;
  cadence: '1d' | '1mo';
  primaryValueText: string;
  secondaryValueText: string;
  rawLatestValue: number | null;
  rawUnit: string;
  changeValue: number | null;
  changeUnit: '%' | '%p';
  pointCount: number;
  latestDate: string | null;
  status: MacroIndicatorSummary['status'];
}

export interface NetworkMacroEdgeData {
  correlation: number | null;
  sampleCount: number;
  cadenceLabel: string;
  startDate: string | null;
  endDate: string | null;
}

export interface HomeMarketNetworkViewModel {
  centerBtc: NetworkAssetNodeData;
  surroundingAssets: NetworkAssetNodeData[];
  assetEdges: NetworkAssetEdgeData[];
  m2Node: NetworkMacroNodeData;
  dgs10Node: NetworkMacroNodeData;
  macroPairEdge: NetworkMacroEdgeData;
  btcM2CrossEdge: NetworkMacroEdgeData;
  lastUpdatedIso: string | null;
  includedStatusSummary: Array<{
    label: string;
    status: string;
    detail: string;
  }>;
}

function findAsset(
  assets: AssetMarketSummary[],
  id: AssetId,
): AssetMarketSummary | undefined {
  return assets.find((item) => item.id === id);
}

function findMacro(
  macros: MacroIndicatorSummary[],
  id: 'M2' | 'DGS10',
): MacroIndicatorSummary | undefined {
  return macros.find((item) => item.id === id);
}

function formatM2Node(m2: MacroIndicatorSummary | undefined): NetworkMacroNodeData {
  if (!m2 || m2.status !== 'ok' || m2.changeValue === null || !Number.isFinite(m2.changeValue)) {
    return {
      id: 'M2',
      label: 'M2 증가율',
      seriesCode: m2?.seriesCode ?? 'M2SL',
      providerLabel: m2?.providerLabel ?? 'FRED',
      cadence: '1mo',
      primaryValueText: 'N/A',
      secondaryValueText: 'YoY 전년 동월 대비',
      rawLatestValue: m2?.latestValue ?? null,
      rawUnit: m2?.unit ?? 'Billions USD (YoY %)',
      changeValue: m2?.changeValue ?? null,
      changeUnit: '%',
      pointCount: m2?.pointCount ?? 0,
      latestDate: m2?.latestDate ?? null,
      status: m2?.status ?? 'error',
    };
  }
  const sign = m2.changeValue > 0 ? '+' : '';
  return {
    id: 'M2',
    label: 'M2 증가율',
    seriesCode: m2.seriesCode,
    providerLabel: m2.providerLabel,
    cadence: '1mo',
    primaryValueText: `${sign}${m2.changeValue.toFixed(2)}%`,
    secondaryValueText: m2.latestDate ? `YoY · ${m2.latestDate.slice(0, 7)}` : 'YoY 전년 동월 대비',
    rawLatestValue: m2.latestValue,
    rawUnit: m2.unit,
    changeValue: m2.changeValue,
    changeUnit: '%',
    pointCount: m2.pointCount,
    latestDate: m2.latestDate,
    status: m2.status,
  };
}

function formatDgs10Node(dgs10: MacroIndicatorSummary | undefined): NetworkMacroNodeData {
  if (
    !dgs10 ||
    dgs10.status !== 'ok' ||
    dgs10.latestValue === null ||
    !Number.isFinite(dgs10.latestValue)
  ) {
    return {
      id: 'DGS10',
      label: '미국 10년물 금리',
      seriesCode: dgs10?.seriesCode ?? 'DGS10',
      providerLabel: dgs10?.providerLabel ?? 'FRED',
      cadence: '1d',
      primaryValueText: 'N/A',
      secondaryValueText: 'DGS10 · N/A',
      rawLatestValue: dgs10?.latestValue ?? null,
      rawUnit: dgs10?.unit ?? '%',
      changeValue: dgs10?.changeValue ?? null,
      changeUnit: '%p',
      pointCount: dgs10?.pointCount ?? 0,
      latestDate: dgs10?.latestDate ?? null,
      status: dgs10?.status ?? 'error',
    };
  }

  let deltaText = '변화 N/A';
  if (dgs10.changeValue !== null && Number.isFinite(dgs10.changeValue)) {
    const sign = dgs10.changeValue > 0 ? '+' : '';
    deltaText = `일간 ${sign}${dgs10.changeValue.toFixed(3)}%p`;
  }

  return {
    id: 'DGS10',
    label: '미국 10년물 금리',
    seriesCode: dgs10.seriesCode,
    providerLabel: dgs10.providerLabel,
    cadence: '1d',
    primaryValueText: `${dgs10.latestValue.toFixed(2)}%`,
    secondaryValueText: deltaText,
    rawLatestValue: dgs10.latestValue,
    rawUnit: dgs10.unit,
    changeValue: dgs10.changeValue,
    changeUnit: '%p',
    pointCount: dgs10.pointCount,
    latestDate: dgs10.latestDate,
    status: dgs10.status,
  };
}

function buildAssetNodeData(
  id: NetworkAssetId,
  item: AssetMarketSummary | undefined,
): NetworkAssetNodeData {
  const isAvailable = item?.status === 'ok';
  return {
    id,
    name: item?.name ?? id,
    symbol: item?.symbol ?? null,
    instrumentType: item?.instrumentType ?? 'unsupported',
    providerLabel: item?.providerLabel ?? '—',
    latestPrice: isAvailable ? item.latestPrice : null,
    change1hPct: isAvailable ? item.change1hPct : null,
    change4hPct: isAvailable ? item.change4hPct : null,
    change24hPct: isAvailable ? item.change24hPct : null,
    storedBars: item?.storedBars ?? 0,
    latestTimestampIso: item?.latestTimestampIso ?? null,
    status: item?.status ?? 'error',
  };
}

/**
 * Adapts the full /api/market-network/overview response into the Home BTC-centered network model.
 * Explicitly excludes EEM and DXY, and never connects DGS10 directly to BTC.
 */
export function buildHomeMarketNetworkViewModel(
  overview: MarketNetworkOverviewResponse,
  windowId: '24h' | '30d',
): HomeMarketNetworkViewModel {
  const btcSummary = findAsset(overview.status.assets, 'BTC');
  const centerBtc = buildAssetNodeData('BTC', btcSummary);

  const surroundingAssets: NetworkAssetNodeData[] = NETWORK_SURROUNDING_ASSETS.map((id) =>
    buildAssetNodeData(id, findAsset(overview.status.assets, id)),
  );

  const matrix24 = overview.assetCorrelations.h24;
  const matrix30 = overview.assetCorrelations.d30;
  const btcIdx24 = matrix24.assetIds.indexOf('BTC');
  const btcIdx30 = matrix30.assetIds.indexOf('BTC');

  const assetEdges: NetworkAssetEdgeData[] = NETWORK_SURROUNDING_ASSETS.map((targetId) => {
    const targetAsset = findAsset(overview.status.assets, targetId);
    if (targetAsset?.status !== 'ok' || btcSummary?.status !== 'ok') {
      return {
        targetId,
        correlation: null,
        sampleCount: 0,
        correlation24h: null,
        sampleCount24h: 0,
        correlation30d: null,
        sampleCount30d: 0,
      };
    }

    const idx24 = matrix24.assetIds.indexOf(targetId);
    const idx30 = matrix30.assetIds.indexOf(targetId);

    const raw24 = btcIdx24 >= 0 && idx24 >= 0 ? (matrix24.matrix[btcIdx24]?.[idx24] ?? null) : null;
    const n24 = btcIdx24 >= 0 && idx24 >= 0 ? (matrix24.sampleCounts[btcIdx24]?.[idx24] ?? 0) : 0;
    const raw30 = btcIdx30 >= 0 && idx30 >= 0 ? (matrix30.matrix[btcIdx30]?.[idx30] ?? null) : null;
    const n30 = btcIdx30 >= 0 && idx30 >= 0 ? (matrix30.sampleCounts[btcIdx30]?.[idx30] ?? 0) : 0;

    const r24 = raw24 !== null && Number.isFinite(raw24) ? raw24 : null;
    const r30 = raw30 !== null && Number.isFinite(raw30) ? raw30 : null;

    return {
      targetId,
      correlation: windowId === '24h' ? r24 : r30,
      sampleCount: windowId === '24h' ? n24 : n30,
      correlation24h: r24,
      sampleCount24h: n24,
      correlation30d: r30,
      sampleCount30d: n30,
    };
  });

  const m2Summary = findMacro(overview.status.macro, 'M2');
  const dgs10Summary = findMacro(overview.status.macro, 'DGS10');

  const macroPair = overview.macroCorrelations.pairs.find(
    (p) => p.pairId === 'dgs10_m2_monthly',
  );
  const macroPairEdge: NetworkMacroEdgeData = {
    correlation:
      macroPair?.status === 'ok' &&
      macroPair.correlation !== null &&
      Number.isFinite(macroPair.correlation)
        ? macroPair.correlation
        : null,
    sampleCount: macroPair?.sampleCount ?? 0,
    cadenceLabel: '월간',
    startDate: macroPair?.startDate ?? null,
    endDate: macroPair?.endDate ?? null,
  };

  const btcM2Pair = overview.btcMacroCross.pairs.find((p) => p.pairId === 'btc_m2_monthly');
  const btcM2CrossEdge: NetworkMacroEdgeData = {
    correlation:
      btcM2Pair?.status === 'ok' &&
      btcM2Pair.correlation !== null &&
      Number.isFinite(btcM2Pair.correlation)
        ? btcM2Pair.correlation
        : null,
    sampleCount: btcM2Pair?.sampleCount ?? 0,
    cadenceLabel: '월간 교차',
    startDate: btcM2Pair?.startDate ?? null,
    endDate: btcM2Pair?.endDate ?? null,
  };

  const includedStatusSummary = [
    {
      label: 'BTC (기존 저장소)',
      status: centerBtc.status,
      detail: `${(btcSummary?.storedBars ?? 0).toLocaleString('en-US')}봉`,
    },
    ...NETWORK_SURROUNDING_ASSETS.map((id) => {
      const a = findAsset(overview.status.assets, id);
      return {
        label: `${id}${a?.symbol ? ` (${a.symbol})` : ''}`,
        status: a?.status ?? 'error',
        detail: a?.errorMessage ?? `${(a?.storedBars ?? 0).toLocaleString('en-US')}봉`,
      };
    }),
    {
      label: 'M2 증가율 (M2SL)',
      status: m2Summary?.status ?? 'error',
      detail: m2Summary?.errorMessage ?? `${m2Summary?.pointCount ?? 0}포인트`,
    },
    {
      label: '미국 10년물 금리 (DGS10)',
      status: dgs10Summary?.status ?? 'error',
      detail: dgs10Summary?.errorMessage ?? `${dgs10Summary?.pointCount ?? 0}포인트`,
    },
  ];

  return {
    centerBtc,
    surroundingAssets,
    assetEdges,
    m2Node: formatM2Node(m2Summary),
    dgs10Node: formatDgs10Node(dgs10Summary),
    macroPairEdge,
    btcM2CrossEdge,
    lastUpdatedIso: overview.status.lastFullSyncIso ?? btcSummary?.lastUpdatedIso ?? null,
    includedStatusSummary,
  };
}

/**
 * Provides the deterministic 7-node, 6-edge network geometry while overview API data is still loading,
 * preserving exact layout coordinates so progressive reveal starts immediately without hiding the screen.
 */
export function buildPendingHomeMarketNetworkViewModel(): HomeMarketNetworkViewModel {
  const makePendingAsset = (id: NetworkAssetId): NetworkAssetNodeData => ({
    id,
    name: id,
    symbol: null,
    instrumentType: 'unsupported',
    providerLabel: '수신 대기',
    latestPrice: null,
    change1hPct: null,
    change4hPct: null,
    change24hPct: null,
    storedBars: 0,
    latestTimestampIso: null,
    status: 'syncing',
  });

  return {
    centerBtc: makePendingAsset('BTC'),
    surroundingAssets: NETWORK_SURROUNDING_ASSETS.map(makePendingAsset),
    assetEdges: NETWORK_SURROUNDING_ASSETS.map((targetId) => ({
      targetId,
      correlation: null,
      sampleCount: 0,
      correlation24h: null,
      sampleCount24h: 0,
      correlation30d: null,
      sampleCount30d: 0,
    })),
    m2Node: {
      id: 'M2',
      label: 'M2 증가율',
      seriesCode: 'M2SL',
      providerLabel: 'FRED',
      cadence: '1mo',
      primaryValueText: '로딩 중',
      secondaryValueText: 'YoY 전년 동월 대비',
      rawLatestValue: null,
      rawUnit: 'Billions USD (YoY %)',
      changeValue: null,
      changeUnit: '%',
      pointCount: 0,
      latestDate: null,
      status: 'syncing',
    },
    dgs10Node: formatDgs10Node(undefined),
    macroPairEdge: {
      correlation: null,
      sampleCount: 0,
      cadenceLabel: '월간',
      startDate: null,
      endDate: null,
    },
    btcM2CrossEdge: {
      correlation: null,
      sampleCount: 0,
      cadenceLabel: '월간 교차',
      startDate: null,
      endDate: null,
    },
    lastUpdatedIso: null,
    includedStatusSummary: [],
  };
}
