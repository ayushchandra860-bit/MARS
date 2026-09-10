// ============================================================
// MARS PRO V3 — Market Regime Analyzer
// Classifies the broad market environment from candle geometry.
// Brain-only intelligence: helps interpret indicators correctly.
// ============================================================

import { CandleObservation, CandleDirection } from '../../../shared/types/scanner';
import { TrendDirection, MarketRegime, VolatilityLevel, MomentumLevel } from '../../../shared/types/market';
import { TrendAnalyzer } from './TrendAnalyzer';
import { MomentumAnalyzer } from './MomentumAnalyzer';
import { VolatilityAnalyzer } from './VolatilityAnalyzer';

export class MarketRegimeAnalyzer {
  /**
   * Classify the current market regime from candle observations.
   * Requires at least 5 candles for meaningful classification.
   */
  public static analyze(
    candles: CandleObservation[],
    trendDirection: TrendDirection,
    volatilityLevel: VolatilityLevel,
    momentumLevel: MomentumLevel,
  ): MarketRegime {
    if (!candles || candles.length < 5) {
      return MarketRegime.UNKNOWN;
    }

    const trendEvidence = TrendAnalyzer.analyze(candles);
    const momentumEvidence = MomentumAnalyzer.analyze(candles);
    const volatilityEvidence = VolatilityAnalyzer.analyze(candles);

    const dirConsistency = momentumEvidence.directionalConsistency;
    const avgBodyRatio = momentumEvidence.averageBodyRatio;
    const normRange = volatilityEvidence.normalizedRange;
    const rangeStdDev = volatilityEvidence.rangeStdDev;

    // 1. High Volatility: large ranges with high variance
    if (normRange > 3.0 && rangeStdDev > normRange * 0.4) {
      return MarketRegime.HIGH_VOLATILITY;
    }

    // 2. Trending: strong directional consistency + consistent body size
    if (trendDirection !== TrendDirection.NEUTRAL &&
        trendEvidence.strength >= 0.6 &&
        dirConsistency >= 0.55 &&
        avgBodyRatio >= 0.4) {
      return MarketRegime.TRENDING;
    }

    // 3. Breakout: strong momentum with recent expansion in candle size
    if (momentumLevel === MomentumLevel.STRONG &&
        momentumEvidence.acceleration > 0.3 &&
        avgBodyRatio >= 0.5) {
      return MarketRegime.BREAKOUT;
    }

    // 4. Ranging: low directional consistency, small bodies, low volatility
    if (dirConsistency < 0.4 &&
        avgBodyRatio < 0.35 &&
        normRange < 2.0 &&
        trendDirection === TrendDirection.NEUTRAL) {
      return MarketRegime.RANGING;
    }

    // 5. Choppy: moderate but inconsistent movement
    if (dirConsistency < 0.5 && normRange >= 2.0) {
      return MarketRegime.CHOPPY;
    }

    // Default fallback when candle data is present:
    // If directional trend exists, return TRENDING, otherwise RANGING
    if (trendDirection !== TrendDirection.NEUTRAL) {
      return MarketRegime.TRENDING;
    }

    return MarketRegime.RANGING;
  }
}
