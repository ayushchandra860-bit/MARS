import { describe, expect, it } from 'vitest';
import { LiveScanner } from '../electron/main/scanner/LiveScanner';
import { DataQualityGate } from '../electron/main/market/DataQualityGate';
import { PlatformMode } from '../shared/types/canonical';
import { CandleDirection, QualityLevel } from '../shared/types/scanner';

const candles = Array.from({ length: 3 }, (_, index) => ({
  xPx: index * 10,
  wickTopPx: 1,
  bodyTopPx: 3,
  bodyBottomPx: 7,
  wickBottomPx: 9,
  direction: CandleDirection.BULLISH,
  bodySizePx: 4,
  rangePx: 8,
  quality: 0.95,
}));

describe('runtime scanner warm-up recovery', () => {
  it('treats three clean detected candles as acceptable evidence', () => {
    const scanner = new LiveScanner() as any;
    expect(scanner.deriveDataQuality(3, QualityLevel.ACCEPTABLE, 0.92, 'Maha Jantar Index'))
      .toBe(QualityLevel.ACCEPTABLE);
  });

  it('accepts normalized and broker-style minute labels', () => {
    expect(DataQualityGate.isSupportedTimeframe('1m')).toBe(true);
    expect(DataQualityGate.isSupportedTimeframe('1 min')).toBe(true);
  });

  it('allows a clean three-candle demo observation through the safety gate', () => {
    const gate = new DataQualityGate();
    expect(gate.evaluate({
      observationId: 'warmup', sessionId: 's', frameId: 'f', timestamp: Date.now(),
      platformMode: PlatformMode.DEMO, asset: 'Maha Jantar Index', timeframe: '1m', currentPrice: 8095.6733,
      captureQuality: QualityLevel.HIGH, chartQuality: QualityLevel.HIGH,
      candleQuality: QualityLevel.ACCEPTABLE, dataQuality: QualityLevel.ACCEPTABLE, candles,
      trendEvidence: null, momentumEvidence: null, volatilityEvidence: null,
      structureEvidence: null, supportResistanceEvidence: null, patternEvidence: null,
    }, true).passed).toBe(true);
  });
});
