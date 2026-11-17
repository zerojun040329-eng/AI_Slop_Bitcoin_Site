import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  fetchedAt: string;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

async function fetchJsonWithRetry<T>(
  url: string,
  timeoutMs = 12000,
  retries = 1,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'btc-analytics-desk/1.0',
        },
      });
      clearTimeout(timer);
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        const err = new Error(`Upstream HTTP ${res.status} for ${url}: ${bodyText.slice(0, 180)}`);
        if (res.status >= 500 && attempt < retries) {
          lastError = err;
          await new Promise((r) => setTimeout(r, 350));
          continue;
        }
        throw err;
      }
      const data = (await res.json()) as T;
      return data;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 350));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function cachedSingleFlight<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<{ data: T; fetchedAt: string; cacheHit: boolean }> {
  const now = Date.now();
  const existing = cache.get(key) as CacheEntry<T> | undefined;
  if (existing && existing.expiresAt > now) {
    return { data: existing.value, fetchedAt: existing.fetchedAt, cacheHit: true };
  }

  const pending = inFlight.get(key) as Promise<{ data: T; fetchedAt: string }> | undefined;
  if (pending) {
    const res = await pending;
    return { ...res, cacheHit: true };
  }

  const job = (async () => {
    try {
      const value = await loader();
      const fetchedAt = new Date().toISOString();
      cache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
        fetchedAt,
      });
      return { data: value, fetchedAt };
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, job);
  const res = await job;
  return { ...res, cacheHit: false };
}

interface DeribitResponse<T> {
  jsonrpc: string;
  result?: T;
  error?: { code: number; message: string };
}

interface DeribitIndexPriceResult {
  index_price: number;
  estimated_delivery_price: number;
}

interface DeribitTvChartResult {
  ticks: number[];
  close: number[];
  volume: number[];
  status: string;
}

interface DeribitInstrument {
  instrument_name: string;
  expiration_timestamp: number;
  strike: number;
  option_type: 'call' | 'put';
  contract_size: number;
  is_active: boolean;
  quote_currency: string;
  base_currency: string;
}

interface DeribitBookSummary {
  instrument_name: string;
  mark_iv: number | null;
  open_interest: number;
  underlying_price: number;
  underlying_index: string;
  mark_price: number;
  volume: number;
  volume_usd?: number;
  bid_price: number | null;
  ask_price: number | null;
  creation_timestamp: number;
}

interface CoinMetricsRow {
  asset: string;
  time: string;
  PriceUSD?: string;
  HashRate?: string;
  BlkCnt?: string;
}

interface CoinMetricsResponse {
  data?: CoinMetricsRow[];
  next_page_url?: string;
  error?: { type: string; message: string };
}

interface MempoolHashrateResponse {
  hashrates: Array<{ timestamp: number; avgHashrate: number }>;
  difficulty: Array<{ time: number; height: number; difficulty: number; adjustment: number }>;
  currentHashrate: number;
  currentDifficulty: number;
}

interface MempoolDifficultyAdjustment {
  progressPercent: number;
  difficultyChange: number;
  estimatedRetargetDate: number;
  remainingBlocks: number;
  remainingTime: number;
  previousRetarget: number;
  nextRetargetHeight: number;
  timeAvg: number;
  adjustedTimeAvg: number;
}

interface MempoolRewardEntry {
  avgHeight: number;
  timestamp: number;
  avgRewards: number;
  USD: number;
}

interface MempoolFeeEntry {
  avgHeight: number;
  timestamp: number;
  avgFees: number;
  USD: number;
}

async function getDeribitSpot() {
  return cachedSingleFlight('deribit:spot', 15_000, async () => {
    const json = await fetchJsonWithRetry<DeribitResponse<DeribitIndexPriceResult>>(
      'https://www.deribit.com/api/v2/public/get_index_price?index_name=btc_usd',
    );
    if (!json.result || typeof json.result.index_price !== 'number' || json.result.index_price <= 0) {
      throw new Error('Invalid Deribit index_price payload');
    }
    return {
      indexPrice: json.result.index_price,
      estimatedDeliveryPrice: json.result.estimated_delivery_price,
    };
  });
}

