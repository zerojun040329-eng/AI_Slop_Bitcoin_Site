import type { BacktestAccountConfig, TradeDirection } from '../../types/strategyBacktest.ts';

export const DEFAULT_BACKTEST_ACCOUNT_CONFIG: BacktestAccountConfig = {
  initialCapital: 10_000,
  positionSizePct: 25,
  leverage: 2,
  feeRatePct: 0.04,
  slippagePct: 0.02,
};

export function resolveAccountConfig(
  raw?: Partial<BacktestAccountConfig>,
): BacktestAccountConfig {
  const merged: BacktestAccountConfig = {
    ...DEFAULT_BACKTEST_ACCOUNT_CONFIG,
    ...(raw ?? {}),
  };

  merged.initialCapital = Math.max(100, Math.min(100_000_000, Number(merged.initialCapital)));
  merged.positionSizePct = Math.max(1, Math.min(100, Number(merged.positionSizePct)));
  merged.leverage = Math.max(1, Math.min(50, Number(merged.leverage)));
  merged.feeRatePct = Math.max(0, Math.min(1, Number(merged.feeRatePct)));
  merged.slippagePct = Math.max(0, Math.min(1, Number(merged.slippagePct)));

  return merged;
}

/**
 * Applies adverse market execution slippage:
 * - Buying (LONG ENTRY, SHORT EXIT): pay higher price -> rawPrice * (1 + slipFrac)
 * - Selling (LONG EXIT, SHORT ENTRY): receive lower price -> rawPrice * (1 - slipFrac)
 */
export function applyExecutionSlippage(
  rawPrice: number,
  direction: TradeDirection,
  legKind: 'ENTRY' | 'EXIT',
  slippagePct: number,
): number {
  const slipFrac = Math.max(0, slippagePct) / 100;
  if (slipFrac === 0) return rawPrice;

  const isBuy =
    (direction === 'LONG' && legKind === 'ENTRY') ||
    (direction === 'SHORT' && legKind === 'EXIT');

  return isBuy ? rawPrice * (1 + slipFrac) : rawPrice * (1 - slipFrac);
}

export function computeFeeUsd(notionalUsd: number, feeRatePct: number): number {
  return Math.max(0, notionalUsd) * (Math.max(0, feeRatePct) / 100);
}

export function computeSlippageCostUsd(
  rawPrice: number,
  filledPrice: number,
  baseQty: number,
): number {
  return Math.abs(filledPrice - rawPrice) * Math.max(0, baseQty);
}
