// ============================================================
// MARS PRO V3 — Learning Dataset
// Preserves rich normalized evidence for offline training/calibration.
// Completely separate from Trader Signal History.
// ============================================================

import { MarketObservation } from '../../../shared/types/observation';
import { StabilizedDecision, TradeOutcome } from '../../../shared/types/decision';

export interface LearningSample {
  sampleId: string;
  timestamp: number;
  sessionId: string;
  modelVersion: string;
  asset: string | null;
  timeframe: string | null;
  decision: string;
  confidence: number | null;
  risk: string | null;
  recommendedExpiry: string | null;
  entryPricePx: number | null;
  expiryPricePx: number | null;
  outcome: TradeOutcome | null;
  // Normalized features for future ML training
  trendDirection: string | null;
  momentumLevel: string | null;
  volatilityLevel: string | null;
  marketBias: string | null;
  nearestSupportDistPx: number | null;
  nearestResistanceDistPx: number | null;
  candleCount: number;
}

export class LearningDataset {
  private samples: LearningSample[] = [];
  private readonly MAX_SAMPLES_IN_MEMORY = 500;

  public recordSample(
    observation: MarketObservation,
    decision: StabilizedDecision,
    modelVersion: string
  ): LearningSample {
    const sample: LearningSample = {
      sampleId: `sample-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: Date.now(),
      sessionId: observation.sessionId,
      modelVersion,
      asset: observation.asset,
      timeframe: observation.timeframe,
      decision: decision.action,
      confidence: typeof decision.confidence === 'number' ? Math.round(decision.confidence * 1000) / 10 : null,
      risk: decision.risk,
      recommendedExpiry: decision.recommendedExpiry,
      entryPricePx: observation.currentPrice !== null ? observation.currentPrice : null,
      expiryPricePx: null,
      outcome: null,
      trendDirection: observation.trendEvidence?.direction || null,
      momentumLevel: observation.momentumEvidence?.level || null,
      volatilityLevel: observation.volatilityEvidence?.level || null,
      marketBias: decision.marketBias,
      nearestSupportDistPx: observation.supportResistanceEvidence?.nearestSupport?.distancePts || null,
      nearestResistanceDistPx: observation.supportResistanceEvidence?.nearestResistance?.distancePts || null,
      candleCount: observation.candles.length,
    };

    this.samples.push(sample);
    if (this.samples.length > this.MAX_SAMPLES_IN_MEMORY) {
      this.samples.shift();
    }

    return sample;
  }

  public getUnresolvedSamples(): LearningSample[] {
    return this.samples.filter((s) => s.outcome === null && s.decision !== 'WAIT');
  }

  public getAllSamples(): LearningSample[] {
    return [...this.samples];
  }
}
