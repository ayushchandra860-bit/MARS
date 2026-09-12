// ============================================================
// MARS PRO V3 — Market Intel Engine (Phase 3.7 Architecture)
// Pure, deterministic backend module transforming existing market analysis
// into an immutable Readonly<MarketIntelState> object for Overlay.
// Calculates ZERO new indicators & alters ZERO trading decisions.
// ============================================================

import { MarketObservation } from '../../../shared/types/observation';
import { TradingAction, RiskLevel } from '../../../shared/types/decision';
import { MarketRegime, MomentumLevel, TrendDirection, StructuralLevel, MarketStructure } from '../../../shared/types/market';
import { MarketIntelInput, MarketIntelState } from '../../../shared/types/ipc';

export class MarketIntelEngine {
  /**
   * Source backend module mapping for developer debugging diagnostics
   */
  private static readonly SOURCE_MODULE_MAPPING: Record<string, string> = Object.freeze({
    regime: 'MarketRegimeAnalyzer',
    momentum: 'MomentumAnalyzer',
    structure: 'MarketStructureAnalyzer',
    liquidity: 'SupportResistanceAnalyzer',
    pressure: 'EvidenceEngine',
    support: 'SupportResistanceAnalyzer',
    resistance: 'SupportResistanceAnalyzer',
    reversalRisk: 'RiskEngine',
    nextExpectation: 'DecisionEngine',
  });

  /**
   * Deterministically evaluate input and return an immutable Readonly<MarketIntelState>
   */
  public evaluate(input: MarketIntelInput): Readonly<MarketIntelState> {
    const obs = input?.observation || null;
    const decision = input?.decision || null;
    const riskAssessment = input?.riskAssessment || null;
    const debugMode = Boolean(input?.debugMode);

    if (!obs) {
      return this.createScanningState(debugMode);
    }

    const regime = obs.marketRegime || null;
    const trend = input?.smoothedState?.trend || obs.trendEvidence?.direction || null;
    const momentum = input?.smoothedState?.momentum || obs.momentumEvidence?.level || null;
    const volatility = obs.volatilityEvidence?.level || null;
    const bias = decision?.marketBias || null;
    const action = decision?.action || TradingAction.WAIT;
    const reasons: string[] = decision?.reasons || [];
    const risk = riskAssessment?.level ?? decision?.risk ?? null;
    const confidence = decision?.confidence ?? null;

    const rawSupport = obs.supportResistanceEvidence?.nearestSupport || null;
    const rawResistance = obs.supportResistanceEvidence?.nearestResistance || null;

    // 1. Market Regime
    const regimeState = this.deriveRegime(regime, trend, momentum, volatility, bias);

    // 2. Momentum
    const momentumState = this.deriveMomentum(momentum, action, trend, bias);

    // 3. Market Structure
    const structureState = this.deriveStructure(obs, trend, reasons, momentum, volatility);

    // 4. Liquidity
    const liquidityState = this.deriveLiquidity(reasons, rawSupport, rawResistance);

    // 5. Market Pressure
    const pressureState = this.derivePressure(obs, bias, action, momentum);

    // 6. Support
    const supportState = this.formatLevel(rawSupport, 'SUPPORT', action);

    // 7. Resistance
    const resistanceState = this.formatLevel(rawResistance, 'RESISTANCE', action);

    // 8. Reversal Risk
    const reversalRiskState = this.deriveReversalRisk(risk, confidence);

    // 9. Next Expectation
    const nextExpectationState = this.deriveNextExpectation(action, regime, momentum, risk, reasons);

    // 10. Quantitative Calibrated Metrics (11 Probabilities & Feature Inferences)
    const aiMetrics = this.computeQuantFeatureMetrics(obs, action, risk, confidence);

    const state: MarketIntelState = {
      regime: Object.freeze(regimeState),
      momentum: Object.freeze(momentumState),
      structure: Object.freeze(structureState),
      liquidity: liquidityState,
      pressure: pressureState.label,
      pressureBuyPercent: pressureState.buyPercent,
      pressureSellPercent: pressureState.sellPercent,
      pressureSource: pressureState.source,
      trendStrength: typeof obs.quantitativeMetrics?.trendStrength?.adx === 'number'
        ? Math.round(Math.max(0, Math.min(100, obs.quantitativeMetrics.trendStrength.adx)))
        : null,
      trendStrengthStatus: obs.quantitativeMetrics?.trendStrength?.status === 'VALID'
        ? 'CALCULATED'
        : (obs.quantitativeMetrics?.trendStrength?.status === 'WARMING_UP' ? 'WARMING' : 'UNAVAILABLE'),
      support: Object.freeze(supportState),
      resistance: Object.freeze(resistanceState),
      reversalRisk: reversalRiskState,
      nextExpectation: Object.freeze(nextExpectationState),
      aiMetrics,
      ...(debugMode ? { debugMapping: MarketIntelEngine.SOURCE_MODULE_MAPPING } : {}),
    };

    return Object.freeze(state);
  }

