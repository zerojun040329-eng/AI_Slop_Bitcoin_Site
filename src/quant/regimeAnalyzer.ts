import type { MarketRegimeId, MarketRegimeInfo } from '../types/signalAnalysis.ts';
import type { RawIndicatorMatrix } from './indicatorCalculator.ts';
import type { NormalizedMatrixBundle } from './normalizationEngine.ts';

export const REGIME_LABELS: Record<MarketRegimeId, { koreanLabel: string; description: string }> = {
  high_vol: {
    koreanLabel: '고변동성',
    description: '인과적 4h 실현변동성(RV48) 상위 20% 구간 (백분위 ≥ 80%)',
  },
  uptrend: {
    koreanLabel: '상승 추세',
    description: '고변동성 제외, 추세 효율성 ER(48) ≥ 0.18 및 4h 수익률 > 0',
  },
  downtrend: {
    koreanLabel: '하락 추세',
    description: '고변동성 제외, 추세 효율성 ER(48) ≥ 0.18 및 4h 수익률 < 0',
  },
  range: {
    koreanLabel: '횡보',
    description: '추세 효율성 ER(48) < 0.18인 방향성 약화 구간',
  },
};

export const REGIME_ORDER: MarketRegimeId[] = ['uptrend', 'downtrend', 'range', 'high_vol'];

export function classifyAllRegimes(
  close: Float64Array,
  raw: RawIndicatorMatrix,
  norm: NormalizedMatrixBundle,
  count: number,
): {
  regimes: Uint8Array; // 0=uptrend, 1=downtrend, 2=range, 3=high_vol, 255=unknown
  regimeSummary: MarketRegimeInfo[];
} {
  const regimes = new Uint8Array(count).fill(255);
  const counts = [0, 0, 0, 0];
  let validTotal = 0;

  const erArr = raw.er48;
  const rvPctArr = norm.causalPercentile.rv48;

  for (let i = 48; i < count; i++) {
    const er = erArr[i];
    const rvPct = rvPctArr[i];
    const prevClose = close[i - 48];
    const currClose = close[i];

    if (!Number.isFinite(er) || !Number.isFinite(rvPct) || prevClose <= 0) {
      continue;
    }

    let code = 2; // range
    if (rvPct >= 0.8) {
      code = 3; // high_vol
    } else if (er >= 0.18) {
      code = currClose >= prevClose ? 0 : 1; // uptrend : downtrend
    }

    regimes[i] = code;
    counts[code] += 1;
    validTotal += 1;
  }

  const regimeSummary: MarketRegimeInfo[] = REGIME_ORDER.map((id, idx) => ({
    id,
    koreanLabel: REGIME_LABELS[id].koreanLabel,
    description: REGIME_LABELS[id].description,
    sampleCount: counts[idx],
    sharePercent: validTotal > 0 ? (counts[idx] / validTotal) * 100 : 0,
  }));

  return { regimes, regimeSummary };
}

export function regimeCodeToId(code: number): MarketRegimeId {
  return REGIME_ORDER[code] ?? 'range';
}

export function regimeIdToCode(id: MarketRegimeId): number {
  return REGIME_ORDER.indexOf(id);
}
