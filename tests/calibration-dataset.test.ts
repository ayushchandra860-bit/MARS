import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CalibrationDatasetManager } from '../electron/main/brain/CalibrationDatasetManager';
import { RunningTradeManager } from '../electron/main/trade/RunningTradeManager';
import { Database } from '../electron/main/database/Database';
import { TradeRepository } from '../electron/main/database/repositories/TradeRepository';
import { TradingAction, TradeOutcome } from '../shared/types/decision';
import { PlatformMode } from '../shared/types/canonical';
import * as fs from 'fs';
import * as path from 'path';

describe('CalibrationDatasetManager clean LIVE dataset', () => {
  let db: Database;
  let datasetManager: CalibrationDatasetManager;
  let tradeManager: RunningTradeManager;
  let tradeRepo: TradeRepository;
  const testDbPath = path.join(__dirname, 'test-t3-calibration.db');

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
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
    tradeManager.clearAll();
    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  const registerCleanLiveTrade = (eventId: string, asset = 'EUR/USD') => tradeManager.registerTrade({
    sessionId: 's3',
    asset,
    direction: TradingAction.BUY,
    eventId,
    entryPrice: '1.1000',
    platformMode: PlatformMode.LIVE,
  });

  it('builds an immutable snapshot with explicit provenance', () => {
    const snapshot = datasetManager.buildSnapshot({
      id: 'trade-t3-001', sessionId: 'session-t3', asset: 'EUR/USD',
      direction: TradingAction.BUY, entryTimestamp: 1700000000000,
      expirySeconds: 60, completionTimestamp: 1700000060000,
      result: TradeOutcome.WIN, platformMode: PlatformMode.LIVE,
      confidence: 0.85, reasons: ['RSI oversold', 'EMA Golden Cross'],
    }, { agreementScore: 0.9, overallStrength: 0.88, marketRegime: 'TRENDING_UP', rsi: 28.5 });
    expect(snapshot.tradeId).toBe('trade-t3-001');
    expect(snapshot.asset).toBe('EUR/USD');
    expect(snapshot.platformMode).toBe(PlatformMode.LIVE);
    expect(snapshot.result).toBe('WIN');
    expect(snapshot.marketRegime).toBe('TRENDING_UP');
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.reasons)).toBe(true);
  });

  it('reports learning-only below 100 clean LIVE trades', () => {
    for (let index = 1; index <= 5; index += 1) {
      const trade = registerCleanLiveTrade(`ev-${index}`);
      tradeManager.resolveTradeOutcome(
        trade!.id,
        index % 2 === 0 ? TradeOutcome.WIN : TradeOutcome.LOSS,
        index % 2 === 0 ? '1.1010' : '1.0990',
      );
    }
    const health = datasetManager.getCalibrationHealth();
    expect(health.totalTrades).toBe(5);
    expect(health.health).toBe('INSUFFICIENT_DATA');
    expect(health.statusMessage).toContain('LEARNING ONLY');
    expect(health.isReadyForCalibration).toBe(false);
  });

  it('reaches calibration-candidate status at 100 clean LIVE trades', () => {
    for (let index = 1; index <= 102; index += 1) {
      const trade = registerCleanLiveTrade(`t3-${index}`, 'GBP/USD');
      tradeManager.resolveTradeOutcome(trade!.id, TradeOutcome.WIN, '1.1010');
    }
    const health = datasetManager.getCalibrationHealth();
    expect(health.totalTrades).toBe(102);
    expect(health.health).toBe('GOOD');
    expect(health.statusMessage).toContain('CALIBRATION CANDIDATE');
    expect(health.isReadyForCalibration).toBe(true);
  });

  it('excludes demo, unknown-mode, and price-incomplete outcomes', () => {
    const live = registerCleanLiveTrade('clean-live');
    tradeManager.resolveTradeOutcome(live!.id, TradeOutcome.WIN, '1.1010');

    for (const [eventId, mode, completion] of [
      ['demo', PlatformMode.DEMO, '1.1010'],
      ['unknown', PlatformMode.UNKNOWN, '1.1010'],
      ['missing-completion', PlatformMode.LIVE, null],
    ] as const) {
      const trade = tradeManager.registerTrade({
        sessionId: 's3', asset: 'EUR/USD', direction: TradingAction.BUY,
        eventId, entryPrice: '1.1000', platformMode: mode,
      });
      tradeManager.resolveTradeOutcome(trade!.id, TradeOutcome.WIN, completion);
    }

    const health = datasetManager.getCalibrationHealth();
    expect(health.totalTrades).toBe(1);
    expect(datasetManager.getCalibrationObservations()).toHaveLength(1);
    expect(datasetManager.getLabeledTrades()).toHaveLength(1);
  });
});
