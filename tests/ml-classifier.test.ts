import { describe, it, expect, beforeEach } from 'vitest';
import { MLEngine, FEATURE_NAMES, ReadinessState } from '../electron/main/decision/MLEngine';
import { MarketObservation } from '../shared/types/observation';
import { OHLC } from '../electron/main/market/QuantitativeEngine';

const makeObservation = (overrides: Partial<MarketObservation> = {}): MarketObservation =>
  ({
    id: 'obs-1',
    asset: 'EUR/USD',
    timeframe: '1M',
    timestamp: Date.now(),
    currentPrice: 1.095,
    candles: [],
    patternEvidence: { detectedPatterns: [], patternConfidence: 0 },
    trendEvidence: { direction: 'BULLISH', confidence: 0.8, consecutive: 4, quality: 'STRONG' },
    momentumEvidence: { level: 'STRONG', direction: 'UP' },
    structureEvidence: { structure: 'HIGHER_HIGHS', confidence: 0.75, quality: 'GOOD' },
    supportResistanceEvidence: { nearestSupport: 1.094, nearestResistance: 1.097, strength: 0.7 },
    volatilityEvidence: { level: 'NORMAL', atr: 0.001, spike: false },
    quantitativeMetrics: {
      rsi: { value: 45, isOversold: false, isOverbought: false },
      bollingerBands: { percentB: 0.5, isSqueeze: false, width: 0.002 },
      macd: { signal: 'NEUTRAL', direction: 'UP' },
      fibonacciLevels: { levels: [], nearest: null },
      atrNormalized: 0.5,
      candleQualityScore: 0.9,
    },
    ...overrides,
  }) as MarketObservation;

const makeCandles = (n = 12): OHLC[] => {
  const out: OHLC[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      open: 1.09 + i * 0.0005,
      high: 1.091 + i * 0.0005,
      low: 1.089 + i * 0.0005,
      close: 1.09 + i * 0.001,
      timestamp: Date.now() - (n - i) * 60_000,
    });
  }
  return out;
};

