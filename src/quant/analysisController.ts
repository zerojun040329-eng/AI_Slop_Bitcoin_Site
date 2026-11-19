import {
  ALL_INDICATOR_IDS,
  HORIZON_CONFIG,
  INDICATOR_DEFINITIONS,
  type AblationExperimentResult,
  type HorizonKey,
  type IndependenceMatrixReport,
  type IndicatorId,
  type IndicatorValueSnapshot,
  type MarketRegimeId,
  type MarketRegimeInfo,
  type MatchDetailResponse,
  type PriceContextPoint,
  type SignalAnalysisResponse,
  type SignalAnalysisRunRequest,
  type SimilarityMatch,
} from '../types/signalAnalysis.ts';
import type { CandleTypedSeries } from '../../server/services/candleRepository.ts';
import { computeAllRawIndicators, type RawIndicatorMatrix } from './indicatorCalculator.ts';
import { computeCausalNormalization, type NormalizedMatrixBundle } from './normalizationEngine.ts';
import { analyzeIndicatorIndependence } from './independenceAnalyzer.ts';
import { classifyAllRegimes, REGIME_LABELS, REGIME_ORDER, regimeCodeToId } from './regimeAnalyzer.ts';
import { searchSimilarStates } from './similarityEngine.ts';
import { deduplicateTemporalMatches } from './duplicateFilter.ts';
import {
  analyzeHorizonReturns,
  computeForwardReturnPct,
  computeUnconditionalBaselines,
  summarizeSingleHorizonQuick,
} from './returnAnalyzer.ts';

const MIN_TARGET_OFFSET_BARS = 8_640; // At least 30 days (8,640 5m bars) of causal history before target

interface PrecomputedBundle {
  versionKey: string;
  series: CandleTypedSeries;
  raw: RawIndicatorMatrix;
  norm: NormalizedMatrixBundle;
  regimes: Uint8Array;
  regimeSummary: MarketRegimeInfo[];
  independence: IndependenceMatrixReport;
  priceOverviewSeries: PriceContextPoint[];
}

function buildOverviewSeries(series: CandleTypedSeries, targetPoints = 480): PriceContextPoint[] {
  const n = series.count;
  if (n === 0) return [];
  const step = Math.max(1, Math.floor(n / targetPoints));
  const out: PriceContextPoint[] = [];

  for (let i = 0; i < n; i += step) {
    const end = Math.min(n - 1, i + step - 1);
    let hi = -Infinity;
    let lo = Infinity;
    let volSum = 0;
    for (let k = i; k <= end; k++) {
      if (series.high[k] > hi) hi = series.high[k];
      if (series.low[k] < lo) lo = series.low[k];
      volSum += series.volume[k];
    }
    out.push({
      openTimeMs: series.openTimeMs[end],
      close: series.close[end],
      high: hi,
      low: lo,
      volume: volSum,
    });
  }
  return out;
}

function findNearestIndex(openTimeMs: Float64Array, count: number, targetMs: number): number {
  if (count === 0) return -1;
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (openTimeMs[mid] < targetMs) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(openTimeMs[lo - 1] - targetMs) < Math.abs(openTimeMs[lo] - targetMs)) {
    return lo - 1;
  }
  return lo;
}

export class AnalysisController {
  private cached: PrecomputedBundle | null = null;

  invalidate(): void {
    this.cached = null;
  }

  private ensurePrecomputed(series: CandleTypedSeries): PrecomputedBundle {
    const lastMs = series.count > 0 ? series.openTimeMs[series.count - 1] : 0;
    const versionKey = `${series.count}:${lastMs}`;
    if (this.cached && this.cached.versionKey === versionKey) {
      return this.cached;
    }

    const raw = computeAllRawIndicators(series);
    const norm = computeCausalNormalization(raw, series.count);
    const { regimes, regimeSummary } = classifyAllRegimes(series.close, raw, norm, series.count);
    const independence = analyzeIndicatorIndependence(norm, raw);
    const priceOverviewSeries = buildOverviewSeries(series, 480);

    this.cached = {
      versionKey,
      series,
      raw,
      norm,
      regimes,
      regimeSummary,
      independence,
      priceOverviewSeries,
    };
    return this.cached;
  }

