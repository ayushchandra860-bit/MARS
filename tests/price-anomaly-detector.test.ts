import { describe, it, expect, beforeEach } from 'vitest';
import { PriceAnomalyDetector } from '../electron/main/scanner/PriceAnomalyDetector';

describe('PriceAnomalyDetector', () => {
  let detector: PriceAnomalyDetector;

  beforeEach(() => {
    detector = new PriceAnomalyDetector(5000, 2.0, 20, 15000);
  });

  it('stays CLEAN on a healthy tick stream', () => {
    let now = 1000;
    detector.observe(1.0842, 'EUR/USD', now);
    now += 1000;
    detector.observe(1.0843, 'EUR/USD', now);
    now += 1000;
    const snap = detector.observe(1.0844, 'EUR/USD', now);
    expect(snap.status).toBe('CLEAN');
    expect(snap.healthy).toBe(true);
    expect(snap.recentEvents.length).toBe(0);
  });

  it('flags a stale stream after the freshness window', () => {
    let now = 1000;
    detector.observe(1.0842, 'EUR/USD', now);
    // 6s later, no reading
    now += 6000;
    const snap = detector.observe(null, 'EUR/USD', now);
    expect(snap.consecutiveStaleScans).toBe(1);
    expect(snap.recentEvents.some((e) => e.type === 'STALE_PRICE')).toBe(true);
    expect(snap.recentEvents.find((e) => e.type === 'STALE_PRICE')!.severity).toBe('WARN');
  });

  it('escalates staleness to CRITICAL after repeated stale scans', () => {
    let now = 1000;
    detector.observe(1.0842, 'EUR/USD', now);
    for (let i = 0; i < 5; i++) {
      now += 6000;
      detector.observe(null, 'EUR/USD', now);
    }
    const snap = detector.observe(null, 'EUR/USD', now + 6000);
    const stale = snap.recentEvents.filter((e) => e.type === 'STALE_PRICE');
    expect(stale.length).toBeGreaterThan(0);
    expect(stale[stale.length - 1].severity).toBe('CRITICAL');
  });

  it('flags an unrealistic price jump', () => {
    let now = 1000;
    detector.observe(1.0842, 'EUR/USD', now);
    now += 1000;
    // 10% jump in 1 second — impossible for EUR/USD, almost certainly a bad read
    const snap = detector.observe(1.1926, 'EUR/USD', now);
    const jump = snap.recentEvents.find((e) => e.type === 'PRICE_JUMP');
    expect(jump).toBeDefined();
    expect(jump!.severity).toBe('CRITICAL');
    expect(snap.priceJumpPct).toBeGreaterThan(9);
  });

  it('ignores normal micro-moves', () => {
    let now = 1000;
    detector.observe(1.0842, 'EUR/USD', now);
    now += 1000;
    const snap = detector.observe(1.0843, 'EUR/USD', now);
    expect(snap.recentEvents.some((e) => e.type === 'PRICE_JUMP')).toBe(false);
    expect(snap.status).toBe('CLEAN');
  });

  it('flags an asset flip', () => {
    let now = 1000;
    detector.observe(1.0842, 'EUR/USD', now);
    now += 1000;
    const snap = detector.observe(2400.5, 'Gold', now);
    const flip = snap.recentEvents.find((e) => e.type === 'ASSET_FLIP');
    expect(flip).toBeDefined();
    expect(flip!.severity).toBe('INFO');
  });

  it('flags invalid and non-positive prices', () => {
    const nanSnap = detector.observe(NaN, 'EUR/USD', 1000);
    expect(nanSnap.recentEvents.some((e) => e.type === 'INVALID_PRICE')).toBe(true);
    const zeroSnap = detector.observe(0, 'EUR/USD', 2000);
    expect(zeroSnap.recentEvents.some((e) => e.type === 'ZERO_PRICE')).toBe(true);
  });

  it('recovery clears the degraded status', () => {
    // Zero cooldown so every stale scan emits and escalates quickly.
    const fast = new PriceAnomalyDetector(5000, 2.0, 20, 0);
    let now = 1000;
    fast.observe(1.0842, 'EUR/USD', now);
    for (let i = 0; i < 5; i++) {
      now += 6000;
      fast.observe(null, 'EUR/USD', now);
    }
    const degraded = fast.observe(null, 'EUR/USD', now + 6000);
    expect(degraded.status).toBe('DEGRADED');
    const recovered = fast.observe(1.0850, 'EUR/USD', now + 7000);
    expect(recovered.healthy).toBe(true);
    expect(recovered.consecutiveStaleScans).toBe(0);
  });

  it('throttles stale events to avoid spam', () => {
    let now = 1000;
    detector.observe(1.0842, 'EUR/USD', now);
    let staleCount = 0;
    for (let i = 0; i < 10; i++) {
      now += 6000;
      const snap = detector.observe(null, 'EUR/USD', now);
      staleCount = snap.recentEvents.filter((e) => e.type === 'STALE_PRICE').length;
    }
    // 10 scans × 6s = 60s / 15s cooldown → ~4 events max, not 10
    expect(staleCount).toBeLessThanOrEqual(5);
  });

  it('reset clears all state', () => {
    detector.observe(1.0842, 'EUR/USD', 1000);
    detector.reset();
    const snap = detector.observe(1.0850, 'EUR/USD', 2000);
    expect(snap.recentEvents.length).toBe(0);
    expect(snap.status).toBe('CLEAN');
  });
});
