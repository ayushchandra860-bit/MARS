// ============================================================
// MARS PRO V3 — Canonical Decision Engine
// Confluence of trend, momentum, RSI, Bollinger, Fibonacci,
// EMA, structure, pattern, and regime evidence produces deliberate,
// symmetric BUY/SELL signals with entry timing and lifecycle tracking.
// Absence of confluence is an explicit, honest WAIT.
// ============================================================

import {
  TradingAction,
  RiskLevel,
  WaitReason,
  RawDecisionResult,
  EvidenceBreakdown,
} from '../../../shared/types/decision';
import {
  TrendDirection,
  MomentumLevel,
  VolatilityLevel,
  MarketBias,
  MarketStructure,
  MarketRegime,
} from '../../../shared/types/market';
import { QualityLevel, CandleDirection } from '../../../shared/types/scanner';
import { MarketObservation } from '../../../shared/types/observation';
import {
  AnalysisMode,
  CanonicalConfidence,
  CanonicalRisk,
  fromLegacyMode,
} from '../../../shared/types/canonical';
import { EvidenceEngine } from './EvidenceEngine';
import { RiskEngine } from './RiskEngine';
import { ExpiryEngine } from './ExpiryEngine';
import { MarketRegimeAnalyzer } from '../market/MarketRegimeAnalyzer';

export interface CalibrationProfile {
  minThreshold: number;
  entryHysteresis: number;
  exitHysteresis: number;
  minEvidenceForEntry: number;
  minQuantForRelax: number;
  confirmationFrames: number;
  highStrengthOverride: number;
}

export class DecisionEngine {
  private evidenceEngine = new EvidenceEngine();
  private riskEngine = new RiskEngine();
  private expiryEngine = new ExpiryEngine();
  private calibrationMode: AnalysisMode = AnalysisMode.BALANCED;
  private pendingEntryWindow: { targetTime: number; action: TradingAction; reason: string } | null = null;
  private frameCount = 0;

  /**
   * Fixed calibration profiles per analysis mode.
   * SAFE: Strictest data-quality, strongest confirmation, fewest signals.
   * BALANCED: Moderate threshold, balanced signal frequency.
   * COMPREHENSIVE: Widest evidence, broader context, more opportunities.
   */
  public static readonly CALIBRATION_PROFILES: Record<AnalysisMode, CalibrationProfile> = {
    [AnalysisMode.SAFE]: {
      minThreshold: 0.85,
      entryHysteresis: 0.48,
      exitHysteresis: 0.38,
      minEvidenceForEntry: 0.65,
      minQuantForRelax: 0.70,
      confirmationFrames: 5,
      highStrengthOverride: 0.90,
    },
    [AnalysisMode.BALANCED]: {
      minThreshold: 0.70,
      entryHysteresis: 0.48,
      exitHysteresis: 0.38,
      minEvidenceForEntry: 0.60,
      minQuantForRelax: 0.65,
      confirmationFrames: 2,
      highStrengthOverride: 0.80,
    },
    [AnalysisMode.COMPREHENSIVE]: {
      minThreshold: 0.60,
      entryHysteresis: 0.42,
      exitHysteresis: 0.32,
      minEvidenceForEntry: 0.50,
      minQuantForRelax: 0.55,
      confirmationFrames: 1,
      highStrengthOverride: 0.70,
    },
  };

  public setCalibrationMode(mode: AnalysisMode | string): void {
    if (typeof mode === 'string') {
      this.calibrationMode = fromLegacyMode(mode);
    } else {
      this.calibrationMode = mode;
    }
  }

  public getCalibrationMode(): AnalysisMode {
    return this.calibrationMode;
  }

  public profile(): CalibrationProfile {
    return DecisionEngine.CALIBRATION_PROFILES[this.calibrationMode] || DecisionEngine.CALIBRATION_PROFILES[AnalysisMode.BALANCED];
  }

  public getEvidenceEngine(): EvidenceEngine {
    return this.evidenceEngine;
  }

  public reset(): void {
    this.pendingEntryWindow = null;
    this.frameCount = 0;
  }

