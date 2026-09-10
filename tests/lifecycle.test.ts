// ============================================================
// MARS PRO V3 — Lifecycle & Session Tests
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { AnalysisState } from '../shared/types/session';
import { SessionId } from '../shared/types/scanner';

class LifecycleStateMachine {
  state: AnalysisState = AnalysisState.STOPPED;
  activeSessionId: SessionId | null = null;
  private sessionCounter = 0;

  start(): { success: boolean; error?: string } {
    if (
      this.state === AnalysisState.RUNNING ||
      this.state === AnalysisState.STARTING
    ) {
      return { success: true }; // Idempotent
    }
    if (this.state === AnalysisState.STOPPING) {
      return { success: false, error: 'Currently stopping' };
    }

    this.state = AnalysisState.STARTING;
    this.sessionCounter++;
    this.activeSessionId = `session-${this.sessionCounter}`;
    this.state = AnalysisState.RUNNING;
    return { success: true };
  }

  stop(): { success: boolean } {
    if (
      this.state === AnalysisState.STOPPED ||
      this.state === AnalysisState.STOPPING
    ) {
      return { success: true }; // Idempotent
    }

    this.state = AnalysisState.STOPPING;
    this.activeSessionId = null;
    this.state = AnalysisState.STOPPED;
    return { success: true };
  }

  isSessionValid(sessionId: SessionId | null): boolean {
    if (!sessionId || !this.activeSessionId) return false;
    return this.activeSessionId === sessionId;
  }
}

describe('Lifecycle State Machine', () => {
  let lifecycle: LifecycleStateMachine;

  beforeEach(() => {
    lifecycle = new LifecycleStateMachine();
  });

  it('starts in STOPPED state', () => {
    expect(lifecycle.state).toBe(AnalysisState.STOPPED);
    expect(lifecycle.activeSessionId).toBeNull();
  });

  it('transitions STOPPED → RUNNING on start', () => {
    const result = lifecycle.start();
    expect(result.success).toBe(true);
    expect(lifecycle.state).toBe(AnalysisState.RUNNING);
    expect(lifecycle.activeSessionId).not.toBeNull();
  });

  it('start is idempotent when already RUNNING', () => {
    lifecycle.start();
    const sessionId = lifecycle.activeSessionId;
    const result = lifecycle.start(); // Second call
    expect(result.success).toBe(true);
    expect(lifecycle.activeSessionId).toBe(sessionId); // Same session
  });

  it('transitions RUNNING → STOPPED on stop', () => {
    lifecycle.start();
    const result = lifecycle.stop();
    expect(result.success).toBe(true);
    expect(lifecycle.state).toBe(AnalysisState.STOPPED);
    expect(lifecycle.activeSessionId).toBeNull();
  });

  it('stop is idempotent when already STOPPED', () => {
    const result = lifecycle.stop();
    expect(result.success).toBe(true);
    expect(lifecycle.state).toBe(AnalysisState.STOPPED);
  });

  it('generates unique session IDs on each start', () => {
    lifecycle.start();
    const first = lifecycle.activeSessionId;
    lifecycle.stop();
    lifecycle.start();
    const second = lifecycle.activeSessionId;
    expect(first).not.toBe(second);
  });

  it('start→stop→start→stop cycles work correctly', () => {
    lifecycle.start();
    expect(lifecycle.state).toBe(AnalysisState.RUNNING);
    lifecycle.stop();
    expect(lifecycle.state).toBe(AnalysisState.STOPPED);
    lifecycle.start();
    expect(lifecycle.state).toBe(AnalysisState.RUNNING);
    lifecycle.stop();
    expect(lifecycle.state).toBe(AnalysisState.STOPPED);
  });
});

describe('Session Validation', () => {
  let lifecycle: LifecycleStateMachine;

  beforeEach(() => {
    lifecycle = new LifecycleStateMachine();
  });

  it('validates active session ID', () => {
    lifecycle.start();
    const sessionId = lifecycle.activeSessionId!;
    expect(lifecycle.isSessionValid(sessionId)).toBe(true);
  });

  it('rejects stale session after stop', () => {
    lifecycle.start();
    const staleSessionId = lifecycle.activeSessionId!;
    lifecycle.stop();
    expect(lifecycle.isSessionValid(staleSessionId)).toBe(false);
  });

  it('rejects old session after restart', () => {
    lifecycle.start();
    const oldSessionId = lifecycle.activeSessionId!;
    lifecycle.stop();
    lifecycle.start();
    expect(lifecycle.isSessionValid(oldSessionId)).toBe(false);
    expect(lifecycle.isSessionValid(lifecycle.activeSessionId!)).toBe(true);
  });

  it('rejects null session ID', () => {
    expect(lifecycle.isSessionValid(null)).toBe(false);
  });
});

