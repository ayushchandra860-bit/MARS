import fs from 'node:fs';
import path from 'node:path';

export const SAFE_GRAPHICS_ARG = '--mars-safe-gpu';
const STARTUP_WINDOW_MS = 10 * 60 * 1000;
const SAFE_MODE_DURATION_MS = 24 * 60 * 60 * 1000;

export interface GraphicsStartupState {
  inProgress: boolean;
  consecutiveFailures: number;
  lastAttemptAt: number;
  lastHealthyAt: number;
  safeModeUntil: number;
  lastFailureReason: string | null;
}

const EMPTY_STATE: GraphicsStartupState = {
  inProgress: false,
  consecutiveFailures: 0,
  lastAttemptAt: 0,
  lastHealthyAt: 0,
  safeModeUntil: 0,
  lastFailureReason: null,
};

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function normalizeGraphicsStartupState(value: unknown): GraphicsStartupState {
  if (!value || typeof value !== 'object') return { ...EMPTY_STATE };
  const state = value as Partial<GraphicsStartupState>;
  return {
    inProgress: state.inProgress === true,
    consecutiveFailures: Math.max(0, Math.min(10, Math.floor(finiteNumber(state.consecutiveFailures)))),
    lastAttemptAt: finiteNumber(state.lastAttemptAt),
    lastHealthyAt: finiteNumber(state.lastHealthyAt),
    safeModeUntil: finiteNumber(state.safeModeUntil),
    lastFailureReason: typeof state.lastFailureReason === 'string'
      ? state.lastFailureReason.slice(0, 200)
      : null,
  };
}

export class GraphicsStartupGuard {
  private state: GraphicsStartupState = { ...EMPTY_STATE };

  constructor(
    private readonly statePath: string,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.state = this.readState();
  }

  public beginAttempt(argv: readonly string[]): boolean {
    const now = this.now();
    const previousAttemptFailed = this.state.inProgress
      && this.state.lastAttemptAt > 0
      && now - this.state.lastAttemptAt <= STARTUP_WINDOW_MS;
    const consecutiveFailures = previousAttemptFailed
      ? this.state.consecutiveFailures + 1
      : this.state.consecutiveFailures;
    const explicitSafeMode = argv.includes(SAFE_GRAPHICS_ARG);
    const repeatedStartupFailure = consecutiveFailures >= 2;
    const timedSafeMode = this.state.safeModeUntil > now;
    const safeMode = explicitSafeMode || repeatedStartupFailure || timedSafeMode;

    this.state = {
      ...this.state,
      inProgress: true,
      consecutiveFailures,
      lastAttemptAt: now,
      safeModeUntil: repeatedStartupFailure
        ? Math.max(this.state.safeModeUntil, now + SAFE_MODE_DURATION_MS)
        : this.state.safeModeUntil,
      lastFailureReason: previousAttemptFailed
        ? (this.state.lastFailureReason || 'Previous startup did not reach a healthy renderer')
        : this.state.lastFailureReason,
    };
    this.writeState();
    return safeMode;
  }

  public recordGpuFailure(reason: string): void {
    const now = this.now();
    this.state = {
      ...this.state,
      inProgress: true,
      consecutiveFailures: Math.min(10, this.state.consecutiveFailures + 1),
      safeModeUntil: Math.max(this.state.safeModeUntil, now + SAFE_MODE_DURATION_MS),
      lastFailureReason: reason.slice(0, 200),
    };
    this.writeState();
  }

  public recordHealthy(safeMode: boolean): void {
    const now = this.now();
    this.state = {
      ...this.state,
      inProgress: false,
      consecutiveFailures: 0,
      lastHealthyAt: now,
      safeModeUntil: safeMode ? this.state.safeModeUntil : 0,
      lastFailureReason: safeMode ? this.state.lastFailureReason : null,
    };
    this.writeState();
  }

  public getState(): GraphicsStartupState {
    return { ...this.state };
  }

  private readState(): GraphicsStartupState {
    try {
      if (!fs.existsSync(this.statePath)) return { ...EMPTY_STATE };
      return normalizeGraphicsStartupState(JSON.parse(fs.readFileSync(this.statePath, 'utf8')));
    } catch {
      return { ...EMPTY_STATE };
    }
  }

  private writeState(): void {
    try {
      fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
      const tempPath = `${this.statePath}.tmp-${process.pid}`;
      fs.writeFileSync(tempPath, JSON.stringify(this.state), 'utf8');
      try {
        fs.renameSync(tempPath, this.statePath);
      } catch {
        try { if (fs.existsSync(this.statePath)) fs.unlinkSync(this.statePath); } catch {}
        fs.renameSync(tempPath, this.statePath);
      }
    } catch {}
  }
}