  /**
   * Primary decision method. Evaluates market observation and returns canonical RawDecisionResult.
   */
  public decide(
    obs: MarketObservation | null | undefined,
    enabledExpiries?: string[],
    currentStableAction: TradingAction = TradingAction.WAIT
  ): RawDecisionResult {
    const timestamp = Date.now();
    this.frameCount++;

    if (!obs || !obs.candles || obs.candles.length < 3 || !obs.asset) {
      return this.wait(
        WaitReason.DATA_NOT_READY,
        0,
        null,
        null,
        MarketBias.NEUTRAL,
        null,
        obs?.dataQuality || QualityLevel.FAILED,
        timestamp,
        obs?.observationId
      );
    }

    const trend = obs.trendEvidence?.direction || TrendDirection.NEUTRAL;
    const structure = obs.structureEvidence?.structure || MarketStructure.INSUFFICIENT_DATA;
    const momentum = obs.momentumEvidence?.level || MomentumLevel.WEAK;
    const volatility = obs.volatilityEvidence?.level || VolatilityLevel.HIGH;
    const evidence = this.evidenceEngine.evaluate(obs);
    const regime = obs.marketRegime || this.deriveRegime(obs);
    const expiry = this.expiryEngine.recommend(
      obs.timeframe,
      volatility,
      momentum,
      (enabledExpiries as any) || ['auto'],
      regime
    );
    const quantResult = this.computeQuantConfluence(obs);
    const quantConfluence = quantResult.score;
    const directionalDepth = this.getDirectionalDepth(obs);

    // Dynamic WAIT Score: continuously evaluates setup readiness from 15% to 88%
    const rawWaitRatio = (
      evidence.overallStrength * 0.40 +
      (evidence.agreementScore || 0) * 0.30 +
      (quantConfluence || 0.5) * 0.20 +
      Math.min(1, directionalDepth / 4) * 0.10
    );
    const waitConfidence: CanonicalConfidence = Math.max(0.15, Math.min(0.88, Math.round(rawWaitRatio * 100) / 100));

    // Trend strength filter
    const trendStrengthWait = this.getTrendStrengthWaitReason(obs);
    if (trendStrengthWait) {
      return this.wait(
        trendStrengthWait,
        evidence.overallStrength,
        waitConfidence,
        RiskLevel.HIGH,
        MarketBias.NEUTRAL,
        expiry,
        obs.dataQuality,
        timestamp,
        obs.observationId
      );
    }

    const quantBias = quantResult.bias;
    const expirySec = ExpiryEngine.labelToSeconds(expiry) || 60;
    const tfSec = ExpiryEngine.timeframeToSeconds(obs.timeframe);
    const projectedCandles = Math.max(1, Math.round(expirySec / tfSec));
    const horizonSuitability = this.evaluateHorizonSuitability(obs, projectedCandles, momentum, structure);
    const risk = this.riskEngine.evaluate(obs, evidence, expirySec, regime);

    // WAIT Gate 1: No trend or insufficient data
    if (trend === TrendDirection.NEUTRAL && structure === MarketStructure.INSUFFICIENT_DATA) {
      return this.wait(
        WaitReason.SIDEWAYS_MARKET,
        evidence.overallStrength,
        waitConfidence,
        RiskLevel.HIGH,
        MarketBias.NEUTRAL,
        expiry,
        obs.dataQuality,
        timestamp,
        obs.observationId
      );
    }

    // WAIT Gate 2: Consolidation with no quantitative confluence
    const choppinessScore = obs.volatilityEvidence?.level === VolatilityLevel.HIGH && structure === MarketStructure.CONSOLIDATION ? 0.8 : 0.2;
    if ((structure === MarketStructure.CONSOLIDATION && quantConfluence < 0.55) || choppinessScore > 0.7) {
      return this.wait(
        WaitReason.SIDEWAYS_MARKET,
        evidence.overallStrength,
        waitConfidence,
        risk,
        MarketBias.NEUTRAL,
        expiry,
        obs.dataQuality,
        timestamp,
        obs.observationId
      );
    }

    // WAIT Gate 3: Weak momentum
    if (momentum === MomentumLevel.WEAK && quantConfluence < 0.6) {
      const mb = trend === TrendDirection.BULLISH ? MarketBias.BULLISH : trend === TrendDirection.BEARISH ? MarketBias.BEARISH : MarketBias.NEUTRAL;
      return this.wait(
        WaitReason.WEAK_MOMENTUM,
        evidence.overallStrength,
        waitConfidence,
        risk,
        mb,
        expiry,
        obs.dataQuality,
        timestamp,
        obs.observationId
      );
    }

    // WAIT Gate 4: Extreme volatility
    const profile = this.profile();
    if (volatility === VolatilityLevel.HIGH) {
      const isBreakout = regime === MarketRegime.BREAKOUT || structure === MarketStructure.BREAKOUT_UP || structure === MarketStructure.BREAKOUT_DOWN;
      const isStrongConfluence = quantConfluence >= profile.minQuantForRelax || evidence.overallStrength >= profile.minEvidenceForEntry;
      if (!isBreakout || !isStrongConfluence) {
        return this.wait(
          WaitReason.HIGH_VOLATILITY,
          evidence.overallStrength,
          waitConfidence,
          RiskLevel.HIGH,
          MarketBias.NEUTRAL,
          expiry,
          obs.dataQuality,
          timestamp,
          obs.observationId
        );
      }
    }

    // Confluence gates with Hysteresis
    const sensitivityBoost = this.getSensitivityBoost(obs);
    const isSignalActive = currentStableAction !== TradingAction.WAIT;
    const minConfluenceThreshold = (isSignalActive ? profile.exitHysteresis : profile.entryHysteresis) - sensitivityBoost;
    const agreement = evidence.agreementScore || 0;
    const hasStrongQuant = quantConfluence >= profile.minQuantForRelax;
    const hasStrongEvidence = evidence.overallStrength >= profile.minEvidenceForEntry && agreement >= 0.55;
    const hasBasicConfluence = evidence.overallStrength >= minConfluenceThreshold && agreement >= minConfluenceThreshold;

    if (!hasStrongQuant && !hasStrongEvidence && !hasBasicConfluence) {
      return this.wait(
        WaitReason.LOW_CONFIRMATION,
        evidence.overallStrength,
        waitConfidence,
        risk,
        MarketBias.NEUTRAL,
        expiry,
        obs.dataQuality,
        timestamp,
        obs.observationId
      );
    }

    if (directionalDepth < 3) {
      const strategicSetup = this.evaluateStrategicSetup(obs, regime, momentum, structure);
      if (strategicSetup) {
        const action = strategicSetup.direction;
        const reasons = [strategicSetup.type.replace(/_/g, ' ').toLowerCase() + ' — ' + (action === TradingAction.BUY ? 'bullish' : 'bearish') + ' entry'];
        const signalStrength = Math.max(strategicSetup.confidence, 0.70);
        const confidence: CanonicalConfidence = strategicSetup.confidence;
        if (signalStrength >= profile.minThreshold && confidence >= profile.minThreshold && risk !== RiskLevel.HIGH) {
          return {
            observationId: obs.observationId,
            action,
            reason: reasons[0],
            reasons,
            signalStrength,
            confidence,
            risk,
            marketBias: action === TradingAction.BUY ? MarketBias.BULLISH : MarketBias.BEARISH,
            recommendedExpiry: expiry,
            dataQuality: obs.dataQuality,
            timestamp,
          };
        }
      }
      return this.wait(
        WaitReason.LOW_CONFIRMATION,
        evidence.overallStrength,
        waitConfidence,
        risk,
        MarketBias.NEUTRAL,
        expiry,
        obs.dataQuality,
        timestamp,
        obs.observationId
      );
    }

    // Directional Determination — Symmetric BUY / SELL Evaluation
    const isRegimeBearish = regime === MarketRegime.TRENDING && trend === TrendDirection.BEARISH;
    const isRegimeBullish = regime === MarketRegime.TRENDING && trend === TrendDirection.BULLISH;

    const bullish =
      (trend === TrendDirection.BULLISH && !isRegimeBearish) ||
      (structure === MarketStructure.UPTREND && !isRegimeBearish) ||
      (structure === MarketStructure.BREAKOUT_UP) ||
      (quantConfluence >= 0.65 && quantBias === MarketBias.BULLISH && !isRegimeBearish);

    const bearish =
      (trend === TrendDirection.BEARISH && !isRegimeBullish) ||
      (structure === MarketStructure.DOWNTREND && !isRegimeBullish) ||
      (structure === MarketStructure.BREAKOUT_DOWN) ||
      (quantConfluence >= 0.65 && quantBias === MarketBias.BEARISH && !isRegimeBullish);

    if (bullish && bearish) {
      const detail = trend === TrendDirection.BULLISH ? 'Trend Bullish but Structure Bearish' : 'Trend Bearish but Structure Bullish';
      const reasonText = `${WaitReason.CONFLICTING_SIGNALS}: ${detail} - Awaiting Confluence`;
      return this.wait(reasonText, evidence.overallStrength, waitConfidence, risk, MarketBias.NEUTRAL, expiry, obs.dataQuality, timestamp, obs.observationId);
    }

    if (quantBias !== MarketBias.NEUTRAL && ((bullish && quantBias === MarketBias.BEARISH) || (bearish && quantBias === MarketBias.BULLISH))) {
      const reasonText = `${WaitReason.CONFLICTING_SIGNALS}: Quantitative indicators oppose market structure`;
      return this.wait(reasonText, evidence.overallStrength, waitConfidence, risk, MarketBias.NEUTRAL, expiry, obs.dataQuality, timestamp, obs.observationId);
    }

    if (!bullish && !bearish) {
      const reasonText = `${WaitReason.CONFLICTING_SIGNALS}: Trend Neutral & Structure Indecisive - Awaiting Breakout`;
      return this.wait(reasonText, evidence.overallStrength, waitConfidence, risk, MarketBias.NEUTRAL, expiry, obs.dataQuality, timestamp, obs.observationId);
    }

    const action = bullish ? TradingAction.BUY : TradingAction.SELL;
    const shortExpiryTrap = this.detectShortExpiryTrap(obs, action, expirySec, momentum, structure, regime);
    if (shortExpiryTrap) {
      const reasonText = `${WaitReason.LOW_CONFIRMATION}: ${shortExpiryTrap}`;
      return this.wait(reasonText, evidence.overallStrength, waitConfidence, risk, bullish ? MarketBias.BULLISH : MarketBias.BEARISH, expiry, obs.dataQuality, timestamp, obs.observationId);
    }

    // Extreme RSI Protection: block buying into extreme overbought (>= 78) or selling into extreme oversold (<= 22) unless breakout
    const isBreakout = regime === MarketRegime.BREAKOUT || structure === MarketStructure.BREAKOUT_UP || structure === MarketStructure.BREAKOUT_DOWN;
    const qmRsi = obs.quantitativeMetrics?.rsi;
    if (qmRsi && !isBreakout) {
      if (bullish && qmRsi.value >= 78) {
        const reasonText = `${WaitReason.CONFLICTING_SIGNALS}: RSI extreme overbought (${qmRsi.value.toFixed(0)}) — High Reversal Risk`;
        return this.wait(reasonText, evidence.overallStrength, waitConfidence, RiskLevel.HIGH, MarketBias.NEUTRAL, expiry, obs.dataQuality, timestamp, obs.observationId);
      }
      if (bearish && qmRsi.value <= 22) {
        const reasonText = `${WaitReason.CONFLICTING_SIGNALS}: RSI extreme oversold (${qmRsi.value.toFixed(0)}) — High Reversal Risk`;
        return this.wait(reasonText, evidence.overallStrength, waitConfidence, RiskLevel.HIGH, MarketBias.NEUTRAL, expiry, obs.dataQuality, timestamp, obs.observationId);
      }
    }

    const reasons = this.buildTradeReasons(obs, evidence, quantConfluence, bullish);
    const signalStrength = this.computeSignalStrength(obs, evidence, quantConfluence, regime, horizonSuitability);
    const confidence = this.computeConfidence(obs, evidence, risk, regime, horizonSuitability, action);

    // Mode-specific threshold gating
    const minThreshold = profile.minThreshold;
    if (confidence === null || signalStrength < minThreshold || confidence < minThreshold || risk === RiskLevel.HIGH) {
      return this.wait(
        WaitReason.LOW_CONFIRMATION,
        evidence.overallStrength,
        waitConfidence,
        risk,
        bullish ? MarketBias.BULLISH : MarketBias.BEARISH,
        expiry,
        obs.dataQuality,
        timestamp,
        obs.observationId
      );
    }

    return {
      observationId: obs.observationId,
      action,
      reason: reasons[0] || `Market evidence supports ${action}`,
      reasons,
      signalStrength,
      confidence,
      risk,
      marketBias: bullish ? MarketBias.BULLISH : MarketBias.BEARISH,
      recommendedExpiry: expiry,
      dataQuality: obs.dataQuality,
      timestamp,
    };
  }

