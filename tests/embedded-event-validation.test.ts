import { describe, expect, it } from 'vitest';
import { PlatformMode } from '../shared/types/canonical';
import {
  parseBrowserTradeClickMessage,
  parseBrowserTradeResultMessage,
} from '../electron/main/view/embeddedEventValidation';

const now = 1_800_000_000_000;

describe('embedded browser detector event validation', () => {
  it('accepts a bounded exact click envelope', () => {
    const parsed = parseBrowserTradeClickMessage('[MARS_TRADE_CLICK]:' + JSON.stringify({
      action: 'BUY', eventId: 'click-1', executionId: 'exec-1', asset: 'EUR/USD',
      expiryText: '01:00', expirySeconds: 60, entryPrice: 1.08,
      platformMode: 'LIVE', timestamp: now,
    }), now);
    expect(parsed).toMatchObject({
      action: 'BUY', eventId: 'click-1', executionId: 'exec-1', asset: 'EUR/USD',
      expirySeconds: 60, entryPrice: 1.08, platformMode: PlatformMode.LIVE,
    });
  });

  it('rejects malformed actions and identifiers instead of coercing them', () => {
    expect(parseBrowserTradeClickMessage('[MARS_TRADE_CLICK]:{"action":"DELETE","eventId":"x"}', now)).toBeNull();
    expect(parseBrowserTradeClickMessage('[MARS_TRADE_CLICK]:{"action":"SELL","eventId":"../db"}', now)).toBeNull();
    expect(parseBrowserTradeClickMessage('[MARS_TRADE_CLICK]:not-json', now)).toBeNull();
  });

  it('keeps profit separate from a verified market completion price', () => {
    const parsed = parseBrowserTradeResultMessage('[MARS_TRADE_RESULT]:' + JSON.stringify({
      outcome: 'WIN', executionId: 'exec-1', profitAmount: 92.5,
      rawText: 'Trade result +$92.50', timestamp: now,
    }), now);
    expect(parsed).toMatchObject({
      outcome: 'WIN', executionId: 'exec-1', profitAmount: 92.5, completionPrice: null,
    });
  });

  it('accepts an explicit positive completion quote and rejects invalid outcomes', () => {
    expect(parseBrowserTradeResultMessage('[MARS_TRADE_RESULT]:' + JSON.stringify({
      outcome: 'LOSS', executionId: 'exec-2', completionPrice: 1.074,
      rawText: '-$10', timestamp: now,
    }), now)?.completionPrice).toBe(1.074);
    expect(parseBrowserTradeResultMessage('[MARS_TRADE_RESULT]:{"outcome":"PENDING"}', now)).toBeNull();
  });
});