  private buildIndicatorSnapshots(bundle: PrecomputedBundle, index: number): IndicatorValueSnapshot[] {
    return ALL_INDICATOR_IDS.map((id) => {
      const r = bundle.raw[id][index];
      const n = bundle.norm.normalized[id][index];
      const p = bundle.norm.causalPercentile[id][index];
      const z = bundle.norm.causalZScore[id][index];
      return {
        id,
        rawValue: Number.isFinite(r) ? r : null,
        normalizedValue: Number.isFinite(n) ? n : null,
        percentileRank: Number.isFinite(p) ? p * 100 : null,
        zScore: Number.isFinite(z) ? z : null,
      };
    });
  }

  runAnalysis(series: CandleTypedSeries, req: SignalAnalysisRunRequest = {}): SignalAnalysisResponse {
    const tStart = Date.now();
    const bundle = this.ensurePrecomputed(series);
    const n = series.count;

    if (n < MIN_TARGET_OFFSET_BARS + 500) {
      throw new Error('4년 5분봉 데이터가 아직 충분히 수집되지 않아 분석을 실행할 수 없습니다.');
    }

    const minTargetIdx = MIN_TARGET_OFFSET_BARS;
    const maxTargetIdx = n - 1;
    const requestedMs = req.targetTimestampMs ?? series.openTimeMs[maxTargetIdx];
    let targetIndex = findNearestIndex(series.openTimeMs, n, requestedMs);
    targetIndex = Math.max(minTargetIdx, Math.min(maxTargetIdx, targetIndex));

    // Find nearest valid bar backwards (up to 12 bars = 1h) if targetIndex has any null normalized indicator
    const defaultSelected =
      req.selectedIndicators && req.selectedIndicators.length > 0
        ? req.selectedIndicators
        : bundle.independence.activeIndicatorIds;

    const validSelected = defaultSelected.filter((id) => ALL_INDICATOR_IDS.includes(id));
    if (validSelected.length === 0) {
      throw new Error('유효한 기술적 지표를 최소 1개 이상 선택해야 합니다.');
    }

    for (let shift = 0; shift <= 12 && targetIndex - shift >= minTargetIdx; shift++) {
      const idx = targetIndex - shift;
      const allOk = validSelected.every((id) => Number.isFinite(bundle.norm.normalized[id][idx]));
      if (allOk) {
        targetIndex = idx;
        break;
      }
    }

    const distanceMetric = req.distanceMetric ?? 'mahalanobis';
    const minGapHours = Math.max(1, Math.min(168, req.minGapHours ?? 24));
    const minGapMs = minGapHours * 3_600_000;
    const regimeFilter = req.regimeFilter ?? 'all';
    const ablationHorizon: HorizonKey = req.ablationHorizon ?? '24h';
    const ablationBars = HORIZON_CONFIG.find((h) => h.key === ablationHorizon)?.bars ?? 288;

    // Step 1: Calibration search if threshold is omitted/auto (or direct search with user threshold)
    const needsAutoThreshold = req.threshold === undefined || req.threshold === null || req.threshold <= 0;
    const probeThreshold = needsAutoThreshold ? 1.5 : req.threshold!;

    let searchRes = searchSimilarStates({
      openTimeMs: series.openTimeMs,
      norm: bundle.norm,
      regimes: bundle.regimes,
      selectedIds: validSelected,
      targetIndex,
      metric: distanceMetric,
      threshold: probeThreshold,
      minGapMs,
      regimeFilter,
    });

    let activeThreshold = probeThreshold;
    if (needsAutoThreshold) {
      activeThreshold = searchRes.guidance.recommendedMid;
      searchRes = searchSimilarStates({
        openTimeMs: series.openTimeMs,
        norm: bundle.norm,
        regimes: bundle.regimes,
        selectedIds: validSelected,
        targetIndex,
        metric: distanceMetric,
        threshold: activeThreshold,
        minGapMs,
        regimeFilter,
      });
    }

    // Step 2: Mandatory temporal deduplication
    const dedup = deduplicateTemporalMatches(searchRes.candidates, minGapMs);

    // Step 3: Unconditional causal baselines up to targetIndex
    const baselines = computeUnconditionalBaselines(
      series.close,
      series.openTimeMs,
      n,
      targetIndex,
    );

    // Step 4: Forward returns + statistical tests + BH FDR
    const dedupIndices = dedup.accepted.map((m) => m.index);
    const horizonStats = analyzeHorizonReturns({
      matchIndices: dedupIndices,
      close: series.close,
      openTimeMs: series.openTimeMs,
      totalCount: n,
      baselines,
    });

    // Step 5: Raw vs Dedup comparison on ablationHorizon
    const rawIndices = searchRes.candidates.map((c) => c.index);
    const rawSummary = summarizeSingleHorizonQuick({
      matchIndices: rawIndices,
      close: series.close,
      openTimeMs: series.openTimeMs,
      totalCount: n,
      barsAhead: ablationBars,
    });
    const dedupHorizonStats = horizonStats.find((h) => h.horizon === ablationHorizon);

    // Step 6: Build serialized match objects (top 300 closest by distance for UI list/chart)
    const maxDistanceForScore = Math.max(activeThreshold, 0.001);
    const matches: SimilarityMatch[] = dedup.accepted.slice(0, 300).map((m, idx) => {
      const regCode = bundle.regimes[m.index];
      const regId = regimeCodeToId(regCode);
      const rawMap = {} as Record<IndicatorId, number | null>;
      const normMap = {} as Record<IndicatorId, number | null>;
      for (const id of ALL_INDICATOR_IDS) {
        const rv = bundle.raw[id][m.index];
        const nv = bundle.norm.normalized[id][m.index];
        rawMap[id] = Number.isFinite(rv) ? rv : null;
        normMap[id] = Number.isFinite(nv) ? nv : null;
      }
      const fwdMap = {} as Record<HorizonKey, number | null>;
      for (const h of HORIZON_CONFIG) {
        fwdMap[h.key] = computeForwardReturnPct(series.close, series.openTimeMs, n, m.index, h.bars);
      }

      return {
        matchRank: idx + 1,
        index: m.index,
        openTimeMs: m.openTimeMs,
        closeTimeMs: m.openTimeMs + 300_000,
        closePrice: series.close[m.index],
        distance: m.distance,
        mahalanobisDistance: m.mahalanobisDistance,
        euclideanDistance: m.euclideanDistance,
        similarityScore: Math.max(0, Math.min(100, (1 - m.distance / (maxDistanceForScore * 1.5)) * 100)),
        regime: regId,
        regimeLabel: REGIME_LABELS[regId].koreanLabel,
        indicators: rawMap,
        normalizedVector: normMap,
        forwardReturnsPct: fwdMap,
      };
    });

    // Step 7: Regime breakdown across matched events (using all-regime search at same threshold)
    const allRegimeSearch =
      regimeFilter === 'all'
        ? searchRes
        : searchSimilarStates({
            openTimeMs: series.openTimeMs,
            norm: bundle.norm,
            regimes: bundle.regimes,
            selectedIds: validSelected,
            targetIndex,
            metric: distanceMetric,
            threshold: activeThreshold,
            minGapMs,
            regimeFilter: 'all',
          });
    const allRegimeDedup =
      regimeFilter === 'all' ? dedup : deduplicateTemporalMatches(allRegimeSearch.candidates, minGapMs);

    const base24h = baselines['24h'].meanPct;
    const regimeComparison: SignalAnalysisResponse['regimeComparison'] = [
      {
        regime: 'all',
        label: '전체 시장 (필터 없음)',
        matchCount: allRegimeDedup.accepted.length,
        stats24h: (() => {
          const idxs = allRegimeDedup.accepted.map((a) => a.index);
          const hs = analyzeHorizonReturns({
            matchIndices: idxs,
            close: series.close,
            openTimeMs: series.openTimeMs,
            totalCount: n,
            baselines,
          }).find((h) => h.horizon === '24h');
          return {
            meanReturnPct: hs?.meanReturnPct ?? null,
            winRatePct: hs?.winRatePct ?? null,
            excessReturnPct: hs?.excessReturnPct ?? null,
            ci95LowPct: hs?.ci95LowPct ?? null,
            ci95HighPct: hs?.ci95HighPct ?? null,
          };
        })(),
      },
      ...REGIME_ORDER.map((regId) => {
        const regMatches = allRegimeDedup.accepted.filter(
          (a) => regimeCodeToId(bundle.regimes[a.index]) === regId,
        );
        const idxs = regMatches.map((a) => a.index);
        const hs = analyzeHorizonReturns({
          matchIndices: idxs,
          close: series.close,
          openTimeMs: series.openTimeMs,
          totalCount: n,
          baselines,
        }).find((h) => h.horizon === '24h');
        return {
          regime: regId,
          label: REGIME_LABELS[regId].koreanLabel,
          matchCount: regMatches.length,
          stats24h: {
            meanReturnPct: hs?.meanReturnPct ?? null,
            winRatePct: hs?.winRatePct ?? null,
            excessReturnPct: hs?.meanReturnPct !== null && hs?.meanReturnPct !== undefined ? hs.meanReturnPct - base24h : null,
            ci95LowPct: hs?.ci95LowPct ?? null,
            ci95HighPct: hs?.ci95HighPct ?? null,
          },
        };
      }),
    ];

    // Step 8: Threshold sample warning
    const acceptedCount = dedup.accepted.length;
    let sampleWarning: 'too_few' | 'too_many' | 'optimal' = 'optimal';
    let warningMessage: string | null = null;
    if (acceptedCount < 20) {
      sampleWarning = 'too_few';
      warningMessage = `독립 표본 수(n=${acceptedCount})가 최소 통계 기준(20건) 미만입니다. 거리 임계값을 ${searchRes.guidance.recommendedMid} 이상으로 완화하면 신뢰 구간 추정이 가능합니다.`;
    } else if (acceptedCount > 800) {
      sampleWarning = 'too_many';
      warningMessage = `독립 표본 수(n=${acceptedCount})가 과도하게 많아 비유사 시장 구간이 혼입될 수 있습니다. 임계값을 ${searchRes.guidance.recommendedMid} 부근으로 낮추는 것을 권장합니다.`;
    }

    // Step 9: Indicator Ablation Experiments (calibrated at ~0.5% empirical selectivity per subspace)
    let ablationResults: AblationExperimentResult[] = [];
    if (req.includeAblation !== false) {
      ablationResults = this.runAblationExperiments({
        bundle,
        targetIndex,
        metric: distanceMetric,
        minGapMs,
        regimeFilter,
        horizonKey: ablationHorizon,
        activeSet: validSelected,
        baselines,
      });
    }

    const targetIndicators = this.buildIndicatorSnapshots(bundle, targetIndex);
    const missingIndicatorIds = targetIndicators
      .filter((item) => item.normalizedValue === null)
      .map((item) => item.id);
    const targetRegimeId = regimeCodeToId(bundle.regimes[targetIndex]);

    return {
      request: {
        targetTimestampMs: series.openTimeMs[targetIndex],
        distanceMetric,
        threshold: activeThreshold,
        minGapHours,
        regimeFilter,
        selectedIndicators: validSelected,
        ablationHorizon,
        includeAblation: req.includeAblation !== false,
      },
      dataSpan: {
        startTimestampMs: series.openTimeMs[0],
        endTimestampMs: series.openTimeMs[n - 1],
        totalBars: n,
        availableTargetsMinMs: series.openTimeMs[minTargetIdx],
        availableTargetsMaxMs: series.openTimeMs[maxTargetIdx],
      },
      targetState: {
        index: targetIndex,
        openTimeMs: series.openTimeMs[targetIndex],
        closeTimeMs: series.openTimeMs[targetIndex] + 300_000,
        open: series.open[targetIndex],
        high: series.high[targetIndex],
        low: series.low[targetIndex],
        close: series.close[targetIndex],
        volume: series.volume[targetIndex],
        quoteVolume: series.quoteVolume[targetIndex],
        regime: targetRegimeId,
        regimeLabel: REGIME_LABELS[targetRegimeId].koreanLabel,
        indicators: targetIndicators,
        missingIndicatorIds,
      },
      availableRegimes: bundle.regimeSummary,
      independence: bundle.independence,
      clustering: dedup.clustering,
      thresholdGuidance: {
        ...searchRes.guidance,
        sampleWarning,
        warningMessage,
      },
      dedupVsRawComparison: {
        horizon: ablationHorizon,
        rawCount: rawSummary.sampleCount,
        rawMeanPct: rawSummary.meanReturnPct,
        rawWinRatePct: rawSummary.winRatePct,
        dedupCount: dedupHorizonStats?.sampleCount ?? 0,
        dedupMeanPct: dedupHorizonStats?.meanReturnPct ?? null,
        dedupWinRatePct: dedupHorizonStats?.winRatePct ?? null,
      },
      matches,
      horizonStats,
      regimeComparison,
      priceOverviewSeries: bundle.priceOverviewSeries,
      ablationResults,
      computedInMs: Date.now() - tStart,
    };
  }

