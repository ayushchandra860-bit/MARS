import { PlatformMode } from '../../../shared/types/canonical';
import { TradingAction } from '../../../shared/types/decision';

export interface TrustedExecutionEvidence {
  executionId: string;
  eventId: string;
  action: TradingAction.BUY | TradingAction.SELL;
  asset: string | null;
  entryPrice: number | null;
  expirySeconds: number;
  platformMode: PlatformMode;
  capturedAt: number;
}

/**
 * Short-lived, main-process-only bridge between the validated browser event
 * and canonical trade registration. Renderer values are parsed before they
 * reach this registry, and the evidence is consumed exactly once.
 */
export class TrustedExecutionEvidenceRegistry {
  private static instance: TrustedExecutionEvidenceRegistry | null = null;
  private readonly evidence = new Map<string, TrustedExecutionEvidence>();
  private static readonly MAX_ENTRIES = 50;
  private static readonly RETENTION_MS = 10_000;

  private constructor() {}

  public static getInstance(): TrustedExecutionEvidenceRegistry {
    if (!TrustedExecutionEvidenceRegistry.instance) {
      TrustedExecutionEvidenceRegistry.instance = new TrustedExecutionEvidenceRegistry();
    }
    return TrustedExecutionEvidenceRegistry.instance;
  }

  public stage(input: TrustedExecutionEvidence): boolean {
    this.prune();
    const executionId = String(input.executionId || '').trim();
    const eventId = String(input.eventId || '').trim();
    if (!executionId || !eventId) return false;
    if (input.action !== TradingAction.BUY && input.action !== TradingAction.SELL) return false;

    const price = Number(input.entryPrice);
    const expiry = Number(input.expirySeconds);
    const platformMode = Object.values(PlatformMode).includes(input.platformMode)
      ? input.platformMode
      : PlatformMode.UNKNOWN;
    this.evidence.set(executionId, {
      executionId,
      eventId,
      action: input.action,
      asset: typeof input.asset === 'string' && input.asset.trim() ? input.asset.trim() : null,
      entryPrice: Number.isFinite(price) && price > 0 ? price : null,
      expirySeconds: Number.isFinite(expiry) && expiry > 0
        ? Math.min(24 * 60 * 60, Math.round(expiry))
        : 60,
      platformMode,
      capturedAt: Date.now(),
    });

    while (this.evidence.size > TrustedExecutionEvidenceRegistry.MAX_ENTRIES) {
      const oldest = this.evidence.keys().next().value as string | undefined;
      if (!oldest) break;
      this.evidence.delete(oldest);
    }
    return true;
  }

  public consume(executionId: string): TrustedExecutionEvidence | null {
    this.prune();
    const key = String(executionId || '').trim();
    const value = key ? this.evidence.get(key) : undefined;
    if (!value) return null;
    this.evidence.delete(key);
    return { ...value };
  }

  public discard(executionId: string): void {
    this.evidence.delete(String(executionId || '').trim());
  }

  public clear(): void {
    this.evidence.clear();
  }

  private prune(now = Date.now()): void {
    for (const [key, value] of this.evidence) {
      if (now - value.capturedAt > TrustedExecutionEvidenceRegistry.RETENTION_MS) {
        this.evidence.delete(key);
      }
    }
  }
}
