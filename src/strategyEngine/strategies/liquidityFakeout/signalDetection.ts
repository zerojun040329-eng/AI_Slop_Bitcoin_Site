import type { LiquidityFakeoutParams } from '../../../types/strategyBacktest.ts';
import type { BacktestCandleSeries, StrategySignal } from '../types.ts';
import type { ConfirmedPivot } from './swingDetection.ts';

interface TrackedPivot extends ConfirmedPivot {
  sweepStartBar: number | null;
  consumed: boolean;
}

export function detectLiquidityFakeoutSignals(params: {
  series: BacktestCandleSeries;
  atr: Float64Array;
  pivots: ConfirmedPivot[];
  config: LiquidityFakeoutParams;
  startIdx: number;
  endIdx: number;
}): {
  signalsByExecuteIndex: Map<number, StrategySignal>;
  totalSignalsGenerated: number;
} {
  const { series, atr, pivots, config, startIdx, endIdx } = params;
  const { high, low, close } = series;

  // Group pivots by confirmedIndex for O(N) chronological registration
  const pivotsByConfirmBar = new Map<number, ConfirmedPivot[]>();
  for (const p of pivots) {
    const list = pivotsByConfirmBar.get(p.confirmedIndex);
    if (list) list.push(p);
    else pivotsByConfirmBar.set(p.confirmedIndex, [p]);
  }

  const activeLowPivots: TrackedPivot[] = [];
  const activeHighPivots: TrackedPivot[] = [];
  const signalsByExecuteIndex = new Map<number, StrategySignal>();
  let totalSignalsGenerated = 0;

  const lastSignalBar = Math.min(series.count - 2, endIdx - 1);

  for (let t = Math.max(0, startIdx); t <= lastSignalBar; t++) {
    // 1. Prune expired or consumed pivots
    const prune = (list: TrackedPivot[]) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        if (p.consumed || t - p.confirmedIndex > config.maxPivotAgeBars) {
          list.splice(i, 1);
        }
      }
    };
    prune(activeLowPivots);
    prune(activeHighPivots);

    const curAtr = atr[t];
    const barHigh = high[t];
    const barLow = low[t];
    const barClose = close[t];

    let longCandidate: TrackedPivot | null = null;
    let shortCandidate: TrackedPivot | null = null;

    // 2. Check active Pivot Lows for LONG fakeout (break below -> close back above)
    for (const p of activeLowPivots) {
      if (p.consumed) continue;
      if (barLow < p.price) {
        if (barClose > p.price) {
          // Recovered within sweep window
          if (p.sweepStartBar === null || t - p.sweepStartBar < config.sweepWindowBars) {
            if (!longCandidate || p.confirmedIndex > longCandidate.confirmedIndex) {
              longCandidate = p;
            }
          }
          p.consumed = true;
        } else {
          // Closed below level; track sweep start or invalidate if exceeded window
          if (p.sweepStartBar === null) {
            p.sweepStartBar = t;
          }
          if (t - p.sweepStartBar >= config.sweepWindowBars - 1) {
            p.consumed = true;
          }
        }
      } else if (p.sweepStartBar !== null) {
        if (barClose > p.price && t - p.sweepStartBar < config.sweepWindowBars) {
          if (!longCandidate || p.confirmedIndex > longCandidate.confirmedIndex) {
            longCandidate = p;
          }
        }
        p.consumed = true;
      }
    }

    // 3. Check active Pivot Highs for SHORT fakeout (break above -> close back below)
    for (const p of activeHighPivots) {
      if (p.consumed) continue;
      if (barHigh > p.price) {
        if (barClose < p.price) {
          if (p.sweepStartBar === null || t - p.sweepStartBar < config.sweepWindowBars) {
            if (!shortCandidate || p.confirmedIndex > shortCandidate.confirmedIndex) {
              shortCandidate = p;
            }
          }
          p.consumed = true;
        } else {
          if (p.sweepStartBar === null) {
            p.sweepStartBar = t;
          }
          if (t - p.sweepStartBar >= config.sweepWindowBars - 1) {
            p.consumed = true;
          }
        }
      } else if (p.sweepStartBar !== null) {
        if (barClose < p.price && t - p.sweepStartBar < config.sweepWindowBars) {
          if (!shortCandidate || p.confirmedIndex > shortCandidate.confirmedIndex) {
            shortCandidate = p;
          }
        }
        p.consumed = true;
      }
    }

    // 4. Emit deterministic signal at t (to execute at t + 1 open), skipping simultaneous opposite outside-bars
    if (Number.isFinite(curAtr) && curAtr > 0) {
      if (longCandidate && !shortCandidate) {
        const executeIndex = t + 1;
        signalsByExecuteIndex.set(executeIndex, {
          signalIndex: t,
          executeIndex,
          direction: 'LONG',
          pivotIndex: longCandidate.pivotIndex,
          pivotConfirmedIndex: longCandidate.confirmedIndex,
          pivotPrice: longCandidate.price,
          atrAtSignal: curAtr,
          initialStopPrice: longCandidate.price,
        });
        totalSignalsGenerated++;
      } else if (shortCandidate && !longCandidate) {
        const executeIndex = t + 1;
        signalsByExecuteIndex.set(executeIndex, {
          signalIndex: t,
          executeIndex,
          direction: 'SHORT',
          pivotIndex: shortCandidate.pivotIndex,
          pivotConfirmedIndex: shortCandidate.confirmedIndex,
          pivotPrice: shortCandidate.price,
          atrAtSignal: curAtr,
          initialStopPrice: shortCandidate.price,
        });
        totalSignalsGenerated++;
      }
    }

    // 5. Register pivots confirmed on bar `t` AFTER bar `t` signal scan so they activate only from `t + 1`
    const newlyConfirmed = pivotsByConfirmBar.get(t);
    if (newlyConfirmed) {
      for (const np of newlyConfirmed) {
        const tracked: TrackedPivot = {
          ...np,
          sweepStartBar: null,
          consumed: false,
        };
        if (np.kind === 'LOW') activeLowPivots.push(tracked);
        else activeHighPivots.push(tracked);
      }
    }
  }

  return {
    signalsByExecuteIndex,
    totalSignalsGenerated,
  };
}