  private runAblationExperiments(params: {
    bundle: PrecomputedBundle;
    targetIndex: number;
    metric: 'mahalanobis' | 'euclidean';
    minGapMs: number;
    regimeFilter: MarketRegimeId | 'all';
    horizonKey: HorizonKey;
    activeSet: IndicatorId[];
    baselines: ReturnType<typeof computeUnconditionalBaselines>;
  }): AblationExperimentResult[] {
    const { bundle, targetIndex, metric, minGapMs, regimeFilter, horizonKey, activeSet, baselines } =
      params;
    const { series } = bundle;

    const evalSubset = (
      experimentId: string,
      label: string,
      kind: AblationExperimentResult['kind'],
      subset: IndicatorId[],
      omittedIndicator: IndicatorId | null,
    ): AblationExperimentResult | null => {
      const validSubset = subset.filter((id) => Number.isFinite(bundle.norm.normalized[id][targetIndex]));
      if (validSubset.length === 0) return null;

      // Probe distance distribution at this subset dimension and select recommendedMid (~0.5% closest)
      const probe = searchSimilarStates({
        openTimeMs: series.openTimeMs,
        norm: bundle.norm,
        regimes: bundle.regimes,
        selectedIds: validSubset,
        targetIndex,
        metric,
        threshold: 0,
        minGapMs,
        regimeFilter,
      });

      const subSearch = searchSimilarStates({
        openTimeMs: series.openTimeMs,
        norm: bundle.norm,
        regimes: bundle.regimes,
        selectedIds: validSubset,
        targetIndex,
        metric,
        threshold: probe.guidance.recommendedMid,
        minGapMs,
        regimeFilter,
      });

      const dedup = deduplicateTemporalMatches(subSearch.candidates, minGapMs);
      const idxs = dedup.accepted.map((a) => a.index);
      const statsAll = analyzeHorizonReturns({
        matchIndices: idxs,
        close: series.close,
        openTimeMs: series.openTimeMs,
        totalCount: series.count,
        baselines,
      });
      const hStat = statsAll.find((h) => h.horizon === horizonKey);

      return {
        experimentId,
        label,
        kind,
        includedIndicators: validSubset,
        omittedIndicator,
        dedupMatchesCount: dedup.accepted.length,
        horizonKey,
        sampleCount: hStat?.sampleCount ?? 0,
        meanReturnPct: hStat?.meanReturnPct ?? null,
        winRatePct: hStat?.winRatePct ?? null,
        excessReturnPct: hStat?.excessReturnPct ?? null,
        ci95LowPct: hStat?.ci95LowPct ?? null,
        ci95HighPct: hStat?.ci95HighPct ?? null,
        fdrPValue: hStat?.significance.fdrAdjustedPValue ?? null,
        deltaMeanVsFullPct: null,
        deltaWinRateVsFullPct: null,
      };
    };

    const experiments: AblationExperimentResult[] = [];
    const baseExp = evalSubset(
      'baseline_active',
      `기준 조합 (${activeSet.length}개 지표)`,
      'custom',
      activeSet,
      null,
    );
    if (baseExp) experiments.push(baseExp);

    if (activeSet.length !== ALL_INDICATOR_IDS.length) {
      const all8 = evalSubset('all_8', '전체 8개 지표 (중복 포함)', 'all', ALL_INDICATOR_IDS, null);
      if (all8) experiments.push(all8);
    }

    // Leave-one-out on activeSet
    if (activeSet.length >= 2) {
      for (const omitted of activeSet) {
        const sub = activeSet.filter((id) => id !== omitted);
        const res = evalSubset(
          `loo_${omitted}`,
          `${INDICATOR_DEFINITIONS[omitted].shortLabel} 제외 (-1)`,
          'leave_one_out',
          sub,
          omitted,
        );
        if (res) experiments.push(res);
      }
    }

    // Single-indicator experiments for top 4 orthogonal indicators
    const singleTargets = activeSet.slice(0, 4);
    for (const id of singleTargets) {
      const res = evalSubset(
        `single_${id}`,
        `${INDICATOR_DEFINITIONS[id].shortLabel} 단독`,
        'single',
        [id],
        null,
      );
      if (res) experiments.push(res);
    }

    const baseMean = baseExp?.meanReturnPct ?? null;
    const baseWin = baseExp?.winRatePct ?? null;
    return experiments.map((exp) => ({
      ...exp,
      deltaMeanVsFullPct:
        baseMean !== null && exp.meanReturnPct !== null && exp.experimentId !== 'baseline_active'
          ? exp.meanReturnPct - baseMean
          : null,
      deltaWinRateVsFullPct:
        baseWin !== null && exp.winRatePct !== null && exp.experimentId !== 'baseline_active'
          ? exp.winRatePct - baseWin
          : null,
    }));
  }

