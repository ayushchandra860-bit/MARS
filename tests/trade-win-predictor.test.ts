import { describe, it, expect } from 'vitest';
import { predictTradeWinProbability } from '../electron/main/decision/TradeWinPredictor';
import { TradingAction } from '../shared/types/decision';
import { TrendDirection, MomentumLevel, VolatilityLevel, MarketRegime } from '../shared/types/market';

describe('TradeWinPredictor', () => {
  it('starts at 0.50 for a neutral setup (coin flip)', () => {
    const p = predictTradeWinProbability({
      direction: TradingAction.BUY,
      trendDirection: null,
      momentum: null,
      volatility: null,
      regime: null,
      targetPoints: null,
      stopPoints: null,
    });
    expect(p).toBe(0.5);
  });

  it('trend alignment raises BUY probability, opposing trend lowers it', () => {
    const aligned = predictTradeWinProbability({
      direction: TradingAction.BUY,
      trendDirection: TrendDirection.BULLISH,
      momentum: MomentumLevel.MODERATE,
      volatility: VolatilityLevel.NORMAL,
      regime: MarketRegime.TRENDING,
      targetPoints: 12,
      stopPoints: 6,
    });
    const opposed = predictTradeWinProbability({
      direction: TradingAction.BUY,
      trendDirection: TrendDirection.BEARISH,
      momentum: MomentumLevel.MODERATE,
      volatility: VolatilityLevel.NORMAL,
      regime: MarketRegime.RANGING,
      targetPoints: 12,
      stopPoints: 6,
    });
    expect(aligned).toBeGreaterThan(0.6);
    expect(opposed).toBeLessThan(aligned);
    expect(opposed).toBeLessThan(0.55);
  });

  it('mirrors for SELL direction (bearish trend helps SELL)', () => {
    const sellWithBearish = predictTradeWinProbability({
      direction: TradingAction.SELL,
      trendDirection: TrendDirection.BEARISH,
      momentum: MomentumLevel.STRONG,
      volatility: VolatilityLevel.NORMAL,
      regime: MarketRegime.TRENDING,
      targetPoints: 15,
      stopPoints: 5,
    });
    const sellWithBullish = predictTradeWinProbability({
      direction: TradingAction.SELL,
      trendDirection: TrendDirection.BULLISH,
      momentum: MomentumLevel.STRONG,
      volatility: VolatilityLevel.NORMAL,
      regime: MarketRegime.TRENDING,
      targetPoints: 15,
      stopPoints: 5,
    });
    expect(sellWithBearish).toBeGreaterThan(sellWithBullish);
  });

  it('better risk:reward raises the estimate', () => {
    const goodRR = predictTradeWinProbability({
      direction: TradingAction.BUY,
      trendDirection: TrendDirection.BULLISH,
      momentum: MomentumLevel.STRONG,
      volatility: VolatilityLevel.LOW,
      regime: MarketRegime.TRENDING,
      targetPoints: 30,
      stopPoints: 5,
    });
    const badRR = predictTradeWinProbability({
      direction: TradingAction.BUY,
      trendDirection: TrendDirection.BULLISH,
      momentum: MomentumLevel.STRONG,
      volatility: VolatilityLevel.LOW,
      regime: MarketRegime.TRENDING,
      targetPoints: 5,
      stopPoints: 30,
    });
    expect(goodRR).toBeGreaterThan(badRR);
  });

  it('high volatility penalizes, low volatility helps', () => {
    const highVol = predictTradeWinProbability({
      direction: TradingAction.BUY,
      trendDirection: TrendDirection.BULLISH,
      momentum: MomentumLevel.MODERATE,
      volatility: VolatilityLevel.HIGH,
      regime: MarketRegime.TRENDING,
      targetPoints: 12,
      stopPoints: 6,
    });
    const lowVol = predictTradeWinProbability({
      direction: TradingAction.BUY,
      trendDirection: TrendDirection.BULLISH,
      momentum: MomentumLevel.MODERATE,
      volatility: VolatilityLevel.LOW,
      regime: MarketRegime.TRENDING,
      targetPoints: 12,
      stopPoints: 6,
    });
    expect(lowVol).toBeGreaterThan(highVol);
  });

  it('never overclaims: stays within honest bounds', () => {
    const max = predictTradeWinProbability({
      direction: TradingAction.BUY,
      trendDirection: TrendDirection.BULLISH,
      momentum: MomentumLevel.STRONG,
      volatility: VolatilityLevel.LOW,
      regime: MarketRegime.TRENDING,
      targetPoints: 100,
      stopPoints: 1,
    });
    const min = predictTradeWinProbability({
      direction: TradingAction.SELL,
      trendDirection: TrendDirection.BULLISH,
      momentum: MomentumLevel.WEAK,
      volatility: VolatilityLevel.HIGH,
      regime: MarketRegime.RANGING,
      targetPoints: 1,
      stopPoints: 100,
    });
    expect(max).toBeLessThanOrEqual(0.9);
    expect(min).toBeGreaterThanOrEqual(0.45);
  });

  it('WAIT action returns coin flip', () => {
    const p = predictTradeWinProbability({
      direction: TradingAction.WAIT,
      trendDirection: TrendDirection.BULLISH,
      momentum: MomentumLevel.STRONG,
      volatility: VolatilityLevel.LOW,
      regime: MarketRegime.TRENDING,
      targetPoints: 20,
      stopPoints: 5,
    });
    expect(p).toBe(0.5);
  });
});
