// ============================================================
// MARS PRO V3 — Canonical Trade Repository
// Durable tracked-trade lifecycle, retention, and guarded learning ingestion.
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
  execution_id: string | null;
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
    execution_id?: string | null;
    executionId?: string | null;
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
  }): boolean {
    const reasonsArr = trade.reasons?.length ? trade.reasons : (trade.snapshot?.reasons || []);
    const originalReasonsJson = trade.original_reasons ?? JSON.stringify(reasonsArr);
    const sessionId = trade.sessionId ?? trade.session_id ?? `session-${Date.now()}`;
    const signalId = trade.signalId ?? trade.signal_id ?? `manual-${trade.id}`;
    const rawExecutionId = trade.executionId ?? trade.execution_id ?? null;
    const executionId = typeof rawExecutionId === 'string' && rawExecutionId.trim()
      ? rawExecutionId.trim()
      : null;
    const expiryLabel = trade.expiryLabel ?? trade.expiry_label ?? '1 min';
    const expirySec = trade.expirySeconds ?? trade.expiry_seconds ?? 60;
    const entryTimestamp = trade.entryTimestamp ?? trade.entry_timestamp ?? Date.now();
    const expiryTimestamp = trade.expiryTimestamp
      ?? trade.expiry_timestamp
      ?? (entryTimestamp + expirySec * 1000);
    const entryPrice = trade.entryPrice ?? trade.entry_price ?? null;
    const status = trade.status ?? 'ACTIVE';

    const result = this.db.prepare(
      `INSERT OR IGNORE INTO tracked_trades (
        id, session_id, signal_id, execution_id, action, asset, timeframe,
        expiry_label, expiry_seconds, confidence, regime,
        entry_price, entry_timestamp, expiry_timestamp,
        status, original_reasons, ml_features, platform_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      trade.id,
      sessionId,
      signalId,
      executionId,
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
      trade.mlFeatures ? JSON.stringify(trade.mlFeatures) : (trade.ml_features ?? null),
      trade.platformMode ?? PlatformMode.UNKNOWN,
    );
    return result.changes === 1;
  }

  completeTrade(
    id: string,
    outcome: TradeOutcome,
    completionPrice: string | null = null,
  ): boolean {
    const now = Date.now();
    let completedTrade: {
      asset: string | null;
      ml_features: string | null;
      platform_mode: string | null;
      entry_price: string | null;
    } | null = null;
    let didComplete = false;

    this.db.transaction(() => {
      const tradeRow = this.db.prepare(
        `SELECT signal_id, status, outcome, asset, ml_features, platform_mode, entry_price
         FROM tracked_trades WHERE id = ?`
      ).get(id) as {
        signal_id?: string;
        status?: string;
        outcome?: string | null;
        asset?: string | null;
        ml_features?: string | null;
        platform_mode?: string | null;
        entry_price?: string | null;
      } | undefined;

      if (!tradeRow || ['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(tradeRow.status || '')) return;

      const updated = this.db.prepare(
        `UPDATE tracked_trades
         SET status = 'COMPLETED', outcome = ?, completion_timestamp = ?, completion_price = ?
         WHERE id = ? AND status IN ('ACTIVE', 'EXPIRING', 'PENDING_ENTRY')`
      ).run(outcome, now, completionPrice, id);
      if (updated.changes !== 1) return;

      didComplete = true;
      completedTrade = {
        asset: tradeRow.asset ?? null,
        ml_features: tradeRow.ml_features ?? null,
        platform_mode: tradeRow.platform_mode ?? null,
        entry_price: tradeRow.entry_price ?? null,
      };

      if (tradeRow.signal_id) {
        this.db.prepare(
          `UPDATE signal_history
           SET outcome = ?
           WHERE id = ? AND (outcome IS NULL OR outcome = 'UNRESOLVED')`
        ).run(outcome, tradeRow.signal_id);
      }

      this.pruneCompletedTradesInTransaction();
    });

    const learning = completedTrade as {
      asset: string | null;
      ml_features: string | null;
      platform_mode: string | null;
      entry_price: string | null;
    } | null;
    const entryValue = Number(learning?.entry_price);
    const completionValue = Number(completionPrice);
    const verifiedLiveOutcome = learning
      && learning.platform_mode === PlatformMode.LIVE
      && Number.isFinite(entryValue)
      && entryValue > 0
      && Number.isFinite(completionValue)
      && completionValue > 0;

    if (verifiedLiveOutcome && (outcome === TradeOutcome.WIN || outcome === TradeOutcome.LOSS)) {
      try {
        const parsed = learning.ml_features ? JSON.parse(learning.ml_features) : null;
        if (Array.isArray(parsed)
          && parsed.length >= FEATURE_NAMES.length
          && parsed.slice(0, FEATURE_NAMES.length)
            .every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) {
          MLEngine.getInstance().ingestCompletedTrade({
            features: parsed.slice(0, FEATURE_NAMES.length),
            outcome: outcome as 'WIN' | 'LOSS',
            asset: learning.asset ?? undefined,
          });
        }
      } catch (error) {
        console.error('[TradeRepository] Post-trade learning failed:', error);
      }
    }

    return didComplete;
  }

  markExpiring(id: string): boolean {
    const result = this.db.prepare(
      `UPDATE tracked_trades SET status = 'EXPIRING'
       WHERE id = ? AND status = 'ACTIVE'`
    ).run(id);
    return result.changes === 1;
  }

  enforceCompletedTradeLimit(): number {
    let deleted = 0;
    this.db.transaction(() => {
      deleted = this.pruneCompletedTradesInTransaction();
    });
    return deleted;
  }

  private pruneCompletedTradesInTransaction(): number {
    return this.db.prepare(
      `DELETE FROM tracked_trades
       WHERE status = 'COMPLETED'
         AND id NOT IN (
           SELECT id FROM tracked_trades
           WHERE status = 'COMPLETED'
           ORDER BY completion_timestamp DESC, entry_timestamp DESC, id DESC
           LIMIT ?
         )`
    ).run(MAX_RETAINED_COMPLETED_TRADES).changes;
  }

  cancelTrade(id: string): void {
    this.db.prepare("UPDATE tracked_trades SET status = 'CANCELLED' WHERE id = ?").run(id);
  }

  getActiveTrades(sessionId?: string): DbTrackedTrade[] {
    const whereClause = sessionId
      ? "WHERE status IN ('ACTIVE', 'EXPIRING') AND session_id = ?"
      : "WHERE status IN ('ACTIVE', 'EXPIRING')";
    return this.db.prepare(
      `SELECT * FROM tracked_trades ${whereClause} ORDER BY entry_timestamp DESC`
    ).all(...(sessionId ? [sessionId] : [])) as DbTrackedTrade[];
  }

  getActiveTradesByExecutionId(executionId: string, sessionId?: string): DbTrackedTrade[] {
    const normalized = String(executionId || '').trim();
    if (!normalized) return [];
    const whereClause = sessionId
      ? "execution_id = ? AND session_id = ? AND status IN ('ACTIVE', 'EXPIRING')"
      : "execution_id = ? AND status IN ('ACTIVE', 'EXPIRING')";
    return this.db.prepare(
      `SELECT * FROM tracked_trades WHERE ${whereClause} ORDER BY entry_timestamp DESC`
    ).all(...(sessionId ? [normalized, sessionId] : [normalized])) as DbTrackedTrade[];
  }

  getExpiredTrades(sessionId?: string): DbTrackedTrade[] {
    const whereClause = sessionId
      ? "WHERE status IN ('ACTIVE', 'EXPIRING') AND expiry_timestamp <= ? AND session_id = ?"
      : "WHERE status IN ('ACTIVE', 'EXPIRING') AND expiry_timestamp <= ?";
    return this.db.prepare(
      `SELECT * FROM tracked_trades ${whereClause} ORDER BY expiry_timestamp ASC`
    ).all(...(sessionId ? [Date.now(), sessionId] : [Date.now()])) as DbTrackedTrade[];
  }

  getActiveTradeCount(): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM tracked_trades WHERE status IN ('ACTIVE', 'EXPIRING')"
    ).get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  hasActiveTradeForSignal(signalId: string): boolean {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM tracked_trades WHERE signal_id = ? AND status IN ('ACTIVE', 'EXPIRING')"
    ).get(signalId) as { count: number } | undefined;
    return (row?.count ?? 0) > 0;
  }

  getRecentForm(limit: number = 10): ('W' | 'L' | 'D')[] {
    const rows = this.db.prepare(
      `SELECT outcome FROM tracked_trades
       WHERE status = 'COMPLETED' AND outcome IS NOT NULL AND outcome != 'UNRESOLVED'
       ORDER BY completion_timestamp DESC LIMIT ?`
    ).all(limit) as Array<{ outcome: string }>;
    return rows.map((row) => row.outcome === 'WIN' ? 'W' : row.outcome === 'LOSS' ? 'L' : 'D').reverse();
  }
}
