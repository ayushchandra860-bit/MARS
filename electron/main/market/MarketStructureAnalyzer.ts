import { CandleObservation } from '../../../shared/types/scanner';
import { StructureEvidence, MarketStructure, SwingPoint, SwingType } from '../../../shared/types/market';

export class MarketStructureAnalyzer {
  public static analyze(candles: CandleObservation[]): StructureEvidence {
    if (candles.length < 5) {
      return { structure: MarketStructure.INSUFFICIENT_DATA, swingPoints: [], confidence: 0 };
    }

    const swingPoints: SwingPoint[] = [];
    
    for (let i = 2; i < candles.length - 2; i++) {
      const current = candles[i];
      const prev1 = candles[i - 1];
      const prev2 = candles[i - 2];
      const next1 = candles[i + 1];
      const next2 = candles[i + 2];

      // Pivot High (Lower y is higher price)
      if (current.wickTopPx < prev1.wickTopPx && current.wickTopPx < prev2.wickTopPx &&
          current.wickTopPx < next1.wickTopPx && current.wickTopPx < next2.wickTopPx) {
        
        let type = SwingType.HIGHER_HIGH;
        const lastHigh = swingPoints.slice().reverse().find(s => s.type === SwingType.HIGHER_HIGH || s.type === SwingType.LOWER_HIGH);
        if (lastHigh && current.wickTopPx > lastHigh.pricePx) {
          type = SwingType.LOWER_HIGH;
        }
        
        swingPoints.push({ index: i, pricePx: current.wickTopPx, type });
      }

      // Pivot Low (Higher y is lower price)
      if (current.wickBottomPx > prev1.wickBottomPx && current.wickBottomPx > prev2.wickBottomPx &&
          current.wickBottomPx > next1.wickBottomPx && current.wickBottomPx > next2.wickBottomPx) {
        
        let type = SwingType.LOWER_LOW;
        const lastLow = swingPoints.slice().reverse().find(s => s.type === SwingType.LOWER_LOW || s.type === SwingType.HIGHER_LOW);
        if (lastLow && current.wickBottomPx < lastLow.pricePx) {
          type = SwingType.HIGHER_LOW;
        }
        
        swingPoints.push({ index: i, pricePx: current.wickBottomPx, type });
      }
    }

    let structure = MarketStructure.CONSOLIDATION;
    let confidence = 0.3;

    if (swingPoints.length >= 2) {
      const recent = swingPoints.slice(-2);
      if (recent.every(s => s.type === SwingType.HIGHER_HIGH || s.type === SwingType.HIGHER_LOW)) {
        structure = MarketStructure.UPTREND;
        confidence = 0.8;
      } else if (recent.every(s => s.type === SwingType.LOWER_HIGH || s.type === SwingType.LOWER_LOW)) {
        structure = MarketStructure.DOWNTREND;
        confidence = 0.8;
      }
    }

    return { structure, swingPoints, confidence };
  }
}
