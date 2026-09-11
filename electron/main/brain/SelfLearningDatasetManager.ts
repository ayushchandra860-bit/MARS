// ============================================================
// MARS PRO V3 — Verified self-learning dataset and quality audit
// No fabricated assets, prices, confidence, labels, or market features.
// ============================================================

import { Database } from '../database/Database';
import { TradingAction, TradeOutcome, RiskLevel } from '../../../shared/types/decision';
import { APP_VERSION } from '../../../shared/version';

export interface CompleteLearningRecord {
  tradeId: string;
  asset: string;
  direction: TradingAction;
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  expirySeconds: number;
  result: TradeOutcome.WIN | TradeOutcome.LOSS;
  /** Canonical ratio scale, 0..1; null means unavailable. */
  confidence: number | null;
  agreementScore: number | null;
  overallStrength: number | null;
  risk: RiskLevel | null;
  trend: string | null;
  structure: string | null;
  momentum: string | null;
  volatility: string | null;
  marketRegime: string | null;
  rsi: number | null;
  ema: number | null;
  bollinger: number | null;
  patterns: string[];
  support: number | null;
  resistance: number | null;
  reasons: string[];
  mlFeatures: number[] | null;
  decisionTrace: string;
  outcomeTrace: string;
  runtimeMetadata: { sessionId: string; version: string; validatedAt: number };
}

export interface DataQualityAuditReport {
  totalRecordsChecked: number;
  validRecordsCount: number;
  repairedRecordsCount: number;
  corruptRecordsCount: number;
  anomaliesDetected: {
    duplicateIds: string[]; missingOutcomes: string[]; invalidTimestamps: string[];
    impossibleConfidence: string[]; negativeDurations: string[]; invalidPrices: string[];
    corruptSnapshots: string[];
  };
  repairedAt: number;
}

export interface ModelReadinessScore {
  readinessScorePct: number; datasetQualityPct: number; featureCompletenessPct: number;
  labelQualityPct: number; noiseLevelPct: number; missingValuesPct: number;
  consistencyPct: number; sampleCount: number;
  readinessStatus: 'EXCELLENT' | 'GOOD' | 'MODERATE' | 'INSUFFICIENT_SAMPLES';
  recommendations: string[];
}

export interface ReplayValidationResult {
  tradeId: string; asset: string; direction: string; matchedDecision: boolean;
  matchedEntry: boolean; matchedCountdown: boolean; matchedExit: boolean;
  matchedOutcome: boolean; matchedStoredResult: boolean; isValidReplay: boolean;
  validationError?: string;
}

