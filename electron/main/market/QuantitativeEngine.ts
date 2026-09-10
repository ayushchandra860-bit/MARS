// ============================================================
// MARS PRO V3 — Multi-Indicator Quantitative Engine
// Pure low-latency quantitative calculator computing RSI-14,
// Bollinger Bands (20,2), Fibonacci Retracements, Candlestick
// Patterns, S/R Pivots, and EMA-20 directly on candle data.
// ============================================================

import { CandleObservation, CandleDirection } from '../../../shared/types/scanner';

export interface OHLC {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface RsiResult {
  value: number;
  isOversold: boolean;
  isOverbought: boolean;
  status: 'OVERSOLD' | 'OVERBOUGHT' | 'NEUTRAL';
}

export interface BollingerBandsResult {
  sma: number;
  upper: number;
  lower: number;
  bandwidth: number;
  percentB: number;
  isSqueeze: boolean;
  touchUpper: boolean;
  touchLower: boolean;
  rejectionUpper: boolean;
  rejectionLower: boolean;
}

export interface FibonacciResult {
  high: number;
  low: number;
  level382: number;
  level500: number;
  level618: number;
  inGoldenZone: boolean;
  closestLevel: string;
}

export interface CandlestickPatternsResult {
  isBullishEngulfing: boolean;
  isBearishEngulfing: boolean;
  isPinbarBullish: boolean;
  isPinbarBearish: boolean;
  isDoji: boolean;
  detectedPatterns: string[];
}

export interface PivotPoint {
  price: number;
  touches: number;
  type: 'SUPPORT' | 'RESISTANCE';
}

export interface PivotsResult {
  supportLevels: number[];
  resistanceLevels: number[];
  pivotPoints: PivotPoint[];
}

export interface QuantitativeMetrics {
  ohlc: OHLC[];
  currentPrice: number;
  rsi: RsiResult;
  bollingerBands: BollingerBandsResult;
  fibonacci: FibonacciResult;
  patterns: CandlestickPatternsResult;
  pivots: PivotsResult;
  ema20: number;
  priceVsEmaTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

export class QuantitativeEngine {
  public static calculate(candles: CandleObservation[], currentPriceOverride?: number | null): QuantitativeMetrics | null {
    if (!candles || candles.length === 0) {
      return null;
    }

    const ohlc = this.extractOhlc(candles);
    if (ohlc.length === 0) return null;

    const lastClose = ohlc[ohlc.length - 1].close;
    const currentPrice = currentPriceOverride && currentPriceOverride > 0 ? currentPriceOverride : lastClose;

    const rsi = this.calculateRsi(ohlc, 10);
    const bollingerBands = this.calculateBollingerBands(ohlc, 20, 2);
    const fibonacci = this.calculateFibonacci(ohlc, 30);
    const patterns = this.detectPatterns(candles, ohlc);
    const pivots = this.calculatePivots(ohlc);
    const ema20 = this.calculateEma(ohlc, 20);
    const priceVsEmaTrend = this.determineEmaTrend(ohlc, ema20);

    return {
      ohlc,
      currentPrice,
      rsi,
      bollingerBands,
      fibonacci,
      patterns,
      pivots,
      ema20,
      priceVsEmaTrend,
    };
  }

  public static calculateSupportResistance(candles: any[]): { support: string | null; resistance: string | null } {
    if (!candles || candles.length === 0) {
      return { support: null, resistance: null };
    }

    try {
      const prices: number[] = [];
      for (const c of candles) {
        if (!c) continue;
        if (typeof c.close === 'number' && !isNaN(c.close) && c.close !== 0) prices.push(c.close);
        else if (typeof c.high === 'number' && !isNaN(c.high) && c.high !== 0) prices.push(c.high);
        else if (typeof c.low === 'number' && !isNaN(c.low) && c.low !== 0) prices.push(c.low);
      }

      if (prices.length === 0) {
        return { support: null, resistance: null };
      }

      const rawMin = Math.min(...prices);
      const rawMax = Math.max(...prices);

      return {
        support: rawMin.toFixed(2),
        resistance: rawMax.toFixed(2),
      };
    } catch {
      return { support: null, resistance: null };
    }
  }

