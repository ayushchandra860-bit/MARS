// ============================================================
// MARS PRO V3 — Canonical Analytics Engine
// Authoritative singleton for comprehensive trade analytics, decision replay,
// runtime integrity validation, performance stats, and CSV/JSON export.
// Uses CanonicalDataAccessLayer as the single data source of truth.
// ============================================================

import { Database } from '../database/Database';
import { CanonicalDataAccessLayer } from '../database/CanonicalDataAccessLayer';
import { CalibrationDatasetManager } from '../brain/CalibrationDatasetManager';
import { PerformanceStats, HistoryEntry } from '../../../shared/types/ipc';
import {
  CanonicalConfidence,
  CanonicalRisk,
} from '../../../shared/types/canonical';
import {
  formatConfidence,
  formatRisk,
  normalizeConfidenceToRatio,
} from '../../../shared/utils/formatters';

export interface ConfidenceBucketStats {
  bucket: string;
  minConf: number;
  maxConf: number;
  trades: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
}

export interface AssetAnalytics {
  asset: string;
  tradeCount: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  buyCount: number;
  sellCount: number;
  buyPercentage: number;
  sellPercentage: number;
}

export interface RegimeAnalytics {
  regime: string;
  tradeCount: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
}

export interface ReasonPerformance {
  reason: string;
  totalOccurrences: number;
  wins: number;
  losses: number;
  winRate: number;
}

export interface HourlyAnalytics {
  hour: number;
  hourLabel: string;
  tradeCount: number;
  wins: number;
  losses: number;
  winRate: number;
  avgConfidence: CanonicalConfidence;
}

export interface DecisionReplayRecord {
  tradeId: string;
  asset: string;
  direction: string;
  entryTimestamp: number;
  exitTimestamp: number | null;
  expirySeconds: number;
  durationSec: number | null;
  result: string;
  confidence: CanonicalConfidence;
  risk: CanonicalRisk;
  reasons: string[];
  marketRegime: string;
  entryPrice: string | null;
  completionPrice: string | null;
}

export interface RuntimeValidationReport {
  isValid: boolean;
  totalRecordsChecked: number;
  corruptRecordsCount: number;
  errors: string[];
  checkedAt: number;
}

export interface AutoBugReport {
  timestamp: number;
  failingConfidenceBuckets: string[];
  failingAssets: string[];
  failingRegimes: string[];
  worstReasons: string[];
  mostCommonInvalidations: string[];
  summary: string;
}

export interface ComprehensiveAnalyticsReport {
  totalTrades: number;
  overallWinRate: number;
  confidenceBuckets: ConfidenceBucketStats[];
  assetAnalytics: AssetAnalytics[];
  regimeAnalytics: RegimeAnalytics[];
  topReasons: ReasonPerformance[];
  hourlyAnalytics: HourlyAnalytics[];
  decisionReplay: DecisionReplayRecord[];
  autoBugReport: AutoBugReport;
  runtimeValidation: RuntimeValidationReport;
}

export class AnalyticsEngine {
  private static instance: AnalyticsEngine | null = null;
  private dal: CanonicalDataAccessLayer = CanonicalDataAccessLayer.getInstance();

  private constructor() {}

  public static getInstance(): AnalyticsEngine {
    if (!AnalyticsEngine.instance) {
      AnalyticsEngine.instance = new AnalyticsEngine();
    }
    return AnalyticsEngine.instance;
  }

  public setDatabase(db: Database): void {
    this.dal.setDatabase(db);
    CalibrationDatasetManager.getInstance().setDatabase(db);
  }

  // ----------------------------------------------------------
  // Authoritative Performance Stats (Pass-through to DAL)
  // ----------------------------------------------------------
  public getPerformanceStats(sessionId?: string, todayOnly?: boolean): PerformanceStats {
    return this.dal.getPerformanceStats(sessionId, todayOnly);
  }

  // ----------------------------------------------------------
  // Comprehensive Analytics Report
  // ----------------------------------------------------------
  // ----------------------------------------------------------
  // Direct Segment Accessors & Convenience Methods
  // ----------------------------------------------------------
  public getConfidenceAnalytics(sessionId?: string): ConfidenceBucketStats[] {
    return this.getComprehensiveReport(sessionId).confidenceBuckets;
  }

  public getAssetAnalytics(sessionId?: string): AssetAnalytics[] {
    return this.getComprehensiveReport(sessionId).assetAnalytics;
  }

  public getRegimeAnalytics(sessionId?: string): RegimeAnalytics[] {
    return this.getComprehensiveReport(sessionId).regimeAnalytics;
  }

