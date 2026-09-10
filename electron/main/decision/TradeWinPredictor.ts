// ============================================================
// MARS PRO V3 — Trade Win Predictor
// Estimates the win probability of a trade AT ENTRY from the
// evidence available at that moment. This is a transparent,
// deterministic scoring model (not the journal calibrator — the
// calibrator stays the authoritative source for signal confidence).
// Base rate is 0.50 (coin flip); each aligned/un-aligned factor
// moves the estimate a bounded amount so it never overclaims.
// ============================================================

import { TradingAction } from '../../../shared/types/decision';
import { TrendDirection, MomentumLevel, VolatilityLevel, MarketRegime } from '../../../shared/types/market';

export interface TradeWinPredictionInput {
  direction: TradingAction;
  trendDirection: TrendDirection | null;
  momentum: MomentumLevel | null;
  volatility: VolatilityLevel | null;
  regime: MarketRegime | null;
  /** Distance from entry to nearest target (points). */
  targetPoints: number | null;
  /** Distance from entry to nearest stop (points). */
  stopPoints: number | null;
}

export function predictTradeWinProbability(input: TradeWinPredictionInput): number {
  const direction = input.direction;
  const isBuy = direction === TradingAction.BUY;
  const isSell = direction === TradingAction.SELL;
  if (!isBuy && !isSell) return 0.5;

  let score = 0.5;

  // 1. Trend alignment (±0.12)
  const trend = input.trendDirection;
  if (trend === TrendDirection.BULLISH) score += isBuy ? 0.12 : -0.12;
  else if (trend === TrendDirection.BEARISH) score += isSell ? 0.12 : -0.12;
  // NEUTRAL / null → no adjustment

  // 2. Momentum conviction (±0.08)
  const momentum = input.momentum;
  if (momentum === MomentumLevel.STRONG) score += 0.08;
  else if (momentum === MomentumLevel.MODERATE) score += 0.04;
  else if (momentum === MomentumLevel.WEAK) score -= 0.04;

  // 3. Regime alignment (±0.05)
  const regime = input.regime;
  if (regime === MarketRegime.TRENDING) score += 0.05;
  else if (regime === MarketRegime.BREAKOUT) score += 0.03;
  else if (regime === MarketRegime.RANGING || regime === MarketRegime.CHOPPY) score -= 0.05;

  // 4. Risk:Reward — room to target vs room to stop (±0.10)
  const target = input.targetPoints;
  const stop = input.stopPoints;
  if (typeof target === 'number' && target > 0 && typeof stop === 'number' && stop > 0) {
    const rr = target / stop;
    const rrBonus = Math.max(-0.08, Math.min(0.10, (rr - 1) * 0.04));
    score += rrBonus;
  }

  // 5. Volatility noise penalty (±0.03)
  const volatility = input.volatility;
  if (volatility === VolatilityLevel.HIGH) score -= 0.03;
  else if (volatility === VolatilityLevel.LOW) score += 0.02;

  // Honest bounds: never overclaim, floor at coin-flip minus a small penalty.
  return Math.round(Math.max(0.45, Math.min(0.90, score)) * 100) / 100;
}