  public async evaluateAsync(input: MarketIntelInput): Promise<Readonly<MarketIntelState>> {
    return new Promise((resolve) => {
      setImmediate(() => {
        const syncState = this.evaluate(input);
        resolve(syncState);
      });
    });
  }

  public computeQuantFeatureMetrics(
    obs: MarketObservation | null,
    action: TradingAction,
    risk: RiskLevel | null,
    confidence: number | null
  ) {
    if (!obs) {
      return {
        trendQuality: 0,
        momentumQuality: 0,
        volatilityScore: 0,
        marketRegime: 'ANALYZING',
        patternProbability: 0,
        structureConfidence: 0,
        reversalProbability: 0,
        breakoutProbability: 0,
        fakeoutProbability: 0,
        consolidationProbability: 0,
        noiseLevel: 0,
      };
    }

    const regime = obs.marketRegime || MarketRegime.RANGING;
    const candles = obs.candles || [];
    const candleCount = candles.length;
    const rsiVal = obs.quantitativeMetrics?.rsi?.value ?? 50;

    let trendQuality = 0.50;
    if (obs.trendEvidence) {
      trendQuality = Math.min(0.99, Math.max(0.20, obs.trendEvidence.strength));
    }

    let momentumQuality = 0.50;
    if (obs.momentumEvidence) {
      momentumQuality = obs.momentumEvidence.level === MomentumLevel.STRONG ? 0.88 : (obs.momentumEvidence.level === MomentumLevel.WEAK ? 0.35 : 0.60);
    }

    let volatilityScore = 0.45;
    if (obs.volatilityEvidence) {
      volatilityScore = obs.volatilityEvidence.level === 'HIGH' ? 0.85 : (obs.volatilityEvidence.level === 'LOW' ? 0.25 : 0.50);
    }

    let reversalProbability = 0.15;
    if (rsiVal < 30 || rsiVal > 70) reversalProbability += 0.35;
    if (risk === RiskLevel.HIGH) reversalProbability += 0.25;

    let breakoutProbability = 0.25;
    if (regime === MarketRegime.BREAKOUT) breakoutProbability = 0.85;
    else if (obs.quantitativeMetrics?.bollingerBands?.isSqueeze) breakoutProbability = 0.72;

    let fakeoutProbability = 0.12;
    if (regime === MarketRegime.CHOPPY || volatilityScore > 0.75) fakeoutProbability = 0.45;

    let consolidationProbability = 0.30;
    if (regime === MarketRegime.RANGING || regime === MarketRegime.CHOPPY) consolidationProbability = 0.78;

    let noiseLevel = 0.20;
    if (regime === MarketRegime.CHOPPY) noiseLevel = 0.65;
    else if (candleCount < 10) noiseLevel = 0.45;

    const patternProbability = Math.min(0.98, Math.max(0.40, (trendQuality * 0.4 + momentumQuality * 0.4 + (1 - noiseLevel) * 0.2)));
    const structureConfidence = Math.min(0.99, Math.max(0.35, (1 - fakeoutProbability) * 0.6 + (1 - noiseLevel) * 0.4));

    return {
      trendQuality: Number(trendQuality.toFixed(2)),
      momentumQuality: Number(momentumQuality.toFixed(2)),
      volatilityScore: Number(volatilityScore.toFixed(2)),
      marketRegime: String(regime),
      patternProbability: Number(patternProbability.toFixed(2)),
      structureConfidence: Number(structureConfidence.toFixed(2)),
      reversalProbability: Number(reversalProbability.toFixed(2)),
      breakoutProbability: Number(breakoutProbability.toFixed(2)),
      fakeoutProbability: Number(fakeoutProbability.toFixed(2)),
      consolidationProbability: Number(consolidationProbability.toFixed(2)),
      noiseLevel: Number(noiseLevel.toFixed(2)),
    };
  }

