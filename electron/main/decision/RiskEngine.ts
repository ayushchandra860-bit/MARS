// ============================================================
// MARS PRO V3 — Canonical Risk Engine
// Symmetric risk assessment across volatility, agreement, market structure,
// data quality, and expiration horizon. Returns null when data is unassessed.
// ============================================================

import { MarketObservation } from '../../../shared/types/observation';
import { EvidenceBreakdown, RiskLevel } from '../../../shared/types/decision';
import { CanonicalRisk } from '../../../shared/types/canonical';
import { QualityLevel } from '../../../shared/types/scanner';
import { VolatilityLevel, TrendDirection, MarketRegime } from '../../../shared/types/market';

export class RiskEngine {
  public evaluate(
    observation: MarketObservation | null | undefined,
    evidence: EvidenceBreakdown | null | undefined,
    expirySeconds?: number | null,
    regime?: MarketRegime | null,
  ): CanonicalRisk {
    if (!observation || !evidence) {
      return null;
    }

    let highRiskFlags = 0;
    let mediumRiskFlags = 0;

    // 1. Data Quality
    if (observation.dataQuality === QualityLevel.FAILED || observation.dataQuality === QualityLevel.LOW) {
      highRiskFlags++;
    } else if (observation.dataQuality === QualityLevel.ACCEPTABLE) {
      mediumRiskFlags++;
    }

    // 2. Volatility (Breakout regime allows high volatility under medium risk)
    if (observation.volatilityEvidence) {
      if (observation.volatilityEvidence.level === VolatilityLevel.HIGH) {
        if (regime === MarketRegime.BREAKOUT) {
          mediumRiskFlags++;
        } else {
          highRiskFlags++;
        }
      } else if (observation.volatilityEvidence.level === VolatilityLevel.LOW) {
        mediumRiskFlags++;
      }
    } else {
      mediumRiskFlags++;
    }

    // 3. Evidence Agreement
    const agreement = evidence.agreementScore;
    if (agreement !== null && agreement !== undefined) {
      if (agreement < 0.3) {
        highRiskFlags++;
      } else if (agreement < 0.6) {
        mediumRiskFlags++;
      }
    } else {
      mediumRiskFlags++;
    }

    // 4. Overall Evidence Strength
    if (evidence.overallStrength < 0.4) {
      highRiskFlags++;
    } else if (evidence.overallStrength < 0.6) {
      mediumRiskFlags++;
    }

    // 5. Support/Resistance Conflict (Symmetric for Bullish & Bearish)
    if (observation.trendEvidence && observation.supportResistanceEvidence) {
      const { nearestSupport, nearestResistance } = observation.supportResistanceEvidence;
      const currentPricePx = observation.candles && observation.candles.length > 0
        ? observation.candles[observation.candles.length - 1].bodyBottomPx
        : null;

      if (currentPricePx !== null) {
        if (observation.trendEvidence.direction === TrendDirection.BULLISH && nearestResistance) {
          const distancePx = Math.abs(currentPricePx - nearestResistance.pricePx);
          if (distancePx < 20) highRiskFlags++;
          else if (distancePx < 50) mediumRiskFlags++;
        } else if (observation.trendEvidence.direction === TrendDirection.BEARISH && nearestSupport) {
          const distancePx = Math.abs(currentPricePx - nearestSupport.pricePx);
          if (distancePx < 20) highRiskFlags++;
          else if (distancePx < 50) mediumRiskFlags++;
        }
      }
    }

    // 6. Market Regime Risk Adjustment
    if (regime === MarketRegime.CHOPPY) {
      mediumRiskFlags++;
    } else if (regime === MarketRegime.HIGH_VOLATILITY) {
      highRiskFlags++;
    } else if (regime === MarketRegime.UNKNOWN) {
      mediumRiskFlags++;
    }

    // 7. Very short expiry increases risk
    if (expirySeconds !== null && expirySeconds !== undefined && expirySeconds <= 30) {
      mediumRiskFlags++;
    }

    if (highRiskFlags >= 1 || mediumRiskFlags >= 3) {
      return RiskLevel.HIGH;
    } else if (mediumRiskFlags >= 1) {
      return RiskLevel.MEDIUM;
    }

    return RiskLevel.LOW;
  }
}
