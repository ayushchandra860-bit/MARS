import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CalibrationDatasetManager } from '../electron/main/brain/CalibrationDatasetManager';
import { RunningTradeManager } from '../electron/main/trade/RunningTradeManager';
import { Database } from '../electron/main/database/Database';
import { TradeRepository } from '../electron/main/database/repositories/TradeRepository';
import { TradingAction, TradeOutcome } from '../shared/types/decision';
import * as fs from 'fs';
import * as path from 'path';

describe('CalibrationDatasetManager Engine (Sprint T3)', () => {
  let db: Database;
  let datasetManager: CalibrationDatasetManager;
  let tradeManager: RunningTradeManager;
  let tradeRepo: TradeRepository;
  const testDbPath = path.join(__dirname, 'test-t3-calibration.db');

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
    db = new Database(testDbPath);
    await db.initialize();

    tradeRepo = new TradeRepository(db);

    datasetManager = CalibrationDatasetManager.getInstance();
    datasetManager.setDatabase(db);

    tradeManager = RunningTradeManager.getInstance();
    tradeManager.clearAll();
    tradeManager.setRepository(tradeRepo);
  });

  afterEach(() => {
    if (tradeManager) tradeManager.clearAll();
    if (db) db.close();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
  });

  it('Task T3.1: builds lightweight structured immutable trade snapshot', () => {
    const snapshot = datasetManager.buildSnapshot({
      id: 'trade-t3-001',
      sessionId: 'session-t3',
      asset: 'EUR/USD',
      direction: TradingAction.BUY,
      entryTimestamp: 1700000000000,
      expirySeconds: 60,
      completionTimestamp: 1700000060000,
      result: TradeOutcome.WIN,
      confidence: 0.85,
      reasons: ['RSI oversold', 'EMA Golden Cross'],
    }, {
      agreementScore: 0.9,
      overallStrength: 0.88,
      marketRegime: 'TRENDING_UP',
      rsi: 28.5,
    });

    expect(snapshot.tradeId).toBe('trade-t3-001');
    expect(snapshot.asset).toBe('EUR/USD');
    expect(snapshot.direction).toBe('BUY');
    expect(snapshot.result).toBe('WIN');
    expect(snapshot.confidence).toBe(0.85);
    expect(snapshot.marketRegime).toBe('TRENDING_UP');
    expect(snapshot.rsi).toBe(28.5);
    expect(snapshot.reasons).toContain('RSI oversold');
  });

  it('Task T3.4: reports LEARNING ONLY when below 100 trades', () => {
    // Add 5 completed trades
    for (let i = 1; i <= 5; i++) {
      const t = tradeManager.registerTrade({ sessionId: 's3', asset: 'EUR/USD', direction: TradingAction.BUY, eventId: `ev-${i}` });
      tradeManager.resolveTradeOutcome(t!.id, i % 2 === 0 ? TradeOutcome.WIN : TradeOutcome.LOSS);
    }

    const health = datasetManager.getCalibrationHealth();
    expect(health.totalTrades).toBe(5);
    expect(health.health).toBe('INSUFFICIENT_DATA');
    expect(health.statusMessage).toBe('LEARNING ONLY (< 100 OBSERVATIONS)');
    expect(health.isReadyForCalibration).toBe(false);
  });

  it('Task T3.4: reports CALIBRATION CANDIDATE / READY when completed trades reach 100 threshold', () => {
    for (let i = 1; i <= 102; i++) {
      const t = tradeManager.registerTrade({ sessionId: 's3', asset: 'GBP/USD', direction: TradingAction.SELL, eventId: `t3-${i}` });
      tradeManager.resolveTradeOutcome(t!.id, TradeOutcome.WIN);
    }

    const health = datasetManager.getCalibrationHealth();
    expect(health.totalTrades).toBe(102);
    expect(health.health).toBe('GOOD');
    expect(health.statusMessage).toBe('CALIBRATION CANDIDATE (>= 100 OBSERVATIONS)');
    expect(health.isReadyForCalibration).toBe(true);
  });

  it('Task T3.2 & T3.8: retrieves clean structured observations for future AI calibration reading', () => {
    const t = tradeManager.registerTrade({ sessionId: 's3', asset: 'EUR/USD', direction: TradingAction.BUY, eventId: `t3-obs` });
    tradeManager.resolveTradeOutcome(t!.id, TradeOutcome.WIN, '1.0950');

    const observations = datasetManager.getCalibrationObservations();
    expect(observations.length).toBe(1);
    expect(observations[0].asset).toBe('EUR/USD');
    expect(observations[0].direction).toBe('BUY');
    expect(observations[0].result).toBe('WIN');
  });
});