  private deriveRegime(
    regime: MarketRegime | null,
    trend: TrendDirection | null,
    momentum: MomentumLevel | null,
    volatility: any,
    bias: any,
  ): { primary: string; secondary?: string } {
    if (regime === MarketRegime.TRENDING) {
      if (trend === TrendDirection.BULLISH || bias === 'BULLISH') {
        return { primary: 'TRENDING BULLISH', secondary: momentum === MomentumLevel.STRONG ? 'STRONG MOMENTUM' : (momentum === MomentumLevel.WEAK ? 'WEAK MOMENTUM' : 'SUSTAINED') };
      }
      if (trend === TrendDirection.BEARISH || bias === 'BEARISH') {
        return { primary: 'TRENDING BEARISH', secondary: momentum === MomentumLevel.STRONG ? 'STRONG MOMENTUM' : (momentum === MomentumLevel.WEAK ? 'WEAK MOMENTUM' : 'SUSTAINED') };
      }
      return { primary: 'TRENDING', secondary: 'ACTIVE' };
    }

    if (regime === MarketRegime.RANGING) {
      return { primary: 'RANGING', secondary: 'SIDEWAYS' };
    }

    if (regime === MarketRegime.CHOPPY || volatility === 'HIGH') {
      return { primary: 'VOLATILE', secondary: 'UNSTABLE' };
    }

    if (regime === MarketRegime.BREAKOUT) {
      return { primary: 'BREAKOUT', secondary: 'VOLATILITY EXPANSION' };
    }

    if (trend === TrendDirection.BULLISH) {
      return { primary: 'TRENDING BULLISH', secondary: momentum === MomentumLevel.STRONG ? 'STRONG' : 'SUSTAINED' };
    }
    if (trend === TrendDirection.BEARISH) {
      return { primary: 'TRENDING BEARISH', secondary: momentum === MomentumLevel.STRONG ? 'STRONG' : 'SUSTAINED' };
    }

    return { primary: 'ANALYZING REGIME', secondary: 'SCANNING' };
  }

  private deriveMomentum(
    momentum: MomentumLevel | null,
    action: TradingAction,
    trend: TrendDirection | null,
    bias: any,
  ): { primary: string; secondary?: string } {
    if (!momentum) return { primary: 'ANALYZING MOMENTUM', secondary: 'STABLE' };

    if (momentum === MomentumLevel.STRONG) {
      if (action === TradingAction.BUY || trend === TrendDirection.BULLISH || bias === 'BULLISH') {
        return { primary: 'BUYERS DOMINATING', secondary: 'ACTIVE' };
      }
      if (action === TradingAction.SELL || trend === TrendDirection.BEARISH || bias === 'BEARISH') {
        return { primary: 'SELLERS DOMINATING', secondary: 'ACTIVE' };
      }
      return { primary: 'STRONG MOMENTUM', secondary: 'ACTIVE' };
    }

    if (momentum === MomentumLevel.MODERATE) {
      if (bias === 'BULLISH' || action === TradingAction.BUY) {
        return { primary: 'BUYERS PRESENT', secondary: 'STABLE' };
      }
      if (bias === 'BEARISH' || action === TradingAction.SELL) {
        return { primary: 'SELLERS PRESENT', secondary: 'STABLE' };
      }
      return { primary: 'MODERATE MOMENTUM', secondary: 'STABLE' };
    }

    if (momentum === MomentumLevel.WEAK) {
      return { primary: 'WEAK MOMENTUM', secondary: 'LOW VOLUME' };
    }

    return { primary: 'ANALYZING MOMENTUM', secondary: 'STABLE' };
  }

