import type { TradeRecord } from '../../types/strategyBacktest.ts';

export function verifyTradeAccountingReconciliation(params: {
  trades: TradeRecord[];
  initialCapitalUsd: number;
  finalEquityUsd: number;
}): { ok: boolean; diffUsd: number } {
  const { trades, initialCapitalUsd, finalEquityUsd } = params;
  let sumTradeNetPnl = 0;
  for (const t of trades) {
    sumTradeNetPnl += t.netPnlUsd;
  }
  const equityDelta = finalEquityUsd - initialCapitalUsd;
  const diffUsd = Math.abs(sumTradeNetPnl - equityDelta);
  return {
    ok: diffUsd < 0.05,
    diffUsd,
  };
}
