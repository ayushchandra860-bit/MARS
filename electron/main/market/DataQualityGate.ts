// ============================================================
// MARS PRO V3 — Canonical Data Quality Gate
// ============================================================

import { MarketObservation } from '../../../shared/types/observation';
import { QualityLevel, FailureReasonCode } from '../../../shared/types/scanner';
import {
  PlatformMode,
  DataFreshness,
  QualityGateRejection,
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

  public static isSupportedTimeframe(value: string | null | undefined): value is string {
    if (typeof value !== 'string') return false;
    return /^(?:[1-9]\d*)\s*(?:s|sec|second|seconds|m|min|minute|minutes|h|hour|hours|d|day|days)$/i.test(value.trim());
  }

  /** Demo data is isolated by default; callers must explicitly opt in. */
  public evaluate(obs: MarketObservation, allowDemo: boolean = false): QualityGateEvaluationResult {
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

    const platformMode = obs.platformMode ?? PlatformMode.UNKNOWN;
    if (!allowDemo && platformMode === PlatformMode.DEMO) {
      return {
        passed: false,
        reason: FailureReasonCode.DATA_QUALITY_GATE_FAILED,
        rejection: QualityGateRejection.DEMO_MODE,
        detail: 'Demo account observations are isolated from live signal generation',
        freshness: computeFreshness(obs.timestamp),
        platformMode,
      };
    }

    const freshness = obs.freshness ?? computeFreshness(obs.timestamp);
    if (freshness === DataFreshness.STALE) {
      return {
        passed: false,
        reason: FailureReasonCode.DATA_QUALITY_GATE_FAILED,
        rejection: QualityGateRejection.STALE_DATA,
        detail: `Observation is stale (${Date.now() - obs.timestamp}ms old); WAIT for a fresh quote`,
        freshness,
        platformMode,
      };
    }

    if (freshness === DataFreshness.EXPIRED) {
      return {
        passed: false,
        reason: FailureReasonCode.DATA_QUALITY_GATE_FAILED,
        rejection: QualityGateRejection.EXPIRED_DATA,
        detail: `Observation timestamp is expired (${Date.now() - obs.timestamp}ms old)`,
        freshness,
        platformMode,
      };
    }

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

    if (!DataQualityGate.isSupportedTimeframe(obs.timeframe)) {
      return {
        passed: false,
        reason: FailureReasonCode.DATA_QUALITY_GATE_FAILED,
        rejection: QualityGateRejection.INVALID_TIMEFRAME,
        detail: `Timeframe '${obs.timeframe}' is unavailable or unsupported; BUY/SELL is blocked`,
        freshness,
        platformMode,
      };
    }

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

    if (obs.candleQuality === QualityLevel.FAILED || obs.candleQuality === QualityLevel.LOW) {
      return {
        passed: false,
        reason: FailureReasonCode.CANDLE_DETECTION_FAILED,
        rejection: QualityGateRejection.LOW_CANDLE_QUALITY,
        detail: `Candle quality is ${obs.candleQuality}; WAIT for a cleaner chart`,
        freshness,
        platformMode,
      };
    }

    if (obs.dataQuality === QualityLevel.FAILED || obs.dataQuality === QualityLevel.LOW) {
      return {
        passed: false,
        reason: FailureReasonCode.DATA_QUALITY_GATE_FAILED,
        rejection: QualityGateRejection.LOW_DATA_QUALITY,
        detail: `Overall data quality is ${obs.dataQuality}; actionable output is blocked`,
        freshness,
        platformMode,
      };
    }

    if (obs.captureQuality === QualityLevel.FAILED || obs.captureQuality === QualityLevel.LOW
      || obs.chartQuality === QualityLevel.FAILED || obs.chartQuality === QualityLevel.LOW) {
      return {
        passed: false,
        reason: FailureReasonCode.DATA_QUALITY_GATE_FAILED,
        rejection: QualityGateRejection.LOW_DATA_QUALITY,
        detail: 'Frame capture or chart ROI detection marked as FAILED',
        freshness,
        platformMode,
      };
    }

    const averageCandleQuality = obs.candles.reduce(
      (sum, candle) => sum + (candle.quality || 0), 0,
    ) / obs.candles.length;
    if (averageCandleQuality < DataQualityGate.MIN_AVG_CANDLE_QUALITY) {
      return {
        passed: false,
        reason: FailureReasonCode.CANDLE_DETECTION_FAILED,
        rejection: QualityGateRejection.LOW_CANDLE_QUALITY,
        detail: `Average candle quality (${averageCandleQuality.toFixed(2)}) is below threshold (${DataQualityGate.MIN_AVG_CANDLE_QUALITY})`,
        freshness,
        platformMode,
      };
    }

    if (typeof obs.currentPrice !== 'number'
      || !Number.isFinite(obs.currentPrice)
      || obs.currentPrice <= 0) {
      return {
        passed: false,
        reason: FailureReasonCode.DATA_QUALITY_GATE_FAILED,
        rejection: QualityGateRejection.INVALID_PRICE,
        detail: `Current live quote is unavailable or invalid: ${obs.currentPrice}`,
        freshness,
        platformMode,
      };
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
