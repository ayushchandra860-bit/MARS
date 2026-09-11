// ============================================================
// MARS PRO V3 — Decision Types
// Trading decision, evidence, risk, expiry, stabilization, lifecycle.
// ============================================================

import { SessionId, FrameId, QualityLevel } from './scanner';
import { MarketBias, MarketRegime } from './market';
import { CanonicalConfidence, CanonicalRisk, AnalysisMode, PlatformMode } from './canonical';

export enum TradingAction {
  BUY = 'BUY',
  SELL = 'SELL',
  WAIT = 'WAIT',
}

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum WaitReason {
  SIDEWAYS_MARKET = 'Sideways market',
  WEAK_MOMENTUM = 'Weak momentum',
  CONFLICTING_SIGNALS = 'Conflicting signals',
  NEAR_RESISTANCE = 'Near resistance',
  NEAR_SUPPORT = 'Near support',
  LOW_CONFIRMATION = 'Low confirmation',
  WAITING_FOR_BREAKOUT = 'Waiting for breakout',
  HIGH_VOLATILITY = 'High volatility',
  CHOPPY_MARKET = 'Choppy market — directional setup blocked',
  INSUFFICIENT_TREND_DATA = 'Insufficient trend-strength data',
  WEAK_TREND_STRENGTH = 'Weak trend strength — confirmation required',
  INSUFFICIENT_STRUCTURE = 'Insufficient structure',
  NO_CLEAR_SETUP = 'No clear setup',
  DATA_NOT_READY = 'Data not ready or insufficient quality',
  DATA_STALE = 'Market data is stale or expired',
  DEMO_ACCOUNT_BLOCKED = 'Demo account blocked from live signal generation',
}

export enum SignalLifecycle {
  WATCHING = 'WATCHING',
  FORMING = 'FORMING',
  CONFIRMING = 'CONFIRMING',
  CONFIRMED = 'CONFIRMED',
  ENTRY_WINDOW = 'ENTRY_WINDOW',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  INVALIDATED = 'INVALIDATED',
}

export enum TradeHealth {
  HEALTHY = 'HEALTHY',
  WEAKENING = 'WEAKENING',
  CRITICAL = 'CRITICAL',
  INVALID = 'INVALID',
}

export type SignalStatusState = 'WAIT' | 'BUY SIGNAL ACTIVE' | 'SELL SIGNAL ACTIVE';
export type TradeStatusState = 'NO TRADE' | 'ENTRY WINDOW' | 'TRADE ACTIVE' | 'TRADE INVALIDATED' | 'TRADE COMPLETED';
export type SignalStatusLabel = SignalStatusState;
export type TradeStatusLabel = TradeStatusState;
export type CalibrationMode = AnalysisMode | 'SAFE' | 'BALANCED' | 'COMPREHENSIVE' | 'SNIPER' | 'AGGRESSIVE';

export enum TradeState {
  WAITING = 'WAITING',
  ENTRY_DETECTED = 'ENTRY_DETECTED',
  TRADE_ACTIVE = 'TRADE_ACTIVE',
  EXPIRING = 'EXPIRING',
  WIN = 'WIN',
  LOSS = 'LOSS',
  DRAW = 'DRAW',
  ARCHIVED = 'ARCHIVED',
}

export interface AuthoritativeTradeRecord {
  id: string;
  observationId?: string;
  sessionId: string;
  signalId?: string;
  executionId?: string;
  asset: string | null;
  direction: TradingAction;
  entryTimestamp: number;
  expirySeconds: number;
  expiryTimestamp: number;
  status: TradeState;
  runningTimeSec: number;
  result: TradeOutcome | null;
  confidence?: CanonicalConfidence;
  entryPrice?: string | null;
  completionPrice?: string | null;
  completionTimestamp?: number | null;
  expiryLabel?: string;
  reasons?: string[];
  timeframe?: string | null;
  regime?: string | null;
  platformMode?: PlatformMode;
  /** Immutable normalized features captured at entry for post-trade learning. */
  mlFeatures?: number[];
}

export interface TradeExplanation {
  trend: string;
  momentum: string;
  structure: string;
  risk: string;
  support: string;
  resistance: string;
}

export interface RawDecisionResult {
  observationId?: string;
  action: TradingAction;
  reason: string;
  reasons: string[];
  signalStrength: number;
  confidence: CanonicalConfidence;
  risk: CanonicalRisk;
  marketBias: MarketBias;
  recommendedExpiry: string | null;
  dataQuality: QualityLevel;
  timestamp: number;
}

export interface StabilizedDecision extends RawDecisionResult {
  frameConsistency: number;
  wasStabilized: boolean;
}

export interface EnrichedDecision extends StabilizedDecision {
  lifecycle: SignalLifecycle;
  marketRegime: MarketRegime;
  entryGuidance: string;
  entryCountdownSec: number | null;
}

export interface DecisionRecord {
  id: string;
  sessionId: SessionId;
  frameId: FrameId;
  timestamp: number;
  asset: string | null;
  timeframe: string | null;
  rawDecision: TradingAction;
  stabilizedDecision: TradingAction;
  rawReason: string;
  stabilizedReason: string;
  signalStrength: number;
  confidence: CanonicalConfidence;
  risk: CanonicalRisk;
  dataQuality: QualityLevel;
  marketBias: MarketBias;
  recommendedExpiry: string | null;
  outcome: TradeOutcome | null;
}

export enum TradeOutcome {
  WIN = 'WIN',
  LOSS = 'LOSS',
  DRAW = 'DRAW',
  UNRESOLVED = 'UNRESOLVED',
}

export interface EvidenceBreakdown {
  trendScore: number;
  momentumScore: number;
  structureScore: number;
  volatilityScore: number;
  supportResistanceScore: number;
  candleConfirmationScore: number;
  patternScore: number;
  dataQualityScore: number;
  rsiScore: number | null;
  bollingerScore: number | null;
  fibonacciScore: number | null;
  emaScore: number | null;
  agreementScore: number | null;
  overallStrength: number;
}
