// ============================================================
// MARS PRO V3 — Canonical Evidence Engine
// Synthesizes signal strength from all market indicators
// with dynamic weight normalization (no fake 0.5 default diluting missing indicators).
// ============================================================

import { MarketObservation } from '../../../shared/types/observation';
import { EvidenceBreakdown } from '../../../shared/types/decision';
import { QualityLevel } from '../../../shared/types/scanner';
import {
  MomentumLevel,
  TrendDirection,
  VolatilityLevel,
  MarketBias,
  MarketRegime,
  MarketStructure,
  SRInteractionState,
} from '../../../shared/types/market';

export class EvidenceEngine {
  public evaluate(observation: MarketObservation): EvidenceBreakdown {
    const trendScore = this.evaluateTrend(observation);
    const momentumScore = this.evaluateMomentum(observation);
    const structureScore = this.evaluateStructure(observation);
    const volatilityScore = this.evaluateVolatility(observation);
    const supportResistanceScore = this.evaluateSupportResistance(observation);
    const candleConfirmationScore = this.evaluateCandleConfirmation(observation);
    const patternScore = this.evaluatePattern(observation);
    const dataQualityScore = this.evaluateDataQuality(observation.dataQuality);
    const rsiScore = this.evaluateRsi(observation);
    const bollingerScore = this.evaluateBollinger(observation);
    const fibonacciScore = this.evaluateFibonacci(observation);
    const emaScore = this.evaluateEma(observation);

    const bullishFactors = this.countBias(observation, MarketBias.BULLISH);
    const bearishFactors = this.countBias(observation, MarketBias.BEARISH);
    const totalDirectionalFactors = bullishFactors + bearishFactors;
    const maxDirectional = Math.max(bullishFactors, bearishFactors);

    let agreementScore: number | null = null;
    if (totalDirectionalFactors > 0) {
      const rawRatio = maxDirectional / totalDirectionalFactors;
      const depthFactor = totalDirectionalFactors >= 3 ? 1.0 : (totalDirectionalFactors === 2 ? 0.85 : 0.70);
      agreementScore = rawRatio * depthFactor;
    }

    // Adaptive Weighted combination based on Market Regime
    const rawWeights = this.getRegimeWeights(observation.marketRegime);

    // Dynamic weight re-normalization: only allocate weight to available indicators
    const factors: Array<{ score: number | null; weight: number }> = [
      { score: trendScore, weight: rawWeights.trend },
      { score: momentumScore, weight: rawWeights.momentum },
      { score: structureScore, weight: rawWeights.structure },
      { score: volatilityScore, weight: rawWeights.volatility },
      { score: supportResistanceScore, weight: rawWeights.sr },
      { score: candleConfirmationScore, weight: rawWeights.candle },
      { score: patternScore, weight: rawWeights.pattern },
      { score: dataQualityScore, weight: rawWeights.dataQuality },
      { score: rsiScore, weight: rawWeights.rsi },
      { score: bollingerScore, weight: rawWeights.bollinger },
      { score: fibonacciScore, weight: rawWeights.fibonacci },
      { score: emaScore, weight: rawWeights.ema },
    ];

    let totalActiveWeight = 0;
    let weightedSum = 0;

    for (const factor of factors) {
      if (factor.score !== null && factor.score !== undefined) {
        totalActiveWeight += factor.weight;
        weightedSum += factor.score * factor.weight;
      }
    }

    const overallStrength = totalActiveWeight > 0 ? Math.min(1, Math.max(0, weightedSum / totalActiveWeight)) : 0;

    return {
      trendScore,
      momentumScore,
      structureScore,
      volatilityScore,
      supportResistanceScore,
      candleConfirmationScore,
      patternScore,
      dataQualityScore,
      rsiScore,
      bollingerScore,
      fibonacciScore,
      emaScore,
      agreementScore,
      overallStrength,
    };
  }