async function getDeribitHistory30d() {
  return cachedSingleFlight('deribit:history30d', 300_000, async () => {
    const end = Date.now();
    const start = end - 36 * 86_400_000;
    const url = `https://www.deribit.com/api/v2/public/get_tradingview_chart_data?instrument_name=BTC-PERPETUAL&resolution=1D&start_timestamp=${start}&end_timestamp=${end}`;
    const json = await fetchJsonWithRetry<DeribitResponse<DeribitTvChartResult>>(url);
    const res = json.result;
    if (!res || res.status !== 'ok' || !Array.isArray(res.ticks) || !Array.isArray(res.close)) {
      throw new Error('Invalid Deribit tradingview chart payload');
    }
    const points = res.ticks
      .map((tickMs, idx) => ({
        timestampMs: tickMs,
        date: new Date(tickMs).toISOString().slice(0, 10),
        close: res.close[idx],
        volume: res.volume?.[idx] ?? 0,
      }))
      .filter((p) => Number.isFinite(p.close) && p.close > 0)
      .slice(-30);

    if (points.length < 20) {
      throw new Error(`Insufficient Deribit 30D candles (${points.length})`);
    }
    return points;
  });
}

async function getDeribitInstruments() {
  return cachedSingleFlight('deribit:instruments', 300_000, async () => {
    const json = await fetchJsonWithRetry<DeribitResponse<DeribitInstrument[]>>(
      'https://www.deribit.com/api/v2/public/get_instruments?currency=BTC&kind=option&expired=false',
    );
    if (!Array.isArray(json.result) || json.result.length === 0) {
      throw new Error('Invalid Deribit option instruments payload');
    }
    return json.result;
  });
}

async function getDeribitBookSummary() {
  return cachedSingleFlight('deribit:book', 30_000, async () => {
    const json = await fetchJsonWithRetry<DeribitResponse<DeribitBookSummary[]>>(
      'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option',
    );
    if (!Array.isArray(json.result) || json.result.length === 0) {
      throw new Error('Invalid Deribit option book summary payload');
    }
    return json.result;
  });
}

async function getCoinMetricsHistory() {
  return cachedSingleFlight('coinmetrics:btc:history', 3_600_000, async () => {
    const url =
      'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=PriceUSD,HashRate,BlkCnt&frequency=1d&start_time=2010-07-18&page_size=10000';
    const json = await fetchJsonWithRetry<CoinMetricsResponse>(url, 15_000, 1);
    if (json.error) {
      throw new Error(`Coin Metrics API error: ${json.error.message}`);
    }
    if (!Array.isArray(json.data) || json.data.length < 1000) {
      throw new Error('Invalid Coin Metrics historical dataset');
    }

    const rows = json.data
      .map((r) => {
        const price = r.PriceUSD !== undefined ? Number(r.PriceUSD) : NaN;
        const hashTh = r.HashRate !== undefined ? Number(r.HashRate) : NaN;
        const blkCnt = r.BlkCnt !== undefined ? Number(r.BlkCnt) : NaN;
        return {
          date: r.time.slice(0, 10),
          priceUsd: Number.isFinite(price) && price > 0 ? price : null,
          hashrateEh: Number.isFinite(hashTh) && hashTh >= 0 ? hashTh / 1_000_000 : null,
          blockCount: Number.isFinite(blkCnt) && blkCnt >= 0 ? blkCnt : null,
        };
      })
      .filter((r): r is { date: string; priceUsd: number; hashrateEh: number | null; blockCount: number | null } => r.priceUsd !== null);

    return rows;
  });
}

async function getMempoolTipHeight() {
  return cachedSingleFlight('mempool:tipHeight', 60_000, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch('https://mempool.space/api/blocks/tip/height', {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`Mempool tip height HTTP ${res.status}`);
      const text = await res.text();
      const height = Number(text.trim());
      if (!Number.isInteger(height) || height <= 840_000) {
        throw new Error(`Unexpected Mempool block height: ${text}`);
      }
      return height;
    } finally {
      clearTimeout(timer);
    }
  });
}

