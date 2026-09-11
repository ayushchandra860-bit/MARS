import { TradingAction, TradeOutcome } from '../../../shared/types/decision';

export interface ExpiringTradePriceEvidence {
  asset: string | null;
  direction: TradingAction;
  entryPrice?: string | null;
  expiryTimestamp: number;
}

export interface ExpiryObservationEvidence {
  asset?: string | null;
  currentPrice?: number | null;
  timestamp?: number | null;
}

export interface VerifiedPriceOutcome {
  outcome: TradeOutcome.WIN | TradeOutcome.LOSS | TradeOutcome.DRAW;
  completionPrice: string;
}

const EXPIRY_EARLY_TOLERANCE_MS = 2_000;
const EXPIRY_LATE_TOLERANCE_MS = 15_000;

export function normalizeAssetIdentity(value: string | null | undefined): string {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Conservative fallback when a broker result event is unavailable. It refuses
 * to create a label unless asset, time and both prices are independently usable.
 */
export function deriveVerifiedPriceOutcome(
  trade: ExpiringTradePriceEvidence,
  observation: ExpiryObservationEvidence | null | undefined,
): VerifiedPriceOutcome | null {
  if (!observation) return null;
  if (trade.direction !== TradingAction.BUY && trade.direction !== TradingAction.SELL) return null;

  const tradeAsset = normalizeAssetIdentity(trade.asset);
  const observationAsset = normalizeAssetIdentity(observation.asset);
  if (!tradeAsset || !observationAsset || tradeAsset !== observationAsset) return null;

  const entryPrice = Number(trade.entryPrice);
  const completionPrice = Number(observation.currentPrice);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  if (!Number.isFinite(completionPrice) || completionPrice <= 0) return null;

  const observedAt = Number(observation.timestamp);
  if (!Number.isFinite(observedAt)) return null;
  if (observedAt < trade.expiryTimestamp - EXPIRY_EARLY_TOLERANCE_MS) return null;
  if (observedAt > trade.expiryTimestamp + EXPIRY_LATE_TOLERANCE_MS) return null;

  const delta = completionPrice - entryPrice;
  const equalityTolerance = Math.max(Number.EPSILON * Math.max(entryPrice, completionPrice) * 8, 1e-12);
  const outcome = Math.abs(delta) <= equalityTolerance
    ? TradeOutcome.DRAW
    : trade.direction === TradingAction.BUY
      ? delta > 0 ? TradeOutcome.WIN : TradeOutcome.LOSS
      : delta < 0 ? TradeOutcome.WIN : TradeOutcome.LOSS;

  return { outcome, completionPrice: String(completionPrice) };
}
