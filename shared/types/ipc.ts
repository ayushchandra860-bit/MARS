// ============================================================
// MARS PRO V3 â€” IPC Types & Contracts
// Typed payloads for Main <-> Renderer communication.
// ============================================================

import { AnalysisState, SystemStatus } from './session';
import { TradingAction, RiskLevel, SignalLifecycle, TradeOutcome, EvidenceBreakdown, SignalStatusLabel, TradeStatusLabel, TradeHealth } from './decision';
import { QualityLevel, ScannerDiagnosticReport } from './scanner';
import { TrendDirection, MomentumLevel, VolatilityLevel, MarketBias, StructuralLevel, MarketRegime } from './market';
import { MarketObservation } from './observation';
import { CanonicalConfidence, CanonicalRisk, AnalysisMode, PlatformMode } from './canonical';

// ----------------------------------------------------------
// Signal Update Payload (Unified IPC emission to signal-update)
// ----------------------------------------------------------

export interface SignalUpdatePayload {
  signal: 'BUY' | 'SELL' | 'WAIT';
  confidence: string;
  entry: string;
  expiry: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  whyWait: string;
  whyTake: string[];

  asset: string;
  timeframe: string;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  momentum: 'STRONG' | 'MODERATE' | 'WEAK';
  volatility: 'HIGH' | 'NORMAL' | 'LOW';
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  support: string;
  resistance: string;
  fibLevel: string;
  rsiValue: number;
}

// ----------------------------------------------------------
// Signal Lifecycle & Active Context
// ----------------------------------------------------------

export enum SignalLifecycleStage {
  CANDIDATE = 'CANDIDATE',
  CONFIRMED = 'CONFIRMED',
  ENTRY_WINDOW = 'ENTRY_WINDOW',
  ACTIVE_CONTEXT = 'ACTIVE_CONTEXT',
  EXPIRED = 'EXPIRED',
}

export interface ActiveTradeContext {
  signalId: string;
  originalAction: TradingAction;
  originalConfidence: number;
  source?: 'SIGNAL' | 'MANUAL';
  entryTimestamp: number;
  recommendedExpiry: string;
  remainingSeconds: number | null;
  status: 'STABLE' | 'DETERIORATING' | 'AGAINST_THESIS';
  tradeStatus: TradeStatusLabel;
  tradeHealth?: TradeHealth;
  reason: string;
}

export interface RecentDecisionEntry {
  action: TradingAction;
  timestamp: number;
  signalStrength: number;
}

export interface MarketIntelInput {
  observation?: MarketObservation | null;
  decision?: any;
  riskAssessment?: any;
  evidenceBreakdown?: EvidenceBreakdown | null;
  smoothedState?: { trend?: TrendDirection | null; bias?: any; momentum?: MomentumLevel | null } | null;
  debugMode?: boolean;
}

export interface MarketIntelState {
  regime: {
    primary: string;
    secondary?: string;
  };
  momentum: {
    primary: string;
    secondary?: string;
  };
  structure: {
    primary: string;
    health?: string;
  };
  liquidity: string;
  pressure: string;
  /** Evidence-derived pressure split for the live overlay (0..100). */
  pressureBuyPercent?: number;
  pressureSellPercent?: number;
  /** Explains whether the split came from usable market evidence. */
  pressureSource?: 'EVIDENCE' | 'DERIVED' | 'UNAVAILABLE';
  trendStrength?: number | null;
  trendStrengthStatus?: 'CALCULATED' | 'WARMING' | 'UNAVAILABLE';
  support: {
    display: string;
    status: 'FAR' | 'HIT' | 'BROKEN' | 'UNKNOWN';
  };
  resistance: {
    display: string;
    status: 'FAR' | 'HIT' | 'BROKEN' | 'UNKNOWN';
  };
  reversalRisk: string;
  nextExpectation: {
    primary: string;
    secondary?: string;
  };
  debugMapping?: Record<string, string>;
  aiMetrics?: {
    trendQuality: number;
    momentumQuality: number;
    volatilityScore: number;
    marketRegime: string;
    patternProbability: number;
    structureConfidence: number;
    reversalProbability: number;
    breakoutProbability: number;
    fakeoutProbability: number;
    consolidationProbability: number;
    noiseLevel: number;
  };
}

// ----------------------------------------------------------
// Overlay State (Main -> Overlay Renderer)
// ----------------------------------------------------------