  public evaluateEntryTiming(
    obs: MarketObservation,
    action: TradingAction,
    signalStrength: number,
    evidence: EvidenceBreakdown
  ): string {
    const profile = this.profile();
    if (signalStrength >= profile.minThreshold * 0.93 && (evidence.agreementScore || 0) >= 0.65) {
      return 'ENTRY NOW';
    }
    const sr = obs.supportResistanceEvidence;
    if (sr && obs.candles.length > 0) {
      const lastCandle = obs.candles[obs.candles.length - 1];
      if (lastCandle && action === TradingAction.BUY && sr.nearestSupport) {
        const dist = Math.abs(lastCandle.bodyBottomPx - sr.nearestSupport.pricePx);
        if (dist < 30) return 'ENTRY NOW';
      }
      if (lastCandle && action === TradingAction.SELL && sr.nearestResistance) {
        const dist = Math.abs(lastCandle.bodyBottomPx - sr.nearestResistance.pricePx);
        if (dist < 30) return 'ENTRY NOW';
      }
    }
    if (signalStrength >= 0.50) {
      return 'ENTRY IN 3s';
    }
    return 'ENTRY IN 5s';
  }

  public evaluateStrategicSetup(
    obs: MarketObservation,
    regime: MarketRegime,
    momentum: MomentumLevel,
    structure: MarketStructure
  ): { type: string; direction: TradingAction; confidence: number } | null {
    const sr = obs.supportResistanceEvidence;
    const qm = obs.quantitativeMetrics;
    const price = obs.currentPrice;
    if (!sr || !price || price <= 0) return null;

    // SETUP 1: Breakout Confirmation (Symmetric)
    if (regime === MarketRegime.BREAKOUT || structure === MarketStructure.BREAKOUT_UP || structure === MarketStructure.BREAKOUT_DOWN) {
      if (momentum === MomentumLevel.STRONG && qm?.rsi) {
        const rsi = qm.rsi.value;
        if (structure === MarketStructure.BREAKOUT_UP && rsi < 70) {
          return { type: 'BREAKOUT_CONFIRMED', direction: TradingAction.BUY, confidence: 0.78 };
        }
        if (structure === MarketStructure.BREAKOUT_DOWN && rsi > 30) {
          return { type: 'BREAKOUT_CONFIRMED', direction: TradingAction.SELL, confidence: 0.78 };
        }
      }
    }

    // SETUP 2: Pullback Entry (Symmetric)
    const trend = obs.trendEvidence?.direction || TrendDirection.NEUTRAL;
    if (trend !== TrendDirection.NEUTRAL && obs.candles.length >= 3) {
      const lastCandle = obs.candles[obs.candles.length - 1];
      const prevCandle = obs.candles[obs.candles.length - 2];
      if (lastCandle && prevCandle) {
        if (trend === TrendDirection.BULLISH && sr.nearestSupport) {
          const distToSupport = Math.abs(price - sr.nearestSupport.pricePx);
          const isNearSupport = distToSupport < 25;
          const isBullishCandle = lastCandle.direction === CandleDirection.BULLISH && lastCandle.bodySizePx > prevCandle.bodySizePx * 0.6;
          if (isNearSupport && isBullishCandle && regime !== MarketRegime.CHOPPY) {
            return { type: 'PULLBACK_ENTRY', direction: TradingAction.BUY, confidence: 0.75 };
          }
        }
        if (trend === TrendDirection.BEARISH && sr.nearestResistance) {
          const distToResistance = Math.abs(price - sr.nearestResistance.pricePx);
          const isNearResistance = distToResistance < 25;
          const isBearishCandle = lastCandle.direction === CandleDirection.BEARISH && lastCandle.bodySizePx > prevCandle.bodySizePx * 0.6;
          if (isNearResistance && isBearishCandle && regime !== MarketRegime.CHOPPY) {
            return { type: 'PULLBACK_ENTRY', direction: TradingAction.SELL, confidence: 0.75 };
          }
        }
      }
    }

    // SETUP 3: Squeeze Release (Symmetric)
    if (qm?.bollingerBands?.isSqueeze && momentum === MomentumLevel.STRONG) {
      const bias = qm.priceVsEmaTrend;
      if (bias === 'BULLISH') {
        return { type: 'SQUEEZE_RELEASE', direction: TradingAction.BUY, confidence: 0.72 };
      }
      if (bias === 'BEARISH') {
        return { type: 'SQUEEZE_RELEASE', direction: TradingAction.SELL, confidence: 0.72 };
      }
    }

    return null;
  }

