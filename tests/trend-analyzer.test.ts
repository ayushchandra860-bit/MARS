// ============================================================
// MARS PRO V3 — Trend Analyzer Tests
// ============================================================

import { describe, it, expect } from 'vitest';
import { TrendAnalyzer } from '../electron/main/market/TrendAnalyzer';
import { CandleDirection, CandleObservation } from '../shared/types/scanner';
import { TrendDirection } from '../shared/types/market';

describe('TrendAnalyzer', () => {
  const analyzer = new TrendAnalyzer();

  it('returns NEUTRAL for insufficient candles', () => {
    const result = analyzer.analyze([]);
    expect(result.direction).toBe(TrendDirection.NEUTRAL);
    expect(result.strength).toBe(0);
  });

  it('detects BULLISH trend from ascending candle body progression (higher prices = lower Y)', () => {
    // In pixel coordinates, lower Y means higher price on screen
    const candles: CandleObservation[] = [
      { xPx: 10, wickTopPx: 100, bodyTopPx: 105, bodyBottomPx: 120, wickBottomPx: 125, direction: CandleDirection.BULLISH, bodySizePx: 15, rangePx: 25, quality: 0.8 },
      { xPx: 25, wickTopPx: 90, bodyTopPx: 95, bodyBottomPx: 110, wickBottomPx: 115, direction: CandleDirection.BULLISH, bodySizePx: 15, rangePx: 25, quality: 0.8 },
      { xPx: 40, wickTopPx: 80, bodyTopPx: 85, bodyBottomPx: 100, wickBottomPx: 105, direction: CandleDirection.BULLISH, bodySizePx: 15, rangePx: 25, quality: 0.8 },
      { xPx: 55, wickTopPx: 70, bodyTopPx: 75, bodyBottomPx: 90, wickBottomPx: 95, direction: CandleDirection.BULLISH, bodySizePx: 15, rangePx: 25, quality: 0.8 },
      { xPx: 70, wickTopPx: 60, bodyTopPx: 65, bodyBottomPx: 80, wickBottomPx: 85, direction: CandleDirection.BULLISH, bodySizePx: 15, rangePx: 25, quality: 0.8 },
    ];

    const result = analyzer.analyze(candles);
    expect(result.direction).toBe(TrendDirection.BULLISH);
    expect(result.strength).toBeGreaterThan(0.5);
  });

  it('detects BEARISH trend from descending candle body progression (lower prices = higher Y)', () => {
    const candles: CandleObservation[] = [
      { xPx: 10, wickTopPx: 60, bodyTopPx: 65, bodyBottomPx: 80, wickBottomPx: 85, direction: CandleDirection.BEARISH, bodySizePx: 15, rangePx: 25, quality: 0.8 },
      { xPx: 25, wickTopPx: 70, bodyTopPx: 75, bodyBottomPx: 90, wickBottomPx: 95, direction: CandleDirection.BEARISH, bodySizePx: 15, rangePx: 25, quality: 0.8 },
      { xPx: 40, wickTopPx: 80, bodyTopPx: 85, bodyBottomPx: 100, wickBottomPx: 105, direction: CandleDirection.BEARISH, bodySizePx: 15, rangePx: 25, quality: 0.8 },
      { xPx: 55, wickTopPx: 90, bodyTopPx: 95, bodyBottomPx: 110, wickBottomPx: 115, direction: CandleDirection.BEARISH, bodySizePx: 15, rangePx: 25, quality: 0.8 },
      { xPx: 70, wickTopPx: 100, bodyTopPx: 105, bodyBottomPx: 120, wickBottomPx: 125, direction: CandleDirection.BEARISH, bodySizePx: 15, rangePx: 25, quality: 0.8 },
    ];

    const result = analyzer.analyze(candles);
    expect(result.direction).toBe(TrendDirection.BEARISH);
    expect(result.strength).toBeGreaterThan(0.5);
  });
});