export interface OverlayState {
  // System
  systemStatus: SystemStatus;
  analysisState: AnalysisState;

  // Trading Decision Card (MARS SIGNAL Panel)
  decision: TradingAction | null;
  signalStatus?: SignalStatusLabel;
  tradeStatus?: TradeStatusLabel;
  tradeHealth?: TradeHealth;
  signalStrength: number | null;
  confidence: CanonicalConfidence;
  /** Display-only WAIT score, normalized to the full inclusive 1..100 range. */
  waitScore?: number | null;
  /** Calibrated win probability (0..1) — the honest estimate from the journal. */
  winProbability?: number | null;
  /** Whether confidence calibration is active (enough verified trades). */
  calibrationActive?: boolean;
  /** Expected calibration error — 0 means confidence == actual win rate. */
  calibrationEce?: number | null;
  risk: CanonicalRisk;
  reason?: string | null;
  reasons: string[];
  entryGuidance: 'ENTRY NOW' | 'ENTRY IN Ns' | 'WAIT';
  recommendedExpiry: string | null;
  lifecycleStage: SignalLifecycleStage;
  activeTradeContext: ActiveTradeContext | null;

  // Entry timing
  entryCountdownSec: number | null;
  marketRegime: MarketRegime | null;

  // Market Intelligence Panel
  trend: TrendDirection | null;
  momentum: MomentumLevel | null;
  volatility: VolatilityLevel | null;
  marketBias: MarketBias | null;
  supportLevel: StructuralLevel | null;
  resistanceLevel: StructuralLevel | null;
  marketIntelState?: MarketIntelState | null;

  // Trade monitor — the ACTIVE trade (manual or signal, treated equally)
  // is analyzed until expiry with live P&L and S&L distances.
  tradeMonitor?: {
    signalId: string;
    source: 'SIGNAL' | 'MANUAL';
    action: TradingAction;
    asset: string | null;
    entryPrice: number | null;
    currentPrice: number | null;
    pnlPct: number | null;
    pnlPoints: number | null;
    remainingSeconds: number | null;
    health: 'IN PROFIT' | 'AT ENTRY' | 'AGAINST' | 'NO TRADE';
    healthReason: string;
    targetPrice: number | null;
    targetPoints: number | null;
    stopPrice: number | null;
    stopPoints: number | null;
    /** Win probability estimated at entry (TradeWinPredictor). */
    winProb: number | null;
  } | null;

  /** Most recent completed trade result (auto-verified from price). */
  lastTradeResult?: {
    action: TradingAction;
    asset: string | null;
    outcome: 'WIN' | 'LOSS' | 'DRAW';
    entryPrice: number | null;
    exitPrice: number | null;
    completedAt: number;
  } | null;

  /** Strongest recent setup across scanned assets (best-asset picker). */
  bestSetup?: {
    asset: string;
    winProb: number;
    signalStrength: number;
    confidence: number;
  } | null;

  // Instrument Info
  asset: string | null;
  platformMode?: PlatformMode | null;
  timeframe: string | null;
  currentPrice: string | null;
  lastUpdate: number | null;

  // Settings sync
  soundEnabled: boolean;
  calibrationMode?: AnalysisMode | 'SAFE' | 'BALANCED' | 'COMPREHENSIVE' | 'SNIPER' | 'AGGRESSIVE';
  recentDecisions?: RecentDecisionEntry[];

  // Sound event types
  soundAlertType?: 'BUY' | 'SELL' | 'DETERIORATION' | null;
}

// ----------------------------------------------------------
// Calibration & Model Health Analysis (Renderer fetch)
// ----------------------------------------------------------

export interface CalibrationBinView {
  min: number;
  max: number;
  sampleCount: number;
  winCount: number;
  empiricalRate: number;
  calibratedRate: number;
}

export interface CalibrationAnalysis {
  active: boolean;
  sampleCount: number;
  winCount: number;
  overallWinRate: number;
  /** Expected Calibration Error â€” 0 = perfectly calibrated. */
  ece: number;
  /** % of samples whose calibrated estimate is within 5 points of reality. */
  wellCalibratedPct: number;
  disabledReason: string | null;
  builtAt: number;
  bins: CalibrationBinView[];
  /** Honest out-of-sample ML validation (per asset). */
  mlValidation: Array<{
    asset: string;
    accuracy: number;
    balancedAccuracy: number;
    validationSize: number;
    trainSize: number;
    timestamp: number;
  }>;
  /** Live data-integrity snapshot from the anomaly detector. */
  anomaly: {
    status: 'CLEAN' | 'WATCH' | 'DEGRADED';
    healthy: boolean;
    consecutiveStaleScans: number;
    lastPriceAgeMs: number;
    priceJumpPct: number | null;
  } | null;
}

