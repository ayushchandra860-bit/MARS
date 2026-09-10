import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SelfLearningDatasetManager } from '../electron/main/brain/SelfLearningDatasetManager';
import { RunningTradeManager } from '../electron/main/trade/RunningTradeManager';
import { Database } from '../electron/main/database/Database';
import { TradeRepository } from '../electron/main/database/repositories/TradeRepository';
import { TradingAction, TradeOutcome } from '../shared/types/decision';
import * as fs from 'fs';
import * as path from 'path';

describe('Sprint T9 Self-Learning Preparation & Dataset Quality Engine Tests', () => {
  let db: Database;
  let tradeRepo: TradeRepository;
  let tradeManager: RunningTradeManager;
  let datasetManager: SelfLearningDatasetManager;
  const testDbPath = path.join(__dirname, 'test-t9-learning.db');

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

    datasetManager = SelfLearningDatasetManager.getInstance();
    datasetManager.setDatabase(db);
  });

  afterEach(() => {
    if (tradeManager) tradeManager.clearAll();
    if (db) db.close();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
  });

  it('Task 1: extracts complete 28-field learning records for completed trades', () => {
    const t = tradeManager.registerTrade({
      sessionId: 'session-t9-1',
      asset: 'EUR/USD',
      direction: TradingAction.BUY,
      expirySeconds: 60,
      confidence: 0.85,
      entryPrice: '1.0850',
      eventId: 'evt-t9-1',
    });

    expect(t).not.toBeNull();
    tradeManager.resolveTradeOutcome(t!.id, TradeOutcome.WIN, '1.0870');

    const records = datasetManager.getCompleteLearningRecords();
    expect(records.length).toBe(1);

    const r = records[0];
    expect(r.tradeId).toBe(t!.id);
    expect(r.asset).toBe('EUR/USD');
    expect(r.direction).toBe('BUY');
    expect(r.entryPrice).toBe(1.0850);
    expect(r.exitPrice).toBe(1.0870);
    expect(r.result).toBe('WIN');
    expect(r.decisionTrace).toContain('Decision:BUY');
    expect(r.runtimeMetadata.sessionId).toBe('session-t9-1');
  });

  it('Task 2: detects and automatically repairs data quality anomalies', () => {
    const t = tradeManager.registerTrade({
      sessionId: 'session-t9-2',
      asset: 'GBP/USD',
      direction: TradingAction.SELL,
      expirySeconds: 60,
      confidence: 0.9,
      eventId: 'evt-t9-2',
    });

    tradeManager.resolveTradeOutcome(t!.id, TradeOutcome.LOSS, '1.2650');

    // Introduce an anomaly directly in DB for testing repair
    db.prepare(`UPDATE tracked_trades SET confidence = 150 WHERE id = ?`).run(t!.id);

    const report = datasetManager.auditAndRepairDataQuality();
    expect(report.totalRecordsChecked).toBeGreaterThan(0);
    expect(report.repairedRecordsCount).toBeGreaterThan(0);
  });

  it('Task 4: performs step-by-step trade replay validation', () => {
    const t = tradeManager.registerTrade({
      sessionId: 'session-t9-3',
      asset: 'USD/JPY',
      direction: TradingAction.BUY,
      expirySeconds: 60,
      eventId: 'evt-t9-3',
    });

    tradeManager.resolveTradeOutcome(t!.id, TradeOutcome.WIN, '155.20');

    const replay = datasetManager.validateTradeReplay(t!.id);
    expect(replay.isValidReplay).toBe(true);
    expect(replay.matchedDecision).toBe(true);
    expect(replay.matchedOutcome).toBe(true);
  });

  it('Task 5: evaluates Model Readiness Score cleanly', () => {
    const score = datasetManager.getModelReadinessScore();
    expect(score).toHaveProperty('readinessScorePct');
    expect(score).toHaveProperty('datasetQualityPct');
    expect(score).toHaveProperty('featureCompletenessPct');
    expect(score).toHaveProperty('readinessStatus');
  });
});
