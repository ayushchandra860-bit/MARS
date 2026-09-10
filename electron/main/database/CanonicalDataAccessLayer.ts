// ============================================================
// MARS PRO V3 — Canonical Data Access Layer (Single Source of Truth)
// Unified SQL querying layer for Journal, History, Performance, and Analytics.
// Eliminates dual-source desync, uses LEFT JOINs to prevent dropped trades,
// and normalizes all metrics to canonical formats.
// ============================================================

import { Database } from './Database';
import {
  HistoryEntry,
  HistoryQuery,
  PerformanceStats,
} from '../../../shared/types/ipc';
import {
  TradingAction,
  RiskLevel,
  TradeOutcome,
} from '../../../shared/types/decision';
import { QualityLevel } from '../../../shared/types/scanner';
import {
  CanonicalConfidence,
  CanonicalRisk,
  PlatformMode,
} from '../../../shared/types/canonical';
import { normalizeConfidenceToRatio } from '../../../shared/utils/formatters';

export class CanonicalDataAccessLayer {
  private static instance: CanonicalDataAccessLayer | null = null;
  private db: Database | null = null;

  private constructor() {}

  public static getInstance(): CanonicalDataAccessLayer {
    if (!CanonicalDataAccessLayer.instance) {
      CanonicalDataAccessLayer.instance = new CanonicalDataAccessLayer();
    }
    return CanonicalDataAccessLayer.instance;
  }

  public setDatabase(db: Database): void {
    this.db = db;
  }

  public getDatabase(): Database | null {
    return this.db;
  }