async function getMempoolDifficultyAdj() {
  return cachedSingleFlight('mempool:diffAdj', 60_000, async () => {
    const data = await fetchJsonWithRetry<MempoolDifficultyAdjustment>(
      'https://mempool.space/api/v1/difficulty-adjustment',
    );
    if (typeof data.timeAvg !== 'number' || data.timeAvg <= 0) {
      throw new Error('Invalid Mempool difficulty-adjustment payload');
    }
    return data;
  });
}

async function getMempoolHashrateAll() {
  return cachedSingleFlight('mempool:hashrateAll', 900_000, async () => {
    const data = await fetchJsonWithRetry<MempoolHashrateResponse>(
      'https://mempool.space/api/v1/mining/hashrate/all',
      15_000,
    );
    if (!Array.isArray(data.hashrates) || data.hashrates.length < 100) {
      throw new Error('Invalid Mempool hashrate payload');
    }
    return data;
  });
}

async function getMempoolRewards24h() {
  return cachedSingleFlight('mempool:rewards24h', 300_000, async () => {
    const data = await fetchJsonWithRetry<MempoolRewardEntry[]>(
      'https://mempool.space/api/v1/mining/blocks/rewards/24h',
    );
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Invalid Mempool 24h rewards payload');
    }
    return data;
  });
}

async function getMempoolFees24h() {
  return cachedSingleFlight('mempool:fees24h', 300_000, async () => {
    const data = await fetchJsonWithRetry<MempoolFeeEntry[]>(
      'https://mempool.space/api/v1/mining/blocks/fees/24h',
    );
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Invalid Mempool 24h fees payload');
    }
    return data;
  });
}

