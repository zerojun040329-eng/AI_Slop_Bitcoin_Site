import type { BacktestAccountConfig, EquityPoint } from '../../types/strategyBacktest.ts';

export class BacktestPortfolio {
  public readonly initialCapital: number;
  public cashEquity: number;
  public peakEquity: number;
  public maxDrawdownUsd = 0;
  public maxDrawdownPct = 0;
  public totalFeesPaidUsd = 0;
  public totalSlippagePaidUsd = 0;

  // Uniform hourly portfolio equity returns for exact time-annualized Sharpe/Sortino
  public readonly hourlyReturns: number[] = [];
  private lastHourlyEquity: number;
  private lastHourlyBarIndex = -1;

  // Compact downsampled equity curve for frontend charting
  public readonly equityCurve: EquityPoint[] = [];

  constructor(account: BacktestAccountConfig) {
    this.initialCapital = account.initialCapital;
    this.cashEquity = account.initialCapital;
    this.peakEquity = account.initialCapital;
    this.lastHourlyEquity = account.initialCapital;
  }

  recordBarMarkToMarket(
    barIndex: number,
    timestampMs: number,
    btcClose: number,
    unrealizedPnlUsd: number,
    sampleStepBars: number,
    isFirstOrLast: boolean,
  ): void {
    const totalEquity = Math.max(0, this.cashEquity + unrealizedPnlUsd);

    if (totalEquity > this.peakEquity) {
      this.peakEquity = totalEquity;
    }

    const ddUsd = Math.max(0, this.peakEquity - totalEquity);
    const ddPct = this.peakEquity > 0 ? (ddUsd / this.peakEquity) * 100 : 0;

    if (ddUsd > this.maxDrawdownUsd) this.maxDrawdownUsd = ddUsd;
    if (ddPct > this.maxDrawdownPct) this.maxDrawdownPct = ddPct;

    // Sample uniform 1-hour (12 5m bars) portfolio return
    if (this.lastHourlyBarIndex === -1) {
      this.lastHourlyBarIndex = barIndex;
      this.lastHourlyEquity = totalEquity;
    } else if (barIndex - this.lastHourlyBarIndex >= 12) {
      if (this.lastHourlyEquity > 0) {
        this.hourlyReturns.push((totalEquity - this.lastHourlyEquity) / this.lastHourlyEquity);
      } else {
        this.hourlyReturns.push(0);
      }
      this.lastHourlyEquity = totalEquity;
      this.lastHourlyBarIndex = barIndex;
    }

    if (isFirstOrLast || barIndex % sampleStepBars === 0) {
      this.equityCurve.push({
        timestampMs,
        equityUsd: totalEquity,
        drawdownPct: -ddPct,
        btcClose,
      });
    }
  }
}
