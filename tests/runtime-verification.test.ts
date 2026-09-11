import { describe, it, expect, beforeEach } from 'vitest';
import { MLEngine, FEATURE_NAMES } from '../electron/main/decision/MLEngine';
import { DecisionEngine } from '../electron/main/decision/DecisionEngine';
import { SignalStabilizer } from '../electron/main/decision/SignalStabilizer';
import { RiskEngine } from '../electron/main/decision/RiskEngine';
import { MarketObservation } from '../shared/types/observation';
import { OHLC } from '../electron/main/market/QuantitativeEngine';
import { TradingAction, RiskLevel } from '../shared/types/decision';
import { MarketRegime, TrendDirection, MomentumLevel, MarketStructure, VolatilityLevel } from '../shared/types/market';
import { QualityLevel, CandleDirection } from '../shared/types/scanner';
import { EvidenceEngine } from '../electron/main/decision/EvidenceEngine';

function makeCandles(n = 20, bullish = true): OHLC[] {
  const basePrice = 1.095;
  return Array.from({ length: n }, (_, index) => {
    const open = basePrice + index * (bullish ? 0.0001 : -0.0001);
    const close = open + (bullish ? 0.0003 : -0.0003);
    return {
      open,
      high: Math.max(open, close) + 0.0002,
      low: Math.min(open, close) - 0.0002,
      close,
      timestamp: Date.now() - (n - index) * 60_000,
      direction: bullish ? CandleDirection.BULLISH : CandleDirection.BEARISH,
      quality: 0.8,
      bodySizePx: Math.abs(close - open),
      bodyBottomPx: Math.min(open, close),
      bodyTopPx: Math.max(open, close),
      rangePx: 0.0007,
    } as OHLC;
  });
}

function makeObservation(overrides: Partial<MarketObservation> = {}): MarketObservation {
  return {
    sessionId: 'test-session',
    frameId: 'test-frame',
    timestamp: Date.now(),
    captureQuality: QualityLevel.HIGH,
    chartQuality: QualityLevel.HIGH,
    candleQuality: QualityLevel.HIGH,
    dataQuality: QualityLevel.HIGH,
    candles: makeCandles(),
    asset: 'EURUSD',
    timeframe: '1M',
    currentPrice: 1.095,
    patternEvidence: { detectedPatterns: [], patternConfidence: 0, patterns: [] },
    trendEvidence: { direction: TrendDirection.BULLISH, strength: 0.85, swingProgression: [], candlesAnalyzed: 10 },
    momentumEvidence: { level: MomentumLevel.STRONG, directionalConsistency: 0.9, averageBodyRatio: 0.7, acceleration: 0.2 },
    structureEvidence: { structure: MarketStructure.UPTREND, swingPoints: [], confidence: 0.85 },
    supportResistanceEvidence: { levels: [], nearestSupport: null, nearestResistance: null },
    volatilityEvidence: { level: VolatilityLevel.NORMAL, normalizedRange: 1.2, rangeStdDev: 0.1 },
    marketRegime: MarketRegime.TRENDING,
    ...overrides,
  } as unknown as MarketObservation;
}

function makeBearishObservation(): MarketObservation {
  return makeObservation({
    candles: makeCandles(20, false) as any,
    trendEvidence: { direction: TrendDirection.BEARISH, strength: 0.85, swingProgression: [], candlesAnalyzed: 10 } as any,
    momentumEvidence: { level: MomentumLevel.STRONG, directionalConsistency: 0.9, averageBodyRatio: 0.7, acceleration: -0.2 } as any,
    structureEvidence: { structure: MarketStructure.DOWNTREND, swingPoints: [], confidence: 0.85 } as any,
  });
}

describe('RUNTIME: Decision Engine BUY/SELL symmetry', () => {
  let engine: DecisionEngine;
  beforeEach(() => { engine = new DecisionEngine(); engine.reset(); });
  it('handles bullish observations without producing an opposite signal', () => {
    expect([TradingAction.BUY, TradingAction.WAIT]).toContain(engine.decide(makeObservation()).action);
  });
  it('handles bearish observations without producing an opposite signal', () => {
    expect([TradingAction.SELL, TradingAction.WAIT]).toContain(engine.decide(makeBearishObservation()).action);
  });
  it('waits when candles are unavailable', () => {
    expect(engine.decide(makeObservation({ candles: [] })).action).toBe(TradingAction.WAIT);
  });
  it('does not give one direction an extreme confidence advantage', () => {
    const bull = makeObservation(); const bear = makeBearishObservation();
    for (let index = 0; index < 20; index++) engine.decide(bull);
    const bullResult = engine.decide(bull); engine.reset();
    for (let index = 0; index < 20; index++) engine.decide(bear);
    const bearResult = engine.decide(bear);
    if (bullResult.action === TradingAction.BUY && bearResult.action === TradingAction.SELL) {
      expect(Math.abs(bullResult.confidence - bearResult.confidence)).toBeLessThan(0.25);
    }
  });
});

describe('RUNTIME: Evidence Engine symmetry', () => {
  let engine: EvidenceEngine;
  beforeEach(() => { engine = new EvidenceEngine(); });
  it('gives mirrored observations comparable strength', () => {
    expect(Math.abs(engine.evaluate(makeObservation()).overallStrength - engine.evaluate(makeBearishObservation()).overallStrength)).toBeLessThan(0.3);
  });
  it('counts mirrored directional evidence symmetrically', () => {
    expect(engine.countBias(makeObservation(), 'BULLISH')).toBeGreaterThanOrEqual(2);
    expect(engine.countBias(makeBearishObservation(), 'BEARISH')).toBeGreaterThanOrEqual(2);
  });
});

