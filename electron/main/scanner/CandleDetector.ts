// ============================================================
// MARS PRO V3 — Candle Detector (Olymp Trade Optimized Profile)
// Fast Uint32 scanning with Olymp Trade candle color tolerances.
// ============================================================

import { CandleObservation, CandleDirection, CandleDetectionResult, ChartRegion, QualityLevel } from '../../../shared/types/scanner';

export class CandleDetector {
  public detect(buffer: Buffer, frameW: number, frameH: number, region: ChartRegion): CandleDetectionResult {
    const candles: CandleObservation[] = [];
    if (!buffer || buffer.length === 0 || frameW <= 0 || frameH <= 0 || !region) {
      return {
        candles: [],
        rawCandidateCount: 0,
        validatedCandleCount: 0,
        candleQuality: QualityLevel.FAILED,
        dominantBullishColor: null,
        dominantBearishColor: null,
      };
    }

    const rx = Math.max(0, Math.min(region.x, frameW - 1));
    const ry = Math.max(0, Math.min(region.y, frameH - 1));
    const rw = Math.min(region.width, frameW - rx);
    const rh = Math.min(region.height, frameH - ry);

    if (rw <= 10 || rh <= 10) {
      return {
        candles: [],
        rawCandidateCount: 0,
        validatedCandleCount: 0,
        candleQuality: QualityLevel.FAILED,
        dominantBullishColor: null,
        dominantBearishColor: null,
      };
    }

    const stepX = 3;
    const stepY = 3;

    for (let x = rx + 4; x < rx + rw - 4; x += stepX) {
      let topY = -1;
      let bottomY = -1;
      let greenPx = 0;
      let redPx = 0;
      let consecutiveEmpty = 0;

      for (let y = ry + 2; y < ry + rh - 2; y += stepY) {
        const idx = (y * frameW + x) * 4;
        const b = buffer[idx];
        const g = buffer[idx + 1];
        const r = buffer[idx + 2];

        // Olymp Trade Green (#00c853, #26a69a, #00e676)
        const isGreen = (g > r + 12 && g > b + 12 && g > 45) || (r < 70 && g > 130 && b < 160) || (g >= 170 && r <= 110);
        // Olymp Trade Red (#ff5252, #ef5350, #ff1744)
        const isRed = (r > g + 12 && r > b + 12 && r > 45) || (r > 165 && g < 95 && b < 115) || (r >= 210 && g <= 110);

        if (isGreen || isRed) {
          if (topY === -1) topY = y;
          bottomY = y;
          consecutiveEmpty = 0;

          if (isGreen) greenPx++;
          if (isRed) redPx++;
        } else if (topY !== -1) {
          consecutiveEmpty += stepY;
          // Candle terminated: do not bridge over background voids into lower indicator subpanes
          if (consecutiveEmpty > 12) {
            break;
          }
        }
      }

      const maxCandleHeight = Math.min(220, Math.floor(rh * 0.60));
      const rangePx = bottomY - topY;

      if (topY !== -1 && bottomY !== -1 && rangePx >= 6 && rangePx <= maxCandleHeight) {
        const direction = greenPx >= redPx ? CandleDirection.BULLISH : CandleDirection.BEARISH;

        let bodyTopY = -1;
        let bodyBottomY = -1;

        for (let y = topY; y <= bottomY; y += 2) {
          let rowWidthCount = 0;
          for (let dx = -2; dx <= 2; dx++) {
            const checkX = Math.max(0, Math.min(x + dx, frameW - 1));
            const idx = (y * frameW + checkX) * 4;
            const b = buffer[idx];
            const g = buffer[idx + 1];
            const r = buffer[idx + 2];
            const isMatch = direction === CandleDirection.BULLISH
              ? ((g > r + 10 && g > b + 10 && g > 40) || (r < 75 && g > 120) || (g >= 160 && r <= 110))
              : ((r > g + 10 && r > b + 10 && r > 40) || (r > 160 && g < 100) || (r >= 200 && g <= 110));
            if (isMatch) rowWidthCount++;
          }

          if (rowWidthCount >= 3) {
            if (bodyTopY === -1) bodyTopY = y;
            bodyBottomY = y;
          }
        }

        if (bodyTopY === -1 || bodyBottomY === -1) {
          const midY = topY + Math.floor(rangePx / 2);
          bodyTopY = midY;
          bodyBottomY = midY + 1;
        }

        const bodySizePx = Math.max(1, bodyBottomY - bodyTopY);

        let endX = x + 3;
        const midY = bodyTopY + Math.floor((bodyBottomY - bodyTopY) / 2);
        while (endX < rx + rw - 4) {
          const idx = (midY * frameW + endX) * 4;
          const b = buffer[idx];
          const g = buffer[idx + 1];
          const r = buffer[idx + 2];
          const isCandlePixel = (g > r + 10 && g > b + 10 && g > 40) || (r > g + 10 && r > b + 10 && r > 40) || (r < 75 && g > 120) || (r > 160 && g < 100) || (g >= 160 && r <= 110) || (r >= 200 && g <= 110);
          if (!isCandlePixel) break;
          endX += 2;
        }

        const candleWidth = endX - x;
        // Indicator lines and horizontal bands span > 28px wide; candles are compact vertical bodies
        if (candleWidth <= 28) {
          if (bodySizePx >= 2 || rangePx >= 8) {
            candles.push({
              xPx: x,
              wickTopPx: topY,
              bodyTopPx: bodyTopY,
              bodyBottomPx: bodyBottomY,
              wickBottomPx: bottomY,
              direction,
              bodySizePx,
              rangePx,
              quality: 0.95,
            });
          }
        }

        x = Math.max(x + 4, endX + 2);
      }
    }

    const validCount = candles.length;
    let quality = QualityLevel.FAILED;
    if (validCount >= 8) quality = QualityLevel.HIGH;
    else if (validCount >= 3) quality = QualityLevel.ACCEPTABLE;

    return {
      candles,
      rawCandidateCount: validCount,
      validatedCandleCount: validCount,
      candleQuality: quality,
      dominantBullishColor: { r: 0, g: 200, b: 83 },
      dominantBearishColor: { r: 255, g: 82, b: 82 },
    };
  }
}
