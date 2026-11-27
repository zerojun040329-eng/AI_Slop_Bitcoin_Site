import zlib from 'zlib';

export interface NasdaqScreenerRow {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  marketCapUsd: number;
  priceUsd: number | null;
  changePct: number | null;
}

export interface Nasdaq100Row {
  symbol: string;
  companyName: string;
  marketCapUsd: number;
  priceUsd: number | null;
  changePct: number | null;
}

export interface SsgaSpyHolding {
  name: string;
  ticker: string;
  weightPct: number;
}

export interface SsgaSpyHoldingsResult {
  asOfLabel: string | null;
  holdings: SsgaSpyHolding[];
  fetchedAtIso: string;
}

interface NasdaqScreenerApiRow {
  symbol?: string;
  name?: string;
  lastsale?: string;
  pctchange?: string;
  marketCap?: string;
  sector?: string;
  industry?: string;
}

interface Nasdaq100ApiRow {
  symbol?: string;
  companyName?: string;
  marketCap?: string;
  lastSalePrice?: string;
  percentageChange?: string;
}

const EQUITY_CACHE_TTL_MS = 10 * 60_000;

let screenerCache: { map: Map<string, NasdaqScreenerRow>; expiresAtMs: number; fetchedAtIso: string } | null = null;
let ndxCache: { rows: Nasdaq100Row[]; expiresAtMs: number; fetchedAtIso: string } | null = null;
let spyHoldingsCache: { data: SsgaSpyHoldingsResult; expiresAtMs: number } | null = null;

function parseNumeric(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.-]/g, '');
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

export function normalizeTickerKey(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\./g, '/');
}

export async function fetchNasdaqScreenerMap(forceRefresh = false): Promise<{
  map: Map<string, NasdaqScreenerRow>;
  fetchedAtIso: string;
}> {
  const now = Date.now();
  if (!forceRefresh && screenerCache && screenerCache.expiresAtMs > now) {
    return { map: screenerCache.map, fetchedAtIso: screenerCache.fetchedAtIso };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 16_000);
  try {
    const res = await fetch(
      'https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true',
      {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; btc-analytics-desk/1.0)',
        },
      },
    );
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`Nasdaq Screener HTTP ${res.status}`);
    }
    const json = (await res.json()) as { data?: { rows?: NasdaqScreenerApiRow[] } };
    const rows = json.data?.rows ?? [];
    if (rows.length < 100) {
      throw new Error(`Nasdaq Screener 응답 행 수 부족 (${rows.length})`);
    }

    const map = new Map<string, NasdaqScreenerRow>();
    for (const r of rows) {
      if (!r.symbol) continue;
      const sym = r.symbol.trim().toUpperCase();
      const row: NasdaqScreenerRow = {
        symbol: sym,
        name: (r.name ?? sym).trim(),
        sector: (r.sector ?? '').trim(),
        industry: (r.industry ?? '').trim(),
        marketCapUsd: parseNumeric(r.marketCap) ?? 0,
        priceUsd: parseNumeric(r.lastsale),
        changePct: parseNumeric(r.pctchange),
      };
      map.set(sym, row);
      map.set(normalizeTickerKey(sym), row);
    }

    const fetchedAtIso = new Date().toISOString();
    screenerCache = { map, fetchedAtIso, expiresAtMs: Date.now() + EQUITY_CACHE_TTL_MS };
    return { map, fetchedAtIso };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchNasdaq100Constituents(forceRefresh = false): Promise<{
  rows: Nasdaq100Row[];
  fetchedAtIso: string;
}> {
  const now = Date.now();
  if (!forceRefresh && ndxCache && ndxCache.expiresAtMs > now) {
    return { rows: ndxCache.rows, fetchedAtIso: ndxCache.fetchedAtIso };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14_000);
  try {
    const res = await fetch('https://api.nasdaq.com/api/quote/list-type/nasdaq100', {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; btc-analytics-desk/1.0)',
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`Nasdaq-100 API HTTP ${res.status}`);
    }
    const json = (await res.json()) as { data?: { data?: { rows?: Nasdaq100ApiRow[] } } };
    const rawRows = json.data?.data?.rows ?? [];
    if (rawRows.length < 50) {
      throw new Error(`Nasdaq-100 구성종목 수 부족 (${rawRows.length})`);
    }

    const rows: Nasdaq100Row[] = rawRows
      .filter((r) => Boolean(r.symbol))
      .map((r) => ({
        symbol: r.symbol!.trim().toUpperCase(),
        companyName: (r.companyName ?? r.symbol!).trim(),
        marketCapUsd: parseNumeric(r.marketCap) ?? 0,
        priceUsd: parseNumeric(r.lastSalePrice),
        changePct: parseNumeric(r.percentageChange),
      }));

    const fetchedAtIso = new Date().toISOString();
    ndxCache = { rows, fetchedAtIso, expiresAtMs: Date.now() + EQUITY_CACHE_TTL_MS };
    return { rows, fetchedAtIso };
  } finally {
    clearTimeout(timer);
  }
}

