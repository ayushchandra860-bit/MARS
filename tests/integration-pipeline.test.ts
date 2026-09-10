import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RunningTradeManager } from '../electron/main/trade/RunningTradeManager';
import { Database } from '../electron/main/database/Database';
import { TradeRepository } from '../electron/main/database/repositories/TradeRepository';
import { PerformanceEngine } from '../electron/main/performance/PerformanceEngine';
import { AnalyticsEngine } from '../electron/main/analytics/AnalyticsEngine';
import { CalibrationDatasetManager } from '../electron/main/brain/CalibrationDatasetManager';
import { LiveDecisionTraceEngine } from '../electron/main/analytics/LiveDecisionTraceEngine';
import { TradingAction, TradeOutcome } from '../shared/types/decision';
import * as fs from 'fs';
import * as path from 'path';

describe('MARS PRO V3 — Sprint I1 End-to-End Real Trade Pipeline Integration Test', () => {
  let db: Database;
  let tradeRepo: TradeRepository;
  let tradeManager: RunningTradeManager;
  let perfEngine: PerformanceEngine;
  let analyticsEngine: AnalyticsEngine;
  let calibrationManager: CalibrationDatasetManager;
  let traceEngine: LiveDecisionTraceEngine;
  const testDbPath = path.join(__dirname, 'test-sprint-i1.db');

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

    perfEngine = PerformanceEngine.getInstance();
    perfEngine.setDatabase(db);

    analyticsEngine = AnalyticsEngine.getInstance();
    analyticsEngine.setDatabase(db);

    calibrationManager = CalibrationDatasetManager.getInstance();
    calibrationManager.setDatabase(db);

    traceEngine = LiveDecisionTraceEngine.getInstance();
    traceEngine.setEnabled(true);
  });

  afterEach(() => {
    if (tradeManager) tradeManager.clearAll();
    if (db) db.close();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
  });

  it('Task I1.1: End-to-End Trace of a Real BUY Trade from Capture to SQLite Persistence', () => {
    const eventId = `click_${Date.now()}_100_200_BUY`;
    const trade = tradeManager.registerTrade({
      sessionId: 'session-i1-buy',
      asset: 'EUR/USD',
      direction: TradingAction.BUY,
      expirySeconds: 60,
      confidence: 0.85,
      entryPrice: '1.0850',
      reasons: ['Strong UPTREND', 'RSI Bullish'],
      eventId: eventId,
    });

    expect(trade).not.toBeNull();
    const tradeId = trade!.id;

    // Verify Active State in RunningTradeManager
    const activeTrades = tradeManager.getActiveTrades();
    expect(activeTrades.length).toBe(1);
    expect(activeTrades[0].id).toBe(tradeId);

    // Verify SQLite Row Creation in tracked_trades
    const insertedRow = db.prepare(`SELECT * FROM tracked_trades WHERE id = ?`).get(tradeId) as any;
    expect(insertedRow).not.toBeUndefined();
    expect(insertedRow.id).toBe(tradeId);
    expect(insertedRow.action).toBe('BUY');
    expect(insertedRow.asset).toBe('EUR/USD');
    expect(insertedRow.status).toBe('ACTIVE');

    // Simulate Trade Outcome Resolution (Expiry reached, price = 1.0870)
    tradeManager.resolveTradeOutcome(tradeId, TradeOutcome.WIN, '1.0870');

    // Verify Completed Row in SQLite
    const completedRow = db.prepare(`SELECT * FROM tracked_trades WHERE id = ?`).get(tradeId) as any;
    expect(completedRow.status).toBe('COMPLETED');
    expect(completedRow.outcome).toBe('WIN');
    expect(completedRow.completion_price).toBe('1.0870');

    // Verify Performance Engine Update
    const stats = perfEngine.getPerformanceStats();
    expect(stats.totalCompleted).toBe(1);
    expect(stats.allTimeWins).toBe(1);
    expect(stats.allTimeWinRate).toBe(100);

    // Verify Analytics Engine Update
    const analytics = analyticsEngine.getComprehensiveReport();
    expect(analytics.totalTrades).toBe(1);

    // Verify Calibration Dataset Freeze
    const snapshots = calibrationManager.getCalibrationObservations();
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].tradeId).toBe(tradeId);
  });

  it('Task I1.2: End-to-End Trace of a Real SELL Trade from Capture to SQLite Persistence', () => {
    const eventId = `click_${Date.now()}_150_250_SELL`;
    const trade = tradeManager.registerTrade({
      sessionId: 'session-i1-sell',
      asset: 'GBP/USD',
      direction: TradingAction.SELL,
      expirySeconds: 60,
      confidence: 0.88,
      entryPrice: '1.2650',
      reasons: ['DOWNTREND', 'EMA Bearish Crossover'],
      eventId: eventId,
    });

    expect(trade).not.toBeNull();
    const tradeId = trade!.id;

    // Resolve Trade Outcome (Price dropped to 1.2630 = WIN)
    tradeManager.resolveTradeOutcome(tradeId, TradeOutcome.WIN, '1.2630');

    const completedRow = db.prepare(`SELECT * FROM tracked_trades WHERE id = ?`).get(tradeId) as any;
    expect(completedRow.status).toBe('COMPLETED');
    expect(completedRow.outcome).toBe('WIN');
    expect(completedRow.completion_price).toBe('1.2630');
  });

  it('Task I1.3: ML feature snapshots persist and completed labeled trades are queryable', () => {
    const features = Array.from({ length: 11 }, (_, index) => index / 10);
    tradeRepo.createTrade({
      id: 'trade-ml-persistence',
      sessionId: 'session-ml',
      signalId: 'signal-ml',
      action: TradingAction.BUY,
      asset: 'EUR/USD',
      timeframe: '1m',
      expiryLabel: '1 MIN',
      expirySeconds: 60,
      confidence: 0.75,
      regime: 'TRENDING',
      entryPrice: '1.1000',
      entryTimestamp: Date.now(),
      expiryTimestamp: Date.now() + 60_000,
      mlFeatures: features,
    });

    const persisted = db.prepare('SELECT ml_features FROM tracked_trades WHERE id = ?').get('trade-ml-persistence') as any;
    expect(JSON.parse(persisted.ml_features)).toEqual(features);

    tradeRepo.completeTrade('trade-ml-persistence', TradeOutcome.WIN, '1.1010');
    const labeled = calibrationManager.getLabeledTrades();
    expect(labeled).toHaveLength(1);
    expect(labeled[0].direction).toBe('BUY');
    expect(labeled[0].outcome).toBe('WIN');

    const learningExamples = calibrationManager.getLabeledFeatureExamples();
    expect(learningExamples).toHaveLength(1);
    expect(learningExamples[0].features).toEqual(features);
    expect(learningExamples[0].label).toBe(1);
  });

  it('Task I1.4: Event-Level Duplicate Protection & Fast Double Click Prevention', () => {
    const eventId = `click_duplicate_test_123`;
    const trade1 = tradeManager.registerTrade({
      sessionId: 'session-i1-dup',
      asset: 'USD/JPY',
      direction: TradingAction.BUY,
      expirySeconds: 60,
      eventId: eventId,
    });

    expect(trade1).not.toBeNull();

    // Fast double click with SAME eventId (Bubbled DOM click event)
    const trade2 = tradeManager.registerTrade({
      sessionId: 'session-i1-dup',
      asset: 'USD/JPY',
      direction: TradingAction.BUY,
      expirySeconds: 60,
      eventId: eventId,
    });

    // Deduplication returns existing active trade record rather than spawning duplicate SQLite row
    expect(trade2).not.toBeNull();
    expect(trade2!.id).toBe(trade1!.id);

    const count = db.prepare(`SELECT COUNT(*) as cnt FROM tracked_trades WHERE session_id = 'session-i1-dup'`).get() as any;
    expect(count.cnt).toBe(1);
  });
});
