import { describe, it, expect, beforeEach } from 'vitest';
import { MLEngine, FEATURE_NAMES } from '../electron/main/decision/MLEngine';
import { MarketObservation } from '../shared/types/observation';
import { OHLC } from '../electron/main/market/QuantitativeEngine';
import { TradingAction } from '../shared/types/decision';

const makeObservation = (overrides: Partial<MarketObservation> = {}): MarketObservation => ({
  id: 'obs-1', asset: 'EUR/USD', timeframe: '1M', timestamp: Date.now(), currentPrice: 1.095, candles: [],
  patternEvidence: { detectedPatterns: [], patternConfidence: 0 },
  trendEvidence: { direction: 'BULLISH', confidence: 0.8, consecutive: 4, quality: 'STRONG' },
  momentumEvidence: { level: 'STRONG', direction: 'UP' },
  structureEvidence: { structure: 'HIGHER_HIGHS', confidence: 0.75, quality: 'GOOD' },
  supportResistanceEvidence: { nearestSupport: 1.094, nearestResistance: 1.097, strength: 0.7 },
  volatilityEvidence: { level: 'NORMAL', atr: 0.001, spike: false },
  quantitativeMetrics: {
    rsi: { value: 45, isOversold: false, isOverbought: false },
    bollingerBands: { percentB: 0.5, isSqueeze: false, width: 0.002 },
    macd: { signal: 'NEUTRAL', direction: 'UP' }, fibonacciLevels: { levels: [], nearest: null },
    atrNormalized: 0.5, candleQualityScore: 0.9,
  }, ...overrides,
}) as MarketObservation;
const makeCandles = (bullish = true): OHLC[] => Array.from({ length: 12 }, (_, index) => {
  const base = 1.09 + index * 0.0005;
  return { open: base, high: base + 0.002, low: base - 0.002,
    close: base + (bullish ? 0.001 : -0.001), timestamp: Date.now() - (12 - index) * 60_000 };
});
const buyWin = { features: [0.45, 0, 0, 0.5, 0, 0, 0, 1, 0, 0.7, 0], label: 1 as const, action: TradingAction.BUY };
const buyLoss = { features: [0.72, 0, 1, 0.9, 0, 1, 0, 0, 1, 0.3, 1], label: -1 as const, action: TradingAction.BUY };

describe('ML Engine action probability policy', () => {
  beforeEach(() => MLEngine.getInstance().reset());

  it('is DORMANT with zero influence and explicit probability semantics', () => {
    const result = MLEngine.getInstance().evaluateWinProbability(makeObservation(), TradingAction.BUY, makeCandles());
    expect(result).toMatchObject({ readiness: 'DORMANT', sampleSize: 0, confidenceBoost: 0,
      modelApplied: false, probabilityMeaning: 'ACTION_WIN_PROBABILITY', probabilityScale: 'RATIO_0_1' });
  });

  it('never blends a DORMANT model even when a classifier exists', () => {
    const ml = MLEngine.getInstance();
    const baseline = ml.evaluateWinProbability(makeObservation(), TradingAction.BUY, makeCandles()).probability;
    for (let i = 0; i < 10; i++) ml.ingestLabeledExamples([buyWin, buyLoss]);
    const after = ml.evaluateWinProbability(makeObservation(), TradingAction.BUY, makeCandles());
    expect(after.readiness).toBe('DORMANT');
    expect(after.modelApplied).toBe(false);
    expect(after.probability).toBe(baseline);
  });

  it('does not claim READY by summing unrelated under-ready assets', () => {
    const ml = MLEngine.getInstance();
    for (let i = 0; i < 30; i++) {
      ml.ingestLabeledExamples([{ ...buyWin, asset: 'EUR/USD' }, { ...buyLoss, asset: 'EUR/USD' },
        { ...buyWin, asset: 'Gold' }, { ...buyLoss, asset: 'Gold' }]);
    }
    expect(ml.getSampleCount()).toBe(120);
    expect(ml.getSampleCount('EUR/USD')).toBe(60);
    expect(ml.getSampleCount('Gold')).toBe(60);
    expect(ml.getReadiness()).toBe('TRAINING');
  });

  it('reports READY per asset and applies only a model that passes holdout quality', () => {
    const ml = MLEngine.getInstance();
    for (let i = 0; i < 80; i++) ml.ingestLabeledExamples([{ ...buyWin, asset: 'EUR/USD' }, { ...buyLoss, asset: 'EUR/USD' }]);
    const result = ml.evaluateWinProbability(makeObservation(), TradingAction.BUY, makeCandles());
    expect(ml.getReadiness('EUR/USD')).toBe('READY');
    expect(result.validationPassed).toBe(true);
    expect(result.modelApplied).toBe(true);
    expect(result.sampleSize).toBe(160);
  });

  it('same market state has direction-specific meaning', () => {
    const ml = MLEngine.getInstance();
    const raw = [0.35, 1, 0, 0.05, 1, 0, 0, 1, 0, 0.8, 0];
    for (let i = 0; i < 100; i++) {
      ml.ingestLabeledExamples([
        { features: raw, label: 1, action: TradingAction.BUY, asset: 'EUR/USD' },
        { features: raw, label: -1, action: TradingAction.SELL, asset: 'EUR/USD' },
      ]);
    }
    const observation = makeObservation({
      quantitativeMetrics: { ...(makeObservation().quantitativeMetrics as any),
        rsi: { value: 25, isOversold: true, isOverbought: false },
        bollingerBands: { percentB: 0.03, isSqueeze: false, width: 0.002 } } as any,
    });
    const buy = ml.evaluateWinProbability(observation, TradingAction.BUY, makeCandles(true));
    const sell = ml.evaluateWinProbability(observation, TradingAction.SELL, makeCandles(true));
    expect(buy.probability).toBeGreaterThan(sell.probability);
  });

  it('blocks a contradictory model at the holdout quality gate', () => {
    const ml = MLEngine.getInstance();
    const same = new Array(FEATURE_NAMES.length).fill(0.5);
    for (let i = 0; i < 80; i++) {
      ml.ingestLabeledExamples([
        { features: same, label: i % 2 === 0 ? 1 : -1, action: TradingAction.BUY, asset: 'EUR/USD' },
        { features: same, label: i % 2 === 0 ? -1 : 1, action: TradingAction.BUY, asset: 'EUR/USD' },
      ]);
    }
    const result = ml.evaluateWinProbability(makeObservation(), TradingAction.BUY, makeCandles());
    expect(result.readiness).toBe('READY');
    expect(result.validationPassed).toBe(false);
    expect(result.modelApplied).toBe(false);
    expect(result.confidenceBoost).toBe(0);
  });

  it('rejects examples without action provenance', () => {
    const ml = MLEngine.getInstance();
    ml.ingestLabeledExamples([
      { ...buyWin },
      { features: [0.1], label: 1, action: TradingAction.BUY } as any,
      { features: new Array(FEATURE_NAMES.length).fill(0.5), label: 1 } as any,
    ]);
    expect(ml.getSampleCount()).toBe(1);
  });

  it('keeps probabilities inside the documented ratio range', () => {
    const result = MLEngine.getInstance().evaluateWinProbability(makeObservation(), TradingAction.BUY, makeCandles());
    expect(result.probability).toBeGreaterThanOrEqual(0.1);
    expect(result.probability).toBeLessThanOrEqual(0.9);
  });
});
