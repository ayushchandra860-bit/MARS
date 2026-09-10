// ============================================================
// MARS PRO V3 — Signal Verification Engine & Adaptive Learning Preparation (Tasks 1 & 2)
// Automatically verifies EVERY generated signal (BUY/SELL/WAIT) upon expiry
// even if untaken by user. Updates immutable signal history & adaptive learning dataset.
// ============================================================

import { Database } from '../database/Database';
import { TradingAction, TradeOutcome, RiskLevel } from '../../../shared/types/decision';
import { SignalQualityInspector } from './SignalQualityInspector';
import { KnowledgeBaseRepository } from './KnowledgeBaseRepository';

export type SignalVerificationResult = 'CORRECT' | 'WRONG' | 'NEUTRAL';

export interface VerifiedSignalRecord {
  signalId: string;
  timestamp: number;
  asset: string;
  timeframe: string;
  expirySeconds: number;
  entryPrice: number | null;
  expiryPrice: number | null;
  signalDirection: TradingAction;
  signalConfidence: number;
  agreementScore: number;
  overallStrength: number;
  trend: string;
  momentum: string;
  structure: string;
  volatility: string;
  risk: RiskLevel;
  marketRegime: string;
  rsi: number | null;
  ema: number | null;
  bollinger: number | null;
  support: number | null;
  resistance: number | null;
  reasons: string[];
  expectedDirection: string;
  actualDirection: string;
  verificationResult: SignalVerificationResult;
  verificationTimestamp: number;
  priceDifference: number | null;
  verificationSource: 'DOM' | 'OCR' | 'TITLE_STREAM';
}

export interface PendingSignalVerification {
  signalId: string;
  timestamp: number;
  asset: string;
  timeframe: string;
  expirySeconds: number;
  expiryTimestamp: number;
  entryPrice: number | null;
  direction: TradingAction;
  confidence: number;
  agreementScore: number;
  overallStrength: number;
  trend: string;
  momentum: string;
  structure: string;
  volatility: string;
  risk: RiskLevel;
  marketRegime: string;
  rsi: number | null;
  ema: number | null;
  bollinger: number | null;
  support: number | null;
  resistance: number | null;
  reasons: string[];
}

export interface AdaptiveLearningSummary {
  totalVerifiedSignals: number;
  correctSignals: number;
  wrongSignals: number;
  neutralSignals: number;
  overallAccuracyPct: number;
  successByRegime: Record<string, { total: number; correct: number; winRate: number }>;
  successByConfidence: Record<string, { total: number; correct: number; winRate: number }>;
  successByTrend: Record<string, { total: number; correct: number; winRate: number }>;
  successByStructure: Record<string, { total: number; correct: number; winRate: number }>;
  mostSuccessfulConditions: string[];
  mostFailedConditions: string[];
}

export class SignalVerificationEngine {
  private static instance: SignalVerificationEngine | null = null;
  private db: Database | null = null;
  private pendingSignals: Map<string, PendingSignalVerification> = new Map();

  private constructor() {}

  public static getInstance(): SignalVerificationEngine {
    if (!SignalVerificationEngine.instance) {
      SignalVerificationEngine.instance = new SignalVerificationEngine();
    }
    return SignalVerificationEngine.instance;
  }

  public setDatabase(db: Database): void {
    this.db = db;
  }

  // ----------------------------------------------------------
  private priceTickBuffer: Array<{ timestamp: number; asset: string; price: number; source: 'DOM' | 'OCR' | 'TITLE_STREAM' }> = [];

  public clearPriceTickBuffer(): void {
    this.priceTickBuffer = [];
  }

  // ----------------------------------------------------------
  // Task 1: Record Exact Market Price Ticks with Source
  // ----------------------------------------------------------
  public recordPriceTick(asset: string, price: number, source: 'DOM' | 'OCR' | 'TITLE_STREAM' = 'DOM'): void {
    if (!asset || !price || price <= 0) return;
    this.priceTickBuffer.push({ timestamp: Date.now(), asset: asset.toUpperCase(), price, source });
    if (this.priceTickBuffer.length > 500) this.priceTickBuffer.shift();
  }

  // ----------------------------------------------------------
  // Task 1: Register Signal for Verification
  // ----------------------------------------------------------
  public registerSignalForVerification(signal: PendingSignalVerification): void {
    if (!signal || !signal.signalId) return;
    this.pendingSignals.set(signal.signalId, signal);
  }

