// ============================================================
// MARS PRO V3 — Signal Quality Inspector & Decision Explainer (Tasks 1 & 3)
// Creates per-signal runtime traces, decision explanations, evidence contribution analysis,
// and 4-way database entity linkage status (Trade/Knowledge/Analytics/Journal).
// ============================================================

import { Database } from '../database/Database';
import { TradingAction, RiskLevel } from '../../../shared/types/decision';

export interface SignalQualityTrace {
  signalId: string;
  timestamp: number;
  asset: string;
  entryPrice: number | null;
  expiryPrice: number | null;
  direction: TradingAction;
  confidence: number;
  agreementScore: number;
  overallStrength: number;
  trend: string;
  momentum: string;
  structure: string;
  volatility: string;
  marketRegime: string;
  risk: RiskLevel;
  rsi: number | null;
  ema: number | null;
  bollinger: number | null;
  support: number | null;
  resistance: number | null;
  reasons: string[];
  verificationResult: string;
  tradeLinked: boolean;
  knowledgeLinked: boolean;
  analyticsLinked: boolean;
  journalLinked: boolean;
  explanation: {
    decisionReason: string;
    mostContributedEvidence: string;
    leastContributedEvidence: string;
    agreeingIndicators: string[];
    disagreeingIndicators: string[];
    failureCause: string | null;
  };
}

export class SignalQualityInspector {
  private static instance: SignalQualityInspector | null = null;
  private db: Database | null = null;
  private traces: Map<string, SignalQualityTrace> = new Map();

  private constructor() {}

  public static getInstance(): SignalQualityInspector {
    if (!SignalQualityInspector.instance) {
      SignalQualityInspector.instance = new SignalQualityInspector();
    }
    return SignalQualityInspector.instance;
  }

  public setDatabase(db: Database): void {
    this.db = db;
  }

  // ----------------------------------------------------------
  // Task 1 & 3: Record Runtime Signal Trace & Calculate Decision Explanation
  // ----------------------------------------------------------
  public recordSignalTrace(params: {
    signalId: string;
    timestamp: number;
    asset: string;
    entryPrice: number | null;
    direction: TradingAction;
    confidence: number;
    agreementScore: number;
    overallStrength: number;
    trend: string;
    momentum: string;
    structure: string;
    volatility: string;
    marketRegime: string;
    risk: RiskLevel;
    rsi: number | null;
    ema: number | null;
    bollinger: number | null;
    support: number | null;
    resistance: number | null;
    reasons: string[];
  }): SignalQualityTrace {
    const explanation = this.explainDecision(params);

    const trace: SignalQualityTrace = {
      ...params,
      expiryPrice: null,
      verificationResult: 'PENDING',
      tradeLinked: false,
      knowledgeLinked: false,
      analyticsLinked: false,
      journalLinked: false,
      explanation,
    };

    this.traces.set(params.signalId, trace);
    if (this.traces.size > 200) {
      const firstKey = this.traces.keys().next().value;
      if (firstKey) this.traces.delete(firstKey);
    }

    return trace;
  }

  public updateVerificationAndLinkage(
    signalId: string,
    expiryPrice: number | null,
    verificationResult: string,
    linkage?: { tradeLinked?: boolean; knowledgeLinked?: boolean; analyticsLinked?: boolean; journalLinked?: boolean }
  ): void {
    const trace = this.traces.get(signalId);
    if (!trace) return;

    trace.expiryPrice = expiryPrice;
    trace.verificationResult = verificationResult;
    if (linkage?.tradeLinked !== undefined) trace.tradeLinked = linkage.tradeLinked;
    if (linkage?.knowledgeLinked !== undefined) trace.knowledgeLinked = linkage.knowledgeLinked;
    if (linkage?.analyticsLinked !== undefined) trace.analyticsLinked = linkage.analyticsLinked;
    if (linkage?.journalLinked !== undefined) trace.journalLinked = linkage.journalLinked;

    // Evaluate failure cause if outcome was WRONG
    if (verificationResult === 'WRONG') {
      trace.explanation.failureCause = this.identifyFailureCause(trace);
    }
  }

  private explainDecision(params: {
    direction: TradingAction;
    trend: string;
    momentum: string;
    volatility: string;
    rsi: number | null;
    ema: number | null;
    reasons: string[];
  }): {
    decisionReason: string;
    mostContributedEvidence: string;
    leastContributedEvidence: string;
    agreeingIndicators: string[];
    disagreeingIndicators: string[];
    failureCause: string | null;
  } {
    const agreeing: string[] = [];
    const disagreeing: string[] = [];

    if (params.direction === TradingAction.BUY) {
      if (params.trend === 'BULLISH') agreeing.push('Trend (BULLISH)');
      else disagreeing.push(`Trend (${params.trend})`);

      if (params.momentum === 'STRONG') agreeing.push('Momentum (STRONG)');

      if (params.rsi !== null && params.rsi <= 70) agreeing.push(`RSI (${Math.round(params.rsi)})`);
      else if (params.rsi !== null && params.rsi > 70) disagreeing.push(`RSI (${Math.round(params.rsi)} Overbought)`);

      return {
        decisionReason: params.reasons[0] || 'Bullish market structure alignment',
        mostContributedEvidence: agreeing[0] || 'Trend Direction',
        leastContributedEvidence: disagreeing[0] || 'Volatility Level',
        agreeingIndicators: agreeing,
        disagreeingIndicators: disagreeing,
        failureCause: null,
      };
    } else if (params.direction === TradingAction.SELL) {
      if (params.trend === 'BEARISH') agreeing.push('Trend (BEARISH)');
      else disagreeing.push(`Trend (${params.trend})`);

      if (params.momentum === 'STRONG') agreeing.push('Momentum (STRONG)');

      if (params.rsi !== null && params.rsi >= 30) agreeing.push(`RSI (${Math.round(params.rsi)})`);
      else if (params.rsi !== null && params.rsi < 30) disagreeing.push(`RSI (${Math.round(params.rsi)} Oversold)`);

      return {
        decisionReason: params.reasons[0] || 'Bearish market structure alignment',
        mostContributedEvidence: agreeing[0] || 'Trend Direction',
        leastContributedEvidence: disagreeing[0] || 'Volatility Level',
        agreeingIndicators: agreeing,
        disagreeingIndicators: disagreeing,
        failureCause: null,
      };
    } else {
      return {
        decisionReason: 'Wait condition: market evidence is neutral or conflicting',
        mostContributedEvidence: 'Market Bias Neutral',
        leastContributedEvidence: 'None',
        agreeingIndicators: ['Neutral State'],
        disagreeingIndicators: [],
        failureCause: null,
      };
    }
  }

  private identifyFailureCause(trace: SignalQualityTrace): string {
    if (trace.explanation.disagreeingIndicators.length > 0) {
      return `Contradictory Indicator: ${trace.explanation.disagreeingIndicators.join(', ')}`;
    }
    if (trace.volatility === 'HIGH_VOLATILITY' || trace.volatility === 'HIGH') {
      return 'Market Volatility Expansion against position direction';
    }
    return 'Sudden price pull back at expiry moment';
  }

  public getTrace(signalId: string): SignalQualityTrace | null {
    return this.traces.get(signalId) || null;
  }

  public getAllTraces(): SignalQualityTrace[] {
    return Array.from(this.traces.values()).reverse();
  }
}
