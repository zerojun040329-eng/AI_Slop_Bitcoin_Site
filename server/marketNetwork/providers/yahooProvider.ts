import type { MacroObservation } from '../../../src/types/marketNetwork.ts';

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        regularMarketPrice?: number;
        regularMarketTime?: number;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
    error?: { code?: string; description?: string } | null;
  };
}

const YAHOO_CHART_HOSTS = [
  'https://query1.finance.yahoo.com',
  'https://query2.finance.yahoo.com',
] as const;

async function fetchYahooChartFromHost(host: string, range: string): Promise<YahooChartResponse> {
  const url = `${host}/v8/finance/chart/DX-Y.NYB?range=${encodeURIComponent(range)}&interval=1d`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) {
      throw new Error(`Yahoo Finance HTTP ${res.status} (${host}, DX-Y.NYB)`);
    }

    return (await res.json()) as YahooChartResponse;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches DXY (DX-Y.NYB) daily closes from Yahoo Finance.
 * Tries query1 and falls back to query2 on rate-limit or transient errors;
 * fails cleanly if all endpoints fail without affecting other providers.
 */
export async function fetchYahooDxyDaily(range = '5y'): Promise<{
  observations: MacroObservation[];
  fetchedAtIso: string;
}> {
  const errors: string[] = [];
  let payload: YahooChartResponse | null = null;

  for (const host of YAHOO_CHART_HOSTS) {
    try {
      const candidate = await fetchYahooChartFromHost(host, range);
      if (candidate.chart?.error) {
        errors.push(
          `${host}: ${candidate.chart.error.description ?? candidate.chart.error.code ?? 'Unknown'}`,
        );
        continue;
      }
      payload = candidate;
      break;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (!payload) {
    throw new Error(errors.join(' | ') || 'Yahoo Finance DX-Y.NYB 조회 실패');
  }

  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length === 0) {
    throw new Error('Yahoo Finance DX-Y.NYB 응답에 일봉 시계열이 없습니다.');
  }

  const byDate = new Map<string, number>();
  for (let i = 0; i < timestamps.length; i++) {
    const tsSec = timestamps[i];
    const close = closes[i];
    if (!Number.isFinite(tsSec) || close === null || !Number.isFinite(close) || close <= 0) {
      continue;
    }
    const date = new Date(tsSec * 1000).toISOString().slice(0, 10);
    byDate.set(date, Number(close));
  }

  const observations = Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value }));

  if (observations.length < 30) {
    throw new Error(`Yahoo Finance DX-Y.NYB 유효 일봉 수 부족 (${observations.length}일)`);
  }

  return {
    observations,
    fetchedAtIso: new Date().toISOString(),
  };
}
