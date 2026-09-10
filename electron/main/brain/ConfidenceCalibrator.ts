// ============================================================
// MARS PRO V3 — Confidence Calibrator
// Maps raw signal confidence to an EMPIRICALLY CALIBRATED win
// probability using the verified journal. This is what makes
// "0.85 confidence" actually mean "≈85% of these won" instead of
// being an unvalidated heuristic number.
//
// Pipeline: bin raw confidence → empirical win rate per bin →
// shrinkage toward the overall mean (small bins are noisy) →
// isotonic (monotone non-decreasing) adjustment → piecewise-linear
// mapping. Exposes ECE (Expected Calibration Error) so the user can
// SEE how far the raw confidence is from reality.
// ============================================================

export interface CalibrationSample {
  /** Raw signal confidence at entry time, normalized to 0..1. */
  confidence: number;
  /** WIN/LOSS only — draws are excluded by the caller. */
  outcome: 'WIN' | 'LOSS';
}

export interface CalibrationBin {
  /** Raw-confidence bin edge [min, max). */
  min: number;
  max: number;
  sampleCount: number;
  winCount: number;
  /** Raw wins / samples (unsmoothed). */
  empiricalRate: number;
  /** Shrinkage-smoothed rate (small bins pulled toward the overall mean). */
  smoothedRate: number;
  /** Final monotone-adjusted rate used by the mapping. */
  calibratedRate: number;
}

export interface CalibrationReport {
  active: boolean;
  sampleCount: number;
  winCount: number;
  /** Overall empirical win rate. */
  overallWinRate: number;
  /** Expected Calibration Error — sample-weighted |calibrated − empirical|. */
  ece: number;
  /** How many raw-confidence points were within 0.05 of their empirical rate. */
  wellCalibratedPct: number;
  bins: CalibrationBin[];
  disabledReason: string | null;
  builtAt: number;
}

/** Minimum verified trades before any calibration is applied. */
export const CALIBRATION_MIN_SAMPLES = 15;

/** Maximum confidence we are willing to claim — no strategy is 100%. */
export const CALIBRATION_CEILING = 0.95;

/** Shrinkage strength: higher = small bins pulled harder toward the mean. */
const SHRINKAGE = 4;

/** Bins cover the actionable signal range [0.50, 1.00]. */
const BIN_EDGES = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 1.01];

export class ConfidenceCalibrator {
  private report: CalibrationReport | null = null;
  /** Interpolation anchors: (rawMid, calibratedRate) for non-empty bins. */
  private anchors: Array<{ mid: number; rate: number }> = [];

