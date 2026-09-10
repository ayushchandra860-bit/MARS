// ============================================================
// MARS PRO V3 — Canonical Data Quality Gate
// Evaluates market observation quality, freshness, and demo isolation
// before allowing data to enter the intelligence and decision pipeline.
// ============================================================

import { MarketObservation } from '../../../shared/types/observation';
import { QualityLevel, FailureReasonCode } from '../../../shared/types/scanner';
import {
  PlatformMode,
  DataFreshness,
  QualityGateRejection,
  QualityGateResult,
  computeFreshness,
  isValidAssetName,
  FRESHNESS_THRESHOLDS,
} from '../../../shared/types/canonical';

export interface QualityGateEvaluationResult {
  passed: boolean;
  reason: FailureReasonCode | null;
  rejection?: QualityGateRejection;
  detail?: string;
  freshness?: DataFreshness;
  platformMode?: PlatformMode;
}

export class DataQualityGate {
  public static readonly MIN_CANDLES_FOR_SIGNAL = 3;
  public static readonly MIN_AVG_CANDLE_QUALITY = 0.65;
  public static readonly MAX_OBSERVATION_AGE_MS = FRESHNESS_THRESHOLDS.STALE_MAX_AGE_MS;

  /**
   * Evaluates observation against strict data quality and safety standards.
   */
  public evaluate(obs: MarketObservation, allowDemo: boolean = true): QualityGateEvaluationResult {
    if (!obs) {
      return {
        passed: false,
        reason: FailureReasonCode.DECISION_INPUT_INVALID,
        rejection: QualityGateRejection.LOW_DATA_QUALITY,
        detail: 'Observation is null or undefined',
        freshness: DataFreshness.EXPIRED,
        platformMode: PlatformMode.UNKNOWN,
      };
    }

    // 1. Platform Mode Check — Demo Isolation
    const platformMode = obs.platformMode ?? PlatformMode.UNKNOWN;
    if (!allowDemo && platformMode === PlatformMode.DEMO) {
      return {
        passed: false,
        reason: FailureReasonCode.DATA_QUALITY_GATE_FAILED,
        rejection: QualityGateRejection.DEMO_MODE,
        detail: 'Demo account observations are isolated from live signal generation',
        freshness: computeFreshness(obs.timestamp),
        platformMode: PlatformMode.DEMO,
      };
    }

    // 2. Data Freshness Check
    const freshness = obs.freshness ?? computeFreshness(obs.timestamp);
    if (freshness === DataFreshness.EXPIRED) {
      return {
        passed: false,
        reason: FailureReasonCode.DATA_QUALITY_GATE_FAILED,
        rejection: QualityGateRejection.EXPIRED_DATA,
        detail: `Observation timestamp is expired (${Date.now() - obs.timestamp}ms old)`,
        freshness: DataFreshness.EXPIRED,
        platformMode,
      };
    }

    // 3. Asset Identity Validation
    if (!obs.asset || !isValidAssetName(obs.asset)) {
      return {
        passed: false,
        reason: FailureReasonCode.OCR_UNAVAILABLE,
        rejection: QualityGateRejection.INVALID_ASSET,
        detail: `Asset '${obs.asset}' is not a recognized canonical asset`,
        freshness,
        platformMode,
      };
    }

    // 4. Candle Count & Integrity
    if (!obs.candles || obs.candles.length < DataQualityGate.MIN_CANDLES_FOR_SIGNAL) {
      return {
        passed: false,
        reason: FailureReasonCode.INSUFFICIENT_MARKET_DATA,
        rejection: QualityGateRejection.INSUFFICIENT_CANDLES,
        detail: `Found ${obs.candles?.length ?? 0} candles, minimum required is ${DataQualityGate.MIN_CANDLES_FOR_SIGNAL}`,
        freshness,
        platformMode,
      };
    }

    // 5. Candle & Capture Quality Levels
    if (obs.candleQuality === QualityLevel.FAILED) {
      return {
        passed: false,
        reason: FailureReasonCode.CANDLE_DETECTION_FAILED,
        rejection: QualityGateRejection.LOW_CANDLE_QUALITY,
        detail: 'Candle quality assessment marked as FAILED',
        freshness,
        platformMode,
      };
    }

    if (obs.dataQuality === QualityLevel.FAILED) {
      return {
        passed: false,
        reason: FailureReasonCode.DATA_QUALITY_GATE_FAILED,
        rejection: QualityGateRejection.LOW_DATA_QUALITY,
        detail: 'Overall data quality marked as FAILED',
        freshness,
        platformMode,
      };
    }

    if (obs.captureQuality === QualityLevel.FAILED || obs.chartQuality === QualityLevel.FAILED) {
      return {
        passed: false,
        reason: FailureReasonCode.DATA_QUALITY_GATE_FAILED,
        rejection: QualityGateRejection.LOW_DATA_QUALITY,
        detail: 'Frame capture or chart ROI detection marked as FAILED',
        freshness,
        platformMode,
      };
    }

    // 6. Average Candle Geometry Quality
    const avgCandleQuality = obs.candles.reduce((sum, candle) => sum + (candle.quality || 0), 0) / obs.candles.length;
    if (avgCandleQuality < DataQualityGate.MIN_AVG_CANDLE_QUALITY) {
      return {
        passed: false,
        reason: FailureReasonCode.CANDLE_DETECTION_FAILED,
        rejection: QualityGateRejection.LOW_CANDLE_QUALITY,
        detail: `Average candle quality (${avgCandleQuality.toFixed(2)}) is below threshold (${DataQualityGate.MIN_AVG_CANDLE_QUALITY})`,
        freshness,
        platformMode,
      };
    }

    // 7. Price Anomaly / Sanity Check (if price is present)
    if (obs.currentPrice !== null && obs.currentPrice !== undefined) {
      if (!Number.isFinite(obs.currentPrice) || obs.currentPrice <= 0) {
        return {
          passed: false,
          reason: FailureReasonCode.DATA_QUALITY_GATE_FAILED,
          rejection: QualityGateRejection.INVALID_PRICE,
          detail: `Invalid price quote: ${obs.currentPrice}`,
          freshness,
          platformMode,
        };
      }
    }

    return {
      passed: true,
      reason: null,
      rejection: QualityGateRejection.NONE,
      detail: 'Observation passed all quality and safety gates',
      freshness,
      platformMode,
    };
  }
}
