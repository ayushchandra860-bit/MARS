import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { AnalyticsEngine } from '../electron/main/analytics/AnalyticsEngine';
import { CalibrationDatasetManager } from '../electron/main/brain/CalibrationDatasetManager';
import { Database } from '../electron/main/database/Database';
import { SignalHistoryRepository } from '../electron/main/database/repositories/SignalHistoryRepository';
import { TradeRepository } from '../electron/main/database/repositories/TradeRepository';
import { RiskLevel, TradeOutcome, TradingAction } from '../shared/types/decision';
import { PlatformMode } from '../shared/types/canonical';
import { MarketBias } from '../shared/types/market';
import { QualityLevel } from '../shared/types/scanner';

describe('MARS ecosystem data contract', () => {
  let db: Database;
  let dbPath: string;
  let trades: TradeRepository;
  let signals: SignalHistoryRepository;
  let calibration: CalibrationDatasetManager;
  let analytics: AnalyticsEngine;

  beforeEach(async () => {
    dbPath = path.join(__dirname, `mars-ecosystem-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = new Database(dbPath);
    await db.initialize();
    trades = new TradeRepository(db);
    signals = new SignalHistoryRepository(db);
    calibration = CalibrationDatasetManager.getInstance();
    calibration.setDatabase(db);
    analytics = AnalyticsEngine.getInstance();
    analytics.setDatabase(db);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  function recordSignal(id: string, asset = 'Gold') {
    signals.recordEnriched({
      id, sessionId: 'session-eco', frameId: `frame-${id}`, timestamp: Date.now(),
      asset, timeframe: '1m', rawDecision: TradingAction.BUY,
      stabilizedDecision: TradingAction.BUY, rawReason: 'linked signal',
      stabilizedReason: 'linked signal', signalStrength: 0.82,
      risk: RiskLevel.MEDIUM, dataQuality: QualityLevel.HIGH,
      marketBias: MarketBias.BULLISH, recommendedExpiry: '1 min', outcome: null,
      confidence: 82, marketRegime: 'TRENDING',
      evidenceSummary: JSON.stringify({ reasons: ['linked signal'], agreementScore: 0.76, overallStrength: 0.82 }),
      marketState: JSON.stringify({
        trend: 'BULLISH', momentum: 'STRONG', structure: 'UPTREND',
        volatility: 'NORMAL', rsi: 57, bollingerPercentB: 0.62,
      }),
      entryContext: JSON.stringify({ currentPrice: 100, expiry: '1 min' }),
    });
  }

  function createCompletedTrade(input: {
    id: string;
    signalId: string;
    asset: string | null;
    entryPrice: string | null;
    completionPrice: string | null;
    outcome: TradeOutcome;
    platformMode?: PlatformMode;
  }) {
    const now = Date.now();
    trades.createTrade({
      id: input.id, sessionId: 'session-eco', signalId: input.signalId,
      action: TradingAction.BUY, asset: input.asset, timeframe: '1m',
      expiryLabel: '1 min', expirySeconds: 60, confidence: 0.82,
      regime: 'TRENDING', entryPrice: input.entryPrice,
      entryTimestamp: now - 60_000, expiryTimestamp: now - 1_000,
      reasons: ['linked signal'],
      mlFeatures: [0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.9, 0.8, 0.7],
      platformMode: input.platformMode ?? PlatformMode.LIVE,
    });
    trades.completeTrade(input.id, input.outcome, input.completionPrice);
  }

  it('calibration and analytics only count verified LIVE trades linked to a saved signal', () => {
    recordSignal('sig-clean');
    createCompletedTrade({
      id: 'trade-clean', signalId: 'sig-clean', asset: 'Gold', entryPrice: '100.00',
      completionPrice: '101.00', outcome: TradeOutcome.WIN,
    });
    createCompletedTrade({
      id: 'trade-unlinked', signalId: 'missing-signal', asset: 'Gold', entryPrice: '100.00',
      completionPrice: '101.00', outcome: TradeOutcome.WIN,
    });
    createCompletedTrade({
      id: 'trade-arrow-asset', signalId: 'sig-clean', asset: '▲', entryPrice: '100.00',
      completionPrice: '101.00', outcome: TradeOutcome.WIN,
    });
    createCompletedTrade({
      id: 'trade-demo', signalId: 'sig-clean', asset: 'Gold', entryPrice: '100.00',
      completionPrice: '101.00', outcome: TradeOutcome.WIN, platformMode: PlatformMode.DEMO,
    });
    createCompletedTrade({
      id: 'trade-no-entry', signalId: 'sig-clean', asset: 'Gold', entryPrice: null,
      completionPrice: null, outcome: TradeOutcome.UNRESOLVED,
    });

    expect(calibration.getCalibrationObservations().map((item) => item.tradeId))
      .toEqual(['trade-clean']);
    const report = analytics.getComprehensiveReport();
    expect(report.totalTrades).toBe(1);
    expect(report.assetAnalytics).toHaveLength(1);
    expect(report.assetAnalytics[0].asset).toBe('Gold');
  });

  it('runtime validation treats active and unresolved trades as pending, not corrupt analytics rows', () => {
    const now = Date.now();
    trades.createTrade({
      id: 'active-no-price', sessionId: 'session-eco', signalId: 'manual-active',
      action: TradingAction.SELL, asset: '▲', timeframe: '1m', expiryLabel: '1 min',
      expirySeconds: 60, confidence: 0.5, regime: null, entryPrice: null,
      entryTimestamp: now, expiryTimestamp: now + 60_000,
      reasons: ['manual platform click without signal'], platformMode: PlatformMode.UNKNOWN,
    });
    const validation = analytics.validateRuntimeIntegrity();
    expect(validation.isValid).toBe(true);
    expect(validation.corruptRecordsCount).toBe(0);
    expect(validation.totalRecordsChecked).toBe(1);
  });
});