  public getDecisionReplay(tradeId?: string, sessionId?: string): DecisionReplayRecord[] {
    const records = this.getComprehensiveReport(sessionId).decisionReplay;
    if (tradeId) {
      return records.filter((r) => r.tradeId === tradeId);
    }
    return records;
  }

  public runAutoBugDetector(options?: { minTradeCount?: number; minWinRate?: number } | string): AutoBugReport {
    const sessionId = typeof options === 'string' ? options : undefined;
    return this.getComprehensiveReport(sessionId).autoBugReport;
  }

  public exportAnalyticsCsv(): string {
    return this.exportCsv();
  }

  public exportAnalyticsJson(): string {
    return this.exportJson();
  }

  public getComprehensiveReport(sessionId?: string): ComprehensiveAnalyticsReport {
    const entries = this.dal.getJournalEntries(sessionId ? { sessionId } : {});
    const verifiedTradeIds = new Set(
      CalibrationDatasetManager.getInstance().getCalibrationObservations()
        .filter((snapshot) => !sessionId || snapshot.sessionId === sessionId)
        .map((snapshot) => snapshot.tradeId),
    );
    const completed = entries.filter((entry) => verifiedTradeIds.has(entry.id));

    const totalTrades = completed.length;
    const wins = completed.filter((e) => e.outcome === 'WIN').length;
    const losses = completed.filter((e) => e.outcome === 'LOSS').length;
    const overallWinRate = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;

    const confidenceBuckets = this.computeConfidenceBuckets(completed);
    const assetAnalytics = this.computeAssetAnalytics(completed);
    const regimeAnalytics = this.computeRegimeAnalytics(completed);
    const topReasons = this.computeReasonPerformance(completed);
    const hourlyAnalytics = this.computeHourlyAnalytics(completed);
    const decisionReplay = this.computeDecisionReplay(completed);
    const runtimeValidation = this.validateRuntimeIntegrity();
    const autoBugReport = this.generateAutoBugReport(confidenceBuckets, assetAnalytics, regimeAnalytics, topReasons);

    return {
      totalTrades,
      overallWinRate,
      confidenceBuckets,
      assetAnalytics,
      regimeAnalytics,
      topReasons,
      hourlyAnalytics,
      decisionReplay,
      autoBugReport,
      runtimeValidation,
    };
  }

  private computeConfidenceBuckets(trades: HistoryEntry[]): ConfidenceBucketStats[] {
    const bucketDefs = [
      { bucket: '40-49%', minConf: 0.40, maxConf: 0.499 },
      { bucket: '50-59%', minConf: 0.50, maxConf: 0.599 },
      { bucket: '60-69%', minConf: 0.60, maxConf: 0.699 },
      { bucket: '70-79%', minConf: 0.70, maxConf: 0.799 },
      { bucket: '80-89%', minConf: 0.80, maxConf: 0.899 },
      { bucket: '90-100%', minConf: 0.90, maxConf: 1.00 },
    ];

    return bucketDefs.map((b) => {
      const inBucket = trades.filter((t) => {
        if (t.confidence === null || t.confidence === undefined) return false;
        return t.confidence >= b.minConf && t.confidence <= b.maxConf;
      });

      const bWins = inBucket.filter((t) => t.outcome === 'WIN').length;
      const bLosses = inBucket.filter((t) => t.outcome === 'LOSS').length;
      const bDraws = inBucket.filter((t) => t.outcome === 'DRAW').length;
      const totalDecidable = bWins + bLosses;
      const winRate = totalDecidable > 0 ? Math.round((bWins / totalDecidable) * 100) : 0;

      return {
        bucket: b.bucket,
        minConf: b.minConf,
        maxConf: b.maxConf,
        trades: inBucket.length,
        wins: bWins,
        losses: bLosses,
        draws: bDraws,
        winRate,
      };
    });
  }

