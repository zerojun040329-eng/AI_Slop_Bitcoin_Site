import type { TemporalClusterStats } from '../types/signalAnalysis.ts';
import type { CandidateMatchRaw } from './similarityEngine.ts';

export interface DeduplicationOutcome {
  accepted: CandidateMatchRaw[];
  clustering: TemporalClusterStats;
}

export function deduplicateTemporalMatches(
  rawCandidates: CandidateMatchRaw[],
  minGapMs: number,
): DeduplicationOutcome {
  const sorted = [...rawCandidates].sort((a, b) => a.distance - b.distance);
  const accepted: CandidateMatchRaw[] = [];
  const acceptedTimes: number[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    let overlaps = false;
    for (let j = 0; j < acceptedTimes.length; j++) {
      if (Math.abs(c.openTimeMs - acceptedTimes[j]) < minGapMs) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) {
      accepted.push(c);
      acceptedTimes.push(c.openTimeMs);
    }
  }

  // Inter-match spacing stats (chronological order of accepted timestamps)
  const chronoTimes = [...acceptedTimes].sort((a, b) => a - b);
  const gapsHours: number[] = [];
  for (let i = 1; i < chronoTimes.length; i++) {
    gapsHours.push((chronoTimes[i] - chronoTimes[i - 1]) / 3_600_000);
  }
  gapsHours.sort((a, b) => a - b);

  const minInterMatchHours = gapsHours.length > 0 ? gapsHours[0] : null;
  const medianInterMatchHours =
    gapsHours.length > 0 ? gapsHours[Math.floor(gapsHours.length / 2)] : null;

  // Yearly raw vs deduplicated distribution
  const yearMap = new Map<string, { rawCount: number; deduplicatedCount: number }>();
  for (const c of rawCandidates) {
    const yr = new Date(c.openTimeMs).toISOString().slice(0, 4);
    const entry = yearMap.get(yr) ?? { rawCount: 0, deduplicatedCount: 0 };
    entry.rawCount += 1;
    yearMap.set(yr, entry);
  }
  for (const a of accepted) {
    const yr = new Date(a.openTimeMs).toISOString().slice(0, 4);
    const entry = yearMap.get(yr) ?? { rawCount: 0, deduplicatedCount: 0 };
    entry.deduplicatedCount += 1;
    yearMap.set(yr, entry);
  }

  const yearlyDistribution = Array.from(yearMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([year, counts]) => ({ year, ...counts }));

  const removedByGapCount = rawCandidates.length - accepted.length;
  const minGapHours = Math.round((minGapMs / 3_600_000) * 10) / 10;

  let clusterRiskNote = '';
  if (accepted.length === 0) {
    clusterRiskNote = '현재 거리 임계값 내에서 조건을 만족하는 과거 유사 구간이 없습니다.';
  } else {
    const maxYearShare = Math.max(
      ...yearlyDistribution.map((y) => (accepted.length > 0 ? y.deduplicatedCount / accepted.length : 0)),
    );
    if (maxYearShare >= 0.6 && yearlyDistribution.length >= 2) {
      clusterRiskNote = `중복 제거 후에도 전체 표본의 ${(maxYearShare * 100).toFixed(0)}%가 단일 연도에 집중되어 있어 특정 시기 편향(Regime Clustering) 가능성이 있습니다.`;
    } else {
      clusterRiskNote = `원시 후보 ${rawCandidates.length.toLocaleString()}건 중 ${minGapHours}h 최소 간격 내 중복 ${removedByGapCount.toLocaleString()}건을 제거하여 독립 사건 ${accepted.length.toLocaleString()}건을 확보했습니다.`;
    }
  }

  return {
    accepted,
    clustering: {
      rawCandidatesCount: rawCandidates.length,
      acceptedCount: accepted.length,
      removedByGapCount,
      minGapHours,
      medianInterMatchHours,
      minInterMatchHours,
      yearlyDistribution,
      clusterRiskNote,
    },
  };
}
