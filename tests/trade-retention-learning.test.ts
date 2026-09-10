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
  let db: Database;
  let repo: TradeRepository;

  beforeEach(async () => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    db = new Database(dbPath);
    await db.initialize();
    repo = new TradeRepository(db);
    MLEngine.getInstance().reset();
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  const createTrade = (
    id: string,
    index: number,
    mlFeatures?: number[],
    platformMode: PlatformMode = PlatformMode.LIVE,
  ) => repo.createTrade({
    id,
    sessionId: 'retention-session',
    signalId: `signal-${id}`,
    action: TradingAction.BUY,
    asset: 'EUR/USD',
    timeframe: '1m',
    expiryLabel: '1 MIN',
    expirySeconds: 60,
    confidence: 0.7,
    regime: 'TRENDING',
    entryPrice: '1.1000',
    entryTimestamp: 1_000 + index,
    expiryTimestamp: 2_000 + index,
    mlFeatures,
    platformMode,
  });

  it('retains only the latest 1000 completed trades and never deletes active trades', () => {
    for (let i = 0; i < 1005; i += 1) {
      createTrade(`trade-${i}`, i);
      repo.completeTrade(`trade-${i}`, TradeOutcome.WIN, '1.1010');
    }
    createTrade('active-kept', 2000);
    const completedCount = db.prepare(
      "SELECT COUNT(*) AS count FROM tracked_trades WHERE status = 'COMPLETED'"
    ).get() as { count: number };
    const activeCount = db.prepare(
      "SELECT COUNT(*) AS count FROM tracked_trades WHERE status = 'ACTIVE'"
    ).get() as { count: number };
    expect(completedCount.count).toBe(1000);
    expect(activeCount.count).toBe(1);
    expect(db.prepare('SELECT id FROM tracked_trades WHERE id = ?').get('trade-0')).toBeUndefined();
    expect(db.prepare('SELECT id FROM tracked_trades WHERE id = ?').get('trade-1004'))
      .toEqual({ id: 'trade-1004' });
  }, 30_000);

  it('caps the in-memory learner at the latest 1000 labeled examples', () => {
    const ml = MLEngine.getInstance();
    const features = new Array(FEATURE_NAMES.length).fill(0.5);
    for (let i = 0; i < 1005; i += 1) {
      ml.ingestLabeledExamples([{ features, label: i % 2 === 0 ? 1 : -1, asset: 'EUR/USD' }]);
    }
    expect(ml.getSampleCount('EUR/USD')).toBe(1000);
    expect(ml.getSampleCount()).toBe(1000);
  });

  it('learns only from verified live trades and ignores duplicate completion', () => {
    const features = new Array(FEATURE_NAMES.length).fill(0.5);
    createTrade('first-trade', 1, features, PlatformMode.LIVE);
    expect(repo.completeTrade('first-trade', TradeOutcome.WIN, '1.1010')).toBe(true);
    const ml = MLEngine.getInstance();
    expect(ml.getSampleCount('EUR/USD')).toBe(1);
    expect(repo.completeTrade('first-trade', TradeOutcome.LOSS, '1.0990')).toBe(false);
    expect(ml.getSampleCount('EUR/USD')).toBe(1);
  });

  it('does not train from demo, unknown-mode, or price-incomplete outcomes', () => {
    const features = new Array(FEATURE_NAMES.length).fill(0.5);
    createTrade('demo-trade', 1, features, PlatformMode.DEMO);
    createTrade('unknown-trade', 2, features, PlatformMode.UNKNOWN);
    createTrade('missing-price', 3, features, PlatformMode.LIVE);
    repo.completeTrade('demo-trade', TradeOutcome.WIN, '1.1010');
    repo.completeTrade('unknown-trade', TradeOutcome.WIN, '1.1010');
    repo.completeTrade('missing-price', TradeOutcome.WIN, null);
    expect(MLEngine.getInstance().getSampleCount('EUR/USD')).toBe(0);
  });
});
