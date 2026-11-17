import React, { useMemo } from 'react';
import type { LongTermDataset } from '../../types/longTerm';
import { buildPowerLawSummary } from '../../utils/longTermAnalytics';
import { PowerLawChart } from './PowerLawChart';
import { HalvingCountdownSection } from './HalvingCountdownSection';
import { MiningEconomicsSection } from './MiningEconomicsSection';

interface LongTermDashboardPageProps {
  dataset: LongTermDataset;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export const LongTermDashboardPage: React.FC<LongTermDashboardPageProps> = ({
  dataset,
  onRefresh,
  isRefreshing = false,
}) => {
  const modelSummary = useMemo(
    () => buildPowerLawSummary(dataset.priceHistory),
    [dataset.priceHistory],
  );

  const lastHalving = useMemo(
    () =>
      dataset.halvings
        .filter((h) => !h.isProjected)
        .sort((a, b) => b.epoch - a.epoch)[0],
    [dataset.halvings],
  );

  const latestDataTimestamp =
    dataset.provenance.blockchain.fetchedAt ??
    dataset.provenance.priceHistory.fetchedAt ??
    dataset.currentDate;

  return (
    <div className="flex-1">
      {/* Live API Provenance Strip (Zero-pill clean inline metadata) */}
      <div className="border-b border-slate-800/80 bg-[#0A0F1A] px-5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-emerald-400">실제 API 연동 (Live)</span>
          <span aria-hidden="true">·</span>
          <span>{dataset.sourceLabel}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono-tabular text-slate-500">
            일봉 {dataset.priceHistory[0]?.date ?? dataset.genesisDate} ~ {dataset.currentDate} (
            {dataset.priceHistory.length.toLocaleString()}일)
          </span>
        </div>
        <div className="font-mono-tabular text-slate-500">
          최신 블록 #{dataset.currentBlockHeight.toLocaleString()} · 갱신{' '}
          {latestDataTimestamp.replace('T', ' ').slice(0, 19)} UTC
        </div>
      </div>

      {/* 1. Top: Ultra-Long-Term Bitcoin Power Law Chart */}
      <PowerLawChart
        priceHistory={dataset.priceHistory}
        halvings={dataset.halvings}
        modelSummary={modelSummary}
        currentDate={dataset.currentDate}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
      />

      {/* 2. Middle: Halving & Mutually Exclusive Bull/Bear Cycle Countdowns */}
      <HalvingCountdownSection
        defaultHalvingDate={lastHalving?.date ?? '2024-04-20'}
        currentBlockHeight={dataset.currentBlockHeight}
        nextHalvingBlock={dataset.nextHalvingBlock}
        avgBlockIntervalSec={dataset.avgBlockIntervalSec}
      />

      {/* 3. Bottom: Bitcoin Mining Economics & Network Hashrate */}
      <MiningEconomicsSection
        currentSpotPrice={dataset.currentSpotPrice}
        avgTotalRewardBtc={dataset.avgTotalRewardBtc}
        avgFeePerBlockBtc={dataset.avgFeePerBlockBtc}
        hashrateHistory={dataset.hashrateHistory}
        defaultAssumptions={dataset.defaultMiningAssumptions}
        halvings={dataset.halvings}
        historicalFeesArchiveSupported={dataset.historicalFeesArchiveSupported}
        historicalFeesArchiveReason={dataset.historicalFeesArchiveReason}
      />

      {/* Live Provenance & Model Distinction Footer */}
      <section
        id="architecture"
        className="mx-auto w-full max-w-[1440px] px-5 border-t border-slate-800/80 pt-8 pb-10 grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-slate-400"
      >
        <div>
          <h3 className="text-sm font-semibold text-slate-200 mb-1.5">
            실제 온체인·가격 API 출처
          </h3>
          <ul className="space-y-1.5 leading-relaxed">
            <li>
              <strong className="text-slate-200">초장기 일봉 종가:</strong>{' '}
              {dataset.provenance.priceHistory.provider} ({dataset.provenance.priceHistory.cadence})
            </li>
            {dataset.provenance.liveSpot && (
              <li>
                <strong className="text-slate-200">당일 실시간 현물:</strong>{' '}
                {dataset.provenance.liveSpot.provider} ({dataset.provenance.liveSpot.cadence})
              </li>
            )}
            <li>
              <strong className="text-slate-200">블록·해시레이트·24h 수수료:</strong>{' '}
              {dataset.provenance.blockchain.provider} ({dataset.provenance.blockchain.cadence})
            </li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-200 mb-1.5">
            실제 데이터 vs 모델 추정치 구분
          </h3>
          <p className="leading-relaxed">
            2010년 이후 일봉 종가, 실시간 블록 높이·평균 블록 생성 시간, 해시레이트·난이도, 최근 24h 수수료 포함 블록 보상은{' '}
            <strong className="text-slate-200">실제 API 데이터</strong>입니다. Power Law 추세·9단계 표준편차 밴드, 5차 반감기 예상 시점, 전력단가·ASIC 효율 기반 채굴 원가 및 채굴자 프리미엄은{' '}
            <strong className="text-sky-300">모델 추정치</strong>로 구분 표시합니다.
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-200 mb-1.5">
            미지원 데이터 고지
          </h3>
          <p className="leading-relaxed">
            {dataset.historicalFeesArchiveReason} 또한 장기 역사적 채굴장 평균 프리미엄 벤치마크는 다년간의 실제 ASIC 효율·전력단가 시계열 API 미연결로 <strong className="text-amber-300">미지원</strong> 표기합니다.
          </p>
        </div>
      </section>
    </div>
  );
};
