import { describe, it, expect } from 'vitest';
import { DataQualityGate } from '../electron/main/market/DataQualityGate';
import { MarketObservation } from '../shared/types/observation';
import { QualityLevel, CandleDirection, CandleObservation, FailureReasonCode } from '../shared/types/scanner';
import { PlatformMode, QualityGateRejection } from '../shared/types/canonical';

function createMockObservation(overrides: Partial<MarketObservation> = {}): MarketObservation {
  const candles: CandleObservation[] = Array.from({ length: 10 }, (_, index) => ({
    xPx: 10 + index * 15,
    wickTopPx: 10,
    bodyTopPx: 20,
    bodyBottomPx: 40,
    wickBottomPx: 50,
    direction: index % 2 === 0 ? CandleDirection.BULLISH : CandleDirection.BEARISH,
    bodySizePx: 20,
    rangePx: 40,
    quality: 0.8,
  }));
  return {
    sessionId: 'test-session',
    frameId: 'test-frame',
    timestamp: Date.now(),
    platformMode: PlatformMode.LIVE,
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

  it('passes a fresh high-quality LIVE observation', () => {
    const result = gate.evaluate(createMockObservation());
    expect(result.passed).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('blocks DEMO observations by default and requires explicit opt-in', () => {
    const demo = createMockObservation({ platformMode: PlatformMode.DEMO });
    const blocked = gate.evaluate(demo);
    expect(blocked.passed).toBe(false);
    expect(blocked.rejection).toBe(QualityGateRejection.DEMO_MODE);
    expect(gate.evaluate(demo, true).passed).toBe(true);
  });

  it('fails observation with insufficient candles', () => {
    const result = gate.evaluate(createMockObservation({ candles: [] }));
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(FailureReasonCode.INSUFFICIENT_MARKET_DATA);
  });

  it('fails observation with failed candle quality', () => {
    const result = gate.evaluate(createMockObservation({ candleQuality: QualityLevel.FAILED }));
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(FailureReasonCode.CANDLE_DETECTION_FAILED);
  });

  it('fails observation with failed data quality', () => {
    const result = gate.evaluate(createMockObservation({ dataQuality: QualityLevel.FAILED }));
    expect(result.passed).toBe(false);
    expect(result.reason).toBe(FailureReasonCode.DATA_QUALITY_GATE_FAILED);
  });
});
