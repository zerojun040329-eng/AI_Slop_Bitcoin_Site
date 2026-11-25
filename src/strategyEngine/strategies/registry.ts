import type { StrategyId, StrategyMetadata } from '../../types/strategyBacktest.ts';
import type { TradingStrategyModule } from './types.ts';
import { liquidityFakeoutStrategy } from './liquidityFakeout/execution.ts';

const STRATEGY_MODULES: Record<StrategyId, TradingStrategyModule<any>> = {
  liquidity_fakeout: liquidityFakeoutStrategy,
};

export function getStrategyModule(id: StrategyId = 'liquidity_fakeout'): TradingStrategyModule<any> {
  const mod = STRATEGY_MODULES[id];
  if (!mod) {
    throw new Error(`등록되지 않은 전략입니다: ${id}`);
  }
  return mod;
}

export function listRegisteredStrategies(): StrategyMetadata[] {
  return Object.values(STRATEGY_MODULES).map((m) => m.metadata);
}