  private deriveStructure(
    obs: MarketObservation,
    trend: TrendDirection | null,
    reasons: string[],
    momentum: MomentumLevel | null,
    volatility: any,
  ): { primary: string; health?: string } {
    const struct = obs.structureEvidence?.structure;
    const reasonsStr = (reasons || []).join(' ').toUpperCase();

    if (struct === MarketStructure.UPTREND || trend === TrendDirection.BULLISH || reasonsStr.includes('HIGHER HIGH')) {
      return { primary: 'HIGHER HIGHS CONFIRMED', health: momentum === MomentumLevel.WEAK ? 'WEAKENING' : 'HEALTHY' };
    }
    if (struct === MarketStructure.DOWNTREND || trend === TrendDirection.BEARISH || reasonsStr.includes('LOWER LOW')) {
      return { primary: 'LOWER LOWS CONFIRMED', health: momentum === MomentumLevel.WEAK ? 'WEAKENING' : 'HEALTHY' };
    }
    if (struct === MarketStructure.BREAKOUT_UP || struct === MarketStructure.BREAKOUT_DOWN || reasonsStr.includes('BREAKOUT')) {
      return { primary: 'BREAKOUT FORMING', health: volatility === 'HIGH' ? 'UNSTABLE' : 'HEALTHY' };
    }
    if (struct === MarketStructure.CONSOLIDATION) {
      return { primary: 'RANGE STRUCTURE', health: 'HEALTHY' };
    }

    return { primary: 'ANALYZING STRUCTURE', health: 'HEALTHY' };
  }

  private deriveLiquidity(reasons: string[], support: StructuralLevel | null, resistance: StructuralLevel | null): string {
    const reasonsStr = (reasons || []).join(' ').toUpperCase();
    if (reasonsStr.includes('BUY-SIDE') || reasonsStr.includes('HIGH SWEEP')) {
      return 'BUY SIDE SWEPT';
    }
    if (reasonsStr.includes('SELL-SIDE') || reasonsStr.includes('LOW SWEEP')) {
      return 'SELL SIDE SWEPT';
    }
    if ((support && Math.abs(support.distancePts) <= 5) || (resistance && Math.abs(resistance.distancePts) <= 5)) {
      return 'HIGH LIQUIDITY ZONE';
    }
    return 'NO LIQUIDITY SWEEP';
  }