  public evaluateHorizonSuitability(
    obs: MarketObservation,
    projectedCandles: number,
    momentum: MomentumLevel,
    structure: MarketStructure
  ): number {
    let suitability = 1.0;
    if (projectedCandles <= 3) {
      if (momentum === MomentumLevel.STRONG) suitability *= 1.10;
      else if (momentum === MomentumLevel.WEAK) suitability *= 0.75;
    } else if (projectedCandles >= 5) {
      if (obs.trendEvidence && obs.trendEvidence.strength >= 0.70) suitability *= 1.10;
      else if (obs.trendEvidence && obs.trendEvidence.strength < 0.40) suitability *= 0.75;
      if (structure === MarketStructure.CONSOLIDATION) suitability *= 0.70;
    }
    return Math.min(1.2, Math.max(0.5, suitability));
  }

  public computeSignalStrength(
    obs: MarketObservation,
    evidence: EvidenceBreakdown,
    quantConfluence: number,
    regime: MarketRegime,
    horizonSuitability = 1.0
  ): number {
    let base = evidence.overallStrength * 0.5 + (evidence.agreementScore || 0) * 0.3 + quantConfluence * 0.2;
    if (regime === MarketRegime.TRENDING) base += 0.05;
    else if (regime === MarketRegime.BREAKOUT) base += 0.08;
    else if (regime === MarketRegime.CHOPPY) base -= 0.05;
    else if (regime === MarketRegime.HIGH_VOLATILITY) base -= 0.10;

    const sr = obs.supportResistanceEvidence;
    if (sr) {
      const nearSup = sr.nearestSupport?.distancePts ?? Infinity;
      const nearRes = sr.nearestResistance?.distancePts ?? Infinity;
      if (nearSup < 30 || nearRes < 30) base += 0.04;
    }

    const recent = obs.candles.slice(-5);
    const highQuality = recent.filter((c) => c.quality >= 0.7).length;
    if (highQuality >= 4) base += 0.03;

    base *= Math.min(1.1, horizonSuitability);
    return Math.min(1, Math.max(0, base));
  }

