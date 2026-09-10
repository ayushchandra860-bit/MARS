// ============================================================
// MARS PRO V3 — Canonical Trade Lifecycle Manager
// Single authority for active trade registration, state machine transitions,
// deduplication, timer-based expiry, outcome resolution, and restart recovery.
// ============================================================

import { randomUUID } from 'crypto';
import { DbTrackedTrade, TradeRepository } from '../database/repositories/TradeRepository';
import {
  AuthoritativeTradeRecord,
  TradeState,
  TradingAction,
  TradeOutcome,
} from '../../../shared/types/decision';
import { CanonicalConfidence, PlatformMode } from '../../../shared/types/canonical';

export class TradeLifecycleManager {
  private static instance: TradeLifecycleManager | null = null;
  private tradeRepo: TradeRepository | null = null;
  private activeTrades: Map<string, AuthoritativeTradeRecord> = new Map();
  private tradeTimers: Map<string, NodeJS.Timeout> = new Map();
  private recentLockouts: Map<string, number> = new Map();
  private recentEventIds: Set<string> = new Set();
  private seqCounter: number = 0;
  private onTradeStateChangeCallbacks: Array<(trade: AuthoritativeTradeRecord) => void> = [];

  // Lockout duration for duplicate click/event prevention (1.5 seconds)
  private readonly DUPLICATE_LOCKOUT_MS = 1500;

  private constructor() {}

  public static getInstance(): TradeLifecycleManager {
    if (!TradeLifecycleManager.instance) {
      TradeLifecycleManager.instance = new TradeLifecycleManager();
    }
    return TradeLifecycleManager.instance;
  }

  public setRepository(repo: TradeRepository): void {
    this.tradeRepo = repo;
  }

  public subscribeTradeStateChange(callback: (trade: AuthoritativeTradeRecord) => void): () => void {
    this.onTradeStateChangeCallbacks.push(callback);
    return () => {
      this.onTradeStateChangeCallbacks = this.onTradeStateChangeCallbacks.filter((cb) => cb !== callback);
    };
  }

  private notifyStateChange(trade: AuthoritativeTradeRecord): void {
    for (const callback of this.onTradeStateChangeCallbacks) {
      try {
        callback(trade);
      } catch (err) {
        console.error('[TradeLifecycleManager] Error in state change listener:', err);
      }
    }
  }

  // ----------------------------------------------------------
  // 7-State Trade State Machine Transitions
  // ----------------------------------------------------------
  private static readonly ALLOWED_TRANSITIONS: Record<TradeState, TradeState[]> = {
    [TradeState.WAITING]: [TradeState.ENTRY_DETECTED],
    [TradeState.ENTRY_DETECTED]: [TradeState.TRADE_ACTIVE, TradeState.ARCHIVED],
    [TradeState.TRADE_ACTIVE]: [TradeState.EXPIRING, TradeState.WIN, TradeState.LOSS, TradeState.DRAW, TradeState.ARCHIVED],
    [TradeState.EXPIRING]: [TradeState.WIN, TradeState.LOSS, TradeState.DRAW, TradeState.ARCHIVED],
    [TradeState.WIN]: [TradeState.ARCHIVED],
    [TradeState.LOSS]: [TradeState.ARCHIVED],
    [TradeState.DRAW]: [TradeState.ARCHIVED],
    [TradeState.ARCHIVED]: [],
  };

  public canTransition(fromState: TradeState, toState: TradeState): boolean {
    if (fromState === toState) return true;
    const allowed = TradeLifecycleManager.ALLOWED_TRANSITIONS[fromState];
    return allowed ? allowed.includes(toState) : false;
  }

  public findTradeBySignal(signalId: string): AuthoritativeTradeRecord | undefined {
    for (const trade of this.activeTrades.values()) {
      if (trade.signalId === signalId) return trade;
    }
    return undefined;
  }

