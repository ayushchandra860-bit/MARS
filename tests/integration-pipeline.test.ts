import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RunningTradeManager } from '../electron/main/trade/RunningTradeManager';
import { Database } from '../electron/main/database/Database';
import { TradeRepository } from '../electron/main/database/repositories/TradeRepository';
import { PerformanceEngine } from '../electron/main/performance/PerformanceEngine';
import { AnalyticsEngine } from '../electron/main/analytics/AnalyticsEngine';
import { CalibrationDatasetManager } from '../electron/main/brain/CalibrationDatasetManager';
import { LiveDecisionTraceEngine } from '../electron/main/analytics/LiveDecisionTraceEngine';
import { TradingAction, TradeOutcome } from '../shared/types/decision';
import { PlatformMode } from '../shared/types/canonical';
import * as fs from 'fs';
import * as path from 'path';

describe('MARS PRO V3 — End-to-End verified LIVE trade pipeline', () => {
  let db: Database;
  let tradeRepo: TradeRepository;
  let tradeManager: RunningTradeManager;
  let perfEngine: PerformanceEngine;
  let analyticsEngine: AnalyticsEngine;
  let calibrationManager: CalibrationDatasetManager;
  let traceEngine: LiveDecisionTraceEngine;
  const testDbPath = path.join(__dirname, 'test-sprint-i1.db');

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
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
    tradeManager.clearAll();
    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it('persists a verified LIVE BUY trade through completion and calibration', () => {
    const trade = tradeManager.registerTrade({
      sessionId: 'session-i1-buy', asset: 'EUR/USD', direction: TradingAction.BUY,
      expirySeconds: 60, confidence: 0.85, entryPrice: '1.0850',
      reasons: ['Strong UPTREND', 'RSI Bullish'],
      eventId: `click_${Date.now()}_100_200_BUY`, platformMode: PlatformMode.LIVE,
    });
    expect(trade).not.toBeNull();
    const tradeId = trade!.id;
    expect(tradeManager.getActiveTrades()).toHaveLength(1);
    const inserted = db.prepare('SELECT * FROM tracked_trades WHERE id = ?').get(tradeId) as any;
    expect(inserted.action).toBe('BUY');
    expect(inserted.asset).toBe('EUR/USD');
    expect(inserted.status).toBe('ACTIVE');
    expect(inserted.platform_mode).toBe('LIVE');

    expect(tradeManager.resolveTradeOutcome(tradeId, TradeOutcome.WIN, '1.0870')).toBe(true);
    const completed = db.prepare('SELECT * FROM tracked_trades WHERE id = ?').get(tradeId) as any;
    expect(completed.status).toBe('COMPLETED');
    expect(completed.outcome).toBe('WIN');
    expect(completed.completion_price).toBe('1.0870');

    const stats = perfEngine.getPerformanceStats();
    expect(stats.totalCompleted).toBe(1);
    expect(stats.allTimeWins).toBe(1);
    expect(stats.allTimeWinRate).toBe(100);
    expect(analyticsEngine.getComprehensiveReport().totalTrades).toBe(1);
    const snapshots = calibrationManager.getCalibrationObservations();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].tradeId).toBe(tradeId);
    expect(snapshots[0].platformMode).toBe(PlatformMode.LIVE);
  });

  it('persists a verified LIVE SELL trade through completion', () => {
    const trade = tradeManager.registerTrade({
      sessionId: 'session-i1-sell', asset: 'GBP/USD', direction: TradingAction.SELL,
      expirySeconds: 60, confidence: 0.88, entryPrice: '1.2650',
      reasons: ['DOWNTREND', 'EMA Bearish Crossover'],
      eventId: `click_${Date.now()}_150_250_SELL`, platformMode: PlatformMode.LIVE,
    });
    expect(trade).not.toBeNull();
    expect(tradeManager.resolveTradeOutcome(trade!.id, TradeOutcome.WIN, '1.2630')).toBe(true);
    expect(db.prepare(
      'SELECT status, outcome, completion_price FROM tracked_trades WHERE id = ?',
    ).get(trade!.id)).toEqual({ status: 'COMPLETED', outcome: 'WIN', completion_price: '1.2630' });
  });

  it('persists ML features and returns only verified LIVE labeled trades', () => {
    const features = Array.from({ length: 11 }, (_, index) => index / 10);
    expect(tradeRepo.createTrade({
      id: 'trade-ml-persistence', sessionId: 'session-ml', signalId: 'signal-ml',
      action: TradingAction.BUY, asset: 'EUR/USD', timeframe: '1m',
      expiryLabel: '1 MIN', expirySeconds: 60, confidence: 0.75,
      regime: 'TRENDING', entryPrice: '1.1000', entryTimestamp: Date.now(),
      expiryTimestamp: Date.now() + 60_000, mlFeatures: features,
      platformMode: PlatformMode.LIVE,
    })).toBe(true);
    const persisted = db.prepare(
      'SELECT ml_features, platform_mode FROM tracked_trades WHERE id = ?',
    ).get('trade-ml-persistence') as any;
    expect(JSON.parse(persisted.ml_features)).toEqual(features);
    expect(persisted.platform_mode).toBe('LIVE');
    expect(tradeRepo.completeTrade('trade-ml-persistence', TradeOutcome.WIN, '1.1010')).toBe(true);

    const labeled = calibrationManager.getLabeledTrades();
    expect(labeled).toHaveLength(1);
    expect(labeled[0].direction).toBe('BUY');
    expect(labeled[0].outcome).toBe('WIN');
    const learningExamples = calibrationManager.getLabeledFeatureExamples();
    expect(learningExamples).toHaveLength(1);
    expect(learningExamples[0].features).toEqual(features);
    expect(learningExamples[0].label).toBe(1);
  });

  it('deduplicates one DOM event without spawning another SQLite row', () => {
    const eventId = 'click_duplicate_test_123';
    const first = tradeManager.registerTrade({
      sessionId: 'session-i1-dup', asset: 'USD/JPY', direction: TradingAction.BUY,
      expirySeconds: 60, eventId,
    });
    const duplicate = tradeManager.registerTrade({
      sessionId: 'session-i1-dup', asset: 'USD/JPY', direction: TradingAction.BUY,
      expirySeconds: 60, eventId,
    });
    expect(first).not.toBeNull();
    expect(duplicate?.id).toBe(first!.id);
    expect(db.prepare(
      "SELECT COUNT(*) as cnt FROM tracked_trades WHERE session_id = 'session-i1-dup'",
    ).get()).toEqual({ cnt: 1 });
  });
});