  public computeConfidence(
    obs: MarketObservation,
    evidence: EvidenceBreakdown,
    risk: CanonicalRisk,
    regime: MarketRegime,
    horizonSuitability = 1.0,
    action: TradingAction = TradingAction.WAIT
  ): CanonicalConfidence {
    const pillarAgreement = evidence.agreementScore;
    if (pillarAgreement === null || pillarAgreement === undefined) {
      return null;
    }

    const riskPenalty = this.riskToPenalty(risk);
    const rrScore = this.computeRRScore(obs);
    const regimeAlignment = this.computeRegimeAlignment(obs, regime);

    let calibrated =
      pillarAgreement * 0.35 +
      evidence.overallStrength * 0.25 +
      (1 - riskPenalty) * 0.20 +
      rrScore * 0.10 +
      regimeAlignment * 0.10;

    calibrated *= horizonSuitability;

    if (regime === MarketRegime.HIGH_VOLATILITY || regime === MarketRegime.CHOPPY) {
      calibrated *= 0.85;
    }
    if (regime === MarketRegime.RANGING) {
      calibrated *= 0.92;
    }

    // Overbought / Oversold protection: Penalize buying at cyclical peaks and selling at cyclical bottoms
    const rsiVal = obs.quantitativeMetrics?.rsi?.value;
    if (typeof rsiVal === 'number') {
      if (action === TradingAction.BUY && rsiVal > 70) {
        // RSI > 70: Overbought risk penalty on BUY (e.g. at RSI 75: 10% penalty)
        const excess = rsiVal - 70;
        calibrated *= Math.max(0.70, 1 - excess * 0.02);
      } else if (action === TradingAction.SELL && rsiVal < 30) {
        // RSI < 30: Oversold risk penalty on SELL (e.g. at RSI 25: 10% penalty)
        const excess = 30 - rsiVal;
        calibrated *= Math.max(0.70, 1 - excess * 0.02);
      }
    }

    const trendStrength = obs.quantitativeMetrics?.trendStrength;
    if (trendStrength?.status === 'VALID' && trendStrength.adx != null && trendStrength.choppiness != null) {
      const strengthFactor = Math.max(0, Math.min(1, trendStrength.adx / 35));
      const chopFactor = Math.max(0, Math.min(1, (75 - trendStrength.choppiness) / 35));
      calibrated *= 0.75 + 0.25 * (strengthFactor * 0.6 + chopFactor * 0.4);
    }

    const CONFIDENCE_CEILING = 0.95;
    return Math.min(CONFIDENCE_CEILING, Math.max(0.40, calibrated));
  }

