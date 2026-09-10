// ============================================================
// MARS PRO V3 — Price Anomaly Detector
// Watches the live price/asset stream for data-integrity anomalies:
//   • STALE_PRICE  — no fresh price for longer than the freshness window
//   • PRICE_JUMP   — unrealistically large move between consecutive scans
//                    (almost always a bad OCR/scrape read, not the market)
//   • ASSET_FLIP   — asset changed between scans (legit switch or garbage scrape)
//   • INVALID_PRICE / ZERO_PRICE — NaN, negative or zero readings
// Anomalies are surfaced through a snapshot the UI/diagnostics can display,
// and CRITICAL ones tell the decision pipeline the data cannot be trusted.
// ============================================================

export interface AnomalyEvent {
  type: 'STALE_PRICE' | 'PRICE_JUMP' | 'ASSET_FLIP' | 'INVALID_PRICE' | 'ZERO_PRICE';
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  message: string;
  timestamp: number;
  price: number | null;
  asset: string | null;
}

export interface AnomalySnapshot {
  /** True when no CRITICAL anomaly is currently active. */
  healthy: boolean;
  status: 'CLEAN' | 'WATCH' | 'DEGRADED';
  recentEvents: AnomalyEvent[];
  lastPrice: number | null;
  lastAsset: string | null;
  lastPriceAgeMs: number;
  priceJumpPct: number | null;
  consecutiveStaleScans: number;
}

export class PriceAnomalyDetector {
  private lastPrice: number | null = null;
  private lastAsset: string | null = null;
  private lastTimestamp = 0;
  private consecutiveStaleScans = 0;
  private events: AnomalyEvent[] = [];
  private readonly maxEvents: number;
  private readonly maxPriceAgeMs: number;
  private readonly maxJumpPct: number;
  private readonly staleEmitCooldownMs: number;
  private lastStaleEmitAt = 0;
  private lastJumpPct: number | null = null;
  /** Current stream health — reflects the LATEST observation, not history. */
  private currentStatus: 'CLEAN' | 'WATCH' | 'DEGRADED' = 'CLEAN';

  constructor(
    maxPriceAgeMs = 5000,
    maxJumpPct = 2.0,
    maxEvents = 20,
    staleEmitCooldownMs = 15000
  ) {
    this.maxPriceAgeMs = maxPriceAgeMs;
    this.maxJumpPct = maxJumpPct;
    this.maxEvents = maxEvents;
    this.staleEmitCooldownMs = staleEmitCooldownMs;
  }

  /**
   * Feed the latest (possibly null) price observation. Returns a snapshot of
   * the stream health AFTER this observation was processed.
   */
  public observe(price: number | null, asset: string | null, now = Date.now()): AnomalySnapshot {
    const isFresh = this.lastTimestamp === 0 || now - this.lastTimestamp <= this.maxPriceAgeMs;

    if (price === null || price === undefined) {
      // No reading this cycle. If we had a reading and it is now older than the
      // freshness window, the stream is stale (throttled to avoid event spam).
      if (this.lastTimestamp > 0 && !isFresh) {
        this.consecutiveStaleScans++;
        // First stale detection always emits; later ones respect the cooldown.
        if (this.lastStaleEmitAt === 0 || now - this.lastStaleEmitAt >= this.staleEmitCooldownMs) {
          this.lastStaleEmitAt = now;
          this.pushEvent({
            type: 'STALE_PRICE',
            severity: this.consecutiveStaleScans > 3 ? 'CRITICAL' : 'WARN',
            message: `No fresh price for ${Math.round((now - this.lastTimestamp) / 1000)}s (${this.consecutiveStaleScans} scans)`,
            timestamp: now,
            price: this.lastPrice,
            asset: this.lastAsset,
          });
        }
        this.currentStatus = this.consecutiveStaleScans > 3 ? 'DEGRADED' : 'WATCH';
      } else if (this.lastTimestamp === 0) {
        this.currentStatus = 'WATCH'; // no baseline yet — nothing to compare
      }
      return this.snapshot(now);
    }

    // A reading arrived — staleness is over.
    this.consecutiveStaleScans = 0;

    if (!isFinite(price) || isNaN(price)) {
      this.currentStatus = 'DEGRADED';
      this.pushEvent({
        type: 'INVALID_PRICE',
        severity: 'CRITICAL',
        message: `Non-finite price read: ${String(price)}`,
        timestamp: now,
        price,
        asset,
      });
      return this.snapshot(now);
    }
    if (price <= 0) {
      this.currentStatus = 'WATCH';
      this.pushEvent({
        type: 'ZERO_PRICE',
        severity: 'WARN',
        message: `Non-positive price read: ${price}`,
        timestamp: now,
        price,
        asset,
      });
      return this.snapshot(now);
    }

    // Asset flip detection — must run BEFORE jump detection: a legitimate
    // switch (EUR/USD → Gold) would otherwise look like an absurd price jump.
    const flipped = this.lastAsset !== null && asset && asset !== this.lastAsset;
    if (flipped) {
      this.pushEvent({
        type: 'ASSET_FLIP',
        severity: 'INFO',
        message: `Asset changed ${this.lastAsset} → ${asset}`,
        timestamp: now,
        price,
        asset,
      });
    }

    // Jump detection (relative to the previous valid reading of the SAME asset).
    this.lastJumpPct = null;
    if (!flipped && this.lastPrice !== null && this.lastPrice > 0) {
      const pct = (Math.abs(price - this.lastPrice) / this.lastPrice) * 100;
      this.lastJumpPct = pct;
      if (pct > this.maxJumpPct) {
        this.currentStatus = pct > 5 ? 'DEGRADED' : 'WATCH';
        this.pushEvent({
          type: 'PRICE_JUMP',
          severity: pct > 5 ? 'CRITICAL' : 'WARN',
          message: `${asset || 'asset'} moved ${pct.toFixed(2)}% between scans (${this.lastPrice} → ${price}) — likely bad read`,
          timestamp: now,
          price,
          asset,
        });
      } else {
        this.currentStatus = 'CLEAN';
      }
    } else {
      this.currentStatus = 'CLEAN';
    }

    this.lastPrice = price;
    this.lastAsset = asset || this.lastAsset;
    this.lastTimestamp = now;
    return this.snapshot(now);
  }

  private pushEvent(event: AnomalyEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(this.events.length - this.maxEvents);
    }
  }

  private snapshot(now: number): AnomalySnapshot {
    return {
      healthy: this.currentStatus !== 'DEGRADED',
      status: this.currentStatus,
      recentEvents: [...this.events].slice(-5),
      lastPrice: this.lastPrice,
      lastAsset: this.lastAsset,
      lastPriceAgeMs: this.lastTimestamp === 0 ? 0 : Math.max(0, now - this.lastTimestamp),
      priceJumpPct: this.lastJumpPct,
      consecutiveStaleScans: this.consecutiveStaleScans,
    };
  }

  public reset(): void {
    this.lastPrice = null;
    this.lastAsset = null;
    this.lastTimestamp = 0;
    this.consecutiveStaleScans = 0;
    this.lastStaleEmitAt = 0;
    this.lastJumpPct = null;
    this.currentStatus = 'CLEAN';
    this.events = [];
  }

  public getEvents(): AnomalyEvent[] {
    return [...this.events];
  }
}