  private derivePressure(
    obs: MarketObservation,
    bias: any,
    action: TradingAction,
    momentum: MomentumLevel | null,
  ): { label: string; buyPercent: number; sellPercent: number; source: 'EVIDENCE' | 'DERIVED' | 'UNAVAILABLE' } {
    const candles = obs?.candles || [];
    const trend = obs?.trendEvidence?.direction || null;
    const trendStrength = typeof obs?.trendEvidence?.strength === 'number'
      ? Math.max(0, Math.min(1, obs.trendEvidence.strength))
      : null;
    const structure = obs?.structureEvidence?.structure || null;

    if (
      (obs as any).dataQuality === 'FAILED' ||
      (obs as any).candleQuality === 'FAILED' ||
      (candles.length === 0 && !trend && !bias && action === TradingAction.WAIT)
    ) {
      return { label: 'PRESSURE UNAVAILABLE', buyPercent: 50, sellPercent: 50, source: 'UNAVAILABLE' };
    }

    let score = 50;
    let evidencePoints = 0;
    const add = (delta: number) => { score += delta; evidencePoints += Math.abs(delta); };

    if (trend === TrendDirection.BULLISH) add(10 + Math.round((trendStrength ?? 0.5) * 8));
    else if (trend === TrendDirection.BEARISH) add(-(10 + Math.round((trendStrength ?? 0.5) * 8)));

    if (bias === 'BULLISH') add(6);
    else if (bias === 'BEARISH') add(-6);

    if (structure === MarketStructure.UPTREND || structure === MarketStructure.BREAKOUT_UP || structure === MarketStructure.PULLBACK_UP) add(6);
    else if (structure === MarketStructure.DOWNTREND || structure === MarketStructure.BREAKOUT_DOWN || structure === MarketStructure.PULLBACK_DOWN) add(-6);

    if (momentum === MomentumLevel.STRONG) {
      if (trend === TrendDirection.BULLISH || bias === 'BULLISH') add(7);
      else if (trend === TrendDirection.BEARISH || bias === 'BEARISH') add(-7);
    } else if (momentum === MomentumLevel.WEAK) {
      score = 50 + (score - 50) * 0.55;
    }

    if (candles.length > 0) {
      const bullish = candles.filter((c: any) => c.direction === 'BULLISH').length;
      const bearish = candles.filter((c: any) => c.direction === 'BEARISH').length;
      const directional = bullish + bearish;
      if (directional > 0) {
        const candleBias = (bullish - bearish) / directional;
        score += Math.round(candleBias * 10);
        evidencePoints += Math.abs(candleBias * 10);
      }
    }

    if (action === TradingAction.BUY) add(3);
    else if (action === TradingAction.SELL) add(-3);

    let buyPercent = Math.max(20, Math.min(80, Math.round(score)));
    
    // Strict coherence: align pressure with final action
    if (action === TradingAction.BUY) {
      buyPercent = Math.max(buyPercent, 60);
    } else if (action === TradingAction.SELL) {
      buyPercent = Math.min(buyPercent, 40);
    }

    const sellPercent = 100 - buyPercent;
    const directionalDelta = Math.abs(buyPercent - 50);
    const label = directionalDelta >= 16
      ? (buyPercent > 50 ? 'BUY PRESSURE STRONG' : 'SELL PRESSURE STRONG')
      : directionalDelta >= 5
      ? (buyPercent > 50 ? 'BUY PRESSURE MODERATE' : 'SELL PRESSURE MODERATE')
      : 'BALANCED PRESSURE';

    return {
      label,
      buyPercent,
      sellPercent,
      source: evidencePoints > 0 ? 'EVIDENCE' : 'DERIVED',
    };
  }

  private formatLevel(
    level: StructuralLevel | null,
    type: 'SUPPORT' | 'RESISTANCE',
    action: TradingAction,
  ): { display: string; status: 'FAR' | 'HIT' | 'BROKEN' | 'UNKNOWN' } {
    if (!level) return { display: type === 'SUPPORT' ? 'SCANNING SUPPORT' : 'SCANNING RESISTANCE', status: 'UNKNOWN' };

    const pts = Math.abs(level.distancePts);
    if (level.interactionState === ('TESTING' as any) || level.interactionState === ('REJECTED' as any)) {
      if (type === 'SUPPORT') {
        if (action === TradingAction.BUY) return { display: 'HIT • BOUNCE EXPECTED', status: 'HIT' };
        if (action === TradingAction.SELL) return { display: 'HIT • BREAKDOWN RISK', status: 'HIT' };
        return { display: 'HIT • HOLDING', status: 'HIT' };
      } else {
        if (action === TradingAction.BUY) return { display: 'HIT • BREAKOUT POSSIBLE', status: 'HIT' };
        if (action === TradingAction.SELL) return { display: 'HIT • REJECTION POSSIBLE', status: 'HIT' };
        return { display: 'HIT • HOLDING', status: 'HIT' };
      }
    }

    if (level.interactionState === ('BROKEN' as any)) {
      return { display: 'BROKEN', status: 'BROKEN' };
    }

    const proximity = pts <= 8 ? 'NEAR' : pts <= 25 ? 'MID' : 'FAR';
    return { display: `${proximity} • VISUAL ${type === 'SUPPORT' ? 'BELOW' : 'ABOVE'}`, status: 'FAR' };
  }

