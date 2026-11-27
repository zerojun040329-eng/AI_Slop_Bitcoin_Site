export interface YahooDailyPoint {
  date: string; // YYYY-MM-DD
  close: number;
}

export interface YahooChartSeries {
  symbol: string;
  currency: string;
  regularMarketPrice: number | null;
  change1dPct: number | null;
  lastDate: string | null;
  dailyPoints: YahooDailyPoint[];
  fetchedAtIso: string;
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        currency?: string;
        symbol?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
    error?: { code?: string; description?: string };
  };
}

interface CachedChart {
  series: YahooChartSeries;
  expiresAtMs: number;
}

const YAHOO_CACHE_TTL_MS = 10 * 60_000;
const chartCache = new Map<string, CachedChart>();

export async function fetchYahooChartDaily(
  symbol: string,
  range: '5d' | '1mo' | '3mo' = '1mo',
  forceRefresh = false,
): Promise<YahooChartSeries> {
  const key = `${symbol}:${range}`;
  const now = Date.now();
  const cached = chartCache.get(key);
  if (!forceRefresh && cached && cached.expiresAtMs > now) {
    return cached.series;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?range=${encodeURIComponent(range)}&interval=1d`;

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; btc-analytics-desk/1.0)',
      },
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`Yahoo chart HTTP ${res.status} (${symbol})`);
    }

    const json = (await res.json()) as YahooChartResponse;
    const result = json.chart?.result?.[0];
    if (!result) {
      throw new Error(json.chart?.error?.description ?? `Yahoo chart 결과 없음 (${symbol})`);
    }

    const timestamps = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    const byDate = new Map<string, number>();

    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const close = closes[i];
      if (typeof ts === 'number' && typeof close === 'number' && Number.isFinite(close) && close > 0) {
        const date = new Date(ts * 1000).toISOString().slice(0, 10);
        byDate.set(date, close);
      }
    }

    const dailyPoints: YahooDailyPoint[] = [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, close]) => ({ date, close }));

    const metaPrice = result.meta?.regularMarketPrice;
    const latestFromBars = dailyPoints.length > 0 ? dailyPoints[dailyPoints.length - 1].close : null;
    const regularMarketPrice =
      typeof metaPrice === 'number' && Number.isFinite(metaPrice) && metaPrice > 0
        ? metaPrice
        : latestFromBars;

    let change1dPct: number | null = null;
    if (dailyPoints.length >= 2 && regularMarketPrice !== null) {
      const prevClose = dailyPoints[dailyPoints.length - 2].close;
      if (prevClose > 0) {
        change1dPct = ((regularMarketPrice - prevClose) / prevClose) * 100;
      }
    } else if (
      regularMarketPrice !== null &&
      typeof result.meta?.previousClose === 'number' &&
      result.meta.previousClose > 0
    ) {
      change1dPct =
        ((regularMarketPrice - result.meta.previousClose) / result.meta.previousClose) * 100;
    }

    const series: YahooChartSeries = {
      symbol,
      currency: result.meta?.currency ?? 'USD',
      regularMarketPrice,
      change1dPct,
      lastDate: dailyPoints.length > 0 ? dailyPoints[dailyPoints.length - 1].date : null,
      dailyPoints,
      fetchedAtIso: new Date().toISOString(),
    };

    chartCache.set(key, {
      series,
      expiresAtMs: Date.now() + YAHOO_CACHE_TTL_MS,
    });

    return series;
  } finally {
    clearTimeout(timer);
  }
}
