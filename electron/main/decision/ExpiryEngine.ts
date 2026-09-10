import { VolatilityLevel, MomentumLevel, MarketRegime } from '../../../shared/types/market';
import { ExpiryPreset } from '../../../shared/types/ipc';

export class ExpiryEngine {
  /**
   * Recommend expiry based on enabled presets.
   * When multiple expiries are enabled, evaluates the setup against each
   * and selects the most suitable one for the current conditions.
   */
  public recommend(
    timeframe: string | null,
    volatility: VolatilityLevel | null,
    momentum: MomentumLevel | null,
    enabledExpiries: ExpiryPreset[],
    regime?: MarketRegime | null,
  ): string | null {
    // If auto-only or empty, use smart selection
    if (!enabledExpiries || enabledExpiries.length === 0 || (enabledExpiries.length === 1 && enabledExpiries[0] === 'auto')) {
      return this.smartRecommend(timeframe, volatility, momentum, regime);
    }

    // Filter out 'auto' from explicit selections
    const explicitPresets = enabledExpiries.filter(e => e !== 'auto');
    if (explicitPresets.length === 0) {
      return this.smartRecommend(timeframe, volatility, momentum, regime);
    }

    // If only one explicit preset, use it directly
    if (explicitPresets.length === 1) {
      return this.presetToLabel(explicitPresets[0]);
    }

    // Multiple expiries enabled: select the most suitable based on conditions
    return this.selectBestExpiry(explicitPresets, volatility, momentum, regime);
  }

  /**
   * Smart recommendation when auto mode is selected
   */
  private smartRecommend(
    timeframe: string | null,
    volatility: VolatilityLevel | null,
    momentum: MomentumLevel | null,
    regime?: MarketRegime | null,
  ): string | null {
    if (!timeframe) return null;

    const tfLower = timeframe.toLowerCase();
    let baseMinutes = 0;

    if (tfLower.includes('m')) {
      const match = tfLower.match(/(\d+)\s*m/);
      if (match) baseMinutes = parseInt(match[1], 10);
      else if (tfLower === 'm' || tfLower === '1m') baseMinutes = 1;
    } else if (tfLower.includes('h')) {
      const match = tfLower.match(/(\d+)\s*h/);
      if (match) baseMinutes = parseInt(match[1], 10) * 60;
    } else if (tfLower.includes('d')) {
      return 'End of Day';
    }

    if (baseMinutes === 0) return null;

    let recommendedCandles = 3;

    if (momentum === MomentumLevel.STRONG) {
      recommendedCandles = 2;
    } else if (momentum === MomentumLevel.WEAK) {
      recommendedCandles = 4;
    }

    if (volatility === VolatilityLevel.HIGH) {
      recommendedCandles = Math.max(1, recommendedCandles - 1);
    } else if (volatility === VolatilityLevel.LOW) {
      recommendedCandles += 1;
    }

    if (regime === MarketRegime.TRENDING) {
      recommendedCandles = Math.max(2, recommendedCandles - 1);
    } else if (regime === MarketRegime.RANGING || regime === MarketRegime.CHOPPY) {
      recommendedCandles += 1;
    } else if (regime === MarketRegime.BREAKOUT) {
      recommendedCandles = Math.max(1, recommendedCandles - 1);
    }

    const recommendedMinutes = baseMinutes * recommendedCandles;

    if (recommendedMinutes >= 60) {
      const hours = Math.floor(recommendedMinutes / 60);
      const mins = recommendedMinutes % 60;
      if (mins === 0) return hours + ' hour' + (hours > 1 ? 's' : '');
      return hours + 'h ' + mins + 'm';
    }

    return recommendedMinutes + ' min';
  }

