import { describe, it, expect } from 'vitest';
import { OcrService } from '../electron/main/scanner/OcrService';
import { ChartRegion } from '../shared/types/scanner';

describe('OcrService Input Validation & PNG Conversion', () => {
  it('should handle zero-byte or null buffer gracefully', async () => {
    const ocrService = new OcrService();
    const result = await ocrService.extractAsset(Buffer.alloc(0), 0, 0);
    expect(result).toBeNull();
  });

  it('should validate crop bounds correctly', async () => {
    const ocrService = new OcrService();
    const width = 100;
    const height = 100;
    const buffer = Buffer.alloc(width * height * 4); // 100x100 RGBA

    const chartRegion: ChartRegion = {
      x: 10,
      y: 10,
      width: 150, // Out of bounds
      height: 150,
      confidence: 0.9,
    };

    const result = await ocrService.extractPrice(buffer, width, height, chartRegion);
    // Should return null gracefully without throwing an exception
    expect(result).toBeNull();
  });

  it('should throttle OCR execution correctly', () => {
    const ocrService = new OcrService();
    expect(ocrService.shouldRunOcr()).toBe(true);
  });

  it('runImageOcr is disabled by default (performance guard)', async () => {
    const ocrService = new OcrService();
    let calls = 0;
    ocrService.setImageOcrEngine(async () => {
      calls++;
      return 'EUR/USD price 1.0842';
    });
    const result = await ocrService.runImageOcr(Buffer.alloc(100), 10, 10);
    expect(result).toBeNull();
    expect(calls).toBe(0);
  });

  it('runImageOcr parses a price from a mock engine and caches it', async () => {
    const ocrService = new OcrService();
    ocrService.setImageOcrEnabled(true);
    ocrService.setImageOcrEngine(async () => 'EUR/USD price 1.0842');
    const result = await ocrService.runImageOcr(Buffer.alloc(100), 10, 10);
    expect(result).toBe(1.0842);
    expect(ocrService.getFreshPrice()).toBe(1.0842);
  });

  it('runImageOcr is throttled to the configured interval', async () => {
    const ocrService = new OcrService();
    ocrService.setImageOcrEnabled(true);
    let calls = 0;
    ocrService.setImageOcrEngine(async () => {
      calls++;
      return '1.0842';
    });
    await ocrService.runImageOcr(Buffer.alloc(100), 10, 10);
    const second = await ocrService.runImageOcr(Buffer.alloc(100), 10, 10);
    expect(second).toBeNull();
    expect(calls).toBe(1);
  });

  it('runImageOcr handles engine failure gracefully', async () => {
    const ocrService = new OcrService();
    ocrService.setImageOcrEnabled(true);
    ocrService.setImageOcrEngine(async () => {
      throw new Error('boom');
    });
    const result = await ocrService.runImageOcr(Buffer.alloc(100), 10, 10);
    expect(result).toBeNull();
  });

  it('runImageOcr rejects garbage text without crashing', async () => {
    const ocrService = new OcrService();
    ocrService.setImageOcrEnabled(true);
    ocrService.setImageOcrEngine(async () => 'no numbers in this text');
    const result = await ocrService.runImageOcr(Buffer.alloc(100), 10, 10);
    expect(result).toBeNull();
  });
});
