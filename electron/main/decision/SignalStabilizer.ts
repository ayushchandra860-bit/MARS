// ============================================================
// MARS PRO V3 — Enhanced Signal Stabilizer
// Prevents signal flickering via temporal hysteresis, multi-frame
// confirmation, persistent market-state tracking, and cooldown guards.
// ============================================================

import { RawDecisionResult, StabilizedDecision, TradingAction, RiskLevel, SignalLifecycle } from '../../../shared/types/decision';
import { MarketBias, TrendDirection, MomentumLevel } from '../../../shared/types/market';
import { QualityLevel } from '../../../shared/types/scanner';

/** History entry for temporal smoothing */
interface StabilityFrame {
  action: TradingAction;
  timestamp: number;
  signalStrength: number;
}

/** Persistent market state that resists noise */
interface MarketStateSnapshot {
  trend: TrendDirection | null;
  bias: MarketBias | null;
  momentum: MomentumLevel | null;
}

export class SignalStabilizer {
  private lastAction: TradingAction = TradingAction.WAIT;
  private pendingAction: TradingAction = TradingAction.WAIT;
  private pendingCount = 0;
  private lastStableDecision: RawDecisionResult | null = null;

  // Temporal hysteresis: recent frame buffer for smoothing
  private frameHistory: StabilityFrame[] = [];
  private static readonly MAX_HISTORY = 15;
  private static readonly CONFIRMATION_FRAMES = 5;
  private static readonly HIGH_STRENGTH_OVERRIDE = 0.88;

  public setCalibrationMode(mode: 'SAFE' | 'BALANCED' | 'COMPREHENSIVE' | 'SNIPER' | 'AGGRESSIVE' | string): void {
    const isSafe = mode === 'SAFE' || mode === 'SNIPER';
    const isComprehensive = mode === 'COMPREHENSIVE' || mode === 'AGGRESSIVE';
    this.overrideConfirmationFrames = isSafe ? 5 : isComprehensive ? 1 : 2;
    this.overrideStrengthThreshold = isSafe ? 0.90 : isComprehensive ? 0.70 : 0.80;
  }

  /** Explicit per-profile confirmation frame count (driven by settings). */
  public setConfirmationFrames(frames: number): void {
    this.overrideConfirmationFrames = Math.max(1, Math.round(frames));
  }

  private overrideConfirmationFrames: number | null = null;
  private overrideStrengthThreshold: number | null = null;

  private confirmationFrames(): number {
    return this.overrideConfirmationFrames ?? SignalStabilizer.CONFIRMATION_FRAMES;
  }

  private highStrengthThreshold(): number {
    return this.overrideStrengthThreshold ?? SignalStabilizer.HIGH_STRENGTH_OVERRIDE;
  }

  // Hold timer: once confirmed, signal persists for minimum duration
  private lastConfirmedAction: TradingAction = TradingAction.WAIT;
  private lastConfirmedTimestamp: number = 0;
  private static readonly MIN_HOLD_MS = 3000;

  // Transition cooldown: prevent rapid BUY?WAIT?BUY?SELL oscillation
  private lastTransitionTimestamp: number = 0;
  private static readonly TRANSITION_COOLDOWN_MS = 2000;
  private transitionCount: number = 0;
  private static readonly MAX_TRANSITIONS_IN_WINDOW = 3;
  private static readonly TRANSITION_WINDOW_MS = 12000;

  // Market state persistence: smooth trend/bias/momentum
  private persistentMarketState: MarketStateSnapshot = {
    trend: null,
    bias: null,
    momentum: null,
  };
  private marketStateHistory: MarketStateSnapshot[] = [];
  private static readonly STATE_HISTORY_SIZE = 7;

  // Signal lifecycle tracking
  private currentLifecycle: SignalLifecycle = SignalLifecycle.WATCHING;
  private confirmedSignalTimestamp: number = 0;

