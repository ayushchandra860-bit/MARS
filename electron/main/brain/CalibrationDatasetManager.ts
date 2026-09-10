// ============================================================
// MARS PRO V3 — Calibration Dataset & Trade Journal Engine
// Only verified LIVE trades with complete price provenance are eligible.
// ============================================================

import { Database } from '../database/Database';
import { TradingAction, TradeOutcome, RiskLevel } from '../../../shared/types/decision';
import { PlatformMode } from '../../../shared/types/canonical';

export interface ImmutableTradeSnapshot {
  tradeId: string;
  sessionId: string;
  asset: string;
  direction: TradingAction;
  entryTimestamp: number;
  exitTimestamp: number;
  expirySeconds: number;
  result: TradeOutcome;
  platformMode: PlatformMode;
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
    AND t.platform_mode = 'LIVE'
    AND t.asset IS NOT NULL
    AND TRIM(t.asset) NOT IN ('', '▲', '▼', 'UNKNOWN')
    AND t.action IN ('BUY', 'SELL')
    AND t.signal_id IS NOT NULL
    AND t.entry_price IS NOT NULL
    AND t.completion_price IS NOT NULL
    AND CAST(t.entry_price AS REAL) > 0
    AND CAST(t.completion_price AS REAL) > 0
    AND (s.id IS NOT NULL OR t.signal_id LIKE 'manual-%' OR t.signal_id LIKE 'trade-%' OR t.signal_id LIKE 'signal-%')
  `;

  public buildSnapshot(trade: {
    id: string;
    sessionId: string;
    asset: string | null;
    direction: TradingAction;
    entryTimestamp: number;
    expirySeconds: number;
    completionTimestamp?: number | null;
    result?: TradeOutcome | null;
    platformMode?: PlatformMode;
    confidence?: number;
    reasons?: string[];
  }, extraFeatures?: Record<string, any>): ImmutableTradeSnapshot {
    const snapshot: ImmutableTradeSnapshot = {
      tradeId: trade.id,
      sessionId: trade.sessionId,
      asset: trade.asset?.trim() || 'UNKNOWN',
      direction: trade.direction,
      entryTimestamp: trade.entryTimestamp,
      exitTimestamp: trade.completionTimestamp ?? (trade.entryTimestamp + trade.expirySeconds * 1000),
      expirySeconds: trade.expirySeconds,
      result: trade.result ?? TradeOutcome.UNRESOLVED,
      platformMode: trade.platformMode ?? PlatformMode.UNKNOWN,
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
      pattern: Array.isArray(extraFeatures?.pattern) ? [...extraFeatures.pattern] : [],
      support: extraFeatures?.support ?? null,
      resistance: extraFeatures?.resistance ?? null,
      reasons: trade.reasons ? [...trade.reasons] : [],
      snapshotTimestamp: Date.now(),
    };
    return Object.freeze({
      ...snapshot,
      pattern: Object.freeze(snapshot.pattern) as unknown as string[],
      reasons: Object.freeze(snapshot.reasons) as unknown as string[],
    });
  }

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
      `SELECT t.outcome FROM tracked_trades t
       LEFT JOIN signal_history s ON s.id = t.signal_id
       WHERE ${this.CLEAN_COMPLETED_TRADE_WHERE}`
    ).all() as Array<{ outcome: string }>;
    const winningTrades = rows.filter((row) => row.outcome === 'WIN').length;
    const losingTrades = rows.filter((row) => row.outcome === 'LOSS').length;
    const drawTrades = rows.filter((row) => row.outcome === 'DRAW').length;
    const totalTrades = rows.length;

    let health: CalibrationDatasetHealth['health'] = 'INSUFFICIENT_DATA';
    let statusMessage = 'LEARNING ONLY (< 100 CLEAN LIVE OBSERVATIONS)';
    if (totalTrades >= 1000) {
      health = 'EXCELLENT';
      statusMessage = 'PRODUCTION CONFIDENCE DATASET (>= 1000 CLEAN LIVE OBSERVATIONS)';
    } else if (totalTrades >= 300) {
      health = 'EXCELLENT';
      statusMessage = 'STATISTICALLY RELIABLE (>= 300 CLEAN LIVE OBSERVATIONS)';
    } else if (totalTrades >= 100) {
      health = 'GOOD';
      statusMessage = 'CALIBRATION CANDIDATE (>= 100 CLEAN LIVE OBSERVATIONS)';
    }

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      drawTrades,
      datasetSize: totalTrades,
      health,
      statusMessage,
      isReadyForCalibration: totalTrades >= 100,
    };
  }

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
       ORDER BY t.completion_timestamp ASC`
    ).all() as Array<{
      id: string;
      asset: string;
      direction: string;
      entry_price: string | number;
      completion_price: string | number;
      outcome: string;
    }>;

    const output: ReturnType<CalibrationDatasetManager['getLabeledTrades']> = [];
    for (const row of rows) {
      const entryPrice = Number(row.entry_price);
      const completionPrice = Number(row.completion_price);
      if (!Number.isFinite(entryPrice) || entryPrice <= 0
        || !Number.isFinite(completionPrice) || completionPrice <= 0) continue;
      output.push({
        id: row.id,
        asset: row.asset,
        direction: row.direction,
        entryPrice,
        completionPrice,
        outcome: row.outcome === 'WIN' ? 'WIN' : 'LOSS',
      });
    }
    return output;
  }

  public getLabeledFeatureExamples(): Array<{ features: number[]; label: 1 | -1; asset?: string }> {
    if (!this.db) return [];
    const rows = this.db.prepare(
      `SELECT t.asset, t.ml_features, t.outcome
       FROM tracked_trades t
       LEFT JOIN signal_history s ON s.id = t.signal_id
       WHERE ${this.CLEAN_COMPLETED_TRADE_WHERE}
         AND t.outcome IN ('WIN', 'LOSS')
         AND t.ml_features IS NOT NULL
       ORDER BY t.completion_timestamp ASC`
    ).all() as Array<{ asset: string; ml_features: string; outcome: string }>;

    const examples: Array<{ features: number[]; label: 1 | -1; asset?: string }> = [];
    for (const row of rows) {
      try {
        const features = JSON.parse(row.ml_features);
        if (!Array.isArray(features) || features.length < 11) continue;
        const normalized = features.slice(0, 11);
        if (!normalized.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) continue;
        examples.push({
          features: normalized,
          label: row.outcome === 'WIN' ? 1 : -1,
          asset: row.asset,
        });
      } catch {
        // Corrupt historical snapshots are ignored rather than poisoning the model.
      }
    }
    return examples;
  }

  public getCalibrationObservations(): ImmutableTradeSnapshot[] {
    if (!this.db) return [];
    const rows = this.db.prepare(
      `SELECT t.*, s.evidence_summary, s.market_state, s.entry_context
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
      platform_mode: string | null;
      original_reasons: string | null;
      evidence_summary: string | null;
      market_state: string | null;
      entry_context: string | null;
    }>;

    return rows.map((row) => {
      let extra: Record<string, any> = {};
      let reasons: string[] = [];
      try {
        if (row.original_reasons?.startsWith('[')) {
          const parsed = JSON.parse(row.original_reasons);
          if (Array.isArray(parsed)) reasons = parsed.filter((value) => typeof value === 'string' && value.trim());
        } else if (row.original_reasons?.startsWith('{')) {
          const parsed = JSON.parse(row.original_reasons);
          extra = { ...extra, ...parsed };
          if (Array.isArray(parsed.reasons)) reasons = parsed.reasons.filter(
            (value: unknown) => typeof value === 'string' && value.trim(),
          );
        }
      } catch {}
      try {
        if (row.evidence_summary) {
          const evidence = JSON.parse(row.evidence_summary);
          extra.agreementScore = evidence.agreementScore ?? extra.agreementScore;
          extra.overallStrength = evidence.overallStrength ?? evidence.strength ?? extra.overallStrength;
          if (Array.isArray(evidence.reasons) && reasons.length === 0) {
            reasons = evidence.reasons.filter((value: unknown) => typeof value === 'string' && value.trim());
          }
        }
      } catch {}
      try {
        if (row.market_state) {
          const state = JSON.parse(row.market_state);
          extra.trend = state.trend ?? extra.trend;
          extra.structure = state.structure ?? extra.structure;
          extra.momentum = state.momentum ?? extra.momentum;
          extra.volatility = state.volatility ?? extra.volatility;
          extra.rsi = state.rsi ?? extra.rsi;
          extra.ema = state.ema ?? extra.ema;
          extra.bollinger = state.bollingerPercentB ?? extra.bollinger;
          extra.support = state.support ?? extra.support;
          extra.resistance = state.resistance ?? extra.resistance;
          extra.pattern = state.patterns ?? extra.pattern;
        }
      } catch {}

      return this.buildSnapshot({
        id: row.id,
        sessionId: row.session_id,
        asset: row.asset,
        direction: row.action as TradingAction,
        entryTimestamp: row.entry_timestamp,
        expirySeconds: row.expiry_seconds,
        completionTimestamp: row.completion_timestamp,
        result: row.outcome as TradeOutcome,
        platformMode: row.platform_mode as PlatformMode,
        confidence: row.confidence,
        reasons,
      }, extra);
    });
  }
}
