import { describe, it, expect, beforeEach } from 'vitest';
import { ConfidenceCalibrator, CALIBRATION_MIN_SAMPLES } from '../electron/main/brain/ConfidenceCalibrator';

/** Deterministic PRNG so tests are reproducible on slow/loaded machines. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rand: () => number;

function sample(confidence: number, outcome: 'WIN' | 'LOSS'): { confidence: number; outcome: 'WIN' | 'LOSS' } {
  return { confidence, outcome };
}

/** Generate n samples with a given claimed confidence and true win rate. */
function generate(claimed: number, trueRate: number, n: number): Array<{ confidence: number; outcome: 'WIN' | 'LOSS' }> {
  const out: Array<{ confidence: number; outcome: 'WIN' | 'LOSS' }> = [];
  for (let i = 0; i < n; i++) {
    out.push(sample(claimed, rand() < trueRate ? 'WIN' : 'LOSS'));
  }
  return out;
}

describe('ConfidenceCalibrator', () => {
  let calibrator: ConfidenceCalibrator;

  beforeEach(() => {
    calibrator = new ConfidenceCalibrator();
    rand = mulberry32(42);
  });

  it('is inactive and maps identity below the minimum sample count', () => {
    const report = calibrator.build([sample(0.8, 'WIN'), sample(0.8, 'LOSS')]);
    expect(report.active).toBe(false);
    expect(report.disabledReason).toContain('INSUFFICIENT_DATA');
    expect(calibrator.calibrate(0.85)).toBe(0.85);
    expect(calibrator.calibrate(0.3)).toBe(0.3);
    expect(calibrator.calibrate(1.5)).toBe(1);
  });

  it('perfectly calibrated data yields near-zero ECE and near-identity mapping', () => {
    const data: Array<{ confidence: number; outcome: 'WIN' | 'LOSS' }> = [];
    const configs: Array<[number, number, number]> = [
      [0.55, 0.55, 40],
      [0.65, 0.65, 40],
      [0.75, 0.75, 40],
      [0.85, 0.85, 40],
      [0.95, 0.95, 40],
    ];
    for (const [claimed, rate, n] of configs) {
      data.push(...generate(claimed, rate, n));
    }
    const report = calibrator.build(data);
    expect(report.active).toBe(true);
    expect(report.ece).toBeLessThan(0.08);
    // 0.85 should map close to 0.85
    expect(Math.abs(calibrator.calibrate(0.85) - 0.85)).toBeLessThan(0.1);
  });

  it('overconfident signals are pulled down toward the empirical rate', () => {
    // Claims 0.90 but actually wins only 50% of the time — the classic
    // miscalibration this engine exists to fix.
    const data = generate(0.9, 0.5, 120);
    const report = calibrator.build(data);
    expect(report.active).toBe(true);
    const calibrated = calibrator.calibrate(0.9);
    expect(calibrated).toBeLessThan(0.75);
    expect(calibrated).toBeGreaterThanOrEqual(0.3);
    // The honest estimate should be closer to 0.5 than the claim 0.9
    expect(Math.abs(calibrated - 0.5)).toBeLessThan(Math.abs(0.9 - 0.5));
  });

  it('calibration is monotone non-decreasing across the actionable range', () => {
    const data: Array<{ confidence: number; outcome: 'WIN' | 'LOSS' }> = [];
    for (const [claimed, rate, n] of [[0.6, 0.45, 50], [0.7, 0.55, 50], [0.8, 0.7, 50], [0.9, 0.85, 50]] as Array<[number, number, number]>) {
      data.push(...generate(claimed, rate, n));
    }
    calibrator.build(data);
    let prev = -Infinity;
    for (let c = 0.5; c <= 1.0; c += 0.01) {
      const v = calibrator.calibrate(c);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
      expect(v).toBeLessThanOrEqual(0.95 + 1e-9);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  }, 20000);

  it('never exceeds the honesty ceiling', () => {
    // Extremely confident, extremely lucky dataset
    const data = generate(0.95, 1.0, 100);
    calibrator.build(data);
    expect(calibrator.calibrate(0.95)).toBeLessThanOrEqual(0.95);
  }, 20000);

  it('reports bins with claimed vs actual for the UI', () => {
    const data = generate(0.85, 0.6, 100);
    const report = calibrator.build(data);
    expect(report.bins.length).toBeGreaterThan(0);
    const bin = report.bins.find((b) => b.min >= 0.85);
    expect(bin).toBeDefined();
    expect(bin!.sampleCount).toBeGreaterThan(0);
    expect(bin!.empiricalRate).toBeGreaterThan(0);
    expect(bin!.calibratedRate).toBeGreaterThan(0);
    expect(report.wellCalibratedPct).toBeGreaterThanOrEqual(0);
  });

  it('rejects malformed samples without crashing', () => {
    const report = calibrator.build([
      sample(NaN, 'WIN'),
      { confidence: 2, outcome: 'WIN' } as any,
      sample(0.7, 'DRAW' as any),
      sample(0.75, 'WIN'),
      sample(0.75, 'LOSS'),
    ]);
    expect(report.sampleCount).toBe(2); // only the two valid ones
  });

  it('minimum sample constant is exported and sane', () => {
    expect(CALIBRATION_MIN_SAMPLES).toBe(15);
  });
});
