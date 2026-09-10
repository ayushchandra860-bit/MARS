// ============================================================
// MARS PRO V3 — Feature Extractor
// Extracts MarketObservation evidence components from candle data.
// ============================================================

import { MarketObservation } from '../../../shared/types/observation';
import { TrendAnalyzer } from './TrendAnalyzer';
import { QuantitativeEngine } from './QuantitativeEngine';
import { MarketStructureAnalyzer } from './MarketStructureAnalyzer';
import { SupportResistanceAnalyzer } from './SupportResistanceAnalyzer';
import { MomentumAnalyzer } from './MomentumAnalyzer';
import { VolatilityAnalyzer } from './VolatilityAnalyzer';
import { PatternAnalyzer } from './PatternAnalyzer';
import { MarketRegimeAnalyzer } from './MarketRegimeAnalyzer';

export class FeatureExtractor {
  private trendAnalyzer = new TrendAnalyzer();

  public extract(obs: MarketObservation): MarketObservation {
    return this.extractFeatures(obs);
  }

  public extractFeatures(obs: MarketObservation): MarketObservation {
    if (!obs || !obs.candles || obs.candles.length === 0) {
      return Object.freeze(obs);
    }

    const quant = QuantitativeEngine.calculate(obs.candles, obs.currentPrice);
    const trendEvidence = obs.trendEvidence || this.trendAnalyzer.analyze(obs.candles);
    const momentumEvidence = obs.momentumEvidence || MomentumAnalyzer.analyze(obs.candles);
    const volatilityEvidence = obs.volatilityEvidence || VolatilityAnalyzer.analyze(obs.candles);
    const structureEvidence = obs.structureEvidence || MarketStructureAnalyzer.analyze(obs.candles);
    const supportResistanceEvidence = obs.supportResistanceEvidence || SupportResistanceAnalyzer.analyze(obs.candles, structureEvidence.swingPoints);
    const patternEvidence = obs.patternEvidence || PatternAnalyzer.analyze(obs.candles);

    // Brain-only: classify market regime from extracted evidence
    const marketRegime = MarketRegimeAnalyzer.analyze(
      obs.candles,
      trendEvidence.direction,
      volatilityEvidence.level,
      momentumEvidence.level,
    );

    const immutableObs: MarketObservation = {
      ...obs,
      trendEvidence,
      momentumEvidence,
      volatilityEvidence,
      structureEvidence,
      supportResistanceEvidence,
      patternEvidence,
      quantitativeMetrics: quant,
      marketRegime,
    };

    return Object.freeze(immutableObs);
  }
}
