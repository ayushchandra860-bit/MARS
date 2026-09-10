// ============================================================
// MARS PRO V3 — Trade Capture & Execution Engine Tests (Sprint T1)
// Tests strict TradeState machine, multi-trade support, duplicate protection,
// missed trade protection, database persistence, and crash recovery.
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RunningTradeManager } from '../electron/main/trade/RunningTradeManager';
import { Database } from '../electron/main/database/Database';
import { TradeRepository } from '../electron/main/database/repositories/TradeRepository';
import { TradeState, TradingAction, TradeOutcome } from '../shared/types/decision';
import fs from 'fs';
import path from 'path';

describe('RunningTradeManager Engine (Sprint T1)', () => {
  let db: Database;
  let tradeRepo: TradeRepository;
  let manager: RunningTradeManager;
  const testDbPath = path.join(__dirname, '../scratch/test_trade_manager.db');

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
    db = new Database(testDbPath);
    await db.initialize();
    tradeRepo = new TradeRepository(db);

    manager = RunningTradeManager.getInstance();
    manager.clearAll();
    manager.setRepository(tradeRepo);
  });

  afterEach(() => {
    if (manager) {
      manager.clearAll();
    }
    if (db) {
      db.close();
    }
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
  });

  it('Task T1.4: enforces strict 7-state trade lifecycle transitions', () => {
    // Valid transitions
    expect(manager.canTransition(TradeState.WAITING, TradeState.ENTRY_DETECTED)).toBe(true);
    expect(manager.canTransition(TradeState.ENTRY_DETECTED, TradeState.TRADE_ACTIVE)).toBe(true);
    expect(manager.canTransition(TradeState.TRADE_ACTIVE, TradeState.EXPIRING)).toBe(true);
    expect(manager.canTransition(TradeState.EXPIRING, TradeState.WIN)).toBe(true);
    expect(manager.canTransition(TradeState.EXPIRING, TradeState.LOSS)).toBe(true);
    expect(manager.canTransition(TradeState.EXPIRING, TradeState.DRAW)).toBe(true);
    expect(manager.canTransition(TradeState.WIN, TradeState.ARCHIVED)).toBe(true);

    // Invalid / Illegal transitions
    expect(manager.canTransition(TradeState.WAITING, TradeState.TRADE_ACTIVE)).toBe(false);
    expect(manager.canTransition(TradeState.WAITING, TradeState.WIN)).toBe(false);
    expect(manager.canTransition(TradeState.ENTRY_DETECTED, TradeState.EXPIRING)).toBe(false);
    expect(manager.canTransition(TradeState.ARCHIVED, TradeState.TRADE_ACTIVE)).toBe(false);
  });

  it('Task T1.3: supports multi-trade tracking simultaneously', () => {
    const trade1 = manager.registerTrade({
      sessionId: 'session-multi-1',
      asset: 'EUR/USD',
      direction: TradingAction.BUY,
      expirySeconds: 60,
    });

    const trade2 = manager.registerTrade({
      sessionId: 'session-multi-1',
      asset: 'GBP/JPY',
      direction: TradingAction.SELL,
      expirySeconds: 120,
    });

    expect(trade1).not.toBeNull();
    expect(trade2).not.toBeNull();
    expect(trade1?.id).not.toEqual(trade2?.id);
    expect(manager.getActiveTradeCount()).toBe(2);

    const activeTrades = manager.getActiveTrades();
    expect(activeTrades.length).toBe(2);
    expect(activeTrades.some(t => t.asset === 'EUR/USD')).toBe(true);
    expect(activeTrades.some(t => t.asset === 'GBP/JPY')).toBe(true);
  });

  it('Task T1.4 & T1.6: deduplicates identical event IDs while allowing intentional Martingale/Scaling entries', async () => {
    const eventId = '100.5_120_340_BUY';
    const firstTrade = manager.registerTrade({
      sessionId: 'session-event-dup',
      asset: 'EUR/USD',
      direction: TradingAction.BUY,
      expirySeconds: 60,
      eventId,
    });

    // Duplicate bubbling event dispatch with same eventId is suppressed
    const duplicateDispatch = manager.registerTrade({
      sessionId: 'session-event-dup',
      asset: 'EUR/USD',
      direction: TradingAction.BUY,
      expirySeconds: 60,
      eventId,
    });

    expect(firstTrade).not.toBeNull();
    expect(duplicateDispatch?.id).toEqual(firstTrade?.id);
    expect(manager.getActiveTradeCount()).toBe(1);

    // Wait > 60ms for intentional user Martingale / scaling click
    await new Promise(r => setTimeout(r, 60));

    const martingaleTrade = manager.registerTrade({
      sessionId: 'session-event-dup',
      asset: 'EUR/USD',
      direction: TradingAction.BUY,
      expirySeconds: 60,
      eventId: '100.6_120_340_BUY', // Distinct event ID
    });

    expect(martingaleTrade).not.toBeNull();
    expect(martingaleTrade?.id).not.toEqual(firstTrade?.id);
    expect(manager.getActiveTradeCount()).toBe(2);
  });

  it('Task T1.3 Stress Test: generates 1000 rapid trades with zero ID collisions', () => {
    const tradeIds = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const trade = manager.registerTrade({
        sessionId: 'session-stress',
        asset: `ASSET-${i % 10}`,
        direction: i % 2 === 0 ? TradingAction.BUY : TradingAction.SELL,
        expirySeconds: 60,
        eventId: `stress-event-${i}`,
      });
      if (trade) {
        expect(tradeIds.has(trade.id)).toBe(false);
        tradeIds.add(trade.id);
      }
    }
    expect(tradeIds.size).toBe(1000);
  }, 60000);

  it('Task T1.10: persists active trades to SQLite database', () => {
    const trade = manager.registerTrade({
      sessionId: 'session-db',
      asset: 'AUD/USD',
      direction: TradingAction.BUY,
      expirySeconds: 60,
    });

    expect(trade).not.toBeNull();
    const dbTrades = tradeRepo.getActiveTrades('session-db');
    expect(dbTrades.length).toBe(1);
    expect(dbTrades[0].id).toBe(trade!.id);
    expect(dbTrades[0].asset).toBe('AUD/USD');
  });

  it('Task T1.11: recovers pending trades safely after crash / restart', () => {
    const trade = manager.registerTrade({
      sessionId: 'session-recovery',
      asset: 'USD/CAD',
      direction: TradingAction.SELL,
      expirySeconds: 300,
    });

    expect(trade).not.toBeNull();

    // Simulate app restart: clear memory manager state and reload from DB
    manager.clearAll();
    expect(manager.getActiveTradeCount()).toBe(0);

    manager.loadAndRecoverPendingTrades('session-recovery');
    expect(manager.getActiveTradeCount()).toBe(1);
    const recovered = manager.getActiveTrades()[0];
    expect(recovered.id).toBe(trade!.id);
    expect(recovered.asset).toBe('USD/CAD');
    expect(recovered.status).toBe(TradeState.TRADE_ACTIVE);
  });
});