  // ----------------------------------------------------------
  // Trade Registration with Multi-Tier Deduplication
  // ----------------------------------------------------------
  public registerTrade(params: {
    sessionId: string;
    signalId?: string;
    executionId?: string;
    asset: string | null;
    direction: TradingAction;
    expirySeconds?: number;
    confidence?: CanonicalConfidence;
    entryPrice?: string | null;
    reasons?: string[];
    timeframe?: string;
    regime?: string;
    mlFeatures?: number[];
    eventId?: string;
    platformMode?: PlatformMode;
  }): AuthoritativeTradeRecord | null {
    if (params.direction === TradingAction.WAIT) {
      return null;
    }

    const now = Date.now();
    const assetKey = params.asset ? params.asset.trim().toUpperCase() : 'UNKNOWN';

    // 1. Event ID Deduplication (Physical click duplicate dispatch prevention)
    if (params.eventId) {
      if (this.recentEventIds.has(params.eventId)) {
        for (const trade of this.activeTrades.values()) {
          if (trade.asset?.toUpperCase() === assetKey && trade.direction === params.direction) {
            return trade;
          }
        }
        return null;
      }
      this.recentEventIds.add(params.eventId);
      if (this.recentEventIds.size > 500) {
        const first = this.recentEventIds.values().next().value;
        if (first) this.recentEventIds.delete(first);
      }
    }

    // 2. Signal ID Deduplication (One signal cannot open duplicate trade)
    if (params.signalId) {
      const existing = this.findTradeBySignal(params.signalId);
      if (existing) return existing;
    }

    // 3. Lockout Protection (Asset + Direction rapid click deduplication)
    const lockoutKey = params.eventId
      ? `event:${params.eventId}`
      : `${assetKey}:${params.direction}:${params.signalId || 'anon'}`;
    const lastLockout = this.recentLockouts.get(lockoutKey) || 0;
    if (now - lastLockout < this.DUPLICATE_LOCKOUT_MS) {
      for (const trade of this.activeTrades.values()) {
        if (trade.asset?.toUpperCase() === assetKey && trade.direction === params.direction) {
          return trade;
        }
      }
      return null;
    }
    this.recentLockouts.set(lockoutKey, now);

    // Deterministic Trade ID
    const seq = (this.seqCounter = (this.seqCounter || 0) + 1);
    const signalPart = params.signalId ? params.signalId.slice(0, 8) : 'manual';
    const tradeId = `trade-${params.sessionId.slice(0, 8)}-${signalPart}-${now}-${seq}`;
    const expirySec = params.expirySeconds && params.expirySeconds > 0 ? params.expirySeconds : 60;
    const expiryTimestamp = now + expirySec * 1000;

    const initialRecord: AuthoritativeTradeRecord = {
      id: tradeId,
      sessionId: params.sessionId,
      signalId: params.signalId,
      executionId: params.executionId || params.eventId,
      asset: params.asset,
      direction: params.direction,
      entryTimestamp: now,
      expirySeconds: expirySec,
      expiryTimestamp,
      status: TradeState.WAITING,
      runningTimeSec: 0,
      result: null,
      confidence: params.confidence ?? null, // NO 0.5 FALLBACK
      entryPrice: params.entryPrice ?? null,
      expiryLabel: `${Math.round(expirySec / 60)} min`,
      reasons: params.reasons || [],
      timeframe: params.timeframe || '1m',
      regime: params.regime || 'TRENDING',
      mlFeatures: params.mlFeatures,
    };

    // State Transition: WAITING -> ENTRY_DETECTED -> TRADE_ACTIVE
    const step1 = this.applyStateTransition(initialRecord, TradeState.ENTRY_DETECTED);
    if (!step1) return null;

    const activeRecord = this.applyStateTransition(step1, TradeState.TRADE_ACTIVE);
    if (!activeRecord) return null;

    // Save to Memory & Database
    this.activeTrades.set(tradeId, activeRecord);
    this.persistTradeToDb(activeRecord);
    this.notifyStateChange(activeRecord);

    // Schedule Expiry Timer
    this.scheduleExpiryTimer(activeRecord);

    return activeRecord;
  }

  private applyStateTransition(
    record: AuthoritativeTradeRecord,
    targetState: TradeState,
    outcome?: TradeOutcome | null,
    completionPrice?: string
  ): AuthoritativeTradeRecord | null {
    if (!this.canTransition(record.status, targetState)) {
      console.warn(`[TradeLifecycleManager] Illegal transition rejected: ${record.status} -> ${targetState} for trade ${record.id}`);
      return null;
    }

    const updated: AuthoritativeTradeRecord = {
      ...record,
      status: targetState,
      result: outcome !== undefined ? outcome : record.result,
      completionPrice: completionPrice !== undefined ? completionPrice : record.completionPrice,
      completionTimestamp: [TradeState.WIN, TradeState.LOSS, TradeState.DRAW, TradeState.ARCHIVED].includes(targetState)
        ? Date.now()
        : record.completionTimestamp,
    };

    return updated;
  }

