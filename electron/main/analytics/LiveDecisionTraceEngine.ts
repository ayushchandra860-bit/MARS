// ============================================================
// MARS PRO V3 — Live Decision Trace Engine & Trade Debugger (Sprint T7)
// Captures full per-scan decision traces, signal flip logs, and active trade debugging.
// Zero performance/memory overhead when disabled.
// ============================================================

import { RunningTradeManager } from '../trade/RunningTradeManager';
import { AuthoritativeTradeRecord, TradeState } from '../../../shared/types/decision';

export interface ScanTrace {
  scanId: string;
  timestamp: number;
  asset: string | null;
  timeframe: string | null;
  currentPrice: number | null;
  trend: string;
  structure: string;
  momentum: string;
  volatility: string;
  marketRegime: string;
  rsi: number | null;
  ema: number | null;
  bollingerPercentB: number | null;
  patterns: string[];
  support: number | null;
  resistance: number | null;
  evidenceScore: number;
  bullishScore: number;
  bearishScore: number;
  agreementScore: number;
  risk: string;
  confidence: number;
  rawDecision: string;
  finalDecision: string;
  reasons: string[];
}

export interface DecisionChangeLog {
  logId: string;
  timestamp: number;
  asset: string | null;
  oldDecision: string;
  newDecision: string;
  oldConfidence: number;
  newConfidence: number;
  oldReasons: string[];
  newReasons: string[];
  whatChanged: string;
  causativeEngine: 'DecisionEngine' | 'EvidenceEngine' | 'RiskEngine' | 'SignalStabilizer' | 'Momentum' | 'Trend' | 'Structure';
}

export interface ActiveTradeDebugInfo {
  tradeId: string;
  asset: string;
  direction: string;
  entryPrice: string | null;
  currentPrice: number | null;
  entryTime: number;
  expirySeconds: number;
  remainingSeconds: number;
  tradeState: string;
  outcome: string | null;
  reasons: string[];
  currentSignal: string;
  currentConfidence: number;
}

export class LiveDecisionTraceEngine {
  private static instance: LiveDecisionTraceEngine | null = null;
  private isEnabled: boolean = false;

  private scanTraces: ScanTrace[] = [];
  private changeLogs: DecisionChangeLog[] = [];
  private readonly MAX_BUFFER_SIZE = 200;

  private lastTrace: ScanTrace | null = null;

  private constructor() {}

  public static getInstance(): LiveDecisionTraceEngine {
    if (!LiveDecisionTraceEngine.instance) {
      LiveDecisionTraceEngine.instance = new LiveDecisionTraceEngine();
    }
    return LiveDecisionTraceEngine.instance;
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      this.scanTraces = [];
      this.changeLogs = [];
      this.lastTrace = null;
    }
  }

  public getIsEnabled(): boolean {
    return this.isEnabled;
  }

  // ----------------------------------------------------------
  // Task 1: Record Full Scan Trace
  // ----------------------------------------------------------
  public recordScanTrace(trace: ScanTrace): void {
    if (!this.isEnabled) return;

    this.scanTraces.push(trace);
    if (this.scanTraces.length > this.MAX_BUFFER_SIZE) {
      this.scanTraces.shift();
    }

    // Check for decision change / signal flip
    if (this.lastTrace && this.lastTrace.finalDecision !== trace.finalDecision) {
      this.detectAndLogDecisionChange(this.lastTrace, trace);
    }

    this.lastTrace = trace;
  }

  // ----------------------------------------------------------
  // Task 2: Decision Change Log
  // ----------------------------------------------------------
  private detectAndLogDecisionChange(oldTrace: ScanTrace, newTrace: ScanTrace): void {
    let causativeEngine: DecisionChangeLog['causativeEngine'] = 'DecisionEngine';
    let whatChanged = '';

    if (oldTrace.trend !== newTrace.trend) {
      causativeEngine = 'Trend';
      whatChanged = `Trend shifted from ${oldTrace.trend} to ${newTrace.trend}`;
    } else if (oldTrace.structure !== newTrace.structure) {
      causativeEngine = 'Structure';
      whatChanged = `Market structure changed from ${oldTrace.structure} to ${newTrace.structure}`;
    } else if (oldTrace.momentum !== newTrace.momentum) {
      causativeEngine = 'Momentum';
      whatChanged = `Momentum shifted from ${oldTrace.momentum} to ${newTrace.momentum}`;
    } else if (oldTrace.risk !== newTrace.risk) {
      causativeEngine = 'RiskEngine';
      whatChanged = `Risk level changed from ${oldTrace.risk} to ${newTrace.risk}`;
    } else if (oldTrace.rawDecision !== newTrace.rawDecision) {
      causativeEngine = 'EvidenceEngine';
      whatChanged = `Raw decision changed from ${oldTrace.rawDecision} to ${newTrace.rawDecision} (Evidence: ${oldTrace.evidenceScore.toFixed(2)} -> ${newTrace.evidenceScore.toFixed(2)})`;
    } else {
      causativeEngine = 'SignalStabilizer';
      whatChanged = `Signal Stabilizer confirmed transition from ${oldTrace.finalDecision} to ${newTrace.finalDecision}`;
    }

    const log: DecisionChangeLog = {
      logId: `change-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: Date.now(),
      asset: newTrace.asset,
      oldDecision: oldTrace.finalDecision,
      newDecision: newTrace.finalDecision,
      oldConfidence: oldTrace.confidence,
      newConfidence: newTrace.confidence,
      oldReasons: oldTrace.reasons,
      newReasons: newTrace.reasons,
      whatChanged,
      causativeEngine,
    };

    this.changeLogs.push(log);
    if (this.changeLogs.length > this.MAX_BUFFER_SIZE) {
      this.changeLogs.shift();
    }
  }

  // ----------------------------------------------------------
  // Task 3: Running Trade Debugger
  // ----------------------------------------------------------
  public getRunningTradeDebugInfo(): ActiveTradeDebugInfo[] {
    const active = RunningTradeManager.getInstance().getPanelActiveTrades();
    const now = Date.now();
    const currentSignal = this.lastTrace?.finalDecision || 'WAIT';
    const currentConfidence = this.lastTrace?.confidence || 0;
    const currentPrice = this.lastTrace?.currentPrice || null;

    return active.map((t: AuthoritativeTradeRecord) => {
      const remainingSec = Math.max(0, Math.ceil((t.expiryTimestamp - now) / 1000));
      return {
        tradeId: t.id,
        asset: t.asset || 'EUR/USD',
        direction: t.direction,
        entryPrice: t.entryPrice || null,
        currentPrice,
        entryTime: t.entryTimestamp,
        expirySeconds: t.expirySeconds,
        remainingSeconds: remainingSec,
        tradeState: t.status,
        outcome: t.result || null,
        reasons: t.reasons || [],
        currentSignal,
        currentConfidence,
      };
    });
  }

  // ----------------------------------------------------------
  // Accessors
  // ----------------------------------------------------------
  public getScanTraces(limit: number = 50): ScanTrace[] {
    return this.scanTraces.slice(-limit).reverse();
  }

  public getDecisionChangeLogs(limit: number = 50): DecisionChangeLog[] {
    return this.changeLogs.slice(-limit).reverse();
  }
}
