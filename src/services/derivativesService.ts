import type { DeribitBundleResponse } from '../api/marketApi';
import type {
  DailyClosePoint,
  MarketSnapshot,
  OptionMaturityIV,
  OptionStrikeOI,
} from '../types/derivatives';

function formatShortDate(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${Number(month)}/${Number(day)}`;
}

function formatTenorLabel(days: number): string {
  const rounded = Math.max(1, Math.round(days));
  return `${rounded}D`;
}

/**
 * Normalizes real Deribit API responses into the Unified Derivatives Chart model.
 * - Converts Deribit `mark_iv` from percentage (e.g. 49.66) to decimal (0.4966).
 * - Multiplies `open_interest` by instrument `contract_size` (BTC notional contracts).
 * - Computes ATM IV per expiration up to 365 days using closest active strike(s) to underlying price.
 */
export function normalizeDeribitSnapshot(raw: DeribitBundleResponse): MarketSnapshot {
  const nowMs = Date.now();
  const currentPrice = raw.spot.indexPrice;

  // 1. Normalize 30-day daily BTC closes
  const sortedCandles = [...raw.history30d]
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .slice(-30);

  const lastIdx = sortedCandles.length - 1;
  const history30d: DailyClosePoint[] = sortedCandles.map((c, idx) => ({
    date: c.date,
    label: formatShortDate(c.date),
    dayOffset: idx - lastIdx,
    close: idx === lastIdx ? currentPrice : c.close,
    volumeB: c.volume / 1_000_000,
  }));

  // 2. Index book summaries by instrument_name
  const bookMap = new Map(raw.bookSummary.map((b) => [b.instrument_name, b]));

  // 3. Group active options (0 < daysToExpiry <= 365) by expirationDate
  interface ExpiryBucket {
    expiryDate: string;
    expirationMs: number;
    daysToExpiry: number;
    underlyingPrice: number;
    totalOiBtc: number;
    strikeMap: Map<
      number,
      {
        strike: number;
        callOiBtc: number;
        putOiBtc: number;
        callIvSum: number;
        callIvCount: number;
        putIvSum: number;
        putIvCount: number;
      }
    >;
  }

  const expiryBuckets = new Map<string, ExpiryBucket>();
  const globalStrikeMap = new Map<
    number,
    {
      strike: number;
      callOiBtc: number;
      putOiBtc: number;
      callIvSum: number;
      callIvCount: number;
      putIvSum: number;
      putIvCount: number;
    }
  >();

  for (const inst of raw.instruments) {
    if (!inst.is_active) continue;
    const daysToExpiry = (inst.expiration_timestamp - nowMs) / 86_400_000;
    if (daysToExpiry <= 0 || daysToExpiry > 365) continue;

    const book = bookMap.get(inst.instrument_name);
    if (!book) continue;

    const expiryDate = new Date(inst.expiration_timestamp).toISOString().slice(0, 10);
    const contractSize = Number.isFinite(inst.contract_size) && inst.contract_size > 0 ? inst.contract_size : 1;
    const oiBtc = Math.max(0, (book.open_interest ?? 0) * contractSize);

    // Deribit mark_iv is expressed in percentage (e.g., 52.4 -> 0.524)
    const rawIv = typeof book.mark_iv === 'number' && book.mark_iv > 0 ? book.mark_iv / 100 : null;
    const validIv = rawIv !== null && rawIv > 0.02 && rawIv < 5 ? rawIv : null;

    let bucket = expiryBuckets.get(expiryDate);
    if (!bucket) {
      bucket = {
        expiryDate,
        expirationMs: inst.expiration_timestamp,
        daysToExpiry,
        underlyingPrice: book.underlying_price > 0 ? book.underlying_price : currentPrice,
        totalOiBtc: 0,
        strikeMap: new Map(),
      };
      expiryBuckets.set(expiryDate, bucket);
    }

    bucket.totalOiBtc += oiBtc;
    if (book.underlying_price > 0) {
      bucket.underlyingPrice = book.underlying_price;
    }

    const updateStrikeAgg = (
      targetMap: ExpiryBucket['strikeMap'],
    ) => {
      let row = targetMap.get(inst.strike);
      if (!row) {
        row = {
          strike: inst.strike,
          callOiBtc: 0,
          putOiBtc: 0,
          callIvSum: 0,
          callIvCount: 0,
          putIvSum: 0,
          putIvCount: 0,
        };
        targetMap.set(inst.strike, row);
      }
      if (inst.option_type === 'call') {
        row.callOiBtc += oiBtc;
        if (validIv !== null) {
          row.callIvSum += validIv;
          row.callIvCount += 1;
        }
      } else {
        row.putOiBtc += oiBtc;
        if (validIv !== null) {
          row.putIvSum += validIv;
          row.putIvCount += 1;
        }
      }
    };

    updateStrikeAgg(bucket.strikeMap);
    updateStrikeAgg(globalStrikeMap);
  }

  // 4. Build normalized maturities sorted chronologically
  const optionMaturities: OptionMaturityIV[] = [];
  const sortedBuckets = [...expiryBuckets.values()].sort(
    (a, b) => a.daysToExpiry - b.daysToExpiry,
  );

  for (const bucket of sortedBuckets) {
    const strikesOI: OptionStrikeOI[] = [...bucket.strikeMap.values()]
      .sort((a, b) => a.strike - b.strike)
      .map((s) => ({
        strike: s.strike,
        callOiBtc: Number(s.callOiBtc.toFixed(2)),
        putOiBtc: Number(s.putOiBtc.toFixed(2)),
        callIv: s.callIvCount > 0 ? s.callIvSum / s.callIvCount : 0,
        putIv: s.putIvCount > 0 ? s.putIvSum / s.putIvCount : 0,
      }));

    if (strikesOI.length === 0) continue;

    // Pick closest ATM strike(s) with valid Call/Put IV
    const refPrice = bucket.underlyingPrice > 0 ? bucket.underlyingPrice : currentPrice;
    const byDistance = [...strikesOI]
      .filter((s) => s.callIv > 0 || s.putIv > 0)
      .sort((a, b) => Math.abs(a.strike - refPrice) - Math.abs(b.strike - refPrice));

    if (byDistance.length === 0) continue;

    const atmStrike = byDistance[0];
    const callIv = atmStrike.callIv > 0 ? atmStrike.callIv : atmStrike.putIv;
    const putIv = atmStrike.putIv > 0 ? atmStrike.putIv : atmStrike.callIv;
    const atmIv =
      atmStrike.callIv > 0 && atmStrike.putIv > 0
        ? (atmStrike.callIv + atmStrike.putIv) / 2
        : callIv || putIv;

    if (atmIv <= 0) continue;

    optionMaturities.push({
      tenor: formatTenorLabel(bucket.daysToExpiry),
      expiryDate: bucket.expiryDate,
      daysToExpiry: bucket.daysToExpiry,
      atmIv,
      callIv,
      putIv,
      ivSource: 'atm_direct',
      tenorOiBtc: Number(bucket.totalOiBtc.toFixed(1)),
      strikesOI,
    });
  }

  // Deduplicate tenor labels if two expiries round to identical integer days (rare, e.g., timezone)
  const seenTenors = new Set<string>();
  for (const m of optionMaturities) {
    if (seenTenors.has(m.tenor)) {
      m.tenor = `${m.expiryDate.slice(5)}`;
    }
    seenTenors.add(m.tenor);
  }

  const optionStrikesOI: OptionStrikeOI[] = [...globalStrikeMap.values()]
    .sort((a, b) => a.strike - b.strike)
    .map((s) => ({
      strike: s.strike,
      callOiBtc: Number(s.callOiBtc.toFixed(2)),
      putOiBtc: Number(s.putOiBtc.toFixed(2)),
      callIv: s.callIvCount > 0 ? s.callIvSum / s.callIvCount : 0,
      putIv: s.putIvCount > 0 ? s.putIvSum / s.putIvCount : 0,
    }));

  return {
    id: 'deribit-live',
    name: 'Deribit 실시간 BTC 파생상품 스냅샷',
    description: `실제 Deribit 옵션 ${raw.instruments.length}개 계약 · 만기 ${optionMaturities.length}개(≤365D) · 30일 BTC 일봉 연동`,
    symbol: 'BTC/USD',
    origin: 'live_api',
    isSimulated: false,
    sourceLabel: '실제 거래소 공개 API (Deribit Index · BTC-PERPETUAL 1D · Options Chain)',
    timestampIso: raw.provenance.options.fetchedAt ?? new Date().toISOString(),
    currentPrice,
    history30d,
    optionMaturities,
    optionStrikesOI,
    liquidationBins: [],
    liquidationSupport: raw.liquidationSupport,
    provenance: raw.provenance,
  };
}
