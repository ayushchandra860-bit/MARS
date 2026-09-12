import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OcrService } from '../electron/main/scanner/OcrService';

/**
 * Quote freshness and movement are separate concepts:
 * - observed age proves the source is still sending valid data;
 * - change age records how long the numeric value has stayed unchanged.
 */
describe('OcrService Price Freshness', () => {
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

  it('extractPriceFromTitle maintains a fresh quote heartbeat', () => {
    ocrService.extractPriceFromTitle('EUR/USD 1.0842 — Olymp Trade');
    expect(ocrService.getFreshPrice()).toBe(1.0842);
    expect(ocrService.getPriceCacheAgeMs()).toBeLessThan(50);
  });

  it('re-extracting the same valid price refreshes observation but not change age', () => {
    ocrService.extractPriceFromTitle('EUR/USD 1.0842 — Olymp Trade');
    vi.setSystemTime(now + 6000);

    const again = ocrService.extractPriceFromTitle('EUR/USD 1.0842 — Olymp Trade');
    expect(again).toBe(1.0842);
    expect(ocrService.getFreshPrice()).toBe(1.0842);
    expect(ocrService.getPriceCacheAgeMs()).toBe(0);
    expect(ocrService.getPriceChangeAgeMs()).toBe(6000);
  });

  it('a new price refreshes both observation and change timestamps', () => {
    ocrService.extractPriceFromTitle('EUR/USD 1.0842 — Olymp Trade');
    vi.setSystemTime(now + 2000);

    const next = ocrService.extractPriceFromTitle('EUR/USD 1.0850 — Olymp Trade');
    expect(next).toBe(1.0850);
    expect(ocrService.getFreshPrice()).toBe(1.0850);
    expect(ocrService.getPriceChangeAgeMs()).toBe(0);
  });

  it('same price from body text remains valid while preserving movement age', () => {
    ocrService.extractPriceFromText('Price: 1.0842');
    vi.setSystemTime(now + 6000);

    expect(ocrService.extractPriceFromText('Price: 1.0842')).toBe(1.0842);
    expect(ocrService.getCachedOcrResults()!.currentPrice).toBe(1.0842);
    expect(ocrService.getPriceChangeAgeMs()).toBe(6000);
  });

  it('a quote becomes stale only when no valid heartbeat arrives', () => {
    ocrService.extractPriceFromText('Price: 1.0842');
    vi.setSystemTime(now + 6000);
    expect(ocrService.getFreshPrice()).toBeNull();
    expect(ocrService.getCachedOcrResults()!.currentPrice).toBeNull();
  });

  it('generic price match requires a decimal part', () => {
    expect(ocrService.extractPriceFromText('Balance: 1500 USD')).toBeNull();
    expect(ocrService.extractPriceFromText('EUR/USD 1.0842')).toBe(1.0842);
  });

  it('labeled price match still works', () => {
    expect(ocrService.extractPriceFromText('Current price: 1.0842')).toBe(1.0842);
    expect(ocrService.extractPriceFromText('Last: 1,084.20')).toBe(1084.2);
  });

  it('asset stays fresh while repeatedly matched', () => {
    ocrService.extractAssetFromTitle('EUR/USD — Olymp Trade');
    expect(ocrService.getCachedOcrResults()!.asset).toBe('EUR/USD');
    vi.setSystemTime(now + 3000);
    expect(ocrService.extractAssetFromTitle('EUR/USD — Olymp Trade')).toBe('EUR/USD');
    expect(ocrService.getCachedOcrResults()!.asset).toBe('EUR/USD');
  });

  it('currency-symbol stripping does not mangle asset letters', () => {
    expect(ocrService.extractAssetFromTitle('EUR/USD — Olymp Trade')).toBe('EUR/USD');
    expect(ocrService.extractAssetFromTitle('GBP/USD (OTC)')).toBe('GBP/USD (OTC)');
    expect(ocrService.cleanAssetText('Gold price 2400.50 USD')).toBe('Gold');
  });
});
