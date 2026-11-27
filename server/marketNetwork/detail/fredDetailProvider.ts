import type { MacroObservation } from '../../../src/types/marketNetwork.ts';

interface FredApiResponse {
  observations?: Array<{
    date: string;
    value: string;
  }>;
  error_message?: string;
}

interface CachedFredSeries {
  observations: MacroObservation[];
  providerLabel: string;
  fetchedAtIso: string;
  expiresAtMs: number;
}

const FRED_DETAIL_CACHE_TTL_MS = 10 * 60_000;
const fredCache = new Map<string, CachedFredSeries>();

/**
 * Fetches any FRED daily/monthly/quarterly observation series with short TTL caching.
 * Uses `FRED_API_KEY` when configured; otherwise uses St. Louis Fed public CSV feed.
 */
export async function fetchFredDetailSeries(
  seriesId: string,
  startDate = '2021-01-01',
  forceRefresh = false,
): Promise<{
  observations: MacroObservation[];
  providerLabel: string;
  fetchedAtIso: string;
}> {
  const cleanId = seriesId.trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,24}$/.test(cleanId)) {
    throw new Error(`유효하지 않은 FRED 시리즈 코드: ${seriesId}`);
  }

  const cacheKey = `${cleanId}:${startDate}`;
  const now = Date.now();
  const cached = fredCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAtMs > now) {
    return {
      observations: cached.observations,
      providerLabel: cached.providerLabel,
      fetchedAtIso: cached.fetchedAtIso,
    };
  }

  const apiKey = process.env.FRED_API_KEY?.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14_000);

  try {
    let observations: MacroObservation[] = [];
    let providerLabel = 'FRED Public Feed';

    if (apiKey) {
      const qs = new URLSearchParams({
        series_id: cleanId,
        api_key: apiKey,
        file_type: 'json',
        observation_start: startDate,
      });
      const res = await fetch(`https://api.stlouisfed.org/fred/series/observations?${qs.toString()}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'btc-analytics-desk/1.0' },
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`FRED API HTTP ${res.status} (${cleanId})`);
      }
      const json = (await res.json()) as FredApiResponse;
      if (json.error_message) {
        throw new Error(`FRED API error (${cleanId}): ${json.error_message}`);
      }
      observations = (json.observations ?? [])
        .map((row) => ({
          date: row.date,
          value: row.value === '.' ? NaN : Number(row.value),
        }))
        .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.value))
        .sort((a, b) => a.date.localeCompare(b.date));
      providerLabel = 'FRED Official API';
    } else {
      const csvUrl = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(
        cleanId,
      )}&cosd=${encodeURIComponent(startDate)}`;
      const res = await fetch(csvUrl, {
        signal: controller.signal,
        headers: { Accept: 'text/csv,text/plain', 'User-Agent': 'btc-analytics-desk/1.0' },
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`FRED CSV HTTP ${res.status} (${cleanId})`);
      }

      const csvText = await res.text();
      const lines = csvText.trim().split(/\r?\n/);
      for (let i = 1; i < lines.length; i++) {
        const [rawDate, rawVal] = lines[i].split(',');
        if (!rawDate || !rawVal || rawVal === '.') continue;
        const date = rawDate.trim();
        const value = Number(rawVal.trim());
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value)) {
          observations.push({ date, value });
        }
      }
      observations.sort((a, b) => a.date.localeCompare(b.date));
      providerLabel = 'FRED Public Data Feed (fred.stlouisfed.org)';
    }

    if (observations.length < 2) {
      throw new Error(`FRED ${cleanId} 유효 관측치 부족 (${observations.length})`);
    }

    const fetchedAtIso = new Date().toISOString();
    fredCache.set(cacheKey, {
      observations,
      providerLabel,
      fetchedAtIso,
      expiresAtMs: Date.now() + FRED_DETAIL_CACHE_TTL_MS,
    });

    return { observations, providerLabel, fetchedAtIso };
  } finally {
    clearTimeout(timer);
  }
}
