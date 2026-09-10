// ============================================================
// MARS PRO V3 — Outcome Evaluator
// Evaluates market outcome after recommended expiry horizon
// when objective price observations exist.
//
// This is the FALLBACK evaluator used when DOM-detected results
// (MARS_TRADE_RESULT from the embedded Olymp page) are unavailable.
// It compares entry price vs expiry price with spread awareness.
// ============================================================

import { LearningSample } from './LearningDataset';
import { TradeOutcome } from '../../../shared/types/decision';

/**
 * Spread cost in price units — Olymp typically charges 1-2 pips on
 * forex pairs.  A trade that closes barely in-the-money after spread
 * may actually be a loss on the platform.  We use a conservative
 * estimate to avoid marking borderline trades as wins.
 */
const SPREAD_COST = 0.00015; // ~1.5 pips for forex (adjust per asset class)
const MIN_WIN_PIPS = 0.0001;  // minimum movement to count as clear win

export class OutcomeEvaluator {
  public evaluate(sample: LearningSample, currentPricePx: number): TradeOutcome | null {
    if (sample.entryPricePx === null || isNaN(currentPricePx) || currentPricePx <= 0) {
      return null;
    }

    const entry = sample.entryPricePx;
    sample.expiryPricePx = currentPricePx;
    const diff = currentPricePx - entry;

    if (sample.decision === 'BUY') {
      // Win: price moved up by more than spread + minimum threshold
      if (diff > SPREAD_COST + MIN_WIN_PIPS) {
        sample.outcome = TradeOutcome.WIN;
      }
      // Loss: price moved down or stayed flat after spread
      else if (diff < -(SPREAD_COST + MIN_WIN_PIPS)) {
        sample.outcome = TradeOutcome.LOSS;
      }
      // Borderline: price within spread range — could go either way on
      // the actual platform.  Mark as LOSS (conservative for calibration).
      else {
        sample.outcome = TradeOutcome.LOSS;
      }
    } else if (sample.decision === 'SELL') {
      if (diff < -(SPREAD_COST + MIN_WIN_PIPS)) {
        sample.outcome = TradeOutcome.WIN;
      } else if (diff > SPREAD_COST + MIN_WIN_PIPS) {
        sample.outcome = TradeOutcome.LOSS;
      } else {
        sample.outcome = TradeOutcome.LOSS; // conservative
      }
    }

    return sample.outcome;
  }
}
