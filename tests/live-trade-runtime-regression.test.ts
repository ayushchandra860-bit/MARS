import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Database } from '../electron/main/database/Database';
import { SignalHistoryRepository } from '../electron/main/database/repositories/SignalHistoryRepository';
import { TradeRepository } from '../electron/main/database/repositories/TradeRepository';
import { RunningTradeManager } from '../electron/main/trade/RunningTradeManager';
import { RiskLevel, TradeState, TradingAction } from '../shared/types/decision';

describe('Live trade runtime regressions', () => {
  let db: Database;
  let dbPath: string;
  let tradeRepo: TradeRepository;
  let tradeManager: RunningTradeManager;

  beforeEach(async () => {
    dbPath = path.join(__dirname, `live-trade-regression-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.db`);
    db = new Database(dbPath);
    await db.initialize();
    tradeRepo = new TradeRepository(db);
    tradeManager = RunningTradeManager.getInstance();
    tradeManager.clearAll();
    tradeManager.setRepository(tradeRepo);
  });

  afterEach(() => {
    tradeManager.clearAll();
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('treats repeated enriched writes for one live signal as idempotent', () => {
    const repository = new SignalHistoryRepository(db);
    const record = {
      id: 'signal-runtime-duplicate-1',
      sessionId: 'runtime-session',
      frameId: 'frame-1',
      timestamp: Date.now(),
      asset: 'EUR/USD',
      timeframe: '1m',
      rawDecision: TradingAction.BUY,
      stabilizedDecision: TradingAction.BUY,
      rawReason: 'EMA alignment',
      stabilizedReason: 'EMA alignment',
      signalStrength: 0.82,
      risk: RiskLevel.LOW,
      dataQuality: 'HIGH' as any,
      marketBias: 'BULLISH' as any,
      recommendedExpiry: '1 min',
      outcome: null,
      confidence: 0.82,
      marketRegime: 'TRENDING',
      evidenceSummary: '{}',
      marketState: '{}',
      entryContext: '{}',
    };

    expect(() => repository.recordEnriched(record)).not.toThrow();
    expect(() => repository.recordEnriched({ ...record, frameId: 'frame-2', timestamp: Date.now() + 1 })).not.toThrow();

    const row = db.prepare('SELECT COUNT(*) AS count, frame_id FROM signal_history WHERE id = ?').get(record.id) as { count: number; frame_id: string };
    expect(row.count).toBe(1);
    expect(row.frame_id).toBe('frame-1');
  });

  it('exposes a controller-persisted active trade to panel/debugger consumers immediately', () => {
    const now = Date.now();
    tradeRepo.createTrade({
      id: 'trade-controller-persisted-1',
      sessionId: 'runtime-session',
      signalId: 'signal-controller-persisted-1',
      action: TradingAction.SELL,
      asset: 'EUR/USD',
      timeframe: '1m',
      expiryLabel: '1 min',
      expirySeconds: 60,
      confidence: 0.74,
      regime: 'TRENDING',
      entryPrice: '1.08500',
      entryTimestamp: now,
      expiryTimestamp: now + 60_000,
      reasons: ['EMA alignment'],
      mlFeatures: [0.1, 0.2, 0.3],
    });

    expect(tradeManager.getActiveTrades()).toHaveLength(0);
    const panelTrades = tradeManager.getPanelActiveTrades();
    expect(panelTrades).toHaveLength(1);
    expect(panelTrades[0]).toMatchObject({
      id: 'trade-controller-persisted-1',
      signalId: 'signal-controller-persisted-1',
      direction: TradingAction.SELL,
      status: TradeState.TRADE_ACTIVE,
      entryPrice: '1.08500',
    });
    expect(panelTrades[0].runningTimeSec).toBeGreaterThanOrEqual(0);
  });
});