function finitePositive(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function canonicalConfidence(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  if (value <= 1) return value;
  if (value <= 100) return value / 100;
  return null;
}

function finiteRatio(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function finiteValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export class SelfLearningDatasetManager {
  private static instance: SelfLearningDatasetManager | null = null;
  private db: Database | null = null;
  private constructor() {}

  public static getInstance(): SelfLearningDatasetManager {
    if (!this.instance) this.instance = new SelfLearningDatasetManager();
    return this.instance;
  }
  public setDatabase(db: Database): void { this.db = db; }

  public getCompleteLearningRecords(): CompleteLearningRecord[] {
    if (!this.db) return [];
    const rows = this.db.prepare(`SELECT t.* FROM tracked_trades t
      LEFT JOIN signal_history s ON s.id = t.signal_id
      WHERE t.status = 'COMPLETED' AND t.outcome IN ('WIN', 'LOSS')
        AND t.platform_mode = 'LIVE' AND t.action IN ('BUY', 'SELL')
        AND t.asset IS NOT NULL AND TRIM(t.asset) NOT IN ('', 'UNKNOWN', '▲', '▼')
        AND t.signal_id IS NOT NULL
        AND t.entry_price IS NOT NULL AND CAST(t.entry_price AS REAL) > 0
        AND t.completion_price IS NOT NULL AND CAST(t.completion_price AS REAL) > 0
        AND t.completion_timestamp IS NOT NULL AND t.completion_timestamp >= t.entry_timestamp
        AND (s.id IS NOT NULL OR t.signal_id LIKE 'manual-%' OR t.signal_id LIKE 'trade-%' OR t.signal_id LIKE 'signal-%')
      ORDER BY t.completion_timestamp ASC`).all() as any[];

    const records: CompleteLearningRecord[] = [];
    for (const row of rows) {
      const entryPrice = finitePositive(row.entry_price);
      const exitPrice = finitePositive(row.completion_price);
      if (entryPrice === null || exitPrice === null) continue;

      let extra: Record<string, unknown> = {};
      let reasons: string[] = [];
      try {
        const parsed = JSON.parse(row.original_reasons || '[]');
        if (Array.isArray(parsed)) reasons = parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
        else if (parsed && typeof parsed === 'object') {
          extra = parsed as Record<string, unknown>;
          if (Array.isArray(extra.reasons)) reasons = extra.reasons.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
        }
      } catch {}

      let mlFeatures: number[] | null = null;
      try {
        const parsed = JSON.parse(row.ml_features || 'null');
        if (Array.isArray(parsed) && parsed.length >= 11 && parsed.slice(0, 11).every((value) => typeof value === 'number' && Number.isFinite(value))) {
          mlFeatures = parsed.slice(0, 11);
        }
      } catch {}

      const patterns = Array.isArray(extra.pattern)
        ? extra.pattern.filter((item): item is string => typeof item === 'string')
        : [];
      const confidence = canonicalConfidence(row.confidence);
      const marketRegime = typeof extra.marketRegime === 'string' && extra.marketRegime.trim() ? extra.marketRegime : null;
      records.push(Object.freeze({
        tradeId: row.id,
        asset: String(row.asset).trim(),
        direction: row.action as TradingAction,
        entryPrice,
        exitPrice,
        entryTime: row.entry_timestamp,
        exitTime: row.completion_timestamp,
        expirySeconds: row.expiry_seconds,
        result: row.outcome as TradeOutcome.WIN | TradeOutcome.LOSS,
        confidence,
        agreementScore: finiteRatio(extra.agreementScore),
        overallStrength: finiteRatio(extra.overallStrength),
        risk: Object.values(RiskLevel).includes(extra.risk as RiskLevel) ? extra.risk as RiskLevel : null,
        trend: typeof extra.trend === 'string' ? extra.trend : null,
        structure: typeof extra.structure === 'string' ? extra.structure : null,
        momentum: typeof extra.momentum === 'string' ? extra.momentum : null,
        volatility: typeof extra.volatility === 'string' ? extra.volatility : null,
        marketRegime,
        rsi: finiteValue(extra.rsi),
        ema: finiteValue(extra.ema),
        bollinger: finiteValue(extra.bollinger),
        patterns: Object.freeze(patterns) as unknown as string[],
        support: finiteValue(extra.support),
        resistance: finiteValue(extra.resistance),
        reasons: Object.freeze(reasons) as unknown as string[],
        mlFeatures: mlFeatures ? Object.freeze(mlFeatures) as unknown as number[] : null,
        decisionTrace: `Decision:${row.action}|Confidence:${confidence ?? 'UNAVAILABLE'}|Regime:${marketRegime ?? 'UNAVAILABLE'}`,
        outcomeTrace: `Outcome:${row.outcome}|EntryPx:${entryPrice}|ExitPx:${exitPrice}`,
        runtimeMetadata: Object.freeze({ sessionId: row.session_id, version: APP_VERSION, validatedAt: Date.now() }),
      }));
    }
    return records;
  }

  public auditAndRepairDataQuality(): DataQualityAuditReport {
    const emptyAnomalies = {
      duplicateIds: [] as string[], missingOutcomes: [] as string[], invalidTimestamps: [] as string[],
      impossibleConfidence: [] as string[], negativeDurations: [] as string[], invalidPrices: [] as string[],
      corruptSnapshots: [] as string[],
    };
    if (!this.db) return { totalRecordsChecked: 0, validRecordsCount: 0, repairedRecordsCount: 0, corruptRecordsCount: 0, anomaliesDetected: emptyAnomalies, repairedAt: Date.now() };

    const rows = this.db.prepare('SELECT * FROM tracked_trades').all() as any[];
    const anomalies = emptyAnomalies;
    const seen = new Set<string>();
    let repairedRecordsCount = 0;
    const repaired = new Set<string>();
    const now = Date.now();
    const repair = (id: string, sql: string, ...params: unknown[]) => {
      this.db!.prepare(sql).run(...params, id);
      if (!repaired.has(id)) { repaired.add(id); repairedRecordsCount++; }
    };

    this.db.transaction(() => {
      for (const row of rows) {
        if (seen.has(row.id)) anomalies.duplicateIds.push(row.id); else seen.add(row.id);
        if (row.status === 'COMPLETED' && !['WIN', 'LOSS', 'DRAW'].includes(row.outcome)) {
          anomalies.missingOutcomes.push(row.id);
          repair(row.id, "UPDATE tracked_trades SET status = 'CANCELLED', outcome = NULL WHERE id = ?");
        }
        if (!Number.isFinite(row.entry_timestamp) || row.entry_timestamp <= 0 || row.entry_timestamp > now + 3_600_000) {
          anomalies.invalidTimestamps.push(row.id);
          repair(row.id, "UPDATE tracked_trades SET status = 'CANCELLED', outcome = NULL WHERE id = ?");
        }
        if (row.confidence !== null && (typeof row.confidence !== 'number' || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1)) {
          anomalies.impossibleConfidence.push(row.id);
          const normalized = canonicalConfidence(row.confidence);
          repair(row.id, 'UPDATE tracked_trades SET confidence = ? WHERE id = ?', normalized);
        }
        if (row.completion_timestamp !== null && row.completion_timestamp < row.entry_timestamp) {
          anomalies.negativeDurations.push(row.id);
          repair(row.id, "UPDATE tracked_trades SET status = 'CANCELLED', outcome = NULL WHERE id = ?");
        }
        const entry = row.entry_price === null ? null : finitePositive(row.entry_price);
        const exit = row.completion_price === null ? null : finitePositive(row.completion_price);
        if ((row.entry_price !== null && entry === null) || (row.completion_price !== null && exit === null)) {
          anomalies.invalidPrices.push(row.id);
          repair(row.id, "UPDATE tracked_trades SET status = 'CANCELLED', outcome = NULL WHERE id = ?");
        }
        if (row.original_reasons) {
          try { JSON.parse(row.original_reasons); }
          catch {
            anomalies.corruptSnapshots.push(row.id);
            repair(row.id, "UPDATE tracked_trades SET original_reasons = '[]' WHERE id = ?");
          }
        }
      }
    });

    const corruptIds = new Set([
      ...anomalies.duplicateIds, ...anomalies.missingOutcomes, ...anomalies.invalidTimestamps,
      ...anomalies.impossibleConfidence, ...anomalies.negativeDurations, ...anomalies.invalidPrices,
      ...anomalies.corruptSnapshots,
    ]);
    return {
      totalRecordsChecked: rows.length,
      validRecordsCount: Math.max(0, rows.length - corruptIds.size),
      repairedRecordsCount,
      corruptRecordsCount: corruptIds.size,
      anomaliesDetected: anomalies,
      repairedAt: now,
    };
  }

  public validateTradeReplay(tradeId?: string): ReplayValidationResult {
    const unavailable = (message: string): ReplayValidationResult => ({
      tradeId: tradeId || 'none', asset: 'UNKNOWN', direction: 'NONE', matchedDecision: false,
      matchedEntry: false, matchedCountdown: false, matchedExit: false, matchedOutcome: false,
      matchedStoredResult: false, isValidReplay: false, validationError: message,
    });
    if (!this.db) return unavailable('Database uninitialized');
    const row = tradeId
      ? this.db.prepare('SELECT * FROM tracked_trades WHERE id = ?').get(tradeId) as any
      : this.db.prepare("SELECT * FROM tracked_trades WHERE status = 'COMPLETED' AND outcome IN ('WIN','LOSS','DRAW') ORDER BY completion_timestamp DESC LIMIT 1").get() as any;
    if (!row) return unavailable('Trade record not found for replay');

    const matchedDecision = [TradingAction.BUY, TradingAction.SELL].includes(row.action);
    const matchedEntry = Number.isFinite(row.entry_timestamp) && row.entry_timestamp > 0 && finitePositive(row.entry_price) !== null;
    const matchedCountdown = Number.isFinite(row.expiry_seconds) && row.expiry_seconds > 0;
    const matchedExit = Number.isFinite(row.completion_timestamp)
      && row.completion_timestamp >= row.entry_timestamp
      && finitePositive(row.completion_price) !== null;
    const matchedOutcome = [TradeOutcome.WIN, TradeOutcome.LOSS, TradeOutcome.DRAW].includes(row.outcome);
    const matchedStoredResult = row.status === 'COMPLETED';
    return {
      tradeId: row.id,
      asset: typeof row.asset === 'string' && row.asset.trim() ? row.asset.trim() : 'UNKNOWN',
      direction: row.action,
      matchedDecision,
      matchedEntry,
      matchedCountdown,
      matchedExit,
      matchedOutcome,
      matchedStoredResult,
      isValidReplay: matchedDecision && matchedEntry && matchedCountdown && matchedExit && matchedOutcome && matchedStoredResult,
    };
  }

  public getModelReadinessScore(): ModelReadinessScore {
    const records = this.getCompleteLearningRecords();
    const sampleCount = records.length;
    if (sampleCount === 0) return {
      readinessScorePct: 0, datasetQualityPct: 0, featureCompletenessPct: 0,
      labelQualityPct: 0, noiseLevelPct: 100, missingValuesPct: 100,
      consistencyPct: 0, sampleCount: 0, readinessStatus: 'INSUFFICIENT_SAMPLES',
      recommendations: ['Accumulate at least 100 verified LIVE, price-complete BUY/SELL outcomes.'],
    };

    const featureComplete = records.filter((record) => record.mlFeatures?.length === 11 && record.confidence !== null).length;
    const labelComplete = records.filter((record) => record.result === TradeOutcome.WIN || record.result === TradeOutcome.LOSS).length;
    const canonicalConfidenceCount = records.filter((record) => record.confidence !== null && record.confidence >= 0 && record.confidence <= 1).length;
    const wins = records.filter((record) => record.result === TradeOutcome.WIN).length;
    const losses = records.filter((record) => record.result === TradeOutcome.LOSS).length;

    const featureCompletenessPct = Math.round(featureComplete / sampleCount * 100);
    const labelQualityPct = Math.round(labelComplete / sampleCount * 100);
    const noiseLevelPct = Math.round((1 - canonicalConfidenceCount / sampleCount) * 100);
    const missingValuesPct = 100 - featureCompletenessPct;
    const classDiversityPct = wins > 0 && losses > 0 ? Math.round(Math.min(wins, losses) / Math.max(wins, losses) * 100) : 0;
    const datasetQualityPct = Math.round(featureCompletenessPct * 0.45 + labelQualityPct * 0.25 + (100 - noiseLevelPct) * 0.15 + classDiversityPct * 0.15);
    const sampleFactor = sampleCount >= 1000 ? 1 : sampleCount >= 300 ? 0.85 : sampleCount >= 100 ? 0.65 : sampleCount / 200;
    const readinessScorePct = Math.round(datasetQualityPct * sampleFactor);
    const consistencyPct = Math.round((labelQualityPct + classDiversityPct + featureCompletenessPct) / 3);
    const recommendations: string[] = [];
    let readinessStatus: ModelReadinessScore['readinessStatus'] = 'INSUFFICIENT_SAMPLES';

    if (sampleCount < 100 || Math.min(wins, losses) < 10) {
      recommendations.push(`Need >=100 clean samples and >=10 examples per class (current ${wins} WIN / ${losses} LOSS).`);
    } else if (readinessScorePct >= 80) {
      readinessStatus = 'EXCELLENT';
      recommendations.push('Dataset is suitable for quality-gated offline model evaluation.');
    } else if (readinessScorePct >= 60) {
      readinessStatus = 'GOOD';
      recommendations.push('Dataset can support guarded calibration; continue collecting complete feature snapshots.');
    } else {
      readinessStatus = 'MODERATE';
      recommendations.push('Feature completeness or class balance is too weak for production model influence.');
    }

    return { readinessScorePct, datasetQualityPct, featureCompletenessPct, labelQualityPct,
      noiseLevelPct, missingValuesPct, consistencyPct, sampleCount, readinessStatus, recommendations };
  }
}
