// ============================================================
// MARS PRO V3 — Searchable Knowledge Base Repository (Task 4)
// Searchable dataset store for offline AI training and historical signal lookup.
// Connects verified signals, trades, outcomes, technical indicators, and price behaviour.
// ============================================================

import { Database } from '../database/Database';

export interface KnowledgeItem {
  signalId: string;
  timestamp: number;
  asset: string;
  timeframe: string;
  direction: string;
  confidence: number;
  outcome: string;
  marketRegime: string;
  reasons: string[];
  trend: string;
  momentum: string;
  structure: string;
  volatility: string;
  rsi: number | null;
  ema: number | null;
  bollinger: number | null;
  support: number | null;
  resistance: number | null;
  entryPrice: number | null;
  expiryPrice: number | null;
  priceDifference: number | null;
  tradeExecuted: boolean;
  tradeId?: string | null;
  tradeOutcome?: string | null;
}

export interface KnowledgeQueryOptions {
  asset?: string;
  regime?: string;
  outcome?: string;
  minConfidence?: number;
  limit?: number;
}

export class KnowledgeBaseRepository {
  private static instance: KnowledgeBaseRepository | null = null;
  private db: Database | null = null;

  private constructor() {}

  public static getInstance(): KnowledgeBaseRepository {
    if (!KnowledgeBaseRepository.instance) {
      KnowledgeBaseRepository.instance = new KnowledgeBaseRepository();
    }
    return KnowledgeBaseRepository.instance;
  }

  public setDatabase(db: Database): void {
    this.db = db;
  }

  public searchKnowledgeBase(options: KnowledgeQueryOptions = {}): KnowledgeItem[] {
    if (!this.db) return [];

    let sql = `SELECT * FROM signal_history WHERE outcome IS NOT NULL`;
    const params: any[] = [];

    if (options.asset) {
      sql += ` AND UPPER(asset) = UPPER(?)`;
      params.push(options.asset);
    }
    if (options.regime) {
      sql += ` AND UPPER(market_regime) = UPPER(?)`;
      params.push(options.regime);
    }
    if (options.outcome) {
      sql += ` AND UPPER(outcome) = UPPER(?)`;
      params.push(options.outcome);
    }
    if (options.minConfidence !== undefined) {
      sql += ` AND confidence >= ?`;
      params.push(options.minConfidence);
    }

    sql += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(options.limit || 100);

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.map((r) => {
      let reasons: string[] = [];
      let trend = 'NEUTRAL';
      let momentum = 'WEAK';
      let structure = 'UNKNOWN';
      let volatility = 'NORMAL';
      let rsi: number | null = null;
      let ema: number | null = null;
      let bollinger: number | null = null;
      let support: number | null = null;
      let resistance: number | null = null;
      let entryPrice: number | null = null;
      let expiryPrice: number | null = null;

      try {
        if (r.evidence_summary) {
          const ev = JSON.parse(r.evidence_summary);
          if (ev.reasons) reasons = ev.reasons;
        }
        if (r.market_state) {
          const ms = JSON.parse(r.market_state);
          trend = ms.trend || trend;
          momentum = ms.momentum || momentum;
          structure = ms.structure || structure;
          volatility = ms.volatility || volatility;
          rsi = ms.rsi ?? null;
          ema = ms.ema ?? null;
          bollinger = ms.bollingerPercentB ?? null;
          support = ms.support ?? null;
          resistance = ms.resistance ?? null;
        }
        if (r.entry_context) {
          const ec = JSON.parse(r.entry_context);
          entryPrice = ec.currentPrice ?? null;
          expiryPrice = ec.expiryPrice ?? null;
        }
      } catch {}

      const priceDifference = entryPrice !== null && expiryPrice !== null ? expiryPrice - entryPrice : null;

      return {
        signalId: r.id,
        timestamp: r.timestamp,
        asset: r.asset || 'UNKNOWN',
        timeframe: r.timeframe || '1m',
        direction: r.stabilized_decision || r.raw_decision || 'WAIT',
        confidence: r.confidence || 0,
        outcome: r.outcome,
        marketRegime: r.market_regime || 'UNKNOWN',
        reasons,
        trend,
        momentum,
        structure,
        volatility,
        rsi,
        ema,
        bollinger,
        support,
        resistance,
        entryPrice,
        expiryPrice,
        priceDifference,
        tradeExecuted: Boolean(r.trade_id),
        tradeId: r.trade_id || null,
        tradeOutcome: r.trade_outcome || null,
      };
    });
  }
}