  // ----------------------------------------------------------
  // Task 1: Check & Verify Expired Signals at Exact Expiry Time
  // ----------------------------------------------------------
  public checkAndVerifySignals(currentAsset: string, currentPrice: number, currentSource: 'DOM' | 'OCR' | 'TITLE_STREAM' = 'DOM'): VerifiedSignalRecord[] {
    const now = Date.now();
    this.recordPriceTick(currentAsset, currentPrice, currentSource);

    const verified: VerifiedSignalRecord[] = [];

    for (const [id, pending] of this.pendingSignals.entries()) {
      if (pending.asset.toUpperCase() !== currentAsset.toUpperCase()) continue;

      if (now >= pending.expiryTimestamp) {
        // Find exact price tick closest to pending.expiryTimestamp
        const exactTick = this.findExactExpiryPriceTick(pending.asset, pending.expiryTimestamp);
        const exitPriceToUse = exactTick ? exactTick.price : currentPrice;
        const exitSourceToUse = exactTick ? exactTick.source : currentSource;

        const result = this.verifySignal(pending, exitPriceToUse, exitSourceToUse, now);
        if (result) {
          verified.push(result);
          this.persistVerifiedSignal(result);
        }
        this.pendingSignals.delete(id);
      }
    }

    return verified;
  }

  private findExactExpiryPriceTick(asset: string, targetTimestamp: number): { price: number; source: 'DOM' | 'OCR' | 'TITLE_STREAM' } | null {
    const assetTicks = this.priceTickBuffer.filter(t => t.asset === asset.toUpperCase());
    if (assetTicks.length === 0) return null;

    let closest: { price: number; source: 'DOM' | 'OCR' | 'TITLE_STREAM' } | null = null;
    let minDiff = Infinity;

    for (const tick of assetTicks) {
      const diff = Math.abs(tick.timestamp - targetTimestamp);
      if (diff < minDiff && diff <= 5000) { // within 5 seconds window
        minDiff = diff;
        closest = { price: tick.price, source: tick.source };
      }
    }

    return closest;
  }

  private verifySignal(pending: PendingSignalVerification, exitPrice: number, source: 'DOM' | 'OCR' | 'TITLE_STREAM', now: number): VerifiedSignalRecord | null {
    const entryPrice = pending.entryPrice;
    if (!entryPrice || entryPrice <= 0 || !exitPrice || exitPrice <= 0) {
      return {
        signalId: pending.signalId,
        timestamp: pending.timestamp,
        asset: pending.asset,
        timeframe: pending.timeframe,
        expirySeconds: pending.expirySeconds,
        entryPrice,
        expiryPrice: exitPrice,
        signalDirection: pending.direction,
        signalConfidence: pending.confidence,
        agreementScore: pending.agreementScore,
        overallStrength: pending.overallStrength,
        trend: pending.trend,
        momentum: pending.momentum,
        structure: pending.structure,
        volatility: pending.volatility,
        risk: pending.risk,
        marketRegime: pending.marketRegime,
        rsi: pending.rsi,
        ema: pending.ema,
        bollinger: pending.bollinger,
        support: pending.support,
        resistance: pending.resistance,
        reasons: pending.reasons,
        expectedDirection: pending.direction,
        actualDirection: 'NEUTRAL',
        verificationResult: 'NEUTRAL',
        verificationTimestamp: now,
        priceDifference: null,
        verificationSource: source,
      };
    }

    let actualDirection = 'NEUTRAL';
    if (exitPrice > entryPrice) actualDirection = 'UP';
    else if (exitPrice < entryPrice) actualDirection = 'DOWN';

    let result: SignalVerificationResult = 'NEUTRAL';
    const expectedDirection = pending.direction === TradingAction.BUY ? 'UP' : pending.direction === TradingAction.SELL ? 'DOWN' : 'NEUTRAL';

    if (pending.direction === TradingAction.BUY) {
      result = exitPrice > entryPrice ? 'CORRECT' : exitPrice < entryPrice ? 'WRONG' : 'NEUTRAL';
    } else if (pending.direction === TradingAction.SELL) {
      result = exitPrice < entryPrice ? 'CORRECT' : exitPrice > entryPrice ? 'WRONG' : 'NEUTRAL';
    } else {
      result = 'NEUTRAL';
    }

    const priceDifference = Number((exitPrice - entryPrice).toFixed(6));

    return {
      signalId: pending.signalId,
      timestamp: pending.timestamp,
      asset: pending.asset,
      timeframe: pending.timeframe,
      expirySeconds: pending.expirySeconds,
      entryPrice,
      expiryPrice: exitPrice,
      signalDirection: pending.direction,
      signalConfidence: pending.confidence,
      agreementScore: pending.agreementScore,
      overallStrength: pending.overallStrength,
      trend: pending.trend,
      momentum: pending.momentum,
      structure: pending.structure,
      volatility: pending.volatility,
      risk: pending.risk,
      marketRegime: pending.marketRegime,
      rsi: pending.rsi,
      ema: pending.ema,
      bollinger: pending.bollinger,
      support: pending.support,
      resistance: pending.resistance,
      reasons: pending.reasons,
      expectedDirection,
      actualDirection,
      verificationResult: result,
      verificationTimestamp: now,
      priceDifference,
      verificationSource: source,
    };
  }