  public static extractOhlc(candles: CandleObservation[]): OHLC[] {
    if (!candles || candles.length === 0) return [];

    return candles.map((c) => {
      // Invert Y-Pixel coordinates: top wick (smaller Y) = higher price (-wickTopPx)
      const high = -(c.wickTopPx ?? 0);
      const low = -(c.wickBottomPx ?? 0);

      let open: number;
      let close: number;

      if (c.direction === CandleDirection.BULLISH) {
        open = -(c.bodyBottomPx ?? 0);
        close = -(c.bodyTopPx ?? 0);
      } else {
        open = -(c.bodyTopPx ?? 0);
        close = -(c.bodyBottomPx ?? 0);
      }

      return { open, high, low, close };
    });
  }

  public static calculateRsi(ohlc: OHLC[], period: number = 10): RsiResult {
    if (!ohlc || ohlc.length < 2) {
      return { value: 50, isOversold: false, isOverbought: false, status: 'NEUTRAL' };
    }

    const effectivePeriod = Math.max(1, Math.min(period, ohlc.length - 1));
    let totalGain = 0;
    let totalLoss = 0;

    const startIdx = Math.max(1, ohlc.length - effectivePeriod);
    for (let i = startIdx; i < ohlc.length; i++) {
      const diff = ohlc[i].close - ohlc[i - 1].close;
      if (diff > 0) totalGain += diff;
      else if (diff < 0) totalLoss += Math.abs(diff);
    }

    const avgGain = totalGain / effectivePeriod;
    const avgLoss = totalLoss / effectivePeriod;

    let rsiVal = 50;
    if (avgLoss === 0 && avgGain === 0) {
      rsiVal = 50;
    } else if (avgLoss === 0) {
      rsiVal = 100;
    } else if (avgGain === 0) {
      rsiVal = 0;
    } else {
      const rs = avgGain / avgLoss;
      rsiVal = 100 - 100 / (1 + rs);
    }

    rsiVal = Math.round(rsiVal * 10) / 10;
    const isOversold = rsiVal < 30;
    const isOverbought = rsiVal > 70;
    const status = isOversold ? 'OVERSOLD' : isOverbought ? 'OVERBOUGHT' : 'NEUTRAL';

    return { value: rsiVal, isOversold, isOverbought, status };
  }

  public static calculateBollingerBands(
    ohlc: OHLC[],
    period: number = 20,
    multiplier: number = 2
  ): BollingerBandsResult {
    if (!ohlc || ohlc.length === 0) {
      return {
        sma: 0,
        upper: 0,
        lower: 0,
        bandwidth: 0,
        percentB: 0.5,
        isSqueeze: false,
        touchUpper: false,
        touchLower: false,
        rejectionUpper: false,
        rejectionLower: false,
      };
    }

    const slice = ohlc.slice(-Math.min(period, ohlc.length));
    const closes = slice.map((c) => c.close);
    const sum = closes.reduce((acc, val) => acc + val, 0);
    const sma = closes.length > 0 ? sum / closes.length : 0;

    const variance = closes.length > 0 
      ? closes.reduce((acc, val) => acc + Math.pow(val - sma, 2), 0) / closes.length 
      : 0;
    const stdDev = Math.sqrt(variance);

    const upper = sma + multiplier * stdDev;
    const lower = sma - multiplier * stdDev;
    const bandRange = upper - lower;

    const bandwidth = sma !== 0 ? bandRange / Math.abs(sma) : 0;
    const isSqueeze = bandwidth < 0.05;

    const curr = ohlc[ohlc.length - 1];
    const percentB = bandRange !== 0 ? (curr.close - lower) / bandRange : 0.5;

    const touchLower = curr.low <= lower + 0.08 * bandRange;
    const touchUpper = curr.high >= upper - 0.08 * bandRange;
    const rejectionLower = touchLower && curr.close > lower;
    const rejectionUpper = touchUpper && curr.close < upper;

    return {
      sma,
      upper,
      lower,
      bandwidth,
      percentB,
      isSqueeze,
      touchUpper,
      touchLower,
      rejectionUpper,
      rejectionLower,
    };
  }

