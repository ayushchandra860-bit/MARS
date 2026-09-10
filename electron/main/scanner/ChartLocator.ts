// ============================================================
// MARS PRO V3 — Chart Locator
// Precise visual bounding box detection supporting right-edge live candles.
// ============================================================

import { ChartRegion } from '../../../shared/types/scanner';

export class ChartLocator {
  public locateChart(buffer: Buffer, width: number, height: number, scaleFactor: number = 1.0): ChartRegion {
    const fallbackLeft = Math.floor(width * 0.05);
    const fallbackTop = Math.floor(height * 0.08);
    const fallbackWidth = Math.floor(width * 0.90);
    const fallbackHeight = Math.floor(height * 0.65);

    if (!buffer || buffer.length === 0 || width <= 0 || height <= 0) {
      return {
        x: fallbackLeft,
        y: fallbackTop,
        width: fallbackWidth,
        height: fallbackHeight,
        confidence: 0,
      };
    }

    const blockSize = 16;
    const cols = Math.floor(width / blockSize);
    const rows = Math.floor(height / blockSize);
    const candleColorMap = new Uint8Array(rows * cols);

    for (let by = 0; by < rows; by++) {
      for (let bx = 0; bx < cols; bx++) {
        let greenCount = 0;
        let redCount = 0;

        for (let py = 0; py < blockSize; py += 4) {
          for (let px = 0; px < blockSize; px += 4) {
            const x = bx * blockSize + px;
            const y = by * blockSize + py;
            if (x >= width || y >= height) continue;

            const idx = (y * width + x) * 4;
            const b = buffer[idx];
            const g = buffer[idx + 1];
            const r = buffer[idx + 2];

            const isGreen = (g > r + 12 && g > b + 12 && g > 45) || (r < 60 && g > 130 && b < 150);
            const isRed = (r > g + 12 && r > b + 12 && r > 45) || (r > 170 && g < 90 && b < 110);

            if (isGreen) greenCount++;
            if (isRed) redCount++;
          }
        }

        if ((greenCount + redCount) >= 2) {
          candleColorMap[by * cols + bx] = 1;
        }
      }
    }

    let minX = cols, maxX = 0, minY = rows, maxY = 0;
    let candleBlockCount = 0;
    const minRowStart = Math.floor(rows * 0.05);

    // Detect indicator subpanes (RSI / MACD lines) in lower chart area (>= 50% height)
    // Horizontal level lines (RSI 70/30) span across > 35% of columns in a single row
    let indicatorSubpaneRow = Math.floor(rows * 0.74);
    for (let y = Math.floor(rows * 0.50); y < Math.floor(rows * 0.88); y++) {
      let rowActiveBlocks = 0;
      for (let x = 0; x < cols; x++) {
        if (candleColorMap[y * cols + x] === 1) {
          rowActiveBlocks++;
        }
      }
      if (rowActiveBlocks > cols * 0.35) {
        // Continuous horizontal line detected (RSI 70/30 or indicator subpane boundary)
        indicatorSubpaneRow = Math.min(indicatorSubpaneRow, Math.max(minRowStart + 5, y - 2));
        break;
      }
    }

    const maxRowLimit = Math.min(indicatorSubpaneRow, Math.floor(rows * 0.74));

    // Expand search area to 5% - 96% width so right-hand LIVE candles are included
    for (let y = minRowStart; y < maxRowLimit; y++) {
      const rowOffset = y * cols;
      for (let x = Math.floor(cols * 0.05); x < Math.floor(cols * 0.96); x++) {
        if (candleColorMap[rowOffset + x] === 1) {
          candleBlockCount++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (candleBlockCount >= 5 && maxX > minX && maxY > minY) {
      const chartX = Math.max(0, (minX - 1) * blockSize);
      const chartY = Math.max(0, (minY - 1) * blockSize);
      const chartW = Math.min(width - chartX, (maxX - minX + 3) * blockSize);
      const chartH = Math.min(height - chartY, (maxY - minY + 3) * blockSize);

      return {
        x: chartX,
        y: chartY,
        width: chartW,
        height: chartH,
        confidence: 0.92,
      };
    }

    return {
      x: fallbackLeft,
      y: fallbackTop,
      width: fallbackWidth,
      height: fallbackHeight,
      confidence: 0.5,
    };
  }
}
