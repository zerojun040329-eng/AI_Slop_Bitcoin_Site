import React, { useState } from 'react';
import { RefreshCw, RotateCcw, SlidersHorizontal } from 'lucide-react';
import type {
  BacktestAccountConfig,
  LiquidityFakeoutParams,
  StrategyId,
  StrategyMetadata,
} from '../../types/strategyBacktest';

interface StrategySettingsProps {
  strategies: StrategyMetadata[];
  selectedStrategyId: StrategyId;
  onSelectStrategy: (id: StrategyId) => void;
  strategyParams: LiquidityFakeoutParams;
  onChangeStrategyParams: (next: LiquidityFakeoutParams) => void;
  accountConfig: BacktestAccountConfig;
  onChangeAccountConfig: (next: BacktestAccountConfig) => void;
  startDateStr: string;
  endDateStr: string;
  minDateStr: string;
  maxDateStr: string;
  onChangeStartDate: (v: string) => void;
  onChangeEndDate: (v: string) => void;
  onResetDefaults: () => void;
  onRunBacktest: () => void;
  isRunning: boolean;
  totalStoredBars: number;
}

export const StrategySettings: React.FC<StrategySettingsProps> = ({
  strategies,
  selectedStrategyId,
  onSelectStrategy,
  strategyParams,
  onChangeStrategyParams,
  accountConfig,
  onChangeAccountConfig,
  startDateStr,
  endDateStr,
  minDateStr,
  maxDateStr,
  onChangeStartDate,
  onChangeEndDate,
  onResetDefaults,
  onRunBacktest,
  isRunning,
  totalStoredBars,
}) => {
  const [showAdvancedParams, setShowAdvancedParams] = useState(true);
  const currentStrategy = strategies.find((s) => s.id === selectedStrategyId) ?? strategies[0];
  const invalidNm = strategyParams.tp1AtrMultiple >= strategyParams.tp2AtrMultiple;

  const updateStratNum = (key: keyof LiquidityFakeoutParams, raw: string) => {
    const val = Number.parseFloat(raw);
    if (!Number.isFinite(val)) return;
    onChangeStrategyParams({ ...strategyParams, [key]: val });
  };

  const updateAcctNum = (key: keyof BacktestAccountConfig, raw: string) => {
    const val = Number.parseFloat(raw);
    if (!Number.isFinite(val)) return;
    onChangeAccountConfig({ ...accountConfig, [key]: val });
  };

  return (
    <section
      id="strategy-settings"
      className="border-b border-slate-800/80 bg-[#0C121E]/75 px-5 py-4"
    >
      <div className="mx-auto max-w-[1440px] space-y-4">
        {/* Top Row: Strategy Selector, Description, Data Span, Run & Reset */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 max-w-3xl">
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="strategy-select" className="text-xs font-medium text-slate-400">
                매매 전략
              </label>
              <select
                id="strategy-select"
                value={selectedStrategyId}
                onChange={(e) => onSelectStrategy(e.target.value as StrategyId)}
                className="rounded border border-slate-700 bg-[#090D16] px-3 py-1.5 text-xs font-semibold text-slate-100 focus:border-sky-400 focus:outline-none"
              >
                {strategies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.koreanName}
                  </option>
                ))}
              </select>
              <span className="text-xs text-slate-400 font-mono-tabular">
                {totalStoredBars.toLocaleString()}봉 (5분봉 · 4년)
              </span>
            </div>
            {currentStrategy && (
              <p className="text-xs text-slate-400 leading-relaxed pt-0.5">
                {currentStrategy.summary}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowAdvancedParams((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-[#090D16] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500 cursor-pointer whitespace-nowrap"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
              <span>{showAdvancedParams ? '파라미터 접기' : '파라미터 펼치기'}</span>
            </button>

            <button
              type="button"
              onClick={onResetDefaults}
              className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-[#090D16] px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:border-slate-500 cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>설정 초기화</span>
            </button>

            <button
              type="button"
              disabled={isRunning || invalidNm}
              onClick={onRunBacktest}
              className="inline-flex items-center gap-1.5 rounded bg-sky-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRunning ? 'animate-spin' : ''}`} />
              <span>{isRunning ? '백테스트 실행 중...' : '백테스팅 실행'}</span>
            </button>
          </div>
        </div>

        {/* Parameter Grid */}
        {showAdvancedParams && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 pt-2 border-t border-slate-800/80">
            {/* Left 8 cols: Strategy Parameters */}
            <div className="xl:col-span-8 space-y-2">
              <div className="text-[11px] font-semibold text-slate-300">
                유동성 페이크 아웃 전략 변수
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 text-xs">
                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-400">Pivot 좌측 봉</span>
                  <input
                    type="number"
                    min={2}
                    max={40}
                    step={1}
                    value={strategyParams.pivotLeftBars}
                    onChange={(e) => updateStratNum('pivotLeftBars', e.target.value)}
                    className="w-full rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 font-mono-tabular text-slate-100 focus:border-sky-400 focus:outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-400">Pivot 우측 봉</span>
                  <input
                    type="number"
                    min={2}
                    max={40}
                    step={1}
                    value={strategyParams.pivotRightBars}
                    onChange={(e) => updateStratNum('pivotRightBars', e.target.value)}
                    className="w-full rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 font-mono-tabular text-slate-100 focus:border-sky-400 focus:outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-400">RVOL 임계값 (x)</span>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={0.1}
                    value={strategyParams.minRvol}
                    onChange={(e) => updateStratNum('minRvol', e.target.value)}
                    className="w-full rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 font-mono-tabular text-slate-100 focus:border-sky-400 focus:outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-400">거래량 증가율 (x)</span>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={0.1}
                    value={strategyParams.minVolumeSurgeRatio}
                    onChange={(e) => updateStratNum('minVolumeSurgeRatio', e.target.value)}
                    className="w-full rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 font-mono-tabular text-slate-100 focus:border-sky-400 focus:outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-400">반전 강도 임계값</span>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.05}
                    value={strategyParams.minReversalStrength}
                    onChange={(e) => updateStratNum('minReversalStrength', e.target.value)}
                    className="w-full rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 font-mono-tabular text-slate-100 focus:border-sky-400 focus:outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-400">ATR 기간 (봉)</span>
                  <input
                    type="number"
                    min={5}
                    max={60}
                    step={1}
                    value={strategyParams.atrPeriod}
                    onChange={(e) => updateStratNum('atrPeriod', e.target.value)}
                    className="w-full rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 font-mono-tabular text-slate-100 focus:border-sky-400 focus:outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-400">변동폭/ATR 최소</span>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    value={strategyParams.minRangeAtrMultiple}
                    onChange={(e) => updateStratNum('minRangeAtrMultiple', e.target.value)}
                    className="w-full rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 font-mono-tabular text-slate-100 focus:border-sky-400 focus:outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-400">1차 익절 배수 N</span>
                  <input
                    type="number"
                    min={0.2}
                    max={10}
                    step={0.1}
                    value={strategyParams.tp1AtrMultiple}
                    onChange={(e) => updateStratNum('tp1AtrMultiple', e.target.value)}
                    className={`w-full rounded border bg-[#090D16] px-2.5 py-1.5 font-mono-tabular text-slate-100 focus:outline-none ${
                      invalidNm ? 'border-rose-500' : 'border-slate-700 focus:border-sky-400'
                    }`}
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-400">2차 익절 배수 M</span>
                  <input
                    type="number"
                    min={0.3}
                    max={20}
                    step={0.1}
                    value={strategyParams.tp2AtrMultiple}
                    onChange={(e) => updateStratNum('tp2AtrMultiple', e.target.value)}
                    className={`w-full rounded border bg-[#090D16] px-2.5 py-1.5 font-mono-tabular text-slate-100 focus:outline-none ${
                      invalidNm ? 'border-rose-500' : 'border-slate-700 focus:border-sky-400'
                    }`}
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-400">이탈 회복 허용 봉</span>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    step={1}
                    value={strategyParams.sweepWindowBars}
                    onChange={(e) => updateStratNum('sweepWindowBars', e.target.value)}
                    className="w-full rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 font-mono-tabular text-slate-100 focus:border-sky-400 focus:outline-none"
                  />
                </label>
              </div>
              {invalidNm && (
                <p className="text-[11px] text-rose-400">
                  1차 익절 배수(N)는 반드시 2차 익절 배수(M)보다 작아야 합니다 (N &lt; M).
                </p>
              )}
            </div>

            {/* Right 4 cols: Account, Leverage, Cost Model & Date Range */}
            <div className="xl:col-span-4 space-y-2 xl:border-l xl:border-slate-800/80 xl:pl-4">
              <div className="text-[11px] font-semibold text-slate-300">
                자금 · 레버리지 · 거래 비용 · 기간
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-2 gap-2.5 text-xs">
                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-400">초기 자본 (USDT)</span>
                  <input
                    type="number"
                    min={100}
                    step={500}
                    value={accountConfig.initialCapital}
                    onChange={(e) => updateAcctNum('initialCapital', e.target.value)}
                    className="w-full rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 font-mono-tabular text-slate-100 focus:border-sky-400 focus:outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-400">포지션 비중 (%)</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step={5}
                    value={accountConfig.positionSizePct}
                    onChange={(e) => updateAcctNum('positionSizePct', e.target.value)}
                    className="w-full rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 font-mono-tabular text-slate-100 focus:border-sky-400 focus:outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-400">레버리지 (x)</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    step={1}
                    value={accountConfig.leverage}
                    onChange={(e) => updateAcctNum('leverage', e.target.value)}
                    className="w-full rounded border border-slate-700 bg-[#090D16] px-2.5 py-1.5 font-mono-tabular text-slate-100 focus:border-sky-400 focus:outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-400">수수료 / 슬리피지 (%)</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={accountConfig.feeRatePct}
                      onChange={(e) => updateAcctNum('feeRatePct', e.target.value)}
                      title="편도 수수료 (%)"
                      className="w-1/2 rounded border border-slate-700 bg-[#090D16] px-2 py-1.5 font-mono-tabular text-slate-100 focus:border-sky-400 focus:outline-none"
                    />
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={accountConfig.slippagePct}
                      onChange={(e) => updateAcctNum('slippagePct', e.target.value)}
                      title="편도 슬리피지 (%)"
                      className="w-1/2 rounded border border-slate-700 bg-[#090D16] px-2 py-1.5 font-mono-tabular text-slate-100 focus:border-sky-400 focus:outline-none"
                    />
                  </div>
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-400">시작일 (UTC)</span>
                  <input
                    type="date"
                    value={startDateStr}
                    min={minDateStr}
                    max={endDateStr || maxDateStr}
                    onChange={(e) => onChangeStartDate(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-[#090D16] px-2 py-1.5 font-mono-tabular text-slate-100 focus:border-sky-400 focus:outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] text-slate-400">종료일 (UTC)</span>
                  <input
                    type="date"
                    value={endDateStr}
                    min={startDateStr || minDateStr}
                    max={maxDateStr}
                    onChange={(e) => onChangeEndDate(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-[#090D16] px-2 py-1.5 font-mono-tabular text-slate-100 focus:border-sky-400 focus:outline-none"
                  />
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
