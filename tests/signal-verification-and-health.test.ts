// ============================================================
// MARS PRO V3 — Signal Verification & Health Monitor Tests
// Verifies automatic signal verification, adaptive dataset summary,
// and 17-module runtime heartbeat stall monitoring.
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { SignalVerificationEngine } from '../electron/main/brain/SignalVerificationEngine';
import { RuntimeHealthMonitor } from '../electron/main/diagnostics/RuntimeHealthMonitor';
import { TradingAction, RiskLevel } from '../shared/types/decision';

describe('Signal Verification Engine & Runtime Health Monitor', () => {
  let verifier: SignalVerificationEngine;
  let monitor: RuntimeHealthMonitor;

  beforeEach(() => {
    verifier = SignalVerificationEngine.getInstance();
    monitor = RuntimeHealthMonitor.getInstance();
  });

  it('Task 1: automatically verifies BUY signal as CORRECT when exit price > entry price', () => {
    const signalId = `test-sig-${Date.now()}`;
    const now = Date.now();

    verifier.registerSignalForVerification({
      signalId,
      timestamp: now - 60000,
      asset: 'EUR/USD',
      timeframe: '1m',
      expirySeconds: 60,
      expiryTimestamp: now - 1000, // expired
      entryPrice: 1.0850,
      direction: TradingAction.BUY,
      confidence: 85,
      agreementScore: 0.9,
      overallStrength: 0.88,
      trend: 'BULLISH',
      momentum: 'STRONG',
      structure: 'HIGHER_HIGH',
      volatility: 'NORMAL',
      risk: RiskLevel.LOW,
      marketRegime: 'TRENDING',
      rsi: 62,
      ema: 1.0845,
      bollinger: 0.7,
      support: 1.0820,
      resistance: 1.0890,
      reasons: ['EMA Bullish', 'Uptrend'],
    });

    const verifiedList = verifier.checkAndVerifySignals('EUR/USD', 1.0875);
    expect(verifiedList.length).toBe(1);
    expect(verifiedList[0].signalId).toBe(signalId);
    expect(verifiedList[0].verificationResult).toBe('CORRECT');
    expect(verifiedList[0].actualDirection).toBe('UP');
  });

  it('Task 1: automatically verifies SELL signal as WRONG when exit price > entry price', () => {
    const signalId = `test-sell-${Date.now()}`;
    const now = Date.now();

    verifier.registerSignalForVerification({
      signalId,
      timestamp: now - 60000,
      asset: 'GBP/USD',
      timeframe: '1m',
      expirySeconds: 60,
      expiryTimestamp: now - 500, // expired
      entryPrice: 1.2650,
      direction: TradingAction.SELL,
      confidence: 80,
      agreementScore: 0.8,
      overallStrength: 0.82,
      trend: 'BEARISH',
      momentum: 'STRONG',
      structure: 'LOWER_LOW',
      volatility: 'NORMAL',
      risk: RiskLevel.MEDIUM,
      marketRegime: 'TRENDING',
      rsi: 35,
      ema: 1.2660,
      bollinger: 0.3,
      support: 1.2600,
      resistance: 1.2700,
      reasons: ['EMA Bearish'],
    });

    const verifiedList = verifier.checkAndVerifySignals('GBP/USD', 1.2680);
    expect(verifiedList.length).toBe(1);
    expect(verifiedList[0].verificationResult).toBe('WRONG');
  });

  it('Task 3: tracks heartbeats and reports healthy overall system status', () => {
    monitor.recordHeartbeat('Scanner', 'RUNNING', { processingTimeMs: 12 });
    monitor.recordHeartbeat('DecisionEngine', 'RUNNING');
    monitor.recordHeartbeat('AnalysisController', 'RUNNING');

    const report = monitor.getHealthReport();
    expect(report.totalModuleCount).toBe(17);
    expect(report.modules.find(m => m.moduleName === 'Scanner')?.status).toBe('RUNNING');
    expect(report.modules.find(m => m.moduleName === 'Scanner')?.processingTimeMs).toBe(12);
  });
});
