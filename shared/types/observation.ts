// ============================================================
// MARS PRO V3 — Market Observation Contract
// The single normalized observation produced by the scanner
// pipeline before entering the intelligence layer.
// ============================================================

import { SessionId, FrameId, QualityLevel, CandleObservation, OcrResults } from './scanner';
import {
  TrendEvidence,
  MomentumEvidence,
  VolatilityEvidence,
  StructureEvidence,
  SupportResistanceEvidence,
  PatternEvidence,
  MarketRegime,
} from './market';
import {
  AssetIdentity,
  PlatformMode,
  DataFreshness,
  DataSource,
} from './canonical';

/**
 * MarketObservation is the single normalized contract
 * produced by the scanner/CV pipeline. It feeds into the
 * DataQualityGate, then to the intelligence + decision layer.
 *
 * Live capture and ReplayEngine both produce this same type.
 */
export interface MarketObservation {
  observationId: string;
  sessionId: SessionId;
  frameId: FrameId;
  timestamp: number;

  // Quality assessments
  captureQuality: QualityLevel;
  chartQuality: QualityLevel;
  candleQuality: QualityLevel;
  dataQuality: QualityLevel;

  // Raw candle observations (pixel coordinates only)
  candles: CandleObservation[];

  // OCR-derived & provenance (optional — may be unavailable)
  asset: string | null;
  assetIdentity?: AssetIdentity | null;
  platformMode?: PlatformMode;
  freshness?: DataFreshness;
  source?: DataSource;
  timeframe: string | null;
  currentPrice: number | null;

  // Feature evidence (populated by FeatureExtractor)
  trendEvidence: TrendEvidence | null;
  momentumEvidence: MomentumEvidence | null;
  volatilityEvidence: VolatilityEvidence | null;
  structureEvidence: StructureEvidence | null;
  supportResistanceEvidence: SupportResistanceEvidence | null;
  patternEvidence: PatternEvidence | null;
  quantitativeMetrics?: any | null;

  // Brain-internal market regime classification
  marketRegime?: MarketRegime;
}

/**
 * Data quality requirements for the DataQualityGate.
 * DecisionEngine must not receive observations that fail these.
 */
export interface DataQualityRequirements {
  /** Minimum number of validated candles required */
  minimumCandles: number;
  /** Minimum candle quality level */
  minimumCandleQuality: QualityLevel;
  /** Minimum overall data quality */
  minimumDataQuality: QualityLevel;
  /** Whether chart ROI must be located */
  requireChartRegion: boolean;
}

export const DEFAULT_QUALITY_REQUIREMENTS: DataQualityRequirements = {
  minimumCandles: 3,
  minimumCandleQuality: QualityLevel.LOW,
  minimumDataQuality: QualityLevel.LOW,
  requireChartRegion: true,
};