  public computeRRScore(obs: MarketObservation): number {
    const sr = obs.supportResistanceEvidence;
    if (!sr || !sr.nearestSupport || !sr.nearestResistance) return 0.5;
    const price = obs.currentPrice;
    if (!price || price <= 0) return 0.5;

    const distToSupport = Math.abs(price - sr.nearestSupport.pricePx);
    const distToResistance = Math.abs(sr.nearestResistance.pricePx - price);
    if (distToSupport === 0 && distToResistance === 0) return 0.5;

    const buyRR = distToSupport > 0 ? distToResistance / distToSupport : 0;
    const sellRR = distToResistance > 0 ? distToSupport / distToResistance : 0;
    const bestRR = Math.max(buyRR, sellRR);
    return Math.min(1, 0.25 + bestRR * 0.25);
  }

  public computeRegimeAlignment(obs: MarketObservation, regime: MarketRegime): number {
    const trend = obs.trendEvidence?.direction || TrendDirection.NEUTRAL;
    if (regime === MarketRegime.TRENDING && trend !== TrendDirection.NEUTRAL) return 0.9;
    if (regime === MarketRegime.BREAKOUT) return 0.85;
    if (regime === MarketRegime.RANGING || regime === MarketRegime.CHOPPY) return 0.4;
    if (regime === MarketRegime.HIGH_VOLATILITY) return 0.3;
    return 0.5;
  }

  public deriveRegime(obs: MarketObservation): MarketRegime {
    return MarketRegimeAnalyzer.analyze(
      obs.candles,
      obs.trendEvidence?.direction || TrendDirection.NEUTRAL,
      obs.volatilityEvidence?.level || VolatilityLevel.HIGH,
      obs.momentumEvidence?.level || MomentumLevel.WEAK
    );
  }

  public riskToPenalty(risk: CanonicalRisk): number {
    switch (risk) {
      case RiskLevel.LOW: return 0;
      case RiskLevel.MEDIUM: return 0.25;
      case RiskLevel.HIGH: return 0.60;
      default: return 0.30;
    }
  }

  public getSensitivityBoost(obs: MarketObservation): number {
    const regime = obs.marketRegime;
    if (regime === MarketRegime.TRENDING || regime === MarketRegime.BREAKOUT) return 0.03;
    return 0;
  }

  public getDirectionalDepth(obs: MarketObservation): number {
    let depth = this.evidenceEngine.countBias(obs, MarketBias.BULLISH) + this.evidenceEngine.countBias(obs, MarketBias.BEARISH);
    const recent = obs.candles.slice(-5);
    const bullishCandles = recent.filter((c) => c.direction === CandleDirection.BULLISH && c.quality >= 0.6).length;
    const bearishCandles = recent.filter((c) => c.direction === CandleDirection.BEARISH && c.quality >= 0.6).length;
    if (bullishCandles >= 4 || bearishCandles >= 4) depth++;
    return depth;
  }

  public detectShortExpiryTrap(
    obs: MarketObservation,
    action: TradingAction,
    expirySec: number,
    momentum: MomentumLevel,
    structure: MarketStructure,
    regime: MarketRegime
  ): string | null {
    if (expirySec > 60) return null;
    const isConfirmedBreakout = structure === MarketStructure.BREAKOUT_UP || structure === MarketStructure.BREAKOUT_DOWN || regime === MarketRegime.BREAKOUT;
    if ((regime === MarketRegime.RANGING || regime === MarketRegime.CHOPPY) && !isConfirmedBreakout) {
      return 'short-expiry skipped in ranging/choppy market; waiting for breakout or clean retest';
    }

    const recent = obs.candles.slice(-5).filter((c) => c.quality >= 0.55);
    if (recent.length < 4) return null;

    const bullishCount = recent.filter((c) => c.direction === CandleDirection.BULLISH).length;
    const bearishCount = recent.filter((c) => c.direction === CandleDirection.BEARISH).length;
    const avgBodyRatio = recent.reduce((sum, c) => sum + (c.rangePx > 0 ? c.bodySizePx / c.rangePx : 0), 0) / recent.length;
    const hasOppositePullback = action === TradingAction.BUY
      ? recent.slice(-2).some((c) => c.direction === CandleDirection.BEARISH)
      : recent.slice(-2).some((c) => c.direction === CandleDirection.BULLISH);

    const qm = obs.quantitativeMetrics;
    const rsiValue = qm?.rsi?.value;
    const nearResistance = obs.supportResistanceEvidence?.nearestResistance?.distancePts ?? Number.POSITIVE_INFINITY;
    const nearSupport = obs.supportResistanceEvidence?.nearestSupport?.distancePts ?? Number.POSITIVE_INFINITY;

    if (action === TradingAction.BUY &&
      momentum === MomentumLevel.STRONG &&
      (structure === MarketStructure.UPTREND || structure === MarketStructure.BREAKOUT_UP) &&
      bullishCount >= 4 &&
      avgBodyRatio >= 0.42 &&
      !hasOppositePullback) {
      return 'short-expiry buy skipped after extended bullish candle run; waiting for pullback/retest';
    }

    if (action === TradingAction.SELL &&
      momentum === MomentumLevel.STRONG &&
      (structure === MarketStructure.DOWNTREND || structure === MarketStructure.BREAKOUT_DOWN) &&
      bearishCount >= 4 &&
      avgBodyRatio >= 0.42 &&
      !hasOppositePullback) {
      return 'short-expiry sell skipped after extended bearish candle run; waiting for pullback/retest';
    }

    if (action === TradingAction.BUY && nearResistance <= 35) {
      return 'short-expiry buy skipped near resistance; reversal/pullback risk is high';
    }
    if (action === TradingAction.SELL && nearSupport <= 35) {
      return 'short-expiry sell skipped near support; bounce risk is high';
    }
    if (action === TradingAction.BUY && typeof rsiValue === 'number' && rsiValue >= 68) {
      return 'short-expiry buy skipped because RSI is already stretched';
    }
    if (action === TradingAction.SELL && typeof rsiValue === 'number' && rsiValue <= 32) {
      return 'short-expiry sell skipped because RSI is already stretched';
    }
    return null;
  }

