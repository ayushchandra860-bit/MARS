// ============================================================
// MARS PRO V3 — Performance & Statistics Engine Tests (Sprint T2)
// Tests automatic statistics calculations, win rates, streaks,
// asset breakdowns, history filters, and history management.
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PerformanceEngine } from '../electron/main/performance/PerformanceEngine';
import { RunningTradeManager } from '../electron/main/trade/RunningTradeManager';
import { Database } from '../electron/main/database/Database';
import { TradeRepository } from '../electron/main/database/repositories/TradeRepository';
import { TradingAction, TradeOutcome } from '../shared/types/decision';
import fs from 'fs';
import path from 'path';

describe('PerformanceEngine (Sprint T2)', () => {
  let db: Database;
  let tradeRepo: TradeRepository;
  let performanceEngine: PerformanceEngine;
  let tradeManager: RunningTradeManager;
  const testDbPath = path.join(__dirname, '../scratch/test_performance_engine.db');

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
    db = new Database(testDbPath);
    await db.initialize();
    tradeRepo = new TradeRepository(db);

    tradeManager = RunningTradeManager.getInstance();
    tradeManager.clearAll();
    tradeManager.setRepository(tradeRepo);

    performanceEngine = PerformanceEngine.getInstance();
    performanceEngine.setDatabase(db);
  });

  afterEach(() => {
    if (tradeManager) tradeManager.clearAll();
    if (db) db.close();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
  });

  it('Task T2.2: automatically updates Overall, BUY, and SELL win rates', () => {
    // Trade 1: BUY WIN
    const t1 = tradeManager.registerTrade({ sessionId: 's1', asset: 'EUR/USD', direction: TradingAction.BUY, expirySeconds: 60, eventId: 't1' });
    tradeManager.resolveTradeOutcome(t1!.id, TradeOutcome.WIN, '1.1050');

    // Trade 2: BUY LOSS
    const t2 = tradeManager.registerTrade({ sessionId: 's1', asset: 'EUR/USD', direction: TradingAction.BUY, expirySeconds: 60, eventId: 't2' });
    tradeManager.resolveTradeOutcome(t2!.id, TradeOutcome.LOSS, '1.1020');

    // Trade 3: SELL WIN
    const t3 = tradeManager.registerTrade({ sessionId: 's1', asset: 'GBP/USD', direction: TradingAction.SELL, expirySeconds: 60, eventId: 't3' });
    tradeManager.resolveTradeOutcome(t3!.id, TradeOutcome.WIN, '1.2500');

    const stats = performanceEngine.getPerformanceStats('s1');
    expect(stats.totalCompleted).toBe(3);
    expect(stats.allTimeWins).toBe(2);
    expect(stats.allTimeLosses).toBe(1);
    expect(stats.overallWinRate).toBe(66.7);
    expect(stats.buyWinRate).toBe(50);
    expect(stats.sellWinRate).toBe(100);
  });

  it('Task T2.3: calculates winning and losing streaks accurately', () => {
    const s = 'streak-session';
    // 3 Wins in a row
    const t1 = tradeManager.registerTrade({ sessionId: s, asset: 'EUR/USD', direction: TradingAction.BUY, eventId: 's1' });
    tradeManager.resolveTradeOutcome(t1!.id, TradeOutcome.WIN);

    const t2 = tradeManager.registerTrade({ sessionId: s, asset: 'EUR/USD', direction: TradingAction.BUY, eventId: 's2' });
    tradeManager.resolveTradeOutcome(t2!.id, TradeOutcome.WIN);

    const t3 = tradeManager.registerTrade({ sessionId: s, asset: 'EUR/USD', direction: TradingAction.BUY, eventId: 's3' });
    tradeManager.resolveTradeOutcome(t3!.id, TradeOutcome.WIN);

    let stats = performanceEngine.getPerformanceStats(s);
    expect(stats.currentWinningStreak).toBe(3);
    expect(stats.maxWinningStreak).toBe(3);

    // 1 Loss
    const t4 = tradeManager.registerTrade({ sessionId: s, asset: 'EUR/USD', direction: TradingAction.BUY, eventId: 's4' });
    tradeManager.resolveTradeOutcome(t4!.id, TradeOutcome.LOSS);

    stats = performanceEngine.getPerformanceStats(s);
    expect(stats.currentWinningStreak).toBe(0);
    expect(stats.currentLosingStreak).toBe(1);
    expect(stats.maxWinningStreak).toBe(3);
  });

  it('Task T2.4: determines Best Asset and Worst Asset statistics', () => {
    const s = 'asset-session';

    // EUR/USD: 2 Wins, 0 Losses (100% Win Rate)
    const e1 = tradeManager.registerTrade({ sessionId: s, asset: 'EUR/USD', direction: TradingAction.BUY, eventId: 'a1' });
    tradeManager.resolveTradeOutcome(e1!.id, TradeOutcome.WIN);
    const e2 = tradeManager.registerTrade({ sessionId: s, asset: 'EUR/USD', direction: TradingAction.BUY, eventId: 'a2' });
    tradeManager.resolveTradeOutcome(e2!.id, TradeOutcome.WIN);

    // BTC/USD: 0 Wins, 2 Losses (0% Win Rate)
    const b1 = tradeManager.registerTrade({ sessionId: s, asset: 'BTC/USD', direction: TradingAction.SELL, eventId: 'a3' });
    tradeManager.resolveTradeOutcome(b1!.id, TradeOutcome.LOSS);
    const b2 = tradeManager.registerTrade({ sessionId: s, asset: 'BTC/USD', direction: TradingAction.SELL, eventId: 'a4' });
    tradeManager.resolveTradeOutcome(b2!.id, TradeOutcome.LOSS);

    const stats = performanceEngine.getPerformanceStats(s);
    expect(stats.bestAsset?.asset).toBe('EUR/USD');
    expect(stats.bestAsset?.winRate).toBe(100);

    expect(stats.worstAsset?.asset).toBe('BTC/USD');
    expect(stats.worstAsset?.winRate).toBe(0);
  });

  it('Task T2.7 & T2.8: supports history filtering and deletion management', () => {
    const s = 'history-session';
    const t1 = tradeManager.registerTrade({ sessionId: s, asset: 'EUR/USD', direction: TradingAction.BUY, eventId: 'h1' });
    tradeManager.resolveTradeOutcome(t1!.id, TradeOutcome.WIN);

    const t2 = tradeManager.registerTrade({ sessionId: s, asset: 'GBP/USD', direction: TradingAction.SELL, eventId: 'h2' });
    tradeManager.resolveTradeOutcome(t2!.id, TradeOutcome.LOSS);

    // Query all history
    let history = performanceEngine.queryHistory({});
    expect(history.length).toBe(2);

    // Filter by asset
    const eurHistory = performanceEngine.queryHistory({ asset: 'EUR/USD' });
    expect(eurHistory.length).toBe(1);
    expect(eurHistory[0].asset).toBe('EUR/USD');

    // Delete single trade
    const deleted = performanceEngine.deleteTrade(t1!.id);
    expect(deleted).toBe(true);

    history = performanceEngine.queryHistory({});
    expect(history.length).toBe(1);
    expect(history[0].id).toBe(t2!.id);

    // Clear all history
    const cleared = performanceEngine.clearAllHistory();
    expect(cleared).toBe(1);
    expect(performanceEngine.queryHistory({}).length).toBe(0);
  });

  it('cleans orphan signal history rows from history management actions', () => {
    const signalId = 'sig-orphan-cleanup-test';
    db.prepare(
      `INSERT INTO signal_history (
        id, session_id, frame_id, timestamp, asset, timeframe,
        raw_decision, stabilized_decision, raw_reason, stabilized_reason,
        signal_strength, risk, data_quality, market_bias, recommended_expiry, outcome
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      signalId,
      'cleanup-session',
      'frame-cleanup',
      Date.now(),
      'EUR/USD',
      '1m',
      'BUY',
      'BUY',
      'test',
      'test',
      0.8,
      'LOW',
      'HIGH',
      'BULLISH',
      '1 min',
      null
    );

    const deleted = performanceEngine.deleteTrade(signalId);
    expect(deleted).toBe(true);

    const row = db.prepare('SELECT id FROM signal_history WHERE id = ?').get(signalId);
    expect(row).toBeUndefined();
  });
});