  public stabilize(raw: RawDecisionResult): StabilizedDecision {
    if (!raw) {
      const fallbackReason = 'Invalid raw decision';
      return {
        action: TradingAction.WAIT,
        reason: fallbackReason,
        reasons: [fallbackReason],
        signalStrength: 0,
        confidence: 0,
        risk: RiskLevel.LOW,
        marketBias: MarketBias.NEUTRAL,
        recommendedExpiry: '1 min',
        dataQuality: QualityLevel.FAILED,
        timestamp: Date.now(),
        wasStabilized: false,
        frameConsistency: 1,
      };
    }

    const reasons = raw.reasons || [raw.reason];
    const now = Date.now();

    // Record frame in history
    this.frameHistory.push({
      action: raw.action,
      timestamp: now,
      signalStrength: raw.signalStrength,
    });
    if (this.frameHistory.length > SignalStabilizer.MAX_HISTORY) {
      this.frameHistory.shift();
    }

    // Clean up old transition counts
    if (now - this.lastTransitionTimestamp > SignalStabilizer.TRANSITION_WINDOW_MS) {
      this.transitionCount = 0;
    }

    // Very high strength signals bypass hysteresis
    if (raw.signalStrength >= this.highStrengthThreshold()) {
      this.lastAction = raw.action;
      this.pendingAction = raw.action;
      this.pendingCount = 0;
      this.lastStableDecision = raw;
      if (raw.action !== TradingAction.WAIT) {
        this.lastConfirmedAction = raw.action;
        this.lastConfirmedTimestamp = now;
        this.confirmedSignalTimestamp = now;
        this.currentLifecycle = SignalLifecycle.CONFIRMED;
      } else {
        this.currentLifecycle = SignalLifecycle.WATCHING;
      }
      return { ...raw, reasons, wasStabilized: false, frameConsistency: 1 };
    }

    // Hold timer: maintain previous signal during minimum hold period
    if (this.lastConfirmedAction !== TradingAction.WAIT &&
        raw.action !== this.lastConfirmedAction &&
        (now - this.lastConfirmedTimestamp) < SignalStabilizer.MIN_HOLD_MS) {
      return this.getHeldDecision(raw, now, this.getFrameConsistency());
    }

    // Transition cooldown: suppress frequent oscillations
    if (raw.action !== this.lastAction &&
        raw.action !== TradingAction.WAIT &&
        this.lastAction !== TradingAction.WAIT) {
      if ((now - this.lastTransitionTimestamp) < SignalStabilizer.TRANSITION_COOLDOWN_MS) {
        return this.getHeldDecision(raw, now, this.getFrameConsistency());
      }
    }

    // Track transition rate in window
    if (raw.action !== this.lastAction) {
      this.transitionCount++;
      if (this.transitionCount > SignalStabilizer.MAX_TRANSITIONS_IN_WINDOW) {
        // Too many transitions — lock to current action until window resets
        return this.getHeldDecision(raw, now, this.getFrameConsistency());
      }
    }

    // Same action as current stable state — reset pending
    if (raw.action === this.lastAction) {
      this.pendingAction = raw.action;
      this.pendingCount = 0;
      this.lastStableDecision = raw;
      if (raw.action !== TradingAction.WAIT) {
        this.currentLifecycle = SignalLifecycle.ACTIVE;
      } else {
        this.currentLifecycle = SignalLifecycle.WATCHING;
      }
      return { ...raw, reasons, wasStabilized: false, frameConsistency: this.getFrameConsistency() };
    }

    // Check confirmation requirements
    const isStrongReversal = this.isStrongReversalEvidence(raw) || raw.signalStrength >= 0.85;
    const requiredFrames = isStrongReversal ? 1 : this.confirmationFrames();

    // Accumulate confirmation
    if (raw.action === this.pendingAction) {
      this.pendingCount++;
    } else {
      this.pendingAction = raw.action;
      this.pendingCount = 1;
    }

    if (this.pendingCount >= requiredFrames) {
      // Confirm the new action
      this.lastTransitionTimestamp = now;
      this.lastAction = raw.action;
      this.pendingCount = 0;
      this.lastStableDecision = raw;
      if (raw.action !== TradingAction.WAIT) {
        this.lastConfirmedAction = raw.action;
        this.lastConfirmedTimestamp = now;
        this.confirmedSignalTimestamp = now;
        this.currentLifecycle = SignalLifecycle.CONFIRMING;
      } else {
        this.lastConfirmedAction = TradingAction.WAIT;
        this.currentLifecycle = SignalLifecycle.WATCHING;
      }
      return { ...raw, reasons, wasStabilized: false, frameConsistency: requiredFrames + 1 };
    }

    // Not yet confirmed — keep showing last stable action with preserved properties
    return this.getHeldDecision(raw, now, this.pendingCount);
  }

  private getHeldDecision(raw: RawDecisionResult, now: number, consistency: number): StabilizedDecision {
    if (this.lastStableDecision && this.lastStableDecision.action === this.lastAction) {
      const stableReasons = this.lastStableDecision.reasons || [this.lastStableDecision.reason];
      return {
        ...this.lastStableDecision,
        observationId: raw.observationId || this.lastStableDecision.observationId,
        reasons: stableReasons,
        timestamp: now,
        wasStabilized: true,
        frameConsistency: consistency,
      };
    }
    const reasons = raw.reasons || [raw.reason];
    return {
      ...raw,
      observationId: raw.observationId,
      action: this.lastAction,
      reasons,
      wasStabilized: true,
      frameConsistency: consistency,
    };
  }

