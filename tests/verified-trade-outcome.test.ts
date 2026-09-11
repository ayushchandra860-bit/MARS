import { describe, expect, it } from 'vitest';
import { TradingAction, TradeOutcome } from '../shared/types/decision';
import { deriveVerifiedPriceOutcome, normalizeAssetIdentity } from '../electron/main/trade/verifiedTradeOutcome';

describe('verified expiry price fallback', () => {
  const expiryTimestamp = 1_000_000;

  it('normalizes harmless asset formatting but not different assets', () => {
    expect(normalizeAssetIdentity('EUR / USD (OTC)')).toBe('EURUSDOTC');
    expect(normalizeAssetIdentity('GBP/USD')).not.toBe(normalizeAssetIdentity('EUR/USD'));
  });

  it('derives BUY and SELL outcomes only inside the expiry window', () => {
    expect(deriveVerifiedPriceOutcome(
      { asset: 'EUR/USD', direction: TradingAction.BUY, entryPrice: '1.1', expiryTimestamp },
      { asset: 'EUR USD', currentPrice: 1.2, timestamp: expiryTimestamp + 500 },
    )).toEqual({ outcome: TradeOutcome.WIN, completionPrice: '1.2' });

    expect(deriveVerifiedPriceOutcome(
      { asset: 'EUR/USD', direction: TradingAction.SELL, entryPrice: '1.1', expiryTimestamp },
      { asset: 'EUR/USD', currentPrice: 1.2, timestamp: expiryTimestamp + 500 },
    )).toEqual({ outcome: TradeOutcome.LOSS, completionPrice: '1.2' });
  });

  it('refuses cross-asset evidence', () => {
    expect(deriveVerifiedPriceOutcome(
      { asset: 'EUR/USD', direction: TradingAction.BUY, entryPrice: '1.1', expiryTimestamp },
      { asset: 'GBP/USD', currentPrice: 1.2, timestamp: expiryTimestamp },
    )).toBeNull();
  });

  it('refuses missing, zero or non-positive prices', () => {
    expect(deriveVerifiedPriceOutcome(
      { asset: 'EUR/USD', direction: TradingAction.BUY, entryPrice: null, expiryTimestamp },
      { asset: 'EUR/USD', currentPrice: 1.2, timestamp: expiryTimestamp },
    )).toBeNull();
    expect(deriveVerifiedPriceOutcome(
      { asset: 'EUR/USD', direction: TradingAction.BUY, entryPrice: '1.1', expiryTimestamp },
      { asset: 'EUR/USD', currentPrice: 0, timestamp: expiryTimestamp },
    )).toBeNull();
  });

  it('refuses stale observations instead of fabricating a late result', () => {
    expect(deriveVerifiedPriceOutcome(
      { asset: 'EUR/USD', direction: TradingAction.BUY, entryPrice: '1.1', expiryTimestamp },
      { asset: 'EUR/USD', currentPrice: 1.2, timestamp: expiryTimestamp + 20_000 },
    )).toBeNull();
  });
});
