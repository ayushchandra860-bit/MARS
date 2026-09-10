// ============================================================
// MARS PRO V3 — Live Runtime Validation & Signal Quality Inspector Tests
// Verifies Signal Quality Traces, Decision Explanations, 10-Link Pipeline Validation,
// and 60-Second Self-Test automated repairs.
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../electron/main/database/Database';
import { SignalHistoryRepository } from '../electron/main/database/repositories/SignalHistoryRepository';
import { TradeRepository } from '../electron/main/database/repositories/TradeRepository';
import { SignalQualityInspector } from '../electron/main/brain/SignalQualityInspector';
import { PipelineConsistencyValidator } from '../electron/main/diagnostics/PipelineConsistencyValidator';
import { TradingAction, RiskLevel } from '../shared/types/decision';
import fs from 'fs';
import path from 'path';

describe('Live Runtime Validation & Signal Quality Inspector Engine', () => {
  let db: Database;
  let tempDbPath: string;
  let inspector: SignalQualityInspector;
  let validator: PipelineConsistencyValidator;

  beforeEach(async () => {
    tempDbPath = path.join(__dirname, `test-quality-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.db`);
    db = new Database(tempDbPath);
    await db.initialize();

    inspector = SignalQualityInspector.getInstance();
    inspector.setDatabase(db);

    validator = PipelineConsistencyValidator.getInstance();
    validator.setDatabase(db);
  });

  afterEach(() => {
    try {
      validator.stop60SecondSelfTest();
      db.close();
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
    } catch {}
  });

  it('Task 1 & 3: records runtime signal quality trace and generates decision explanation', () => {
    const signalId = `sig-quality-test-${Date.now()}`;
    const trace = inspector.recordSignalTrace({
      signalId,
      timestamp: Date.now(),
      asset: 'EUR/USD',
      entryPrice: 1.0850,
      direction: TradingAction.BUY,
      confidence: 85,
      agreementScore: 0.9,
      overallStrength: 0.88,
      trend: 'BULLISH',
      momentum: 'STRONG',
      structure: 'HIGHER_HIGH',
      volatility: 'NORMAL',
      marketRegime: 'TRENDING',
      risk: RiskLevel.LOW,
      rsi: 62,
      ema: 1.0845,
      bollinger: 0.7,
      support: 1.0800,
      resistance: 1.0900,
      reasons: ['EMA Bullish Alignment', 'Uptrend Structure'],
    });

    expect(trace.signalId).toBe(signalId);
    expect(trace.direction).toBe(TradingAction.BUY);
    expect(trace.explanation.decisionReason).toBe('EMA Bullish Alignment');
    expect(trace.explanation.mostContributedEvidence).toContain('Trend');
  });

  it('Task 2 & 4: validates 10-link pipeline integrity and ID alignment', () => {
    const signalId = `sig-pipeline-test-${Date.now()}`;
    const signalRepo = new SignalHistoryRepository(db);

    signalRepo.recordEnriched({
      id: signalId,
      sessionId: 'test-session-pipeline',
      frameId: 'frame-1',
      timestamp: Date.now(),
      asset: 'EUR/USD',
      timeframe: '1m',
      rawDecision: TradingAction.BUY,
      stabilizedDecision: TradingAction.BUY,
      rawReason: 'Bullish EMA',
      stabilizedReason: 'Bullish EMA',
      signalStrength: 0.85,
      risk: RiskLevel.LOW,
      dataQuality: 'HIGH' as any,
      marketBias: 'BULLISH' as any,
      recommendedExpiry: '1 min',
      outcome: 'CORRECT',
      confidence: 85,
      marketRegime: 'TRENDING',
      evidenceSummary: '{}',
      marketState: '{}',
      entryContext: '{}',
    });

    const result = validator.validateSignalPipeline(signalId);
    expect(result.overallPassed).toBe(true);
    expect(result.links.length).toBe(10);
    expect(result.links[0].stepName).toBe('Signal Generated');
    expect(result.links[1].passed).toBe(true);
  });

  it('Task 5: 60-second self-test auto-repairs missing regimes and invalid trades', () => {
    const signalRepo = new SignalHistoryRepository(db);
    signalRepo.recordEnriched({
      id: 'sig-null-regime',
      sessionId: 'test-session',
      frameId: 'frame-2',
      timestamp: Date.now(),
      asset: 'EUR/USD',
      timeframe: '1m',
      rawDecision: TradingAction.BUY,
      stabilizedDecision: TradingAction.BUY,
      rawReason: 'Bullish',
      stabilizedReason: 'Bullish',
      signalStrength: 0.8,
      risk: RiskLevel.LOW,
      dataQuality: 'HIGH' as any,
      marketBias: 'BULLISH' as any,
      recommendedExpiry: '1 min',
      outcome: null,
      confidence: 80,
      marketRegime: 'UNKNOWN',
      evidenceSummary: '{}',
      marketState: JSON.stringify({ trend: 'BULLISH' }),
      entryContext: '{}',
    });

    const report = validator.run60SecondSelfTest();
    expect(report.missingRegimesRepairedCount).toBe(1);
    expect(report.dataIntegrityStatus).toBe('REPAIRED');

    const updatedSig = db.prepare(`SELECT market_regime FROM signal_history WHERE id = ?`).get('sig-null-regime') as any;
    expect(updatedSig.market_regime).toBe('TRENDING');
  });
});
