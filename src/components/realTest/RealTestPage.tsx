import React, { useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { LongTermHistoryResponse } from '../../api/marketApi';
import type { HalvingEpochId, RealTestInputs, RealTestSuiteResult } from '../../types/realTest';
import {
  IntegratedCycleComparisonChart,
  PutPayoffCurveChart,
  PutStrikeBarsChart,
  SpotDcaEquityChart,
  SpotDcaPriceWindowChart,
} from './RealTestCharts';

interface RealTestPageProps {
  inputs: RealTestInputs;
  onChangeBudget: (val: number) => void;
  onChangeFee: (val: number) => void;
  result: RealTestSuiteResult | null;
  provenance: LongTermHistoryResponse['provenance'] | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
}

function fmtUsd(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

function fmtSignedUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${fmtUsd(v, 0)}`;
}

function fmtPct(v: number | null | undefined, signed = false, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const sign = signed && v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

function fmtBtc(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)} BTC`;
}

function KpiCell({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'accent';
}) {
  const valueClass =
    tone === 'positive'
      ? 'text-emerald-400'
      : tone === 'negative'
        ? 'text-rose-400'
        : tone === 'accent'
          ? 'text-sky-300'
          : 'text-slate-100';

  return (
    <div className="border border-slate-800/80 bg-[#0C121E] px-4 py-3 rounded-md">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`mt-1 text-base font-semibold font-mono-tabular ${valueClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500 font-mono-tabular">{sub}</div>}
    </div>
  );
}

export const RealTestPage: React.FC<RealTestPageProps> = ({
  inputs,
  onChangeBudget,
  onChangeFee,
  result,
  provenance,
  loading,
  refreshing,
  error,
  onRefresh,
}) => {
  const [selectedEpoch, setSelectedEpoch] = useState<HalvingEpochId>(3);
  const [showAllLedgerRows, setShowAllLedgerRows] = useState(false);

  const selectedCycle = useMemo(() => {
    if (!result) return null;
    return result.cycles.find((c) => c.schedule.epoch === selectedEpoch) ?? result.cycles[0] ?? null;
  }, [result, selectedEpoch]);

  if (loading && !result) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-24 text-center space-y-3">
        <RefreshCw className="h-6 w-6 text-sky-400 animate-spin" />
        <div className="text-sm font-medium text-slate-200">
          실전테스트용 2015년~현재 BTC 일봉 시계열을 불러오는 중입니다
        </div>
        <p className="text-xs text-slate-400 max-w-md">
          장기투자지표와 동일한 Coin Metrics 일봉 종가 캐시(/api/long-term/history)를 공유하여 반감기 사이클 전략을 검증합니다.
        </p>
      </div>
    );
  }

  if (!result || !selectedCycle) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-24 text-center space-y-4">
        <AlertTriangle className="h-7 w-7 text-rose-400" />
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-100">실전테스트 일봉 데이터 로드 실패</h2>
          <p className="text-xs text-rose-300 max-w-lg font-mono-tabular">
            {error ?? 'Coin Metrics 일봉 데이터를 불러오지 못했습니다.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>데이터 다시 불러오기</span>
        </button>
      </div>
    );
  }

  const { schedule, spotDca, putOption, integrated } = selectedCycle;
  const ledgerRows = showAllLedgerRows
    ? spotDca.executions
    : spotDca.executions.slice(-14).reverse();

  return (
    <div className="flex-1 pb-14">
      {/* Live Shared Provenance Strip */}
      <div className="border-b border-slate-800/80 bg-[#0A0F1A] px-5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-emerald-400">실제 API 연동 (장기투자지표 일봉 공유)</span>
          <span aria-hidden="true">·</span>
          <span>Coin Metrics Community PriceUSD (UTC 00:00 종가)</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono-tabular text-slate-500">
            검증 범위 {result.datasetStartDate} ~ {result.datasetEndDate} ({result.totalDailyRows.toLocaleString()}일)
          </span>
        </div>
        <div className="font-mono-tabular text-slate-500">
          {result.liveSpotUsd !== null && (
            <>현재 현물 {fmtUsd(result.liveSpotUsd)} · </>
          )}
          {provenance?.history.fetchedAt
            ? `갱신 ${provenance.history.fetchedAt.replace('T', ' ').slice(0, 19)} UTC`
            : ''}
        </div>
      </div>

      {/* Section 1: Controls & Halving Selector */}
      <section
        id="realtest-controls"
        className="mx-auto w-full max-w-[1440px] px-5 pt-6 pb-6 border-b border-slate-800/80 space-y-5"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight text-slate-50">
              실전테스트
            </h1>
            <p className="mt-1 text-xs text-slate-400 max-w-3xl">
              반감기 사이클 기준 <strong className="text-slate-200">전략 1(현물 +24~36개월 일별 적립식 매수)</strong>과{' '}
              <strong className="text-slate-200">전략 2(반감기 +18개월 1년 만기 5개 행사가 풋옵션 매수)</strong>를 2015년 이후 실제 BTC 일봉 종가로 검증합니다.
            </p>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>데이터 새로고침</span>
          </button>
        </div>

        {/* Halving Cycle Switcher + Parameter Inputs */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
          <div className="lg:col-span-5 space-y-1.5">
            <div className="text-[11px] text-slate-400">검증 반감기 사이클 선택 (2015+ 일봉 기준)</div>
            <div className="flex flex-wrap gap-2">
              {result.cycles.map((c) => {
                const active = c.schedule.epoch === selectedEpoch;
                return (
                  <button
                    key={c.schedule.epoch}
                    type="button"
                    onClick={() => setSelectedEpoch(c.schedule.epoch)}
                    className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'border-sky-500/70 bg-sky-500/15 text-sky-200'
                        : 'border-slate-800 bg-[#0C121E] text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <span>{c.schedule.cycleLabel}</span>
                    <span className="ml-1.5 font-mono-tabular text-[11px] opacity-80">
                      {c.schedule.halvingDate}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-3 space-y-1.5">
            <label htmlFor="realtest-budget" className="block text-[11px] text-slate-400">
              사이클당 총 투자 예정 금액 (USDT)
            </label>
            <input
              id="realtest-budget"
              type="number"
              min={100}
              step={1000}
              value={inputs.totalBudgetUsd}
              onChange={(e) => onChangeBudget(Number(e.target.value))}
              className="w-full rounded-md border border-slate-700 bg-[#0C121E] px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div className="lg:col-span-2 space-y-1.5">
            <label htmlFor="realtest-fee" className="block text-[11px] text-slate-400">
              현물 거래 수수료 (%)
            </label>
            <input
              id="realtest-fee"
              type="number"
              min={0}
              max={5}
              step={0.01}
              value={inputs.feeRatePct}
              onChange={(e) => onChangeFee(Number(e.target.value))}
              className="w-full rounded-md border border-slate-700 bg-[#0C121E] px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div className="lg:col-span-2 space-y-1.5">
            <div className="text-[11px] text-slate-400">무위험 이자율 · IV 모델</div>
            <div className="rounded-md border border-slate-800 bg-[#0A0F1A] px-3 py-2 text-xs font-mono-tabular text-slate-300">
              r = 4.00% 고정 · IV = RV
            </div>
          </div>
        </div>

        {/* Cycle Exact Schedule Timeline Strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-1 text-xs">
          <div className="border border-slate-800/80 bg-[#0A0F1A] rounded px-3 py-2">
            <div className="text-[11px] text-slate-500">반감기 기준일</div>
            <div className="font-mono-tabular text-slate-200 mt-0.5">
              {schedule.halvingDate} <span className="text-slate-500">(#{schedule.blockHeight.toLocaleString()})</span>
            </div>
          </div>
          <div className="border border-slate-800/80 bg-[#0A0F1A] rounded px-3 py-2">
            <div className="text-[11px] text-amber-400/90">전략 2 풋옵션 진입 (+18M)</div>
            <div className="font-mono-tabular text-slate-200 mt-0.5">{schedule.optionEntryDate} UTC</div>
          </div>
          <div className="border border-slate-800/80 bg-[#0A0F1A] rounded px-3 py-2">
            <div className="text-[11px] text-violet-300/90">전략 2 풋옵션 만기 (+365d)</div>
            <div className="font-mono-tabular text-slate-200 mt-0.5">{schedule.optionExpiryDate} UTC</div>
          </div>
          <div className="border border-slate-800/80 bg-[#0A0F1A] rounded px-3 py-2">
            <div className="text-[11px] text-sky-400/90">전략 1 현물 매수 개시 (+24M)</div>
            <div className="font-mono-tabular text-slate-200 mt-0.5">{schedule.dcaStartDate} UTC</div>
          </div>
          <div className="border border-slate-800/80 bg-[#0A0F1A] rounded px-3 py-2">
            <div className="text-[11px] text-sky-400/90">전략 1 매수 종료 (+36M)</div>
            <div className="font-mono-tabular text-slate-200 mt-0.5">
              {schedule.dcaLastScheduledBuyDate} ({schedule.totalScheduledDays}일)
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Strategy 1 — Spot DCA (+24~36M) */}
      <section
        id="realtest-spot"
        className="mx-auto w-full max-w-[1440px] px-5 pt-7 pb-8 border-b border-slate-800/80 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              전략 1 · {schedule.cycleLabel} 이후 24~36개월 일별 동일금액 현물 적립식 매수
            </h2>
            <p className="mt-0.5 text-xs text-slate-400 font-mono-tabular">
              {spotDca.executionRuleLabel} · 매수 구간 {schedule.dcaStartDate} ~ {schedule.dcaLastScheduledBuyDate}
            </p>
          </div>
          <div className="text-xs font-mono-tabular text-slate-300 border border-slate-800 bg-[#0C121E] px-3 py-1.5 rounded-md">
            상태: <strong className={spotDca.status === 'ongoing' ? 'text-amber-300' : 'text-emerald-400'}>{spotDca.statusLabel}</strong>
            {' '}· 집행 {spotDca.executedDays}/{spotDca.scheduledDays}일 ({spotDca.progressPct.toFixed(1)}%)
          </div>
        </div>

        {/* Ongoing Progress Bar */}
        {spotDca.status === 'ongoing' && (
          <div className="border border-amber-500/30 bg-amber-500/5 rounded-md px-4 py-3 space-y-1.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 text-amber-200">
              <span>
                현재 진행 중인 매집 사이클입니다. 미도래 일자의 예정 현금은 누적 투자금에 포함하지 않으며, 실제 경과일({spotDca.executedDays}일)만 반영했습니다.
              </span>
              <span className="font-mono-tabular">
                잔여 예정일 {spotDca.remainingDays}일
              </span>
            </div>
            <div className="h-1.5 w-full rounded bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-amber-400 transition-all"
                style={{ width: `${Math.min(100, spotDca.progressPct)}%` }}
              />
            </div>
          </div>
        )}

        {/* Strategy 1 Required 12 KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCell
            label="예정 총 투자 예산"
            value={fmtUsd(spotDca.plannedTotalBudgetUsd)}
            sub={`예정 매수일 ${spotDca.scheduledDays}일`}
          />
          <KpiCell
            label="일일 투자 금액 (총액/D)"
            value={fmtUsd(spotDca.dailyInvestmentGrossUsd, 2)}
            sub={`수수료 ${spotDca.feeRatePct.toFixed(2)}% 반영`}
          />
          <KpiCell
            label="실제 누적 투자 원금"
            value={fmtUsd(spotDca.totalInvestedUsd)}
            sub={`체결 ${spotDca.executedDays}일 · 수수료 ${fmtUsd(spotDca.totalFeeUsd)}`}
          />
          <KpiCell
            label="총 매수 BTC 수량"
            value={fmtBtc(spotDca.totalBtc, 6)}
            sub="전략 2 사후 정규화 기준 Q"
            tone="accent"
          />
          <KpiCell
            label="평균 매수 단가"
            value={fmtUsd(spotDca.averageEntryPriceUsd)}
            sub="UTC 00:00 종가 기준"
          />
          <KpiCell
            label="평가 기준가 (현물)"
            value={fmtUsd(spotDca.evaluationPriceUsd)}
            sub={
              spotDca.evaluationPriceSource === 'live_spot'
                ? '실시간 현물 지수'
                : `${spotDca.evaluationDate ?? ''} 일봉 종가`
            }
          />
          <KpiCell
            label="현재 포트폴리오 평가금"
            value={fmtUsd(spotDca.portfolioValueUsd)}
            sub={
              spotDca.valueAtWindowEndUsd !== null
                ? `구간종료일(${schedule.dcaLastScheduledBuyDate}) ${fmtUsd(spotDca.valueAtWindowEndUsd)}`
                : undefined
            }
          />
          <KpiCell
            label="미실현 순손익"
            value={fmtSignedUsd(spotDca.netProfitUsd)}
            tone={spotDca.netProfitUsd >= 0 ? 'positive' : 'negative'}
          />
          <KpiCell
            label="현물 누적 수익률 (ROI)"
            value={fmtPct(spotDca.roiPct, true)}
            tone={
              spotDca.roiPct === null
                ? 'neutral'
                : spotDca.roiPct >= 0
                  ? 'positive'
                  : 'negative'
            }
          />
          <KpiCell
            label="집행 완료일 / 잔여일"
            value={`${spotDca.executedDays}일 / ${spotDca.remainingDays}일`}
            sub={spotDca.missingDataDays > 0 ? `결측 ${spotDca.missingDataDays}일` : '결측 없음'}
          />
          <KpiCell
            label="진행률"
            value={`${spotDca.progressPct.toFixed(1)}%`}
            sub={spotDca.statusLabel}
          />
          <KpiCell
            label="매수 체결 규칙"
            value="UTC 00:00 종가"
            sub="매수만 집행 · 매도 없음"
          />
        </div>

        {/* Strategy 1 Charts */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div className="border border-slate-800/80 bg-[#0C121E] rounded-md p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">사이클 BTC 일봉 가격 및 +24~36M 매수 구간</span>
              <span className="text-slate-500 font-mono-tabular">하늘색 음영: 적립식 매수 구간</span>
            </div>
            <SpotDcaPriceWindowChart cycle={selectedCycle} />
          </div>

          <div className="border border-slate-800/80 bg-[#0C121E] rounded-md p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">누적 투자원금 대비 평가금액 · 누적 BTC 수량 추이</span>
              <span className="text-slate-500 font-mono-tabular">단위: USD / BTC</span>
            </div>
            <SpotDcaEquityChart cycle={selectedCycle} />
          </div>
        </div>

        {/* Daily Executions Preview Table */}
        {spotDca.executions.length > 0 && (
          <div className="border border-slate-800/80 bg-[#0C121E] rounded-md overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">
                일별 매수 체결 내역 ({showAllLedgerRows ? `전체 ${spotDca.executions.length}일` : '최근 14일'})
              </span>
              <button
                type="button"
                onClick={() => setShowAllLedgerRows((v) => !v)}
                className="text-sky-400 hover:text-sky-300 cursor-pointer whitespace-nowrap shrink-0"
              >
                {showAllLedgerRows ? '최근 14일만 보기' : `전체 ${spotDca.executions.length}일 펼치기`}
              </button>
            </div>
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs font-mono-tabular">
                <thead className="bg-[#090D16] text-slate-400 border-b border-slate-800 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 font-medium">회차</th>
                    <th className="px-3 py-2 font-medium">체결일 (UTC)</th>
                    <th className="px-3 py-2 font-medium text-right">일봉 종가</th>
                    <th className="px-3 py-2 font-medium text-right">일일 투자금</th>
                    <th className="px-3 py-2 font-medium text-right">수수료</th>
                    <th className="px-3 py-2 font-medium text-right">매수 BTC</th>
                    <th className="px-3 py-2 font-medium text-right">누적 BTC</th>
                    <th className="px-3 py-2 font-medium text-right">누적 평단가</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {ledgerRows.map((row) => (
                    <tr key={row.date} className="hover:bg-slate-800/30">
                      <td className="px-3 py-1.5 text-slate-500">#{row.dayIndex}</td>
                      <td className="px-3 py-1.5">{row.date}</td>
                      <td className="px-3 py-1.5 text-right">{fmtUsd(row.priceUsd)}</td>
                      <td className="px-3 py-1.5 text-right">{fmtUsd(row.grossInvestedUsd, 2)}</td>
                      <td className="px-3 py-1.5 text-right text-slate-500">{fmtUsd(row.feeUsd, 2)}</td>
                      <td className="px-3 py-1.5 text-right text-sky-300">{row.btcBought.toFixed(6)}</td>
                      <td className="px-3 py-1.5 text-right text-amber-300">{row.cumulativeBtc.toFixed(6)}</td>
                      <td className="px-3 py-1.5 text-right">{fmtUsd(row.averageEntryPriceUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Section 3: Strategy 2 — 18M 1Y 5-Strike Put Option */}
      <section
        id="realtest-options"
        className="mx-auto w-full max-w-[1440px] px-5 pt-7 pb-8 border-b border-slate-800/80 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              전략 2 · {schedule.cycleLabel} +18개월 시점 1년 만기 5개 행사가 풋옵션 매수
            </h2>
            <p className="mt-0.5 text-xs text-slate-400 font-mono-tabular">
              진입일 {putOption.entryDate} → 만기일 {putOption.expiryDate} (365일 만기 보유) · 무위험 이자율 r = 4.00% 고정 · IV = 직전 30일 일간 RV
            </p>
          </div>
          <div className="text-xs font-mono-tabular text-slate-300 border border-slate-800 bg-[#0C121E] px-3 py-1.5 rounded-md">
            상태:{' '}
            <strong
              className={
                putOption.status === 'completed'
                  ? 'text-emerald-400'
                  : putOption.status === 'unmatured'
                    ? 'text-amber-300'
                    : 'text-rose-400'
              }
            >
              {putOption.statusLabel}
            </strong>
          </div>
        </div>

        {/* Explicit Ex-Post Normalized Quantity Notice */}
        <div className="border border-violet-500/30 bg-violet-500/5 rounded-md px-4 py-3 text-xs text-violet-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <strong className="text-violet-100">사후 정규화 수량 안내:</strong> {putOption.exPostQuantityNote}
            {spotDca.status === 'ongoing' && (
              <span className="ml-1 text-amber-200">
                (2024 사이클 전략 1이 진행 중이므로 현재 누적 {fmtBtc(spotDca.totalBtc, 4)} 기준)
              </span>
            )}
          </div>
          <span className="font-mono-tabular text-violet-300">
            행사가당 수량 Q/5 = {fmtBtc(putOption.totalContractQtyBtc / 5, 6)}
          </span>
        </div>

        {/* Strategy 2 KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCell
            label="옵션 진입일 (+18M)"
            value={putOption.entryDate}
            sub={`만기일 ${putOption.expiryDate}`}
          />
          <KpiCell
            label="진입일 BTC 종가 (S)"
            value={fmtUsd(putOption.entrySpotUsd)}
            sub="UTC 00:00 종가"
          />
          <KpiCell
            label="만기일 BTC 종가 (ST)"
            value={putOption.status === 'completed' ? fmtUsd(putOption.expirySpotUsd) : putOption.statusLabel}
            sub={
              putOption.status === 'completed' && putOption.entrySpotUsd && putOption.expirySpotUsd
                ? `진입 대비 ${fmtPct(((putOption.expirySpotUsd - putOption.entrySpotUsd) / putOption.entrySpotUsd) * 100, true)}`
                : undefined
            }
          />
          <KpiCell
            label="직전 30일 일간 RV (연율)"
            value={putOption.rv30dAnnualized !== null ? fmtPct(putOption.rv30dAnnualized * 100) : '미계산'}
            sub="ddof=1 · √365 · 미래참조 없음"
          />
          <KpiCell
            label="적용 내재변동성 (IV)"
            value={putOption.ivAnnualized !== null ? fmtPct(putOption.ivAnnualized * 100) : '미계산'}
            sub="IV = RV · r = 4.00% · q = 0%"
          />
          <KpiCell
            label="총 계약 수량 Q (사후 정규화)"
            value={fmtBtc(putOption.totalContractQtyBtc, 6)}
            sub={`5개 행사가 동일 수량 (각 Q/5)`}
            tone="accent"
          />
          <KpiCell
            label="총 옵션 프리미엄 지불액"
            value={fmtUsd(putOption.totalPremiumUsd, 2)}
            sub="Black-Scholes 이론가 합계"
          />
          <KpiCell
            label="만기 총 페이오프"
            value={putOption.status === 'completed' ? fmtUsd(putOption.totalPayoffUsd, 2) : putOption.statusLabel}
          />
          <KpiCell
            label="풋옵션 만기 순손익"
            value={putOption.status === 'completed' ? fmtSignedUsd(putOption.netProfitUsd) : putOption.statusLabel}
            tone={
              putOption.netProfitUsd === null
                ? 'neutral'
                : putOption.netProfitUsd >= 0
                  ? 'positive'
                  : 'negative'
            }
          />
          <KpiCell
            label="풋옵션 수익률 (ROI)"
            value={putOption.status === 'completed' ? fmtPct(putOption.roiPct, true) : putOption.statusLabel}
            tone={
              putOption.roiPct === null
                ? 'neutral'
                : putOption.roiPct >= 0
                  ? 'positive'
                  : 'negative'
            }
          />
        </div>

        {/* 5-Strike Breakdown Table */}
        {putOption.strikes.length > 0 && (
          <div className="border border-slate-800/80 bg-[#0C121E] rounded-md overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-200">
                5개 행사가별 계약 명세 (K = S · exp(-j · RV · √T / 4), 동일 BTC 수량 Q/5 배분)
              </span>
              <span className="text-slate-500 font-mono-tabular">유럽형 풋옵션 · 만기 T = 1.00년</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono-tabular">
                <thead className="bg-[#090D16] text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-3 py-2 font-medium">행사가 구분</th>
                    <th className="px-3 py-2 font-medium text-right">행사가 K (USD)</th>
                    <th className="px-3 py-2 font-medium text-right">계약 수량 (BTC)</th>
                    <th className="px-3 py-2 font-medium text-right">1 BTC당 이론가</th>
                    <th className="px-3 py-2 font-medium text-right">지급 프리미엄</th>
                    <th className="px-3 py-2 font-medium text-right">만기 페이오프</th>
                    <th className="px-3 py-2 font-medium text-right">순손익</th>
                    <th className="px-3 py-2 font-medium text-right">ROI</th>
                    <th className="px-3 py-2 font-medium text-right">만기 상태</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {putOption.strikes.map((s) => (
                    <tr key={s.strikeIndex} className="hover:bg-slate-800/30">
                      <td className="px-3 py-2 font-sans font-medium text-slate-100">{s.label}</td>
                      <td className="px-3 py-2 text-right">{fmtUsd(s.strikePriceUsd)}</td>
                      <td className="px-3 py-2 text-right text-sky-300">{s.contractQtyBtc.toFixed(6)}</td>
                      <td className="px-3 py-2 text-right">{fmtUsd(s.unitPutPriceUsd, 2)}</td>
                      <td className="px-3 py-2 text-right text-amber-300">{fmtUsd(s.premiumUsd, 2)}</td>
                      <td className="px-3 py-2 text-right">
                        {s.expiryPayoffUsd !== null ? fmtUsd(s.expiryPayoffUsd, 2) : putOption.statusLabel}
                      </td>
                      <td
                        className={`px-3 py-2 text-right ${
                          s.netProfitUsd === null
                            ? 'text-slate-500'
                            : s.netProfitUsd >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                        }`}
                      >
                        {s.netProfitUsd !== null ? fmtSignedUsd(s.netProfitUsd) : '—'}
                      </td>
                      <td
                        className={`px-3 py-2 text-right ${
                          s.roiPct === null
                            ? 'text-slate-500'
                            : s.roiPct >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                        }`}
                      >
                        {s.roiPct !== null ? fmtPct(s.roiPct, true, 1) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {s.finishedItm === null ? (
                          <span className="text-slate-500">{putOption.statusLabel}</span>
                        ) : s.finishedItm ? (
                          <span className="text-emerald-400">ITM (행사)</span>
                        ) : (
                          <span className="text-slate-500">OTM (소멸)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Strategy 2 Charts */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div className="border border-slate-800/80 bg-[#0C121E] rounded-md p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">5개 풋옵션 합산 만기 Payoff 곡선</span>
              <span className="text-slate-500 font-mono-tabular">만기 BTC 가격별 순손익</span>
            </div>
            <PutPayoffCurveChart cycle={selectedCycle} />
          </div>

          <div className="border border-slate-800/80 bg-[#0C121E] rounded-md p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">행사가별 프리미엄 지불액 vs 만기 페이오프</span>
              <span className="text-slate-500 font-mono-tabular">단위: USD</span>
            </div>
            <PutStrikeBarsChart cycle={selectedCycle} />
          </div>
        </div>
      </section>

      {/* Section 4: Integrated Spot + Put Comparison across Cycles */}
      <section
        id="realtest-comparison"
        className="mx-auto w-full max-w-[1440px] px-5 pt-7 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              통합 비교 · 현물 적립식(전략 1) + 풋옵션(전략 2) 사이클별 성과 요약
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              모든 풋옵션 성과는 동일 사이클 전략 1 누적 BTC(Q)를 적용한 <strong className="text-slate-200">사후 정규화 수량</strong> 기준이며, 현물 평가금은 최신 현물가 기준 보유 가치입니다.
            </p>
          </div>
        </div>

        {/* Selected Cycle Side-by-Side KPI Strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCell
            label={`${schedule.cycleLabel} 통합 투입원금`}
            value={fmtUsd(integrated.combinedCostBasisUsd)}
            sub="현물 투자금 + 옵션 프리미엄"
          />
          <KpiCell
            label="전략 1 (현물) 기여 손익"
            value={fmtSignedUsd(integrated.spotContributionUsd)}
            tone={integrated.spotContributionUsd >= 0 ? 'positive' : 'negative'}
          />
          <KpiCell
            label="전략 2 (풋옵션) 기여 손익"
            value={
              integrated.optionContributionUsd !== null
                ? fmtSignedUsd(integrated.optionContributionUsd)
                : putOption.statusLabel
            }
            tone={
              integrated.optionContributionUsd === null
                ? 'neutral'
                : integrated.optionContributionUsd >= 0
                  ? 'positive'
                  : 'negative'
            }
          />
          <KpiCell
            label="현물 + 옵션 통합 순손익"
            value={
              integrated.combinedNetProfitUsd !== null
                ? fmtSignedUsd(integrated.combinedNetProfitUsd)
                : '옵션 미확정'
            }
            tone={
              integrated.combinedNetProfitUsd === null
                ? 'neutral'
                : integrated.combinedNetProfitUsd >= 0
                  ? 'positive'
                  : 'negative'
            }
          />
          <KpiCell
            label="통합 수익률 (ROI)"
            value={
              integrated.combinedRoiPct !== null ? fmtPct(integrated.combinedRoiPct, true) : '옵션 미확정'
            }
            tone={
              integrated.combinedRoiPct === null
                ? 'neutral'
                : integrated.combinedRoiPct >= 0
                  ? 'positive'
                  : 'negative'
            }
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <div className="xl:col-span-5 border border-slate-800/80 bg-[#0C121E] rounded-md p-4 space-y-2">
            <div className="text-xs font-semibold text-slate-200">
              전체 반감기 사이클 손익 비교 (2016 · 2020 · 2024)
            </div>
            <IntegratedCycleComparisonChart cycles={result.cycles} />
          </div>

          <div className="xl:col-span-7 border border-slate-800/80 bg-[#0C121E] rounded-md overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-800 text-xs font-semibold text-slate-200">
              반감기 사이클별 전략 1 · 전략 2 · 통합 성과 테이블
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono-tabular">
                <thead className="bg-[#090D16] text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-3 py-2 font-medium">사이클</th>
                    <th className="px-3 py-2 font-medium text-right">현물 투자금</th>
                    <th className="px-3 py-2 font-medium text-right">누적 BTC (Q)</th>
                    <th className="px-3 py-2 font-medium text-right">현물 순손익 (ROI)</th>
                    <th className="px-3 py-2 font-medium text-right">옵션 프리미엄</th>
                    <th className="px-3 py-2 font-medium text-right">옵션 순손익 (ROI)</th>
                    <th className="px-3 py-2 font-medium text-right">통합 순손익 (ROI)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {result.cycles.map((c) => (
                    <tr
                      key={c.schedule.epoch}
                      onClick={() => setSelectedEpoch(c.schedule.epoch)}
                      className={`cursor-pointer hover:bg-slate-800/40 ${
                        c.schedule.epoch === selectedEpoch ? 'bg-sky-500/10' : ''
                      }`}
                    >
                      <td className="px-3 py-2.5 font-sans">
                        <div className="font-medium text-slate-100">{c.schedule.cycleLabel}</div>
                        <div className="text-[11px] text-slate-500 font-mono-tabular">
                          {c.spotDca.statusLabel} · {c.putOption.statusLabel}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">{fmtUsd(c.spotDca.totalInvestedUsd)}</td>
                      <td className="px-3 py-2.5 text-right text-sky-300">{c.spotDca.totalBtc.toFixed(4)}</td>
                      <td
                        className={`px-3 py-2.5 text-right ${
                          c.spotDca.netProfitUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        <div>{fmtSignedUsd(c.spotDca.netProfitUsd)}</div>
                        <div className="text-[11px] opacity-80">{fmtPct(c.spotDca.roiPct, true, 1)}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right text-amber-300">
                        {fmtUsd(c.putOption.totalPremiumUsd)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right ${
                          c.putOption.netProfitUsd === null
                            ? 'text-slate-500'
                            : c.putOption.netProfitUsd >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                        }`}
                      >
                        {c.putOption.status === 'completed' ? (
                          <>
                            <div>{fmtSignedUsd(c.putOption.netProfitUsd)}</div>
                            <div className="text-[11px] opacity-80">{fmtPct(c.putOption.roiPct, true, 1)}</div>
                          </>
                        ) : (
                          <span>{c.putOption.statusLabel}</span>
                        )}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right ${
                          c.integrated.combinedNetProfitUsd === null
                            ? 'text-slate-500'
                            : c.integrated.combinedNetProfitUsd >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                        }`}
                      >
                        {c.integrated.combinedNetProfitUsd !== null ? (
                          <>
                            <div>{fmtSignedUsd(c.integrated.combinedNetProfitUsd)}</div>
                            <div className="text-[11px] opacity-80">
                              {fmtPct(c.integrated.combinedRoiPct, true, 1)}
                            </div>
                          </>
                        ) : (
                          <span>미확정</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Architecture / Methodology Anchor */}
      <section
        id="architecture"
        className="mx-auto w-full max-w-[1440px] px-5 mt-8 border-t border-slate-800/80 pt-6 grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-slate-400"
      >
        <div>
          <h3 className="text-sm font-semibold text-slate-200 mb-1.5">데이터 소스 재사용 원칙</h3>
          <p className="leading-relaxed">
            장기투자지표 탭이 사용하는 `/api/long-term/history` Coin Metrics 일봉 시계열(2015-01-01~현재 UTC 종가)과 클라이언트·서버 캐시를 그대로 공유하여 불필요한 API 재요청을 발생시키지 않습니다.
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-200 mb-1.5">실현변동성 및 Black-Scholes 정합성</h3>
          <p className="leading-relaxed">
            옵션 진입일(+18M) 이전 30개 일간 로그수익률의 표본표준편차(ddof=1)에 √365를 곱해 연율화 RV를 산출하며 미래 데이터를 일절 참조하지 않습니다. r=4.00%, q=0, T=1, IV=RV를 적용합니다.
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-200 mb-1.5">사후 정규화 수량 및 미도래 처리</h3>
          <p className="leading-relaxed">
            전략 2의 총 계약 수량 Q는 동일 사이클 전략 1 최종 누적 BTC를 사후 정규화하여 적용합니다. 진행 중 DCA는 경과일만 합산하고 미도래 풋옵션은 만기 미도래로 표시합니다.
          </p>
        </div>
      </section>
    </div>
  );
};
