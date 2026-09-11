import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SelfLearningDatasetManager } from '../electron/main/brain/SelfLearningDatasetManager';
import { RunningTradeManager } from '../electron/main/trade/RunningTradeManager';
import { Database } from '../electron/main/database/Database';
import { TradeRepository } from '../electron/main/database/repositories/TradeRepository';
import { TradingAction, TradeOutcome } from '../shared/types/decision';
import { PlatformMode } from '../shared/types/canonical';
import { FEATURE_NAMES } from '../electron/main/decision/MLEngine';
import * as fs from 'fs';
import * as path from 'path';

describe('verified self-learning dataset', () => {
  let db: Database; let manager: RunningTradeManager; let dataset: SelfLearningDatasetManager;
  const dbPath = path.join(__dirname, 'test-t9-learning.db');
  beforeEach(async () => {
    for (const candidate of [dbPath, `${dbPath}.bak`]) if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
    db = new Database(dbPath); await db.initialize();
    manager = RunningTradeManager.getInstance(); manager.clearAll(); manager.setRepository(new TradeRepository(db));
    dataset = SelfLearningDatasetManager.getInstance(); dataset.setDatabase(db);
  });
  afterEach(() => { manager.clearAll(); db.close(); for (const candidate of [dbPath, `${dbPath}.bak`]) if (fs.existsSync(candidate)) fs.unlinkSync(candidate); });
  const register = (id: string, mode = PlatformMode.LIVE, features: number[] | undefined = new Array(FEATURE_NAMES.length).fill(0.5)) => manager.registerTrade({
    sessionId: 'learning-session', signalId: `manual-${id}`, asset: 'EUR/USD', direction: TradingAction.BUY,
    expirySeconds: 60, confidence: 0.85, entryPrice: '1.0850', eventId: id, platformMode: mode, mlFeatures: features,
  });

  it('extracts only real, verified LIVE price-complete records', () => {
    const live = register('live')!; const demo = register('demo', PlatformMode.DEMO)!;
    manager.resolveTradeOutcome(live.id, TradeOutcome.WIN, '1.0870');
    manager.resolveTradeOutcome(demo.id, TradeOutcome.WIN, '1.0870');
    const records = dataset.getCompleteLearningRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ tradeId: live.id, asset: 'EUR/USD', direction: 'BUY', entryPrice: 1.085, exitPrice: 1.087, confidence: 0.85 });
    expect(records[0].mlFeatures).toHaveLength(FEATURE_NAMES.length);
    expect(records[0].runtimeMetadata.version).toBe('3.0.1-rc.1');
  });

  it('normalizes legacy percent confidence and removes impossible values instead of inventing 0.5', () => {
    const legacy = register('legacy')!; const invalid = register('invalid')!;
    manager.resolveTradeOutcome(legacy.id, TradeOutcome.WIN, '1.0870');
    manager.resolveTradeOutcome(invalid.id, TradeOutcome.LOSS, '1.0830');
    db.prepare('UPDATE tracked_trades SET confidence = 85 WHERE id = ?').run(legacy.id);
    db.prepare('UPDATE tracked_trades SET confidence = 150 WHERE id = ?').run(invalid.id);
    const report = dataset.auditAndRepairDataQuality();
    expect(report.anomaliesDetected.impossibleConfidence).toEqual(expect.arrayContaining([legacy.id, invalid.id]));
    expect(db.prepare('SELECT confidence FROM tracked_trades WHERE id = ?').get(legacy.id)).toEqual({ confidence: 0.85 });
    expect(db.prepare('SELECT confidence FROM tracked_trades WHERE id = ?').get(invalid.id)).toEqual({ confidence: null });
  });

  it('requires real entry and completion prices for a valid replay', () => {
    const trade = register('replay')!;
    manager.resolveTradeOutcome(trade.id, TradeOutcome.WIN, '1.0870');
    expect(dataset.validateTradeReplay(trade.id)).toMatchObject({ isValidReplay: true, matchedEntry: true, matchedExit: true });
    db.prepare('UPDATE tracked_trades SET completion_price = NULL WHERE id = ?').run(trade.id);
    expect(dataset.validateTradeReplay(trade.id).isValidReplay).toBe(false);
  });

  it('reports missing ML features honestly instead of treating defaults as complete', () => {
    const complete = register('complete')!; const incomplete = register('incomplete', PlatformMode.LIVE, [])!;
    manager.resolveTradeOutcome(complete.id, TradeOutcome.WIN, '1.0870');
    manager.resolveTradeOutcome(incomplete.id, TradeOutcome.LOSS, '1.0830');
    const score = dataset.getModelReadinessScore();
    expect(score.sampleCount).toBe(2);
    expect(score.featureCompletenessPct).toBe(50);
    expect(score.readinessStatus).toBe('INSUFFICIENT_SAMPLES');
  });
});
