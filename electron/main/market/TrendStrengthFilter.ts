// ============================================================
// MARS PRO V3 — Trend Strength and Choppiness Filter
// ADX/+DI/-DI and Choppiness Index over validated OHLC data.
// Values are scale-invariant, so normalized pixel-price OHLC is
// acceptable when a broker price-axis calibration is unavailable.
// ============================================================

import type { OHLC } from './QuantitativeEngine';

export type TrendStrengthStatus = 'WARMING_UP' | 'VALID' | 'INVALID';

export interface TrendStrengthMetrics {
  status: TrendStrengthStatus;
  period: number;
  adx: number | null;
  plusDi: number | null;
  minusDi: number | null;
  choppiness: number | null;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  gate: 'ALLOW' | 'REDUCE' | 'BLOCK';
  reason: string;
}

export interface TrendStrengthOptions {
  period?: number;
  minAdx?: number;
  maxChoppiness?: number;
  blockChoppiness?: number;
}

const DEFAULT_OPTIONS: Required<TrendStrengthOptions> = {
  period: 14,
  minAdx: 18,
  maxChoppiness: 61.8,
  blockChoppiness: 68,
};

function isFiniteOhlc(candle: OHLC): boolean {
  return [candle.open, candle.high, candle.low, candle.close].every(
    (value) => Number.isFinite(value),
  ) && candle.high >= candle.low && candle.high >= Math.max(candle.open, candle.close)
    && candle.low <= Math.min(candle.open, candle.close);
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

export class TrendStrengthFilter {
  public static calculate(ohlc: OHLC[], options: TrendStrengthOptions = {}): TrendStrengthMetrics {
    const config = { ...DEFAULT_OPTIONS, ...options };
    const period = Math.max(2, Math.floor(config.period));

    if (!Array.isArray(ohlc) || ohlc.some((candle) => !isFiniteOhlc(candle))) {
      return this.invalid(period, 'Invalid OHLC input');
    }
    if (ohlc.length < period + 1) {
      return {
        status: 'WARMING_UP', period, adx: null, plusDi: null, minusDi: null,
        choppiness: null, trend: 'NEUTRAL', gate: 'BLOCK',
        reason: `Waiting for ${period + 1} valid candles`,
      };
    }

    const tr: number[] = [];
    const plusDm: number[] = [];
    const minusDm: number[] = [];
    for (let i = 1; i < ohlc.length; i += 1) {
      const current = ohlc[i];
      const previous = ohlc[i - 1];
      const upMove = current.high - previous.high;
      const downMove = previous.low - current.low;
      tr.push(Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)));
      plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }

    const smooth = (values: number[]): number[] => {
      if (values.length < period) return [];
      let sum = values.slice(0, period).reduce((total, value) => total + value, 0);
      const result = [sum];
      for (let i = period; i < values.length; i += 1) {
        sum = sum - sum / period + values[i];
        result.push(sum);
      }
      return result;
    };

    const trSmooth = smooth(tr);
    const plusSmooth = smooth(plusDm);
    const minusSmooth = smooth(minusDm);
    const dx: number[] = [];
    let latestPlusDi = 0;
    let latestMinusDi = 0;
    for (let i = 0; i < trSmooth.length; i += 1) {
      const denominator = trSmooth[i];
      if (denominator <= Number.EPSILON) {
        dx.push(0);
        continue;
      }
      const plusDi = 100 * plusSmooth[i] / denominator;
      const minusDi = 100 * minusSmooth[i] / denominator;
      latestPlusDi = plusDi;
      latestMinusDi = minusDi;
      const diSum = plusDi + minusDi;
      dx.push(diSum <= Number.EPSILON ? 0 : 100 * Math.abs(plusDi - minusDi) / diSum);
    }

    if (dx.length < period) {
      return {
        status: 'WARMING_UP', period, adx: null, plusDi: null, minusDi: null,
        choppiness: null, trend: 'NEUTRAL', gate: 'BLOCK',
        reason: `Waiting for ${period * 2} valid candles for ADX`,
      };
    }

    let adx = dx.slice(0, period).reduce((total, value) => total + value, 0) / period;
    for (let i = period; i < dx.length; i += 1) {
      adx = ((adx * (period - 1)) + dx[i]) / period;
    }

    const window = ohlc.slice(-period);
    const highest = Math.max(...window.map((candle) => candle.high));
    const lowest = Math.min(...window.map((candle) => candle.low));
    const sumTrueRange = tr.slice(-period).reduce((total, value) => total + value, 0);
    const range = highest - lowest;
    const choppiness = range <= Number.EPSILON || sumTrueRange <= Number.EPSILON
      ? 100
      : clamp(100 * Math.log10(sumTrueRange / range) / Math.log10(period));

    const roundedAdx = Math.round(clamp(adx) * 100) / 100;
    const roundedPlusDi = Math.round(clamp(latestPlusDi) * 100) / 100;
    const roundedMinusDi = Math.round(clamp(latestMinusDi) * 100) / 100;
    const roundedChoppiness = Math.round(choppiness * 100) / 100;
    const directionalTrend = roundedPlusDi > roundedMinusDi + 1
      ? 'BULLISH'
      : roundedMinusDi > roundedPlusDi + 1 ? 'BEARISH' : 'NEUTRAL';
    const gate = roundedChoppiness >= config.blockChoppiness
      ? 'BLOCK'
      : roundedAdx < config.minAdx || roundedChoppiness > config.maxChoppiness
        ? 'REDUCE'
        : 'ALLOW';

    return {
      status: 'VALID', period, adx: roundedAdx, plusDi: roundedPlusDi,
      minusDi: roundedMinusDi, choppiness: roundedChoppiness,
      trend: directionalTrend, gate,
      reason: gate === 'BLOCK'
        ? 'Choppiness is too high for a directional signal'
        : gate === 'REDUCE'
          ? 'Trend strength is not sufficiently confirmed'
          : 'Trend strength and choppiness are within configured limits',
    };
  }

  private static invalid(period: number, reason: string): TrendStrengthMetrics {
    return {
      status: 'INVALID', period, adx: null, plusDi: null, minusDi: null,
      choppiness: null, trend: 'NEUTRAL', gate: 'BLOCK', reason,
    };
  }
}
