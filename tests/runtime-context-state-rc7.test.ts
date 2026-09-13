import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDurationSeconds } from '../electron/main/view/embeddedEventValidation';
import { buildEmbeddedTradeDetectorScript } from '../electron/main/view/embeddedTradeDetector';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

describe('RC7 runtime market-context contract', () => {
  it('parses broker duration labels without inventing a default', () => {
    expect(parseDurationSeconds('1 min')).toBe(60);
    expect(parseDurationSeconds('01:00')).toBe(60);
    expect(parseDurationSeconds('45 sec')).toBe(45);
    expect(parseDurationSeconds(null)).toBeNull();
    expect(parseDurationSeconds('8099.2235')).toBeNull();
  });

  it('separates chart timeframe, trade duration, and analysis-horizon provenance', () => {
    const detector = buildEmbeddedTradeDetectorScript();
    expect(detector).toContain('detectChartTimeframe');
    expect(detector).toContain('detectTradeDuration');
    expect(detector).toContain("timeframeSource: timeframeSource");
    expect(detector).toContain("findDurationNearLabel(root, /^(duration|expiry|expiration)$/i)");
  });

  it('never converts a missing duration into a fake active 60-second trade', () => {
    const detector = read('electron/main/view/embeddedTradeDetector.ts');
    const validation = read('electron/main/view/embeddedEventValidation.ts');
    const evidence = read('electron/main/trade/TrustedExecutionEvidence.ts');
    const browser = read('electron/main/view/EmbeddedBrowserManager.ts');
    expect(detector).not.toContain('return 60;');
    expect(validation).not.toContain('?? 60');
    expect(evidence).not.toContain(': 60,');
    expect(browser).toContain('broker duration was unavailable');
  });

  it('keeps missing context on safe WAIT and labels manual tracking separately', () => {
    const controller = read('electron/main/lifecycle/AnalysisController.ts');
    const panel = read('frontend/src/overlay/SignalPanel.tsx');
    expect(controller).toContain('|| rejection === QualityGateRejection.INVALID_TIMEFRAME');
    expect(controller).toContain("source: activeSignalMatches ? 'SIGNAL' : 'MANUAL'");
    expect(panel).toContain('MANUAL TRADE TRACKING');
  });
});
