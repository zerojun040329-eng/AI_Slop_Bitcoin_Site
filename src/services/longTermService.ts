import type { LongTermHistoryResponse, LongTermMiningResponse } from '../api/marketApi';
import type {
  HalvingEvent,
  HashratePoint,
  HistoricalPricePoint,
  LongTermDataset,
} from '../types/longTerm';
import { daysSinceGenesisFromIso } from '../utils/longTermAnalytics';

const HISTORICAL_HALVINGS: HalvingEvent[] = [
  {
    epoch: 1,
    label: '1차 반감기',
    date: '2012-11-28',
    daysSinceGenesis: daysSinceGenesisFromIso('2012-11-28'),
    blockHeight: 210_000,
    rewardAfterBtc: 25,
  },
  {
    epoch: 2,
    label: '2차 반감기',
    date: '2016-07-09',
    daysSinceGenesis: daysSinceGenesisFromIso('2016-07-09'),
    blockHeight: 420_000,
    rewardAfterBtc: 12.5,
  },
  {
    epoch: 3,
    label: '3차 반감기',
    date: '2020-05-11',
    daysSinceGenesis: daysSinceGenesisFromIso('2020-05-11'),
    blockHeight: 630_000,
    rewardAfterBtc: 6.25,
  },
  {
    epoch: 4,
    label: '4차 반감기 (현재 사이클)',
    date: '2024-04-20',
    daysSinceGenesis: daysSinceGenesisFromIso('2024-04-20'),
    blockHeight: 840_000,
    rewardAfterBtc: 3.125,
    isCurrentEpoch: true,
  },
];

export function normalizeLongTermDataset(
  historyRes: LongTermHistoryResponse,
  miningRes: LongTermMiningResponse,
): LongTermDataset {
  // 1. Historical daily USD closes from Coin Metrics (zero interpolation)
  const priceHistory: HistoricalPricePoint[] = historyRes.history.map((row) => ({
    date: row.date,
    daysSinceGenesis: daysSinceGenesisFromIso(row.date),
    close: row.priceUsd,
  }));

  const todayIso = new Date().toISOString().slice(0, 10);
  const lastHist = priceHistory[priceHistory.length - 1];
  const liveSpot = historyRes.liveSpot ?? lastHist?.close ?? 0;

  if (historyRes.liveSpot && lastHist && todayIso > lastHist.date) {
    priceHistory.push({
      date: todayIso,
      daysSinceGenesis: daysSinceGenesisFromIso(todayIso),
      close: historyRes.liveSpot,
    });
  }

  // 2. Next Halving Estimate from REAL Mempool block height & avg block time
  const nextHalvingBlock = 1_050_000;
  const remainingBlocks = Math.max(0, nextHalvingBlock - miningRes.currentBlockHeight);
  const avgBlockIntervalSec = Math.max(
    180,
    Math.min(1200, miningRes.difficultyAdjustment.timeAvg / 1000),
  );
  const nextHalvingMs = Date.now() + remainingBlocks * avgBlockIntervalSec * 1000;
  const nextHalvingDate = new Date(nextHalvingMs).toISOString().slice(0, 10);

  const halvings: HalvingEvent[] = [
    ...HISTORICAL_HALVINGS,
    {
      epoch: 5,
      label: '5차 반감기 (실시간 블록 기준 예상)',
      date: nextHalvingDate,
      daysSinceGenesis: daysSinceGenesisFromIso(nextHalvingDate),
      blockHeight: nextHalvingBlock,
      rewardAfterBtc: 1.5625,
      isProjected: true,
    },
  ];

  // 3. Join real Mempool hashrates with real Mempool difficulty epochs (no synthetic interpolation)
  const sortedDiffs = [...miningRes.difficulties].sort((a, b) => a.timestampSec - b.timestampSec);
  let diffPtr = 0;

  const hashrateHistory: HashratePoint[] = miningRes.hashrates.map((h) => {
    while (
      diffPtr + 1 < sortedDiffs.length &&
      sortedDiffs[diffPtr + 1].timestampSec <= h.timestampSec
    ) {
      diffPtr += 1;
    }
    const activeDiff =
      sortedDiffs[diffPtr] && sortedDiffs[diffPtr].timestampSec <= h.timestampSec
        ? sortedDiffs[diffPtr].difficultyT
        : null;

    return {
      date: h.date,
      hashrateEh: h.hashrateEh,
      difficultyT: activeDiff,
    };
  });

  // Append latest live Mempool snapshot if newer
  if (hashrateHistory.length > 0) {
    const lastHr = hashrateHistory[hashrateHistory.length - 1];
    if (todayIso > lastHr.date) {
      hashrateHistory.push({
        date: todayIso,
        hashrateEh: miningRes.currentHashrateEh,
        difficultyT: miningRes.currentDifficultyT,
      });
    }
  }

  return {
    origin: 'live_api',
    isSimulated: false,
    sourceLabel: '실제 공개 API (Coin Metrics Community PriceUSD · Mempool.space 블록/채굴 · Deribit 현물)',
    genesisDate: '2009-01-03',
    currentDate: todayIso,
    currentSpotPrice: liveSpot,
    currentBlockHeight: miningRes.currentBlockHeight,
    nextHalvingBlock,
    avgBlockIntervalSec,
    avgTotalRewardBtc: miningRes.avgTotalRewardBtc,
    avgFeePerBlockBtc: miningRes.avgFeePerBlockBtc,
    difficultyRetargetProgressPct: miningRes.difficultyAdjustment.progressPercent,
    difficultyRetargetChangePct: miningRes.difficultyAdjustment.difficultyChange,
    priceHistory,
    halvings,
    hashrateHistory,
    defaultMiningAssumptions: {
      electricityUsdPerKwh: 0.052,
      fleetEfficiencyJPerTh: 21.5,
      allInOpExMultiplier: 1.38,
      historicalAvgPremiumPct: null,
    },
    historicalFeesArchiveSupported: miningRes.provenance.historicalFeesArchive.supported,
    historicalFeesArchiveReason: miningRes.provenance.historicalFeesArchive.reason,
    provenance: {
      priceHistory: {
        provider: historyRes.provenance.history.provider,
        fetchedAt: historyRes.provenance.history.fetchedAt,
        dataTimestamp: historyRes.provenance.history.endDate,
        cadence: historyRes.provenance.history.cadence,
        kind: '실제 데이터',
      },
      liveSpot: historyRes.provenance.liveSpot,
      blockchain: miningRes.provenance.blockchain,
    },
  };
}
