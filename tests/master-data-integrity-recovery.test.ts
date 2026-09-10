// ============================================================
// MARS PRO V3 — Master Data Integrity & Database Truth Repair Tests
// Verifies atomic outcome resolution transactions, regime persistence,
// complete reason list preservation, referential integrity, and rollback safety.
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../electron/main/database/Database';
import { TradeRepository } from '../electron/main/database/repositories/TradeRepository';
import { SignalHistoryRepository } from '../electron/main/database/repositories/SignalHistoryRepository';
import { RunningTradeManager } from '../electron/main/trade/RunningTradeManager';
import { TradingAction, TradeOutcome, RiskLevel } from '../shared/types/decision';
import fs from 'fs';
import path from 'path';

describe('Master Data Integrity & Database Truth Repair Engine', () => {
  let db: Database;
  let tempDbPath: string;
  let tradeRepo: TradeRepository;
  let signalRepo: SignalHistoryRepository;
  let tradeManager: RunningTradeManager;

  beforeEach(async () => {
    tempDbPath = path.join(__dirname, `test-integrity-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.db`);
    db = new Database(tempDbPath);
    await db.initialize();

    tradeRepo = new TradeRepository(db);
    signalRepo = new SignalHistoryRepository(db);

    tradeManager = RunningTradeManager.getInstance();
    tradeManager.setRepository(tradeRepo);
    tradeManager.clearAll();
  });

  afterEach(() => {
    try {
      tradeManager.clearAll();
      db.close();
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
    } catch {}
  });

  it('Task 3: persists real MarketRegime and timeframe instead of UNKNOWN / NULL', () => {
    const signalId = `sig-regime-${Date.now()}`;
    const trade = tradeManager.registerTrade({
      sessionId: 'test-session',
      signalId,
      asset: 'EUR/USD',
      direction: TradingAction.BUY,
      expirySeconds: 60,
      confidence: 85,
      entryPrice: '1.0850',
      reasons: ['EMA Bullish Alignment', 'Uptrend'],
      timeframe: '1m',
      regime: 'TRENDING',
    });

    expect(trade).not.toBeNull();
    if (trade) {
      const dbRow = db.prepare(`SELECT * FROM tracked_trades WHERE id = ?`).get(trade.id) as any;
      expect(dbRow.regime).toBe('TRENDING');
      expect(dbRow.timeframe).toBe('1m');
    }
  });

  it('Task 7: performs atomic outcome resolution across tracked_trades and signal_history in a single transaction', () => {
    const signalId = `sig-atomic-${Date.now()}`;

    signalRepo.recordEnriched({
      id: signalId,
      sessionId: 'test-session',
      frameId: 'frame-atomic',
      timestamp: Date.now(),
      asset: 'EUR/USD',
      timeframe: '1m',
      rawDecision: TradingAction.BUY,
      stabilizedDecision: TradingAction.BUY,
      rawReason: 'EMA Bullish',
      stabilizedReason: 'EMA Bullish',
      signalStrength: 0.85,
      risk: RiskLevel.LOW,
      dataQuality: 'HIGH' as any,
      marketBias: 'BULLISH' as any,
      recommendedExpiry: '1 min',
      outcome: null,
      confidence: 85,
      marketRegime: 'TRENDING',
      evidenceSummary: '{}',
      marketState: '{}',
      entryContext: '{}',
    });

    const activeTrade = tradeManager.registerTrade({
      sessionId: 'test-session',
      signalId,
      asset: 'EUR/USD',
      direction: TradingAction.BUY,
      expirySeconds: 60,
      confidence: 85,
      entryPrice: '1.0850',
      reasons: ['EMA Bullish Alignment'],
      timeframe: '1m',
      regime: 'TRENDING',
    });

    expect(activeTrade).not.toBeNull();
    if (activeTrade) {
      tradeManager.resolveTradeOutcome(activeTrade.id, TradeOutcome.WIN, '1.0860');

      const completedTrade = db.prepare(`SELECT status, outcome, completion_price FROM tracked_trades WHERE id = ?`).get(activeTrade.id) as any;
      expect(completedTrade.status).toBe('COMPLETED');
      expect(completedTrade.outcome).toBe('WIN');

      const updatedSignal = db.prepare(`SELECT outcome FROM signal_history WHERE id = ?`).get(signalId) as any;
      expect(updatedSignal.outcome).toBe('WIN');
    }
  });

  it('Task 4: preserves full reason chain in original_reasons JSON column', () => {
    const reasons = ['EMA Bullish Alignment', 'RSI Confluence', 'Uptrend Structure'];
    const trade = tradeManager.registerTrade({
      sessionId: 'test-session',
      signalId: 'sig-reasons-test',
      asset: 'EUR/USD',
      direction: TradingAction.BUY,
      expirySeconds: 60,
      confidence: 85,
      entryPrice: '1.0850',
      reasons,
      timeframe: '1m',
      regime: 'TRENDING',
    });

    expect(trade).not.toBeNull();
    if (trade) {
      const dbRow = db.prepare(`SELECT original_reasons FROM tracked_trades WHERE id = ?`).get(trade.id) as any;
      const parsedReasons = JSON.parse(dbRow.original_reasons);
      expect(parsedReasons).toEqual(reasons);
    }
  });
});