// ----------------------------------------------------------
// Control Center State (Main -> Control Center Renderer)
// ----------------------------------------------------------

export interface ControlCenterState {
  analysisState: AnalysisState;
  systemStatus: SystemStatus;
  asset: string | null;
  timeframe: string | null;
  overlayVisible: boolean;
  sessionId: string | null;
  totalSignals: number;
  activeTradeCount: number;
  lastUpdate: number | null;
}

// ----------------------------------------------------------
// Developer Diagnostics (Main -> Control Center, dev mode)
// ----------------------------------------------------------

export interface DeveloperDiagnostics {
  latestReport: ScannerDiagnosticReport | null;
  scanCadenceMs: number;
  framesProcessed: number;
  pipelineErrorCount: number;
  runtimePerformance?: {
    completedScans: number;
    skippedScans: number;
    lastScanDurationMs: number;
    maxScanDurationMs: number;
    captureDurationMs: number | null;
    workerAnalysisDurationMs: number | null;
    quoteHeartbeatAgeMs: number | null;
    eventLoopLagMs: number;
    overlayIpcUpdates: number;
    quoteIpcUpdates: number;
    databasePersistence: {
      completedSaves: number;
      skippedNoopTransactions: number;
      lastSaveDurationMs: number;
      dirty: boolean;
    } | null;
  };
}

// ----------------------------------------------------------
// Settings
// ----------------------------------------------------------

export type ExpiryPreset = 'auto' | '30s' | '45s' | '1m' | '2m' | '3m' | '4m' | '5m' | '15m';

export interface AppSettings {
  overlayEnabled: boolean;
  overlayScale: number;
  overlayOpacity: number;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  developerMode: boolean;
  diagnosticCapture: boolean;
  historyRetentionDays: number;
  scanIntervalMs: number;
  targetDisplayId: string | null;

  // Trading settings
  expiryOverride: ExpiryPreset;
  autoExpiry: boolean;
  enabledExpiries: ExpiryPreset[];
  minConfidenceToAlert: number;
  signalSensitivity: 'conservative' | 'balanced' | 'aggressive';

  // Calibration mode: switchable at any time from the Settings UI.
  // Controls every threshold in the decision engine and signal stabilizer
  // (SAFE 0.85 / BALANCED 0.70 / COMPREHENSIVE 0.60).
  calibrationMode: AnalysisMode | 'SAFE' | 'BALANCED' | 'COMPREHENSIVE' | 'SNIPER' | 'AGGRESSIVE';

  // Per-sound controls
  soundBuyEnabled: boolean;
  soundSellEnabled: boolean;
  soundDeteriorationEnabled: boolean;

  // Performance: real image OCR (tesseract.js) is a CPU-heavy fallback that
  // pegs weak machines — OFF by default, toggleable from Settings.
  enableImageOcr: boolean;

  // Signal cooldown: after a signal expires or is invalidated, wait this many
  // seconds before a new signal can form (prevents instant weak re-signals
  // right after a signal ends).
  signalCooldownSec: number;

  // Persisted overlay window bounds — restored on next launch so the panel
  // reopens exactly where the user left it (size included).
  overlayBounds: { x: number; y: number; width: number; height: number } | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  overlayEnabled: true,
  overlayScale: 1.0,
  overlayOpacity: 0.95,
  notificationsEnabled: true,
  soundEnabled: true,
  developerMode: false,
  diagnosticCapture: false,
  historyRetentionDays: 30,
  scanIntervalMs: 2000,
  targetDisplayId: null,

  expiryOverride: 'auto',
  autoExpiry: true,
  enabledExpiries: ['auto'],
  minConfidenceToAlert: 65,
  signalSensitivity: 'balanced',
  calibrationMode: 'BALANCED',
  soundBuyEnabled: true,
  soundSellEnabled: true,
  soundDeteriorationEnabled: true,
  enableImageOcr: false,
  signalCooldownSec: 15,
  overlayBounds: null,
};

