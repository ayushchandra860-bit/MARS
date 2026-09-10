// ============================================================
// MARS PRO V3 — Session Types
// Analysis lifecycle state machine and session contracts.
// ============================================================

import { SessionId } from './scanner';

/** Analysis lifecycle states */
export enum AnalysisState {
  STOPPED = 'STOPPED',
  STARTING = 'STARTING',
  RUNNING = 'RUNNING',
  STOPPING = 'STOPPING',
  ERROR = 'ERROR',
}

/** System operational status (separate from trading decision) */
export enum SystemStatus {
  SCANNING = 'SCANNING',
  READY = 'READY',
  DEGRADED = 'DEGRADED',
  UNAVAILABLE = 'UNAVAILABLE',
}

/** Represents an active analysis session */
export interface AnalysisSession {
  sessionId: SessionId;
  startedAt: number;
  endedAt: number | null;
  displayId: string;
  state: AnalysisState;
  totalFramesProcessed: number;
  totalDecisionsProduced: number;
}
