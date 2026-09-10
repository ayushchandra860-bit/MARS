// ============================================================
// MARS PRO V3 — Market Analysis Types
// Trend, momentum, volatility, structure, support/resistance, regime.
// ============================================================

/** Trend direction derived from swing progression */
export enum TrendDirection {
  BULLISH = 'BULLISH',
  BEARISH = 'BEARISH',
  NEUTRAL = 'NEUTRAL',
}

/** Momentum strength */
export enum MomentumLevel {
  STRONG = 'STRONG',
  MODERATE = 'MODERATE',
  WEAK = 'WEAK',
}

/** Volatility classification */
export enum VolatilityLevel {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
}

/** Swing point type */
export enum SwingType {
  HIGHER_HIGH = 'HH',
  HIGHER_LOW = 'HL',
  LOWER_HIGH = 'LH',
  LOWER_LOW = 'LL',
}

/** Market structure classification */
export enum MarketStructure {
  UPTREND = 'UPTREND',
  DOWNTREND = 'DOWNTREND',
  CONSOLIDATION = 'CONSOLIDATION',
  BREAKOUT_UP = 'BREAKOUT_UP',
  BREAKOUT_DOWN = 'BREAKOUT_DOWN',
  PULLBACK_UP = 'PULLBACK_UP',
  PULLBACK_DOWN = 'PULLBACK_DOWN',
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
}

/** Market bias for overall assessment */
export enum MarketBias {
  BULLISH = 'BULLISH',
  BEARISH = 'BEARISH',
  NEUTRAL = 'NEUTRAL',
}

/** Broad market regime — brain-internal classification */
export enum MarketRegime {
  TRENDING = 'TRENDING',
  RANGING = 'RANGING',
  BREAKOUT = 'BREAKOUT',
  CHOPPY = 'CHOPPY',
  HIGH_VOLATILITY = 'HIGH_VOLATILITY',
  UNKNOWN = 'UNKNOWN',
}

/** Support/resistance interaction state machine */
export enum SRInteractionState {
  APPROACHING = 'APPROACHING',
  TESTING = 'TESTING',
  HELD = 'HELD',
  REJECTED = 'REJECTED',
  BROKEN = 'BROKEN',
  RETESTING = 'RETESTING',
}

/** A swing point detected from candle geometry */
export interface SwingPoint {
  index: number;
  pricePx: number;
  type: SwingType;
}

/** Support/resistance level (pixel/point based) */
export interface StructuralLevel {
  pricePx: number;
  touchCount: number;
  strength: number;
  strengthLabel: 'STRONG' | 'MODERATE';
  role: 'SUPPORT' | 'RESISTANCE';
  distancePts: number;
  interactionState: SRInteractionState;
  reactionDetail: string;
}

/** Evidence container for trend analysis */
export interface TrendEvidence {
  direction: TrendDirection;
  strength: number;
  swingProgression: SwingType[];
  candlesAnalyzed: number;
}

/** Evidence container for momentum analysis */
export interface MomentumEvidence {
  level: MomentumLevel;
  directionalConsistency: number;
  averageBodyRatio: number;
  acceleration: number;
}

/** Evidence container for volatility analysis */
export interface VolatilityEvidence {
  level: VolatilityLevel;
  normalizedRange: number;
  rangeStdDev: number;
}

/** Evidence container for market structure */
export interface StructureEvidence {
  structure: MarketStructure;
  swingPoints: SwingPoint[];
  confidence: number;
}

/** Evidence container for support/resistance */
export interface SupportResistanceEvidence {
  levels: StructuralLevel[];
  nearestSupport: StructuralLevel | null;
  nearestResistance: StructuralLevel | null;
}

/** Evidence container for pattern detection */
export interface PatternEvidence {
  patterns: DetectedPattern[];
}

export interface DetectedPattern {
  name: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  candleIndices: number[];
}
