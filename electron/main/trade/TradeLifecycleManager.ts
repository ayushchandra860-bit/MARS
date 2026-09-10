// ============================================================
// MARS PRO V3 — Canonical Trade Lifecycle Manager
// Durable registration, explicit provenance, safe outcome correlation.
// ============================================================

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
  private activeTrades = new Map<string, AuthoritativeTradeRecord>();
  private tradeTimers = new Map<string, NodeJS.Timeout>();
  private recentLockouts = new Map<string, number>();
  private recentEventIds = new Set<string>();
  private seqCounter = 0;
  private onTradeStateChangeCallbacks: Array<(trade: AuthoritativeTradeRecord) => void> = [];
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
      this.onTradeStateChangeCallbacks = this.onTradeStateChangeCallbacks.filter((item) => item !== callback);
    };
  }

  private notifyStateChange(trade: AuthoritativeTradeRecord): void {
    for (const callback of this.onTradeStateChangeCallbacks) {
      try { callback(trade); } catch (error) {
        console.error('[TradeLifecycleManager] State-change listener failed:', error);
      }
    }
  }

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
    return TradeLifecycleManager.ALLOWED_TRANSITIONS[fromState]?.includes(toState) ?? false;
  }

  public findTradeBySignal(signalId: string): AuthoritativeTradeRecord | undefined {
    return Array.from(this.activeTrades.values()).find((trade) => trade.signalId === signalId);
  }

  private pruneDeduplicationState(now: number): void {
    const retentionMs = this.DUPLICATE_LOCKOUT_MS * 4;
    for (const [key, timestamp] of this.recentLockouts) {
      if (now - timestamp > retentionMs) this.recentLockouts.delete(key);
    }
    while (this.recentEventIds.size > 500) {
      const first = this.recentEventIds.values().next().value as string | undefined;
      if (!first) break;
      this.recentEventIds.delete(first);
    }
  }

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
    if (params.direction === TradingAction.WAIT) return null;

    const now = Date.now();
    this.pruneDeduplicationState(now);
    const assetKey = params.asset?.trim().toUpperCase() || 'UNKNOWN';

    if (params.eventId) {
      if (this.recentEventIds.has(params.eventId)) {
        return Array.from(this.activeTrades.values()).find(
          (trade) => trade.executionId === params.eventId,
        ) ?? null;
      }
      this.recentEventIds.add(params.eventId);
    }

    if (params.signalId) {
      const existing = this.findTradeBySignal(params.signalId);
      if (existing) return existing;
    }

    const lockoutKey = params.eventId
      ? `event:${params.eventId}`
      : `${assetKey}:${params.direction}:${params.signalId || 'anon'}`;
    const lastLockout = this.recentLockouts.get(lockoutKey) || 0;
    if (now - lastLockout < this.DUPLICATE_LOCKOUT_MS) return null;
    this.recentLockouts.set(lockoutKey, now);

    const seq = ++this.seqCounter;
    const signalPart = params.signalId ? params.signalId.slice(0, 8) : 'manual';
    const tradeId = `trade-${params.sessionId.slice(0, 8)}-${signalPart}-${now}-${seq}`;
    const expirySec = params.expirySeconds && params.expirySeconds > 0 ? params.expirySeconds : 60;

    const initialRecord: AuthoritativeTradeRecord = {
      id: tradeId,
      sessionId: params.sessionId,
      signalId: params.signalId,
      executionId: params.executionId || params.eventId,
      asset: params.asset,
      direction: params.direction,
      entryTimestamp: now,
      expirySeconds: expirySec,
      expiryTimestamp: now + expirySec * 1000,
      status: TradeState.WAITING,
      runningTimeSec: 0,
      result: null,
      confidence: params.confidence ?? null,
      entryPrice: params.entryPrice ?? null,
      expiryLabel: `${Math.round(expirySec / 60)} min`,
      reasons: params.reasons ? [...params.reasons] : [],
      timeframe: params.timeframe ?? null,
      regime: params.regime ?? null,
      platformMode: params.platformMode ?? PlatformMode.UNKNOWN,
      mlFeatures: params.mlFeatures ? [...params.mlFeatures] : undefined,
    };

    const entryDetected = this.applyStateTransition(initialRecord, TradeState.ENTRY_DETECTED);
    const activeRecord = entryDetected
      ? this.applyStateTransition(entryDetected, TradeState.TRADE_ACTIVE)
      : null;
    if (!activeRecord || !this.persistTradeToDb(activeRecord)) return null;

    this.activeTrades.set(tradeId, activeRecord);
    this.notifyStateChange(activeRecord);
    this.scheduleExpiryTimer(activeRecord);
    return activeRecord;
  }

  private applyStateTransition(
    record: AuthoritativeTradeRecord,
    targetState: TradeState,
    outcome?: TradeOutcome | null,
    completionPrice?: string | null,
  ): AuthoritativeTradeRecord | null {
    if (!this.canTransition(record.status, targetState)) {
      console.warn(`[TradeLifecycleManager] Rejected ${record.status} -> ${targetState} for ${record.id}`);
      return null;
    }
    return {
      ...record,
      status: targetState,
      result: outcome !== undefined ? outcome : record.result,
      completionPrice: completionPrice !== undefined ? completionPrice : record.completionPrice,
      completionTimestamp: [TradeState.WIN, TradeState.LOSS, TradeState.DRAW, TradeState.ARCHIVED]
        .includes(targetState) ? Date.now() : record.completionTimestamp,
    };
  }

  public transitionTrade(
    tradeId: string,
    targetState: TradeState,
    outcome?: TradeOutcome | null,
    completionPrice?: string | null,
  ): boolean {
    const existing = this.activeTrades.get(tradeId);
    if (!existing) return false;
    const nextRecord = this.applyStateTransition(existing, targetState, outcome, completionPrice);
    if (!nextRecord || !this.persistTradeToDb(nextRecord)) return false;

    this.activeTrades.set(tradeId, nextRecord);
    this.notifyStateChange(nextRecord);

    if ([TradeState.WIN, TradeState.LOSS, TradeState.DRAW].includes(targetState)) {
      this.clearExpiryTimer(tradeId);
      const archivedRecord = this.applyStateTransition(nextRecord, TradeState.ARCHIVED);
      if (archivedRecord) {
        this.notifyStateChange(archivedRecord);
        this.activeTrades.delete(tradeId);
      }
    }
    return true;
  }

  private scheduleExpiryTimer(trade: AuthoritativeTradeRecord): void {
    this.clearExpiryTimer(trade.id);
    this.tradeTimers.set(trade.id, setTimeout(
      () => this.handleTradeExpiry(trade.id),
      Math.max(0, trade.expiryTimestamp - Date.now()),
    ));
  }

  private clearExpiryTimer(tradeId: string): void {
    const timer = this.tradeTimers.get(tradeId);
    if (timer) clearTimeout(timer);
    this.tradeTimers.delete(tradeId);
  }

  public handleTradeExpiry(tradeId: string): void {
    const trade = this.activeTrades.get(tradeId);
    if (trade?.status === TradeState.TRADE_ACTIVE) {
      this.transitionTrade(tradeId, TradeState.EXPIRING);
    }
  }

  public resolveTradeOutcome(
    tradeId: string,
    outcome: TradeOutcome,
    completionPrice?: string | null,
  ): boolean {
    const targetState = outcome === TradeOutcome.WIN
      ? TradeState.WIN
      : outcome === TradeOutcome.LOSS
        ? TradeState.LOSS
        : outcome === TradeOutcome.DRAW ? TradeState.DRAW : TradeState.ARCHIVED;
    if (this.activeTrades.has(tradeId)) {
      return this.transitionTrade(tradeId, targetState, outcome, completionPrice ?? null);
    }
    return this.tradeRepo?.completeTrade(tradeId, outcome, completionPrice ?? null) ?? false;
  }

  /**
   * Timing-only result correlation is permitted only when exactly one eligible
   * trade exists. Multiple candidates are deliberately left unresolved.
   */
  public resolveNextActiveTrade(
    outcome: TradeOutcome,
    completionPrice?: string | null,
    sessionId?: string,
  ): boolean {
    const active = this.getActiveTrades().filter((trade) => !sessionId || trade.sessionId === sessionId);
    if (active.length === 1) {
      return this.resolveTradeOutcome(active[0].id, outcome, completionPrice ?? null);
    }
    if (active.length > 1) {
      console.warn('[TradeLifecycleManager] Ambiguous result rejected: multiple active trades.');
      return false;
    }

    const durable = this.tradeRepo?.getActiveTrades(sessionId) ?? [];
    if (durable.length !== 1) {
      if (durable.length > 1) {
        console.warn('[TradeLifecycleManager] Ambiguous durable result rejected: multiple active trades.');
      }
      return false;
    }
    return this.resolveTradeOutcome(durable[0].id, outcome, completionPrice ?? null);
  }

  private persistTradeToDb(trade: AuthoritativeTradeRecord): boolean {
    if (!this.tradeRepo) return true;
    try {
      if (trade.status === TradeState.TRADE_ACTIVE) {
        return this.tradeRepo.createTrade({
          id: trade.id,
          session_id: trade.sessionId,
          signal_id: trade.signalId || `manual-${trade.id}`,
          action: trade.direction,
          asset: trade.asset,
          timeframe: trade.timeframe ?? null,
          expiry_label: trade.expiryLabel || `${Math.round(trade.expirySeconds / 60)} min`,
          expiry_seconds: trade.expirySeconds,
          confidence: trade.confidence ?? null,
          regime: trade.regime ?? null,
          entry_price: trade.entryPrice ?? null,
          entry_timestamp: trade.entryTimestamp,
          expiry_timestamp: trade.expiryTimestamp,
          status: 'ACTIVE',
          original_reasons: JSON.stringify(trade.reasons || []),
          mlFeatures: trade.mlFeatures,
          platformMode: trade.platformMode ?? PlatformMode.UNKNOWN,
        });
      }
      if (trade.status === TradeState.EXPIRING) return this.tradeRepo.markExpiring(trade.id);
      if ([TradeState.WIN, TradeState.LOSS, TradeState.DRAW].includes(trade.status) && trade.result) {
        return this.tradeRepo.completeTrade(trade.id, trade.result, trade.completionPrice ?? null);
      }
      return true;
    } catch (error) {
      console.error(`[TradeLifecycleManager] DB persistence failed for ${trade.id}:`, error);
      return false;
    }
  }

  public loadAndRecoverPendingTrades(sessionId?: string): void {
    if (!this.tradeRepo) return;
    try {
      const now = Date.now();
      for (const dbTrade of this.tradeRepo.getActiveTrades(sessionId)) {
        const record = this.fromDbActiveTrade(dbTrade);
        if (record.expiryTimestamp <= now) {
          record.status = TradeState.EXPIRING;
          if (dbTrade.status === 'ACTIVE') this.tradeRepo.markExpiring(record.id);
          this.activeTrades.set(record.id, record);
        } else {
          this.activeTrades.set(record.id, record);
          this.scheduleExpiryTimer(record);
        }
      }
    } catch (error) {
      console.error('[TradeLifecycleManager] Pending-trade recovery failed:', error);
    }
  }

  public getActiveTrades(): AuthoritativeTradeRecord[] {
    return Array.from(this.activeTrades.values()).filter(
      (trade) => trade.status === TradeState.TRADE_ACTIVE || trade.status === TradeState.EXPIRING,
    );
  }

  public getPanelActiveTrades(): AuthoritativeTradeRecord[] {
    const memoryTrades = Array.from(this.activeTrades.values())
      .filter((trade) => trade.status !== TradeState.ARCHIVED);
    const ids = new Set(memoryTrades.map((trade) => trade.id));
    for (const dbTrade of this.tradeRepo?.getActiveTrades() ?? []) {
      if (!ids.has(dbTrade.id)) memoryTrades.push(this.fromDbActiveTrade(dbTrade));
    }
    return memoryTrades;
  }

  private fromDbActiveTrade(dbTrade: DbTrackedTrade): AuthoritativeTradeRecord {
    let reasons: string[] = [];
    try {
      const parsed = JSON.parse(dbTrade.original_reasons || '[]');
      if (Array.isArray(parsed)) reasons = parsed.filter((item) => typeof item === 'string');
    } catch {}

    const platformMode = Object.values(PlatformMode).includes(dbTrade.platform_mode as PlatformMode)
      ? dbTrade.platform_mode as PlatformMode
      : PlatformMode.UNKNOWN;
    return {
      id: dbTrade.id,
      sessionId: dbTrade.session_id,
      signalId: dbTrade.signal_id,
      asset: dbTrade.asset,
      direction: dbTrade.action as TradingAction,
      entryTimestamp: dbTrade.entry_timestamp,
      expirySeconds: dbTrade.expiry_seconds,
      expiryTimestamp: dbTrade.expiry_timestamp,
      status: dbTrade.status === 'EXPIRING' ? TradeState.EXPIRING : TradeState.TRADE_ACTIVE,
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
      platformMode,
    };
  }

  public getActiveTradeCount(): number {
    return this.getActiveTrades().length;
  }

  public clearAll(): void {
    for (const timer of this.tradeTimers.values()) clearTimeout(timer);
    this.tradeTimers.clear();
    this.activeTrades.clear();
    this.recentLockouts.clear();
    this.recentEventIds.clear();
  }
}
