import { CandleObservation } from '../../../shared/types/scanner';
import { MomentumEvidence, MomentumLevel } from '../../../shared/types/market';

export class MomentumAnalyzer {
  public static analyze(candles: CandleObservation[]): MomentumEvidence {
    if (candles.length === 0) {
      return {
        level: MomentumLevel.WEAK,
        directionalConsistency: 0,
        averageBodyRatio: 0,
        acceleration: 0
      };
    }

    let sumBodyRatio = 0;
    let recentDirection = candles[candles.length - 1].direction;
    let consistentCount = 0;
    let prevBodySize = 0;
    let accelerationSum = 0;

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (c.direction === recentDirection && c.direction !== 'DOJI') consistentCount++;
      const ratio = c.rangePx > 0 ? (c.bodySizePx / c.rangePx) : 0;
      sumBodyRatio += ratio;
      
      if (i > 0) {
        if (c.bodySizePx > prevBodySize) accelerationSum += 1;
        else if (c.bodySizePx < prevBodySize) accelerationSum -= 1;
      }
      prevBodySize = c.bodySizePx;
    }

    const directionalConsistency = consistentCount / candles.length;
    const averageBodyRatio = sumBodyRatio / candles.length;
    const acceleration = candles.length > 1 ? (accelerationSum / (candles.length - 1)) : 0;

    let level = MomentumLevel.WEAK;
    if (directionalConsistency >= 0.6 && averageBodyRatio >= 0.5) {
      level = MomentumLevel.STRONG;
    } else if (directionalConsistency >= 0.4 || averageBodyRatio >= 0.3) {
      level = MomentumLevel.MODERATE;
    }

    return {
      level,
      directionalConsistency,
      averageBodyRatio,
      acceleration
    };
  }
}
