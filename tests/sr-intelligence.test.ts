import { describe, it, expect } from 'vitest';
import { SupportResistanceAnalyzer } from '../electron/main/market/SupportResistanceAnalyzer';
import { CandleObservation } from '../shared/types/scanner';
import { SwingPoint, SwingType, SRInteractionState } from '../shared/types/market';

describe('SupportResistanceAnalyzer State Machine', () => {
  it('should detect levels and assign strength labels', () => {
    const swingPoints: SwingPoint[] = [
      { index: 2, pricePx: 100, type: SwingType.LOWER_LOW },
      { index: 5, pricePx: 102, type: SwingType.HIGHER_LOW },
      { index: 8, pricePx: 99, type: SwingType.LOWER_LOW },
    ];

    const candles: CandleObservation[] = [
      { xPx: 10, bodyTopPx: 70, bodyBottomPx: 80, wickTopPx: 65, wickBottomPx: 85, direction: 'BEARISH', bodySizePx: 10, rangePx: 20, quality: 'HIGH' as any },
    ];

    const result = SupportResistanceAnalyzer.analyze(candles, swingPoints);
    expect(result.levels.length).toBeGreaterThan(0);
    expect(result.levels[0].strengthLabel).toBe('STRONG');
  });

  it('should calculate level distances and interaction states', () => {
    const swingPoints: SwingPoint[] = [
      { index: 1, pricePx: 150, type: SwingType.LOWER_LOW },
    ];

    const candles: CandleObservation[] = [
      { xPx: 10, bodyTopPx: 120, bodyBottomPx: 130, wickTopPx: 115, wickBottomPx: 135, direction: 'BULLISH', bodySizePx: 10, rangePx: 20, quality: 'HIGH' as any },
    ];

    const result = SupportResistanceAnalyzer.analyze(candles, swingPoints);
    expect(result.nearestSupport).not.toBeNull();
    if (result.nearestSupport) {
      expect(result.nearestSupport.distancePts).toBe(20);
      expect(result.nearestSupport.interactionState).toBe(SRInteractionState.APPROACHING);
    }
  });
});
