// ============================================================
// MARS PRO V3 — Multi-Indicator Quantitative Engine Tests
// ============================================================

import { describe, it, expect } from 'vitest';
import { QuantitativeEngine } from '../electron/main/market/QuantitativeEngine';
import { DecisionEngine } from '../electron/main/decision/DecisionEngine';
import { CandleObservation, CandleDirection, QualityLevel } from '../shared/types/scanner';
import { MarketObservation } from '../shared/types/observation';
import { TradingAction } from '../shared/types/decision';

function generateSampleCandles(count: number = 20): CandleObservation[] {
  return Array.from({ length: count }, (_, i) => {
    const isBull = i % 2 === 0;
    const basePx = 100 + i * 2;

    return {
      xPx: 10 + i * 15,
      wickTopPx: basePx - 10,
      bodyTopPx: isBull ? basePx - 5 : basePx - 2,
      bodyBottomPx: isBull ? basePx - 2 : basePx - 5,
      wickBottomPx: basePx + 5,
      direction: isBull ? CandleDirection.BULLISH : CandleDirection.BEARISH,
      bodySizePx: 3,
      rangePx: 15,
      quality: 0.9,
    };
  });
}

describe('QuantitativeEngine', () => {
  it('extracts OHLC price values correctly from pixel coordinates', () => {
    const candles = generateSampleCandles(5);
    const ohlc = QuantitativeEngine.extractOhlc(candles);

    expect(ohlc.length).toBe(5);
    expect(ohlc[0].high).toBeGreaterThan(ohlc[0].low);
  });

  it('calculates RSI-14 accurately within range 0-100', () => {
    const candles = generateSampleCandles(20);
    const ohlc = QuantitativeEngine.extractOhlc(candles);
    const rsi = QuantitativeEngine.calculateRsi(ohlc, 14);

    expect(rsi.value).toBeGreaterThanOrEqual(0);
    expect(rsi.value).toBeLessThanOrEqual(100);
    expect(['OVERSOLD', 'OVERBOUGHT', 'NEUTRAL']).toContain(rsi.status);
  });

  it('calculates Bollinger Bands (20,2)', () => {
    const candles = generateSampleCandles(25);
    const ohlc = QuantitativeEngine.extractOhlc(candles);
    const bb = QuantitativeEngine.calculateBollingerBands(ohlc, 20, 2);

    expect(bb.upper).toBeGreaterThanOrEqual(bb.sma);
    expect(bb.sma).toBeGreaterThanOrEqual(bb.lower);
  });

  it('calculates Fibonacci Retracements and golden zone status', () => {
    const candles = generateSampleCandles(30);
    const ohlc = QuantitativeEngine.extractOhlc(candles);
    const fib = QuantitativeEngine.calculateFibonacci(ohlc, 30);

    expect(fib.high).toBeGreaterThanOrEqual(fib.low);
    expect(typeof fib.inGoldenZone).toBe('boolean');
  });

  it('evaluates Confluence Score engine correctly', () => {
    const engine = new DecisionEngine();
    const candles = generateSampleCandles(30);

    const obs: MarketObservation = {
      sessionId: 'test',
      frameId: 'test-f',
      timestamp: Date.now(),
      captureQuality: QualityLevel.HIGH,
      chartQuality: QualityLevel.HIGH,
      candleQuality: QualityLevel.HIGH,
      dataQuality: QualityLevel.HIGH,
      candles,
      asset: 'EURUSD',
      timeframe: '1 min',
      currentPrice: 1.0950,
      trendEvidence: null,
      momentumEvidence: null,
      volatilityEvidence: null,
      structureEvidence: null,
      supportResistanceEvidence: null,
      patternEvidence: null,
    };

    const result = engine.decide(obs);
    expect([TradingAction.BUY, TradingAction.SELL, TradingAction.WAIT]).toContain(result.action);
    expect(result.reason).toBeDefined();
  });

  it('calculates RSI-10 accurately for binary options and detects overbought on consecutive bullish candles', () => {
    // Generate 12 consecutive bullish candles (rising price)
    const bullCandles: CandleObservation[] = Array.from({ length: 12 }, (_, i) => ({
      xPx: 10 + i * 15,
      wickTopPx: 500 - i * 20 - 5,
      bodyTopPx: 500 - i * 20,
      bodyBottomPx: 500 - i * 20 + 15,
      wickBottomPx: 500 - i * 20 + 18,
      direction: CandleDirection.BULLISH,
      bodySizePx: 15,
      rangePx: 23,
      quality: 0.95,
    }));

    const ohlc = QuantitativeEngine.extractOhlc(bullCandles);
    const rsi = QuantitativeEngine.calculateRsi(ohlc, 10);

    expect(rsi.value).toBeGreaterThan(70);
    expect(rsi.isOverbought).toBe(true);
    expect(rsi.status).toBe('OVERBOUGHT');
  });

  it('penalizes BUY confidence when RSI is overbought (>70)', () => {
    const engine = new DecisionEngine();
    const bullCandles: CandleObservation[] = Array.from({ length: 12 }, (_, i) => ({
      xPx: 10 + i * 15,
      wickTopPx: 500 - i * 20 - 5,
      bodyTopPx: 500 - i * 20,
      bodyBottomPx: 500 - i * 20 + 15,
      wickBottomPx: 500 - i * 20 + 18,
      direction: CandleDirection.BULLISH,
      bodySizePx: 15,
      rangePx: 23,
      quality: 0.95,
    }));

    const qm = QuantitativeEngine.calculate(bullCandles);
    expect(qm?.rsi.isOverbought).toBe(true);

    const obs: MarketObservation = {
      sessionId: 'test-ob',
      frameId: 'test-ob-f',
      timestamp: Date.now(),
      captureQuality: QualityLevel.HIGH,
      chartQuality: QualityLevel.HIGH,
      candleQuality: QualityLevel.HIGH,
      dataQuality: QualityLevel.HIGH,
      candles: bullCandles,
      quantitativeMetrics: qm,
      asset: 'BNB OTC',
      timeframe: '1 min',
      currentPrice: 6150.0,
      trendEvidence: null,
      momentumEvidence: null,
      volatilityEvidence: null,
      structureEvidence: null,
      supportResistanceEvidence: null,
      patternEvidence: null,
    };

    const evidence = engine.getEvidenceEngine().evaluate(obs);
    const confWithOverbought = engine.computeConfidence(obs, evidence, 'LOW' as any, 'TRENDING' as any, 1.0, TradingAction.BUY);
    // Overbought penalty ensures confidence does not artificially jump to 90%+ without breakout
    expect(confWithOverbought).toBeLessThanOrEqual(0.85);
  });
});
