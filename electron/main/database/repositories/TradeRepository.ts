// ============================================================
// MARS PRO V3 — Canonical Trade Repository
// Manages tracked trade lifecycle: creation, active monitoring, completion.
// Ensures atomic operations and deduplication with INSERT OR IGNORE.
// ============================================================

import { Database } from '../Database';
import { TradingAction, TradeOutcome } from '../../../../shared/types/decision';
import { CanonicalConfidence, PlatformMode } from '../../../../shared/types/canonical';
import { MLEngine, FEATURE_NAMES } from '../../decision/MLEngine';

export const MAX_RETAINED_COMPLETED_TRADES = 1000;

export interface DbTrackedTrade {
  id: string;
  session_id: string;
  signal_id: string;
  action: string;
  asset: string | null;
  timeframe: string | null;
  expiry_label: string;
  expiry_seconds: number;
  confidence: number | null;
  regime: string | null;
  entry_price: string | null;
  entry_timestamp: number;
  expiry_timestamp: number;
  status: string;
  outcome: string | null;
  original_reasons: string;
  completion_timestamp: number | null;
  completion_price: string | null;
  ml_features: string | null;
  platform_mode?: string | null;
}

export class TradeRepository {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.enforceCompletedTradeLimit();
  }

  createTrade(trade: {
    id: string;
    session_id?: string;
    sessionId?: string;
    signal_id?: string;
    signalId?: string;
    action: TradingAction;
    asset: string | null;
    timeframe: string | null;
    expiry_label?: string;
    expiryLabel?: string;
    expiry_seconds?: number;
    expirySeconds?: number;
    confidence: CanonicalConfidence;
    regime: string | null;
    entry_price?: string | null;
    entryPrice?: string | null;
    entry_timestamp?: number;
    entryTimestamp?: number;
    expiry_timestamp?: number;
    expiryTimestamp?: number;
    status?: string;
    outcome?: string | null;
    original_reasons?: string;
    reasons?: string[];
    snapshot?: Record<string, any>;
    mlFeatures?: number[];
    ml_features?: string | null;
    completion_timestamp?: number | null;
    completion_price?: string | null;
    platformMode?: PlatformMode;
  }): void {
    const reasonsArr = (trade.reasons && trade.reasons.length > 0)
      ? trade.reasons
      : (trade.snapshot?.reasons || []);
    const originalReasonsJson = trade.original_reasons || JSON.stringify(reasonsArr);

    const sessionId = trade.sessionId || trade.session_id || `session-${Date.now()}`;
    const signalId = trade.signalId || trade.signal_id || `manual-${trade.id}`;
    const expiryLabel = trade.expiryLabel || trade.expiry_label || '1 min';
    const expirySec = trade.expirySeconds || trade.expiry_seconds || 60;
    const entryTimestamp = trade.entryTimestamp || trade.entry_timestamp || Date.now();
    const expiryTimestamp = trade.expiryTimestamp || trade.expiry_timestamp || (entryTimestamp + expirySec * 1000);
    const entryPrice = trade.entryPrice || trade.entry_price || null;
    const status = trade.status || 'ACTIVE';

    this.db.prepare(
      `INSERT OR IGNORE INTO tracked_trades (
        id, session_id, signal_id, action, asset, timeframe,
        expiry_label, expiry_seconds, confidence, regime,
        entry_price, entry_timestamp, expiry_timestamp,
        status, original_reasons, ml_features, platform_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      trade.id,
      sessionId,
      signalId,
      trade.action,
      trade.asset,
      trade.timeframe,
      expiryLabel,
      expirySec,
      trade.confidence ?? null,
      trade.regime,
      entryPrice,
      entryTimestamp,
      expiryTimestamp,
      status,
      originalReasonsJson,
      trade.mlFeatures ? JSON.stringify(trade.mlFeatures) : (trade.ml_features || null),
      trade.platformMode || null
    );
  }

  completeTrade(id: string, outcome: TradeOutcome, completionPrice: string): void {
    const now = Date.now();
    let completedTrade: { asset: string | null; ml_features: string | null } | null = null;

    this.db.transaction(() => {
      const tradeRow = this.db.prepare(
        `SELECT signal_id, status, outcome, asset, ml_features
         FROM tracked_trades WHERE id = ?`
      ).get(id) as {
        signal_id?: string;
        status?: string;
        outcome?: string | null;
        asset?: string | null;
        ml_features?: string | null;
      } | undefined;

      if (!tradeRow || ['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(tradeRow.status || '')) return;
      completedTrade = {
        asset: tradeRow.asset ?? null,
        ml_features: tradeRow.ml_features ?? null,
      };

      const updated = this.db.prepare(
        `UPDATE tracked_trades
         SET status = 'COMPLETED', outcome = ?, completion_timestamp = ?, completion_price = ?
         WHERE id = ? AND status IN ('ACTIVE', 'EXPIRING', 'PENDING_ENTRY')`
      ).run(outcome, now, completionPrice, id);
      if (updated.changes !== 1) {
        completedTrade = null;
        return;
      }

      if (tradeRow.signal_id) {
        this.db.prepare(
          `UPDATE signal_history
           SET outcome = ?
           WHERE id = ? AND (outcome IS NULL OR outcome = 'UNRESOLVED')`
        ).run(outcome, tradeRow.signal_id);
      }

      this.pruneCompletedTradesInTransaction();
    });

    const resolvedForLearning = completedTrade as { asset: string | null; ml_features: string | null } | null;
    if (resolvedForLearning && (outcome === TradeOutcome.WIN || outcome === TradeOutcome.LOSS)) {
      try {
        const parsed = resolvedForLearning.ml_features ? JSON.parse(resolvedForLearning.ml_features) : null;
        if (Array.isArray(parsed) && parsed.length >= FEATURE_NAMES.length &&
            parsed.slice(0, FEATURE_NAMES.length).every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) {
          MLEngine.getInstance().ingestCompletedTrade({
            features: parsed.slice(0, FEATURE_NAMES.length),
            outcome: outcome as 'WIN' | 'LOSS',
            asset: resolvedForLearning.asset ?? undefined,
          });
        }
      } catch (err) {
        console.error('[TradeRepository] Post-trade learning failed:', err);
      }
    }
  }

  enforceCompletedTradeLimit(): number {
    let deleted = 0;
    this.db.transaction(() => {
      deleted = this.pruneCompletedTradesInTransaction();
    });
    return deleted;
  }

  private pruneCompletedTradesInTransaction(): number {
    const result = this.db.prepare(
      `DELETE FROM tracked_trades
       WHERE status = 'COMPLETED'
         AND id NOT IN (
           SELECT id FROM tracked_trades
           WHERE status = 'COMPLETED'
           ORDER BY completion_timestamp DESC, entry_timestamp DESC, id DESC
           LIMIT ?
         )`
    ).run(MAX_RETAINED_COMPLETED_TRADES);
    return result.changes;
  }

  cancelTrade(id: string): void {
    this.db.prepare(
      `UPDATE tracked_trades SET status = 'CANCELLED' WHERE id = ?`
    ).run(id);
  }

  getActiveTrades(sessionId?: string): DbTrackedTrade[] {
    const whereClause = sessionId
      ? `WHERE status IN ('ACTIVE', 'EXPIRING') AND session_id = ?`
      : `WHERE status IN ('ACTIVE', 'EXPIRING')`;
    const params = sessionId ? [sessionId] : [];
    return this.db.prepare(
      `SELECT * FROM tracked_trades ${whereClause} ORDER BY entry_timestamp DESC`
    ).all(...params) as DbTrackedTrade[];
  }

  getExpiredTrades(sessionId?: string): DbTrackedTrade[] {
    const whereClause = sessionId
      ? `WHERE status IN ('ACTIVE', 'EXPIRING') AND expiry_timestamp <= ? AND session_id = ?`
      : `WHERE status IN ('ACTIVE', 'EXPIRING') AND expiry_timestamp <= ?`;
    const params = sessionId ? [Date.now(), sessionId] : [Date.now()];
    return this.db.prepare(
      `SELECT * FROM tracked_trades ${whereClause} ORDER BY expiry_timestamp ASC`
    ).all(...params) as DbTrackedTrade[];
  }

  getActiveTradeCount(): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM tracked_trades WHERE status IN ('ACTIVE', 'EXPIRING')`
    ).get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  hasActiveTradeForSignal(signalId: string): boolean {
    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM tracked_trades WHERE signal_id = ? AND status IN ('ACTIVE', 'EXPIRING')`
    ).get(signalId) as { count: number } | undefined;
    return (row?.count ?? 0) > 0;
  }

  getRecentForm(limit: number = 10): ('W' | 'L' | 'D')[] {
    const rows = this.db.prepare(
      `SELECT outcome FROM tracked_trades
       WHERE status = 'COMPLETED' AND outcome IS NOT NULL AND outcome != 'UNRESOLVED'
       ORDER BY completion_timestamp DESC LIMIT ?`
    ).all(limit) as Array<{ outcome: string }>;
    return rows
      .map(r => {
        if (r.outcome === 'WIN') return 'W' as const;
        if (r.outcome === 'LOSS') return 'L' as const;
        return 'D' as const;
      })
      .reverse();
  }
}