  private computeAssetAnalytics(trades: HistoryEntry[]): AssetAnalytics[] {
    const map = new Map<string, { wins: number; losses: number; draws: number; buys: number; sells: number }>();

    for (const t of trades) {
      const asset = t.asset || 'UNKNOWN';
      if (!map.has(asset)) {
        map.set(asset, { wins: 0, losses: 0, draws: 0, buys: 0, sells: 0 });
      }
      const stat = map.get(asset)!;
      if (t.outcome === 'WIN') stat.wins++;
      else if (t.outcome === 'LOSS') stat.losses++;
      else if (t.outcome === 'DRAW') stat.draws++;

      if (t.stabilizedDecision === 'BUY' || t.rawDecision === 'BUY') stat.buys++;
      else if (t.stabilizedDecision === 'SELL' || t.rawDecision === 'SELL') stat.sells++;
    }

    const results: AssetAnalytics[] = [];
    for (const [asset, s] of map.entries()) {
      const total = s.wins + s.losses + s.draws;
      const decidable = s.wins + s.losses;
      const winRate = decidable > 0 ? Math.round((s.wins / decidable) * 100) : 0;
      const totalDir = s.buys + s.sells;
      const buyPct = totalDir > 0 ? Math.round((s.buys / totalDir) * 100) : 50;
      const sellPct = 100 - buyPct;

      results.push({
        asset,
        tradeCount: total,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        winRate,
        buyCount: s.buys,
        sellCount: s.sells,
        buyPercentage: buyPct,
        sellPercentage: sellPct,
      });
    }

    // Sort by winRate descending, then tradeCount descending (best asset first!)
    results.sort((a, b) => b.winRate - a.winRate || b.tradeCount - a.tradeCount);
    return results;
  }

  private computeRegimeAnalytics(trades: HistoryEntry[]): RegimeAnalytics[] {
    const map = new Map<string, { wins: number; losses: number; draws: number }>();

    for (const t of trades) {
      const regime = t.marketRegime || 'UNKNOWN';
      if (!map.has(regime)) map.set(regime, { wins: 0, losses: 0, draws: 0 });
      const stat = map.get(regime)!;
      if (t.outcome === 'WIN') stat.wins++;
      else if (t.outcome === 'LOSS') stat.losses++;
      else if (t.outcome === 'DRAW') stat.draws++;
    }

    const results: RegimeAnalytics[] = [];
    for (const [regime, s] of map.entries()) {
      const total = s.wins + s.losses + s.draws;
      const decidable = s.wins + s.losses;
      const winRate = decidable > 0 ? Math.round((s.wins / decidable) * 100) : 0;

      results.push({
        regime,
        tradeCount: total,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        winRate,
      });
    }

    results.sort((a, b) => b.tradeCount - a.tradeCount);
    return results;
  }

  private computeReasonPerformance(trades: HistoryEntry[]): ReasonPerformance[] {
    const map = new Map<string, { wins: number; losses: number; total: number }>();

    for (const t of trades) {
      const reason = t.reason || 'No specific reason logged';
      if (!map.has(reason)) map.set(reason, { wins: 0, losses: 0, total: 0 });
      const stat = map.get(reason)!;
      stat.total++;
      if (t.outcome === 'WIN') stat.wins++;
      else if (t.outcome === 'LOSS') stat.losses++;
    }

    const results: ReasonPerformance[] = [];
    for (const [reason, s] of map.entries()) {
      const decidable = s.wins + s.losses;
      const winRate = decidable > 0 ? Math.round((s.wins / decidable) * 100) : 0;
      results.push({
        reason,
        totalOccurrences: s.total,
        wins: s.wins,
        losses: s.losses,
        winRate,
      });
    }

    results.sort((a, b) => b.totalOccurrences - a.totalOccurrences);
    return results.slice(0, 10);
  }

  private computeHourlyAnalytics(trades: HistoryEntry[]): HourlyAnalytics[] {
    const hours: HourlyAnalytics[] = [];

    for (let h = 0; h < 24; h++) {
      const hourTrades = trades.filter((t) => {
        const d = new Date(t.timestamp);
        return d.getHours() === h;
      });

      const hWins = hourTrades.filter((t) => t.outcome === 'WIN').length;
      const hLosses = hourTrades.filter((t) => t.outcome === 'LOSS').length;
      const decidable = hWins + hLosses;
      const winRate = decidable > 0 ? Math.round((hWins / decidable) * 100) : 0;

      let confSum = 0;
      let confCount = 0;
      for (const t of hourTrades) {
        if (t.confidence !== null && t.confidence !== undefined) {
          confSum += t.confidence;
          confCount++;
        }
      }

      hours.push({
        hour: h,
        hourLabel: `${h.toString().padStart(2, '0')}:00`,
        tradeCount: hourTrades.length,
        wins: hWins,
        losses: hLosses,
        winRate,
        avgConfidence: confCount > 0 ? confSum / confCount : null,
      });
    }

    return hours;
  }