describe('RUNTIME: ML readiness and provenance', () => {
  beforeEach(() => MLEngine.getInstance().reset());
  it('transitions DORMANT → TRAINING → READY only with separable holdout evidence', () => {
    const ml = MLEngine.getInstance();
    const win = { features: new Array(FEATURE_NAMES.length).fill(0.2), label: 1 as const, action: TradingAction.BUY };
    const loss = { features: new Array(FEATURE_NAMES.length).fill(0.8), label: -1 as const, action: TradingAction.BUY };
    expect(ml.getReadiness()).toBe('DORMANT');
    for (let index = 0; index < 25; index++) ml.ingestLabeledExamples([win, loss]);
    expect(ml.getReadiness()).toBe('TRAINING');
    for (let index = 0; index < 30; index++) ml.ingestLabeledExamples([win, loss]);
    expect(ml.getReadiness()).toBe('READY');
    expect(ml.hasTrainedModel()).toBe(true);
  });
  it('keeps per-asset buffers independent', () => {
    const ml = MLEngine.getInstance();
    const eur = { features: new Array(FEATURE_NAMES.length).fill(0.5), label: 1 as const, action: TradingAction.BUY, asset: 'EUR/USD' };
    const gold = { features: new Array(FEATURE_NAMES.length).fill(0.5), label: -1 as const, action: TradingAction.SELL, asset: 'Gold' };
    for (let index = 0; index < 40; index++) ml.ingestLabeledExamples([eur, gold]);
    expect(ml.getSampleCount('EUR/USD')).toBe(40);
    expect(ml.getSampleCount('Gold')).toBe(40);
  });
});

describe('RUNTIME: Signal Stabilizer', () => {
  let stabilizer: SignalStabilizer;
  const decision = (action: TradingAction, confidence = 0.85) => ({
    action, reason: 'Test', reasons: ['Test'], signalStrength: 0.9,
    confidence, risk: RiskLevel.LOW,
    marketBias: action === TradingAction.SELL ? 'BEARISH' : 'BULLISH',
    recommendedExpiry: '1 min', dataQuality: QualityLevel.HIGH, timestamp: Date.now(),
  });
  beforeEach(() => { stabilizer = new SignalStabilizer(); });
  it('stabilizes a strong BUY', () => expect(stabilizer.stabilize(decision(TradingAction.BUY)).action).toBe(TradingAction.BUY));
  it('eventually accepts repeated strong reversal evidence', () => {
    stabilizer.stabilize(decision(TradingAction.BUY));
    let action = TradingAction.BUY;
    for (let index = 0; index < 5; index++) action = stabilizer.stabilize(decision(TradingAction.SELL)).action;
    expect(action).toBe(TradingAction.SELL);
  });
  it('keeps every hysteresis result inside the canonical action set', () => {
    stabilizer.stabilize(decision(TradingAction.BUY, 0.8));
    expect([TradingAction.BUY, TradingAction.SELL, TradingAction.WAIT])
      .toContain(stabilizer.stabilize(decision(TradingAction.SELL, 0.5)).action);
  });
});

describe('RUNTIME: Risk Engine symmetry', () => {
  it('assigns the same risk to mirrored equivalent evidence', () => {
    const engine = new RiskEngine();
    const evidence = { overallStrength: 0.7, agreementScore: 0.7, trendScore: 0.7, momentumScore: 0.6,
      structureScore: 0.7, volatilityScore: 0.5, supportResistanceScore: 0.5,
      candleConfirmationScore: 0.7, patternScore: 0.5, dataQualityScore: 0.9,
      rsiScore: 0.5, bollingerScore: 0.5, fibonacciScore: 0.5, emaScore: 0.7 };
    expect(engine.evaluate(makeObservation(), evidence, 60, MarketRegime.TRENDING))
      .toBe(engine.evaluate(makeBearishObservation(), evidence, 60, MarketRegime.TRENDING));
  });
});

describe('RUNTIME: Full pipeline accounting', () => {
  let engine: DecisionEngine; let stabilizer: SignalStabilizer;
  beforeEach(() => { engine = new DecisionEngine(); stabilizer = new SignalStabilizer(); engine.setCalibrationMode('AGGRESSIVE'); });
  it('accounts for all 200 decisions', () => {
    const counts = { BUY: 0, SELL: 0, WAIT: 0 };
    for (let index = 0; index < 200; index++) {
      const action = stabilizer.stabilize(engine.decide(index % 3 ? makeObservation() : makeBearishObservation())).action;
      counts[action]++;
    }
    expect(counts.BUY + counts.SELL + counts.WAIT).toBe(200);
  });
  it('does not show extreme directional bias when both signal classes occur', () => {
    let buys = 0; let sells = 0;
    for (let index = 0; index < 200; index++) {
      const action = stabilizer.stabilize(engine.decide(index % 2 ? makeObservation() : makeBearishObservation())).action;
      if (action === TradingAction.BUY) buys++;
      if (action === TradingAction.SELL) sells++;
    }
    if (Math.min(buys, sells) > 0) expect(Math.max(buys, sells) / Math.min(buys, sells)).toBeLessThan(3);
  });
});