  // ----------------------------------------------------------
  // 1. Unified Journal / History Query (Uses LEFT JOIN to prevent dropped records)
  // ----------------------------------------------------------
  public getJournalEntries(query: HistoryQuery = {}): HistoryEntry[] {
    if (!this.db) return [];

    try {
      const conditions: string[] = [
        "t.asset IS NOT NULL AND TRIM(t.asset) NOT IN ('', '▲', '▼', 'UNKNOWN')",
        "(s.id IS NOT NULL OR t.signal_id LIKE 'manual-%' OR t.signal_id LIKE 'trade-%' OR t.signal_id LIKE 'signal-%')"
      ];
      const params: any[] = [];

      if (query.sessionId) {
        conditions.push('(t.session_id = ? OR (t.session_id IS NULL AND s.session_id = ?))');
        params.push(query.sessionId, query.sessionId);
      }

      if (query.asset) {
        conditions.push('(t.asset = ? OR s.asset = ?)');
        params.push(query.asset, query.asset);
      }

      if (query.fromTimestamp) {
        conditions.push('(COALESCE(t.entry_timestamp, s.timestamp) >= ?)');
        params.push(query.fromTimestamp);
      }

      if (query.toTimestamp) {
        conditions.push('(COALESCE(t.entry_timestamp, s.timestamp) <= ?)');
        params.push(query.toTimestamp);
      }

      if (query.action) {
        conditions.push('(t.action = ? OR s.stabilized_decision = ?)');
        params.push(query.action, query.action);
      }

      if (query.outcome) {
        conditions.push('(t.outcome = ? OR s.outcome = ?)');
        params.push(query.outcome, query.outcome);
      }

      if (query.todayOnly) {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        conditions.push('(COALESCE(t.entry_timestamp, s.timestamp) >= ?)');
        params.push(startOfDay.getTime());
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limitClause = query.limit ? `LIMIT ${Math.max(1, query.limit)}` : 'LIMIT 500';
      const offsetClause = query.offset ? `OFFSET ${Math.max(0, query.offset)}` : '';

      // Primary query on tracked_trades with LEFT JOIN to signal_history
      const sql = `
        SELECT
          t.id AS trade_id,
          t.session_id AS session_id,
          t.signal_id AS signal_id,
          t.action AS action,
          t.asset AS asset,
          t.timeframe AS timeframe,
          t.confidence AS confidence,
          t.regime AS regime,
          t.entry_price AS entry_price,
          t.entry_timestamp AS entry_timestamp,
          t.expiry_timestamp AS expiry_timestamp,
          t.status AS status,
          t.outcome AS outcome,
          t.original_reasons AS original_reasons,
          t.completion_timestamp AS completion_timestamp,
          t.completion_price AS completion_price,
          t.platform_mode AS platform_mode,
          s.raw_decision AS raw_decision,
          s.stabilized_decision AS stabilized_decision,
          s.signal_strength AS signal_strength,
          s.risk AS risk,
          s.data_quality AS data_quality,
          s.stabilized_reason AS stabilized_reason,
          s.recommended_expiry AS recommended_expiry
        FROM tracked_trades t
        LEFT JOIN signal_history s ON s.id = t.signal_id
        ${whereClause}
        ORDER BY t.entry_timestamp DESC
        ${limitClause} ${offsetClause}
      `;

      const rows = this.db.prepare(sql).all(...params) as any[];

      return rows.map((r) => {
        let reasons: string[] = [];
        try {
          reasons = JSON.parse(r.original_reasons || '[]');
        } catch {
          reasons = [];
        }

        const rawConf = r.confidence !== null && r.confidence !== undefined ? r.confidence : null;
        const normalizedConf = normalizeConfidenceToRatio(rawConf);

        const durationSec = r.completion_timestamp && r.entry_timestamp
          ? Math.max(0, Math.round((r.completion_timestamp - r.entry_timestamp) / 1000))
          : null;

        return {
          id: r.trade_id,
          signalId: r.signal_id,
          sessionId: r.session_id,
          timestamp: r.entry_timestamp,
          asset: r.asset,
          platformMode: (r.platform_mode as PlatformMode) || null,
          timeframe: r.timeframe,
          rawDecision: (r.raw_decision as TradingAction) || (r.action as TradingAction),
          stabilizedDecision: (r.stabilized_decision as TradingAction) || (r.action as TradingAction),
          signalStrength: typeof r.signal_strength === 'number' ? r.signal_strength : 0.75,
          risk: (r.risk as CanonicalRisk) || null,
          dataQuality: (r.data_quality as QualityLevel) || QualityLevel.HIGH,
          reason: r.stabilized_reason || (reasons[0] ?? 'Executed trade'),
          recommendedExpiry: r.recommended_expiry || null,
          outcome: r.outcome,
          confidence: normalizedConf,
          marketRegime: r.regime,
          exitTimestamp: r.completion_timestamp,
          durationSec,
          entryPrice: r.entry_price,
          exitPrice: r.completion_price,
        };
      });
    } catch (err) {
      console.error('[CanonicalDAL] Error in getJournalEntries:', err);
      return [];
    }
  }

  // ----------------------------------------------------------
  // 2. Authoritative Performance Stats Calculation
  // ----------------------------------------------------------
  public getPerformanceStats(sessionId?: string, todayOnly?: boolean): PerformanceStats {
    if (!this.db) {
      return this.getEmptyPerformanceStats();
    }

    try {
      const conditions: string[] = [
        "status = 'COMPLETED'",
        "outcome IN ('WIN', 'LOSS', 'DRAW')",
        "asset IS NOT NULL AND TRIM(asset) NOT IN ('', '▲', '▼', 'UNKNOWN')"
      ];
      const params: any[] = [];

      if (sessionId) {
        conditions.push('session_id = ?');
        params.push(sessionId);
      }

      if (todayOnly) {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        conditions.push('entry_timestamp >= ?');
        params.push(startOfDay.getTime());
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;
      const sql = `SELECT * FROM tracked_trades ${whereClause} ORDER BY completion_timestamp ASC, entry_timestamp ASC`;
      const completedTrades = this.db.prepare(sql).all(...params) as any[];

      // Also get all-time completed trades if querying a session
      let allTimeTrades = completedTrades;
      if (sessionId || todayOnly) {
        allTimeTrades = this.db.prepare(
          "SELECT * FROM tracked_trades WHERE status = 'COMPLETED' AND outcome IN ('WIN', 'LOSS', 'DRAW') ORDER BY completion_timestamp ASC, entry_timestamp ASC"
        ).all() as any[];
      }

      // Active trade count
      const activeCountRow = this.db.prepare(
        "SELECT COUNT(*) as count FROM tracked_trades WHERE status IN ('ACTIVE', 'EXPIRING')"
      ).get() as { count: number } | undefined;
      const activeTradeCount = activeCountRow?.count ?? 0;

      // Calculate session / queried metrics
      let wins = 0;
      let losses = 0;
      let draws = 0;
      let buyWins = 0;
      let buyLosses = 0;
      let sellWins = 0;
      let sellLosses = 0;
      let totalDurationSec = 0;
      let durationCount = 0;
      let totalConfidenceSum = 0;
      let confidenceCount = 0;

      // Streaks
      let currentWinStreak = 0;
      let maxWinStreak = 0;
      let currentLossStreak = 0;
      let maxLossStreak = 0;

      const assetMap: Record<string, { wins: number; losses: number; draws: number }> = {};
      const byExpiryMap: Record<string, { wins: number; losses: number }> = {};

      for (const t of completedTrades) {
        const outcome = t.outcome;
        const action = t.action;
        const asset = t.asset || 'UNKNOWN';
        const expiryLabel = t.expiry_label || `${Math.round((t.expiry_seconds || 60) / 60)} min`;

        if (!assetMap[asset]) assetMap[asset] = { wins: 0, losses: 0, draws: 0 };
        if (!byExpiryMap[expiryLabel]) byExpiryMap[expiryLabel] = { wins: 0, losses: 0 };

        if (outcome === 'WIN') {
          wins++;
          assetMap[asset].wins++;
          byExpiryMap[expiryLabel].wins++;
          currentWinStreak++;
          currentLossStreak = 0;
          if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;

          if (action === 'BUY') buyWins++;
          else if (action === 'SELL') sellWins++;
        } else if (outcome === 'LOSS') {
          losses++;
          assetMap[asset].losses++;
          byExpiryMap[expiryLabel].losses++;
          currentLossStreak++;
          currentWinStreak = 0;
          if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;

          if (action === 'BUY') buyLosses++;
          else if (action === 'SELL') sellLosses++;
        } else if (outcome === 'DRAW') {
          draws++;
          assetMap[asset].draws++;
        }

        if (t.completion_timestamp && t.entry_timestamp && t.completion_timestamp > t.entry_timestamp) {
          totalDurationSec += Math.round((t.completion_timestamp - t.entry_timestamp) / 1000);
          durationCount++;
        }

        const normConf = normalizeConfidenceToRatio(t.confidence);
        if (normConf !== null) {
          totalConfidenceSum += normConf;
          confidenceCount++;
        }
      }

      // All-time wins / losses
      let allTimeWins = 0;
      let allTimeLosses = 0;
      for (const t of allTimeTrades) {
        if (t.outcome === 'WIN') allTimeWins++;
        else if (t.outcome === 'LOSS') allTimeLosses++;
      }

      const totalCompleted = completedTrades.length;
      const decidableTrades = wins + losses;
      const roundWinRate = (w: number, total: number) => total > 0 ? Math.round((w / total) * 1000) / 10 : 0;
      const sessionWinRate = roundWinRate(wins, decidableTrades);
      const allTimeDecidable = allTimeWins + allTimeLosses;
      const allTimeWinRate = roundWinRate(allTimeWins, allTimeDecidable);

      const buyDecidable = buyWins + buyLosses;
      const buyWinRate = roundWinRate(buyWins, buyDecidable);

      const sellDecidable = sellWins + sellLosses;
      const sellWinRate = roundWinRate(sellWins, sellDecidable);

      // Today win rate
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const todayTrades = allTimeTrades.filter((t) => t.entry_timestamp >= startOfDay.getTime());
      const todayWins = todayTrades.filter((t) => t.outcome === 'WIN').length;
      const todayLosses = todayTrades.filter((t) => t.outcome === 'LOSS').length;
      const todayDecidable = todayWins + todayLosses;
      const todayWinRate = roundWinRate(todayWins, todayDecidable);

      // Recent Form (last 10 completed trades)
      const recentForm: ('W' | 'L' | 'D')[] = completedTrades
        .slice(-10)
        .map((t) => (t.outcome === 'WIN' ? 'W' : t.outcome === 'LOSS' ? 'L' : 'D'));

      // Asset Stats Map & Accurate Best / Worst Asset Calculation
      const assetStatsMap: Record<string, { asset: string; wins: number; losses: number; draws: number; winRate: number; totalTrades: number }> = {};
      const eligibleAssets: Array<{ asset: string; winRate: number; totalTrades: number }> = [];

      for (const [asset, stat] of Object.entries(assetMap)) {
        const total = stat.wins + stat.losses + stat.draws;
        const decidable = stat.wins + stat.losses;
        const wr = decidable > 0 ? Math.round((stat.wins / decidable) * 100) : 0;
        assetStatsMap[asset] = {
          asset,
          wins: stat.wins,
          losses: stat.losses,
          draws: stat.draws,
          winRate: wr,
          totalTrades: total,
        };

        // Eligible for best/worst ranking: at least 2 trades (or 1 if total completed is small)
        if (total >= (totalCompleted >= 5 ? 2 : 1)) {
          eligibleAssets.push({ asset, winRate: wr, totalTrades: total });
        }
      }

      let bestAsset: { asset: string; winRate: number; totalTrades: number } | null = null;
      let worstAsset: { asset: string; winRate: number; totalTrades: number } | null = null;

      if (eligibleAssets.length > 0) {
        // Sort by winRate descending, then totalTrades descending
        eligibleAssets.sort((a, b) => b.winRate - a.winRate || b.totalTrades - a.totalTrades);
        bestAsset = eligibleAssets[0];
        worstAsset = eligibleAssets[eligibleAssets.length - 1];
      }

      // Raw Signal Counts from signal_history
      const signalCountsRow = this.db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN stabilized_decision = 'BUY' THEN 1 ELSE 0 END) as buy_count,
          SUM(CASE WHEN stabilized_decision = 'SELL' THEN 1 ELSE 0 END) as sell_count,
          SUM(CASE WHEN stabilized_decision = 'WAIT' THEN 1 ELSE 0 END) as wait_count,
          AVG(signal_strength) as avg_strength
        FROM signal_history
      `).get() as any;

      const totalSignals = signalCountsRow?.total ?? 0;
      const buyCount = signalCountsRow?.buy_count ?? 0;
      const sellCount = signalCountsRow?.sell_count ?? 0;
      const waitCount = signalCountsRow?.wait_count ?? 0;
      const avgSignalStrength = signalCountsRow?.avg_strength ?? 0.7;

      const avgConfidence: CanonicalConfidence = confidenceCount > 0 ? totalConfidenceSum / confidenceCount : null;
      const avgTradeDurationSec = durationCount > 0 ? Math.round(totalDurationSec / durationCount) : 60;

      return {
        totalCompleted,
        sessionWins: wins,
        sessionLosses: losses,
        sessionWinRate,
        allTimeWins,
        allTimeLosses,
        allTimeWinRate,
        activeTradeCount,
        recentForm,
        overallWinRate: allTimeWinRate,
        todayWinRate,
        buyWinRate,
        sellWinRate,
        currentWinningStreak: currentWinStreak,
        maxWinningStreak: maxWinStreak,
        currentLosingStreak: currentLossStreak,
        maxLosingStreak: maxLossStreak,
        avgTradeDurationSec,
        avgConfidence,
        avgRiskLevel: 'LOW',
        avgExpirySec: 60,
        bestAsset,
        worstAsset,
        assetStatsMap,
        byExpiry: byExpiryMap,
        byDirection: {
          buy: { wins: buyWins, losses: buyLosses },
          sell: { wins: sellWins, losses: sellLosses },
        },
        byAsset: Object.fromEntries(
          Object.entries(assetMap).map(([k, v]) => [k, { wins: v.wins, losses: v.losses }])
        ),
        totalSignals,
        buyCount,
        sellCount,
        waitCount,
        avgSignalStrength,
        signalsByRisk: {
          [RiskLevel.LOW]: 0,
          [RiskLevel.MEDIUM]: 0,
          [RiskLevel.HIGH]: 0,
        },
        hasOutcomeData: totalCompleted > 0,
        winCount: wins,
        lossCount: losses,
        drawCount: draws,
        insufficientData: totalCompleted === 0,
      };
    } catch (err) {
      console.error('[CanonicalDAL] Error in getPerformanceStats:', err);
      return this.getEmptyPerformanceStats();
    }
  }

  private getEmptyPerformanceStats(): PerformanceStats {
    return {
      totalCompleted: 0,
      sessionWins: 0,
      sessionLosses: 0,
      sessionWinRate: 0,
      allTimeWins: 0,
      allTimeLosses: 0,
      allTimeWinRate: 0,
      activeTradeCount: 0,
      recentForm: [],
      overallWinRate: 0,
      todayWinRate: 0,
      buyWinRate: 0,
      sellWinRate: 0,
      currentWinningStreak: 0,
      maxWinningStreak: 0,
      currentLosingStreak: 0,
      maxLosingStreak: 0,
      avgTradeDurationSec: 0,
      avgConfidence: null,
      avgRiskLevel: 'LOW',
      avgExpirySec: 60,
      bestAsset: null,
      worstAsset: null,
      assetStatsMap: {},
      byExpiry: {},
      byDirection: { buy: { wins: 0, losses: 0 }, sell: { wins: 0, losses: 0 } },
      byAsset: {},
      totalSignals: 0,
      buyCount: 0,
      sellCount: 0,
      waitCount: 0,
      avgSignalStrength: 0,
      signalsByRisk: {
        [RiskLevel.LOW]: 0,
        [RiskLevel.MEDIUM]: 0,
        [RiskLevel.HIGH]: 0,
      },
      hasOutcomeData: false,
      winCount: 0,
      lossCount: 0,
      drawCount: 0,
      insufficientData: true,
    };
  }
}