  public getTrendStrengthWaitReason(obs: MarketObservation): WaitReason | null {
    const metrics = obs.quantitativeMetrics?.trendStrength;
    if (!metrics || metrics.status !== 'VALID' || metrics.adx == null || metrics.choppiness == null) {
      return null;
    }

    const thresholds = {
      [AnalysisMode.SAFE]: { minAdx: 22, maxChoppiness: 55, blockChoppiness: 64 },
      [AnalysisMode.BALANCED]: { minAdx: 18, maxChoppiness: 61.8, blockChoppiness: 68 },
      [AnalysisMode.COMPREHENSIVE]: { minAdx: 14, maxChoppiness: 68, blockChoppiness: 74 },
    }[this.calibrationMode];

    if (metrics.choppiness >= thresholds.blockChoppiness) {
      return WaitReason.CHOPPY_MARKET;
    }
    if (metrics.adx < thresholds.minAdx || metrics.choppiness > thresholds.maxChoppiness) {
      return WaitReason.WEAK_TREND_STRENGTH;
    }
    return null;
  }

  public computeQuantConfluence(obs: MarketObservation): { score: number; bias: MarketBias } {
    const qm = obs.quantitativeMetrics;
    if (!qm) return { score: 0, bias: MarketBias.NEUTRAL };

    let totalSignals = 0;
    let bullishSignals = 0;
    let bearishSignals = 0;

    if (qm.rsi) {
      if (qm.rsi.isOversold) { totalSignals++; bullishSignals++; }
      if (qm.rsi.isOverbought) { totalSignals++; bearishSignals++; }
    }

    if (qm.bollingerBands) {
      const rsiVal = qm.rsi?.value ?? 50;
      const rsiOversold = rsiVal < 35;
      const rsiOverbought = rsiVal > 65;
      if (qm.bollingerBands.touchLower && rsiOversold) { totalSignals++; bullishSignals++; }
      if (qm.bollingerBands.touchUpper && rsiOverbought) { totalSignals++; bearishSignals++; }
      if (qm.bollingerBands.rejectionLower) { totalSignals++; bullishSignals++; }
      if (qm.bollingerBands.rejectionUpper) { totalSignals++; bearishSignals++; }
    }

    if (qm.patterns) {
      if (qm.patterns.isBullishEngulfing || qm.patterns.isPinbarBullish) { totalSignals++; bullishSignals++; }
      if (qm.patterns.isBearishEngulfing || qm.patterns.isPinbarBearish) { totalSignals++; bearishSignals++; }
    }

    if (qm.priceVsEmaTrend === 'BULLISH') { totalSignals++; bullishSignals++; }
    if (qm.priceVsEmaTrend === 'BEARISH') { totalSignals++; bearishSignals++; }

    if (qm.fibonacci?.inGoldenZone) { totalSignals++; }

    if (totalSignals === 0) return { score: 0, bias: MarketBias.NEUTRAL };

    const maxSide = Math.max(bullishSignals, bearishSignals);
    const score = maxSide / totalSignals;
    let bias = MarketBias.NEUTRAL;
    if (bullishSignals > bearishSignals) bias = MarketBias.BULLISH;
    else if (bearishSignals > bullishSignals) bias = MarketBias.BEARISH;
    return { score, bias };
  }