  /**
   * When multiple explicit expiries are selected, pick the best one
   * based on current volatility, momentum, and regime.
   */
  private selectBestExpiry(
    presets: ExpiryPreset[],
    volatility: VolatilityLevel | null,
    momentum: MomentumLevel | null,
    regime: MarketRegime | null | undefined,
  ): string {
    const presetsInSeconds = presets.map(p => ({
      preset: p,
      seconds: ExpiryEngine.labelToSeconds(this.presetToLabel(p)) || 60,
    })).sort((a, b) => a.seconds - b.seconds);

    // Shortest is default (conservative)
    let best = presetsInSeconds[0];

    // Strong momentum + trending/breakout => allow longer expiry
    if (momentum === MomentumLevel.STRONG && (regime === MarketRegime.TRENDING || regime === MarketRegime.BREAKOUT)) {
      // Pick middle or longest available
      const midIdx = Math.min(presetsInSeconds.length - 1, Math.floor(presetsInSeconds.length / 2));
      best = presetsInSeconds[midIdx];
    }

    // Weak momentum => prefer shortest
    if (momentum === MomentumLevel.WEAK) {
      best = presetsInSeconds[0];
    }

    // High volatility => prefer shorter
    if (volatility === VolatilityLevel.HIGH) {
      best = presetsInSeconds[0];
    }

    // Low volatility => allow longer
    if (volatility === VolatilityLevel.LOW) {
      const lastIdx = presetsInSeconds.length - 1;
      best = presetsInSeconds[lastIdx];
    }

    // Choppy/ranging => shortest
    if (regime === MarketRegime.CHOPPY || regime === MarketRegime.RANGING) {
      best = presetsInSeconds[0];
    }

    return this.presetToLabel(best.preset);
  }

  public presetToLabel(preset: ExpiryPreset): string {
    switch (preset) {
      case '30s': return '30 sec';
      case '45s': return '45 sec';
      case '1m': return '1 min';
      case '2m': return '2 min';
      case '3m': return '3 min';
      case '4m': return '4 min';
      case '5m': return '5 min';
      case '15m': return '15 min';
      default: return '1 min';
    }
  }

  /** Convert an expiry label to seconds for countdown / lifecycle tracking */
  public static labelToSeconds(label: string | null): number | null {
    if (!label) return null;
    const lower = label.toLowerCase().trim();
    if (lower === '30 sec' || lower === '30s') return 30;
    if (lower === '45 sec' || lower === '45s') return 45;
    if (lower === '1 min' || lower === '1m') return 60;
    if (lower === '2 min' || lower === '2m') return 120;
    if (lower === '3 min' || lower === '3m') return 180;
    if (lower === '4 min' || lower === '4m') return 240;
    if (lower === '5 min' || lower === '5m') return 300;
    if (lower === '15 min' || lower === '15m') return 900;
    const minMatch = lower.match(/(\d+)\s*min/);
    if (minMatch) return parseInt(minMatch[1], 10) * 60;
    const hourMinMatch = lower.match(/(\d+)\s*h(?:ours?)?\s*(\d+)\s*m(?:in(?:utes?)?)?/);
    if (hourMinMatch) return parseInt(hourMinMatch[1], 10) * 3600 + parseInt(hourMinMatch[2], 10) * 60;
    const hourMatch = lower.match(/(\d+)\s*h(?:ours?)?/);
    if (hourMatch) return parseInt(hourMatch[1], 10) * 3600;
    return null;
  }

  /** Convert a chart timeframe string (e.g. '10s', '15s', '1m', '5m') into seconds */
  public static timeframeToSeconds(timeframe: string | null): number {
    if (!timeframe) return 60; // Default: 1 minute (60 seconds)
    const lower = timeframe.toLowerCase().trim();
    const secMatch = lower.match(/^(\d+)\s*(s|sec|second|seconds)$/);
    if (secMatch) return parseInt(secMatch[1], 10);
    const minMatch = lower.match(/^(\d+)\s*(m|min|minute|minutes)$/);
    if (minMatch) return parseInt(minMatch[1], 10) * 60;
    const hourMatch = lower.match(/^(\d+)\s*(h|hour|hours)$/);
    if (hourMatch) return parseInt(hourMatch[1], 10) * 3600;
    if (lower === 's' || lower === '1s') return 1;
    if (lower === 'm' || lower === '1m') return 60;
    if (lower === 'h' || lower === '1h') return 3600;
    return 60;
  }
}