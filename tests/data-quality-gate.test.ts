// ============================================================
// MARS PRO V3 — Data Quality Gate Tests
// ============================================================

import { describe, it, expect } from 'vitest';
import { DataQualityGate } from '../electron/main/market/DataQualityGate';
import { MarketObservation } from '../shared/types/observation';
import { QualityLevel, CandleDirection, CandleObservation, FailureReasonCode } from '../shared/types/scanner';

function createMockObservation(overrides: Partial<MarketObservation> = {}): MarketObservation {
  const candles: CandleObservation[] = Array.from({ length: 10 }, (_, i) => ({
    xPx: 10 + i * 15,
    wickTopPx: 10,
    bodyTopPx: 20,
    bodyBottomPx: 40,
    wickBottomPx: 50,
    direction: i % 2 === 0 ? CandleDirection.BULLISH : CandleDirection.BEARISH,
    bodySizePx: 20,
    rangePx: 40,
    quality: 0.8,
  }));

  return {
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
    trendEvidence: null,
    momentumEvidence: null,
    volatilityEvidence: null,
    structureEvidence: null,
    supportResistanceEvidence: null,
    patternEvidence: null,
    ...overrides,
  };
}

describe('DataQualityGate', () => {
  const gate = new DataQualityGate();

  it('passes high quality observation with sufficient candles', () => {
    const obs = createMockObservation();
    const result = gate.evaluate(obs);
    expect(result.passed).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('fails observation with insufficient candles', () => {
    const obs = createMockObservation({
      candles: [],
    });
    const result = gate.evaluate(obs);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(FailureReasonCode.INSUFFICIENT_MARKET_DATA);
  });

  it('fails observation with failed candle quality', () => {
    const obs = createMockObservation({
      candleQuality: QualityLevel.FAILED,
    });
    const result = gate.evaluate(obs);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(FailureReasonCode.CANDLE_DETECTION_FAILED);
  });

  it('fails observation with failed data quality', () => {
    const obs = createMockObservation({
      dataQuality: QualityLevel.FAILED,
    });
    const result = gate.evaluate(obs);
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(FailureReasonCode.DATA_QUALITY_GATE_FAILED);
  });
});
