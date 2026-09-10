// ============================================================
// MARS PRO V3 — Calibration Dataset & Trade Journal Engine (Sprint T3)
// Maintains immutable structured trade snapshots and calibration dataset readiness.
// Strict immutability: snapshots are saved once upon trade completion and never mutated.
// ============================================================

import { Database } from '../database/Database';
import { TradingAction, TradeOutcome, RiskLevel } from '../../../shared/types/decision';

export interface ImmutableTradeSnapshot {
  tradeId: string;
  sessionId: string;
  asset: string;
  direction: TradingAction;
  entryTimestamp: number;
  exitTimestamp: number;
  expirySeconds: number;
  result: TradeOutcome;
  confidence: number | null;
  agreementScore: number | null;
  overallStrength: number | null;
  risk: RiskLevel;
  trend: string;
  structure: string;
  momentum: string;
  volatility: string;
  marketRegime: string;
  rsi: number;
  ema: number;
  bollinger: number;
  pattern: string[];
  support: number | null;
  resistance: number | null;
  reasons: string[];
  snapshotTimestamp: number;
}

export interface CalibrationDatasetHealth {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  drawTrades: number;
  datasetSize: number;
  health: 'EXCELLENT' | 'GOOD' | 'INSUFFICIENT_DATA';
  statusMessage: string;
  isReadyForCalibration: boolean;
}

export class CalibrationDatasetManager {
  private static instance: CalibrationDatasetManager | null = null;
  private db: Database | null = null;

  // Minimum required completed trades threshold for AI calibration readiness
  private readonly MIN_CALIBRATION_THRESHOLD = 30;

  private constructor() {}

  public static getInstance(): CalibrationDatasetManager {
    if (!CalibrationDatasetManager.instance) {
      CalibrationDatasetManager.instance = new CalibrationDatasetManager();
    }
    return CalibrationDatasetManager.instance;
  }

  public setDatabase(db: Database): void {
    this.db = db;
  }

  private readonly CLEAN_COMPLETED_TRADE_WHERE = `
    t.status = 'COMPLETED'
    AND t.outcome IN ('WIN', 'LOSS', 'DRAW')
    AND t.asset IS NOT NULL
    AND TRIM(t.asset) NOT IN ('', '▲', '▼', 'UNKNOWN')
    AND t.action IN ('BUY', 'SELL')
    AND t.signal_id IS NOT NULL
    AND (s.id IS NOT NULL OR t.signal_id LIKE 'manual-%' OR t.signal_id LIKE 'trade-%' OR t.signal_id LIKE 'signal-%')
  `;

  // ----------------------------------------------------------
  // Task T3.1 & T3.2: Immutable Trade Snapshot Generation
  // ----------------------------------------------------------
  public buildSnapshot(trade: {
    id: string;
    sessionId: string;
    asset: string | null;
    direction: TradingAction;
    entryTimestamp: number;
    expirySeconds: number;
    completionTimestamp?: number | null;
    result?: TradeOutcome | null;
    confidence?: number;
    reasons?: string[];
  }, extraFeatures?: Record<string, any>): ImmutableTradeSnapshot {
    const now = Date.now();
    const exitTimestamp = trade.completionTimestamp || (trade.entryTimestamp + trade.expirySeconds * 1000);

    return {
      tradeId: trade.id,
      sessionId: trade.sessionId,
      asset: trade.asset || 'EUR/USD',
      direction: trade.direction,
      entryTimestamp: trade.entryTimestamp,
      exitTimestamp,
      expirySeconds: trade.expirySeconds,
      result: trade.result || TradeOutcome.UNRESOLVED,
      confidence: trade.confidence ?? null,
      agreementScore: extraFeatures?.agreementScore ?? null,
      overallStrength: extraFeatures?.overallStrength ?? null,
      risk: extraFeatures?.risk || RiskLevel.MEDIUM,
      trend: extraFeatures?.trend || 'NEUTRAL',
      structure: extraFeatures?.structure || 'UNKNOWN',
      momentum: extraFeatures?.momentum || 'NEUTRAL',
      volatility: extraFeatures?.volatility || 'NORMAL',
      marketRegime: extraFeatures?.marketRegime || 'UNKNOWN',
      rsi: extraFeatures?.rsi ?? 50,
      ema: extraFeatures?.ema ?? 0,
      bollinger: extraFeatures?.bollinger ?? 0.5,
      pattern: Array.isArray(extraFeatures?.pattern) ? extraFeatures!.pattern : [],
      support: extraFeatures?.support ?? null,
      resistance: extraFeatures?.resistance ?? null,
      reasons: trade.reasons || [],
      snapshotTimestamp: now,
    };
  }

