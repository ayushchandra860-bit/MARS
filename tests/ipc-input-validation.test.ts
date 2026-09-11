import { describe, expect, it } from 'vitest';
import {
  validateBrowserUrl,
  validateHistoryQuery,
  validateIdentifierArray,
  validateManualTradeInput,
  validateOverlayPosition,
  validateReplayObservation,
  validateSettingsPatch,
  validateWorkstationTab,
} from '../electron/main/ipc/inputValidation';

describe('IPC input validation', () => {
  it('accepts valid workstation inputs and normalizes URLs', () => {
    expect(validateWorkstationTab('analytics')).toBe('analytics');
    expect(validateBrowserUrl('https://olymptrade.com/platform'))
      .toBe('https://olymptrade.com/platform');
    expect(validateOverlayPosition({ panelId: 'signal', x: 10, y: 20, width: 320, height: 440 }))
      .toEqual({ panelId: 'signal', x: 10, y: 20, width: 320, height: 440 });
  });

  it('rejects external navigation and unsupported tabs', () => {
    expect(() => validateBrowserUrl('https://olymptrade.com.evil.example/platform')).toThrow();
    expect(() => validateBrowserUrl('javascript:alert(1)')).toThrow();
    expect(() => validateWorkstationTab('devtools')).toThrow();
  });

  it('validates settings schema, types, and ranges', () => {
    expect(validateSettingsPatch({ soundEnabled: false, scanIntervalMs: 1500, overlayOpacity: 0.8 }))
      .toEqual({ soundEnabled: false, scanIntervalMs: 1500, overlayOpacity: 0.8 });
    expect(() => validateSettingsPatch({ soundEnabled: 'yes' })).toThrow();
    expect(() => validateSettingsPatch({ scanIntervalMs: 1 })).toThrow();
    expect(() => validateSettingsPatch({ arbitraryCode: true })).toThrow();
    expect(() => validateSettingsPatch({ overlayBounds: { x: 0, y: 0, width: -1, height: 400 } })).toThrow();
  });

  it('bounds history pagination and validates filters', () => {
    expect(validateHistoryQuery({ action: 'BUY', outcome: 'WIN', limit: 1000, offset: 0 }))
      .toEqual({ action: 'BUY', outcome: 'WIN', limit: 1000, offset: 0 });
    expect(() => validateHistoryQuery({ limit: 1001 })).toThrow();
    expect(() => validateHistoryQuery({ fromTimestamp: 20, toTimestamp: 10 })).toThrow();
    expect(() => validateHistoryQuery({ action: 'DELETE' })).toThrow();
  });

  it('validates manual trade data and destructive ID arrays', () => {
    expect(validateManualTradeInput({
      asset: 'EUR/USD', timeframe: '1m', action: 'SELL', outcome: 'LOSS', signalStrength: 75,
    })).toMatchObject({ asset: 'EUR/USD', action: 'SELL', outcome: 'LOSS', signalStrength: 75 });
    expect(() => validateManualTradeInput({ asset: 'EUR/USD', action: 'WAIT', outcome: 'WIN' })).toThrow();
    expect(validateIdentifierArray(['trade-1', 'trade-1', 'trade-2'])).toEqual(['trade-1', 'trade-2']);
    expect(() => validateIdentifierArray([])).toThrow();
    expect(() => validateIdentifierArray(['../database'])).toThrow();
  });

  it('bounds and parses observation replay payloads', () => {
    expect(validateReplayObservation('{"asset":"EUR/USD","currentPrice":1.08}'))
      .toEqual({ asset: 'EUR/USD', currentPrice: 1.08 });
    expect(() => validateReplayObservation('[1,2,3]')).toThrow();
    expect(() => validateReplayObservation('{bad json')).toThrow();
    expect(() => validateReplayObservation(`{"text":"${'x'.repeat(1_000_001)}"}`)).toThrow();
  });
});
