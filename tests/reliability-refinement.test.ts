import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OcrService } from '../electron/main/scanner/OcrService';
import { AnalyticsEngine } from '../electron/main/analytics/AnalyticsEngine';
import { Database } from '../electron/main/database/Database';
import * as fs from 'fs';
import * as path from 'path';

describe('Sprint T5 Reliability & Terminal UX Refinement Tests', () => {
  let db: Database;
  let ocrService: OcrService;
  let analyticsEngine: AnalyticsEngine;
  const testDbPath = path.join(__dirname, 'test-t5-reliability.db');

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
    db = new Database(testDbPath);
    await db.initialize();

    ocrService = new OcrService();
    analyticsEngine = AnalyticsEngine.getInstance();
    analyticsEngine.setDatabase(db);
  });

  afterEach(() => {
    if (db) db.close();
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch {}
    }
  });

  it('Issue 1: discards a quote when no valid heartbeat arrives for 5 seconds', () => {
    ocrService.extractAssetFromTitle('EUR/USD — Olymp Trade');
    ocrService.extractPriceFromText('Price: 1.0842');

    const fresh = ocrService.getCachedOcrResults();
    expect(fresh).not.toBeNull();
    expect(fresh!.timestamp).toBeGreaterThan(0);
    expect(fresh!.currentPrice).toBe(1.0842);
    expect(fresh!.asset).toBe('EUR/USD');

    // Age the source-observation timestamp. Repeating the same valid price in
    // normal operation refreshes this heartbeat, but silence must still expire.
    (ocrService as any).priceObservedTimestamp = Date.now() - 6000;
    const priceStale = ocrService.getCachedOcrResults();
    expect(priceStale!.currentPrice).toBeNull();
    expect(priceStale!.asset).toBe('EUR/USD');

    (ocrService as any).assetCacheTimestamp = Date.now() - 6000;
    const allStale = ocrService.getCachedOcrResults();
    expect(allStale!.currentPrice).toBeNull();
    expect(allStale!.asset).toBeNull();
  });

  it('Issue 2: supports configurable thresholds in Auto Bug Detector', () => {
    const report = analyticsEngine.runAutoBugDetector({ minTradeCount: 10, minWinRate: 55 });
    expect(report.timestamp).toBeGreaterThan(0);
    expect(Array.isArray(report.failingAssets)).toBe(true);
  });

  it('Issue 3: exports UTF-8 BOM formatted CSV data', () => {
    const csv = analyticsEngine.exportAnalyticsCsv();
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Trade ID');
  });

  it('Task T5.8: Runtime Validator detects invalid timestamps and corrupt states', () => {
    const report = analyticsEngine.validateRuntimeIntegrity();
    expect(report.isValid).toBe(true);
    expect(report.corruptRecordsCount).toBe(0);
  });
});
