import React, { useEffect, useMemo, useRef, useState } from 'react';
import { evaluateHalvingCyclePhase } from '../../utils/longTermAnalytics';

interface HalvingCountdownSectionProps {
  defaultHalvingDate: string;
  currentBlockHeight: number;
  nextHalvingBlock: number;
  avgBlockIntervalSec: number;
}

interface DurationParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function splitDurationMs(ms: number): DurationParts {
  const safeSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(safeSec / 86400);
  const hours = Math.floor((safeSec % 86400) / 3600);
  const minutes = Math.floor((safeSec % 3600) / 60);
  const seconds = safeSec % 60;
  return { days, hours, minutes, seconds };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatUtcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const ZERO_PARTS: DurationParts = { days: 0, hours: 0, minutes: 0, seconds: 0 };

// Average ~4 years (210,000 blocks * 600s = 126,000,000s = ~1458.33 days)
const CYCLE_LENGTH_MS = 210_000 * 600 * 1000;

export const HalvingCountdownSection: React.FC<HalvingCountdownSectionProps> = ({
  defaultHalvingDate,
  currentBlockHeight,
  nextHalvingBlock,
  avgBlockIntervalSec,
}) => {
  // Base wall-clock timestamp updated once per second strictly inside this component
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [mountMs] = useState<number>(() => Date.now());

  // Actual 4th halving reference timestamp (UTC)
  const defaultHalvingMs = useMemo(() => {
    const [y, m, d] = defaultHalvingDate.split('-').map(Number);
    return Date.UTC(y, m - 1, d, 0, 0, 0);
  }, [defaultHalvingDate]);

  // Frozen last-displayed values for mutually exclusive Bull & Bear timers
  const lastBullPartsRef = useRef<DurationParts>(ZERO_PARTS);
  const lastBearPartsRef = useRef<DurationParts>(ZERO_PARTS);
  const prevPhaseRef = useRef<'bull' | 'bear' | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Next halving countdown anchored to block height + avg block time
  const elapsedSecSinceMount = Math.max(0, Math.floor((nowMs - mountMs) / 1000));
  const baseRemainingBlocks = Math.max(0, nextHalvingBlock - currentBlockHeight);
  const totalHalvingRemainingMs = Math.max(
    0,
    (baseRemainingBlocks * avgBlockIntervalSec - elapsedSecSinceMount) * 1000,
  );
  const halvingParts = splitDurationMs(totalHalvingRemainingMs);
  const estimatedHalvingDateStr = formatUtcDate(nowMs + totalHalvingRemainingMs);
  const liveEstimatedBlock = Math.min(
    nextHalvingBlock,
    currentBlockHeight + Math.floor(elapsedSecSinceMount / avgBlockIntervalSec),
  );
  const liveRemainingBlocks = Math.max(0, nextHalvingBlock - liveEstimatedBlock);

  // Mutually exclusive Bull / Bear evaluation anchored to actual halving date
  const phaseEval = evaluateHalvingCyclePhase(nowMs, defaultHalvingMs, CYCLE_LENGTH_MS);
  const isBullActive = phaseEval.activePhase === 'bull';
  const isBearActive = phaseEval.activePhase === 'bear';

  // Handle phase transitions cleanly: freeze the outgoing timer, activate the incoming one
  if (prevPhaseRef.current !== null && prevPhaseRef.current !== phaseEval.activePhase) {
    if (prevPhaseRef.current === 'bear' && phaseEval.activePhase === 'bull') {
      lastBearPartsRef.current = ZERO_PARTS;
    } else if (prevPhaseRef.current === 'bull' && phaseEval.activePhase === 'bear') {
      lastBullPartsRef.current = ZERO_PARTS;
    }
  }
  prevPhaseRef.current = phaseEval.activePhase;

  const bullParts = isBullActive
    ? splitDurationMs(phaseEval.bullEndMs - nowMs)
    : lastBullPartsRef.current;

  const bearParts = isBearActive
    ? splitDurationMs(phaseEval.bearEndMs - nowMs)
    : lastBearPartsRef.current;

  if (isBullActive) {
    lastBullPartsRef.current = bullParts;
  }
  if (isBearActive) {
    lastBearPartsRef.current = bearParts;
  }

  return (
    <section
      id="halving-countdown"
      className="mx-auto w-full max-w-[1440px] px-5 pt-8 pb-4 space-y-4"
      aria-label="반감기 및 역사적 사이클 카운트다운"
    >
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-slate-800/80 pb-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-100">
            반감기 및 역사적 상승·하락 사이클 카운트다운
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            하락 구간은 반감기 이후 18개월~30개월로 정의되며, 상승 구간은 그 여집합으로 상호 배타적으로 작동합니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 font-mono-tabular">
          <span>기준 4차 반감기 {defaultHalvingDate}</span>
          <span aria-hidden="true">·</span>
          <span>실시간 블록 #{liveEstimatedBlock.toLocaleString()}</span>
        </div>
      </div>

      {/* 3 Horizontal Countdown Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 border border-slate-800/80 bg-[#0C121E] divide-y lg:divide-y-0 lg:divide-x divide-slate-800/80">
        {/* A. Next Halving Countdown */}
        <div className="p-5 flex flex-col justify-between space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-slate-400">다음 5차 반감기까지</div>
              <div className="mt-0.5 text-sm font-semibold text-slate-100">
                블록 #1,050,000 도달 카운트다운
              </div>
            </div>
            <span className="font-mono-tabular text-xs font-medium text-sky-300">
              실시간 추정
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center font-mono-tabular">
            <div className="border border-slate-800/80 bg-[#090D16] py-2.5">
              <div className="text-xl font-semibold text-slate-50">{halvingParts.days}</div>
              <div className="text-[10px] text-slate-400">일</div>
            </div>
            <div className="border border-slate-800/80 bg-[#090D16] py-2.5">
              <div className="text-xl font-semibold text-slate-50">{pad2(halvingParts.hours)}</div>
              <div className="text-[10px] text-slate-400">시간</div>
            </div>
            <div className="border border-slate-800/80 bg-[#090D16] py-2.5">
              <div className="text-xl font-semibold text-slate-50">{pad2(halvingParts.minutes)}</div>
              <div className="text-[10px] text-slate-400">분</div>
            </div>
            <div className="border border-slate-800/80 bg-[#090D16] py-2.5">
              <div className="text-xl font-semibold text-sky-300">{pad2(halvingParts.seconds)}</div>
              <div className="text-[10px] text-slate-400">초</div>
            </div>
          </div>

          <div className="space-y-1 text-xs text-slate-400 border-t border-slate-800/70 pt-3">
            <div className="flex items-center justify-between">
              <span>현재 블록 높이 / 잔여 블록</span>
              <span className="font-mono-tabular text-slate-200">
                #{liveEstimatedBlock.toLocaleString()} / -{liveRemainingBlocks.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>예상 날짜 (최근 평균 {(avgBlockIntervalSec / 60).toFixed(1)}분/블록 · 변동)</span>
              <span className="font-mono-tabular text-sky-300">{estimatedHalvingDateStr}</span>
            </div>
          </div>
        </div>

        {/* B. Historical Bull Phase Countdown (Green) */}
        <div
          className={`p-5 flex flex-col justify-between space-y-4 transition-colors ${
            isBullActive ? 'bg-emerald-950/15' : 'bg-[#0A0E17] opacity-75'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-emerald-400/90">역사적 상승 구간</div>
              <div className="mt-0.5 text-sm font-semibold text-slate-100">
                상승 사이클 잔여 기간
              </div>
            </div>
            <span
              className={`font-mono-tabular text-xs font-semibold ${
                isBullActive ? 'text-emerald-400' : 'text-slate-500'
              }`}
            >
              {isBullActive ? '활성 · 카운트다운 중' : '비활성 · 정지'}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center font-mono-tabular">
            <div
              className={`border py-2.5 bg-[#090D16] ${
                isBullActive ? 'border-emerald-500/35' : 'border-slate-800/80'
              }`}
            >
              <div className={`text-xl font-semibold ${isBullActive ? 'text-emerald-300' : 'text-slate-500'}`}>
                {bullParts.days}
              </div>
              <div className="text-[10px] text-slate-400">일</div>
            </div>
            <div
              className={`border py-2.5 bg-[#090D16] ${
                isBullActive ? 'border-emerald-500/35' : 'border-slate-800/80'
              }`}
            >
              <div className={`text-xl font-semibold ${isBullActive ? 'text-emerald-300' : 'text-slate-500'}`}>
                {pad2(bullParts.hours)}
              </div>
              <div className="text-[10px] text-slate-400">시간</div>
            </div>
            <div
              className={`border py-2.5 bg-[#090D16] ${
                isBullActive ? 'border-emerald-500/35' : 'border-slate-800/80'
              }`}
            >
              <div className={`text-xl font-semibold ${isBullActive ? 'text-emerald-300' : 'text-slate-500'}`}>
                {pad2(bullParts.minutes)}
              </div>
              <div className="text-[10px] text-slate-400">분</div>
            </div>
            <div
              className={`border py-2.5 bg-[#090D16] ${
                isBullActive ? 'border-emerald-500/35' : 'border-slate-800/80'
              }`}
            >
              <div className={`text-xl font-semibold ${isBullActive ? 'text-emerald-400' : 'text-slate-500'}`}>
                {pad2(bullParts.seconds)}
              </div>
              <div className="text-[10px] text-slate-400">초</div>
            </div>
          </div>

          <div className="space-y-1 text-xs text-slate-400 border-t border-slate-800/70 pt-3">
            <div className="flex items-center justify-between">
              <span>판정 기준</span>
              <span className="text-slate-300">하락 구간(+18~30M) 외 여집합</span>
            </div>
            <div className="flex items-center justify-between">
              <span>{isBullActive ? '현재 상승 구간 종료 예정' : '현재 상태'}</span>
              <span className="font-mono-tabular text-emerald-300">
                {isBullActive
                  ? formatUtcDate(phaseEval.bullEndMs)
                  : '하락 구간 진행 중 (타이머 정지)'}
              </span>
            </div>
          </div>
        </div>

        {/* C. Historical Bear Phase Countdown (Red) */}
        <div
          className={`p-5 flex flex-col justify-between space-y-4 transition-colors ${
            isBearActive ? 'bg-rose-950/15' : 'bg-[#0A0E17] opacity-75'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-rose-400/90">역사적 하락 구간</div>
              <div className="mt-0.5 text-sm font-semibold text-slate-100">
                반감기 +18M ~ +30M 하락 윈도우
              </div>
            </div>
            <span
              className={`font-mono-tabular text-xs font-semibold ${
                isBearActive ? 'text-rose-400' : 'text-slate-500'
              }`}
            >
              {isBearActive ? '활성 · 카운트다운 중' : '비활성 · 정지'}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center font-mono-tabular">
            <div
              className={`border py-2.5 bg-[#090D16] ${
                isBearActive ? 'border-rose-500/35' : 'border-slate-800/80'
              }`}
            >
              <div className={`text-xl font-semibold ${isBearActive ? 'text-rose-300' : 'text-slate-500'}`}>
                {bearParts.days}
              </div>
              <div className="text-[10px] text-slate-400">일</div>
            </div>
            <div
              className={`border py-2.5 bg-[#090D16] ${
                isBearActive ? 'border-rose-500/35' : 'border-slate-800/80'
              }`}
            >
              <div className={`text-xl font-semibold ${isBearActive ? 'text-rose-300' : 'text-slate-500'}`}>
                {pad2(bearParts.hours)}
              </div>
              <div className="text-[10px] text-slate-400">시간</div>
            </div>
            <div
              className={`border py-2.5 bg-[#090D16] ${
                isBearActive ? 'border-rose-500/35' : 'border-slate-800/80'
              }`}
            >
              <div className={`text-xl font-semibold ${isBearActive ? 'text-rose-300' : 'text-slate-500'}`}>
                {pad2(bearParts.minutes)}
              </div>
              <div className="text-[10px] text-slate-400">분</div>
            </div>
            <div
              className={`border py-2.5 bg-[#090D16] ${
                isBearActive ? 'border-rose-500/35' : 'border-slate-800/80'
              }`}
            >
              <div className={`text-xl font-semibold ${isBearActive ? 'text-rose-400' : 'text-slate-500'}`}>
                {pad2(bearParts.seconds)}
              </div>
              <div className="text-[10px] text-slate-400">초</div>
            </div>
          </div>

          <div className="space-y-1 text-xs text-slate-400 border-t border-slate-800/70 pt-3">
            <div className="flex items-center justify-between">
              <span>기준 적용 상태</span>
              <span className="text-slate-300 font-mono-tabular">실제 4차 반감기 ({defaultHalvingDate})</span>
            </div>
            <div className="flex items-center justify-between">
              <span>하락 윈도우 (+18M ~ +30M)</span>
              <span className="font-mono-tabular text-rose-300">
                {formatUtcDate(phaseEval.bearStartMs)} ~ {formatUtcDate(phaseEval.bearEndMs)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