  public transitionTrade(
    tradeId: string,
    targetState: TradeState,
    outcome?: TradeOutcome | null,
    completionPrice?: string
  ): boolean {
    const existing = this.activeTrades.get(tradeId);
    if (!existing) return false;

    const nextRecord = this.applyStateTransition(existing, targetState, outcome, completionPrice);
    if (!nextRecord) return false;

    this.activeTrades.set(tradeId, nextRecord);
    this.persistTradeToDb(nextRecord);
    this.notifyStateChange(nextRecord);

    if ([TradeState.WIN, TradeState.LOSS, TradeState.DRAW].includes(targetState)) {
      this.clearExpiryTimer(tradeId);
      const archivedRecord = this.applyStateTransition(nextRecord, TradeState.ARCHIVED);
      if (archivedRecord) {
        this.activeTrades.set(tradeId, archivedRecord);
        this.persistTradeToDb(archivedRecord);
        this.notifyStateChange(archivedRecord);
        this.activeTrades.delete(tradeId);
      }
    }

    return true;
  }

  private scheduleExpiryTimer(trade: AuthoritativeTradeRecord): void {
    this.clearExpiryTimer(trade.id);
    const remainingMs = Math.max(0, trade.expiryTimestamp - Date.now());

    const timer = setTimeout(() => {
      this.handleTradeExpiry(trade.id);
    }, remainingMs);

    this.tradeTimers.set(trade.id, timer);
  }

  private clearExpiryTimer(tradeId: string): void {
    const timer = this.tradeTimers.get(tradeId);
    if (timer) {
      clearTimeout(timer);
      this.tradeTimers.delete(tradeId);
    }
  }

  public handleTradeExpiry(tradeId: string): void {
    const trade = this.activeTrades.get(tradeId);
    if (!trade) return;

    if (trade.status === TradeState.TRADE_ACTIVE) {
      this.transitionTrade(tradeId, TradeState.EXPIRING);
    }
  }

  public resolveTradeOutcome(tradeId: string, outcome: TradeOutcome, completionPrice?: string): void {
    const trade = this.activeTrades.get(tradeId);
    let targetState: TradeState = TradeState.ARCHIVED;
    if (outcome === TradeOutcome.WIN) targetState = TradeState.WIN;
    else if (outcome === TradeOutcome.LOSS) targetState = TradeState.LOSS;
    else if (outcome === TradeOutcome.DRAW) targetState = TradeState.DRAW;

    if (trade) {
      this.transitionTrade(tradeId, targetState, outcome, completionPrice);
    } else if (this.tradeRepo) {
      this.tradeRepo.completeTrade(tradeId, outcome, completionPrice || '0');
    }
  }

  public resolveNextActiveTrade(outcome: TradeOutcome, completionPrice?: string, sessionId?: string): boolean {
    const active = this.getActiveTrades().filter((t) => !sessionId || t.sessionId === sessionId);
    if (active.length > 0) {
      active.sort((a, b) => a.entryTimestamp - b.entryTimestamp);
      const target = active[0];
      this.resolveTradeOutcome(target.id, outcome, completionPrice);
      return true;
    }

    if (this.tradeRepo) {
      const dbActive = this.tradeRepo.getActiveTrades(sessionId);
      if (dbActive.length > 0) {
        dbActive.sort((a, b) => a.entry_timestamp - b.entry_timestamp);
        const target = dbActive[0];
        this.resolveTradeOutcome(target.id, outcome, completionPrice);
        return true;
      }
    }

    return false;
  }