  private deriveReversalRisk(risk: RiskLevel | null, confidence: number | null): string {
    if (risk === RiskLevel.LOW) {
      return confidence !== null && confidence >= 0.8 ? 'VERY LOW' : 'LOW';
    }
    if (risk === RiskLevel.MEDIUM) {
      return 'MODERATE';
    }
    if (risk === RiskLevel.HIGH) {
      return confidence !== null && confidence < 0.4 ? 'VERY HIGH' : 'HIGH';
    }
    return 'LOW';
  }

  private deriveNextExpectation(
    action: TradingAction,
    regime: MarketRegime | null,
    momentum: MomentumLevel | null,
    risk: RiskLevel | null,
    reasons: string[],
  ): { primary: string; secondary?: string } {
    const reasonsStr = (reasons || []).join(' ').toUpperCase();

    if (action === TradingAction.BUY || action === TradingAction.SELL) {
      if (reasonsStr.includes('BREAKOUT') || regime === MarketRegime.BREAKOUT) {
        return { primary: 'BREAKOUT CONTINUATION', secondary: 'MOMENTUM EXPANSION' };
      }
      if (momentum === MomentumLevel.STRONG) {
        return { primary: 'CONTINUATION LIKELY', secondary: 'TREND FOLLOW THESIS' };
      }
      return { primary: 'PULLBACK EXPECTED', secondary: 'RETEST NEAR LEVEL' };
    }

    if (regime === MarketRegime.RANGING || regime === MarketRegime.CHOPPY) {
      return { primary: 'RANGE BOUND', secondary: 'WAIT FOR BREAKOUT' };
    }

    if (risk === RiskLevel.HIGH) {
      return { primary: 'HIGH RISK / REVERSAL', secondary: 'STRUCTURE UNSTABLE' };
    }

    return { primary: 'SCANNING STRUCTURE', secondary: 'WAITING FOR DATA' };
  }

  private createScanningState(debugMode: boolean): Readonly<MarketIntelState> {
    const state: MarketIntelState = {
      regime: Object.freeze({ primary: 'ANALYZING REGIME', secondary: 'SCANNING' }),
      momentum: Object.freeze({ primary: 'ANALYZING MOMENTUM', secondary: 'SCANNING' }),
      structure: Object.freeze({ primary: 'ANALYZING STRUCTURE', health: 'HEALTHY' }),
      liquidity: 'NO LIQUIDITY SWEEP',
      pressure: 'PRESSURE UNAVAILABLE',
      pressureSource: 'UNAVAILABLE',
      trendStrength: null,
      trendStrengthStatus: 'UNAVAILABLE',
      support: Object.freeze({ display: 'SCANNING SUPPORT', status: 'UNKNOWN' }),
      resistance: Object.freeze({ display: 'SCANNING RESISTANCE', status: 'UNKNOWN' }),
      reversalRisk: 'LOW',
      nextExpectation: Object.freeze({ primary: 'SCANNING STRUCTURE', secondary: 'WAITING FOR DATA' }),
      ...(debugMode ? { debugMapping: MarketIntelEngine.SOURCE_MODULE_MAPPING } : {}),
    };

    return Object.freeze(state);
  }
}
