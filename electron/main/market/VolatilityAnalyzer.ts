import { CandleObservation } from '../../../shared/types/scanner';
import { VolatilityEvidence, VolatilityLevel } from '../../../shared/types/market';

export class VolatilityAnalyzer {
  public static analyze(candles: CandleObservation[]): VolatilityEvidence {
    if (candles.length === 0) {
      return { level: VolatilityLevel.LOW, normalizedRange: 0, rangeStdDev: 0 };
    }

    let sumRange = 0;
    let sumBody = 0;
    for (const c of candles) {
      sumRange += c.rangePx;
      sumBody += c.bodySizePx;
    }

    const meanRange = sumRange / candles.length;
    const meanBody = sumBody / candles.length || 1; 

    const normalizedRange = meanRange / meanBody;

    let varianceSum = 0;
    for (const c of candles) {
      varianceSum += Math.pow(c.rangePx - meanRange, 2);
    }
    const variance = varianceSum / candles.length;
    const rangeStdDev = Math.sqrt(variance);

    let level = VolatilityLevel.NORMAL;
    if (normalizedRange > 3.0 && rangeStdDev > meanRange * 0.5) {
      level = VolatilityLevel.HIGH;
    } else if (normalizedRange < 1.5 && rangeStdDev < meanRange * 0.2) {
      level = VolatilityLevel.LOW;
    }

    return { level, normalizedRange, rangeStdDev };
  }
}