  getMatchDetail(
    series: CandleTypedSeries,
    matchIndex: number,
    mahalanobisDistance = 0,
    euclideanDistance = 0,
  ): MatchDetailResponse {
    const bundle = this.ensurePrecomputed(series);
    if (matchIndex < 0 || matchIndex >= series.count) {
      throw new Error(`유효하지 않은 매치 인덱스입니다: ${matchIndex}`);
    }

    const regId = regimeCodeToId(bundle.regimes[matchIndex]);
    const indicators = this.buildIndicatorSnapshots(bundle, matchIndex);
    const forwardReturnsPct = {} as Record<HorizonKey, number | null>;
    for (const h of HORIZON_CONFIG) {
      forwardReturnsPct[h.key] = computeForwardReturnPct(
        series.close,
        series.openTimeMs,
        series.count,
        matchIndex,
        h.bars,
      );
    }

    const baseClose = series.close[matchIndex];
    const startOffset = -12; // -1h
    const endOffset = 288; // +24h
    const contextSeries: MatchDetailResponse['contextSeries'] = [];

    for (let off = startOffset; off <= endOffset; off += 3) {
      const idx = matchIndex + off;
      if (idx < 0 || idx >= series.count) continue;
      contextSeries.push({
        offsetBars: off,
        openTimeMs: series.openTimeMs[idx],
        close: series.close[idx],
        returnFromMatchPct: baseClose > 0 ? (series.close[idx] / baseClose - 1) * 100 : 0,
      });
    }

    // Ensure exact +288 point is included if available
    const idx288 = matchIndex + 288;
    if (idx288 < series.count && (contextSeries.length === 0 || contextSeries[contextSeries.length - 1].offsetBars !== 288)) {
      contextSeries.push({
        offsetBars: 288,
        openTimeMs: series.openTimeMs[idx288],
        close: series.close[idx288],
        returnFromMatchPct: baseClose > 0 ? (series.close[idx288] / baseClose - 1) * 100 : 0,
      });
    }

    return {
      matchIndex,
      openTimeMs: series.openTimeMs[matchIndex],
      closePrice: baseClose,
      regime: regId,
      regimeLabel: REGIME_LABELS[regId].koreanLabel,
      mahalanobisDistance,
      euclideanDistance,
      indicators,
      forwardReturnsPct,
      contextSeries,
    };
  }
}