  public countBias(observation: MarketObservation, targetBias: MarketBias): number {
    let count = 0;

    const trend = observation.trendEvidence?.direction;
    if (targetBias === MarketBias.BULLISH && trend === TrendDirection.BULLISH) count++;
    if (targetBias === MarketBias.BEARISH && trend === TrendDirection.BEARISH) count++;

    const structure = observation.structureEvidence?.structure;
    if (targetBias === MarketBias.BULLISH && (structure === MarketStructure.UPTREND || structure === MarketStructure.BREAKOUT_UP || structure === MarketStructure.PULLBACK_UP)) count++;
    if (targetBias === MarketBias.BEARISH && (structure === MarketStructure.DOWNTREND || structure === MarketStructure.BREAKOUT_DOWN || structure === MarketStructure.PULLBACK_DOWN)) count++;

    const qm = observation.quantitativeMetrics;
    if (qm?.rsi) {
      if (targetBias === MarketBias.BULLISH && qm.rsi.isOversold) count++;
      if (targetBias === MarketBias.BEARISH && qm.rsi.isOverbought) count++;
    }

    if (qm?.bollingerBands) {
      if (targetBias === MarketBias.BULLISH && (qm.bollingerBands.touchLower || qm.bollingerBands.rejectionLower)) count++;
      if (targetBias === MarketBias.BEARISH && (qm.bollingerBands.touchUpper || qm.bollingerBands.rejectionUpper)) count++;
    }

    if (qm?.patterns) {
      if (targetBias === MarketBias.BULLISH && (qm.patterns.isBullishEngulfing || qm.patterns.isPinbarBullish)) count++;
      if (targetBias === MarketBias.BEARISH && (qm.patterns.isBearishEngulfing || qm.patterns.isPinbarBearish)) count++;
    }

    if (qm?.priceVsEmaTrend) {
      if (targetBias === MarketBias.BULLISH && qm.priceVsEmaTrend === 'BULLISH') count++;
      if (targetBias === MarketBias.BEARISH && qm.priceVsEmaTrend === 'BEARISH') count++;
    }

    return count;
  }

  private evaluateTrend(observation: MarketObservation): number {
    const trend = observation.trendEvidence;
    if (!trend) return 0.3;
    if (trend.direction === TrendDirection.NEUTRAL) return 0.2;
    return Math.min(1, Math.max(0, trend.strength || 0.5));
  }

  private evaluateMomentum(observation: MarketObservation): number {
    const momentum = observation.momentumEvidence;
    if (!momentum) return 0.3;
    switch (momentum.level) {
      case MomentumLevel.STRONG: return 0.9;
      case MomentumLevel.MODERATE: return 0.6;
      case MomentumLevel.WEAK: return 0.2;
      default: return 0.3;
    }
  }

  private evaluateStructure(observation: MarketObservation): number {
    const structure = observation.structureEvidence;
    if (!structure) return 0.3;
    switch (structure.structure) {
      case MarketStructure.UPTREND:
      case MarketStructure.DOWNTREND:
        return 0.85;
      case MarketStructure.BREAKOUT_UP:
      case MarketStructure.BREAKOUT_DOWN:
        return 0.90;
      case MarketStructure.PULLBACK_UP:
      case MarketStructure.PULLBACK_DOWN:
        return 0.70;
      case MarketStructure.CONSOLIDATION:
        return 0.25;
      default:
        return 0.20;
    }
  }

  private evaluateVolatility(observation: MarketObservation): number {
    const vol = observation.volatilityEvidence;
    if (!vol) return 0.5;
    switch (vol.level) {
      case VolatilityLevel.NORMAL: return 0.8;
      case VolatilityLevel.LOW: return 0.5;
      case VolatilityLevel.HIGH: return 0.4;
      default: return 0.5;
    }
  }

  private evaluateSupportResistance(observation: MarketObservation): number {
    const sr = observation.supportResistanceEvidence;
    if (!sr) return 0.3;
    let score = 0.4;
    if (sr.nearestSupport || sr.nearestResistance) score += 0.3;
    const activeLevel = sr.nearestSupport || sr.nearestResistance;
    if (activeLevel) {
      if (activeLevel.interactionState === SRInteractionState.TESTING) score += 0.15;
      if (activeLevel.interactionState === SRInteractionState.HELD || activeLevel.interactionState === SRInteractionState.REJECTED) score += 0.2;
    }
    return Math.min(1, score);
  }

  private evaluateCandleConfirmation(observation: MarketObservation): number {
    const candles = observation.candles;
    if (!candles || candles.length < 3) return 0.2;
    const recent = candles.slice(-3);
    const avgQuality = recent.reduce((sum, c) => sum + (c.quality || 0), 0) / recent.length;
    return Math.min(1, avgQuality);
  }