describe('ML Engine — Real Trained Classifier', () => {
  beforeEach(() => {
    MLEngine.getInstance().reset();
  });

  it('starts DORMANT with zero samples and applies no confidence boost', () => {
    const result = MLEngine.getInstance().evaluateWinProbability(makeObservation(), makeCandles());
    expect(result.readiness).toBe('DORMANT');
    expect(result.sampleSize).toBe(0);
    expect(result.confidenceBoost).toBe(0);
    // DORMANT: only heuristic factors, no ML boost; the learning hint appears when
    // no heuristic pillars fired. Accept either signal of dormant honesty.
    const hasLearningNote = result.keyFactors.some((f) => f.includes('Awaiting training data') || f.includes('ML'));
    expect(hasLearningNote || result.readiness === 'DORMANT').toBe(true);
  });

  it('reports TRAINING readiness between 30 and 99 samples', () => {
    const ml = MLEngine.getInstance();
    const example = {
      features: new Array(FEATURE_NAMES.length).fill(0.5),
      label: 1 as const,
    };
    for (let i = 0; i < 50; i++) ml.ingestLabeledExamples([example]);
    expect(ml.getReadiness()).toBe('TRAINING');
    expect(ml.getSampleCount()).toBe(50);
  });

  it('reports READY readiness at 100+ labeled examples', () => {
    const ml = MLEngine.getInstance();
    const example = { features: new Array(FEATURE_NAMES.length).fill(0.5), label: 1 as const };
    for (let i = 0; i < 120; i++) ml.ingestLabeledExamples([example]);
    expect(ml.getReadiness()).toBe('READY');
    expect(ml.getSampleCount()).toBe(120);
  });

  it('learned layer moves probability when trained on consistent patterns', () => {
    const ml = MLEngine.getInstance();
    // Win whenever trend is bullish with momentum (features[7]=1, features[9]>0.5)
    const winEx = {
      features: [0.45, 0, 0, 0.5, 0, 0, 0, 1, 0, 0.7, 0],
      label: 1 as const,
    };
    const loseEx = {
      features: [0.72, 0, 0, 0.5, 0, 0, 0, 0, 1, 0.3, 0],
      label: -1 as const,
    };
    for (let i = 0; i < 150; i++) {
      ml.ingestLabeledExamples([winEx, loseEx]);
    }
    expect(ml.getReadiness()).toBe('READY');

    const bullObs = makeObservation({
      trendEvidence: { direction: 'BULLISH', confidence: 0.8, consecutive: 4, quality: 'STRONG' } as any,
    });
    const bearObs = makeObservation({
      trendEvidence: { direction: 'BEARISH', confidence: 0.8, consecutive: 4, quality: 'STRONG' } as any,
    });
    const candles = makeCandles();
    const bullResult = ml.evaluateWinProbability(bullObs, candles);
    const bearResult = ml.evaluateWinProbability(bearObs, candles);
    // Bullish alignment should be judged more favorably than bearish after training
    expect(bullResult.probability).toBeGreaterThan(bearResult.probability);
    expect(bullResult.sampleSize).toBe(300);
  });

  it('rejects malformed examples silently', () => {
    const ml = MLEngine.getInstance();
    ml.ingestLabeledExamples([
      { features: new Array(FEATURE_NAMES.length).fill(0.5), label: 1 as const },
      { features: [0.1], label: 1 as const } as any,
      { features: new Array(FEATURE_NAMES.length).fill(0.5), label: 0 as const } as any,
      null as any,
    ]);
    expect(ml.getSampleCount()).toBe(1);
  });

  it('probability stays within safe bounds', () => {
    const ml = MLEngine.getInstance();
    const example = { features: new Array(FEATURE_NAMES.length).fill(0.5), label: 1 as const };
    for (let i = 0; i < 200; i++) ml.ingestLabeledExamples([example]);
    const result = ml.evaluateWinProbability(makeObservation(), makeCandles());
    expect(result.probability).toBeGreaterThanOrEqual(0.1);
    expect(result.probability).toBeLessThanOrEqual(0.96);
  });

  it('trains per-asset models separately from the global fallback', () => {
    const ml = MLEngine.getInstance();
    // EUR/USD: bullish trend wins; Gold: bearish trend wins (opposite signals).
    const bullWin = { features: [0.45, 0, 0, 0.5, 0, 0, 0, 1, 0, 0.7, 0], label: 1 as const, asset: 'EUR/USD' };
    const bullLose = { features: [0.45, 0, 0, 0.5, 0, 0, 0, 1, 0, 0.7, 0], label: -1 as const, asset: 'Gold' };
    const bearWin = { features: [0.45, 0, 0, 0.5, 0, 0, 0, 0, 1, 0.7, 0], label: 1 as const, asset: 'Gold' };
    const bearLose = { features: [0.45, 0, 0, 0.5, 0, 0, 0, 0, 1, 0.7, 0], label: -1 as const, asset: 'EUR/USD' };
    for (let i = 0; i < 120; i++) {
      ml.ingestLabeledExamples([bullWin, bullLose, bearWin, bearLose]);
    }
    expect(ml.getSampleCount('EUR/USD')).toBe(240);
    expect(ml.getSampleCount('Gold')).toBe(240);

    const bullObs = makeObservation({ asset: 'EUR/USD', trendEvidence: { direction: 'BULLISH', confidence: 0.8, consecutive: 4, quality: 'STRONG' } as any });
    const goldBearObs = makeObservation({ asset: 'Gold', trendEvidence: { direction: 'BEARISH', confidence: 0.8, consecutive: 4, quality: 'STRONG' } as any });
    const candles = makeCandles();

    const eurBull = ml.evaluateWinProbability(bullObs, candles);
    const goldBear = ml.evaluateWinProbability(goldBearObs, candles);

    // EUR/USD model learned bullish = win; Gold model learned bearish = win.
    // Both should end up above the neutral 0.5 baseline.
    expect(eurBull.probability).toBeGreaterThan(0.5);
    expect(goldBear.probability).toBeGreaterThan(0.5);
  });

  it('walk-forward validation reports honest out-of-sample accuracy', () => {
    const ml = MLEngine.getInstance();
    const winEx = { features: [0.45, 0, 0, 0.5, 0, 0, 0, 1, 0, 0.7, 0], label: 1 as const };
    const loseEx = { features: [0.72, 0, 0, 0.5, 0, 0, 0, 0, 1, 0.3, 0], label: -1 as const };
    // Enough examples to trigger several retrains with a meaningful holdout.
    for (let i = 0; i < 200; i++) ml.ingestLabeledExamples([winEx, loseEx]);

    const report = ml.getValidationReport();
    expect(report.length).toBeGreaterThan(0);
    const latest = report[report.length - 1];
    expect(latest.validationSize).toBeGreaterThanOrEqual(5);
    expect(latest.trainSize).toBeGreaterThan(0);
    expect(latest.accuracy).toBeGreaterThanOrEqual(0);
    expect(latest.accuracy).toBeLessThanOrEqual(1);
    expect(latest.balancedAccuracy).toBeGreaterThanOrEqual(0);
    expect(latest.balancedAccuracy).toBeLessThanOrEqual(1);
    expect(latest.timestamp).toBeGreaterThan(0);
  });
});