// ----------------------------------------------------------
// Overlay Position
// ----------------------------------------------------------

export interface OverlayPosition {
  panelId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// ----------------------------------------------------------
// History Query
// ----------------------------------------------------------

export interface HistoryQuery {
  sessionId?: string;
  asset?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
  action?: TradingAction;
  outcome?: string;
  todayOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface HistoryEntry {
  id: string;
  signalId?: string | null;
  sessionId: string;
  timestamp: number;
  asset: string | null;
  platformMode?: PlatformMode | null;
  tradeStatus?: string | null;
  timeframe: string | null;
  rawDecision: TradingAction;
  stabilizedDecision: TradingAction;
  signalStrength: number;
  risk: CanonicalRisk;
  dataQuality: QualityLevel;
  reason: string;
  recommendedExpiry: string | null;
  outcome: string | null;
  confidence: CanonicalConfidence;
  marketRegime: string | null;
  exitTimestamp?: number | null;
  durationSec?: number | null;
  entryPrice?: string | null;
  exitPrice?: string | null;
}

export interface ManualTradeInput {
  asset: string;
  timeframe: string | null;
  action: TradingAction;
  outcome: 'WIN' | 'LOSS' | 'DRAW';
  reason?: string;
  signalStrength?: number;
  risk?: CanonicalRisk;
  recommendedExpiry?: string | null;
}

// ----------------------------------------------------------
// Performance Stats (Task T2.2, T2.3, T2.4)
// ----------------------------------------------------------

export interface PerformanceStats {
  // Completed trades only (not signals, not active)
  totalCompleted: number;
  sessionWins: number;
  sessionLosses: number;
  sessionWinRate: number;
  allTimeWins: number;
  allTimeLosses: number;
  allTimeWinRate: number;
  activeTradeCount: number;
  /** Every captured execution, including active or incomplete records. */
  registeredTradeCount?: number;
  unresolvedTradeCount?: number;
  recentForm: ('W' | 'L' | 'D')[];

  // Task T2.2: Rates
  overallWinRate: number;
  todayWinRate: number;
  buyWinRate: number;
  sellWinRate: number;

  // Task T2.3: Advanced Streaks & Averages
  currentWinningStreak: number;
  maxWinningStreak: number;
  currentLosingStreak: number;
  maxLosingStreak: number;
  avgTradeDurationSec: number;
  avgConfidence: CanonicalConfidence;
  avgRiskLevel: string;
  avgExpirySec: number;

  // Task T2.4: Asset stats
  bestAsset: { asset: string; winRate: number; totalTrades: number } | null;
  worstAsset: { asset: string; winRate: number; totalTrades: number } | null;
  assetStatsMap: Record<string, { asset: string; wins: number; losses: number; draws: number; winRate: number; totalTrades: number }>;

  // Breakdowns
  byExpiry: Record<string, { wins: number; losses: number }>;
  byDirection: { buy: { wins: number; losses: number }; sell: { wins: number; losses: number } };
  byAsset: Record<string, { wins: number; losses: number }>;

  // Raw signal stats (non-trade)
  totalSignals: number;
  buyCount: number;
  sellCount: number;
  waitCount: number;
  avgSignalStrength: number;
  signalsByRisk: Record<RiskLevel, number>;
  hasOutcomeData: boolean;
  winCount: number;
  lossCount: number;
  drawCount: number;
  insufficientData: boolean;
}

// ----------------------------------------------------------
// Tracked Trade (active lifecycle)
// ----------------------------------------------------------

export type TradeStatus = 'PENDING_ENTRY' | 'ACTIVE' | 'EXPIRED' | 'COMPLETED' | 'CANCELLED';

export interface TrackedTrade {
  id: string;
  sessionId: string;
  signalId: string;
  executionId?: string;
  action: TradingAction;
  asset: string | null;
  platformMode?: PlatformMode;
  timeframe: string | null;
  expiryLabel: string;
  expirySeconds: number;
  confidence: CanonicalConfidence;
  regime: string | null;
  entryPrice: string | null;
  entryTimestamp: number;
  expiryTimestamp: number;
  status: TradeStatus;
  outcome: TradeOutcome | null;
  originalReasons: string[];
  completionTimestamp: number | null;
  completionPrice: string | null;
}
