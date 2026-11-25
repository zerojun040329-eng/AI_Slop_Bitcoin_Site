import type {
  StrategyBacktestResponse,
  StrategyBacktestRunRequest,
  StrategyMetadata,
  TradeDetailWindowResponse,
  TradeRecord,
} from '../types/strategyBacktest';

export async function fetchRegisteredStrategies(): Promise<StrategyMetadata[]> {
  const res = await fetch('/api/strategy-backtest/strategies');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `전략 목록 조회 실패 (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { strategies: StrategyMetadata[] };
  return data.strategies;
}

export async function runStrategyBacktestApi(
  request: StrategyBacktestRunRequest,
): Promise<StrategyBacktestResponse> {
  const res = await fetch('/api/strategy-backtest/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `백테스트 실행 실패 (HTTP ${res.status})`);
  }
  return (await res.json()) as StrategyBacktestResponse;
}

export async function fetchTradeDetailWindowApi(
  trade: TradeRecord,
): Promise<TradeDetailWindowResponse> {
  const res = await fetch('/api/strategy-backtest/trade-window', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trade }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `거래 캔들 조회 실패 (HTTP ${res.status})`);
  }
  return (await res.json()) as TradeDetailWindowResponse;
}
