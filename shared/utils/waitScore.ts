/**
 * Normalizes a direct user-visible WAIT score. Every integer from 1 through
 * 100 is valid and preserved exactly; there is no hidden 95-point ceiling.
 */
export function normalizeWaitScore(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(100, Math.round(numeric)));
}

/** Converts a confidence fraction (0..1) into the direct WAIT 1..100 display score. */
export function confidenceToWaitScore(confidence: unknown): number {
  const numeric = Number(confidence);
  if (!Number.isFinite(numeric)) return 1;
  return normalizeWaitScore(numeric >= 0 && numeric <= 1 ? numeric * 100 : numeric);
}

export function formatWaitScore(value: unknown): string {
  return `WAIT ${normalizeWaitScore(value)}`;
}