  private evaluatePattern(observation: MarketObservation): number {
    const patterns = observation.patternEvidence?.patterns;
    if (!patterns || patterns.length === 0) return 0.3;
    const maxConf = Math.max(...patterns.map((p) => p.confidence || 0));
    return Math.min(1, Math.max(0.3, maxConf));
  }

  private evaluateDataQuality(quality: QualityLevel): number {
    switch (quality) {
      case QualityLevel.HIGH: return 1.0;
      case QualityLevel.ACCEPTABLE: return 0.75;
      case QualityLevel.LOW: return 0.45;
      default: return 0.1;
    }
  }

  // ---- Quantitative Indicator Scores (Returns null when not present) ----

  private evaluateRsi(observation: MarketObservation): number | null {
    const rsi = observation.quantitativeMetrics?.rsi;
    if (!rsi) return null;
    if (rsi.isOversold || rsi.isOverbought) return 0.9;
    if (rsi.value < 35 || rsi.value > 65) return 0.7;
    return 0.4;
  }

  private evaluateBollinger(observation: MarketObservation): number | null {
    const bb = observation.quantitativeMetrics?.bollingerBands;
    if (!bb) return null;
    let score = 0.3;
    if (bb.isSqueeze) score += 0.3;
    if (bb.touchUpper || bb.touchLower) score += 0.2;
    if (bb.rejectionUpper || bb.rejectionLower) score += 0.2;
    return Math.min(1, score);
  }

  private evaluateFibonacci(observation: MarketObservation): number | null {
    const fib = observation.quantitativeMetrics?.fibonacci;
    if (!fib) return null;
    if (fib.inGoldenZone) return 0.9;
    if (fib.closestLevel && fib.closestLevel !== 'none') return 0.6;
    return 0.3;
  }

  private evaluateEma(observation: MarketObservation): number | null {
    const ema = observation.quantitativeMetrics?.priceVsEmaTrend;
    if (!ema) return null;
    if (ema === 'NEUTRAL') return 0.4;
    return 0.8;
  }

  private getRegimeWeights(regime?: MarketRegime | null) {
    switch (regime) {
      case MarketRegime.TRENDING:
        return {
          trend: 0.24,
          momentum: 0.20,
          structure: 0.14,
          volatility: 0.04,
          sr: 0.08,
          candle: 0.06,
          pattern: 0.04,
          dataQuality: 0.03,
          rsi: 0.04,
          bollinger: 0.05,
          fibonacci: 0.02,
          ema: 0.06,
        };
      case MarketRegime.RANGING:
        return {
          trend: 0.04,
          momentum: 0.04,
          structure: 0.08,
          volatility: 0.04,
          sr: 0.24,
          candle: 0.08,
          pattern: 0.06,
          dataQuality: 0.04,
          rsi: 0.18,
          bollinger: 0.14,
          fibonacci: 0.04,
          ema: 0.02,
        };
      case MarketRegime.HIGH_VOLATILITY:
      case MarketRegime.CHOPPY:
        return {
          trend: 0.10,
          momentum: 0.16,
          structure: 0.18,
          volatility: 0.20,
          sr: 0.10,
          candle: 0.04,
          pattern: 0.04,
          dataQuality: 0.08,
          rsi: 0.04,
          bollinger: 0.04,
          fibonacci: 0.01,
          ema: 0.01,
        };
      case MarketRegime.BREAKOUT:
        return {
          trend: 0.14,
          momentum: 0.24,
          structure: 0.18,
          volatility: 0.04,
          sr: 0.04,
          candle: 0.08,
          pattern: 0.04,
          dataQuality: 0.03,
          rsi: 0.02,
          bollinger: 0.16,
          fibonacci: 0.01,
          ema: 0.02,
        };
      default:
        return {
          trend: 0.18,
          momentum: 0.14,
          structure: 0.12,
          volatility: 0.08,
          sr: 0.08,
          candle: 0.08,
          pattern: 0.05,
          dataQuality: 0.03,
          rsi: 0.10,
          bollinger: 0.08,
          fibonacci: 0.04,
          ema: 0.02,
        };
    }
  }
}