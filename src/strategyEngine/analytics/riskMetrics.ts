import type { RiskSummary, TradeRecord } from '../../types/strategyBacktest.ts';

const HOURS_PER_YEAR = 365 * 24; // 8,760 hours/year for crypto 24/7 markets

export function computeRiskSummary(params: {
  trades: TradeRecord[];
  hourlyReturns: number[];
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
}): RiskSummary {
  const { trades, hourlyReturns, maxDrawdownUsd, maxDrawdownPct } = params;

  // 1. Sharpe & Sortino computed strictly on uniform 1-hour (12x5m) portfolio equity returns
  let sharpeRatio: number | null = null;
  let sortinoRatio: number | null = null;

  if (hourlyReturns.length >= 24) {
    const n = hourlyReturns.length;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += hourlyReturns[i];
    const mean = sum / n;

    let sumSq = 0;
    let sumDownSq = 0;
    for (let i = 0; i < n; i++) {
      const r = hourlyReturns[i];
      const d = r - mean;
      sumSq += d * d;
      if (r < 0) sumDownSq += r * r;
    }

    const std = Math.sqrt(sumSq / (n - 1));
    const downsideDev = Math.sqrt(sumDownSq / n);
    const annScale = Math.sqrt(HOURS_PER_YEAR);

    if (std > 1e-12) {
      const s = (mean / std) * annScale;
      sharpeRatio = Number.isFinite(s) ? s : null;
    }
    if (downsideDev > 1e-12) {
      const so = (mean / downsideDev) * annScale;
      sortinoRatio = Number.isFinite(so) ? so : null;
    }
  }

  // 2. Max consecutive losses (count & USD) and average holding time
  let maxConsecutiveLosses = 0;
  let maxConsecutiveLossUsd = 0;
  let curConsecCount = 0;
  let curConsecUsd = 0;
  let sumHoldMin = 0;

  for (const t of trades) {
    sumHoldMin += t.holdingMinutes;
    if (t.netPnlUsd < 0) {
      curConsecCount++;
      curConsecUsd += Math.abs(t.netPnlUsd);
      if (curConsecCount > maxConsecutiveLosses) {
        maxConsecutiveLosses = curConsecCount;
      }
      if (curConsecUsd > maxConsecutiveLossUsd) {
        maxConsecutiveLossUsd = curConsecUsd;
      }
    } else {
      curConsecCount = 0;
      curConsecUsd = 0;
    }
  }

  const avgHoldingMinutes = trades.length > 0 ? sumHoldMin / trades.length : null;

  return {
    maxDrawdownPct,
    maxDrawdownUsd,
    sharpeRatio,
    sortinoRatio,
    maxConsecutiveLosses,
    maxConsecutiveLossUsd,
    avgHoldingMinutes,
    annualizationNote:
      '5분봉 시계열에서 추출한 균일 1시간(12봉) 포트폴리오 자산 수익률 기준 √8,760 연율화 (거래별 수익률과 미혼용)',
  };
}