  /**
   * Rebuild the calibration map from verified journal samples.
   * Idempotent — call whenever new outcomes are available.
   */
  public build(samples: CalibrationSample[]): CalibrationReport {
    const valid = (samples || []).filter(
      (s) =>
        s &&
        typeof s.confidence === 'number' &&
        isFinite(s.confidence) &&
        s.confidence >= 0 &&
        s.confidence <= 1 &&
        (s.outcome === 'WIN' || s.outcome === 'LOSS')
    );

    const builtAt = Date.now();

    if (valid.length < CALIBRATION_MIN_SAMPLES) {
      this.report = {
        active: false,
        sampleCount: valid.length,
        winCount: valid.filter((s) => s.outcome === 'WIN').length,
        overallWinRate: valid.length ? valid.filter((s) => s.outcome === 'WIN').length / valid.length : 0.5,
        ece: 0,
        wellCalibratedPct: 0,
        bins: [],
        disabledReason: `INSUFFICIENT_DATA — need ${CALIBRATION_MIN_SAMPLES} verified trades, have ${valid.length}`,
        builtAt,
      };
      this.anchors = [];
      return this.report;
    }

    const winCount = valid.filter((s) => s.outcome === 'WIN').length;
    const overallWinRate = winCount / valid.length;

    // 1) Bin the samples.
    const rawBins: Array<{ count: number; wins: number; empirical: number | null }> = BIN_EDGES.slice(0, -1).map((min, i) => {
      const max = BIN_EDGES[i + 1] as number;
      const inBin = valid.filter((s) => s.confidence >= min && s.confidence < max);
      const wins = inBin.filter((s) => s.outcome === 'WIN').length;
      return {
        count: inBin.length,
        wins,
        empirical: inBin.length ? wins / inBin.length : null,
      };
    });

    // 2) Shrinkage toward the overall mean.
    const smoothed = rawBins.map((b) =>
      b.count === 0 ? overallWinRate : (b.wins + SHRINKAGE * overallWinRate) / (b.count + SHRINKAGE)
    );

    // 3) Isotonic regression — enforce monotone non-decreasing rates (PAV).
    const isoCounts = rawBins.map((b) => b.count);
    const isoWins = rawBins.map((b) => b.wins + SHRINKAGE * overallWinRate);
    const isoDenoms = rawBins.map((b) => b.count + SHRINKAGE);
    for (let i = 1; i < smoothed.length; i++) {
      if (smoothed[i] !== null && smoothed[i - 1] !== null && (smoothed[i] as number) < (smoothed[i - 1] as number)) {
        // Merge this bin into the previous one (pool adjacent violators).
        isoCounts[i - 1] = (isoCounts[i - 1] as number) + (isoCounts[i] as number);
        isoWins[i - 1] = (isoWins[i - 1] as number) + (isoWins[i] as number);
        isoDenoms[i - 1] = (isoDenoms[i - 1] as number) + (isoDenoms[i] as number);
        isoCounts[i] = 0;
        const merged = (isoWins[i - 1] as number) / (isoDenoms[i - 1] as number);
        smoothed[i - 1] = merged;
        smoothed[i] = merged;
        // Re-check previous pair after merging.
        i = Math.max(1, i - 2);
      }
    }

    // 4) Build the report with capped calibrated rates.
    const bins: CalibrationBin[] = rawBins.map((b, i) => {
      const calibratedRate = Math.max(0.05, Math.min(CALIBRATION_CEILING, smoothed[i] as number));
      return {
        min: BIN_EDGES[i] as number,
        max: BIN_EDGES[i + 1] as number,
        sampleCount: b.count,
        winCount: b.wins,
        empiricalRate: b.empirical === null ? 0 : b.empirical,
        smoothedRate: smoothed[i] as number,
        calibratedRate,
      };
    });

    // Anchors for piecewise-linear interpolation — only non-empty bins.
    this.anchors = bins
      .filter((b) => b.sampleCount > 0)
      .map((b) => ({ mid: (b.min + Math.max(b.min, Math.min(b.max, 1))) / 2, rate: b.calibratedRate }));

    // 5) ECE — sample-weighted mean |predicted − empirical|.
    const total = valid.length;
    let ece = 0;
    let wellCalibrated = 0;
    let wellCalibratedWeight = 0;
    for (const b of bins) {
      if (b.sampleCount === 0) continue;
      const weight = b.sampleCount / total;
      ece += weight * Math.abs(b.calibratedRate - b.empiricalRate);
      if (Math.abs(b.calibratedRate - b.empiricalRate) <= 0.05) {
        wellCalibrated += b.sampleCount;
      }
      wellCalibratedWeight += weight;
    }

    this.report = {
      active: true,
      sampleCount: valid.length,
      winCount,
      overallWinRate,
      ece: Math.round(ece * 1000) / 1000,
      wellCalibratedPct: Math.round((wellCalibrated / valid.length) * 1000) / 10,
      bins,
      disabledReason: null,
      builtAt,
    };
    return this.report;
  }

  /**
   * Map a raw confidence to the calibrated win probability.
   * Returns the raw value unchanged when calibration is inactive
   * (identity mapping) so the system degrades gracefully.
   */
  public calibrate(rawConfidence: number): number {
    if (!this.report || !this.report.active) {
      const clamped = Math.max(0, Math.min(1, typeof rawConfidence === 'number' && isFinite(rawConfidence) ? rawConfidence : 0.5));
      return clamped;
    }
    const raw = Math.max(0, Math.min(1, typeof rawConfidence === 'number' && isFinite(rawConfidence) ? rawConfidence : 0.5));

    if (this.anchors.length === 0) {
      return this.report.overallWinRate;
    }
    if (this.anchors.length === 1) {
      return this.anchors[0].rate;
    }

    // Piecewise-linear interpolation through anchor midpoints.
    if (raw <= this.anchors[0].mid) return this.anchors[0].rate;
    const last = this.anchors[this.anchors.length - 1];
    if (raw >= last.mid) return last.rate;

    for (let i = 1; i < this.anchors.length; i++) {
      const a = this.anchors[i - 1];
      const b = this.anchors[i];
      if (raw >= a.mid && raw <= b.mid) {
        if (b.mid === a.mid) return b.rate;
        const t = (raw - a.mid) / (b.mid - a.mid);
        return Math.max(0, Math.min(1, a.rate + t * (b.rate - a.rate)));
      }
    }
    return last.rate;
  }

  public getReport(): CalibrationReport | null {
    return this.report;
  }

  public isActive(): boolean {
    return !!(this.report && this.report.active);
  }
}
