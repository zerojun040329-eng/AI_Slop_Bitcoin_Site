import type { LiquidityFakeoutParams } from '../../../types/strategyBacktest.ts';
import type {
  ActivePositionState,
  BacktestCandleSeries,
  BarPositionAction,
  StrategyPreparedData,
  StrategySignal,
  TradingStrategyModule,
} from '../types.ts';
import {
  LIQUIDITY_FAKEOUT_METADATA,
  resolveLiquidityFakeoutParams,
} from './config.ts';
import { computeStrategyIndicators } from './indicators.ts';
import { detectConfirmedPivots } from './swingDetection.ts';
import { detectLiquidityFakeoutSignals } from './signalDetection.ts';
import { buildFakeoutPositionPlan, evaluateFakeoutBarExit } from './positionManager.ts';

export const liquidityFakeoutStrategy: TradingStrategyModule<LiquidityFakeoutParams> = {
  metadata: LIQUIDITY_FAKEOUT_METADATA,

  resolveParams(rawParams?: Partial<LiquidityFakeoutParams>): LiquidityFakeoutParams {
    return resolveLiquidityFakeoutParams(rawParams);
  },

  prepare(
    series: BacktestCandleSeries,
    params: LiquidityFakeoutParams,
    startIdx: number,
    endIdx: number,
  ): StrategyPreparedData<LiquidityFakeoutParams> {
    const indicators = computeStrategyIndicators({
      high: series.high,
      low: series.low,
      close: series.close,
      volume: series.volume,
      count: series.count,
      atrPeriod: params.atrPeriod,
      rvolPeriod: params.rvolPeriod,
    });

    const pivots = detectConfirmedPivots(series, indicators, params, startIdx, endIdx);
    const { signalsByExecuteIndex, totalSignalsGenerated } = detectLiquidityFakeoutSignals({
      series,
      atr: indicators.atr,
      pivots,
      config: params,
      startIdx,
      endIdx,
    });

    return {
      params,
      atr: indicators.atr,
      pivotsDetectedCount: pivots.length,
      signalsByExecuteIndex,
      totalSignalsGenerated,
    };
  },

  buildPositionPlan(
    entryPrice: number,
    entryIndex: number,
    signal: StrategySignal,
    params: LiquidityFakeoutParams,
  ): ActivePositionState {
    return buildFakeoutPositionPlan(entryPrice, entryIndex, signal, params);
  },

  evaluateBarExit(
    series: BacktestCandleSeries,
    barIndex: number,
    position: ActivePositionState,
  ): BarPositionAction {
    return evaluateFakeoutBarExit(series, barIndex, position);
  },
};