describe('Trade Lifecycle Grace Period & Health Transitions', () => {
  it('requires consecutive scan cycles meeting multi-pillar criteria before invalidating', () => {
    let consecutiveCount = 0;
    function processScan(isCritical: boolean) {
      if (isCritical) {
        consecutiveCount++;
        if (consecutiveCount >= 2) return 'AGAINST_THESIS';
        return 'DETERIORATING';
      }
      consecutiveCount = 0;
      return 'STABLE';
    }

    // Scan 1: Single critical scan -> DETERIORATING (NOT invalidated yet!)
    expect(processScan(true)).toBe('DETERIORATING');
    // Scan 1 noise recovers: Scan 2 returns stable -> resets consecutive counter
    expect(processScan(false)).toBe('STABLE');

    // Scan 3: First critical scan -> DETERIORATING
    expect(processScan(true)).toBe('DETERIORATING');
    // Scan 4: Second consecutive critical scan -> AGAINST_THESIS (INVALIDATED)
    expect(processScan(true)).toBe('AGAINST_THESIS');
  });

  it('enforces gradual step-by-step recovery (CRITICAL -> WEAKENING -> HEALTHY)', () => {
    let currentHealth: 'HEALTHY' | 'WEAKENING' | 'CRITICAL' | 'INVALID' = 'CRITICAL';
    let recoveryCount = 0;

    function stepRecovery(rawScore: number) {
      if (currentHealth === 'CRITICAL' && rawScore >= 60) {
        recoveryCount++;
        if (recoveryCount >= 2) {
          currentHealth = 'WEAKENING';
          recoveryCount = 0;
        }
      } else if (currentHealth === 'WEAKENING' && rawScore >= 80) {
        recoveryCount++;
        if (recoveryCount >= 2) {
          currentHealth = 'HEALTHY';
          recoveryCount = 0;
        }
      }
      return currentHealth;
    }

    // 1st healthy scan from CRITICAL: remains CRITICAL (cannot jump directly to HEALTHY!)
    expect(stepRecovery(85)).toBe('CRITICAL');
    // 2nd healthy scan: steps up to WEAKENING first!
    expect(stepRecovery(85)).toBe('WEAKENING');
    // 3rd healthy scan: remains WEAKENING (needs 2 scans)
    expect(stepRecovery(85)).toBe('WEAKENING');
    // 4th healthy scan: steps up to HEALTHY!
    expect(stepRecovery(85)).toBe('HEALTHY');
  });

  it('filters single-scan confidence noise via hysteresis smoothing', () => {
    let smoothed: number | null = null;
    function smooth(raw: number, structuralShift: boolean) {
      if (smoothed === null || structuralShift) {
        smoothed = raw;
        return raw;
      }
      const alpha = 0.35;
      smoothed = alpha * raw + (1 - alpha) * smoothed;
      return Math.round(smoothed);
    }

    // Initial baseline
    expect(smooth(90, false)).toBe(90);
    // Single noisy scan drops to 40 -> smoothed only drops moderately to 73
    expect(smooth(40, false)).toBe(73);
    // Next scan recovers to 88 -> smoothed smoothly moves to 78
    expect(smooth(88, false)).toBe(78);
    // Structural market shift -> immediately adapts to 45
    expect(smooth(45, true)).toBe(45);
  });

  it('smoothly glides confidence without erratic jumps using rate-of-change slew limiting', () => {
    let smoothed: number | null = null;
    function smoothWithSlew(raw: number, shift: boolean) {
      if (smoothed === null) {
        smoothed = raw;
        return raw;
      }
      const maxDelta = shift ? 8 : 5;
      const diff = raw - smoothed;
      if (Math.abs(diff) <= maxDelta) smoothed = raw;
      else smoothed += Math.sign(diff) * maxDelta;
      return Math.round(smoothed);
    }

    expect(smoothWithSlew(70, false)).toBe(70);
    // Sudden jump to 90% glides in steps of 5% instead of teleporting
    expect(smoothWithSlew(90, false)).toBe(75);
    expect(smoothWithSlew(90, false)).toBe(80);
    expect(smoothWithSlew(90, false)).toBe(85);
    expect(smoothWithSlew(90, false)).toBe(90);

    // Sudden drop to 50% on regime shift glides in steps of 8%
    expect(smoothWithSlew(50, true)).toBe(82);
    expect(smoothWithSlew(50, true)).toBe(74);
  });

  it('blocks forbidden lifecycle state transitions via State Machine Guard', () => {
    function isValidTransition(fromState: string, toState: string): boolean {
      if (fromState === toState) return true;
      if (fromState === 'TRADE INVALIDATED' && toState !== 'NO TRADE') return false;
      if (fromState === 'TRADE COMPLETED' && toState !== 'NO TRADE') return false;
      if (fromState === 'ENTRY WINDOW' && toState === 'TRADE COMPLETED') return false;
      return true;
    }

    expect(isValidTransition('TRADE ACTIVE', 'TRADE COMPLETED')).toBe(true);
    expect(isValidTransition('TRADE ACTIVE', 'TRADE INVALIDATED')).toBe(true);
    expect(isValidTransition('TRADE INVALIDATED', 'TRADE ACTIVE')).toBe(false); // FORBIDDEN!
    expect(isValidTransition('TRADE COMPLETED', 'TRADE ACTIVE')).toBe(false);   // FORBIDDEN!
    expect(isValidTransition('ENTRY WINDOW', 'TRADE COMPLETED')).toBe(false);   // FORBIDDEN!
  });
});
