import { describe, expect, it } from 'vitest';
import { confidenceToWaitScore, formatWaitScore, normalizeWaitScore } from '../shared/utils/waitScore';

describe('WAIT 1–100 projection', () => {
  it('preserves every direct WAIT score from 1 through 100', () => {
    for (let score = 1; score <= 100; score += 1) {
      expect(normalizeWaitScore(score)).toBe(score);
      expect(formatWaitScore(score)).toBe(`WAIT ${score}`);
    }
  });

  it('converts confidence fractions across the entire display range without a 95-point cap', () => {
    expect(confidenceToWaitScore(0.01)).toBe(1);
    expect(confidenceToWaitScore(0.50)).toBe(50);
    expect(confidenceToWaitScore(0.95)).toBe(95);
    expect(confidenceToWaitScore(0.96)).toBe(96);
    expect(confidenceToWaitScore(0.99)).toBe(99);
    expect(confidenceToWaitScore(1)).toBe(100);
  });

  it('clamps invalid direct values safely into the usable range', () => {
    expect(normalizeWaitScore(-4)).toBe(1);
    expect(normalizeWaitScore(140)).toBe(100);
    expect(normalizeWaitScore(Number.NaN)).toBe(1);
  });
});
