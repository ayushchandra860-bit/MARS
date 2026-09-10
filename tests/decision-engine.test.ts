import { describe, it, expect } from 'vitest';
import { DecisionEngine } from '../electron/main/decision/DecisionEngine';
import { EvidenceEngine } from '../electron/main/decision/EvidenceEngine';
import { MarketObservation } from '../shared/types/observation';
import { QualityLevel, CandleDirection, CandleObservation } from '../shared/types/scanner';
import { TradingAction, WaitReason, RiskLevel } from '../shared/types/decision';
import {
  TrendDirection,
  MomentumLevel,
  VolatilityLevel,
  MarketStructure,
  MarketRegime,
  SRInteractionState,
  StructuralLevel,
} from '../shared/types/market';

function createFullObservation(overrides: Partial<MarketObservation> = {}): MarketObservation {
  const candles: CandleObservation[] = Array.from({ length: 10 }, (_, i) => ({
    xPx: 10 + i * 15,
    wickTopPx: 100 - i * 5,
    bodyTopPx: 105 - i * 5,
    bodyBottomPx: 120 - i * 5,
    wickBottomPx: 125 - i * 5,
    direction: CandleDirection.BULLISH,
    bodySizePx: 15,
    rangePx: 25,
    quality: 0.9,
  }));

  return {
    observationId: 'obs-test',
    sessionId: 'test-session',
    frameId: 'test-frame',
    timestamp: Date.now(),
    captureQuality: QualityLevel.HIGH,
    chartQuality: QualityLevel.HIGH,
    candleQuality: QualityLevel.HIGH,
    dataQuality: QualityLevel.HIGH,
    candles,
    asset: 'EURUSD',
    timeframe: '1M',
    currentPrice: 1.0920,
    trendEvidence: {
      direction: TrendDirection.BULLISH,
      strength: 0.85,
      swingProgression: [],
      candlesAnalyzed: 10,
    },
    momentumEvidence: {
      level: MomentumLevel.STRONG,
      directionalConsistency: 0.9,
      averageBodyRatio: 0.7,
      acceleration: 0.2,
    },
    volatilityEvidence: {
      level: VolatilityLevel.NORMAL,
      normalizedRange: 1.2,
      rangeStdDev: 0.1,
    },
    structureEvidence: {
      structure: MarketStructure.UPTREND,
      swingPoints: [],
      confidence: 0.85,
    },
    supportResistanceEvidence: {
      levels: [],
      nearestSupport: null,
      nearestResistance: null,
    },
    patternEvidence: { patterns: [] },
    ...overrides,
  };
}

function level(pricePx: number, role: 'SUPPORT' | 'RESISTANCE'): StructuralLevel {
  return {
    pricePx,
    touchCount: 3,
    strength: 0.8,
    strengthLabel: 'STRONG',
    role,
    distancePts: 10,
    interactionState: SRInteractionState.APPROACHING,
    reactionDetail: 'test level',
  };
}

describe('EvidenceEngine Dynamic Weighting Verification', () => {
  const evidenceEngine = new EvidenceEngine();

  it('verifies dynamic regime weight tables all sum to exactly 1.00', () => {
    const regimes = [
      MarketRegime.TRENDING,
      MarketRegime.RANGING,
      MarketRegime.HIGH_VOLATILITY,
      MarketRegime.CHOPPY,
      MarketRegime.BREAKOUT,
      MarketRegime.UNKNOWN,
    ];

    for (const regime of regimes) {
      const weights = (evidenceEngine as any).getRegimeWeights(regime);
      const sum = Object.values(weights).reduce((a: any, b: any) => a + b, 0);
      expect(Number((sum as number).toFixed(6))).toBe(1.00);
    }
  });

  it('verifies dynamic weighting changes overall strength according to MarketRegime', () => {
    const trendingRes = evidenceEngine.evaluate(createFullObservation({ marketRegime: MarketRegime.TRENDING }));
    const rangingRes = evidenceEngine.evaluate(createFullObservation({ marketRegime: MarketRegime.RANGING }));
    expect(trendingRes.overallStrength).toBeGreaterThan(0);
    expect(rangingRes.overallStrength).toBeGreaterThan(0);
    expect(trendingRes.overallStrength).not.toBe(rangingRes.overallStrength);
  });
});

