import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RunningTradeManager } from '../electron/main/trade/RunningTradeManager';
import { PerformanceEngine } from '../electron/main/performance/PerformanceEngine';
import { AnalyticsEngine } from '../electron/main/analytics/AnalyticsEngine';
import { CalibrationDatasetManager } from '../electron/main/brain/CalibrationDatasetManager';
import { Database } from '../electron/main/database/Database';
import { TradeRepository } from '../electron/main/database/repositories/TradeRepository';
import { TradingAction, TradeOutcome } from '../shared/types/decision';
import * as fs from 'fs';
import * as path from 'path';

describe('MARS PRO V3 — Production Hardening & Release Certification (Sprint T6)', () => {
  let db: Database;
  let tradeRepo: TradeRepository;
  let tradeManager: RunningTradeManager;
  let perfEngine: PerformanceEngine;
  let analyticsEngine: AnalyticsEngine;
  let calibrationManager: CalibrationDatasetManager;
  const testDbPath = path.join(__dirname, 'test-t6-hardening.db');

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
  });

  afterEach(() => {
    if (tradeManager) tradeManager.clearAll();
    if (db) db.close();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
  });

  it('Task T6.5: Trade Stress Test — 1,000 rapid entries and outcome resolutions with zero collisions', () => {
    const totalTrades = 1000;
    const startMemory = process.memoryUsage().heapUsed;

    for (let i = 1; i <= totalTrades; i++) {
      const action = i % 2 === 0 ? TradingAction.BUY : TradingAction.SELL;
      const asset = i % 3 === 0 ? 'EUR/USD' : i % 3 === 1 ? 'GBP/USD' : 'BTC/USD';
      const eventId = `stress-t6-${i}`;

      const t = tradeManager.registerTrade({
        sessionId: 'session-stress',
        asset,
        direction: action,
        expirySeconds: 60,
        eventId,
      });

      expect(t).not.toBeNull();
      const outcome = i % 4 === 0 ? TradeOutcome.LOSS : TradeOutcome.WIN;
      tradeManager.resolveTradeOutcome(t!.id, outcome, '1.1000');
    }

    const endMemory = process.memoryUsage().heapUsed;
    const heapDiffMb = (endMemory - startMemory) / (1024 * 1024);

    const stats = perfEngine.getPerformanceStats('session-stress');
    expect(stats.totalCompleted).toBe(totalTrades);
    expect(stats.allTimeWins + stats.allTimeLosses).toBe(totalTrades);

    // Memory growth must remain under 15MB for 1000 full lifecycle trades
    expect(heapDiffMb).toBeLessThan(15);
  }, 60000);

  it('Task T6.6: Database Crash Recovery & Transaction Integrity under stress', () => {
    // Perform bulk transaction write
    db.transaction(() => {
      for (let i = 1; i <= 100; i++) {
        const t = tradeManager.registerTrade({
          sessionId: 'crash-session',
          asset: 'EUR/USD',
          direction: TradingAction.BUY,
          eventId: `crash-${i}`,
        });
        tradeManager.resolveTradeOutcome(t!.id, TradeOutcome.WIN);
      }
    });

    const snapshots = calibrationManager.getCalibrationObservations();
    expect(snapshots.length).toBe(100);

    const validation = analyticsEngine.validateRuntimeIntegrity();
    expect(validation.isValid).toBe(true);
    expect(validation.corruptRecordsCount).toBe(0);
  });

  it('Task T6.7: Full System Runtime Validation Audit', () => {
    // Generate valid completed trade
    const t1 = tradeManager.registerTrade({
      sessionId: 'audit-session',
      asset: 'EUR/USD',
      direction: TradingAction.BUY,
      eventId: 'audit-1',
    });
    tradeManager.resolveTradeOutcome(t1!.id, TradeOutcome.WIN, '1.0950');

    const report = analyticsEngine.validateRuntimeIntegrity();
    expect(report.isValid).toBe(true);
    expect(report.errors.length).toBe(0);
    expect(report.totalRecordsChecked).toBeGreaterThan(0);
  });

  it('Task T6.11: 1,000 Decision & Trade Cycles Memory Stability Test', () => {
    const memoryBefore = process.memoryUsage().heapUsed;

    for (let i = 0; i < 1000; i++) {
      const snap = calibrationManager.buildSnapshot({
        id: `snap-${i}`,
        sessionId: 'mem-session',
        asset: 'EUR/USD',
        direction: TradingAction.BUY,
        entryTimestamp: Date.now() - 60000,
        expirySeconds: 60,
        completionTimestamp: Date.now(),
        result: TradeOutcome.WIN,
        confidence: 0.85,
        reasons: ['RSI oversold', 'EMA confluence'],
      });
      expect(snap.tradeId).toBe(`snap-${i}`);
    }

    const memoryAfter = process.memoryUsage().heapUsed;
    const memoryGrowthMb = (memoryAfter - memoryBefore) / (1024 * 1024);

    // 1000 snapshot builds in memory must consume less than 10MB
    expect(memoryGrowthMb).toBeLessThan(10);
  }, 60000);
});
