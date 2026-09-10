// ============================================================
// MARS PRO V3 — Clean LIVE calibration dataset
// ============================================================

import { Database } from '../database/Database';
import { TradingAction, TradeOutcome, RiskLevel } from '../../../shared/types/decision';
import { PlatformMode } from '../../../shared/types/canonical';
import { FeatureVector } from '../decision/MLEngine';

export interface ImmutableTradeSnapshot {
  tradeId: string; sessionId: string; asset: string; direction: TradingAction;
  entryTimestamp: number; exitTimestamp: number; expirySeconds: number;
  result: TradeOutcome; platformMode: PlatformMode; confidence: number | null;
  agreementScore: number | null; overallStrength: number | null; risk: RiskLevel;
  trend: string; structure: string; momentum: string; volatility: string;
  marketRegime: string; rsi: number; ema: number; bollinger: number;
  pattern: string[]; support: number | null; resistance: number | null;
  reasons: string[]; snapshotTimestamp: number;
}
export interface CalibrationDatasetHealth {
  totalTrades: number; winningTrades: number; losingTrades: number; drawTrades: number;
  datasetSize: number; health: 'EXCELLENT' | 'GOOD' | 'INSUFFICIENT_DATA';
  statusMessage: string; isReadyForCalibration: boolean;
}

export class CalibrationDatasetManager {
  private static instance: CalibrationDatasetManager | null = null;
  private db: Database | null = null;
  private constructor() {}
  public static getInstance(): CalibrationDatasetManager {
    if (!this.instance) this.instance = new CalibrationDatasetManager();
    return this.instance;
  }
  public setDatabase(db: Database): void { this.db = db; }

  private readonly CLEAN_COMPLETED_TRADE_WHERE = `t.status = 'COMPLETED'
    AND t.outcome IN ('WIN', 'LOSS', 'DRAW') AND t.platform_mode = 'LIVE'
    AND t.asset IS NOT NULL AND TRIM(t.asset) NOT IN ('', '▲', '▼', 'UNKNOWN')
    AND t.action IN ('BUY', 'SELL') AND t.signal_id IS NOT NULL
    AND t.entry_price IS NOT NULL AND t.completion_price IS NOT NULL
    AND CAST(t.entry_price AS REAL) > 0 AND CAST(t.completion_price AS REAL) > 0
    AND (s.id IS NOT NULL OR t.signal_id LIKE 'manual-%' OR t.signal_id LIKE 'trade-%' OR t.signal_id LIKE 'signal-%')`;

  public buildSnapshot(trade: {
    id: string; sessionId: string; asset: string | null; direction: TradingAction;
    entryTimestamp: number; expirySeconds: number; completionTimestamp?: number | null;
    result?: TradeOutcome | null; platformMode?: PlatformMode; confidence?: number; reasons?: string[];
  }, extra: Record<string, any> = {}): ImmutableTradeSnapshot {
    const snapshot: ImmutableTradeSnapshot = {
      tradeId: trade.id, sessionId: trade.sessionId, asset: trade.asset?.trim() || 'UNKNOWN',
      direction: trade.direction, entryTimestamp: trade.entryTimestamp,
      exitTimestamp: trade.completionTimestamp ?? trade.entryTimestamp + trade.expirySeconds * 1000,
      expirySeconds: trade.expirySeconds, result: trade.result ?? TradeOutcome.UNRESOLVED,
      platformMode: trade.platformMode ?? PlatformMode.UNKNOWN, confidence: trade.confidence ?? null,
      agreementScore: extra.agreementScore ?? null, overallStrength: extra.overallStrength ?? null,
      risk: extra.risk || RiskLevel.MEDIUM, trend: extra.trend || 'NEUTRAL',
      structure: extra.structure || 'UNKNOWN', momentum: extra.momentum || 'NEUTRAL',
      volatility: extra.volatility || 'NORMAL', marketRegime: extra.marketRegime || 'UNKNOWN',
      rsi: extra.rsi ?? 50, ema: extra.ema ?? 0, bollinger: extra.bollinger ?? 0.5,
      pattern: Array.isArray(extra.pattern) ? [...extra.pattern] : [], support: extra.support ?? null,
      resistance: extra.resistance ?? null, reasons: trade.reasons ? [...trade.reasons] : [],
      snapshotTimestamp: Date.now(),
    };
    return Object.freeze({ ...snapshot, pattern: Object.freeze(snapshot.pattern) as any, reasons: Object.freeze(snapshot.reasons) as any });
  }

  private cleanRows(select: string, extraWhere = '', order = ''): any[] {
    if (!this.db) return [];
    return this.db.prepare(`${select} FROM tracked_trades t LEFT JOIN signal_history s ON s.id = t.signal_id
      WHERE ${this.CLEAN_COMPLETED_TRADE_WHERE} ${extraWhere} ${order}`).all() as any[];
  }

