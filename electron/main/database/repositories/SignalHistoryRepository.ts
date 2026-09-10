// ============================================================
// MARS PRO V3 — Signal History Repository
// Records enriched signal data for validation and future improvement.
// Enhanced performance stats with session/all-time separation, breakdowns.
// ============================================================

import { Database } from '../Database';
import { DecisionRecord, TradingAction } from '../../../../shared/types/decision';
import { HistoryQuery, HistoryEntry, PerformanceStats, ManualTradeInput } from '../../../../shared/types/ipc';
import { RiskLevel, TradeOutcome } from '../../../../shared/types/decision';
import { QualityLevel } from '../../../../shared/types/scanner';
import { PerformanceEngine } from '../../performance/PerformanceEngine';

/** Extended record with enriched context */
export interface EnrichedSignalRecord extends DecisionRecord {
  confidence: number;
  marketRegime: string | null;
  evidenceSummary: string | null;
  marketState: string | null;
  entryContext: string | null;
}

export class SignalHistoryRepository {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  record(record: DecisionRecord): void {
    this.db
      .prepare(
        `INSERT INTO signal_history (
          id, session_id, frame_id, timestamp, asset, timeframe,
          raw_decision, stabilized_decision, raw_reason, stabilized_reason,
          signal_strength, risk, data_quality, market_bias,
          recommended_expiry, outcome
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING`
      )
      .run(
        record.id,
        record.sessionId,
        record.frameId,
        record.timestamp,
        record.asset,
        record.timeframe,
        record.rawDecision,
        record.stabilizedDecision,
        record.rawReason,
        record.stabilizedReason,
        record.signalStrength,
        record.risk,
        record.dataQuality,
        record.marketBias,
        record.recommendedExpiry,
        record.outcome
      );
  }

  /** Record an enriched signal with full context for future validation */
  recordEnriched(record: EnrichedSignalRecord): void {
    this.db
      .prepare(
        `INSERT INTO signal_history (
          id, session_id, frame_id, timestamp, asset, timeframe,
          raw_decision, stabilized_decision, raw_reason, stabilized_reason,
          signal_strength, risk, data_quality, market_bias,
          recommended_expiry, outcome,
          confidence, market_regime, evidence_summary, market_state, entry_context
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING`
      )
      .run(
        record.id,
        record.sessionId,
        record.frameId,
        record.timestamp,
        record.asset,
        record.timeframe,
        record.rawDecision,
        record.stabilizedDecision,
        record.rawReason,
        record.stabilizedReason,
        record.signalStrength,
        record.risk,
        record.dataQuality,
        record.marketBias,
        record.recommendedExpiry,
        record.outcome,
        record.confidence,
        record.marketRegime,
        record.evidenceSummary,
        record.marketState,
        record.entryContext
      );
  }

