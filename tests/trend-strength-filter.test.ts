import { describe, expect, it } from 'vitest';
import { TrendStrengthFilter } from '../electron/main/market/TrendStrengthFilter';
import type { OHLC } from '../electron/main/market/QuantitativeEngine';

function candles(count: number, build: (index: number) => OHLC): OHLC[] {
  return Array.from({ length: count }, (_, index) => build(index));
}

describe('TrendStrengthFilter', () => {
  it('returns warming-up instead of guessing with insufficient candles', () => {
    const result = TrendStrengthFilter.calculate(candles(20, (i) => ({
      open: i,
      high: i + 1,
      low: i - 1,
      close: i + 0.5,
    })));

    expect(result.status).toBe('WARMING_UP');
    expect(result.adx).toBeNull();
    expect(result.choppiness).toBeNull();
    expect(result.gate).toBe('BLOCK');
  });

  it('identifies a clean directional trend without turning it into certainty', () => {
    const result = TrendStrengthFilter.calculate(candles(80, (i) => ({
      open: 100 + i * 0.8,
      high: 101 + i * 0.8,
      low: 99.5 + i * 0.8,
      close: 100.8 + i * 0.8,
    })));

    expect(result.status).toBe('VALID');
    expect(result.adx).toBeGreaterThan(18);
    expect(result.plusDi).toBeGreaterThan(result.minusDi);
    expect(result.trend).toBe('BULLISH');
    expect(['ALLOW', 'REDUCE']).toContain(result.gate);
  });

  it('blocks a flat/ranging market with high choppiness', () => {
    const result = TrendStrengthFilter.calculate(candles(80, (i) => ({
      open: 100 + (i % 2 === 0 ? 0.2 : -0.2),
      high: 101,
      low: 99,
      close: 100 + (i % 2 === 0 ? -0.2 : 0.2),
    })));

    expect(result.status).toBe('VALID');
    expect(result.choppiness).toBeGreaterThan(60);
    expect(result.gate).toBe('BLOCK');
  });

  it('fails closed for malformed OHLC values', () => {
    const result = TrendStrengthFilter.calculate([
      { open: 1, high: 2, low: 0, close: 1 },
      { open: 1, high: Number.NaN, low: 0, close: 1 },
    ]);

    expect(result.status).toBe('INVALID');
    expect(result.gate).toBe('BLOCK');
    expect(result.reason).toMatch(/Invalid OHLC/);
  });
});