  public static calculateFibonacci(ohlc: OHLC[], lookback: number = 30): FibonacciResult {
    if (!ohlc || ohlc.length === 0) {
      return {
        high: 0,
        low: 0,
        level382: 0,
        level500: 0,
        level618: 0,
        inGoldenZone: false,
        closestLevel: 'None',
      };
    }

    const slice = ohlc.slice(-Math.min(lookback, ohlc.length));
    const highs = slice.map((c) => c.high);
    const lows = slice.map((c) => c.low);

    const swingHigh = Math.max(...highs);
    const swingLow = Math.min(...lows);
    const range = swingHigh - swingLow;

    if (range === 0) {
      return {
        high: swingHigh,
        low: swingLow,
        level382: swingHigh,
        level500: swingHigh,
        level618: swingHigh,
        inGoldenZone: false,
        closestLevel: 'None',
      };
    }

    const level382 = swingHigh - 0.382 * range;
    const level500 = swingHigh - 0.500 * range;
    const level618 = swingHigh - 0.618 * range;

    const currentClose = ohlc[ohlc.length - 1].close;

    const minGolden = Math.min(level500, level618);
    const maxGolden = Math.max(level500, level618);
    const tolerance = range * 0.04;
    const inGoldenZone = currentClose >= minGolden - tolerance && currentClose <= maxGolden + tolerance;

    let closestLevel = '0.500';
    const dist382 = Math.abs(currentClose - level382);
    const dist500 = Math.abs(currentClose - level500);
    const dist618 = Math.abs(currentClose - level618);

    if (dist382 < dist500 && dist382 < dist618) closestLevel = '0.382';
    else if (dist618 < dist500 && dist618 < dist382) closestLevel = '0.618';
    else closestLevel = '0.500';

    return {
      high: swingHigh,
      low: swingLow,
      level382,
      level500,
      level618,
      inGoldenZone,
      closestLevel,
    };
  }

  public static detectPatterns(
    candles: CandleObservation[],
    ohlc: OHLC[]
  ): CandlestickPatternsResult {
    const detectedPatterns: string[] = [];
    let isBullishEngulfing = false;
    let isBearishEngulfing = false;
    let isPinbarBullish = false;
    let isPinbarBearish = false;
    let isDoji = false;

    if (!candles || !ohlc || candles.length === 0 || ohlc.length === 0) {
      return {
        isBullishEngulfing,
        isBearishEngulfing,
        isPinbarBullish,
        isPinbarBearish,
        isDoji,
        detectedPatterns,
      };
    }

    const curr = ohlc[ohlc.length - 1];

    const totalRange = curr.high - curr.low;
    const bodySize = Math.abs(curr.close - curr.open);
    if (totalRange > 0 && bodySize / totalRange < 0.12) {
      isDoji = true;
      detectedPatterns.push('Doji Indecision');
    }

    if (totalRange > 0) {
      const lowerWick = Math.min(curr.open, curr.close) - curr.low;
      const upperWick = curr.high - Math.max(curr.open, curr.close);

      if (lowerWick >= bodySize * 2 && lowerWick > upperWick * 1.5) {
        isPinbarBullish = true;
        detectedPatterns.push('Bullish Pinbar (Hammer)');
      } else if (upperWick >= bodySize * 2 && upperWick > lowerWick * 1.5) {
        isPinbarBearish = true;
        detectedPatterns.push('Bearish Pinbar (Shooting Star)');
      }
    }

    if (ohlc.length >= 2) {
      const prev = ohlc[ohlc.length - 2];
      const prevBody = Math.abs(prev.close - prev.open);

      if (bodySize > prevBody) {
        if (prev.close < prev.open && curr.close > curr.open) {
          if (curr.open <= prev.close && curr.close >= prev.open) {
            isBullishEngulfing = true;
            detectedPatterns.push('Bullish Engulfing');
          }
        } else if (prev.close > prev.open && curr.close < curr.open) {
          if (curr.open >= prev.close && curr.close <= prev.open) {
            isBearishEngulfing = true;
            detectedPatterns.push('Bearish Engulfing');
          }
        }
      }
    }

    if (ohlc.length >= 3) {
      const c1 = ohlc[ohlc.length - 3];
      const c2 = ohlc[ohlc.length - 2];
      const c3 = ohlc[ohlc.length - 1];

      const c1Body = Math.abs(c1.close - c1.open);
      const c2Body = Math.abs(c2.close - c2.open);
      const c3Body = Math.abs(c3.close - c3.open);

      if (c1.close < c1.open && c2Body < c1Body * 0.4 && c3.close > c3.open && c3.close > (c1.open + c1.close) / 2) {
        detectedPatterns.push('Morning Star Reversal');
      }

      if (c1.close > c1.open && c2Body < c1Body * 0.4 && c3.close < c3.open && c3.close < (c1.open + c1.close) / 2) {
        detectedPatterns.push('Evening Star Reversal');
      }
    }

    return {
      isBullishEngulfing,
      isBearishEngulfing,
      isPinbarBullish,
      isPinbarBearish,
      isDoji,
      detectedPatterns,
    };
  }

