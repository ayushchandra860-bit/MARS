// ============================================================
// MARS PRO V3 — Database Types
// Schema definitions for SQLite tables.
// ============================================================

export interface DbSignalHistory {
  id: string;
  session_id: string;
  frame_id: string;
  timestamp: number;
  asset: string | null;
  timeframe: string | null;
  raw_decision: string;
  stabilized_decision: string;
  raw_reason: string;
  stabilized_reason: string;
  signal_strength: number;
  risk: string;
  data_quality: string;
  market_bias: string;
  recommended_expiry: string | null;
  outcome: string | null;
  confidence: number | null;
  market_regime: string | null;
  evidence_summary: string | null;
  market_state: string | null;
  entry_context: string | null;
}

export interface DbSession {
  id: string;
  started_at: number;
  ended_at: number | null;
  display_id: string;
  total_frames: number;
  total_decisions: number;
}

export interface DbSetting {
  key: string;
  value: string;
}

export interface DbOverlayPosition {
  panel_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
