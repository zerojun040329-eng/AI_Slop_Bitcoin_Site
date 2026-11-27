import type {
  AssetDetailId,
  AssetDetailPayload,
  MarketNetworkOverviewResponse,
} from '../../../types/marketNetwork';

export function buildPendingDetailPayload(
  assetId: AssetDetailId,
  overview: MarketNetworkOverviewResponse | null,
): AssetDetailPayload {
  const nowIso = new Date().toISOString();
  const findAsset = (id: string) =>
    overview?.status.assets.find((a) => a.id === id) ?? null;
  const m2Macro = overview?.status.macro.find((m) => m.id === 'M2') ?? null;

  switch (assetId) {
    case 'QQQ':
      return {
        assetId: 'QQQ',
        title: 'QQQ · 기술주 Top 10 버블 네트워크',
        subtitle: 'Nasdaq-100 내 Technology 섹터 시가총액 상위 10개 기업',
        constituents: Array.from({ length: 10 }, (_, idx) => ({
          rank: idx + 1,
          symbol: '—',
          name: '',
          sector: 'Technology',
          industry: '—',
          marketCapUsd: (10 - idx) * 1e11,
          priceUsd: null,
          changePct: null,
          weightInTop10Pct: 0,
        })),
        totalTechMarketCapUsd: 0,
        marketCapReferenceDate: null,
        fetchedAtIso: nowIso,
        sourceLabel: '—',
        methodologyNote: '',
      };

    case 'SPY':
      return {
        assetId: 'SPY',
        title: 'SPY · S&P 500 섹터 궤도 네트워크',
        subtitle: '기술주 섹터(XLK) 중심 S&P 500 섹터 비중 및 수익률 구조',
        centerTechStock: {
          symbol: 'XLK',
          name: 'Technology',
          sector: 'Technology',
          marketCapUsd: 0,
          spyWeightPct: null,
          priceUsd: null,
          changePct: null,
        },
        sectors: [
          { sectorKey: 'Technology', labelKo: '정보기술', etfSymbol: 'XLK', spyWeightPct: 30, sectorMarketCapUsd: 0, constituentCount: 0, etfPriceUsd: null, changePct: null },
          { sectorKey: 'Financials', labelKo: '금융', etfSymbol: 'XLF', spyWeightPct: 12, sectorMarketCapUsd: 0, constituentCount: 0, etfPriceUsd: null, changePct: null },
          { sectorKey: 'Health Care', labelKo: '헬스케어', etfSymbol: 'XLV', spyWeightPct: 11, sectorMarketCapUsd: 0, constituentCount: 0, etfPriceUsd: null, changePct: null },
          { sectorKey: 'Consumer Discretionary', labelKo: '임의소비재', etfSymbol: 'XLY', spyWeightPct: 10, sectorMarketCapUsd: 0, constituentCount: 0, etfPriceUsd: null, changePct: null },
          { sectorKey: 'Communication Services', labelKo: '커뮤니케이션', etfSymbol: 'XLC', spyWeightPct: 9, sectorMarketCapUsd: 0, constituentCount: 0, etfPriceUsd: null, changePct: null },
          { sectorKey: 'Industrials', labelKo: '산업재', etfSymbol: 'XLI', spyWeightPct: 8, sectorMarketCapUsd: 0, constituentCount: 0, etfPriceUsd: null, changePct: null },
          { sectorKey: 'Consumer Staples', labelKo: '필수소비재', etfSymbol: 'XLP', spyWeightPct: 6, sectorMarketCapUsd: 0, constituentCount: 0, etfPriceUsd: null, changePct: null },
          { sectorKey: 'Energy', labelKo: '에너지', etfSymbol: 'XLE', spyWeightPct: 4, sectorMarketCapUsd: 0, constituentCount: 0, etfPriceUsd: null, changePct: null },
          { sectorKey: 'Utilities', labelKo: '유틸리티', etfSymbol: 'XLU', spyWeightPct: 3, sectorMarketCapUsd: 0, constituentCount: 0, etfPriceUsd: null, changePct: null },
          { sectorKey: 'Real Estate', labelKo: '부동산', etfSymbol: 'XLRE', spyWeightPct: 2.5, sectorMarketCapUsd: 0, constituentCount: 0, etfPriceUsd: null, changePct: null },
          { sectorKey: 'Materials', labelKo: '소재', etfSymbol: 'XLB', spyWeightPct: 2.5, sectorMarketCapUsd: 0, constituentCount: 0, etfPriceUsd: null, changePct: null },
        ],
        holdingsReferenceDate: null,
        fetchedAtIso: nowIso,
        sourceLabel: '—',
        methodologyNote: '',
      };

    case 'XAU': {
      const xau = findAsset('XAU');
      return {
        assetId: 'XAU',
        title: 'XAU · 귀금속 및 산업금속 원자재 네트워크',
        subtitle: '금(Gold) 중심 구리 · 백금 · 팔라듐 · 은 가격 및 상관관계',
        center: {
          id: 'XAU',
          symbol: 'XAU',
          nameKo: '금 (Gold)',
          categoryKo: '귀금속',
          unitLabel: 'USD/oz',
          status: 'ok',
          priceUsd: xau?.latestPrice ?? null,
          change1dPct: xau?.change24hPct ?? null,
          correlationToXau: 1,
          sampleCount: 0,
          sourceLabel: xau?.providerLabel ?? '—',
          lastDate: null,
        },
        satellites: [
          { id: 'XAG', symbol: 'XAG', nameKo: '은 (Silver)', categoryKo: '귀금속', unitLabel: 'USD/oz', status: 'ok', priceUsd: null, change1dPct: null, correlationToXau: null, sampleCount: 0, sourceLabel: '—', lastDate: null },
          { id: 'HG', symbol: 'HG', nameKo: '구리 (Copper)', categoryKo: '산업금속', unitLabel: 'USD/lb', status: 'ok', priceUsd: null, change1dPct: null, correlationToXau: null, sampleCount: 0, sourceLabel: '—', lastDate: null },
          { id: 'PL', symbol: 'PL', nameKo: '백금 (Platinum)', categoryKo: '귀금속', unitLabel: 'USD/oz', status: 'ok', priceUsd: null, change1dPct: null, correlationToXau: null, sampleCount: 0, sourceLabel: '—', lastDate: null },
          { id: 'PA', symbol: 'PA', nameKo: '팔라듐 (Palladium)', categoryKo: '귀금속', unitLabel: 'USD/oz', status: 'ok', priceUsd: null, change1dPct: null, correlationToXau: null, sampleCount: 0, sourceLabel: '—', lastDate: null },
        ],
        fetchedAtIso: nowIso,
        methodologyNote: '',
      };
    }

    case 'TLT': {
      const tlt = findAsset('TLT');
      return {
        assetId: 'TLT',
        title: 'TLT · 미국 국채 수익률 곡선 및 만기별 금리 추이',
        subtitle: '2년 · 5년 · 10년 · 20년 · 30년 미국 국채 수익률 시계열',
        tltReference: {
          symbol: 'TLT',
          priceUsd: tlt?.latestPrice ?? null,
          change24hPct: tlt?.change24hPct ?? null,
          latestTimestampIso: tlt?.latestTimestampIso ?? null,
        },
        spread10y2yPp: null,
        maturities: (['2Y', '5Y', '10Y', '20Y', '30Y'] as const).map((m) => ({
          maturity: m,
          seriesCode: `DGS${m.replace('Y', '')}`,
          latestDate: null,
          latestYieldPct: null,
          change1dPp: null,
          change1mPp: null,
        })),
        seriesDates: [],
        seriesByMaturity: { '2Y': [], '5Y': [], '10Y': [], '20Y': [], '30Y': [] },
        fetchedAtIso: nowIso,
        sourceLabel: '—',
        etfDistinctionNote: '미국 국채 만기별 수익률 곡선 및 TLT ETF 참고 시세 구조',
      };
    }

    case 'M2':
      return {
        assetId: 'M2',
        title: 'M2 증가율 · 거시경제 유동성 마인드맵',
        subtitle: '통화량 · 유동성 · 금리 · 경기 · 물가 · 자산시장 연결 구조',
        center: {
          labelKo: 'M2 증가율',
          seriesCode: 'M2SL',
          yoyPct: m2Macro?.changeValue ?? null,
          levelBillionsUsd: m2Macro?.latestValue ?? null,
          latestDate: m2Macro?.latestDate ?? null,
        },
        groups: [
          {
            id: 'money_supply',
            labelKo: '통화량',
            nodes: [
              { id: 'p-m2-yoy', labelKo: 'M2 YoY', seriesCode: 'M2SL', status: 'ok', valueText: '—', subText: '—', directionValue: null, observationDate: null, sourceLabel: '—' },
              { id: 'p-m2-lv', labelKo: 'M2 잔액', seriesCode: 'M2SL', status: 'ok', valueText: '—', subText: '—', directionValue: null, observationDate: null, sourceLabel: '—' },
            ],
          },
          {
            id: 'liquidity',
            labelKo: '유동성',
            nodes: [
              { id: 'p-walcl', labelKo: '연준 대차대조표', seriesCode: 'WALCL', status: 'ok', valueText: '—', subText: '—', directionValue: null, observationDate: null, sourceLabel: '—' },
              { id: 'p-rrp', labelKo: '역레포 잔액', seriesCode: 'RRPONTSYD', status: 'ok', valueText: '—', subText: '—', directionValue: null, observationDate: null, sourceLabel: '—' },
            ],
          },
          {
            id: 'rates',
            labelKo: '금리',
            nodes: [
              { id: 'p-effr', labelKo: '기준금리', seriesCode: 'FEDFUNDS', status: 'ok', valueText: '—', subText: '—', directionValue: null, observationDate: null, sourceLabel: '—' },
              { id: 'p-dgs10', labelKo: '미 10년물', seriesCode: 'DGS10', status: 'ok', valueText: '—', subText: '—', directionValue: null, observationDate: null, sourceLabel: '—' },
            ],
          },
          {
            id: 'economy',
            labelKo: '경기',
            nodes: [
              { id: 'p-unrate', labelKo: '실업률', seriesCode: 'UNRATE', status: 'ok', valueText: '—', subText: '—', directionValue: null, observationDate: null, sourceLabel: '—' },
              { id: 'p-indpro', labelKo: '산업생산', seriesCode: 'INDPRO', status: 'ok', valueText: '—', subText: '—', directionValue: null, observationDate: null, sourceLabel: '—' },
            ],
          },
          {
            id: 'inflation',
            labelKo: '물가',
            nodes: [
              { id: 'p-cpi', labelKo: 'CPI YoY', seriesCode: 'CPIAUCSL', status: 'ok', valueText: '—', subText: '—', directionValue: null, observationDate: null, sourceLabel: '—' },
              { id: 'p-pce', labelKo: 'Core PCE', seriesCode: 'PCEPILFE', status: 'ok', valueText: '—', subText: '—', directionValue: null, observationDate: null, sourceLabel: '—' },
            ],
          },
          {
            id: 'markets',
            labelKo: '자산시장',
            nodes: [
              { id: 'p-btc', labelKo: 'BTC', seriesCode: 'BTC', status: 'ok', valueText: '—', subText: '—', directionValue: null, observationDate: null, sourceLabel: '—' },
              { id: 'p-spy', labelKo: 'S&P 500', seriesCode: 'SPY', status: 'ok', valueText: '—', subText: '—', directionValue: null, observationDate: null, sourceLabel: '—' },
            ],
          },
        ],
        fetchedAtIso: nowIso,
        methodologyNote: '',
      };

    case 'WTI': {
      const wti = findAsset('WTI');
      return {
        assetId: 'WTI',
        title: 'WTI · 원유 및 에너지 시장 생태계',
        subtitle: 'WTI 중심 브렌트유 · 휘발유 · 난방유 · 천연가스 가격 및 상관관계',
        center: {
          id: 'WTI',
          symbol: 'WTI',
          nameKo: 'WTI 원유',
          roleKo: '미국 기준 원유',
          unitLabel: 'USD/bbl',
          status: 'ok',
          priceUsd: wti?.latestPrice ?? null,
          change1dPct: wti?.change24hPct ?? null,
          correlationToWti: 1,
          sampleCount: 0,
          spreadToWtiText: null,
          sourceLabel: wti?.providerLabel ?? '—',
          lastDate: null,
        },
        satellites: [
          { id: 'BRENT', symbol: 'BRENT', nameKo: '브렌트유 (Brent)', roleKo: '국제 기준 원유', unitLabel: 'USD/bbl', status: 'ok', priceUsd: null, change1dPct: null, correlationToWti: null, sampleCount: 0, spreadToWtiText: null, sourceLabel: '—', lastDate: null },
          { id: 'RBOB', symbol: 'RBOB', nameKo: '휘발유 (RBOB)', roleKo: '정제 연료', unitLabel: 'USD/gal', status: 'ok', priceUsd: null, change1dPct: null, correlationToWti: null, sampleCount: 0, spreadToWtiText: null, sourceLabel: '—', lastDate: null },
          { id: 'HOIL', symbol: 'HOIL', nameKo: '난방유 (Heating Oil)', roleKo: '중질유 · 디젤', unitLabel: 'USD/gal', status: 'ok', priceUsd: null, change1dPct: null, correlationToWti: null, sampleCount: 0, spreadToWtiText: null, sourceLabel: '—', lastDate: null },
          { id: 'NATGAS', symbol: 'NATGAS', nameKo: '천연가스 (Natural Gas)', roleKo: '독립 에너지원', unitLabel: 'USD/MMBtu', status: 'ok', priceUsd: null, change1dPct: null, correlationToWti: null, sampleCount: 0, spreadToWtiText: null, sourceLabel: '—', lastDate: null },
        ],
        brentWtiSpreadUsd: null,
        fetchedAtIso: nowIso,
        methodologyNote: '',
      };
    }
  }
}
