// ============================================================
// MARS PRO V3 — Signal History Repository
// Signal writes and their parent session are committed atomically.
// ============================================================

import { Database } from '../Database';
import { DecisionRecord, TradingAction, RiskLevel } from '../../../../shared/types/decision';
import { HistoryQuery, HistoryEntry, PerformanceStats, ManualTradeInput } from '../../../../shared/types/ipc';
import { QualityLevel } from '../../../../shared/types/scanner';
import { PerformanceEngine } from '../../performance/PerformanceEngine';

export interface EnrichedSignalRecord extends DecisionRecord {
  confidence: number;
  marketRegime: string | null;
  evidenceSummary: string | null;
  marketState: string | null;
  entryContext: string | null;
}

export class SignalHistoryRepository {
  constructor(private db: Database) {}

  private ensureSession(sessionId: string, startedAt: number = Date.now()): void {
    this.db.prepare(
      `INSERT OR IGNORE INTO sessions (id, started_at, display_id)
       VALUES (?, ?, ?)`
    ).run(sessionId, startedAt, sessionId === 'manual-journal' ? 'manual' : 'runtime');
  }

  record(record: DecisionRecord): void {
    this.db.transaction(() => {
      this.ensureSession(record.sessionId, record.timestamp);
      this.db.prepare(
        `INSERT INTO signal_history (
          id, session_id, frame_id, timestamp, asset, timeframe,
          raw_decision, stabilized_decision, raw_reason, stabilized_reason,
          signal_strength, risk, data_quality, market_bias,
          recommended_expiry, outcome
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`
      ).run(
        record.id, record.sessionId, record.frameId, record.timestamp,
        record.asset, record.timeframe, record.rawDecision, record.stabilizedDecision,
        record.rawReason, record.stabilizedReason, record.signalStrength,
        record.risk, record.dataQuality, record.marketBias,
        record.recommendedExpiry, record.outcome,
      );
    });
  }

  recordEnriched(record: EnrichedSignalRecord): void {
    this.db.transaction(() => {
      this.ensureSession(record.sessionId, record.timestamp);
      this.db.prepare(
        `INSERT INTO signal_history (
          id, session_id, frame_id, timestamp, asset, timeframe,
          raw_decision, stabilized_decision, raw_reason, stabilized_reason,
          signal_strength, risk, data_quality, market_bias,
          recommended_expiry, outcome, confidence, market_regime,
          evidence_summary, market_state, entry_context
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`
      ).run(
        record.id, record.sessionId, record.frameId, record.timestamp,
        record.asset, record.timeframe, record.rawDecision, record.stabilizedDecision,
        record.rawReason, record.stabilizedReason, record.signalStrength,
        record.risk, record.dataQuality, record.marketBias,
        record.recommendedExpiry, record.outcome, record.confidence,
        record.marketRegime, record.evidenceSummary, record.marketState,
        record.entryContext,
      );
    });
  }

  recordManualTrade(input: ManualTradeInput): void {
    const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const action = input.action === TradingAction.SELL ? TradingAction.SELL : TradingAction.BUY;
    this.db.transaction(() => {
      this.ensureSession('manual-journal');
      this.db.prepare(
        `INSERT INTO signal_history (
          id, session_id, frame_id, timestamp, asset, timeframe,
          raw_decision, stabilized_decision, raw_reason, stabilized_reason,
          signal_strength, risk, data_quality, market_bias, recommended_expiry, outcome
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, 'manual-journal', id, Date.now(), input.asset.trim(), input.timeframe,
        action, action, input.reason || 'Manually logged trade',
        input.reason || 'Manually logged trade',
        Math.max(0, Math.min(1, input.signalStrength ?? 0)),
        input.risk || RiskLevel.MEDIUM, QualityLevel.HIGH,
        action === TradingAction.BUY ? 'BULLISH' : 'BEARISH',
        input.recommendedExpiry || null, input.outcome,
      );
    });
  }

  query(query: HistoryQuery): HistoryEntry[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.sessionId) { conditions.push('session_id = ?'); params.push(query.sessionId); }
    if (query.asset) { conditions.push('asset = ?'); params.push(query.asset); }
    if (query.fromTimestamp) { conditions.push('timestamp >= ?'); params.push(query.fromTimestamp); }
    if (query.toTimestamp) { conditions.push('timestamp <= ?'); params.push(query.toTimestamp); }
    if (query.action) { conditions.push('stabilized_decision = ?'); params.push(query.action); }
    if (query.outcome) { conditions.push('outcome = ?'); params.push(query.outcome); }
    if (query.todayOnly) {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      conditions.push('timestamp >= ?');
      params.push(startOfToday.getTime());
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(
      `SELECT id, session_id, timestamp, asset, timeframe,
              raw_decision, stabilized_decision, signal_strength,
              risk, data_quality, stabilized_reason as reason,
              recommended_expiry, outcome, confidence, market_regime
       FROM signal_history ${whereClause}
       ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    ).all(...params, query.limit ?? 50, query.offset ?? 0) as Array<{
      id: string;
      session_id: string;
      timestamp: number;
      asset: string | null;
      timeframe: string | null;
      raw_decision: string;
      stabilized_decision: string;
      signal_strength: number;
      risk: string;
      data_quality: string;
      reason: string;
      recommended_expiry: string | null;
      outcome: string | null;
      confidence: number | null;
      market_regime: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      timestamp: row.timestamp,
      asset: row.asset,
      timeframe: row.timeframe,
      rawDecision: row.raw_decision as TradingAction,
      stabilizedDecision: row.stabilized_decision as TradingAction,
      signalStrength: row.signal_strength,
      risk: row.risk as RiskLevel,
      dataQuality: row.data_quality as QualityLevel,
      reason: row.reason,
      recommendedExpiry: row.recommended_expiry,
      outcome: row.outcome,
      confidence: row.confidence ?? 0,
      marketRegime: row.market_regime,
    }));
  }

  getPerformanceStats(sessionId?: string): PerformanceStats {
    return PerformanceEngine.getInstance().getPerformanceStats(sessionId);
  }

  purgeOlderThan(days: number): number {
    const boundedDays = Math.max(1, Math.min(3650, Math.floor(days)));
    const cutoff = Date.now() - boundedDays * 24 * 60 * 60 * 1000;
    return this.db.prepare('DELETE FROM signal_history WHERE timestamp < ?').run(cutoff).changes;
  }
}
