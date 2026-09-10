// ============================================================
// MARS PRO V3 — Canonical Single Source of Truth Types
// These are the authoritative state models consumed by every
// downstream component in the pipeline.
// ============================================================

import { RiskLevel } from './decision';

// ----------------------------------------------------------
// Asset Identity — replaces fragmented string-based assets
// ----------------------------------------------------------

/** Canonical asset identity. Normalized immediately after extraction. */
export interface AssetIdentity {
  /** Normalized unique ID (e.g. "BNB_OTC", "EUR_USD") */
  assetId: string;
  /** Human-readable display name (e.g. "BNB OTC", "EUR/USD") */
  displayName: string;
  /** Raw name as seen on broker platform */
  brokerName: string;
  /** Short symbol (e.g. "BNB", "EUR/USD") */
  symbol: string;
  /** Market classification */
  marketType: AssetMarketType;
  /** Timestamp when this identity was extracted */
  sourceTimestamp: number;
}

export type AssetMarketType =
  | 'OTC'
  | 'STANDARD'
  | 'CRYPTO'
  | 'FOREX'
  | 'COMMODITY'
  | 'INDEX'
  | 'UNKNOWN';

// ----------------------------------------------------------
// Platform Mode — Demo vs Live explicit separation
// ----------------------------------------------------------

/** Explicit platform mode — never scrubbed, always tagged */
export enum PlatformMode {
  LIVE = 'LIVE',
  DEMO = 'DEMO',
  UNKNOWN = 'UNKNOWN',
}

// ----------------------------------------------------------
// Data Freshness
// ----------------------------------------------------------

/** How fresh the observation data is */
export enum DataFreshness {
  /** Data is within acceptable freshness window */
  FRESH = 'FRESH',
  /** Data is aging but still usable with caution */
  STALE = 'STALE',
  /** Data is too old to be used for decision making */
  EXPIRED = 'EXPIRED',
}

// ----------------------------------------------------------
// Data Source Provenance
// ----------------------------------------------------------

/** Where the market data was extracted from */
export enum DataSource {
  DOM_TITLE = 'DOM_TITLE',
  DOM_BODY = 'DOM_BODY',
  OCR = 'OCR',
  CACHED = 'CACHED',
  WEBSOCKET = 'WEBSOCKET',
  MUTATION_OBSERVER = 'MUTATION_OBSERVER',
}

// ----------------------------------------------------------
// Analysis Modes — replaces SNIPER/BALANCED/AGGRESSIVE
// ----------------------------------------------------------

/**
 * Analysis mode controlling signal strictness and analysis depth.
 *
 * SAFE       — strictest data-quality, strongest confirmation, fewest signals
 * BALANCED   — moderate threshold, balanced signal frequency
 * COMPREHENSIVE — widest evidence, broader context, more opportunities
 */
export enum AnalysisMode {
  SAFE = 'SAFE',
  BALANCED = 'BALANCED',
  COMPREHENSIVE = 'COMPREHENSIVE',
}

/**
 * Maps legacy mode names to new canonical modes.
 * Use this during transition to maintain backward compatibility.
 */
export function toLegacyMode(mode: AnalysisMode): 'SNIPER' | 'BALANCED' | 'AGGRESSIVE' {
  switch (mode) {
    case AnalysisMode.SAFE: return 'SNIPER';
    case AnalysisMode.BALANCED: return 'BALANCED';
    case AnalysisMode.COMPREHENSIVE: return 'AGGRESSIVE';
  }
}

export function fromLegacyMode(legacy: string): AnalysisMode {
  switch (legacy) {
    case 'SNIPER': return AnalysisMode.SAFE;
    case 'AGGRESSIVE': return AnalysisMode.COMPREHENSIVE;
    case 'BALANCED':
    default: return AnalysisMode.BALANCED;
  }
}

// ----------------------------------------------------------
// Canonical Confidence — null means UNAVAILABLE
// ----------------------------------------------------------

/**
 * Canonical confidence value.
 * - number: Always in 0.0–1.0 range (0% to 100%)
 * - null: Confidence is UNAVAILABLE — data insufficient
 *
 * NEVER use 0.5 as a fallback for missing data.
 * 50% (0.5) is only valid when a calibrated model genuinely outputs it.
 */
export type CanonicalConfidence = number | null;

// ----------------------------------------------------------
// Canonical Risk — null means UNASSESSED
// ----------------------------------------------------------

/**
 * Canonical risk value.
 * - RiskLevel: Properly assessed risk
 * - null: Risk is UNASSESSED — data insufficient
 *
 * NEVER use RiskLevel.MEDIUM as a fallback for missing data.
 */
