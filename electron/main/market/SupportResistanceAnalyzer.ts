import { CandleObservation } from '../../../shared/types/scanner';
import { SwingPoint, SupportResistanceEvidence, StructuralLevel, SRInteractionState, SwingType } from '../../../shared/types/market';

export class SupportResistanceAnalyzer {
  public static analyze(candles: CandleObservation[], swingPoints: SwingPoint[]): SupportResistanceEvidence {
    if (!candles || candles.length === 0) {
      return { levels: [], nearestSupport: null, nearestResistance: null };
    }

    // Guarantee one visual high and one visual low when swing detection is sparse.
    const effectivePoints: SwingPoint[] = swingPoints ? [...swingPoints] : [];
    const hasHigh = effectivePoints.some((point) => point.type === SwingType.HIGHER_HIGH || point.type === SwingType.LOWER_HIGH);
    const hasLow = effectivePoints.some((point) => point.type === SwingType.HIGHER_LOW || point.type === SwingType.LOWER_LOW);
    if (!hasHigh || !hasLow) {
      let minPrice = Infinity;
      let maxPrice = -Infinity;
      let minIdx = 0;
      let maxIdx = 0;

      candles.forEach((c, idx) => {
        if (c.wickBottomPx > maxPrice) { maxPrice = c.wickBottomPx; maxIdx = idx; }
        if (c.wickTopPx < minPrice) { minPrice = c.wickTopPx; minIdx = idx; }
      });

      if (!hasLow && maxPrice !== -Infinity) effectivePoints.push({ index: maxIdx, pricePx: maxPrice, type: SwingType.LOWER_LOW });
      if (!hasHigh && minPrice !== Infinity) effectivePoints.push({ index: minIdx, pricePx: minPrice, type: SwingType.HIGHER_HIGH });
    }

    const CLUSTER_THRESHOLD_PX = 12;
    const levels: StructuralLevel[] = [];

    // Step 1: Cluster swing points into levels
    for (const point of effectivePoints) {
      let found = false;
      for (const level of levels) {
        if (Math.abs(level.pricePx - point.pricePx) <= CLUSTER_THRESHOLD_PX) {
          level.pricePx = (level.pricePx * level.touchCount + point.pricePx) / (level.touchCount + 1);
          level.touchCount += 1;
          level.strength = Math.min(1.0, level.touchCount * 0.25);
          level.strengthLabel = level.touchCount >= 3 ? 'STRONG' : 'MODERATE';
          found = true;
          break;
        }
      }
      if (!found) {
        levels.push({
          pricePx: point.pricePx,
          touchCount: 1,
          strength: 0.25,
          strengthLabel: 'MODERATE',
          role: 'SUPPORT',
          distancePts: 0,
          interactionState: SRInteractionState.APPROACHING,
          reactionDetail: 'Level identified',
        });
      }
    }

    // Step 2: Evaluate current price and recent candles relative to levels
    const lastCandle = candles[candles.length - 1];
    const currentPricePx = lastCandleClosePx(lastCandle);

    let nearestSupport: StructuralLevel | null = null;
    let nearestResistance: StructuralLevel | null = null;
    let minSuppDist = Infinity;
    let minResDist = Infinity;

    for (const level of levels) {
      if (level.pricePx > currentPricePx) {
        level.role = 'SUPPORT';
        const dist = Math.round(level.pricePx - currentPricePx);
        level.distancePts = dist;

        const interaction = this.evaluateInteraction(lastCandle, level, true);
        level.interactionState = interaction.state;
        level.reactionDetail = interaction.detail;

        if (dist < minSuppDist) {
          minSuppDist = dist;
          nearestSupport = level;
        }
      } else {
        level.role = 'RESISTANCE';
        const dist = Math.round(currentPricePx - level.pricePx);
        level.distancePts = dist;

        const interaction = this.evaluateInteraction(lastCandle, level, false);
        level.interactionState = interaction.state;
        level.reactionDetail = interaction.detail;

        if (dist < minResDist) {
          minResDist = dist;
          nearestResistance = level;
        }
      }
    }

    return { levels, nearestSupport, nearestResistance };
  }

  private static evaluateInteraction(
    candle: CandleObservation,
    level: StructuralLevel,
    isSupport: boolean
  ): { state: SRInteractionState; detail: string } {
    const levelPx = level.pricePx;
    const wickLow = candle.wickBottomPx;
    const wickHigh = candle.wickTopPx;
    const dist = level.distancePts;

    // Pixel Y grows downward. A hit requires the current wick to actually
    // cross the level within a small visual tolerance; distance alone is not a hit.
    const TOUCH_TOLERANCE_PX = 3;
    const touchesLevel = wickHigh <= levelPx + TOUCH_TOLERANCE_PX
      && wickLow >= levelPx - TOUCH_TOLERANCE_PX;

    if (touchesLevel) {
      if (candle.direction === (isSupport ? 'BULLISH' : 'BEARISH')) {
        return {
          state: SRInteractionState.REJECTED,
          detail: isSupport ? 'Bullish rejection detected' : 'Bearish rejection detected',
        };
      }
      return {
        state: SRInteractionState.TESTING,
        detail: `Testing level (${level.touchCount}×)`,
      };
    }

    if (dist <= 25) {
      return {
        state: SRInteractionState.APPROACHING,
        detail: `Approaching level (${dist} pts away)`,
      };
    }

    if (level.touchCount >= 2) {
      return {
        state: SRInteractionState.HELD,
        detail: `Level held (${level.touchCount}× tested)`,
      };
    }

    return {
      state: SRInteractionState.APPROACHING,
      detail: `Level identified (${dist} pts away)`,
    };
  }
}

function lastCandleClosePx(c: CandleObservation): number {
  if (c.direction === 'BULLISH') return Math.min(c.bodyTopPx, c.bodyBottomPx);
  if (c.direction === 'BEARISH') return Math.max(c.bodyTopPx, c.bodyBottomPx);
  return (c.bodyTopPx + c.bodyBottomPx) / 2;
}
