import type { LiquidityFakeoutParams } from '../../../types/strategyBacktest.ts';
import type {
  ActivePositionState,
  BacktestCandleSeries,
  BarPositionAction,
  StrategySignal,
} from '../types.ts';

export function buildFakeoutPositionPlan(
  entryPrice: number,
  entryIndex: number,
  signal: StrategySignal,
  params: LiquidityFakeoutParams,
): ActivePositionState {
  const atr = signal.atrAtSignal;
  const isLong = signal.direction === 'LONG';

  const tp1Price = isLong
    ? entryPrice + params.tp1AtrMultiple * atr
    : entryPrice - params.tp1AtrMultiple * atr;

  const tp2Price = isLong
    ? entryPrice + params.tp2AtrMultiple * atr
    : entryPrice - params.tp2AtrMultiple * atr;

  return {
    direction: signal.direction,
    pivotPrice: signal.pivotPrice,
    entryIndex,
    entryPrice,
    entryAtr: atr,
    initialStopPrice: signal.pivotPrice,
    tp1Price,
    tp2Price,
    tp1Hit: false,
    remainingRatio: 1.0,
    breakevenStopPrice: null,
  };
}

/**
 * Evaluates exits on bar `barIndex` with conservative conflict & gap rules:
 * 1. Before TP1:
 *    - Check Close Stop-Loss FIRST (close crosses back beyond pivot level).
 *      If both SL (close) and TP1 (high/low) occur in the same 5m bar, SL wins conservatively.
 *    - Otherwise check TP1 target: fill 50% at TP1 (or favorable gap open), move stop to breakeven.
 *    - If TP2 also reached on the same bar: conservatively check whether breakeven stop was also touched
 *      on the same candle (`low <= entryPrice` for LONG / `high >= entryPrice` for SHORT). If touched,
 *      exit remaining 50% at breakeven; otherwise fill remaining 50% at TP2!
 * 2. After TP1 (`tp1Hit === true`):
 *    - Check Breakeven Stop FIRST (gap open through entryPrice fills at open; otherwise entryPrice).
 *    - Only if Breakeven Stop was NOT hit on this candle, check TP2 target.
 */