  /** Only invoked by the trader-facing journal action; scanner cycles are never persisted here. */
  recordManualTrade(input: ManualTradeInput): void {
    const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const action = input.action === TradingAction.SELL ? TradingAction.SELL : TradingAction.BUY;
    this.db.prepare(
      `INSERT INTO signal_history (
        id, session_id, frame_id, timestamp, asset, timeframe,
        raw_decision, stabilized_decision, raw_reason, stabilized_reason,
        signal_strength, risk, data_quality, market_bias, recommended_expiry, outcome
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, 'manual-journal', id, Date.now(), input.asset.trim(), input.timeframe,
      action, action, input.reason || 'Manually logged trade', input.reason || 'Manually logged trade',
      Math.max(0, Math.min(1, input.signalStrength ?? 0)), input.risk || RiskLevel.MEDIUM,
      QualityLevel.HIGH, action === TradingAction.BUY ? 'BULLISH' : 'BEARISH',
      input.recommendedExpiry || null, input.outcome
    );
  }

  query(query: HistoryQuery): HistoryEntry[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.sessionId) {
      conditions.push('session_id = ?');
      params.push(query.sessionId);
    }
    if (query.asset) {
      conditions.push('asset = ?');
      params.push(query.asset);
    }
    if (query.fromTimestamp) {
      conditions.push('timestamp >= ?');
      params.push(query.fromTimestamp);
    }
    if (query.toTimestamp) {
      conditions.push('timestamp <= ?');
      params.push(query.toTimestamp);
    }
    if (query.action) {
      conditions.push('stabilized_decision = ?');
      params.push(query.action);
    }
    if (query.outcome) {
      conditions.push('outcome = ?');
      params.push(query.outcome);
    }
    if (query.todayOnly) {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      conditions.push('timestamp >= ?');
      params.push(startOfToday.getTime());
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT id, session_id, timestamp, asset, timeframe,
                raw_decision, stabilized_decision, signal_strength,
                risk, data_quality, stabilized_reason as reason,
                recommended_expiry, outcome, confidence, market_regime
         FROM signal_history
         ${whereClause}
         ORDER BY timestamp DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Array<{
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

  private getActiveTradeCount(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) as count FROM tracked_trades WHERE status = 'ACTIVE'`)
      .get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  private getCompletedStats(whereClause: string, params: unknown[]): { wins: number; losses: number } {
    const winRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM tracked_trades ${whereClause} AND outcome = 'WIN'`)
      .get(...params) as { count: number } | undefined;
    const lossRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM tracked_trades ${whereClause} AND outcome = 'LOSS'`)
      .get(...params) as { count: number } | undefined;
    return { wins: winRow?.count ?? 0, losses: lossRow?.count ?? 0 };
  }

  private getStatsByExpiry(): Record<string, { wins: number; losses: number }> {
    const rows = this.db
      .prepare(
        `SELECT expiry_label, outcome, COUNT(*) as count FROM tracked_trades
         WHERE status = 'COMPLETED' AND outcome IN ('WIN', 'LOSS')
         GROUP BY expiry_label, outcome`
      )
      .all() as Array<{ expiry_label: string; outcome: string; count: number }>;

    const result: Record<string, { wins: number; losses: number }> = {};
    for (const row of rows) {
      if (!result[row.expiry_label]) {
        result[row.expiry_label] = { wins: 0, losses: 0 };
      }
      if (row.outcome === 'WIN') result[row.expiry_label].wins = row.count;
      else if (row.outcome === 'LOSS') result[row.expiry_label].losses = row.count;
    }
    return result;
  }

  private getStatsByDirection(): { buy: { wins: number; losses: number }; sell: { wins: number; losses: number } } {
    const rows = this.db
      .prepare(
        `SELECT action, outcome, COUNT(*) as count FROM tracked_trades
         WHERE status = 'COMPLETED' AND outcome IN ('WIN', 'LOSS')
         GROUP BY action, outcome`
      )
      .all() as Array<{ action: string; outcome: string; count: number }>;

    const result = {
      buy: { wins: 0, losses: 0 },
      sell: { wins: 0, losses: 0 },
    };
    for (const row of rows) {
      const dir = row.action === 'BUY' ? 'buy' : 'sell';
      if (row.outcome === 'WIN') (result as any)[dir].wins = row.count;
      else if (row.outcome === 'LOSS') (result as any)[dir].losses = row.count;
    }
    return result;
  }

  private getStatsByAsset(): Record<string, { wins: number; losses: number }> {
    const rows = this.db
      .prepare(
        `SELECT asset, outcome, COUNT(*) as count FROM tracked_trades
         WHERE status = 'COMPLETED' AND outcome IN ('WIN', 'LOSS')
         GROUP BY asset, outcome`
      )
      .all() as Array<{ asset: string | null; outcome: string; count: number }>;

    const result: Record<string, { wins: number; losses: number }> = {};
    for (const row of rows) {
      const asset = row.asset || 'Unknown';
      if (!result[asset]) {
        result[asset] = { wins: 0, losses: 0 };
      }
      if (row.outcome === 'WIN') result[asset].wins = row.count;
      else if (row.outcome === 'LOSS') result[asset].losses = row.count;
    }
    return result;
  }

  purgeOlderThan(days: number): number {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const result = this.db
      .prepare('DELETE FROM signal_history WHERE timestamp < ?')
      .run(cutoff);
    return result.changes;
  }
}