export type CanonicalRisk = RiskLevel | null;

// ----------------------------------------------------------
// Quality Gate Result
// ----------------------------------------------------------

export enum QualityGateRejection {
  NONE = 'NONE',
  DEMO_MODE = 'DEMO_MODE',
  STALE_DATA = 'STALE_DATA',
  EXPIRED_DATA = 'EXPIRED_DATA',
  INVALID_ASSET = 'INVALID_ASSET',
  INVALID_PRICE = 'INVALID_PRICE',
  INSUFFICIENT_CANDLES = 'INSUFFICIENT_CANDLES',
  LOW_CANDLE_QUALITY = 'LOW_CANDLE_QUALITY',
  LOW_DATA_QUALITY = 'LOW_DATA_QUALITY',
  DUPLICATE_OBSERVATION = 'DUPLICATE_OBSERVATION',
}

export interface QualityGateResult {
  passed: boolean;
  rejection: QualityGateRejection;
  reason: string;
  /** Observation freshness at time of evaluation */
  freshness: DataFreshness;
  /** Platform mode detected */
  platformMode: PlatformMode;
}

// ----------------------------------------------------------
// Freshness Configuration
// ----------------------------------------------------------

/** Thresholds for data freshness classification (milliseconds) */
export const FRESHNESS_THRESHOLDS = {
  /** Data younger than this is FRESH */
  FRESH_MAX_AGE_MS: 5_000,
  /** Data younger than this is STALE (between FRESH and EXPIRED) */
  STALE_MAX_AGE_MS: 15_000,
  /** Data older than STALE_MAX_AGE_MS is EXPIRED */
} as const;

// ----------------------------------------------------------
// Asset Normalization Utilities
// ----------------------------------------------------------

/** Patterns that are NOT valid asset names */
const INVALID_ASSET_PATTERNS = [
  /^unknown$/i,
  /^no[_\s]?asset$/i,
  /^demo$/i,
  /^[\u25B2\u25BC\u2191\u2193]+$/,  // Arrow symbols
  /^tradin$/i,
  /^live$/i,
  /^account$/i,
  /^[\s]*$/,
];

/** Check if an asset string is a valid, usable asset name */
export function isValidAssetName(raw: string | null | undefined): raw is string {
  if (!raw || typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (trimmed.length < 2 || trimmed.length > 40) return false;
  return !INVALID_ASSET_PATTERNS.some(p => p.test(trimmed));
}

/** Detect market type from normalized asset name */
export function detectMarketType(assetId: string): AssetMarketType {
  if (assetId.includes('_OTC') || assetId.endsWith('OTC')) return 'OTC';
  if (/^[A-Z]{3}[/_][A-Z]{3}$/.test(assetId)) return 'FOREX';
  const cryptoSymbols = ['BTC', 'ETH', 'BNB', 'SOL', 'ADA', 'DOGE', 'XRP', 'LTC', 'DOT'];
  if (cryptoSymbols.some(s => assetId.startsWith(s))) return 'CRYPTO';
  if (/INDEX/i.test(assetId)) return 'INDEX';
  return 'UNKNOWN';
}

/**
 * Normalize a raw asset string into a canonical AssetIdentity.
 * Returns null if the raw string is not a valid asset.
 */
export function normalizeAsset(raw: string | null | undefined, timestamp?: number): AssetIdentity | null {
  if (!isValidAssetName(raw)) return null;
  const trimmed = raw!.trim();

  // Normalize: replace spaces/hyphens with underscore, uppercase
  const assetId = trimmed
    .replace(/\s+/g, '_')
    .replace(/-/g, '_')
    .toUpperCase();

  // Build display name: restore spaces from underscores
  const displayName = assetId.replace(/_/g, ' ');

  // Extract symbol (first part before underscore or slash)
  const symbol = assetId.split(/[_/]/)[0];

  return {
    assetId,
    displayName,
    brokerName: trimmed,
    symbol,
    marketType: detectMarketType(assetId),
    sourceTimestamp: timestamp ?? Date.now(),
  };
}

/**
 * Compute data freshness based on timestamp age.
 */
export function computeFreshness(observationTimestamp: number, nowMs?: number): DataFreshness {
  const age = (nowMs ?? Date.now()) - observationTimestamp;
  if (age <= FRESHNESS_THRESHOLDS.FRESH_MAX_AGE_MS) return DataFreshness.FRESH;
  if (age <= FRESHNESS_THRESHOLDS.STALE_MAX_AGE_MS) return DataFreshness.STALE;
  return DataFreshness.EXPIRED;
}
