import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Database } from '../electron/main/database/Database';
import { TradeRepository } from '../electron/main/database/repositories/TradeRepository';
import { MLEngine, FEATURE_NAMES } from '../electron/main/decision/MLEngine';
import { TradingAction, TradeOutcome } from '../shared/types/decision';
import { PlatformMode } from '../shared/types/canonical';

describe('bounded trade history and guarded continuous learning', () => {
  const dbPath = path.join(__dirname, 'test-trade-retention.db');
  let db: Database; let repo: TradeRepository;
  beforeEach(async () => {
    for (const candidate of [dbPath, `${dbPath}.bak`]) if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
    db = new Database(dbPath); await db.initialize(); repo = new TradeRepository(db); MLEngine.getInstance().reset();
  });
  afterEach(() => { db.close(); for (const candidate of [dbPath, `${dbPath}.bak`]) if (fs.existsSync(candidate)) fs.unlinkSync(candidate); });
  const createTrade = (id: string, index: number, mlFeatures?: number[], mode = PlatformMode.LIVE) => repo.createTrade({
    id, sessionId: 'retention-session', signalId: `signal-${id}`, action: TradingAction.BUY,
    asset: 'EUR/USD', timeframe: '1m', expiryLabel: '1 MIN', expirySeconds: 60,
    confidence: 0.7, regime: 'TRENDING', entryPrice: '1.1000', entryTimestamp: 1000 + index,
    expiryTimestamp: 2000 + index, mlFeatures, platformMode: mode,
  });

  it('retains only latest 1000 completed trades and never active trades', () => {
    for (let i = 0; i < 1005; i++) { createTrade(`trade-${i}`, i); repo.completeTrade(`trade-${i}`, TradeOutcome.WIN, '1.1010'); }
    createTrade('active-kept', 2000);
    expect((db.prepare("SELECT COUNT(*) count FROM tracked_trades WHERE status='COMPLETED'").get() as any).count).toBe(1000);
    expect((db.prepare("SELECT COUNT(*) count FROM tracked_trades WHERE status='ACTIVE'").get() as any).count).toBe(1);
  }, 30000);

  it('caps learner at latest 1000 action-labeled examples', () => {
    const ml = MLEngine.getInstance(); const features = new Array(FEATURE_NAMES.length).fill(0.5);
    for (let i = 0; i < 1005; i++) ml.ingestLabeledExamples([{ features, label: i % 2 ? 1 : -1, action: TradingAction.BUY, asset: 'EUR/USD' }]);
    expect(ml.getSampleCount('EUR/USD')).toBe(1000); expect(ml.getSampleCount()).toBe(1000);
  });

  it('learns only from verified LIVE price-complete trades', () => {
    const features = new Array(FEATURE_NAMES.length).fill(0.5);
    createTrade('live', 1, features, PlatformMode.LIVE); createTrade('demo', 2, features, PlatformMode.DEMO);
    repo.completeTrade('live', TradeOutcome.WIN, '1.1010'); repo.completeTrade('demo', TradeOutcome.WIN, '1.1010');
    expect(MLEngine.getInstance().getSampleCount('EUR/USD')).toBe(1);
    expect(repo.completeTrade('live', TradeOutcome.LOSS, '1.0990')).toBe(false);
    expect(MLEngine.getInstance().getSampleCount('EUR/USD')).toBe(1);
  });

  it('ignores unknown-mode and price-incomplete outcomes', () => {
    const features = new Array(FEATURE_NAMES.length).fill(0.5);
    createTrade('unknown', 1, features, PlatformMode.UNKNOWN); createTrade('missing', 2, features, PlatformMode.LIVE);
    repo.completeTrade('unknown', TradeOutcome.WIN, '1.1010'); repo.completeTrade('missing', TradeOutcome.WIN, null);
    expect(MLEngine.getInstance().getSampleCount('EUR/USD')).toBe(0);
  });
});