export function evaluateFakeoutBarExit(
  series: BacktestCandleSeries,
  barIndex: number,
  pos: ActivePositionState,
): BarPositionAction {
  const open = series.open[barIndex];
  const high = series.high[barIndex];
  const low = series.low[barIndex];
  const close = series.close[barIndex];

  if (pos.direction === 'LONG') {
    if (!pos.tp1Hit) {
      // 1. Initial close-based stop checked FIRST
      if (close < pos.initialStopPrice) {
        return {
          finalExitPrice: close,
          finalQtyRatio: pos.remainingRatio,
          exitReason: 'CLOSE_STOP_LOSS',
          exitReasonLabel: '기준선 종가 재이탈 손절',
        };
      }

      // 2. Check 1st Take Profit (TP1)
      if (high >= pos.tp1Price) {
        const tp1Fill = Math.max(open, pos.tp1Price);
        pos.tp1Hit = true;
        pos.remainingRatio = 0.5;
        pos.breakevenStopPrice = pos.entryPrice;

        // Same-candle TP2 check with conservative breakeven conflict check
        if (high >= pos.tp2Price) {
          if (low <= pos.entryPrice) {
            return {
              tp1FilledPrice: tp1Fill,
              tp1QtyRatio: 0.5,
              movedToBreakeven: true,
              finalExitPrice: pos.entryPrice,
              finalQtyRatio: 0.5,
              exitReason: 'BREAKEVEN_STOP',
              exitReasonLabel: '1차 익절 후 동봉 평단가 스탑',
            };
          }
          return {
            tp1FilledPrice: tp1Fill,
            tp1QtyRatio: 0.5,
            movedToBreakeven: true,
            finalExitPrice: Math.max(open, pos.tp2Price),
            finalQtyRatio: 0.5,
            exitReason: 'TP2_FULL_TARGET',
            exitReasonLabel: '2차 익절 목표 도달',
          };
        }

        return {
          tp1FilledPrice: tp1Fill,
          tp1QtyRatio: 0.5,
          movedToBreakeven: true,
        };
      }

      return {};
    }

    // After TP1: Breakeven stop is active on remaining 50% — check Stop FIRST!
    const bePrice = pos.breakevenStopPrice ?? pos.entryPrice;
    if (open <= bePrice) {
      // Gap-through stop: cannot guarantee exact breakeven price, fill at open
      return {
        finalExitPrice: open,
        finalQtyRatio: pos.remainingRatio,
        exitReason: 'BREAKEVEN_STOP',
        exitReasonLabel: '평단가 스탑 (갭 하락 체결)',
      };
    }
    if (low <= bePrice) {
      return {
        finalExitPrice: bePrice,
        finalQtyRatio: pos.remainingRatio,
        exitReason: 'BREAKEVEN_STOP',
        exitReasonLabel: '1차 익절 후 평단가 스탑',
      };
    }

    if (high >= pos.tp2Price) {
      return {
        finalExitPrice: Math.max(open, pos.tp2Price),
        finalQtyRatio: pos.remainingRatio,
        exitReason: 'TP2_FULL_TARGET',
        exitReasonLabel: '2차 익절 목표 도달',
      };
    }

    return {};
  }

  // SHORT direction
  if (!pos.tp1Hit) {
    // 1. Initial close-based stop checked FIRST
    if (close > pos.initialStopPrice) {
      return {
        finalExitPrice: close,
        finalQtyRatio: pos.remainingRatio,
        exitReason: 'CLOSE_STOP_LOSS',
        exitReasonLabel: '기준선 종가 재이탈 손절',
      };
    }

    // 2. Check 1st Take Profit (TP1)
    if (low <= pos.tp1Price) {
      const tp1Fill = Math.min(open, pos.tp1Price);
      pos.tp1Hit = true;
      pos.remainingRatio = 0.5;
      pos.breakevenStopPrice = pos.entryPrice;

      if (low <= pos.tp2Price) {
        if (high >= pos.entryPrice) {
          return {
            tp1FilledPrice: tp1Fill,
            tp1QtyRatio: 0.5,
            movedToBreakeven: true,
            finalExitPrice: pos.entryPrice,
            finalQtyRatio: 0.5,
            exitReason: 'BREAKEVEN_STOP',
            exitReasonLabel: '1차 익절 후 동봉 평단가 스탑',
          };
        }
        return {
          tp1FilledPrice: tp1Fill,
          tp1QtyRatio: 0.5,
          movedToBreakeven: true,
          finalExitPrice: Math.min(open, pos.tp2Price),
          finalQtyRatio: 0.5,
          exitReason: 'TP2_FULL_TARGET',
          exitReasonLabel: '2차 익절 목표 도달',
        };
      }

      return {
        tp1FilledPrice: tp1Fill,
        tp1QtyRatio: 0.5,
        movedToBreakeven: true,
      };
    }

    return {};
  }

  // SHORT after TP1: Breakeven stop checked FIRST!
  const bePrice = pos.breakevenStopPrice ?? pos.entryPrice;
  if (open >= bePrice) {
    return {
      finalExitPrice: open,
      finalQtyRatio: pos.remainingRatio,
      exitReason: 'BREAKEVEN_STOP',
      exitReasonLabel: '평단가 스탑 (갭 상승 체결)',
    };
  }
  if (high >= bePrice) {
    return {
      finalExitPrice: bePrice,
      finalQtyRatio: pos.remainingRatio,
      exitReason: 'BREAKEVEN_STOP',
      exitReasonLabel: '1차 익절 후 평단가 스탑',
    };
  }

  if (low <= pos.tp2Price) {
    return {
      finalExitPrice: Math.min(open, pos.tp2Price),
      finalQtyRatio: pos.remainingRatio,
      exitReason: 'TP2_FULL_TARGET',
      exitReasonLabel: '2차 익절 목표 도달',
    };
  }

  return {};
}