  private persistVerifiedSignal(v: VerifiedSignalRecord): void {
    if (!this.db) return;
    try {
      this.db.prepare(
        `UPDATE signal_history
         SET outcome = ?,
             entry_context = json_set(COALESCE(entry_context, '{}'), '$.expiryPrice', ?, '$.verificationResult', ?, '$.verifiedAt', ?, '$.priceDifference', ?, '$.verificationSource', ?)
         WHERE id = ?`
      ).run(
        v.verificationResult,
        v.expiryPrice,
        v.verificationResult,
        v.verificationTimestamp,
        v.priceDifference,
        v.verificationSource,
        v.signalId
      );

      // Task 5 & 6: Update Quality Inspector for AI Learning
      SignalQualityInspector.getInstance().updateVerificationAndLinkage(
        v.signalId,
        v.expiryPrice,
        v.verificationResult,
        { knowledgeLinked: true, analyticsLinked: true, journalLinked: true }
      );
    } catch (err) {
      console.error('[SignalVerificationEngine] Error persisting verified signal:', err);
    }
  }

  // ----------------------------------------------------------
  // Task 2: Adaptive Learning Dataset Knowledge Analysis
  // ----------------------------------------------------------
  public getAdaptiveLearningSummary(): AdaptiveLearningSummary {
    if (!this.db) {
      return {
        totalVerifiedSignals: 0,
        correctSignals: 0,
        wrongSignals: 0,
        neutralSignals: 0,
        overallAccuracyPct: 0,
        successByRegime: {},
        successByConfidence: {},
        successByTrend: {},
        successByStructure: {},
        mostSuccessfulConditions: [],
        mostFailedConditions: [],
      };
    }

    const rows = this.db.prepare(
      `SELECT * FROM signal_history WHERE outcome IS NOT NULL`
    ).all() as Array<{
      id: string;
      outcome: string;
      confidence: number;
      market_regime: string | null;
      market_state: string | null;
    }>;

    let correct = 0;
    let wrong = 0;
    let neutral = 0;

    const regimeMap: Record<string, { total: number; correct: number }> = {};
    const confMap: Record<string, { total: number; correct: number }> = {};
    const trendMap: Record<string, { total: number; correct: number }> = {};
    const structureMap: Record<string, { total: number; correct: number }> = {};

    for (const r of rows) {
      const isCorrect = r.outcome === 'CORRECT' || r.outcome === 'WIN';
      const isWrong = r.outcome === 'WRONG' || r.outcome === 'LOSS';

      if (isCorrect) correct++;
      else if (isWrong) wrong++;
      else neutral++;

      const regime = r.market_regime || 'UNKNOWN';
      if (!regimeMap[regime]) regimeMap[regime] = { total: 0, correct: 0 };
      regimeMap[regime].total++;
      if (isCorrect) regimeMap[regime].correct++;

      const confBucket = `${Math.floor(r.confidence / 10) * 10}-${Math.floor(r.confidence / 10) * 10 + 9}%`;
      if (!confMap[confBucket]) confMap[confBucket] = { total: 0, correct: 0 };
      confMap[confBucket].total++;
      if (isCorrect) confMap[confBucket].correct++;

      if (r.market_state) {
        try {
          const parsed = JSON.parse(r.market_state);
          if (parsed.trend) {
            const tr = parsed.trend;
            if (!trendMap[tr]) trendMap[tr] = { total: 0, correct: 0 };
            trendMap[tr].total++;
            if (isCorrect) trendMap[tr].correct++;
          }
          if (parsed.structure) {
            const st = parsed.structure;
            if (!structureMap[st]) structureMap[st] = { total: 0, correct: 0 };
            structureMap[st].total++;
            if (isCorrect) structureMap[st].correct++;
          }
        } catch {}
      }
    }

    const total = rows.length;
    const accuracy = (correct + wrong) > 0 ? Math.round((correct / (correct + wrong)) * 100) : 0;

    const formatMap = (map: Record<string, { total: number; correct: number }>) => {
      const res: Record<string, { total: number; correct: number; winRate: number }> = {};
      for (const k in map) {
        const winRate = map[k].total > 0 ? Math.round((map[k].correct / map[k].total) * 100) : 0;
        res[k] = { total: map[k].total, correct: map[k].correct, winRate };
      }
      return res;
    };

    const mostSuccessful: string[] = [];
    const mostFailed: string[] = [];

    for (const reg in regimeMap) {
      if (regimeMap[reg].total >= 5) {
        const wr = (regimeMap[reg].correct / regimeMap[reg].total) * 100;
        if (wr >= 75) mostSuccessful.push(`Regime ${reg}: ${Math.round(wr)}% accuracy`);
        else if (wr <= 45) mostFailed.push(`Regime ${reg}: ${Math.round(wr)}% accuracy`);
      }
    }

    return {
      totalVerifiedSignals: total,
      correctSignals: correct,
      wrongSignals: wrong,
      neutralSignals: neutral,
      overallAccuracyPct: accuracy,
      successByRegime: formatMap(regimeMap),
      successByConfidence: formatMap(confMap),
      successByTrend: formatMap(trendMap),
      successByStructure: formatMap(structureMap),
      mostSuccessfulConditions: mostSuccessful,
      mostFailedConditions: mostFailed,
    };
  }
}
