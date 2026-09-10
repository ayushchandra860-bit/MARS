import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Database } from '../electron/main/database/Database';
import { TradeRepository } from '../electron/main/database/repositories/TradeRepository';
import { RunningTradeManager } from '../electron/main/trade/RunningTradeManager';
import { TradeOutcome, TradingAction } from '../shared/types/decision';
import { PlatformMode } from '../shared/types/canonical';

describe('Browser Workstation trade registration', () => {
  let db: Database;
  let dbPath: string;
  let repository: TradeRepository;
  let manager: RunningTradeManager;

  beforeEach(async () => {
    dbPath = path.join(__dirname, `browser-trade-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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
    for (const candidate of [dbPath, `${dbPath}.bak`]) {
      if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
    }
  });

  it('rejects timing-only result attribution when multiple trades are active', () => {
    const first = manager.registerTrade({
      sessionId: 'live-browser', signalId: 'browser-click-1', executionId: 'exec-1', asset: 'EUR/USD',
      direction: TradingAction.BUY, expirySeconds: 60, eventId: 'click-1',
      platformMode: PlatformMode.LIVE,
    });
    const second = manager.registerTrade({
      sessionId: 'live-browser', signalId: 'browser-click-2', executionId: 'exec-2', asset: 'GBP/USD',
      direction: TradingAction.SELL, expirySeconds: 120, eventId: 'click-2',
      platformMode: PlatformMode.LIVE,
    });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(manager.resolveNextActiveTrade(TradeOutcome.LOSS, null, 'live-browser')).toBe(false);
    expect(repository.getActiveTrades('live-browser')).toHaveLength(2);

    expect(manager.resolveTradeOutcome(first!.id, TradeOutcome.LOSS, '1.0900')).toBe(true);
    const completed = db.prepare(
      'SELECT status, outcome, completion_price FROM tracked_trades WHERE id = ?',
    ).get(first!.id);
    expect(completed).toEqual({ status: 'COMPLETED', outcome: 'LOSS', completion_price: '1.0900' });
  });

  it('resolves an exact execution ID and never completes its active neighbor', () => {
    const first = manager.registerTrade({
      sessionId: 'live-browser', signalId: 'exact-signal-1', executionId: 'exact-exec-1', asset: 'EUR/USD',
      direction: TradingAction.BUY, eventId: 'exact-click-1', platformMode: PlatformMode.LIVE,
    });
    const second = manager.registerTrade({
      sessionId: 'live-browser', signalId: 'exact-signal-2', executionId: 'exact-exec-2', asset: 'GBP/USD',
      direction: TradingAction.SELL, eventId: 'exact-click-2', platformMode: PlatformMode.LIVE,
    });

    expect(manager.resolveTradeByExecutionId('exact-exec-2', TradeOutcome.WIN, null)).toBe(true);
    expect(db.prepare('SELECT status, outcome FROM tracked_trades WHERE id = ?').get(second!.id))
      .toEqual({ status: 'COMPLETED', outcome: 'WIN' });
    expect(db.prepare('SELECT status, outcome FROM tracked_trades WHERE id = ?').get(first!.id))
      .toEqual({ status: 'ACTIVE', outcome: null });
  });

  it('restores execution correlation after an in-memory browser reload', () => {
    const trade = manager.registerTrade({
      sessionId: 'live-browser', signalId: 'browser-reload-click', executionId: 'reload-execution', asset: 'EUR/USD',
      direction: TradingAction.SELL, expirySeconds: 60, eventId: 'reload-click',
      platformMode: PlatformMode.LIVE,
    });
    expect(trade).not.toBeNull();
    expect(db.prepare('SELECT execution_id FROM tracked_trades WHERE id = ?').get(trade!.id))
      .toEqual({ execution_id: 'reload-execution' });

    manager.clearAll();
    manager.loadAndRecoverPendingTrades('live-browser');
    expect(manager.findTradeByExecutionId('reload-execution')?.id).toBe(trade!.id);
    expect(manager.resolveTradeByExecutionId('reload-execution', TradeOutcome.WIN, '1.0800')).toBe(true);
    expect(db.prepare(
      'SELECT status, outcome, completion_price FROM tracked_trades WHERE id = ?',
    ).get(trade!.id)).toEqual({ status: 'COMPLETED', outcome: 'WIN', completion_price: '1.0800' });
  });

  it('persists platform mode as part of authoritative trade provenance', () => {
    const trade = manager.registerTrade({
      sessionId: 'demo-browser', asset: 'EUR/USD', direction: TradingAction.BUY,
      eventId: 'demo-click', platformMode: PlatformMode.DEMO,
    });
    expect(trade?.platformMode).toBe(PlatformMode.DEMO);
    expect(db.prepare('SELECT platform_mode FROM tracked_trades WHERE id = ?').get(trade!.id))
      .toEqual({ platform_mode: 'DEMO' });
  });
});