  private computeDecisionReplay(trades: HistoryEntry[]): DecisionReplayRecord[] {
    return trades.map((t) => ({
      tradeId: t.id,
      asset: t.asset || 'UNKNOWN',
      direction: t.stabilizedDecision,
      entryTimestamp: t.timestamp,
      exitTimestamp: t.exitTimestamp || null,
      expirySeconds: t.durationSec || 60,
      durationSec: t.durationSec || null,
      result: t.outcome || 'UNRESOLVED',
      confidence: t.confidence,
      risk: t.risk,
      reasons: t.reason ? [t.reason] : [],
      marketRegime: t.marketRegime || 'UNKNOWN',
      entryPrice: t.entryPrice || null,
      completionPrice: t.exitPrice || null,
    }));
  }

  public validateRuntimeIntegrity(): RuntimeValidationReport {
    const db = this.dal.getDatabase();
    if (!db) {
      return {
        isValid: false,
        totalRecordsChecked: 0,
        corruptRecordsCount: 0,
        errors: ['Database connection unavailable for integrity verification'],
        checkedAt: Date.now(),
      };
    }

    try {
      const rows = db.prepare('SELECT * FROM tracked_trades').all() as any[];
      const errors: string[] = [];
      let corruptCount = 0;

      for (const row of rows) {
        if (!row.id || !row.session_id) {
          corruptCount++;
          errors.push(`Row missing primary keys: ${JSON.stringify(row)}`);
          continue;
        }

        if (row.status === 'COMPLETED' && (!row.outcome || row.outcome === 'UNRESOLVED')) {
          errors.push(`Trade ${row.id} marked COMPLETED without outcome`);
        }
      }

      return {
        isValid: corruptCount === 0,
        totalRecordsChecked: rows.length,
        corruptRecordsCount: corruptCount,
        errors,
        checkedAt: Date.now(),
      };
    } catch (err) {
      return {
        isValid: false,
        totalRecordsChecked: 0,
        corruptRecordsCount: 0,
        errors: [`Integrity check failed: ${(err as Error).message}`],
        checkedAt: Date.now(),
      };
    }
  }

  private generateAutoBugReport(
    buckets: ConfidenceBucketStats[],
    assets: AssetAnalytics[],
    regimes: RegimeAnalytics[],
    reasons: ReasonPerformance[]
  ): AutoBugReport {
    const failingBuckets = buckets.filter((b) => b.trades >= 5 && b.winRate < 45).map((b) => b.bucket);
    const failingAssets = assets.filter((a) => a.tradeCount >= 5 && a.winRate < 45).map((a) => a.asset);
    const failingRegimes = regimes.filter((r) => r.tradeCount >= 5 && r.winRate < 45).map((r) => r.regime);
    const worstReasons = reasons.filter((r) => r.totalOccurrences >= 5 && r.winRate < 40).map((r) => r.reason);

    const issues: string[] = [];
    if (failingBuckets.length > 0) issues.push(`Low win-rate confidence buckets: ${failingBuckets.join(', ')}`);
    if (failingAssets.length > 0) issues.push(`Underperforming assets: ${failingAssets.join(', ')}`);
    if (failingRegimes.length > 0) issues.push(`Problematic market regimes: ${failingRegimes.join(', ')}`);

    const summary = issues.length > 0 ? issues.join(' | ') : 'All active segments operating within expected parameters.';

    return {
      timestamp: Date.now(),
      failingConfidenceBuckets: failingBuckets,
      failingAssets,
      failingRegimes,
      worstReasons,
      mostCommonInvalidations: [],
      summary,
    };
  }

  public exportCsv(): string {
    const entries = this.dal.getJournalEntries();
    const headers = [
      'Trade ID',
      'Session ID',
      'Timestamp',
      'Date',
      'Asset',
      'Platform Mode',
      'Timeframe',
      'Direction',
      'Confidence',
      'Risk',
      'Regime',
      'Outcome',
      'Entry Price',
      'Exit Price',
      'Duration (sec)',
    ];

    const rows = entries.map((e) => [
      e.id,
      e.sessionId,
      e.timestamp,
      new Date(e.timestamp).toISOString(),
      e.asset || '',
      e.platformMode || '',
      e.timeframe || '',
      e.stabilizedDecision,
      formatConfidence(e.confidence),
      formatRisk(e.risk),
      e.marketRegime || '',
      e.outcome || '',
      e.entryPrice || '',
      e.exitPrice || '',
      e.durationSec ?? '',
    ]);

    return '\uFEFF' + [headers.join(','), ...rows.map((r) => r.map((cell) => `"${cell}"`).join(','))].join('\n');
  }

  public exportJson(): string {
    const report = this.getComprehensiveReport();
    return JSON.stringify(report, null, 2);
  }
}
