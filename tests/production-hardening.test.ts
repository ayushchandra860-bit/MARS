import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RunningTradeManager } from '../electron/main/trade/RunningTradeManager';
import { PerformanceEngine } from '../electron/main/performance/PerformanceEngine';
import { AnalyticsEngine } from '../electron/main/analytics/AnalyticsEngine';
import { CalibrationDatasetManager } from '../electron/main/brain/CalibrationDatasetManager';
import { Database } from '../electron/main/database/Database';
import { TradeRepository } from '../electron/main/database/repositories/TradeRepository';
import { TradingAction, TradeOutcome } from '../shared/types/decision';
import { PlatformMode } from '../shared/types/canonical';
import * as fs from 'fs';
import * as path from 'path';

describe('MARS PRO V3 — Production hardening', () => {
  let db: Database;
  let tradeRepo: TradeRepository;
  let tradeManager: RunningTradeManager;
  let perfEngine: PerformanceEngine;
  let analyticsEngine: AnalyticsEngine;
  let calibrationManager: CalibrationDatasetManager;
  const testDbPath = path.join(__dirname, 'test-t6-hardening.db');

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
  });

  afterEach(() => {
    tradeManager.clearAll();
    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  it('tracks 1,000 rapid entries and outcomes with zero collisions', () => {
    const totalTrades = 1000;
    const startMemory = process.memoryUsage().heapUsed;
    for (let index = 1; index <= totalTrades; index += 1) {
      const trade = tradeManager.registerTrade({
        sessionId: 'session-stress',
        asset: index % 3 === 0 ? 'EUR/USD' : index % 3 === 1 ? 'GBP/USD' : 'BTC/USD',
        direction: index % 2 === 0 ? TradingAction.BUY : TradingAction.SELL,
        expirySeconds: 60,
        eventId: `stress-t6-${index}`,
      });
      expect(trade).not.toBeNull();
      tradeManager.resolveTradeOutcome(
        trade!.id,
        index % 4 === 0 ? TradeOutcome.LOSS : TradeOutcome.WIN,
        '1.1000',
      );
    }
    const heapDiffMb = (process.memoryUsage().heapUsed - startMemory) / (1024 * 1024);
    const stats = perfEngine.getPerformanceStats('session-stress');
    expect(stats.totalCompleted).toBe(totalTrades);
    expect(stats.allTimeWins + stats.allTimeLosses).toBe(totalTrades);
    expect(heapDiffMb).toBeLessThan(15);
  }, 60000);

  it('keeps 100 verified LIVE records consistent under one bulk transaction', () => {
    db.transaction(() => {
      for (let index = 1; index <= 100; index += 1) {
        const trade = tradeManager.registerTrade({
          sessionId: 'crash-session', asset: 'EUR/USD', direction: TradingAction.BUY,
          eventId: `crash-${index}`, entryPrice: '1.1000', platformMode: PlatformMode.LIVE,
        });
        expect(trade).not.toBeNull();
        expect(tradeManager.resolveTradeOutcome(trade!.id, TradeOutcome.WIN, '1.1010')).toBe(true);
      }
    });
    expect(calibrationManager.getCalibrationObservations()).toHaveLength(100);
    const validation = analyticsEngine.validateRuntimeIntegrity();
    expect(validation.isValid).toBe(true);
    expect(validation.corruptRecordsCount).toBe(0);
  });

  it('passes full runtime validation for a completed record', () => {
    const trade = tradeManager.registerTrade({
      sessionId: 'audit-session', asset: 'EUR/USD', direction: TradingAction.BUY,
      eventId: 'audit-1', entryPrice: '1.0940', platformMode: PlatformMode.LIVE,
    });
    tradeManager.resolveTradeOutcome(trade!.id, TradeOutcome.WIN, '1.0950');
    const report = analyticsEngine.validateRuntimeIntegrity();
    expect(report.isValid).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.totalRecordsChecked).toBeGreaterThan(0);
  });

  it('builds 1,000 immutable snapshots within memory budget', () => {
    const memoryBefore = process.memoryUsage().heapUsed;
    for (let index = 0; index < 1000; index += 1) {
      const snapshot = calibrationManager.buildSnapshot({
        id: `snap-${index}`, sessionId: 'mem-session', asset: 'EUR/USD',
        direction: TradingAction.BUY, entryTimestamp: Date.now() - 60_000,
        expirySeconds: 60, completionTimestamp: Date.now(), result: TradeOutcome.WIN,
        platformMode: PlatformMode.LIVE, confidence: 0.85,
        reasons: ['RSI oversold', 'EMA confluence'],
      });
      expect(snapshot.tradeId).toBe(`snap-${index}`);
    }
    const growthMb = (process.memoryUsage().heapUsed - memoryBefore) / (1024 * 1024);
    expect(growthMb).toBeLessThan(10);
  }, 60000);
});