function parseZipEntries(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= buf.length) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break;
    const flags = buf.readUInt16LE(offset + 6);
    const comp = buf.readUInt16LE(offset + 8);
    let compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;

    if ((flags & 0x08) !== 0 && compSize === 0) {
      let next = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), dataStart);
      const cd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), dataStart);
      if (next === -1 || (cd !== -1 && cd < next)) next = cd;
      if (next === -1) break;
      compSize = next - dataStart;
    }

    const raw = buf.subarray(dataStart, dataStart + compSize);
    try {
      if (comp === 0) files.set(name, raw);
      else if (comp === 8) files.set(name, zlib.inflateRawSync(raw));
    } catch {
      if (raw.length > 16) {
        try {
          files.set(name, zlib.inflateRawSync(raw.subarray(0, raw.length - 16)));
        } catch {
          // ignore non-critical zip entries
        }
      }
    }
    offset = dataStart + compSize;
    if (
      (flags & 0x08) !== 0 &&
      offset + 4 <= buf.length &&
      buf.readUInt32LE(offset) === 0x08074b50
    ) {
      offset += 16;
    }
  }
  return files;
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export async function fetchSsgaSpyHoldings(forceRefresh = false): Promise<SsgaSpyHoldingsResult> {
  const now = Date.now();
  if (!forceRefresh && spyHoldingsCache && spyHoldingsCache.expiresAtMs > now) {
    return spyHoldingsCache.data;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 16_000);
  try {
    const res = await fetch(
      'https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx',
      {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; btc-analytics-desk/1.0)' },
      },
    );
    clearTimeout(timer);
    if (!res.ok) {
      throw new Error(`SSGA SPY holdings HTTP ${res.status}`);
    }

    const xlsxBuf = Buffer.from(await res.arrayBuffer());
    const zip = parseZipEntries(xlsxBuf);
    const ssXml = zip.get('xl/sharedStrings.xml')?.toString('utf8');
    const shXml = zip.get('xl/worksheets/sheet1.xml')?.toString('utf8');
    if (!ssXml || !shXml) {
      throw new Error('SSGA SPY xlsx 내부 시트 XML을 파싱할 수 없습니다.');
    }

    const strings: string[] = [];
    for (const m of ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]);
      strings.push(decodeXmlEntities(texts.join('')));
    }

    const rows: string[][] = [];
    for (const r of shXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of r[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = c[1];
        const isStr = /t="s"/.test(attrs);
        const vMatch = c[2].match(/<v>([^<]*)<\/v>/);
        if (!vMatch) {
          cells.push('');
          continue;
        }
        cells.push(isStr ? (strings[Number(vMatch[1])] ?? '') : vMatch[1]);
      }
      if (cells.some(Boolean)) rows.push(cells);
    }

    let asOfLabel: string | null = null;
    let headerIdx = -1;
    for (let i = 0; i < Math.min(12, rows.length); i++) {
      if (rows[i][0]?.startsWith('Holdings:') && rows[i][1]) {
        asOfLabel = rows[i][1].replace(/^As of\s*/i, '').trim();
      }
      if (rows[i][0] === 'Name' && rows[i][1] === 'Ticker') {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx < 0) {
      throw new Error('SSGA SPY xlsx 헤더 행을 찾지 못했습니다.');
    }

    const holdings: SsgaSpyHolding[] = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const name = (row[0] ?? '').trim();
      const ticker = (row[1] ?? '').trim().toUpperCase();
      const weight = Number(row[4]);
      if (!ticker || ticker === '-' || !Number.isFinite(weight) || weight <= 0) continue;
      if (ticker.includes('CASH') || name.toUpperCase().includes('US DOLLAR')) continue;
      holdings.push({ name, ticker, weightPct: weight });
    }

    if (holdings.length < 300) {
      throw new Error(`SSGA SPY 구성종목 수 부족 (${holdings.length})`);
    }

    const data: SsgaSpyHoldingsResult = {
      asOfLabel,
      holdings,
      fetchedAtIso: new Date().toISOString(),
    };
    spyHoldingsCache = { data, expiresAtMs: Date.now() + EQUITY_CACHE_TTL_MS };
    return data;
  } finally {
    clearTimeout(timer);
  }
}
