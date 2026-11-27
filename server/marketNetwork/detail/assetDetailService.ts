import type {
  AssetDetailId,
  AssetDetailPayload,
  AssetMarketSummary,
  EnergyNodeItem,
  M2DetailPayload,
  MacroIndicatorSummary,
  MacroMindMapLeaf,
  MacroObservation,
  MetalNodeItem,
  QqqDetailPayload,
  QqqTechConstituent,
  SpyDetailPayload,
  SpySectorSatellite,
  TltDetailPayload,
  TreasuryMaturityKey,
  TreasuryMaturitySummary,
  WtiDetailPayload,
  XauDetailPayload,
} from '../../../src/types/marketNetwork.ts';
import { computeM2YoYSeries } from '../correlation/correlationEngine.ts';
import { fetchFredDetailSeries } from './fredDetailProvider.ts';
import {
  fetchNasdaq100Constituents,
  fetchNasdaqScreenerMap,
  fetchSsgaSpyHoldings,
  normalizeTickerKey,
} from './nasdaqProvider.ts';
import { fetchYahooChartDaily, type YahooChartSeries } from './yahooChartProvider.ts';

export const ALLOWED_DETAIL_ASSET_IDS: readonly AssetDetailId[] = [
  'QQQ',
  'SPY',
  'XAU',
  'TLT',
  'M2',
  'WTI',
];

export function isAllowedDetailAssetId(raw: string): raw is AssetDetailId {
  return (ALLOWED_DETAIL_ASSET_IDS as readonly string[]).includes(raw.toUpperCase());
}

export interface DetailContextAdapters {
  getAssetsSnapshot: () => Promise<AssetMarketSummary[]>;
  getMacroSnapshot: () => Promise<MacroIndicatorSummary[]>;
}

interface CachedDetailEntry {
  payload: AssetDetailPayload;
  expiresAtMs: number;
}

const DETAIL_TTL_MS = 10 * 60_000;

const SPDR_SECTOR_META: Record<string, { labelKo: string; etfSymbol: string }> = {
  Technology: { labelKo: '기술 (Tech)', etfSymbol: 'XLK' },
  Finance: { labelKo: '금융', etfSymbol: 'XLF' },
  'Health Care': { labelKo: '헬스케어', etfSymbol: 'XLV' },
  'Consumer Discretionary': { labelKo: '경기소비재', etfSymbol: 'XLY' },
  Industrials: { labelKo: '산업재', etfSymbol: 'XLI' },
  'Consumer Staples': { labelKo: '필수소비재', etfSymbol: 'XLP' },
  Telecommunications: { labelKo: '통신·커뮤니케이션', etfSymbol: 'XLC' },
  Energy: { labelKo: '에너지', etfSymbol: 'XLE' },
  Utilities: { labelKo: '유틸리티', etfSymbol: 'XLU' },
  'Real Estate': { labelKo: '부동산', etfSymbol: 'XLRE' },
  'Basic Materials': { labelKo: '소재', etfSymbol: 'XLB' },
};

// Known S&P 500 mega-cap holdings whose Nasdaq Screener sector string may be empty
const KNOWN_SP500_SECTOR_FALLBACK: Record<string, string> = {
  'BRK/B': 'Finance',
  BRKB: 'Finance',
};