  public static calculatePivots(ohlc: OHLC[]): PivotsResult {
    const pivotPoints: PivotPoint[] = [];
    const supportLevels: number[] = [];
    const resistanceLevels: number[] = [];

    if (!ohlc || ohlc.length < 3) {
      return { supportLevels, resistanceLevels, pivotPoints };
    }

    const swings: { price: number; type: 'HIGH' | 'LOW' }[] = [];

    for (let i = 1; i < ohlc.length - 1; i++) {
      if (ohlc[i].high > ohlc[i - 1].high && ohlc[i].high > ohlc[i + 1].high) {
        swings.push({ price: ohlc[i].high, type: 'HIGH' });
      }
      if (ohlc[i].low < ohlc[i - 1].low && ohlc[i].low < ohlc[i + 1].low) {
        swings.push({ price: ohlc[i].low, type: 'LOW' });
      }
    }

    const allHighs = ohlc.map((c) => c.high);
    const allLows = ohlc.map((c) => c.low);
    const minP = Math.min(...allLows);
    const maxP = Math.max(...allHighs);
    const priceRange = maxP - minP || 1;

    const tolerance = priceRange * 0.025;

    const countTouches = (price: number, type: 'HIGH' | 'LOW') => {
      let touches = 0;
      for (const candle of ohlc) {
        const target = type === 'HIGH' ? candle.high : candle.low;
        if (Math.abs(target - price) <= tolerance) {
          touches++;
        }
      }
      return touches;
    };

    swings.forEach((s) => {
      const touches = countTouches(s.price, s.type);
      const role = s.type === 'HIGH' ? 'RESISTANCE' : 'SUPPORT';

      const existing = pivotPoints.find((p) => Math.abs(p.price - s.price) <= tolerance && p.type === role);
      if (existing) {
        existing.touches = Math.max(existing.touches, touches);
      } else {
        pivotPoints.push({ price: s.price, touches: Math.max(1, touches), type: role });
      }
    });

    pivotPoints.forEach((p) => {
      if (p.type === 'SUPPORT') supportLevels.push(p.price);
      else resistanceLevels.push(p.price);
    });

    return { supportLevels, resistanceLevels, pivotPoints };
  }

  public static calculateEma(ohlc: OHLC[], period: number = 20): number {
    if (!ohlc || ohlc.length === 0) return 0;
    const k = 2 / (period + 1);
    let ema = ohlc[0].close;

    for (let i = 1; i < ohlc.length; i++) {
      ema = ohlc[i].close * k + ema * (1 - k);
    }
    return ema;
  }

  private static determineEmaTrend(ohlc: OHLC[], ema20: number): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
    if (!ohlc || ohlc.length === 0) return 'NEUTRAL';
    const curr = ohlc[ohlc.length - 1].close;
    const diff = curr - ema20;

    if (Math.abs(diff) < Math.abs(ema20) * 0.002) return 'NEUTRAL';
    return diff > 0 ? 'BULLISH' : 'BEARISH';
  }
}
