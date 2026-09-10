// ============================================================
// MARS PRO V3 — Performance Engine (SSOT Legacy Adapter)
// Delegates all performance and history operations directly to
// CanonicalDataAccessLayer to guarantee a Single Source of Truth.
// ============================================================

import { Database } from '../database/Database';
import { CanonicalDataAccessLayer } from '../database/CanonicalDataAccessLayer';
import { PerformanceStats, HistoryQuery, HistoryEntry } from '../../../shared/types/ipc';

export class PerformanceEngine {
  private static instance: PerformanceEngine | null = null;
  private dal: CanonicalDataAccessLayer = CanonicalDataAccessLayer.getInstance();

  private constructor() {}

  public static getInstance(): PerformanceEngine {
    if (!PerformanceEngine.instance) {
      PerformanceEngine.instance = new PerformanceEngine();
    }
    return PerformanceEngine.instance;
  }

  public setDatabase(db: Database): void {
    this.dal.setDatabase(db);
  }

  public getPerformanceStats(sessionId?: string): PerformanceStats {
    return this.dal.getPerformanceStats(sessionId);
  }

  public queryHistory(query: HistoryQuery): HistoryEntry[] {
    return this.dal.getJournalEntries(query);
  }

  public deleteTrade(id: string): boolean {
    const db = this.dal.getDatabase();
    if (!db) return false;
    let deleted = 0;
    db.transaction(() => {
      const trade = db.prepare('SELECT signal_id FROM tracked_trades WHERE id = ?').get(id) as { signal_id?: string } | undefined;
      const tradeRes = db.prepare('DELETE FROM tracked_trades WHERE id = ?').run(id);
      deleted += tradeRes.changes;
      const signalRes = db.prepare('DELETE FROM signal_history WHERE id = ? OR id = ?').run(id, trade?.signal_id || id);
      deleted += signalRes.changes;
    });
    return deleted > 0;
  }

  public deleteSelectedTrades(ids: string[]): number {
    const db = this.dal.getDatabase();
    if (!db || ids.length === 0) return 0;
    let deletedCount = 0;
    db.transaction(() => {
      for (const id of ids) {
        const trade = db.prepare('SELECT signal_id FROM tracked_trades WHERE id = ?').get(id) as { signal_id?: string } | undefined;
        const tradeRes = db.prepare('DELETE FROM tracked_trades WHERE id = ?').run(id);
        const signalRes = db.prepare('DELETE FROM signal_history WHERE id = ? OR id = ?').run(id, trade?.signal_id || id);
        deletedCount += tradeRes.changes + signalRes.changes;
      }
    });
    return deletedCount;
  }

  public clearTodayHistory(): number {
    const db = this.dal.getDatabase();
    if (!db) return 0;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    let deleted = 0;
    db.transaction(() => {
      deleted += db.prepare('DELETE FROM tracked_trades WHERE entry_timestamp >= ?').run(startOfToday.getTime()).changes;
      deleted += db.prepare('DELETE FROM signal_history WHERE timestamp >= ?').run(startOfToday.getTime()).changes;
    });
    return deleted;
  }

  public clearSessionHistory(sessionId: string): number {
    const db = this.dal.getDatabase();
    if (!db || !sessionId) return 0;
    let deleted = 0;
    db.transaction(() => {
      deleted += db.prepare('DELETE FROM tracked_trades WHERE session_id = ?').run(sessionId).changes;
      deleted += db.prepare('DELETE FROM signal_history WHERE session_id = ?').run(sessionId).changes;
    });
    return deleted;
  }

  public clearAllHistory(): number {
    const db = this.dal.getDatabase();
    if (!db) return 0;
    let deleted = 0;
    db.transaction(() => {
      deleted += db.prepare('DELETE FROM tracked_trades').run().changes;
      deleted += db.prepare('DELETE FROM signal_history').run().changes;
    });
    return deleted;
  }
}
