import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Database } from '../electron/main/database/Database';
import { TradeRepository } from '../electron/main/database/repositories/TradeRepository';
import { RunningTradeManager } from '../electron/main/trade/RunningTradeManager';
import { TradeOutcome, TradingAction } from '../shared/types/decision';

describe('Browser Workstation trade registration', () => {
  let db: Database;
  let dbPath: string;
  let repository: TradeRepository;
  let manager: RunningTradeManager;

  beforeEach(async () => {
    dbPath = path.join(
      __dirname,
      `browser-trade-registration-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    db = new Database(dbPath);
    await db.initialize();
    repository = new TradeRepository(db);
    manager = RunningTradeManager.getInstance();
    manager.clearAll();
    manager.setRepository(repository);
  });

  afterEach(() => {
    manager.clearAll();
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('persists a detected browser click and applies the next detected result to the matching pending trade', () => {
    const first = manager.registerTrade({
      sessionId: 'live-browser',
      signalId: 'browser-click-1',
      asset: 'Crypto Composite Index',
      direction: TradingAction.BUY,
      expirySeconds: 60,
      eventId: 'click-1',
    });
    const second = manager.registerTrade({
      sessionId: 'live-browser',
      signalId: 'browser-click-2',
      asset: 'Crypto Composite Index',
      direction: TradingAction.SELL,
      expirySeconds: 120,
      eventId: 'click-2',
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(repository.getActiveTrades('live-browser')).toHaveLength(2);

    expect(
      manager.resolveNextActiveTrade(TradeOutcome.LOSS, '-100.00', 'live-browser'),
    ).toBe(true);

    const completed = db.prepare(
      'SELECT status, outcome, completion_price FROM tracked_trades WHERE id = ?',
    ).get(first!.id) as { status: string; outcome: string; completion_price: string };
    expect(completed).toEqual({
      status: 'COMPLETED',
      outcome: 'LOSS',
      completion_price: '-100.00',
    });

    const stillActive = repository.getActiveTrades('live-browser');
    expect(stillActive).toHaveLength(1);
    expect(stillActive[0].id).toBe(second!.id);
  });

  it('uses the durable database record when a result arrives after an in-memory browser reload', () => {
    const trade = manager.registerTrade({
      sessionId: 'live-browser',
      signalId: 'browser-reload-click',
      asset: 'EUR/USD',
      direction: TradingAction.SELL,
      expirySeconds: 60,
      eventId: 'reload-click',
    });
    expect(trade).not.toBeNull();

    manager.clearAll();

    expect(
      manager.resolveNextActiveTrade(TradeOutcome.WIN, '85.00', 'live-browser'),
    ).toBe(true);

    const completed = db.prepare(
      'SELECT status, outcome, completion_price FROM tracked_trades WHERE id = ?',
    ).get(trade!.id) as { status: string; outcome: string; completion_price: string };
    expect(completed).toEqual({
      status: 'COMPLETED',
      outcome: 'WIN',
      completion_price: '85.00',
    });
  });
});