describe('DecisionEngine', () => {
  const engine = new DecisionEngine();

  it('outputs BUY when bullish trend, strong momentum, and high agreement exist', () => {
    const result = engine.decide(createFullObservation());
    expect(result.action).toBe(TradingAction.BUY);
    expect(result.signalStrength).toBeGreaterThan(0.6);
  });

  it('outputs WAIT with SIDEWAYS_MARKET when market bias is neutral', () => {
    const result = engine.decide(createFullObservation({
      trendEvidence: {
        direction: TrendDirection.NEUTRAL,
        strength: 0.2,
        swingProgression: [],
        candlesAnalyzed: 10,
      },
      structureEvidence: {
        structure: MarketStructure.CONSOLIDATION,
        swingPoints: [],
        confidence: 0.5,
      },
    }));
    expect(result.action).toBe(TradingAction.WAIT);
    expect(result.reason).toBe(WaitReason.SIDEWAYS_MARKET);
  });

  it('outputs WAIT with WEAK_MOMENTUM when momentum is weak', () => {
    const result = engine.decide(createFullObservation({
      momentumEvidence: {
        level: MomentumLevel.WEAK,
        directionalConsistency: 0.3,
        averageBodyRatio: 0.2,
        acceleration: -0.1,
      },
    }));
    expect(result.action).toBe(TradingAction.WAIT);
    expect(result.reason).toBe(WaitReason.WEAK_MOMENTUM);
  });

  it('outputs WAIT when risk is high', () => {
    const result = engine.decide(createFullObservation({
      volatilityEvidence: {
        level: VolatilityLevel.HIGH,
        normalizedRange: 4.5,
        rangeStdDev: 2.0,
      },
      dataQuality: QualityLevel.ACCEPTABLE,
    }));
    expect(result.action).toBe(TradingAction.WAIT);
  });

  it('keeps pullback detection in pixel space regardless of OCR market price scale', () => {
    const observation = createFullObservation({
      currentPrice: 50000,
      supportResistanceEvidence: {
        levels: [],
        nearestSupport: level(68, 'SUPPORT'),
        nearestResistance: level(35, 'RESISTANCE'),
      },
    });
    const setup = engine.evaluateStrategicSetup(
      observation,
      MarketRegime.TRENDING,
      MomentumLevel.STRONG,
      MarketStructure.UPTREND,
    );
    expect(engine.getLatestClosePx(observation)).toBe(60);
    expect(setup?.type).toBe('PULLBACK_ENTRY');
    expect(setup?.direction).toBe(TradingAction.BUY);
  });

  it('keeps R:R invariant when only OCR market price changes', () => {
    const supportResistanceEvidence = {
      levels: [],
      nearestSupport: level(90, 'SUPPORT'),
      nearestResistance: level(40, 'RESISTANCE'),
    };
    const forex = createFullObservation({ currentPrice: 1.092, supportResistanceEvidence });
    const gold = createFullObservation({ currentPrice: 5000, supportResistanceEvidence });
    expect(engine.computeRRScore(forex, TradingAction.BUY))
      .toBe(engine.computeRRScore(gold, TradingAction.BUY));
  });

  it('scores risk/reward for the selected direction instead of the better opposite side', () => {
    const observation = createFullObservation({
      supportResistanceEvidence: {
        levels: [],
        nearestSupport: level(90, 'SUPPORT'),
        nearestResistance: level(40, 'RESISTANCE'),
      },
    });
    const buyScore = engine.computeRRScore(observation, TradingAction.BUY);
    const sellScore = engine.computeRRScore(observation, TradingAction.SELL);
    expect(buyScore).toBeLessThan(sellScore);
  });
});
