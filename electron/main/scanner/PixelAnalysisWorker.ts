import { Worker } from 'node:worker_threads';
import {
  CandleDetectionResult,
  ChartRegion,
  QualityLevel,
} from '../../../shared/types/scanner';

export interface PixelAnalysisResult {
  region: ChartRegion;
  cropRatio: number;
  candleResult: CandleDetectionResult;
}

type PendingJob = {
  resolve: (value: PixelAnalysisResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

const WORKER_SOURCE = String.raw`
const { parentPort } = require('node:worker_threads');

function locateChart(buffer, width, height) {
  const fallbackLeft = Math.floor(width * 0.05);
  const fallbackTop = Math.floor(height * 0.08);
  const fallbackWidth = Math.floor(width * 0.90);
  const fallbackHeight = Math.floor(height * 0.65);
  if (!buffer || buffer.length === 0 || width <= 0 || height <= 0) {
    return { x: fallbackLeft, y: fallbackTop, width: fallbackWidth, height: fallbackHeight, confidence: 0 };
  }

  const blockSize = 16;
  const cols = Math.floor(width / blockSize);
  const rows = Math.floor(height / blockSize);
  const colorMap = new Uint8Array(rows * cols);
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
      if (greenCount + redCount >= 2) colorMap[by * cols + bx] = 1;
    }
  }

  let minX = cols;
  let maxX = 0;
  let minY = rows;
  let maxY = 0;
  let count = 0;
  const minRowStart = Math.floor(rows * 0.05);
  let indicatorRow = Math.floor(rows * 0.74);
  for (let y = Math.floor(rows * 0.50); y < Math.floor(rows * 0.88); y++) {
    let active = 0;
    for (let x = 0; x < cols; x++) if (colorMap[y * cols + x] === 1) active++;
    if (active > cols * 0.35) {
      indicatorRow = Math.min(indicatorRow, Math.max(minRowStart + 5, y - 2));
      break;
    }
  }
  const maxRowLimit = Math.min(indicatorRow, Math.floor(rows * 0.74));
  for (let y = minRowStart; y < maxRowLimit; y++) {
    const rowOffset = y * cols;
    for (let x = Math.floor(cols * 0.05); x < Math.floor(cols * 0.96); x++) {
      if (colorMap[rowOffset + x] !== 1) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (count >= 5 && maxX > minX && maxY > minY) {
    const x = Math.max(0, (minX - 1) * blockSize);
    const y = Math.max(0, (minY - 1) * blockSize);
    return {
      x,
      y,
      width: Math.min(width - x, (maxX - minX + 3) * blockSize),
      height: Math.min(height - y, (maxY - minY + 3) * blockSize),
      confidence: 0.92,
    };
  }
  return { x: fallbackLeft, y: fallbackTop, width: fallbackWidth, height: fallbackHeight, confidence: 0.5 };
}

function detectCropRatio(buffer, frameW, frameH, region) {
  const startY = region.y + Math.floor(region.height * 0.55);
  const endY = region.y + Math.floor(region.height * 0.85);
  const sampleXs = [0.2, 0.5, 0.8].map((ratio) => region.x + Math.floor(region.width * ratio));
  for (let y = startY; y < endY; y++) {
    let darkCount = 0;
    for (const sx of sampleXs) {
      const x = Math.max(0, Math.min(sx, frameW - 1));
      const cy = Math.max(0, Math.min(y, frameH - 1));
      const idx = (cy * frameW + x) * 4;
      if (idx + 3 < buffer.length && buffer[idx + 2] < 80 && buffer[idx + 1] < 80 && buffer[idx] < 80) darkCount++;
    }
    if (darkCount >= 3) return Math.max(0.55, Math.min(0.85, (y - region.y) / region.height));
  }
  return 0.72;
}

function detectCandles(buffer, frameW, frameH, region) {
  const candles = [];
  const failed = () => ({
    candles: [], rawCandidateCount: 0, validatedCandleCount: 0,
    candleQuality: 'FAILED', dominantBullishColor: null, dominantBearishColor: null,
  });
  if (!buffer || buffer.length === 0 || frameW <= 0 || frameH <= 0 || !region) return failed();
  const rx = Math.max(0, Math.min(region.x, frameW - 1));
  const ry = Math.max(0, Math.min(region.y, frameH - 1));
  const rw = Math.min(region.width, frameW - rx);
  const rh = Math.min(region.height, frameH - ry);
  if (rw <= 10 || rh <= 10) return failed();

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
      const isGreen = (g > r + 12 && g > b + 12 && g > 45) || (r < 70 && g > 130 && b < 160) || (g >= 170 && r <= 110);
      const isRed = (r > g + 12 && r > b + 12 && r > 45) || (r > 165 && g < 95 && b < 115) || (r >= 210 && g <= 110);
      if (isGreen || isRed) {
        if (topY === -1) topY = y;
        bottomY = y;
        consecutiveEmpty = 0;
        if (isGreen) greenPx++;
        if (isRed) redPx++;
      } else if (topY !== -1) {
        consecutiveEmpty += stepY;
        if (consecutiveEmpty > 12) break;
      }
    }

    const maxHeight = Math.min(220, Math.floor(rh * 0.60));
    const rangePx = bottomY - topY;
    if (topY === -1 || bottomY === -1 || rangePx < 6 || rangePx > maxHeight) continue;
    const direction = greenPx >= redPx ? 'BULLISH' : 'BEARISH';
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
        const match = direction === 'BULLISH'
          ? ((g > r + 10 && g > b + 10 && g > 40) || (r < 75 && g > 120) || (g >= 160 && r <= 110))
          : ((r > g + 10 && r > b + 10 && r > 40) || (r > 160 && g < 100) || (r >= 200 && g <= 110));
        if (match) rowWidthCount++;
      }
      if (rowWidthCount >= 3) {
        if (bodyTopY === -1) bodyTopY = y;
        bodyBottomY = y;
      }
    }
    if (bodyTopY === -1 || bodyBottomY === -1) {
      bodyTopY = topY + Math.floor(rangePx / 2);
      bodyBottomY = bodyTopY + 1;
    }
    const bodySizePx = Math.max(1, bodyBottomY - bodyTopY);
    let endX = x + 3;
    const midY = bodyTopY + Math.floor((bodyBottomY - bodyTopY) / 2);
    while (endX < rx + rw - 4) {
      const idx = (midY * frameW + endX) * 4;
      const b = buffer[idx];
      const g = buffer[idx + 1];
      const r = buffer[idx + 2];
      const candlePixel = (g > r + 10 && g > b + 10 && g > 40) || (r > g + 10 && r > b + 10 && r > 40)
        || (r < 75 && g > 120) || (r > 160 && g < 100) || (g >= 160 && r <= 110) || (r >= 200 && g <= 110);
      if (!candlePixel) break;
      endX += 2;
    }
    if (endX - x <= 28 && (bodySizePx >= 2 || rangePx >= 8)) {
      candles.push({
        xPx: x, wickTopPx: topY, bodyTopPx: bodyTopY, bodyBottomPx: bodyBottomY,
        wickBottomPx: bottomY, direction, bodySizePx, rangePx, quality: 0.95,
      });
    }
    x = Math.max(x + 4, endX + 2);
  }
  const count = candles.length;
  const quality = count >= 8 ? 'HIGH' : count >= 3 ? 'ACCEPTABLE' : 'FAILED';
  return {
    candles, rawCandidateCount: count, validatedCandleCount: count, candleQuality: quality,
    dominantBullishColor: { r: 0, g: 200, b: 83 }, dominantBearishColor: { r: 255, g: 82, b: 82 },
  };
}

parentPort.on('message', (message) => {
  const { id, pixels, width, height, regionHint } = message;
  try {
    const buffer = new Uint8Array(pixels);
    const region = regionHint && regionHint.confidence >= 0.5 ? regionHint : locateChart(buffer, width, height);
    const cropRatio = detectCropRatio(buffer, width, height, region);
    const candleRegion = { ...region, height: Math.max(1, Math.floor(region.height * cropRatio)) };
    const candleResult = detectCandles(buffer, width, height, candleRegion);
    parentPort.postMessage({ id, ok: true, result: { region, cropRatio, candleResult } });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: error && error.message ? error.message : String(error) });
  }
});
`;

export class PixelAnalysisWorker {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingJob>();

  public analyze(
    buffer: Buffer,
    width: number,
    height: number,
    regionHint?: ChartRegion | null,
  ): Promise<PixelAnalysisResult> {
    if (!buffer || buffer.length < width * height * 4 || width <= 0 || height <= 0) {
      return Promise.reject(new Error('Invalid bitmap supplied to pixel-analysis worker'));
    }
    const worker = this.ensureWorker();
    const id = this.nextId++;
    const pixels = Uint8Array.from(buffer);

    return new Promise<PixelAnalysisResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Pixel-analysis worker timed out'));
        this.resetWorker();
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, pixels: pixels.buffer, width, height, regionHint: regionHint || null }, [pixels.buffer]);
    });
  }

  public async terminate(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.rejectPending(new Error('Pixel-analysis worker terminated'));
    if (worker) {
      try { await worker.terminate(); } catch {}
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(WORKER_SOURCE, { eval: true });
    worker.unref();
    worker.on('message', (message: any) => {
      const job = this.pending.get(message?.id);
      if (!job) return;
      this.pending.delete(message.id);
      clearTimeout(job.timer);
      if (!message.ok) {
        job.reject(new Error(message.error || 'Pixel-analysis worker failed'));
        return;
      }
      const result = message.result as PixelAnalysisResult;
      if (!result?.region || !Array.isArray(result?.candleResult?.candles)) {
        job.reject(new Error('Pixel-analysis worker returned an invalid payload'));
        return;
      }
      job.resolve({
        region: result.region,
        cropRatio: result.cropRatio,
        candleResult: {
          ...result.candleResult,
          candleQuality: result.candleResult.candleQuality as QualityLevel,
        },
      });
    });
    worker.on('error', (error) => {
      if (this.worker === worker) this.worker = null;
      this.rejectPending(error);
    });
    worker.on('exit', (code) => {
      if (this.worker === worker) this.worker = null;
      if (code !== 0) this.rejectPending(new Error(`Pixel-analysis worker exited with code ${code}`));
    });
    this.worker = worker;
    return worker;
  }

  private resetWorker(): void {
    const worker = this.worker;
    this.worker = null;
    if (worker) void worker.terminate().catch(() => {});
  }

  private rejectPending(error: Error): void {
    for (const job of this.pending.values()) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    this.pending.clear();
  }
}
