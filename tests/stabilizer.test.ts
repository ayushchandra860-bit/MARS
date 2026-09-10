// ============================================================
// MARS PRO V3 — Signal Stabilizer Tests
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { SignalStabilizer } from '../electron/main/decision/SignalStabilizer';
import { RawDecisionResult, TradingAction, RiskLevel } from '../shared/types/decision';
import { MarketBias } from '../shared/types/market';
import { QualityLevel } from '../shared/types/scanner';

function createRawDecision(action: TradingAction, strength = 0.75): RawDecisionResult {
  return {
    action,
    reason: 'Test reason',
    reasons: ['Test reason'],
    signalStrength: strength,
    confidence: strength,
    risk: RiskLevel.LOW,
    marketBias: action === TradingAction.BUY ? MarketBias.BULLISH : action === TradingAction.SELL ? MarketBias.BEARISH : MarketBias.NEUTRAL,
    recommendedExpiry: '1M',
    dataQuality: QualityLevel.HIGH,
    timestamp: Date.now(),
  };
}

describe('SignalStabilizer', () => {
  let stabilizer: SignalStabilizer;

  beforeEach(() => {
    stabilizer = new SignalStabilizer();
  });

  it('starts in WAIT state', () => {
    const result = stabilizer.stabilize(createRawDecision(TradingAction.WAIT));
    expect(result.action).toBe(TradingAction.WAIT);
    expect(result.wasStabilized).toBe(false);
  });

  it('stabilizes WAIT ? BUY transition requiring 5 consecutive BUY frames', () => {
    // Frames 1-4: BUY signals -> should remain WAIT (stabilizing)
    for (let i = 1; i <= 4; i++) {
      const frame = stabilizer.stabilize(createRawDecision(TradingAction.BUY, 0.7));
      expect(frame.action).toBe(TradingAction.WAIT);
      expect(frame.wasStabilized).toBe(true);
    }

    // Frame 5: Fifth BUY signal -> transitions to BUY
    const frame5 = stabilizer.stabilize(createRawDecision(TradingAction.BUY, 0.7));
    expect(frame5.action).toBe(TradingAction.BUY);
    expect(frame5.wasStabilized).toBe(false);
  });

  it('bypasses hysteresis for extremely strong signal (>0.88 strength)', () => {
    const frame1 = stabilizer.stabilize(createRawDecision(TradingAction.BUY, 0.89));
    expect(frame1.action).toBe(TradingAction.BUY);
  });

  it('resets state on reset()', () => {
    stabilizer.stabilize(createRawDecision(TradingAction.BUY, 0.89));
    stabilizer.reset();
    const result = stabilizer.stabilize(createRawDecision(TradingAction.WAIT));
    expect(result.action).toBe(TradingAction.WAIT);
    expect(result.frameConsistency).toBe(1);
  });
});