async function createServer() {
  const app = express();

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  // 1. Short-Term Derivatives Bundle (Deribit Public API)
  app.get('/api/derivatives/bundle', async (_req, res) => {
    try {
      const [spotRes, historyRes, instRes, bookRes] = await Promise.all([
        getDeribitSpot(),
        getDeribitHistory30d(),
        getDeribitInstruments(),
        getDeribitBookSummary(),
      ]);

      res.json({
        spot: spotRes.data,
        history30d: historyRes.data,
        instruments: instRes.data,
        bookSummary: bookRes.data,
        liquidationSupport: {
          supported: false,
          provider: null,
          reason:
            '가격 구간별 예상 청산 유동성(미결제 포지션 레버리지 히트맵)은 공개 무료 API에서 제공되지 않으며, CoinGlass 등 유료 파생상품 데이터 API 키가 필요합니다.',
        },
        provenance: {
          spot: {
            provider: 'Deribit Public API (btc_usd index)',
            fetchedAt: spotRes.fetchedAt,
            cadence: '실시간 (15초 캐시)',
            kind: '실제 데이터',
          },
          history30d: {
            provider: 'Deribit Public API (BTC-PERPETUAL 1D)',
            fetchedAt: historyRes.fetchedAt,
            dataTimestamp: historyRes.data[historyRes.data.length - 1]?.date ?? null,
            cadence: '일별 집계 (5분 캐시)',
            kind: '실제 데이터',
          },
          options: {
            provider: 'Deribit Public API (Options Instruments & Book Summary)',
            fetchedAt: bookRes.fetchedAt,
            cadence: '실시간 호가/마크 IV (30초 캐시)',
            kind: '실제 데이터',
          },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Deribit API 호출 오류';
      res.status(502).json({
        error: 'DERIBIT_UPSTREAM_ERROR',
        message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // 2. Long-Term Historical BTC Price + Live Spot (Coin Metrics Community + Deribit Spot)
  app.get('/api/long-term/history', async (_req, res) => {
    try {
      const [cmRes, spotRes] = await Promise.allSettled([
        getCoinMetricsHistory(),
        getDeribitSpot(),
      ]);

      if (cmRes.status === 'rejected') {
        throw cmRes.reason;
      }

      const cmRows = cmRes.value.data;
      const lastCmDate = cmRows[cmRows.length - 1]?.date ?? null;
      const liveSpot = spotRes.status === 'fulfilled' ? spotRes.value.data.indexPrice : null;
      const spotFetchedAt = spotRes.status === 'fulfilled' ? spotRes.value.fetchedAt : null;

      res.json({
        history: cmRows,
        liveSpot,
        provenance: {
          history: {
            provider: 'Coin Metrics Community API v4 (PriceUSD)',
            fetchedAt: cmRes.value.fetchedAt,
            startDate: cmRows[0]?.date ?? null,
            endDate: lastCmDate,
            rowCount: cmRows.length,
            cadence: '일별 종가 (1시간 캐시)',
            kind: '실제 데이터',
          },
          liveSpot: liveSpot
            ? {
                provider: 'Deribit Public API (btc_usd index)',
                fetchedAt: spotFetchedAt,
                cadence: '실시간 (15초 캐시)',
                kind: '실제 데이터',
              }
            : null,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Coin Metrics API 호출 오류';
      res.status(502).json({
        error: 'COINMETRICS_UPSTREAM_ERROR',
        message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // 3. Long-Term Mining, Block Height & Difficulty (Mempool.space REST API)
  app.get('/api/long-term/mining', async (_req, res) => {
    try {
      const [tipRes, diffAdjRes, hashRes, rewardsRes, feesRes] = await Promise.all([
        getMempoolTipHeight(),
        getMempoolDifficultyAdj(),
        getMempoolHashrateAll(),
        getMempoolRewards24h(),
        getMempoolFees24h(),
      ]);

      const rewardsArr = rewardsRes.data;
      const feesArr = feesRes.data;

      // Average across latest 24h observations (satoshis -> BTC)
      const avgRewardSats =
        rewardsArr.reduce((acc, item) => acc + item.avgRewards, 0) / rewardsArr.length;
      const avgFeeSats =
        feesArr.reduce((acc, item) => acc + item.avgFees, 0) / feesArr.length;

      const avgTotalRewardBtc = avgRewardSats / 100_000_000;
      const avgFeePerBlockBtc = avgFeeSats / 100_000_000;

      // Normalize hashrate (H/s -> EH/s) & difficulty (raw -> T)
      // Sample daily/epoch points cleanly without synthetic interpolation
      const hashrates = hashRes.data.hashrates
        .filter((h) => Number.isFinite(h.avgHashrate) && h.avgHashrate > 0)
        .map((h) => ({
          timestampSec: h.timestamp,
          date: new Date(h.timestamp * 1000).toISOString().slice(0, 10),
          hashrateEh: h.avgHashrate / 1e18,
        }));

      const difficulties = hashRes.data.difficulty
        .filter((d) => Number.isFinite(d.difficulty) && d.difficulty > 0)
        .map((d) => ({
          timestampSec: d.time,
          date: new Date(d.time * 1000).toISOString().slice(0, 10),
          height: d.height,
          difficultyT: d.difficulty / 1e12,
        }));

      res.json({
        currentBlockHeight: tipRes.data,
        difficultyAdjustment: diffAdjRes.data,
        currentHashrateEh: hashRes.data.currentHashrate / 1e18,
        currentDifficultyT: hashRes.data.currentDifficulty / 1e12,
        avgTotalRewardBtc,
        avgFeePerBlockBtc,
        hashrates,
        difficulties,
        provenance: {
          blockchain: {
            provider: 'Mempool.space REST API',
            fetchedAt: tipRes.fetchedAt,
            cadence: '블록·난이도 1분 캐시 / 해시레이트 15분 캐시',
            kind: '실제 데이터',
          },
          historicalFeesArchive: {
            supported: false,
            reason:
              '과거 반감기 에포크별 누적 수수료 총수익은 Coin Metrics Community 무료 플랜(403 제한)에서 미제공됩니다. 현재 에포크 최근 24시간 평균 수수료만 Mempool.space로 연동됩니다.',
          },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Mempool.space API 호출 오류';
      res.status(502).json({
        error: 'MEMPOOL_UPSTREAM_ERROR',
        message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
