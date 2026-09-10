import { CandleObservation } from '../../../shared/types/scanner';
import { PatternEvidence, DetectedPattern } from '../../../shared/types/market';

export class PatternAnalyzer {
  public static analyze(candles: CandleObservation[]): PatternEvidence {
    const patterns: DetectedPattern[] = [];
    if (candles.length < 2) return { patterns };

    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];

      if (curr.bodySizePx > prev.bodySizePx) {
        if (prev.direction === 'BULLISH' && curr.direction === 'BEARISH') {
          if (curr.bodyTopPx <= prev.bodyTopPx && curr.bodyBottomPx >= prev.bodyBottomPx) {
            patterns.push({ name: 'Bearish Engulfing', direction: 'BEARISH', confidence: 0.8, candleIndices: [i - 1, i] });
          }
        }
        if (prev.direction === 'BEARISH' && curr.direction === 'BULLISH') {
          if (curr.bodyTopPx <= prev.bodyTopPx && curr.bodyBottomPx >= prev.bodyBottomPx) {
            patterns.push({ name: 'Bullish Engulfing', direction: 'BULLISH', confidence: 0.8, candleIndices: [i - 1, i] });
          }
        }
      }

      if (curr.wickTopPx >= prev.wickTopPx && curr.wickBottomPx <= prev.wickBottomPx) {
         patterns.push({ name: 'Inside Bar', direction: 'NEUTRAL', confidence: 0.6, candleIndices: [i - 1, i] });
      }

      const wickTotal = curr.rangePx;
      if (wickTotal > 0 && curr.bodySizePx / wickTotal < 0.3) {
        const lowerWick = curr.wickBottomPx - curr.bodyBottomPx;
        const upperWick = curr.bodyTopPx - curr.wickTopPx;
        
        if (lowerWick > upperWick * 2) {
          patterns.push({ name: 'Pin Bar (Hammer)', direction: 'BULLISH', confidence: 0.7, candleIndices: [i] });
        } else if (upperWick > lowerWick * 2) {
          patterns.push({ name: 'Pin Bar (Shooting Star)', direction: 'BEARISH', confidence: 0.7, candleIndices: [i] });
        }
      }
    }

    return { patterns };
  }
}