  /**
   * Smooth market state (trend, bias, momentum) using majority vote
   * over recent frames. Prevents single-frame noise from flipping labels.
   */
  public smoothMarketState(
    trend: TrendDirection | null,
    bias: MarketBias | null,
    momentum: MomentumLevel | null
  ): MarketStateSnapshot {
    this.marketStateHistory.push({ trend, bias, momentum });
    if (this.marketStateHistory.length > SignalStabilizer.STATE_HISTORY_SIZE) {
      this.marketStateHistory.shift();
    }

    const smoothedTrend = this.majorityVote(
      this.marketStateHistory.map(s => s.trend).filter((v): v is TrendDirection => v !== null),
      TrendDirection.NEUTRAL
    );
    const smoothedBias = this.majorityVote(
      this.marketStateHistory.map(s => s.bias).filter((v): v is MarketBias => v !== null),
      MarketBias.NEUTRAL
    );
    const smoothedMomentum = this.majorityVote(
      this.marketStateHistory.map(s => s.momentum).filter((v): v is MomentumLevel => v !== null),
      MomentumLevel.WEAK
    );

    this.persistentMarketState = {
      trend: smoothedTrend,
      bias: smoothedBias,
      momentum: smoothedMomentum,
    };

    return { ...this.persistentMarketState };
  }

  /** Get current stable trading action */
  public getCurrentAction(): TradingAction {
    return this.lastAction;
  }

  /** Get current lifecycle state */
  public getLifecycle(): SignalLifecycle {
    return this.currentLifecycle;
  }

  /** Update lifecycle based on time progression */
  public updateLifecycle(): void {
    const now = Date.now();
    if (this.lastConfirmedAction === TradingAction.WAIT) {
      this.currentLifecycle = SignalLifecycle.WATCHING;
      return;
    }

    const elapsed = now - this.confirmedSignalTimestamp;
    if (elapsed < 1000) {
      this.currentLifecycle = SignalLifecycle.CONFIRMING;
    } else if (elapsed < 3000) {
      this.currentLifecycle = SignalLifecycle.ENTRY_WINDOW;
    } else {
      this.currentLifecycle = SignalLifecycle.ACTIVE;
    }
  }

  /** Get the persistent (smoothed) market state */
  public getPersistentMarketState(): MarketStateSnapshot {
    return { ...this.persistentMarketState };
  }

  public reset(): void {
    this.lastAction = TradingAction.WAIT;
    this.pendingAction = TradingAction.WAIT;
    this.pendingCount = 0;
    this.frameHistory = [];
    this.lastConfirmedAction = TradingAction.WAIT;
    this.lastConfirmedTimestamp = 0;
    this.confirmedSignalTimestamp = 0;
    this.currentLifecycle = SignalLifecycle.WATCHING;
    this.marketStateHistory = [];
    this.persistentMarketState = { trend: null, bias: null, momentum: null };
    this.lastTransitionTimestamp = 0;
    this.transitionCount = 0;
  }

  // --- Private helpers ---

  private getFrameConsistency(): number {
    if (this.frameHistory.length < 2) return 1;
    let consistent = 0;
    const last = this.frameHistory[this.frameHistory.length - 1];
    for (let i = this.frameHistory.length - 2; i >= 0; i--) {
      if (this.frameHistory[i].action === last.action) consistent++;
      else break;
    }
    return consistent + 1;
  }

  private isStrongReversalEvidence(raw: RawDecisionResult): boolean {
    if (this.lastAction === TradingAction.WAIT) return false;
    if (raw.action === TradingAction.WAIT) return false;
    if (raw.action === this.lastAction) return false;
    // Opposite direction signal requires very high strength
    if ((this.lastAction === TradingAction.BUY && raw.action === TradingAction.SELL) ||
        (this.lastAction === TradingAction.SELL && raw.action === TradingAction.BUY)) {
      return raw.signalStrength >= 0.75;
    }
    return false;
  }

  private majorityVote<T extends string>(values: T[], fallback: T): T {
    if (values.length === 0) return fallback;
    const counts = new Map<T, number>();
    for (const v of values) {
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    let best = fallback;
    let bestCount = 0;
    for (const [val, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        best = val;
      }
    }
    // Require strict majority to change state
    if (bestCount <= Math.floor(values.length / 2)) return fallback;
    return best;
  }
}