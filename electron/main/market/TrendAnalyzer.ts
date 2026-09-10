// ============================================================
// MARS PRO V3 — Trend Analyzer
// Determines trend direction from candle swing progression.
// ============================================================

import { CandleObservation, CandleDirection } from '../../../shared/types/scanner';
import { TrendEvidence, TrendDirection, SwingType } from '../../../shared/types/market';
import { MarketStructureAnalyzer } from './MarketStructureAnalyzer';

export class TrendAnalyzer {
  public analyze(candles: CandleObservation[]): TrendEvidence {
    return TrendAnalyzer.analyze(candles);
  }

  public static analyze(candles: CandleObservation[]): TrendEvidence {
    if (!candles || candles.length < 1) {
      return {
        direction: TrendDirection.NEUTRAL,
        strength: 0,
        swingProgression: [],
        candlesAnalyzed: candles ? candles.length : 0,
      };
    }

    const structureEvidence = MarketStructureAnalyzer.analyze(candles);
    const swings = structureEvidence.swingPoints;
    const swingProgression = swings.map((s) => s.type);

    if (swings.length < 2) {
      let bullishCount = 0;
      let bearishCount = 0;
      for (const candle of candles) {
        if (candle.direction === CandleDirection.BULLISH) bullishCount++;
        else if (candle.direction === CandleDirection.BEARISH) bearishCount++;
      }

      let direction = TrendDirection.NEUTRAL;
      let strength = 0;
      if (bullishCount > bearishCount * 1.5) {
        direction = TrendDirection.BULLISH;
        strength = 0.6;
      } else if (bearishCount > bullishCount * 1.5) {
        direction = TrendDirection.BEARISH;
        strength = 0.6;
      }

      return { direction, strength, swingProgression: [], candlesAnalyzed: candles.length };
    }

    const totalSwings = swings.length;
    let bullScore = 0;
    let bearScore = 0;

    swings.forEach((s) => {
      if (s.type === SwingType.HIGHER_HIGH || s.type === SwingType.HIGHER_LOW) bullScore++;
      if (s.type === SwingType.LOWER_HIGH || s.type === SwingType.LOWER_LOW) bearScore++;
    });

    let direction = TrendDirection.NEUTRAL;
    let strength = 0.5;

    if (bullScore > bearScore && bullScore >= totalSwings * 0.5) {
      direction = TrendDirection.BULLISH;
      strength = Math.min(1.0, 0.5 + bullScore / totalSwings * 0.5);
    } else if (bearScore > bullScore && bearScore >= totalSwings * 0.5) {
      direction = TrendDirection.BEARISH;
      strength = Math.min(1.0, 0.5 + bearScore / totalSwings * 0.5);
    }

    return {
      direction,
      strength,
      swingProgression,
      candlesAnalyzed: candles.length,
    };
  }
}
