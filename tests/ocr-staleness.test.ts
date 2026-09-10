import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OcrService } from '../electron/main/scanner/OcrService';

/**
 * Regression tests for the OCR staleness fixes:
 *
 * 1. A source that keeps reporting the SAME price must NOT re-stamp the
 *    freshness timestamp — otherwise a stale price is "fresh" forever.
 * 2. extractPriceFromTitle must maintain priceCacheTimestamp (previously only
 *    extractPriceFromText did, so the two freshness models contradicted).
 * 3. Generic (unlabeled) price matches must require a decimal part, so bare
 *    integers (balances, timers, counts) are not mistaken for the price.
 */
describe('OcrService Price Staleness', () => {
  let ocrService: OcrService;
  let now: number;

  beforeEach(() => {
    ocrService = new OcrService();
    now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('extractPriceFromTitle maintains priceCacheTimestamp and getFreshPrice', () => {
    ocrService.extractPriceFromTitle('EUR/USD 1.0842 — Olymp Trade');
    expect(ocrService.getFreshPrice()).toBe(1.0842);
    // Age should be ~0, not "unknown" (timestamp 0)
    expect(ocrService.getPriceCacheAgeMs()).toBeLessThan(50);
  });

  it('re-extracting the SAME price does not refresh staleness', () => {
    ocrService.extractPriceFromTitle('EUR/USD 1.0842 — Olymp Trade');
    expect(ocrService.getFreshPrice()).toBe(1.0842);

    // 6 seconds pass; the page stops updating (same title/price every scan)
    vi.setSystemTime(now + 6000);

    // A static source reports the same value again — must NOT re-stamp freshness
    const again = ocrService.extractPriceFromTitle('EUR/USD 1.0842 — Olymp Trade');
    expect(again).toBeNull();
    expect(ocrService.getFreshPrice()).toBeNull();
    expect(ocrService.getCachedOcrResults()!.currentPrice).toBeNull();
  });

  it('a NEW price refreshes the cache', () => {
    ocrService.extractPriceFromTitle('EUR/USD 1.0842 — Olymp Trade');
    vi.setSystemTime(now + 2000);

    const next = ocrService.extractPriceFromTitle('EUR/USD 1.0850 — Olymp Trade');
    expect(next).toBe(1.0850);
    expect(ocrService.getFreshPrice()).toBe(1.0850);
    expect(ocrService.getCachedOcrResults()!.currentPrice).toBe(1.0850);
  });

  it('stale cached price decays even when body text reports it again', () => {
    ocrService.extractPriceFromText('Price: 1.0842');
    expect(ocrService.getFreshPrice()).toBe(1.0842);

    vi.setSystemTime(now + 6000);

    // Same value from body text — no refresh
    expect(ocrService.extractPriceFromText('Price: 1.0842')).toBeNull();
    expect(ocrService.getCachedOcrResults()!.currentPrice).toBeNull();
  });

  it('generic price match requires a decimal part (bare integers rejected)', () => {
    // Balance/count integers must NOT be treated as the price
    expect(ocrService.extractPriceFromText('Balance: 1500 USD')).toBeNull();
    expect(ocrService.extractPriceFromText('EUR/USD 1.0842')).toBe(1.0842);
  });

  it('labeled price match still works', () => {
    expect(ocrService.extractPriceFromText('Current price: 1.0842')).toBe(1.0842);
    expect(ocrService.extractPriceFromText('Last: 1,084.20')).toBe(1084.2);
  });

  it('asset stays fresh while repeatedly matched (identifier semantics)', () => {
    ocrService.extractAssetFromTitle('EUR/USD — Olymp Trade');
    expect(ocrService.getCachedOcrResults()!.asset).toBe('EUR/USD');

    vi.setSystemTime(now + 3000);
    // Same asset reported again — still valid and fresh (no value-change gate)
    expect(ocrService.extractAssetFromTitle('EUR/USD — Olymp Trade')).toBe('EUR/USD');
    expect(ocrService.getCachedOcrResults()!.asset).toBe('EUR/USD');
  });

  it('currency-symbol stripping does not mangle asset letters (EUR/USD regression)', () => {
    // The 'R' inside EUR/USD must not be stripped as if it were a currency
    // symbol; otherwise the pair regex falls through to a garbage match.
    expect(ocrService.extractAssetFromTitle('EUR/USD — Olymp Trade')).toBe('EUR/USD');
    expect(ocrService.extractAssetFromTitle('GBP/USD (OTC)')).toBe('GBP/USD (OTC)');
    expect(ocrService.cleanAssetText('Gold price 2400.50 USD')).toBe('Gold');
  });
});
