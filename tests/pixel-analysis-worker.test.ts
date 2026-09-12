import { afterEach, describe, expect, it } from 'vitest';
import { PixelAnalysisWorker } from '../electron/main/scanner/PixelAnalysisWorker';

const workers: PixelAnalysisWorker[] = [];
afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
});

describe('pixel-analysis worker', () => {
  it('analyzes candle pixels outside the caller thread', async () => {
    const width = 320;
    const height = 200;
    const buffer = Buffer.alloc(width * height * 4);
    // Draw deterministic candles in the worker's lower chart crop.
    for (let candle = 0; candle < 10; candle++) {
      const startX = 24 + candle * 26;
      for (let x = startX; x < startX + 7; x++) {
        for (let y = 82 + (candle % 3); y < 136 + (candle % 5); y++) {
          const offset = (y * width + x) * 4;
          buffer[offset] = 83;
          buffer[offset + 1] = 200;
          buffer[offset + 2] = 0;
          buffer[offset + 3] = 255;
        }
      }
    }

    const worker = new PixelAnalysisWorker();
    workers.push(worker);
    const result = await worker.analyze(buffer, width, height, {
      x: 10, y: 10, width: 290, height: 140, confidence: 0.9,
    });
    expect(result.region.confidence).toBe(0.9);
    expect(result.candleResult.validatedCandleCount).toBeGreaterThanOrEqual(3);
    expect(result.cropRatio).toBeGreaterThanOrEqual(0.55);
  });

  it('rejects invalid bitmap dimensions without starting work', async () => {
    const worker = new PixelAnalysisWorker();
    workers.push(worker);
    await expect(worker.analyze(Buffer.alloc(4), 100, 100)).rejects.toThrow('Invalid bitmap');
  });
});