  // ----------------------------------------------------------
  // Task T3.3 & T3.4: Calibration Dataset Health & Readiness
  // ----------------------------------------------------------
  public getCalibrationHealth(): CalibrationDatasetHealth {
    if (!this.db) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        drawTrades: 0,
        datasetSize: 0,
        health: 'INSUFFICIENT_DATA',
        statusMessage: 'INSUFFICIENT DATA FOR CALIBRATION',
        isReadyForCalibration: false,
      };
    }

    const rows = this.db.prepare(
      `SELECT t.outcome
       FROM tracked_trades t
       LEFT JOIN signal_history s ON s.id = t.signal_id
       WHERE ${this.CLEAN_COMPLETED_TRADE_WHERE}`
    ).all() as Array<{ outcome: string }>;

    let winningTrades = 0;
    let losingTrades = 0;
    let drawTrades = 0;

    for (const r of rows) {
      if (r.outcome === 'WIN') winningTrades++;
      else if (r.outcome === 'LOSS') losingTrades++;
      else if (r.outcome === 'DRAW') drawTrades++;
    }

    const totalTrades = rows.length;
    const isReady = totalTrades >= 100;

    let health: 'EXCELLENT' | 'GOOD' | 'INSUFFICIENT_DATA' = 'INSUFFICIENT_DATA';
    let statusMessage = 'LEARNING ONLY (< 100 OBSERVATIONS)';

    if (totalTrades >= 1000) {
      health = 'EXCELLENT';
      statusMessage = 'PRODUCTION CONFIDENCE DATASET (>= 1000 OBSERVATIONS)';
    } else if (totalTrades >= 300) {
      health = 'EXCELLENT';
      statusMessage = 'STATISTICALLY RELIABLE (>= 300 OBSERVATIONS)';
    } else if (totalTrades >= 100) {
      health = 'GOOD';
      statusMessage = 'CALIBRATION CANDIDATE (>= 100 OBSERVATIONS)';
    }

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      drawTrades,
      datasetSize: totalTrades,
      health,
      statusMessage,
      isReadyForCalibration: isReady,
    };
  }

  // ----------------------------------------------------------
  // Task T3.8: Export Clean Structured Calibration Observations
  // ----------------------------------------------------------
  /**
   * Returns completed trades with entry/completion prices and outcomes,
   * for building ML training examples. Only rows with both prices and a
   * WIN/LOSS outcome are returned (draws excluded).
   */
  public getLabeledTrades(): Array<{
    id: string;
    asset: string;
    direction: string;
    entryPrice: number;
    completionPrice: number;
    outcome: 'WIN' | 'LOSS';
  }> {
    if (!this.db) return [];
    const rows = this.db.prepare(
      `SELECT t.id, t.asset, t.action AS direction, t.entry_price, t.completion_price, t.outcome
       FROM tracked_trades t
       LEFT JOIN signal_history s ON s.id = t.signal_id
       WHERE ${this.CLEAN_COMPLETED_TRADE_WHERE}
         AND t.outcome IN ('WIN', 'LOSS')
       ORDER BY t.completion_timestamp ASC` as string
    ).all() as Array<{
      id: string;
      asset: string;
      direction: string;
      entry_price: string | number;
      completion_price: string | number;
      outcome: string;
    }>;
    const out: ReturnType<CalibrationDatasetManager['getLabeledTrades']> = [];
    for (const r of rows) {
      const entry = typeof r.entry_price === 'string' ? parseFloat(r.entry_price) : r.entry_price;
      const completion = typeof r.completion_price === 'string' ? parseFloat(r.completion_price) : r.completion_price;
      if (!isFinite(entry) || !isFinite(completion) || entry === 0) continue;
      out.push({
        id: r.id,
        asset: r.asset,
        direction: r.direction,
        entryPrice: entry,
        completionPrice: completion,
        outcome: r.outcome === 'WIN' ? 'WIN' : 'LOSS',
      });
    }
    return out;
  }

  /**
   * Export only validated feature snapshots whose outcomes are known. This is
   * used for one-time model hydration after a fresh install or lost model file.
   */
  public getLabeledFeatureExamples(): Array<{ features: number[]; label: 1 | -1; asset?: string }> {
    if (!this.db) return [];
    const rows = this.db.prepare(
      `SELECT t.asset, t.ml_features, t.outcome
       FROM tracked_trades t
       LEFT JOIN signal_history s ON s.id = t.signal_id
       WHERE ${this.CLEAN_COMPLETED_TRADE_WHERE}
         AND t.outcome IN ('WIN', 'LOSS')
         AND t.ml_features IS NOT NULL
       ORDER BY t.completion_timestamp ASC` as string
    ).all() as Array<{ asset: string; ml_features: string; outcome: string }>;
    const examples: Array<{ features: number[]; label: 1 | -1; asset?: string }> = [];
    for (const row of rows) {
      try {
        const features = JSON.parse(row.ml_features);
        if (!Array.isArray(features) || features.length < 11) continue;
        const normalized = features.slice(0, 11);
        if (!normalized.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) continue;
        examples.push({ features: normalized, label: row.outcome === 'WIN' ? 1 : -1, asset: row.asset });
      } catch {
        // Ignore malformed historical snapshots rather than poisoning the model.
      }
    }
    return examples;
  }

  public getCalibrationObservations(): ImmutableTradeSnapshot[] {
    if (!this.db) return [];

    const rows = this.db.prepare(
      `SELECT
         t.*,
         s.evidence_summary,
         s.market_state,
         s.entry_context
       FROM tracked_trades t
       LEFT JOIN signal_history s ON s.id = t.signal_id
       WHERE ${this.CLEAN_COMPLETED_TRADE_WHERE}
       ORDER BY t.completion_timestamp ASC`
    ).all() as Array<{
      id: string;
      session_id: string;
      action: string;
      asset: string | null;
      expiry_seconds: number;
      confidence: number;
      entry_timestamp: number;
      completion_timestamp: number | null;
      outcome: string;
      original_reasons: string | null;
      evidence_summary: string | null;
      market_state: string | null;
      entry_context: string | null;
    }>;

    return rows.map(r => {
      let extra: Record<string, any> = {};
      let reasons: string[] = [];
      try {
        if (r.original_reasons && r.original_reasons.startsWith('[')) {
          const parsedReasons = JSON.parse(r.original_reasons);
          if (Array.isArray(parsedReasons)) reasons = parsedReasons.filter((x) => typeof x === 'string' && x.trim());
        } else if (r.original_reasons && r.original_reasons.startsWith('{')) {
          const parsed = JSON.parse(r.original_reasons);
          extra = { ...extra, ...parsed };
          if (Array.isArray(parsed.reasons)) reasons = parsed.reasons.filter((x: unknown) => typeof x === 'string' && x.trim());
        }
      } catch {}
      try {
        if (r.evidence_summary) {
          const evidence = JSON.parse(r.evidence_summary);
          extra.agreementScore = evidence.agreementScore ?? extra.agreementScore;
          extra.overallStrength = evidence.overallStrength ?? evidence.strength ?? extra.overallStrength;
          if (Array.isArray(evidence.reasons) && reasons.length === 0) {
            reasons = evidence.reasons.filter((x: unknown) => typeof x === 'string' && x.trim());
          }
        }
      } catch {}
      try {
        if (r.market_state) {
          const marketState = JSON.parse(r.market_state);
          extra.trend = marketState.trend ?? extra.trend;
          extra.structure = marketState.structure ?? extra.structure;
          extra.momentum = marketState.momentum ?? extra.momentum;
          extra.volatility = marketState.volatility ?? extra.volatility;
          extra.rsi = marketState.rsi ?? extra.rsi;
          extra.ema = marketState.ema ?? extra.ema;
          extra.bollinger = marketState.bollingerPercentB ?? extra.bollinger;
          extra.support = marketState.support ?? extra.support;
          extra.resistance = marketState.resistance ?? extra.resistance;
          extra.pattern = marketState.patterns ?? extra.pattern;
        }
      } catch {}

      return this.buildSnapshot({
        id: r.id,
        sessionId: r.session_id,
        asset: r.asset,
        direction: r.action as TradingAction,
        entryTimestamp: r.entry_timestamp,
        expirySeconds: r.expiry_seconds,
        completionTimestamp: r.completion_timestamp,
        result: r.outcome as TradeOutcome,
        confidence: r.confidence,
        reasons,
      }, extra);
    });
  }
}
