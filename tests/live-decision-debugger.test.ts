import { describe, it, expect, beforeEach } from 'vitest';
import { LiveDecisionTraceEngine, ScanTrace } from '../electron/main/analytics/LiveDecisionTraceEngine';
import { RunningTradeManager } from '../electron/main/trade/RunningTradeManager';
import { TradingAction, TradeOutcome } from '../shared/types/decision';

describe('Sprint T7 Live Decision Trace Engine & Trade Debugger Tests', () => {
  let traceEngine: LiveDecisionTraceEngine;

  beforeEach(() => {
    traceEngine = LiveDecisionTraceEngine.getInstance();
    traceEngine.setEnabled(false);
  });

  it('Task 7: Zero overhead & zero storage when disabled', () => {
    expect(traceEngine.getIsEnabled()).toBe(false);

    traceEngine.recordScanTrace({
      scanId: 'scan-1',
      timestamp: Date.now(),
      asset: 'EUR/USD',
      timeframe: '1m',
      currentPrice: 1.0850,
      trend: 'UPTREND',
      structure: 'HIGHER_HIGH',
      momentum: 'STRONG',
      volatility: 'NORMAL',
      marketRegime: 'TRENDING',
      rsi: 55,
      ema: 1.0840,
      bollingerPercentB: 0.6,
      patterns: ['Bullish Engulfing'],
      support: 1.0820,
      resistance: 1.0890,
      evidenceScore: 0.82,
      bullishScore: 4,
      bearishScore: 0,
      agreementScore: 0.9,
      risk: 'LOW',
      confidence: 85,
      rawDecision: 'BUY',
      finalDecision: 'BUY',
      reasons: ['Strong bullish momentum'],
    });

    expect(traceEngine.getScanTraces().length).toBe(0);
    expect(traceEngine.getDecisionChangeLogs().length).toBe(0);
  });

  it('Task 1: Records scan trace when enabled', () => {
    traceEngine.setEnabled(true);
    expect(traceEngine.getIsEnabled()).toBe(true);

    traceEngine.recordScanTrace({
      scanId: 'scan-1',
      timestamp: Date.now(),
      asset: 'EUR/USD',
      timeframe: '1m',
      currentPrice: 1.0850,
      trend: 'UPTREND',
      structure: 'HIGHER_HIGH',
      momentum: 'STRONG',
      volatility: 'NORMAL',
      marketRegime: 'TRENDING',
      rsi: 55,
      ema: 1.0840,
      bollingerPercentB: 0.6,
      patterns: ['Bullish Engulfing'],
      support: 1.0820,
      resistance: 1.0890,
      evidenceScore: 0.82,
      bullishScore: 4,
      bearishScore: 0,
      agreementScore: 0.9,
      risk: 'LOW',
      confidence: 85,
      rawDecision: 'BUY',
      finalDecision: 'BUY',
      reasons: ['Strong bullish momentum'],
    });

    const traces = traceEngine.getScanTraces();
    expect(traces.length).toBe(1);
    expect(traces[0].asset).toBe('EUR/USD');
    expect(traces[0].finalDecision).toBe('BUY');
  });

  it('Task 2: Logs decision transitions with causative engine', () => {
    traceEngine.setEnabled(true);

    const baseTrace: ScanTrace = {
      scanId: 'scan-1',
      timestamp: Date.now(),
      asset: 'EUR/USD',
      timeframe: '1m',
      currentPrice: 1.0850,
      trend: 'UPTREND',
      structure: 'HIGHER_HIGH',
      momentum: 'STRONG',
      volatility: 'NORMAL',
      marketRegime: 'TRENDING',
      rsi: 55,
      ema: 1.0840,
      bollingerPercentB: 0.6,
      patterns: ['Bullish Engulfing'],
      support: 1.0820,
      resistance: 1.0890,
      evidenceScore: 0.82,
      bullishScore: 4,
      bearishScore: 0,
      agreementScore: 0.9,
      risk: 'LOW',
      confidence: 85,
      rawDecision: 'BUY',
      finalDecision: 'BUY',
      reasons: ['Strong bullish momentum'],
    };

    traceEngine.recordScanTrace(baseTrace);

    // Flips to WAIT due to RiskEngine
    const flippedTrace: ScanTrace = {
      ...baseTrace,
      scanId: 'scan-2',
      timestamp: Date.now() + 1000,
      risk: 'HIGH',
      finalDecision: 'WAIT',
      reasons: ['High volatility risk'],
    };

    traceEngine.recordScanTrace(flippedTrace);

    const logs = traceEngine.getDecisionChangeLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].oldDecision).toBe('BUY');
    expect(logs[0].newDecision).toBe('WAIT');
    expect(logs[0].causativeEngine).toBe('RiskEngine');
  });

  it('Task 3: Running Trade Debugger retrieves active trade states', () => {
    traceEngine.setEnabled(true);
    const tm = RunningTradeManager.getInstance();
    tm.clearAll();

    const t = tm.registerTrade({
      sessionId: 'debug-session',
      asset: 'GBP/USD',
      direction: TradingAction.BUY,
      expirySeconds: 60,
      eventId: 'evt-debug-1',
    });

    expect(t).not.toBeNull();

    const debugInfo = traceEngine.getRunningTradeDebugInfo();
    expect(debugInfo.length).toBe(1);
    expect(debugInfo[0].asset).toBe('GBP/USD');
    expect(debugInfo[0].direction).toBe('BUY');
    expect(debugInfo[0].tradeState).toBe('TRADE_ACTIVE');

    tm.clearAll();
  });
});