  public buildTradeReasons(
    obs: MarketObservation,
    evidence: EvidenceBreakdown,
    quantConfluence: number,
    bullish: boolean
  ): string[] {
    const reasons: string[] = [];
    const dir = bullish ? 'Bullish' : 'Bearish';
    const qm = obs.quantitativeMetrics;
    const trend = obs.trendEvidence?.direction || TrendDirection.NEUTRAL;
    const isCounterTrend = (bullish && trend === TrendDirection.BEARISH) || (!bullish && trend === TrendDirection.BULLISH);
    const prefix = isCounterTrend ? 'Counter Trend Reversal: ' : '';

    const structure = obs.structureEvidence?.structure;
    if (structure && structure !== MarketStructure.INSUFFICIENT_DATA && structure !== MarketStructure.CONSOLIDATION) {
      const label = structure.replace(/_/g, ' ').toLowerCase();
      reasons.push(`${prefix}${dir} market structure confirms the active setup (${label})`);
    } else {
      reasons.push(`${prefix}${dir} setup detected across swing progression`);
    }

    const momentumLevel = obs.momentumEvidence?.level;
    const consistency = obs.momentumEvidence?.directionalConsistency;
    if (momentumLevel === MomentumLevel.STRONG) {
      reasons.push(`Strong momentum with ${Math.round((consistency || 0) * 100)}% directional candle agreement`);
    } else if (momentumLevel === MomentumLevel.MODERATE) {
      reasons.push(`Moderate momentum confirmed by ${Math.round((consistency || 0) * 100)}% directional consistency`);
    } else {
      reasons.push('Directional bias supported by candle body analysis');
    }

    if (qm?.rsi) {
      if (bullish && qm.rsi.isOversold) {
        reasons.push(`RSI at ${qm.rsi.value.toFixed(0)} - oversold bounce confirmation`);
      } else if (!bullish && qm.rsi.isOverbought) {
        reasons.push(`RSI at ${qm.rsi.value.toFixed(0)} - overbought pullback confirmation`);
      } else if (bullish && qm.rsi.isOverbought) {
        reasons.push(`RSI elevated at ${qm.rsi.value.toFixed(0)} — caution near overbought ceiling`);
      } else if (!bullish && qm.rsi.isOversold) {
        reasons.push(`RSI depressed at ${qm.rsi.value.toFixed(0)} — caution near oversold floor`);
      } else if (qm.rsi.status === 'NEUTRAL') {
        reasons.push(`RSI at ${qm.rsi.value.toFixed(0)} - neutral zone supports ${dir.toLowerCase()} continuation`);
      }
    }

    if (qm?.bollingerBands) {
      const bb = qm.bollingerBands;
      const rsiVal = qm.rsi?.value ?? 50;
      const rsiOversold = rsiVal < 35;
      const rsiOverbought = rsiVal > 65;
      if (bullish && bb.touchLower && rsiOversold) {
        reasons.push(`Lower Bollinger touch + RSI oversold (${rsiVal.toFixed(0)}) — double support`);
      } else if (!bullish && bb.touchUpper && rsiOverbought) {
        reasons.push(`Upper Bollinger touch + RSI overbought (${rsiVal.toFixed(0)}) — double resistance`);
      } else if (bb.isSqueeze) {
        reasons.push('Bollinger Band squeeze — breakout momentum building');
      } else if (bullish && bb.rejectionLower) {
        reasons.push('Lower Bollinger rejection — bullish reversal signal');
      } else if (!bullish && bb.rejectionUpper) {
        reasons.push('Upper Bollinger rejection — bearish reversal signal');
      }
    }

    if (qm?.fibonacci?.inGoldenZone) {
      reasons.push('Price in Fibonacci golden zone (0.5-0.618) - key retracement confluence');
    } else if (qm?.fibonacci?.closestLevel) {
      reasons.push(`Near Fibonacci ${qm.fibonacci.closestLevel} level - structural price alignment`);
    }

    if (qm?.priceVsEmaTrend === (bullish ? 'BULLISH' : 'BEARISH')) {
      reasons.push('Price aligned with EMA-20 trend direction');
    }

    if (qm?.patterns?.detectedPatterns?.length > 0) {
      const pattern = qm.patterns.detectedPatterns[qm.patterns.detectedPatterns.length - 1];
      reasons.push(`${pattern} candlestick pattern detected - entry confirmation`);
    }

    const pixelPattern = obs.patternEvidence?.patterns?.at(-1);
    if (pixelPattern && pixelPattern.direction === (bullish ? 'BULLISH' : 'BEARISH')) {
      if (!reasons.some((r) => r.includes('pattern detected'))) {
        reasons.push(`${pixelPattern.name} pattern confirms the ${dir.toLowerCase()} setup`);
      }
    }

    if (qm?.trendStrength?.status === 'VALID') {
      const ts = qm.trendStrength;
      reasons.push(`ADX ${ts.adx?.toFixed(1) ?? '—'} | Choppiness ${ts.choppiness?.toFixed(1) ?? '—'} — ${ts.gate.toLowerCase()} gate`);
    }

    const sr = obs.supportResistanceEvidence;
    if (sr?.nearestSupport && bullish) {
      reasons.push(`Holding above support level - ${sr.nearestSupport.interactionState.toLowerCase()} interaction`);
    } else if (sr?.nearestResistance && !bullish) {
      reasons.push(`Testing resistance level - ${sr.nearestResistance.interactionState.toLowerCase()} interaction`);
    }

    return reasons.slice(0, 5);
  }

  public wait(
    reason: string,
    signalStrength: number,
    confidence: CanonicalConfidence,
    risk: CanonicalRisk,
    marketBias: MarketBias,
    expiry: string | null,
    dataQuality: QualityLevel,
    timestamp: number,
    obsId?: string
  ): RawDecisionResult {
    return {
      observationId: obsId,
      action: TradingAction.WAIT,
      reason,
      reasons: [reason],
      signalStrength,
      confidence,
      risk,
      marketBias,
      recommendedExpiry: expiry,
      dataQuality,
      timestamp,
    };
  }
}