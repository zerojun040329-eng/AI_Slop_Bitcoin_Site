import React, { useState } from 'react';
import {
  INDICATOR_DEFINITIONS,
  type SignalAnalysisResponse,
  type SimilarityMatch,
} from '../../types/signalAnalysis';

interface SignalAuditTabsProps {
  analysis: SignalAnalysisResponse;
  selectedMatchRank: number | null;
  onSelectMatch: (match: SimilarityMatch) => void;
}

type AuditTabId = 'matches' | 'independence' | 'dedup_regime' | 'ablation';
type MatrixKind = 'pearson' | 'spearman' | 'mi';

function fmtPct(v: number | null, digits = 2): string {
  if (v === null || !Number.isFinite(v)) return 'N/A';
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

export const SignalAuditTabs: React.FC<SignalAuditTabsProps> = ({
  analysis,
  selectedMatchRank,
  onSelectMatch,
}) => {
  const [activeTab, setActiveTab] = useState<AuditTabId>('matches');
  const [matrixKind, setMatrixKind] = useState<MatrixKind>('pearson');

  const { independence, clustering, dedupVsRawComparison, matches, regimeComparison, ablationResults } =
    analysis;

  const activeMatrix =
    matrixKind === 'pearson'
      ? independence.pearsonMatrix
      : matrixKind === 'spearman'
        ? independence.spearmanMatrix
        : independence.mutualInfoMatrix;

  return (
    <section
      id="quant-audits"
      className="mx-auto w-full max-w-[1440px] px-5 py-6 space-y-4"
    >
      {/* Tab Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-2">
        <div className="flex items-center gap-6 overflow-x-auto text-xs font-medium">
          {(
            [
              ['matches', `유사 매치 목록 (${matches.length})`],
              ['independence', '지표 독립성·상관행렬'],
              ['dedup_regime', '중복제거·체제 비교'],
              ['ablation', `지표 영향력 Ablation (${ablationResults.length})`],
            ] as Array<[AuditTabId, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`pb-2 -mb-2.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === id
                  ? 'border-sky-400 text-slate-50 font-semibold'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="text-[11px] font-mono-tabular text-slate-500">
          서버 연산 {analysis.computedInMs}ms · 정렬 표본 {independence.sampleCount.toLocaleString()}봉
        </div>
      </div>

      {/* Tab 1: Matches Table */}
      {activeTab === 'matches' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span>
              거리가 가장 가까운 상위 {matches.length}건의 독립 유사 구간입니다 (최소 간격 {clustering.minGapHours}시간 보장). 행을 클릭하면 위 차트 우측 패널에서 -1h~+24h 경로를 검사합니다.
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#0C121E] max-h-[420px]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-[#090D16] z-10 border-b border-slate-800 text-[11px] text-slate-400">
                <tr>
                  <th className="px-3 py-2.5">#</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">발생 시각 (UTC)</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">종가 (USDT)</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">마할라노비스</th>
                  <th className="px-3 py-2.5 text-right whitespace-nowrap">유클리드</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">시장 체제</th>
                  <th className="px-3 py-2.5 text-right">30m</th>
                  <th className="px-3 py-2.5 text-right">1h</th>
                  <th className="px-3 py-2.5 text-right">3h</th>
                  <th className="px-3 py-2.5 text-right">6h</th>
                  <th className="px-3 py-2.5 text-right">12h</th>
                  <th className="px-3 py-2.5 text-right">24h</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono-tabular">
                {matches.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-10 text-center font-sans text-slate-500">
                      선택한 거리 임계값({analysis.request.threshold}) 및 체제 조건을 충족하는 과거 매치가 없습니다. 임계값을 높이거나 체제 필터를 완화해 주세요.
                    </td>
                  </tr>
                ) : (
                  matches.map((m) => {
                    const selected = m.matchRank === selectedMatchRank;
                    return (
                      <tr
                        key={m.index}
                        onClick={() => onSelectMatch(m)}
                        className={`cursor-pointer transition-colors ${
                          selected ? 'bg-sky-500/15' : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="px-3 py-2 text-slate-400">{m.matchRank}</td>
                        <td className="px-3 py-2 text-slate-200 whitespace-nowrap">
                          {new Date(m.openTimeMs).toISOString().replace('T', ' ').slice(0, 16)}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-200 whitespace-nowrap">
                          ${m.closePrice.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                        </td>
                        <td className="px-3 py-2 text-right text-sky-300">
                          {m.mahalanobisDistance.toFixed(3)}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-400">
                          {m.euclideanDistance.toFixed(3)}
                        </td>
                        <td className="px-3 py-2 font-sans text-slate-300 whitespace-nowrap">
                          {m.regimeLabel}
                        </td>
                        {(['30m', '1h', '3h', '6h', '12h', '24h'] as const).map((hk) => {
                          const v = m.forwardReturnsPct[hk];
                          return (
                            <td
                              key={hk}
                              className={`px-3 py-2 text-right whitespace-nowrap ${
                                v === null
                                  ? 'text-slate-600'
                                  : v >= 0
                                    ? 'text-emerald-400'
                                    : 'text-rose-400'
                              }`}
                            >
                              {fmtPct(v)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Independence, Correlation Matrix & Temporal Stability */}
      {activeTab === 'independence' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-800 bg-[#0C121E] p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-100">
                지표 중복성 감사 요약 (상관계수 임계 기준 |r| ≥ {independence.redundancyThreshold.toFixed(2)})
              </div>
              <p className="text-xs text-slate-300">{independence.summaryNote}</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              {(
                [
                  ['pearson', 'Pearson r'],
                  ['spearman', 'Spearman ρ'],
                  ['mi', '상호정보량 MI (bits)'],
                ] as Array<[MatrixKind, string]>
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setMatrixKind(k)}
                  className={`px-2.5 py-1 rounded border text-[11px] cursor-pointer transition-colors ${
                    matrixKind === k
                      ? 'border-sky-500/50 bg-sky-500/20 text-sky-300 font-medium'
                      : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#0C121E]">
            <table className="w-full text-center text-[11px] border-collapse font-mono-tabular">
              <thead>
                <tr className="border-b border-slate-800 bg-[#090D16]/70 text-slate-400">
                  <th className="px-3 py-2 text-left font-sans">지표</th>
                  {independence.ids.map((id) => (
                    <th key={id} className="px-2 py-2 whitespace-nowrap">
                      {INDICATOR_DEFINITIONS[id].shortLabel}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {independence.ids.map((rowId, rIdx) => (
                  <tr key={rowId}>
                    <td className="px-3 py-2 text-left font-sans font-medium text-slate-200 whitespace-nowrap">
                      {INDICATOR_DEFINITIONS[rowId].shortLabel}
                    </td>
                    {independence.ids.map((colId, cIdx) => {
                      const val = activeMatrix[rIdx][cIdx];
                      const isDiag = rIdx === cIdx;
                      const isHighRedundant =
                        !isDiag && matrixKind !== 'mi' && Math.abs(val) >= independence.redundancyThreshold;
                      const bgOpacity = isDiag
                        ? 0.08
                        : matrixKind === 'mi'
                          ? Math.min(0.45, val * 0.25)
                          : Math.min(0.45, Math.abs(val) * 0.45);
                      const bgColor = isHighRedundant
                        ? `rgba(244, 63, 94, ${bgOpacity})`
                        : val >= 0
                          ? `rgba(56, 189, 248, ${bgOpacity})`
                          : `rgba(245, 158, 11, ${bgOpacity})`;

                      return (
                        <td
                          key={colId}
                          style={{ backgroundColor: bgColor }}
                          className={`px-2 py-2 ${
                            isDiag
                              ? 'text-slate-500'
                              : isHighRedundant
                                ? 'text-rose-200 font-semibold'
                                : 'text-slate-200'
                          }`}
                        >
                          {val.toFixed(3)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Temporal Stability & Exclusion Audit Table */}
          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#0C121E]">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-[#090D16]/70 text-[11px] text-slate-400">
                  <th className="px-3 py-2">지표</th>
                  <th className="px-3 py-2 text-right">유효 봉수</th>
                  <th className="px-3 py-2 text-right">전반기 평균 (Z)</th>
                  <th className="px-3 py-2 text-right">후반기 평균 (Z)</th>
                  <th className="px-3 py-2 text-right">분포 안정성 (PSI)</th>
                  <th className="px-3 py-2">독립성 판정</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono-tabular">
                {independence.stability.map((st) => (
                  <tr key={st.id} className="hover:bg-slate-800/30">
                    <td className="px-3 py-2 font-sans font-medium text-slate-200 whitespace-nowrap">
                      {INDICATOR_DEFINITIONS[st.id].shortLabel}{' '}
                      <span className="text-[11px] text-slate-500">{INDICATOR_DEFINITIONS[st.id].koreanName}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">
                      {st.validCount.toLocaleString()}
                      {st.nullCount > 0 && <span className="text-slate-500"> (null {st.nullCount})</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">{st.firstHalfMean.toFixed(3)}</td>
                    <td className="px-3 py-2 text-right text-slate-300">{st.secondHalfMean.toFixed(3)}</td>
                    <td
                      className={`px-3 py-2 text-right ${
                        st.psiDrift >= 0.25
                          ? 'text-rose-400'
                          : st.psiDrift >= 0.1
                            ? 'text-amber-300'
                            : 'text-emerald-400'
                      }`}
                    >
                      {st.psiDrift.toFixed(4)}
                    </td>
                    <td className="px-3 py-2 font-sans text-xs">
                      {st.isRedundantExcluded ? (
                        <span className="text-amber-300">제외 권고 — {st.exclusionReason}</span>
                      ) : (
                        <span className="text-emerald-400">독립 채택 (기본 상태 벡터 포함)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Deduplication vs Raw & Regime Comparison */}
      {activeTab === 'dedup_regime' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Dedup Audit */}
          <div className="rounded-lg border border-slate-800 bg-[#0C121E] p-4 space-y-3">
            <h3 className="text-xs font-semibold text-slate-100">
              시간적 중복 제거 전·후 비교 ({dedupVsRawComparison.horizon} 기준)
            </h3>
            <p className="text-xs text-slate-400">{clustering.clusterRiskNote}</p>

            <div className="grid grid-cols-2 gap-3 text-xs font-mono-tabular">
              <div className="rounded border border-slate-800 bg-[#090D16] p-3 space-y-1">
                <div className="font-sans text-[11px] text-slate-400">중복 제거 전 (원시 후보)</div>
                <div className="text-base font-semibold text-slate-200">
                  {dedupVsRawComparison.rawCount.toLocaleString()}건
                </div>
                <div className="text-[11px] text-slate-400">
                  평균 {fmtPct(dedupVsRawComparison.rawMeanPct, 3)} · 승률{' '}
                  {dedupVsRawComparison.rawWinRatePct !== null
                    ? `${dedupVsRawComparison.rawWinRatePct.toFixed(1)}%`
                    : 'N/A'}
                </div>
              </div>
              <div className="rounded border border-sky-500/30 bg-sky-950/20 p-3 space-y-1">
                <div className="font-sans text-[11px] text-sky-300">
                  중복 제거 후 (최소 {clustering.minGapHours}h 간격)
                </div>
                <div className="text-base font-semibold text-slate-50">
                  {dedupVsRawComparison.dedupCount.toLocaleString()}건
                </div>
                <div className="text-[11px] text-slate-300">
                  평균 {fmtPct(dedupVsRawComparison.dedupMeanPct, 3)} · 승률{' '}
                  {dedupVsRawComparison.dedupWinRatePct !== null
                    ? `${dedupVsRawComparison.dedupWinRatePct.toFixed(1)}%`
                    : 'N/A'}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto border-t border-slate-800 pt-2">
              <table className="w-full text-xs font-mono-tabular">
                <thead>
                  <tr className="text-[11px] text-slate-400 border-b border-slate-800">
                    <th className="py-1.5 text-left font-sans">연도</th>
                    <th className="py-1.5 text-right">원시 후보</th>
                    <th className="py-1.5 text-right">독립 매치</th>
                    <th className="py-1.5 text-right">제거 비율</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {clustering.yearlyDistribution.map((yr) => {
                    const dropPct =
                      yr.rawCount > 0 ? ((yr.rawCount - yr.deduplicatedCount) / yr.rawCount) * 100 : 0;
                    return (
                      <tr key={yr.year}>
                        <td className="py-1.5 text-slate-200">{yr.year}</td>
                        <td className="py-1.5 text-right text-slate-400">{yr.rawCount.toLocaleString()}</td>
                        <td className="py-1.5 text-right text-slate-100">{yr.deduplicatedCount.toLocaleString()}</td>
                        <td className="py-1.5 text-right text-slate-400">{dropPct.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Market Regime Breakdown */}
          <div className="rounded-lg border border-slate-800 bg-[#0C121E] p-4 space-y-3">
            <h3 className="text-xs font-semibold text-slate-100">
              시장 체제별 유사 구간 성과 비교 (24h 수익률 기준)
            </h3>
            <p className="text-xs text-slate-400">
              전체 시장 조건과 개별 체제(상승/하락/횡보/고변동성) 내 유사 매치의 24시간 기대 수익률과 95% 신뢰구간을 비교합니다.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                    <th className="py-2 pr-2">체제 구분</th>
                    <th className="py-2 px-2 text-right">독립 매치</th>
                    <th className="py-2 px-2 text-right">24h 평균</th>
                    <th className="py-2 px-2 text-right">24h 승률</th>
                    <th className="py-2 pl-2 text-right">95% CI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 font-mono-tabular">
                  {regimeComparison.map((rc) => (
                    <tr key={rc.regime}>
                      <td className="py-2 pr-2 font-sans font-medium text-slate-200">{rc.label}</td>
                      <td className="py-2 px-2 text-right text-slate-300">{rc.matchCount}</td>
                      <td
                        className={`py-2 px-2 text-right font-semibold ${
                          rc.stats24h.meanReturnPct === null
                            ? 'text-slate-500'
                            : rc.stats24h.meanReturnPct >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                        }`}
                      >
                        {fmtPct(rc.stats24h.meanReturnPct, 3)}
                      </td>
                      <td className="py-2 px-2 text-right text-slate-200">
                        {rc.stats24h.winRatePct !== null ? `${rc.stats24h.winRatePct.toFixed(1)}%` : 'N/A'}
                      </td>
                      <td className="py-2 pl-2 text-right text-slate-400 whitespace-nowrap">
                        {rc.stats24h.ci95LowPct !== null && rc.stats24h.ci95HighPct !== null
                          ? `[${fmtPct(rc.stats24h.ci95LowPct, 2)}, ${fmtPct(rc.stats24h.ci95HighPct, 2)}]`
                          : 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Indicator Ablation Experiments */}
      {activeTab === 'ablation' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            동일한 경험적 선택률(각 부분집합 거리 분포의 중앙 권장 분위수 ~0.5%)을 적용하여 지표 조합별 예측력 변화를 검증합니다. 특정 지표 제외 시 성과가 악화되면 해당 지표가 유효 정보를 기여함을 의미합니다.
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#0C121E]">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-[#090D16]/70 text-[11px] text-slate-400">
                  <th className="px-3 py-2.5">실험 조합</th>
                  <th className="px-3 py-2.5 text-right">지표 수</th>
                  <th className="px-3 py-2.5 text-right">표본 수</th>
                  <th className="px-3 py-2.5 text-right">{analysis.request.ablationHorizon} 평균</th>
                  <th className="px-3 py-2.5 text-right">기준 대비 Δ</th>
                  <th className="px-3 py-2.5 text-right">승률</th>
                  <th className="px-3 py-2.5 text-right">초과 수익</th>
                  <th className="px-3 py-2.5 text-right">95% CI</th>
                  <th className="px-3 py-2.5 text-right">FDR p</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono-tabular">
                {ablationResults.map((exp) => (
                  <tr
                    key={exp.experimentId}
                    className={
                      exp.experimentId === 'baseline_active' ? 'bg-sky-500/10' : 'hover:bg-slate-800/30'
                    }
                  >
                    <td className="px-3 py-2 font-sans font-medium text-slate-200 whitespace-nowrap">
                      {exp.label}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-400">{exp.includedIndicators.length}</td>
                    <td className="px-3 py-2 text-right text-slate-200">{exp.sampleCount}</td>
                    <td
                      className={`px-3 py-2 text-right font-semibold ${
                        exp.meanReturnPct === null
                          ? 'text-slate-500'
                          : exp.meanReturnPct >= 0
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                      }`}
                    >
                      {fmtPct(exp.meanReturnPct, 3)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right ${
                        exp.deltaMeanVsFullPct === null
                          ? 'text-slate-500'
                          : exp.deltaMeanVsFullPct >= 0
                            ? 'text-sky-300'
                            : 'text-amber-300'
                      }`}
                    >
                      {exp.deltaMeanVsFullPct === null ? '—' : fmtPct(exp.deltaMeanVsFullPct, 3)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-200">
                      {exp.winRatePct !== null ? `${exp.winRatePct.toFixed(1)}%` : 'N/A'}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">{fmtPct(exp.excessReturnPct, 3)}</td>
                    <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">
                      {exp.ci95LowPct !== null && exp.ci95HighPct !== null
                        ? `[${fmtPct(exp.ci95LowPct, 2)}, ${fmtPct(exp.ci95HighPct, 2)}]`
                        : 'N/A'}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-300">
                      {exp.fdrPValue !== null ? exp.fdrPValue.toFixed(4) : 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};
