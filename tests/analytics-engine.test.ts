import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnalyticsEngine } from '../electron/main/analytics/AnalyticsEngine';
import { CalibrationDatasetManager } from '../electron/main/brain/CalibrationDatasetManager';
import { RunningTradeManager } from '../electron/main/trade/RunningTradeManager';
import { Database } from '../electron/main/database/Database';
import { TradeRepository } from '../electron/main/database/repositories/TradeRepository';
import { TradingAction, TradeOutcome } from '../shared/types/decision';
import { PlatformMode } from '../shared/types/canonical';
import * as fs from 'fs';
import * as path from 'path';

describe('AnalyticsEngine & Decision Intelligence (Sprint T4)', () => {
  let db: Database;
  let analyticsEngine: AnalyticsEngine;
  let datasetManager: CalibrationDatasetManager;
  let tradeManager: RunningTradeManager;
  let tradeRepo: TradeRepository;
  const testDbPath = path.join(__dirname, 'test-t4-analytics.db');

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

    analyticsEngine = AnalyticsEngine.getInstance();
    analyticsEngine.setDatabase(db);
  });

  afterEach(() => {
    if (tradeManager) tradeManager.clearAll();
    if (db) db.close();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
  });

  it('Task T4.2: calculates Confidence Bucket analytics accurately', () => {
    // Analytics intentionally accepts only verified LIVE outcomes with usable prices.
    const t1 = tradeManager.registerTrade({
      sessionId: 's4', signalId: 'signal-t4-1', asset: 'EUR/USD',
      direction: TradingAction.BUY, confidence: 0.85, eventId: 't4-1',
      entryPrice: '1.0990', platformMode: PlatformMode.LIVE,
    });
    tradeManager.resolveTradeOutcome(t1!.id, TradeOutcome.WIN, '1.1000');

    const t2 = tradeManager.registerTrade({
      sessionId: 's4', signalId: 'signal-t4-2', asset: 'EUR/USD',
      direction: TradingAction.BUY, confidence: 0.82, eventId: 't4-2',
      entryPrice: '1.1000', platformMode: PlatformMode.LIVE,
    });
    tradeManager.resolveTradeOutcome(t2!.id, TradeOutcome.LOSS, '1.0950');

    const buckets = analyticsEngine.getConfidenceAnalytics();
    const bucket80 = buckets.find(b => b.bucket === '80-89%');

    expect(bucket80).toBeDefined();
    expect(bucket80?.trades).toBe(2);
    expect(bucket80?.wins).toBe(1);
    expect(bucket80?.losses).toBe(1);
    expect(bucket80?.winRate).toBe(50);
  });

  it('Task T4.3 & T4.4: calculates Asset and Market Regime analytics', () => {
    const t1 = tradeManager.registerTrade({
      sessionId: 's4', signalId: 'signal-t4-3', asset: 'GBP/USD',
      direction: TradingAction.BUY, eventId: 't4-3',
      entryPrice: '1.2490', platformMode: PlatformMode.LIVE,
    });
    tradeManager.resolveTradeOutcome(t1!.id, TradeOutcome.WIN, '1.2500');

    const assetStats = analyticsEngine.getAssetAnalytics();
    expect(assetStats.length).toBeGreaterThan(0);

    const regimeStats = analyticsEngine.getRegimeAnalytics();
    expect(Array.isArray(regimeStats)).toBe(true);
  });

  it('Task T4.8: performs Runtime Validation check', () => {
    const report = analyticsEngine.validateRuntimeIntegrity();
    expect(report.isValid).toBe(true);
    expect(report.corruptRecordsCount).toBe(0);
  });

  it('Task T4.9: runs Auto Bug Detector scan without strategy modification', () => {
    const bugReport = analyticsEngine.runAutoBugDetector();
    expect(bugReport.timestamp).toBeGreaterThan(0);
    expect(Array.isArray(bugReport.failingConfidenceBuckets)).toBe(true);
  });

  it('Task T4.10: exports CSV and JSON analytics reports', () => {
    const csv = analyticsEngine.exportAnalyticsCsv();
    expect(csv).toContain('Trade ID');
    expect(csv).toContain('Asset');

    const json = analyticsEngine.exportAnalyticsJson();
    expect(json).toContain('totalTrades');
    expect(json).toContain('confidenceBuckets');
  });
});