  private persistTradeToDb(trade: AuthoritativeTradeRecord): void {
    if (!this.tradeRepo) return;
    try {
      if (trade.status === TradeState.TRADE_ACTIVE) {
        this.tradeRepo.createTrade({
          id: trade.id,
          session_id: trade.sessionId,
          signal_id: trade.signalId || `manual-${trade.id}`,
          action: trade.direction,
          asset: trade.asset,
          timeframe: trade.timeframe || '1m',
          expiry_label: trade.expiryLabel || `${Math.round(trade.expirySeconds / 60)} min`,
          expiry_seconds: trade.expirySeconds,
          confidence: trade.confidence ?? null,
          regime: trade.regime || null,
          entry_price: trade.entryPrice || null,
          entry_timestamp: trade.entryTimestamp,
          expiry_timestamp: trade.expiryTimestamp,
          status: 'ACTIVE',
          outcome: null,
          original_reasons: JSON.stringify(trade.reasons || []),
          completion_timestamp: null,
          completion_price: null,
        });
      } else if ([TradeState.WIN, TradeState.LOSS, TradeState.DRAW, TradeState.ARCHIVED].includes(trade.status)) {
        if (trade.result) {
          this.tradeRepo.completeTrade(
            trade.id,
            trade.result,
            trade.completionPrice || '0'
          );
        }
      }
    } catch (err) {
      console.error(`[TradeLifecycleManager] DB persistence error for trade ${trade.id}:`, err);
    }
  }

  public loadAndRecoverPendingTrades(sessionId?: string): void {
    if (!this.tradeRepo) return;
    try {
      const dbTrades = this.tradeRepo.getActiveTrades(sessionId);
      const now = Date.now();

      for (const dbTrade of dbTrades) {
        const record = this.fromDbActiveTrade(dbTrade);
        if (record.expiryTimestamp <= now) {
          // Already expired during shutdown — mark expiring
          record.status = TradeState.EXPIRING;
          this.activeTrades.set(record.id, record);
        } else {
          this.activeTrades.set(record.id, record);
          this.scheduleExpiryTimer(record);
        }
      }
    } catch (err) {
      console.error('[TradeLifecycleManager] Error recovering pending trades:', err);
    }
  }

  public getActiveTrades(): AuthoritativeTradeRecord[] {
    return Array.from(this.activeTrades.values()).filter(
      (t) => t.status === TradeState.TRADE_ACTIVE || t.status === TradeState.EXPIRING
    );
  }

  public getPanelActiveTrades(): AuthoritativeTradeRecord[] {
    const memoryTrades = Array.from(this.activeTrades.values()).filter(
      (t) => t.status !== TradeState.ARCHIVED
    );
    const memoryTradeIds = new Set(memoryTrades.map((t) => t.id));

    if (this.tradeRepo) {
      const dbTrades = this.tradeRepo.getActiveTrades();
      for (const dbTrade of dbTrades) {
        if (!memoryTradeIds.has(dbTrade.id)) {
          memoryTrades.push(this.fromDbActiveTrade(dbTrade));
        }
      }
    }

    return memoryTrades;
  }

  private fromDbActiveTrade(dbTrade: DbTrackedTrade): AuthoritativeTradeRecord {
    let reasons: string[] = [];
    try {
      reasons = JSON.parse(dbTrade.original_reasons || '[]');
    } catch {
      reasons = [];
    }

    return {
      id: dbTrade.id,
      sessionId: dbTrade.session_id,
      signalId: dbTrade.signal_id,
      asset: dbTrade.asset,
      direction: dbTrade.action as TradingAction,
      entryTimestamp: dbTrade.entry_timestamp,
      expirySeconds: dbTrade.expiry_seconds,
      expiryTimestamp: dbTrade.expiry_timestamp,
      status: TradeState.TRADE_ACTIVE,
      runningTimeSec: Math.max(0, Math.round((Date.now() - dbTrade.entry_timestamp) / 1000)),
      result: (dbTrade.outcome as TradeOutcome) || null,
      confidence: typeof dbTrade.confidence === 'number' ? dbTrade.confidence : null,
      entryPrice: dbTrade.entry_price,
      completionPrice: dbTrade.completion_price,
      completionTimestamp: dbTrade.completion_timestamp,
      expiryLabel: dbTrade.expiry_label,
      reasons,
      timeframe: dbTrade.timeframe,
      regime: dbTrade.regime,
    };
  }

  public getActiveTradeCount(): number {
    return this.getActiveTrades().length;
  }

  public clearAll(): void {
    for (const timer of this.tradeTimers.values()) {
      clearTimeout(timer);
    }
    this.tradeTimers.clear();
    this.activeTrades.clear();
    this.recentLockouts.clear();
    this.recentEventIds.clear();
  }
}
