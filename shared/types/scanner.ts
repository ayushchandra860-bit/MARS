// ============================================================
// MARS PRO V3 — Scanner Types
// Typed contracts for screen capture, frame validation,
// chart location, candle detection, and OCR.
// ============================================================

/** Unique identifier for a captured frame */
export type FrameId = string;

/** Unique identifier for an analysis session */
export type SessionId = string;

// ----------------------------------------------------------
// Display & Capture
// ----------------------------------------------------------

export interface DisplayInfo {
  id: string;
  label: string;
  bounds: ScreenRect;
  scaleFactor: number;
  isPrimary: boolean;
}

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureSource {
  id: string;
  name: string;
  displayId: string;
  thumbnailDataUrl?: string;
}

export interface CapturedFrame {
  frameId: FrameId;
  sessionId: SessionId;
  timestamp: number;
  displayId: string;
  buffer: Buffer;
  width: number;
  height: number;
  scaleFactor: number;
}

// ----------------------------------------------------------
// Frame Validation
// ----------------------------------------------------------

export enum FrameValidationResult {
  VALID = 'VALID',
  NO_BUFFER = 'NO_BUFFER',
  ZERO_DIMENSIONS = 'ZERO_DIMENSIONS',
  BLACK_FRAME = 'BLACK_FRAME',
  LOW_VARIANCE = 'LOW_VARIANCE',
  STALE_FRAME = 'STALE_FRAME',
}

export interface ValidatedFrame {
  frame: CapturedFrame;
  validation: FrameValidationResult;
  variance: number;
  fingerprint: string;
}

// ----------------------------------------------------------
// Chart Location
// ----------------------------------------------------------

export interface ChartRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

// ----------------------------------------------------------
// Candle Detection (Pixel Coordinates Only)
// ----------------------------------------------------------

export enum CandleDirection {
  BULLISH = 'BULLISH',
  BEARISH = 'BEARISH',
  DOJI = 'DOJI',
}

/**
 * CandleObservation uses PIXEL coordinates only.
 * No OHLC price values unless price-axis calibration is validated.
 */
export interface CandleObservation {
  /** X position in pixels within chart ROI */
  xPx: number;
  /** Top of candle body in pixels (lower price for bullish, higher price for bearish) */
  bodyTopPx: number;
  /** Bottom of candle body in pixels */
  bodyBottomPx: number;
  /** Top of upper wick in pixels */
  wickTopPx: number;
  /** Bottom of lower wick in pixels */
  wickBottomPx: number;
  /** Direction determined by body color/position */
  direction: CandleDirection;
  /** Body size in pixels */
  bodySizePx: number;
  /** Total range (wick to wick) in pixels */
  rangePx: number;
  /** Quality score 0-1 for this individual candle detection */
  quality: number;
}

export interface CandleDetectionResult {
  candles: CandleObservation[];
  rawCandidateCount: number;
  validatedCandleCount: number;
  candleQuality: QualityLevel;
  dominantBullishColor: RgbColor | null;
  dominantBearishColor: RgbColor | null;
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

// ----------------------------------------------------------
// OCR
// ----------------------------------------------------------

export interface OcrObservation {
  value: string;
  confidence: number;
  timestamp: number;
}

export interface OcrResults {
  asset: OcrObservation | null;
  timeframe: OcrObservation | null;
  currentPrice: OcrObservation | null;
}

// ----------------------------------------------------------
// Quality
// ----------------------------------------------------------

export enum QualityLevel {
  HIGH = 'HIGH',
  ACCEPTABLE = 'ACCEPTABLE',
  LOW = 'LOW',
  FAILED = 'FAILED',
}

// ----------------------------------------------------------
// Scanner Stage Diagnostics
// ----------------------------------------------------------

export enum ScannerStage {
  CAPTURE = 'CAPTURE',
  FRAME = 'FRAME',
  CHART_ROI = 'CHART_ROI',
  OVERLAY_MASK = 'OVERLAY_MASK',
  CANDLES = 'CANDLES',
  OCR = 'OCR',
  OBSERVATION = 'OBSERVATION',
  FEATURES = 'FEATURES',
  QUALITY_GATE = 'QUALITY_GATE',
  DECISION = 'DECISION',
  IPC = 'IPC',
  OVERLAY = 'OVERLAY',
}

export enum StageStatus {
  PASS = 'PASS',
  PARTIAL = 'PARTIAL',
  FAIL = 'FAIL',
  SKIPPED = 'SKIPPED',
}

export interface StageTrace {
  stage: ScannerStage;
  status: StageStatus;
  detail?: string;
  durationMs?: number;
}

import { TradingAction } from './decision';

export interface ScannerDiagnosticReport {
  sessionId: SessionId;
  frameId: FrameId;
  timestamp: number;
  displayId: string;
  captureWidth: number;
  captureHeight: number;
  scaleFactor: number;
  stages: StageTrace[];
  firstFailedStage: ScannerStage | null;
  chartRegion: ChartRegion | null;
  rawCandidateCount: number;
  validatedCandleCount: number;
  candleQuality: QualityLevel | null;
  ocrResults: OcrResults | null;
  dataQuality: QualityLevel | null;
  rawDecision: TradingAction | null;
  stabilizedDecision: TradingAction | null;
  pipelineDurationMs: number;
}

// ----------------------------------------------------------
// Failure Reason Codes
// ----------------------------------------------------------

export enum FailureReasonCode {
  CAPTURE_FAILED = 'CAPTURE_FAILED',
  INVALID_FRAME = 'INVALID_FRAME',
  CHART_NOT_FOUND = 'CHART_NOT_FOUND',
  CANDLE_DETECTION_FAILED = 'CANDLE_DETECTION_FAILED',
  OCR_UNAVAILABLE = 'OCR_UNAVAILABLE',
  INSUFFICIENT_MARKET_DATA = 'INSUFFICIENT_MARKET_DATA',
  DECISION_INPUT_INVALID = 'DECISION_INPUT_INVALID',
  DATA_QUALITY_GATE_FAILED = 'DATA_QUALITY_GATE_FAILED',
  IPC_FAILED = 'IPC_FAILED',
  SESSION_INVALIDATED = 'SESSION_INVALIDATED',
}
