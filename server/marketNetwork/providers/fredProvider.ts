import type { MacroObservation } from '../../../src/types/marketNetwork.ts';

interface FredApiResponse {
  observations?: Array<{
    date: string;
    value: string;
  }>;
  error_code?: number;
  error_message?: string;
}

/**
 * Fetches FRED macroeconomic series (`M2SL`, `DGS10`).
 * - When `process.env.FRED_API_KEY` is configured, uses official JSON API (`api.stlouisfed.org`).
 * - When unset, falls back cleanly to St. Louis Fed public graph CSV (`fred.stlouisfed.org/graph/fredgraph.csv`).
 * - Never hardcodes API keys in source code.
 */
export async function fetchFredSeries(seriesId: 'M2SL' | 'DGS10'): Promise<{
  observations: MacroObservation[];
  providerLabel: string;
  fetchedAtIso: string;
}> {
  const apiKey = process.env.FRED_API_KEY?.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14_000);

  try {
    if (apiKey) {
      const qs = new URLSearchParams({
        series_id: seriesId,
        api_key: apiKey,
        file_type: 'json',
        observation_start: '2015-01-01',
      });
      const res = await fetch(`https://api.stlouisfed.org/fred/series/observations?${qs.toString()}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'btc-analytics-desk/1.0' },
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`FRED API HTTP ${res.status} (${seriesId})`);
      }

      const json = (await res.json()) as FredApiResponse;
      if (json.error_message) {
        throw new Error(`FRED API error (${seriesId}): ${json.error_message}`);
      }

      const observations = (json.observations ?? [])
        .map((row) => ({
          date: row.date,
          value: row.value === '.' ? NaN : Number(row.value),
        }))
        .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.value))
        .sort((a, b) => a.date.localeCompare(b.date));

      if (observations.length < 12) {
        throw new Error(`FRED API ${seriesId} 유효 관측치 부족`);
      }

      return {
        observations,
        providerLabel: 'FRED Official API (FRED_API_KEY)',
        fetchedAtIso: new Date().toISOString(),
      };
    }

    // Public St. Louis Fed CSV endpoint when FRED_API_KEY is not configured
    const csvUrl = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(
      seriesId,
    )}&cosd=2015-01-01`;
    const res = await fetch(csvUrl, {
      signal: controller.signal,
      headers: { Accept: 'text/csv,text/plain', 'User-Agent': 'btc-analytics-desk/1.0' },
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`FRED CSV HTTP ${res.status} (${seriesId})`);
    }

    const csvText = await res.text();
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) {
      throw new Error(`FRED CSV ${seriesId} 응답이 비어 있습니다.`);
    }

    const observations: MacroObservation[] = [];
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
    if (observations.length < 12) {
      throw new Error(`FRED CSV ${seriesId} 유효 관측치 부족 (${observations.length})`);
    }

    return {
      observations,
      providerLabel: 'FRED Public Data Feed (fred.stlouisfed.org)',
      fetchedAtIso: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}
