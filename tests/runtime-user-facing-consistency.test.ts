import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SupportResistanceAnalyzer } from '../electron/main/market/SupportResistanceAnalyzer';
import { MarketIntelEngine } from '../electron/main/market/MarketIntelEngine';
import { TradingAction } from '../shared/types/decision';
import { SwingType, SRInteractionState } from '../shared/types/market';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

describe('runtime user-facing consistency', () => {
  it('keeps a placed trade active or result-pending instead of invalidating it', () => {
    const controller = read('electron/main/lifecycle/AnalysisController.ts');
    expect(controller).toContain("remaining > 0 ? 'TRADE ACTIVE' : 'RESULT PENDING'");
    expect(controller).toContain('A single noisy frame must not permanently invalidate a placed trade.');
    expect(controller).toContain('this.currentTradeHealth = TradeHealth.HEALTHY;');
  });

  it('does not report a visual level as HIT when the current wick never touched it', () => {
    const candles: any[] = [{
      xPx: 10, bodyTopPx: 120, bodyBottomPx: 130,
      wickTopPx: 115, wickBottomPx: 135, direction: 'BULLISH',
      bodySizePx: 10, rangePx: 20, quality: 1,
    }];
    const result = SupportResistanceAnalyzer.analyze(candles, [
      { index: 0, pricePx: 100, type: SwingType.HIGHER_HIGH },
      { index: 0, pricePx: 150, type: SwingType.LOWER_LOW },
    ]);
    expect(result.nearestResistance?.distancePts).toBe(20);
    expect(result.nearestSupport?.distancePts).toBe(30);
    expect(result.nearestResistance?.interactionState).toBe(SRInteractionState.APPROACHING);
    expect(result.nearestSupport?.interactionState).toBe(SRInteractionState.APPROACHING);

    const intel = new MarketIntelEngine().evaluate({
      observation: {
        marketRegime: null,
        candles,
        trendEvidence: null,
        momentumEvidence: null,
        volatilityEvidence: null,
        structureEvidence: null,
        supportResistanceEvidence: result,
      } as any,
      decision: { action: TradingAction.WAIT, reasons: [] },
    });
    expect(intel.support.status).not.toBe('HIT');
    expect(intel.resistance.status).not.toBe('HIT');
    expect(intel.support.display).toContain('VISUAL');
    expect(intel.resistance.display).toContain('VISUAL');
  });

  it('uses the backend runtimeValidation field and checks every warning family', () => {
    const analytics = read('frontend/src/control-center/AnalyticsView.tsx');
    expect(analytics).toContain('runtimeValidation: RuntimeValidationReport');
    expect(analytics).not.toContain('report.validationReport');
    expect(analytics).toContain('failingAssets?.length');
    expect(analytics).toContain('failingRegimes?.length');
    expect(analytics).toContain('INSUFFICIENT VERIFIED DATA');
  });

  it('does not fabricate zero-data duration or confidence', () => {
    const performance = read('frontend/src/control-center/PerformanceView.tsx');
    expect(performance).not.toContain('formatConfidenceNumeric(stats.avgConfidence) ?? 50');
    expect(performance).not.toContain('stats.avgTradeDurationSec || 60');
    expect(performance).toContain("avgConfNum === null ? '—'");
  });

  it('binds candle cache to asset and timeframe and preserves quote freshness', () => {
    const scanner = read('electron/main/scanner/LiveScanner.ts');
    expect(scanner).toContain('assetId: string | null;');
    expect(scanner).toContain('timeframeKey: string | null;');
    expect(scanner).toContain('contextKey !== this.marketContextKey');
    expect(scanner).toContain('expectedGeneration !== this.marketContextGeneration');
    expect(scanner).toContain('timestamp: observedAt');
    expect(scanner).toContain('freshness: computeFreshness(observedAt, now)');
    expect(scanner).toContain('getActiveMarketSnapshot(2200)');
  });

  it('uses visible quote nodes and unique expiry correlation', () => {
    const detector = read('electron/main/view/embeddedTradeDetector.ts');
    expect(detector).toContain('getBoundingClientRect');
    expect(detector).toContain('dueDelta <= 20000');
    expect(detector).toContain('candidates[1].dueDelta - candidates[0].dueDelta < 2000');
  });
});