  public getCalibrationHealth(): CalibrationDatasetHealth {
    const rows = this.cleanRows('SELECT t.outcome');
    const winningTrades = rows.filter((row) => row.outcome === 'WIN').length;
    const losingTrades = rows.filter((row) => row.outcome === 'LOSS').length;
    const drawTrades = rows.filter((row) => row.outcome === 'DRAW').length;
    const totalTrades = rows.length;
    let health: CalibrationDatasetHealth['health'] = 'INSUFFICIENT_DATA';
    let statusMessage = 'LEARNING ONLY (< 100 CLEAN LIVE OBSERVATIONS)';
    if (totalTrades >= 1000) { health = 'EXCELLENT'; statusMessage = 'PRODUCTION CONFIDENCE DATASET (>= 1000 CLEAN LIVE OBSERVATIONS)'; }
    else if (totalTrades >= 300) { health = 'EXCELLENT'; statusMessage = 'STATISTICALLY RELIABLE (>= 300 CLEAN LIVE OBSERVATIONS)'; }
    else if (totalTrades >= 100) { health = 'GOOD'; statusMessage = 'CALIBRATION CANDIDATE (>= 100 CLEAN LIVE OBSERVATIONS)'; }
    return { totalTrades, winningTrades, losingTrades, drawTrades, datasetSize: totalTrades, health, statusMessage, isReadyForCalibration: totalTrades >= 100 };
  }

  public getLabeledTrades(): Array<{ id: string; asset: string; direction: string; entryPrice: number; completionPrice: number; outcome: 'WIN' | 'LOSS' }> {
    const rows = this.cleanRows(
      'SELECT t.id, t.asset, t.action direction, t.entry_price, t.completion_price, t.outcome',
      "AND t.outcome IN ('WIN', 'LOSS')", 'ORDER BY t.completion_timestamp ASC',
    );
    return rows.map((row) => ({ id: row.id, asset: row.asset, direction: row.direction,
      entryPrice: Number(row.entry_price), completionPrice: Number(row.completion_price),
      outcome: row.outcome === 'WIN' ? 'WIN' as const : 'LOSS' as const }));
  }

  public getLabeledFeatureExamples(): FeatureVector[] {
    const rows = this.cleanRows(
      'SELECT t.asset, t.action, t.ml_features, t.outcome',
      "AND t.outcome IN ('WIN', 'LOSS') AND t.ml_features IS NOT NULL",
      'ORDER BY t.completion_timestamp ASC',
    );
    const examples: FeatureVector[] = [];
    for (const row of rows) {
      try {
        const features = JSON.parse(row.ml_features);
        if (!Array.isArray(features) || features.length < 11 || !features.slice(0, 11).every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) continue;
        examples.push({ features: features.slice(0, 11), label: row.outcome === 'WIN' ? 1 : -1,
          action: row.action as TradingAction.BUY | TradingAction.SELL, asset: row.asset });
      } catch {}
    }
    return examples;
  }

  public getCalibrationObservations(): ImmutableTradeSnapshot[] {
    const rows = this.cleanRows('SELECT t.*, s.evidence_summary, s.market_state, s.entry_context', '', 'ORDER BY t.completion_timestamp ASC');
    return rows.map((row) => {
      const extra: Record<string, any> = {};
      let reasons: string[] = [];
      try {
        const parsed = JSON.parse(row.original_reasons || '[]');
        if (Array.isArray(parsed)) reasons = parsed.filter((value) => typeof value === 'string' && value.trim());
        else if (parsed && typeof parsed === 'object') { Object.assign(extra, parsed); if (Array.isArray(parsed.reasons)) reasons = parsed.reasons; }
      } catch {}
      try {
        const evidence = JSON.parse(row.evidence_summary || '{}');
        extra.agreementScore = evidence.agreementScore ?? extra.agreementScore;
        extra.overallStrength = evidence.overallStrength ?? evidence.strength ?? extra.overallStrength;
        if (!reasons.length && Array.isArray(evidence.reasons)) reasons = evidence.reasons;
      } catch {}
      try {
        const state = JSON.parse(row.market_state || '{}');
        Object.assign(extra, {
          trend: state.trend, structure: state.structure, momentum: state.momentum,
          volatility: state.volatility, rsi: state.rsi, ema: state.ema,
          bollinger: state.bollingerPercentB, support: state.support,
          resistance: state.resistance, pattern: state.patterns,
        });
      } catch {}
      return this.buildSnapshot({
        id: row.id, sessionId: row.session_id, asset: row.asset, direction: row.action,
        entryTimestamp: row.entry_timestamp, expirySeconds: row.expiry_seconds,
        completionTimestamp: row.completion_timestamp, result: row.outcome,
        platformMode: row.platform_mode, confidence: row.confidence, reasons,
      }, extra);
    });
  }
}
