// ============================================================
// MARS PRO V3 — Canonical Formatters
// Single source for confidence/risk display formatting.
// ALL UI components must use these formatters.
// ============================================================

import { CanonicalConfidence, CanonicalRisk } from '../types/canonical';
import { RiskLevel } from '../types/decision';

// ----------------------------------------------------------
// Confidence Formatting
// ----------------------------------------------------------

/**
 * Format canonical confidence for display.
 * - null → "UNAVAILABLE"
 * - 0.72 → "72%"
 * - Values > 1 are normalized (assumes 0-100 scale legacy data)
 *
 * This is the ONLY function that should format confidence for UI.
 */
export function formatConfidence(value: CanonicalConfidence): string {
  if (value === null || value === undefined) return 'UNAVAILABLE';
  const normalized = normalizeConfidenceToRatio(value);
  if (normalized === null) return 'UNAVAILABLE';
  return `${Math.round(normalized * 100)}%`;
}

/**
 * Format confidence as a number for display (0-100 scale).
 * Returns null if confidence is unavailable.
 */
export function formatConfidenceNumeric(value: CanonicalConfidence): number | null {
  if (value === null || value === undefined) return null;
  const normalized = normalizeConfidenceToRatio(value);
  if (normalized === null) return null;
  return Math.round(normalized * 100);
}

/**
 * Normalize any confidence value to canonical 0-1 range.
 * - Values > 1 and <= 100 are treated as percentage (divided by 100)
 * - Values in 0-1 are kept as-is
 * - NaN/Infinity/negative → null
 */
export function normalizeConfidenceToRatio(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !isFinite(value)) return null;
  if (value < 0) return null;

  // Normalize: if > 1, assume it's a 0-100 scale
  const normalized = value > 1 ? value / 100 : value;

  // Clamp to valid range
  return Math.max(0, Math.min(1, normalized));
}

/**
 * Check if a confidence value represents genuine model output
 * vs a fallback/default value.
 */
export function isConfidenceAvailable(value: unknown): value is number {
  return value !== null && value !== undefined && typeof value === 'number' && isFinite(value);
}

// ----------------------------------------------------------
// Risk Formatting
// ----------------------------------------------------------

/**
 * Format canonical risk for display.
 * - null → "UNASSESSED"
 * - RiskLevel.LOW → "LOW"
 *
 * This is the ONLY function that should format risk for UI.
 */
export function formatRisk(value: CanonicalRisk): string {
  if (value === null || value === undefined) return 'UNASSESSED';
  return value;
}

/**
 * Check if a risk value has been properly assessed.
 */
export function isRiskAssessed(value: unknown): value is RiskLevel {
  return value !== null && value !== undefined &&
    (value === RiskLevel.LOW || value === RiskLevel.MEDIUM || value === RiskLevel.HIGH);
}

/**
 * Get risk display color for UI.
 */
export function getRiskColor(value: CanonicalRisk): string {
  switch (value) {
    case RiskLevel.LOW: return '#00e676';
    case RiskLevel.MEDIUM: return '#ffab00';
    case RiskLevel.HIGH: return '#ff5252';
    default: return '#666666';
  }
}

// ----------------------------------------------------------
// Analysis Mode Formatting
// ----------------------------------------------------------

/**
 * Get display label for analysis mode.
 */
export function formatAnalysisMode(mode: string): string {
  switch (mode) {
    case 'SAFE': return 'Safe';
    case 'BALANCED': return 'Balanced';
    case 'COMPREHENSIVE': return 'Comprehensive';
    // Legacy compatibility
    case 'SNIPER': return 'Safe';
    case 'AGGRESSIVE': return 'Comprehensive';
    default: return 'Balanced';
  }
}