function computeDailyReturnCorrelation(
  seriesA: Array<{ date: string; value: number }>,
  seriesB: Array<{ date: string; value: number }>,
): { r: number | null; sampleCount: number } {
  const mapA = new Map<string, number>();
  for (const p of seriesA) {
    if (Number.isFinite(p.value) && p.value > 0) mapA.set(p.date, p.value);
  }
  const mapB = new Map<string, number>();
  for (const p of seriesB) {
    if (Number.isFinite(p.value) && p.value > 0) mapB.set(p.date, p.value);
  }

  const commonDates = [...mapA.keys()].filter((d) => mapB.has(d)).sort();
  if (commonDates.length < 6) {
    return { r: null, sampleCount: commonDates.length };
  }

  const retA: number[] = [];
  const retB: number[] = [];
  for (let i = 1; i < commonDates.length; i++) {
    const prevD = commonDates[i - 1];
    const currD = commonDates[i];
    const a0 = mapA.get(prevD)!;
    const a1 = mapA.get(currD)!;
    const b0 = mapB.get(prevD)!;
    const b1 = mapB.get(currD)!;
    if (a0 > 0 && a1 > 0 && b0 > 0 && b1 > 0) {
      retA.push((a1 - a0) / a0);
      retB.push((b1 - b0) / b0);
    }
  }

  const n = retA.length;
  if (n < 5) return { r: null, sampleCount: n };

  const meanA = retA.reduce((s, v) => s + v, 0) / n;
  const meanB = retB.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = retA[i] - meanA;
    const db = retB[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const denom = Math.sqrt(denA * denB);
  if (denom <= 0) return { r: null, sampleCount: n };
  return { r: Math.max(-1, Math.min(1, num / denom)), sampleCount: n };
}

function computeYoYFromMonthly(obs: MacroObservation[]): {
  latestDate: string | null;
  latestLevel: number | null;
  yoyPct: number | null;
} {
  if (obs.length === 0) return { latestDate: null, latestLevel: null, yoyPct: null };
  const latest = obs[obs.length - 1];
  const byMonth = new Map<string, number>();
  for (const row of obs) {
    byMonth.set(row.date.slice(0, 7), row.value);
  }
  const [yStr, mStr] = latest.date.split('-');
  const prevYearMonth = `${Number(yStr) - 1}-${mStr}`;
  const prevVal = byMonth.get(prevYearMonth);
  const yoyPct =
    prevVal !== undefined && prevVal > 0 ? ((latest.value - prevVal) / prevVal) * 100 : null;
  return {
    latestDate: latest.date,
    latestLevel: latest.value,
    yoyPct,
  };
}

function formatDateIsoDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export class AssetDetailService {
  private readonly adapters: DetailContextAdapters;
  private readonly cache = new Map<AssetDetailId, CachedDetailEntry>();
  private readonly inFlight = new Map<AssetDetailId, Promise<AssetDetailPayload>>();

  constructor(adapters: DetailContextAdapters) {
    this.adapters = adapters;
  }

  async getAssetDetail(assetId: AssetDetailId, forceRefresh = false): Promise<AssetDetailPayload> {
    const now = Date.now();
    if (!forceRefresh) {
      const cached = this.cache.get(assetId);
      if (cached && cached.expiresAtMs > now) {
        return cached.payload;
      }
    }

    const pending = this.inFlight.get(assetId);
    if (pending && !forceRefresh) {
      return pending;
    }

    const job = this.buildDetail(assetId, forceRefresh)
      .then((payload) => {
        this.cache.set(assetId, {
          payload,
          expiresAtMs: Date.now() + DETAIL_TTL_MS,
        });
        return payload;
      })
      .finally(() => {
        this.inFlight.delete(assetId);
      });

    this.inFlight.set(assetId, job);
    return job;
  }

  private async buildDetail(
    assetId: AssetDetailId,
    forceRefresh: boolean,
  ): Promise<AssetDetailPayload> {
    switch (assetId) {
      case 'QQQ':
        return this.buildQqqDetail(forceRefresh);
      case 'SPY':
        return this.buildSpyDetail(forceRefresh);
      case 'XAU':
        return this.buildXauDetail(forceRefresh);
      case 'TLT':
        return this.buildTltDetail(forceRefresh);
      case 'M2':
        return this.buildM2Detail(forceRefresh);
      case 'WTI':
        return this.buildWtiDetail(forceRefresh);
    }
  }

  private async buildQqqDetail(forceRefresh: boolean): Promise<QqqDetailPayload> {
    const [ndxRes, screenerRes] = await Promise.all([
      fetchNasdaq100Constituents(forceRefresh),
      fetchNasdaqScreenerMap(forceRefresh),
    ]);

    const seenCompany = new Set<string>();
    const techCandidates: Array<{
      symbol: string;
      name: string;
      sector: string;
      industry: string;
      marketCapUsd: number;
      priceUsd: number | null;
      changePct: number | null;
    }> = [];

    // Sort Nasdaq-100 constituents by marketCap descending first so primary class (e.g., GOOGL before GOOG) wins
    const sorted = [...ndxRes.rows].sort((a, b) => b.marketCapUsd - a.marketCapUsd);

    for (const item of sorted) {
      const scr =
        screenerRes.map.get(item.symbol) ??
        screenerRes.map.get(normalizeTickerKey(item.symbol));
      if (!scr || scr.sector !== 'Technology') continue;

      const mcap = item.marketCapUsd > 0 ? item.marketCapUsd : scr.marketCapUsd;
      if (mcap <= 0) continue;

      // Deduplicate dual-class shares of the same parent company (e.g., GOOGL vs GOOG)
      const normCompany = scr.name
        .replace(/Class [AC]\s*/gi, '')
        .replace(/\b(Common Stock|Ordinary Shares|Inc\.|Corp\.|Corporation)\b/gi, '')
        .trim()
        .toLowerCase();
      if (seenCompany.has(normCompany)) continue;
      seenCompany.add(normCompany);

      techCandidates.push({
        symbol: item.symbol,
        name: scr.name.replace(/\s+(Common Stock|Ordinary Shares).*$/i, '').trim(),
        sector: scr.sector,
        industry: scr.industry || 'Technology',
        marketCapUsd: mcap,
        priceUsd: item.priceUsd ?? scr.priceUsd,
        changePct: item.changePct ?? scr.changePct,
      });
    }

    const top10 = techCandidates.slice(0, 10);
    const totalTop10Cap = top10.reduce((s, c) => s + c.marketCapUsd, 0);

    const constituents: QqqTechConstituent[] = top10.map((c, idx) => ({
      rank: idx + 1,
      symbol: c.symbol,
      name: c.name,
      sector: c.sector,
      industry: c.industry,
      marketCapUsd: c.marketCapUsd,
      priceUsd: c.priceUsd,
      changePct: c.changePct,
      weightInTop10Pct: totalTop10Cap > 0 ? (c.marketCapUsd / totalTop10Cap) * 100 : 0,
    }));

    return {
      assetId: 'QQQ',
      title: 'QQQ · 기술주 Top 10 버블 네트워크',
      subtitle: 'Nasdaq-100 구성종목 중 Technology 섹터 시가총액 상위 10개 기업',
      constituents,
      totalTechMarketCapUsd: totalTop10Cap,
      marketCapReferenceDate: formatDateIsoDateOnly(ndxRes.fetchedAtIso),
      fetchedAtIso: ndxRes.fetchedAtIso,
      sourceLabel: 'Nasdaq-100 공식 구성종목 + Nasdaq Screener 실시간 섹터·시가총액',
      methodologyNote:
        '각 버블의 면적은 시가총액에 비례합니다(반지름 ∝ √시가총액). Nasdaq Screener 기준 Technology 섹터 종목만 포함하며, 동일 기업 복수 클래스(예: GOOGL/GOOG)는 대표 종목 1개만 반영합니다.',
    };
  }

  private async buildSpyDetail(forceRefresh: boolean): Promise<SpyDetailPayload> {
    const [spyRes, screenerRes] = await Promise.all([
      fetchSsgaSpyHoldings(forceRefresh),
      fetchNasdaqScreenerMap(forceRefresh),
    ]);

    const sectorAgg = new Map<
      string,
      { spyWeightPct: number; marketCapUsd: number; count: number }
    >();

    let centerTech: SpyDetailPayload['centerTechStock'] | null = null;

    for (const h of spyRes.holdings) {
      const key = normalizeTickerKey(h.ticker);
      const scr = screenerRes.map.get(h.ticker) ?? screenerRes.map.get(key);
      const sector = scr?.sector || KNOWN_SP500_SECTOR_FALLBACK[key] || '';
      if (!sector || !SPDR_SECTOR_META[sector]) continue;

      const mcap = scr?.marketCapUsd ?? 0;
      const prev = sectorAgg.get(sector) ?? { spyWeightPct: 0, marketCapUsd: 0, count: 0 };
      prev.spyWeightPct += h.weightPct;
      prev.marketCapUsd += mcap;
      prev.count += 1;
      sectorAgg.set(sector, prev);

      if (sector === 'Technology' && mcap > 0) {
        if (!centerTech || mcap > centerTech.marketCapUsd) {
          centerTech = {
            symbol: h.ticker,
            name: scr?.name.replace(/\s+(Common Stock|Ordinary Shares).*$/i, '').trim() || h.name,
            sector,
            marketCapUsd: mcap,
            spyWeightPct: h.weightPct,
            priceUsd: scr?.priceUsd ?? null,
            changePct: scr?.changePct ?? null,
          };
        }
      }
    }

    if (!centerTech) {
      throw new Error('SPY 구성종목에서 시가총액 최상위 기술주를 식별하지 못했습니다.');
    }

    const sectorEntries = [...sectorAgg.entries()].sort(
      (a, b) => b[1].spyWeightPct - a[1].spyWeightPct,
    );

    // Fetch live SPDR sector select ETFs in parallel; partial failure handled cleanly per ETF
    const etfResults = await Promise.allSettled(
      sectorEntries.map(([sectorKey]) =>
        fetchYahooChartDaily(SPDR_SECTOR_META[sectorKey].etfSymbol, '5d', forceRefresh),
      ),
    );

    const sectors: SpySectorSatellite[] = sectorEntries.map(([sectorKey, agg], idx) => {
      const meta = SPDR_SECTOR_META[sectorKey];
      const etfRes = etfResults[idx];
      const etf = etfRes.status === 'fulfilled' ? etfRes.value : null;
      return {
        sectorKey,
        labelKo: meta.labelKo,
        etfSymbol: meta.etfSymbol,
        spyWeightPct: agg.spyWeightPct,
        sectorMarketCapUsd: agg.marketCapUsd,
        constituentCount: agg.count,
        etfPriceUsd: etf?.regularMarketPrice ?? null,
        changePct: etf?.change1dPct ?? null,
      };
    });

    return {
      assetId: 'SPY',
      title: 'SPY · S&P 500 섹터 궤도 네트워크',
      subtitle: '기술주 섹터(XLK) 중심 S&P 500 섹터 비중 및 수익률 구조',
      centerTechStock: centerTech,
      sectors,
      holdingsReferenceDate: spyRes.asOfLabel,
      fetchedAtIso: spyRes.fetchedAtIso,
      sourceLabel: 'State Street SPY 일별 공식 보유비중 + Nasdaq Screener + SPDR 섹터 ETF',
      methodologyNote:
        '중앙 노드는 S&P 500 내 기술주 섹터(XLK)를 배치하며, 주변 궤도 위성은 나머지 주요 섹터의 SPY 합산 비중과 SPDR 대표 섹터 ETF(XLF·XLV 등)의 일간 등락률을 표시합니다.',
    };
  }

  private async buildXauDetail(forceRefresh: boolean): Promise<XauDetailPayload> {
    const specs: Array<{
      id: MetalNodeItem['id'];
      yahooSymbol: string;
      displaySymbol: string;
      nameKo: string;
      categoryKo: MetalNodeItem['categoryKo'];
      unitLabel: string;
    }> = [
      {
        id: 'XAU',
        yahooSymbol: 'GC=F',
        displaySymbol: 'GC=F · XAU',
        nameKo: '금 (Gold)',
        categoryKo: '귀금속',
        unitLabel: '$/oz',
      },
      {
        id: 'HG',
        yahooSymbol: 'HG=F',
        displaySymbol: 'HG=F',
        nameKo: '구리 (Copper)',
        categoryKo: '산업금속',
        unitLabel: '$/lb',
      },
      {
        id: 'PL',
        yahooSymbol: 'PL=F',
        displaySymbol: 'PL=F',
        nameKo: '백금 (Platinum)',
        categoryKo: '귀금속',
        unitLabel: '$/oz',
      },
      {
        id: 'PA',
        yahooSymbol: 'PA=F',
        displaySymbol: 'PA=F',
        nameKo: '팔라듐 (Palladium)',
        categoryKo: '귀금속',
        unitLabel: '$/oz',
      },
      {
        id: 'XAG',
        yahooSymbol: 'SI=F',
        displaySymbol: 'SI=F · XAG',
        nameKo: '은 (Silver)',
        categoryKo: '귀금속',
        unitLabel: '$/oz',
      },
    ];

    const settled = await Promise.allSettled(
      specs.map((s) => fetchYahooChartDaily(s.yahooSymbol, '1mo', forceRefresh)),
    );

    const seriesById = new Map<MetalNodeItem['id'], YahooChartSeries>();
    specs.forEach((s, i) => {
      const res = settled[i];
      if (res.status === 'fulfilled') {
        seriesById.set(s.id, res.value);
      }
    });

    const goldSeries = seriesById.get('XAU');
    if (!goldSeries || goldSeries.regularMarketPrice === null) {
      throw new Error('금(Gold) 기준 시세 및 일봉 데이터를 조회하지 못했습니다.');
    }

    const goldPoints = goldSeries.dailyPoints.map((p) => ({ date: p.date, value: p.close }));

    const buildMetalNode = (
      spec: (typeof specs)[number],
      isCenter: boolean,
    ): MetalNodeItem => {
      const s = seriesById.get(spec.id);
      if (!s || s.regularMarketPrice === null) {
        return {
          id: spec.id,
          symbol: spec.displaySymbol,
          nameKo: spec.nameKo,
          categoryKo: spec.categoryKo,
          unitLabel: spec.unitLabel,
          status: 'unsupported',
          priceUsd: null,
          change1dPct: null,
          correlationToXau: null,
          sampleCount: 0,
          sourceLabel: '미지원 / 조회 실패',
          lastDate: null,
          reason: `${spec.nameKo} 실시간 시세 조회 불가`,
        };
      }

      const corr = isCenter
        ? { r: 1, sampleCount: goldPoints.length }
        : computeDailyReturnCorrelation(
            goldPoints,
            s.dailyPoints.map((p) => ({ date: p.date, value: p.close })),
          );

      return {
        id: spec.id,
        symbol: spec.displaySymbol,
        nameKo: spec.nameKo,
        categoryKo: spec.categoryKo,
        unitLabel: spec.unitLabel,
        status: 'ok',
        priceUsd: s.regularMarketPrice,
        change1dPct: s.change1dPct,
        correlationToXau: corr.r,
        sampleCount: corr.sampleCount,
        sourceLabel: `Yahoo Finance (${spec.yahooSymbol})`,
        lastDate: s.lastDate,
      };
    };

    const center = buildMetalNode(specs[0], true);
    const satellites = specs.slice(1).map((s) => buildMetalNode(s, false));

    return {
      assetId: 'XAU',
      title: 'XAU · 귀금속 및 산업금속 원자재 네트워크',
      subtitle: '금(Gold) 중심 구리·백금·팔라듐·은 최근 1개월 일간 수익률 상관관계',
      center,
      satellites,
      fetchedAtIso: goldSeries.fetchedAtIso,
      methodologyNote:
        '개방형 원자재 네트워크에서 각 연결선의 굵기와 색상은 금(GC=F)과 해당 금속 선물 간 1개월 일간 수익률 피어슨 상관계수(r)를 나타냅니다. 지원되지 않거나 조회 실패한 종목은 미지원으로 표기됩니다.',
    };
  }

  private async buildTltDetail(forceRefresh: boolean): Promise<TltDetailPayload> {
    const maturitySpecs: Array<{ key: TreasuryMaturityKey; seriesCode: string }> = [
      { key: '2Y', seriesCode: 'DGS2' },
      { key: '5Y', seriesCode: 'DGS5' },
      { key: '10Y', seriesCode: 'DGS10' },
      { key: '20Y', seriesCode: 'DGS20' },
      { key: '30Y', seriesCode: 'DGS30' },
    ];

    const startDate = new Date(Date.now() - 220 * 86_400_000).toISOString().slice(0, 10);

    const [assetsSnapshot, ...fredResults] = await Promise.all([
      this.adapters.getAssetsSnapshot(),
      ...maturitySpecs.map((m) => fetchFredDetailSeries(m.seriesCode, startDate, forceRefresh)),
    ]);

    const tltAsset = assetsSnapshot.find((a) => a.id === 'TLT');

    const dateSet = new Set<string>();
    const mapByMaturity = new Map<TreasuryMaturityKey, Map<string, number>>();

    maturitySpecs.forEach((m, idx) => {
      const mMap = new Map<string, number>();
      for (const row of fredResults[idx].observations) {
        mMap.set(row.date, row.value);
        dateSet.add(row.date);
      }
      mapByMaturity.set(m.key, mMap);
    });

    const sortedDates = [...dateSet].sort().slice(-120); // ~6 months of trading days
    const seriesByMaturity: Record<TreasuryMaturityKey, Array<number | null>> = {
      '2Y': [],
      '5Y': [],
      '10Y': [],
      '20Y': [],
      '30Y': [],
    };

    for (const d of sortedDates) {
      for (const m of maturitySpecs) {
        const val = mapByMaturity.get(m.key)?.get(d);
        seriesByMaturity[m.key].push(val !== undefined ? val : null);
      }
    }

    const maturities: TreasuryMaturitySummary[] = maturitySpecs.map((m, idx) => {
      const obs = fredResults[idx].observations;
      const latest = obs.length > 0 ? obs[obs.length - 1] : null;
      const prev1d = obs.length >= 2 ? obs[obs.length - 2] : null;
      const prev1m = obs.length >= 22 ? obs[obs.length - 22] : obs[0] ?? null;

      return {
        maturity: m.key,
        seriesCode: m.seriesCode,
        latestDate: latest?.date ?? null,
        latestYieldPct: latest?.value ?? null,
        change1dPp: latest && prev1d ? latest.value - prev1d.value : null,
        change1mPp: latest && prev1m ? latest.value - prev1m.value : null,
      };
    });

    const y10 = maturities.find((m) => m.maturity === '10Y')?.latestYieldPct ?? null;
    const y2 = maturities.find((m) => m.maturity === '2Y')?.latestYieldPct ?? null;
    const spread10y2yPp = y10 !== null && y2 !== null ? y10 - y2 : null;

    return {
      assetId: 'TLT',
      title: 'TLT · 미국 국채 수익률 곡선 및 만기별 금리 추이',
      subtitle: 'FRED 일별 국채 수익률 시계열 (2Y · 5Y · 10Y · 20Y · 30Y)',
      tltReference: {
        symbol: tltAsset?.symbol ?? 'TLTUSDT',
        priceUsd: tltAsset?.latestPrice ?? null,
        change24hPct: tltAsset?.change24hPct ?? null,
        latestTimestampIso: tltAsset?.latestTimestampIso ?? null,
      },
      spread10y2yPp,
      maturities,
      seriesDates: sortedDates,
      seriesByMaturity,
      fetchedAtIso: fredResults[0].fetchedAtIso,
      sourceLabel: 'FRED St. Louis Fed (DGS2 · DGS5 · DGS10 · DGS20 · DGS30)',
      etfDistinctionNote:
        'TLT는 미국 20년 이상 장기국채를 추종하는 채권 ETF 가격(금리와 역방향)이며, 아래 차트의 만기별 수치는 연율 기준 미국 국채 수익률(%) 시계열입니다.',
    };
  }

  private async buildM2Detail(forceRefresh: boolean): Promise<M2DetailPayload> {
    const startDate = '2021-01-01';
    const [assetsSnapshot, macroSnapshot, m1Res, nfciRes, bankCreditRes, dffRes, gdpRes, indproRes, cpiRes, pceRes] =
      await Promise.allSettled([
        this.adapters.getAssetsSnapshot(),
        this.adapters.getMacroSnapshot(),
        fetchFredDetailSeries('M1SL', startDate, forceRefresh),
        fetchFredDetailSeries('NFCI', startDate, forceRefresh),
        fetchFredDetailSeries('TOTBKCR', startDate, forceRefresh),
        fetchFredDetailSeries('DFF', '2025-01-01', forceRefresh),
        fetchFredDetailSeries('A191RL1Q225SBEA', startDate, forceRefresh),
        fetchFredDetailSeries('INDPRO', startDate, forceRefresh),
        fetchFredDetailSeries('CPIAUCSL', startDate, forceRefresh),
        fetchFredDetailSeries('PCEPI', startDate, forceRefresh),
      ]);

    const assets = assetsSnapshot.status === 'fulfilled' ? assetsSnapshot.value : [];
    const macros = macroSnapshot.status === 'fulfilled' ? macroSnapshot.value : [];

    const m2Summary = macros.find((m) => m.id === 'M2');
    const dgs10Summary = macros.find((m) => m.id === 'DGS10');

    const m2YoYSeries =
      m2Summary && m2Summary.recentObservations.length >= 13
        ? computeM2YoYSeries(m2Summary.recentObservations)
        : [];
    const m2LatestYoy =
      m2Summary?.changeValue ??
      (m2YoYSeries.length > 0 ? m2YoYSeries[m2YoYSeries.length - 1].yoyPct : null);

    const makeUnlinked = (id: string, labelKo: string, seriesCode: string): MacroMindMapLeaf => ({
      id,
      labelKo,
      seriesCode,
      status: 'unlinked',
      valueText: '미연결',
      subText: '외부 시계열 미수신',
      directionValue: null,
      observationDate: null,
      sourceLabel: '미연결',
    });

    const m1Leaf: MacroMindMapLeaf =
      m1Res.status === 'fulfilled'
        ? (() => {
            const { latestDate, latestLevel, yoyPct } = computeYoYFromMonthly(m1Res.value.observations);
            return {
              id: 'M1',
              labelKo: 'M1 통화량',
              seriesCode: 'M1SL',
              status: 'ok',
              valueText:
                yoyPct !== null ? `${yoyPct >= 0 ? '+' : ''}${yoyPct.toFixed(2)}%` : 'N/A',
              subText:
                latestLevel !== null ? `잔액 ${latestLevel.toLocaleString('en-US', { maximumFractionDigits: 0 })}B` : 'YoY',
              directionValue: yoyPct,
              observationDate: latestDate,
              sourceLabel: 'FRED M1SL',
            };
          })()
        : makeUnlinked('M1', 'M1 통화량', 'M1SL');

    const m2Leaf: MacroMindMapLeaf =
      m2Summary && m2Summary.status === 'ok'
        ? {
            id: 'M2_LEAF',
            labelKo: 'M2 광의통화',
            seriesCode: 'M2SL',
            status: 'ok',
            valueText:
              m2LatestYoy !== null
                ? `${m2LatestYoy >= 0 ? '+' : ''}${m2LatestYoy.toFixed(2)}%`
                : 'N/A',
            subText:
              m2Summary.latestValue !== null
                ? `잔액 ${m2Summary.latestValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}B`
                : 'YoY',
            directionValue: m2LatestYoy,
            observationDate: m2Summary.latestDate,
            sourceLabel: 'FRED M2SL',
          }
        : makeUnlinked('M2_LEAF', 'M2 광의통화', 'M2SL');

    const nfciLeaf: MacroMindMapLeaf =
      nfciRes.status === 'fulfilled'
        ? (() => {
            const obs = nfciRes.value.observations;
            const latest = obs[obs.length - 1];
            // NFCI < 0 means looser-than-average financial conditions (supportive liquidity -> positive polarity)
            const liquidityDirection = -latest.value;
            return {
              id: 'NFCI',
              labelKo: '금융여건지수',
              seriesCode: 'NFCI',
              status: 'ok',
              valueText: `${latest.value >= 0 ? '+' : ''}${latest.value.toFixed(2)}`,
              subText: latest.value < 0 ? '완화적 금융여건 (<0)' : '긴축적 금융여건 (>0)',
              directionValue: liquidityDirection,
              observationDate: latest.date,
              sourceLabel: 'FRED NFCI',
            };
          })()
        : makeUnlinked('NFCI', '금융여건지수', 'NFCI');

    const creditLeaf: MacroMindMapLeaf =
      bankCreditRes.status === 'fulfilled'
        ? (() => {
            const obs = bankCreditRes.value.observations;
            const latest = obs[obs.length - 1];
            const prev52w = obs.length >= 53 ? obs[obs.length - 53] : obs[0];
            const yoy =
              prev52w && prev52w.value > 0
                ? ((latest.value - prev52w.value) / prev52w.value) * 100
                : null;
            return {
              id: 'TOTBKCR',
              labelKo: '은행 신용 증가',
              seriesCode: 'TOTBKCR',
              status: 'ok',
              valueText: yoy !== null ? `${yoy >= 0 ? '+' : ''}${yoy.toFixed(2)}%` : 'N/A',
              subText: `잔액 ${latest.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}B`,
              directionValue: yoy,
              observationDate: latest.date,
              sourceLabel: 'FRED TOTBKCR',
            };
          })()
        : makeUnlinked('TOTBKCR', '은행 신용 증가', 'TOTBKCR');

    const dffLeaf: MacroMindMapLeaf =
      dffRes.status === 'fulfilled'
        ? (() => {
            const obs = dffRes.value.observations;
            const latest = obs[obs.length - 1];
            const prev30 = obs.length >= 22 ? obs[obs.length - 22] : obs[0];
            const diff = latest.value - prev30.value;
            return {
              id: 'DFF',
              labelKo: '연준 기준금리',
              seriesCode: 'DFF',
              status: 'ok',
              valueText: `${latest.value.toFixed(2)}%`,
              subText: `1개월 변화 ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%p`,
              directionValue: diff !== 0 ? diff : null,
              observationDate: latest.date,
              sourceLabel: 'FRED DFF',
            };
          })()
        : makeUnlinked('DFF', '연준 기준금리', 'DFF');

    const dgs10Leaf: MacroMindMapLeaf =
      dgs10Summary && dgs10Summary.status === 'ok' && dgs10Summary.latestValue !== null
        ? {
            id: 'DGS10_LEAF',
            labelKo: '미 10년 국채금리',
            seriesCode: 'DGS10',
            status: 'ok',
            valueText: `${dgs10Summary.latestValue.toFixed(2)}%`,
            subText:
              dgs10Summary.changeValue !== null
                ? `일간 ${dgs10Summary.changeValue >= 0 ? '+' : ''}${dgs10Summary.changeValue.toFixed(2)}%p`
                : '일별 금리',
            directionValue: dgs10Summary.changeValue,
            observationDate: dgs10Summary.latestDate,
            sourceLabel: 'FRED DGS10',
          }
        : makeUnlinked('DGS10_LEAF', '미 10년 국채금리', 'DGS10');

    const gdpLeaf: MacroMindMapLeaf =
      gdpRes.status === 'fulfilled'
        ? (() => {
            const obs = gdpRes.value.observations;
            const latest = obs[obs.length - 1];
            return {
              id: 'GDP',
              labelKo: '실질 GDP 성장률',
              seriesCode: 'A191RL1Q225SBEA',
              status: 'ok',
              valueText: `${latest.value >= 0 ? '+' : ''}${latest.value.toFixed(1)}%`,
              subText: '전기비 연율(SAAR)',
              directionValue: latest.value,
              observationDate: latest.date,
              sourceLabel: 'FRED GDP',
            };
          })()
        : makeUnlinked('GDP', '실질 GDP 성장률', 'A191RL1Q225SBEA');

    const indproLeaf: MacroMindMapLeaf =
      indproRes.status === 'fulfilled'
        ? (() => {
            const { latestDate, latestLevel, yoyPct } = computeYoYFromMonthly(indproRes.value.observations);
            return {
              id: 'INDPRO',
              labelKo: '산업생산 지수',
              seriesCode: 'INDPRO',
              status: 'ok',
              valueText: yoyPct !== null ? `${yoyPct >= 0 ? '+' : ''}${yoyPct.toFixed(2)}%` : 'N/A',
              subText: latestLevel !== null ? `지수 ${latestLevel.toFixed(1)} (YoY)` : 'YoY',
              directionValue: yoyPct,
              observationDate: latestDate,
              sourceLabel: 'FRED INDPRO',
            };
          })()
        : makeUnlinked('INDPRO', '산업생산 지수', 'INDPRO');

    const cpiLeaf: MacroMindMapLeaf =
      cpiRes.status === 'fulfilled'
        ? (() => {
            const { latestDate, yoyPct } = computeYoYFromMonthly(cpiRes.value.observations);
            return {
              id: 'CPI',
              labelKo: '소비자물가 (CPI)',
              seriesCode: 'CPIAUCSL',
              status: 'ok',
              valueText: yoyPct !== null ? `${yoyPct >= 0 ? '+' : ''}${yoyPct.toFixed(2)}%` : 'N/A',
              subText: '전년 동월 대비(YoY)',
              directionValue: yoyPct,
              observationDate: latestDate,
              sourceLabel: 'FRED CPIAUCSL',
            };
          })()
        : makeUnlinked('CPI', '소비자물가 (CPI)', 'CPIAUCSL');

    const pceLeaf: MacroMindMapLeaf =
      pceRes.status === 'fulfilled'
        ? (() => {
            const { latestDate, yoyPct } = computeYoYFromMonthly(pceRes.value.observations);
            return {
              id: 'PCE',
              labelKo: 'PCE 물가지수',
              seriesCode: 'PCEPI',
              status: 'ok',
              valueText: yoyPct !== null ? `${yoyPct >= 0 ? '+' : ''}${yoyPct.toFixed(2)}%` : 'N/A',
              subText: '전년 동월 대비(YoY)',
              directionValue: yoyPct,
              observationDate: latestDate,
              sourceLabel: 'FRED PCEPI',
            };
          })()
        : makeUnlinked('PCE', 'PCE 물가지수', 'PCEPI');

    const makeMarketLeaf = (id: 'SPY' | 'TLT' | 'BTC', labelKo: string): MacroMindMapLeaf => {
      const a = assets.find((item) => item.id === id);
      if (!a || a.status !== 'ok' || a.latestPrice === null) {
        return makeUnlinked(id, labelKo, id);
      }
      const chg = a.change24hPct;
      return {
        id,
        labelKo,
        seriesCode: a.symbol ?? id,
        status: 'ok',
        valueText:
          chg !== null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : `$${a.latestPrice.toFixed(2)}`,
        subText: `$${a.latestPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })} (24h)`,
        directionValue: chg,
        observationDate: a.latestTimestampIso ? a.latestTimestampIso.slice(0, 10) : null,
        sourceLabel: a.providerLabel,
      };
    };

    return {
      assetId: 'M2',
      title: 'M2 증가율 · 거시경제 유동성 마인드맵',
      subtitle: '통화량 · 유동성 · 금리 · 경기 · 물가 · 자산시장 실시간 연결 구조',
      center: {
        labelKo: 'M2 증가율',
        seriesCode: 'M2SL',
        yoyPct: m2LatestYoy,
        levelBillionsUsd: m2Summary?.latestValue ?? null,
        latestDate: m2Summary?.latestDate ?? null,
      },
      groups: [
        { id: 'money_supply', labelKo: '통화량', nodes: [m2Leaf, m1Leaf] },
        { id: 'liquidity', labelKo: '유동성', nodes: [nfciLeaf, creditLeaf] },
        { id: 'rates', labelKo: '금리', nodes: [dffLeaf, dgs10Leaf] },
        { id: 'economy', labelKo: '경기', nodes: [gdpLeaf, indproLeaf] },
        { id: 'inflation', labelKo: '물가', nodes: [cpiLeaf, pceLeaf] },
        {
          id: 'markets',
          labelKo: '자산시장',
          nodes: [
            makeMarketLeaf('SPY', '주식 (SPY)'),
            makeMarketLeaf('TLT', '채권 (TLT)'),
            makeMarketLeaf('BTC', '비트코인 (BTC)'),
          ],
        },
      ],
      fetchedAtIso: new Date().toISOString(),
      methodologyNote:
        '중심의 M2 증가율을 기준으로 6대 거시경제 축을 방사형 마인드맵으로 연결합니다. 각 노드는 FRED 공식 경제 시계열 및 기존 자산 저장소에서 실측 수신되며, 미수신 지표는 미연결로 표기합니다.',
    };
  }

  private async buildWtiDetail(forceRefresh: boolean): Promise<WtiDetailPayload> {
    const specs: Array<{
      id: EnergyNodeItem['id'];
      yahooSymbol: string;
      displaySymbol: string;
      nameKo: string;
      roleKo: string;
      unitLabel: string;
    }> = [
      {
        id: 'WTI',
        yahooSymbol: 'CL=F',
        displaySymbol: 'CL=F · WTI',
        nameKo: 'WTI 원유',
        roleKo: '미국 서부텍사스산 기준유',
        unitLabel: '$/bbl',
      },
      {
        id: 'BRENT',
        yahooSymbol: 'BZ=F',
        displaySymbol: 'BZ=F · BRENT',
        nameKo: '브렌트유 (Brent)',
        roleKo: '글로벌 해상 원유 벤치마크',
        unitLabel: '$/bbl',
      },
      {
        id: 'RBOB',
        yahooSymbol: 'RB=F',
        displaySymbol: 'RB=F · RBOB',
        nameKo: '휘발유 (Gasoline)',
        roleKo: '정제 석유제품 (RBOB)',
        unitLabel: '$/gal',
      },
      {
        id: 'HOIL',
        yahooSymbol: 'HO=F',
        displaySymbol: 'HO=F · ULSD',
        nameKo: '난방유 · 경유 (ULSD)',
        roleKo: '중간 유분 정제유',
        unitLabel: '$/gal',
      },
      {
        id: 'NATGAS',
        yahooSymbol: 'NG=F',
        displaySymbol: 'NG=F · HH',
        nameKo: '천연가스 (Natural Gas)',
        roleKo: '독립 에너지 원자재',
        unitLabel: '$/MMBtu',
      },
    ];

    const settled = await Promise.allSettled(
      specs.map((s) => fetchYahooChartDaily(s.yahooSymbol, '1mo', forceRefresh)),
    );

    const seriesById = new Map<EnergyNodeItem['id'], YahooChartSeries>();
    specs.forEach((s, idx) => {
      const res = settled[idx];
      if (res.status === 'fulfilled') {
        seriesById.set(s.id, res.value);
      }
    });

    const wtiSeries = seriesById.get('WTI');
    if (!wtiSeries || wtiSeries.regularMarketPrice === null) {
      throw new Error('WTI 원유 기준 시세 및 일봉 데이터를 조회하지 못했습니다.');
    }
    const wtiLatestPrice = wtiSeries.regularMarketPrice;

    const wtiPoints = wtiSeries.dailyPoints.map((p) => ({ date: p.date, value: p.close }));
    const brentSeries = seriesById.get('BRENT');
    const brentWtiSpreadUsd =
      brentSeries?.regularMarketPrice !== null &&
      brentSeries?.regularMarketPrice !== undefined
        ? brentSeries.regularMarketPrice - wtiLatestPrice
        : null;

    const buildEnergyNode = (
      spec: (typeof specs)[number],
      isCenter: boolean,
    ): EnergyNodeItem => {
      const s = seriesById.get(spec.id);
      if (!s || s.regularMarketPrice === null) {
        return {
          id: spec.id,
          symbol: spec.displaySymbol,
          nameKo: spec.nameKo,
          roleKo: spec.roleKo,
          unitLabel: spec.unitLabel,
          status: 'unsupported',
          priceUsd: null,
          change1dPct: null,
          correlationToWti: null,
          sampleCount: 0,
          spreadToWtiText: null,
          sourceLabel: '미지원 / 조회 실패',
          lastDate: null,
          reason: `${spec.nameKo} 실시간 시세 조회 불가`,
        };
      }

      const corr = isCenter
        ? { r: 1, sampleCount: wtiPoints.length }
        : computeDailyReturnCorrelation(
            wtiPoints,
            s.dailyPoints.map((p) => ({ date: p.date, value: p.close })),
          );

      let spreadToWtiText: string | null = null;
      if (spec.id === 'BRENT' && brentWtiSpreadUsd !== null) {
        spreadToWtiText = `Brent-WTI 스프레드 ${brentWtiSpreadUsd >= 0 ? '+' : ''}$${brentWtiSpreadUsd.toFixed(2)}/bbl`;
      } else if ((spec.id === 'RBOB' || spec.id === 'HOIL') && wtiLatestPrice > 0) {
        // 1 barrel = 42 US gallons; crack approximation shown in $/bbl vs WTI
        const perBarrel = s.regularMarketPrice * 42;
        const crack = perBarrel - wtiLatestPrice;
        spreadToWtiText = `배럴 환산 스프레드 ${crack >= 0 ? '+' : ''}$${crack.toFixed(2)}/bbl`;
      }

      return {
        id: spec.id,
        symbol: spec.displaySymbol,
        nameKo: spec.nameKo,
        roleKo: spec.roleKo,
        unitLabel: spec.unitLabel,
        status: 'ok',
        priceUsd: s.regularMarketPrice,
        change1dPct: s.change1dPct,
        correlationToWti: corr.r,
        sampleCount: corr.sampleCount,
        spreadToWtiText,
        sourceLabel: `Yahoo Finance (${spec.yahooSymbol})`,
        lastDate: s.lastDate,
      };
    };

    const center = buildEnergyNode(specs[0], true);
    const satellites = specs.slice(1).map((s) => buildEnergyNode(s, false));

    return {
      assetId: 'WTI',
      title: 'WTI · 원유 및 에너지 시장 생태계',
      subtitle: 'WTI 중심 브렌트유 · 휘발유 · 난방유(ULSD) · 천연가스 가격 및 수익률 상관구조',
      center,
      satellites,
      brentWtiSpreadUsd,
      fetchedAtIso: wtiSeries.fetchedAtIso,
      methodologyNote:
        '천연가스(Henry Hub)와 정제 석유제품(휘발유·난방유)은 WTI 원유와 물리적 수급·단위가 서로 다른 별개 에너지 상품입니다. 연결선의 상관계수(r)는 최근 1개월 일간 수익률 동조화를 측정할 뿐 물리적 인과관계를 의미하지 않습니다.',
    };
  }
}
