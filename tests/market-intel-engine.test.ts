import { describe, it, expect } from 'vitest';
import { MarketIntelEngine } from '../electron/main/market/MarketIntelEngine';
import { TradingAction, RiskLevel } from '../shared/types/decision';
import { MarketRegime, MomentumLevel, TrendDirection } from '../shared/types/market';
import { MarketIntelInput } from '../shared/types/ipc';

describe('MarketIntelEngine (Phase 3.7 Architecture)', () => {
  it('returns valid scanning fields when input observation is pending', () => {
    const engine = new MarketIntelEngine();
    const state = engine.evaluate({});

    expect(state.regime.primary).toBe('ANALYZING REGIME');
    expect(state.momentum.primary).toBe('ANALYZING MOMENTUM');
    expect(state.structure.primary).toBe('ANALYZING STRUCTURE');
    expect(state.liquidity).toBe('NO LIQUIDITY SWEEP');
    expect(state.pressure).toBe('PRESSURE UNAVAILABLE');
    expect(state.pressureSource).toBe('UNAVAILABLE');
    expect(state.pressureBuyPercent).toBeUndefined();
    expect(state.pressureSellPercent).toBeUndefined();
    expect(state.trendStrengthStatus).toBe('UNAVAILABLE');
    expect(state.support.display).toBe('SCANNING SUPPORT');
    expect(state.resistance.display).toBe('SCANNING RESISTANCE');
    expect(state.reversalRisk).toBe('LOW');
    expect(state.nextExpectation.primary).toBe('SCANNING STRUCTURE');
  });

  it('is strictly deterministic (identical input unconditionally produces identical output state)', () => {
    const engine = new MarketIntelEngine();
    const input: MarketIntelInput = {
      observation: {
        marketRegime: MarketRegime.TRENDING,
        trendEvidence: { direction: TrendDirection.BULLISH, strength: 0.85 },
        momentumEvidence: { level: MomentumLevel.STRONG, directionalConsistency: 0.85 } as any,
        structureEvidence: { structure: 'UPTREND' as any, confidence: 0.9, swingPoints: [] },
        supportResistanceEvidence: {
          nearestSupport: { distancePts: 18, interactionState: 'APPROACHING' } as any,
          nearestResistance: { distancePts: 24, interactionState: 'APPROACHING' } as any,
          levels: [],
        },
        quantitativeMetrics: {
          trendStrength: { status: 'VALID', adx: 85, choppiness: 32 },
        },
      } as any,
      decision: {
        action: TradingAction.BUY,
        confidence: 85,
        risk: RiskLevel.LOW,
        reasons: ['Higher Highs confirmed', 'Strong momentum'],
        marketBias: 'BULLISH',
      },
    };

    const run1 = engine.evaluate(input);
    const run2 = engine.evaluate(input);

    expect(run1).toEqual(run2);
    expect(run1.regime.primary).toBe('TRENDING BULLISH');
    expect(run1.momentum.primary).toBe('BUYERS DOMINATING');
    expect(run1.structure.primary).toBe('HIGHER HIGHS CONFIRMED');
    expect(run1.pressure).toBe('BUY PRESSURE STRONG');
    expect(run1.pressureSource).toBe('EVIDENCE');
    expect(run1.pressureBuyPercent).toBeGreaterThan(50);
    expect(run1.pressureSellPercent).toBeLessThan(50);
    expect(run1.trendStrength).toBe(85);
    expect(run1.trendStrengthStatus).toBe('CALCULATED');
    expect(run1.support.display).toBe('18 PTS BELOW');
    expect(run1.resistance.display).toBe('24 PTS ABOVE');
    expect(run1.reversalRisk).toBe('VERY LOW');
    expect(run1.nextExpectation.primary).toBe('CONTINUATION LIKELY');
  });

  it('returns immutable frozen objects', () => {
    const engine = new MarketIntelEngine();
    const state = engine.evaluate({});

    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.regime)).toBe(true);
    expect(Object.isFrozen(state.momentum)).toBe(true);
    expect(Object.isFrozen(state.support)).toBe(true);
  });

  it('includes debugMapping when debugMode is enabled', () => {
    const engine = new MarketIntelEngine();
    const state = engine.evaluate({ debugMode: true });

    expect(state.debugMapping).toBeDefined();
    expect(state.debugMapping?.regime).toBe('MarketRegimeAnalyzer');
    expect(state.debugMapping?.momentum).toBe('MomentumAnalyzer');
    expect(state.debugMapping?.structure).toBe('MarketStructureAnalyzer');
    expect(state.debugMapping?.liquidity).toBe('SupportResistanceAnalyzer');
    expect(state.debugMapping?.pressure).toBe('EvidenceEngine');
    expect(state.debugMapping?.support).toBe('SupportResistanceAnalyzer');
    expect(state.debugMapping?.resistance).toBe('SupportResistanceAnalyzer');
    expect(state.debugMapping?.reversalRisk).toBe('RiskEngine');
    expect(state.debugMapping?.nextExpectation).toBe('DecisionEngine');
  });
});
