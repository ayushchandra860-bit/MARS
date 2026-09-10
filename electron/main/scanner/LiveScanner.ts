// ============================================================
// MARS PRO V3 — Live Scanner Pipeline
// Orchestrates Capture -> ROI -> Candle -> OCR -> Observation.
// ============================================================

import { ScreenCaptureService } from './ScreenCaptureService';
import { ChartLocator } from './ChartLocator';
import { CandleDetector } from './CandleDetector';
import { OcrService } from './OcrService';
import { DiagnosticsTracker } from './ScannerDiagnostics';
import {
  SessionId,
  ScreenRect,
  QualityLevel,
  ScannerDiagnosticReport,
  ChartRegion,
} from '../../../shared/types/scanner';
import { ScannerStage, StageStatus } from '../../../shared/types/diagnostics';
import { MarketObservation } from '../../../shared/types/observation';
import {
  AssetIdentity,
  PlatformMode,
  DataFreshness,
  DataSource,
  computeFreshness,
  normalizeAsset,
} from '../../../shared/types/canonical';

export interface ScanResult {
  observation: MarketObservation | null;
  diagnostics: ScannerDiagnosticReport;
  diagnosticsTracker?: DiagnosticsTracker | null;
}

export class LiveScanner {
  private captureService = new ScreenCaptureService();
  private chartLocator = new ChartLocator();
  private candleDetector = new CandleDetector();
  private ocrService = new OcrService();

  private cachedChartRegion: ChartRegion | null = null;
  private cachedChartRegionTimestamp: number = 0;
  private scanCount: number = 0;
  private static readonly MIN_SIGNAL_CANDLES = 8;

  // Candle cache for the DOM-fast path
  private candleCache: { candles: any[]; candleQuality: QualityLevel; region: ChartRegion; cropRatio: number; capturedAt: number } | null = null;
  private static readonly CANDLE_CACHE_MAX_AGE_MS = 5000;
  private backgroundCapturePending = false;

  async scanOnce(
    sessionId: SessionId,
    overlayBounds?: ScreenRect
  ): Promise<ScanResult> {
    const diagnosticsTracker = new DiagnosticsTracker();
    const pipelineStart = Date.now();
    this.scanCount++;

    try {
      // --- Step 0: DOM-first (cheapest possible path) ---------------------
      const sourceTitle = this.captureService.getActiveSourceName() || '';
      const titleAsset = this.ocrService.cleanAssetText(sourceTitle);
      const titlePrice = this.ocrService.extractPriceFromTitle(sourceTitle);

      const now0 = Date.now();
      const candleCacheFresh =
        !!this.candleCache &&
        (now0 - this.candleCache.capturedAt) < LiveScanner.CANDLE_CACHE_MAX_AGE_MS;

      // FAST PATH: only use fast observation if DOM title yields asset + price AND candleCache has valid candles
      if (titleAsset && titlePrice !== null && candleCacheFresh && this.candleCache && this.candleCache.candles.length >= 3) {
        return this.buildFastObservation(
          sessionId,
          sourceTitle,
          titleAsset,
          titlePrice,
          diagnosticsTracker,
          now0
        );
      }

      // --- Heavy path: capture + pixel analysis ---------------------------
      diagnosticsTracker.recordStage(ScannerStage.CAPTURE, StageStatus.PASS, 'Screen capture started');

      const displayId = 'primary';
      const frame = await this.captureService.captureFrame(displayId, sessionId);

      if (!frame || !frame.buffer || frame.width <= 0 || frame.height <= 0) {
        diagnosticsTracker.recordStage(ScannerStage.CAPTURE, StageStatus.FAIL, 'Empty frame buffer');
        const fallbackDiag = diagnosticsTracker.generateReport();
        return {
          observation: null,
          diagnostics: fallbackDiag,
          diagnosticsTracker,
        };
      }

      if (this.isBlankFrame(frame.buffer)) {
        diagnosticsTracker.recordStage(ScannerStage.FRAME, StageStatus.FAIL, 'Capture contains no visible workstation pixels');
        return { observation: null, diagnostics: diagnosticsTracker.generateReport(), diagnosticsTracker };
      }

      diagnosticsTracker.recordStage(ScannerStage.FRAME, StageStatus.PASS, `${frame.width}x${frame.height}`);

      // 2. Locate Chart ROI
      const roiCacheExpired = this.cachedChartRegionTimestamp > 0 && (Date.now() - this.cachedChartRegionTimestamp) > 10000;
      let region: ChartRegion | null = roiCacheExpired ? null : this.cachedChartRegion;
      if (!region) {
        region = this.chartLocator.locateChart(
          frame.buffer,
          frame.width,
          frame.height,
          frame.scaleFactor
        );
        if (region && region.confidence >= 0.5) {
          this.cachedChartRegion = region;
          this.cachedChartRegionTimestamp = Date.now();
        }
      }

      if (!region || region.confidence < 0.5) {
        diagnosticsTracker.recordStage(ScannerStage.CHART_ROI, StageStatus.FAIL, 'Chart region could not be located');
        return { observation: null, diagnostics: diagnosticsTracker.generateReport(), diagnosticsTracker };
      }

      diagnosticsTracker.recordStage(ScannerStage.CHART_ROI, StageStatus.PASS, `${region.width}x${region.height} @ (${region.x},${region.y})`);

      // 3. Candle Detection
      const cropRatio = this.detectChartCropRatio(frame.buffer, frame.width, frame.height, region);
      const candleScanRegion: ChartRegion = {
        ...region,
        height: Math.floor(region.height * cropRatio),
      };

      const candleResult = this.candleDetector.detect(
        frame.buffer,
        frame.width,
        frame.height,
        candleScanRegion
      );

      const candleCount = candleResult?.validatedCandleCount || 0;
      diagnosticsTracker.recordStage(
        ScannerStage.CANDLES,
        candleCount >= 3 ? StageStatus.PASS : StageStatus.PARTIAL,
        `Validated: ${candleCount}`
      );

      this.candleCache = {
        candles: candleResult?.candles || [],
        candleQuality: candleResult?.candleQuality || QualityLevel.ACCEPTABLE,
        region,
        cropRatio,
        capturedAt: Date.now(),
      };

      // 4. OCR Extraction
      this.ocrService.triggerBackgroundOcr(frame.buffer, frame.width, frame.height, region);

      const needBodyText = titlePrice === null || !titleAsset;
      let sourceText = '';
      if (needBodyText) {
        sourceText = await this.captureService.getActiveMarketText();
      }

      let extractedAsset: string | null = null;
      if (titleAsset) {
        this.ocrService.extractAssetFromTitle(sourceTitle);
        extractedAsset = titleAsset;
      } else {
        extractedAsset = this.ocrService.extractAssetFromTitle(sourceText);
      }

      const extractedPrice = titlePrice ?? (sourceText ? this.ocrService.extractPriceFromText(sourceText) : null);
      const extractedTimeframe = sourceText ? this.ocrService.extractTimeframeFromText(sourceText) : null;
      const ocrResults = this.ocrService.getCachedOcrResults();

      const cleanAssetString = extractedAsset || (typeof ocrResults?.asset === 'string' ? ocrResults.asset : null);
      const cleanTimeframe = extractedTimeframe || (typeof ocrResults?.timeframe === 'string' ? ocrResults.timeframe : null);
      let cleanPrice: number | null = null;
      if (extractedPrice !== null && extractedPrice !== undefined) {
        cleanPrice = extractedPrice;
      } else if (typeof ocrResults?.currentPrice === 'number') {
        cleanPrice = ocrResults.currentPrice;
      }

      if (cleanPrice === null) {
        this.ocrService
          .runImageOcr(frame.buffer, frame.width, frame.height, region)
          .catch(() => {});
      }

      diagnosticsTracker.recordStage(
        ScannerStage.OCR,
        cleanAssetString ? StageStatus.PASS : StageStatus.PARTIAL,
        cleanAssetString ? `Asset identified: ${cleanAssetString}` : 'Asset not identified'
      );

      // 5. Build Market Observation
      const timestamp = Date.now();
      const observationId = `obs_${frame.frameId}_${timestamp}`;
      const dataQuality = this.deriveDataQuality(candleCount, candleResult?.candleQuality || QualityLevel.FAILED, region.confidence, cleanAssetString);
      const assetIdentity = ocrResults?.assetIdentity || normalizeAsset(cleanAssetString, timestamp);
      const platformMode = ocrResults?.platformMode || this.ocrService.extractPlatformMode(sourceTitle || sourceText);
      const freshness = computeFreshness(timestamp);
      const source = titlePrice !== null ? DataSource.DOM_TITLE : (sourceText ? DataSource.DOM_BODY : DataSource.OCR);

      const observation: MarketObservation = {
        observationId,
        sessionId,
        frameId: frame.frameId,
        timestamp,
        asset: cleanAssetString,
        assetIdentity,
        platformMode,
        freshness,
        source,
        timeframe: cleanTimeframe,
        currentPrice: cleanPrice,
        candles: candleResult?.candles || [],
        candleQuality: candleResult?.candleQuality || QualityLevel.ACCEPTABLE,
        captureQuality: QualityLevel.HIGH,
        chartQuality: region.confidence >= 0.8 ? QualityLevel.HIGH : QualityLevel.ACCEPTABLE,
        dataQuality,
        trendEvidence: null,
        momentumEvidence: null,
        volatilityEvidence: null,
        structureEvidence: null,
        supportResistanceEvidence: null,
        patternEvidence: null,
      };

      diagnosticsTracker.recordStage(
        ScannerStage.OBSERVATION,
        candleCount >= 3 ? StageStatus.PASS : StageStatus.PARTIAL,
        candleCount >= 3 ? 'Observation assembled' : 'Observation assembled with insufficient candle evidence'
      );
      const diagnosticsReport = diagnosticsTracker.generateReport();

      return {
        observation,
        diagnostics: diagnosticsReport,
        diagnosticsTracker,
      };
    } catch (e) {
      diagnosticsTracker.recordStage(ScannerStage.CAPTURE, StageStatus.FAIL, (e as Error).message);
      const fallbackDiag = diagnosticsTracker.generateReport();
      return {
        observation: null,
        diagnostics: fallbackDiag,
        diagnosticsTracker,
      };
    }
  }

  private buildFastObservation(
    sessionId: SessionId,
    sourceTitle: string,
    asset: string,
    price: number,
    diagnosticsTracker: DiagnosticsTracker,
    now: number
  ): ScanResult {
    const assetIdentity = this.ocrService.extractAssetIdentityFromTitle(sourceTitle) || normalizeAsset(asset, now);
    this.ocrService.extractPriceFromTitle(sourceTitle);
    const platformMode = this.ocrService.extractPlatformMode(sourceTitle);

    const cache = this.candleCache;
    const timestamp = now;
    const observationId = `obs_fast_${timestamp}`;
    const candles = cache?.candles || [];
    const candleQuality = cache?.candleQuality || QualityLevel.LOW;
    const candleCount = candles.length;
    const chartConfidence = cache?.region.confidence || 0;
    const dataQuality = this.deriveDataQuality(
      candleCount,
      candleQuality,
      chartConfidence,
      asset
    );

    diagnosticsTracker.recordStage(
      ScannerStage.CAPTURE,
      cache ? StageStatus.PASS : StageStatus.PARTIAL,
      cache
        ? `DOM fast-path (candle cache ${Math.round((now - cache.capturedAt) / 1000)}s old)`
        : 'DOM fast-path (waiting for first chart capture)'
    );
    diagnosticsTracker.recordStage(
      ScannerStage.CHART_ROI,
      cache ? StageStatus.PASS : StageStatus.PARTIAL,
      cache
        ? `Cached region ${cache.region.width}x${cache.region.height} @ (${cache.region.x},${cache.region.y})`
        : 'Chart ROI not available yet; background capture pending'
    );
    diagnosticsTracker.recordStage(
      ScannerStage.CANDLES,
      candleCount >= 3 ? StageStatus.PASS : StageStatus.PARTIAL,
      cache ? `Cached: ${candleCount}` : 'Candle cache warming'
    );
    diagnosticsTracker.recordStage(ScannerStage.OCR, StageStatus.PASS, `Asset identified from title: ${asset}`);

    const observation: MarketObservation = {
      observationId,
      sessionId,
      frameId: `fast-${timestamp}`,
      timestamp,
      asset,
      assetIdentity,
      platformMode,
      freshness: computeFreshness(timestamp),
      source: DataSource.DOM_TITLE,
      timeframe: null,
      currentPrice: price,
      candles,
      candleQuality,
      captureQuality: cache ? QualityLevel.HIGH : QualityLevel.LOW,
      chartQuality: cache
        ? (cache.region.confidence >= 0.8 ? QualityLevel.HIGH : QualityLevel.ACCEPTABLE)
        : QualityLevel.LOW,
      dataQuality,
      trendEvidence: null,
      momentumEvidence: null,
      volatilityEvidence: null,
      structureEvidence: null,
      supportResistanceEvidence: null,
      patternEvidence: null,
    };

    diagnosticsTracker.recordStage(
      ScannerStage.OBSERVATION,
      candleCount >= 3 ? StageStatus.PASS : StageStatus.PARTIAL,
      candleCount >= 3
        ? 'Observation assembled (fast path)'
        : 'Observation assembled while candle cache is warming'
    );
    const diagnosticsReport = diagnosticsTracker.generateReport();

    return {
      observation,
      diagnostics: diagnosticsReport,
      diagnosticsTracker,
    };
  }

  async scanFrame(
    sessionId: SessionId,
    frameBuffer: Buffer,
    width: number,
    height: number
  ): Promise<ScanResult> {
    const diagnosticsTracker = new DiagnosticsTracker();

    diagnosticsTracker.recordStage(ScannerStage.CAPTURE, StageStatus.PASS, 'Frame supplied directly');
    diagnosticsTracker.recordStage(ScannerStage.FRAME, StageStatus.PASS, `${width}x${height}`);

    const region = this.chartLocator.locateChart(frameBuffer, width, height, 1.0);
    diagnosticsTracker.recordStage(ScannerStage.CHART_ROI, StageStatus.PASS, `${region.width}x${region.height} @ (${region.x},${region.y})`);

    const candleScanRegion: ChartRegion = {
      ...region,
      height: Math.floor(region.height * 0.70),
    };

    const candleResult = this.candleDetector.detect(frameBuffer, width, height, candleScanRegion);
    diagnosticsTracker.recordStage(ScannerStage.CANDLES, StageStatus.PASS, `Count: ${candleResult.validatedCandleCount}`);

    const timestamp = Date.now();
    const frameId = `frame-${timestamp}`;
    const observation: MarketObservation = {
      observationId: `obs_${frameId}_${timestamp}`,
      sessionId,
      frameId,
      timestamp,
      captureQuality: QualityLevel.HIGH,
      chartQuality: region.confidence >= 0.8 ? QualityLevel.HIGH : QualityLevel.ACCEPTABLE,
      candleQuality: candleResult.candleQuality,
      dataQuality: QualityLevel.HIGH,
      candles: candleResult.candles,
      asset: null,
      assetIdentity: null,
      platformMode: PlatformMode.UNKNOWN,
      freshness: DataFreshness.FRESH,
      source: DataSource.OCR,
      timeframe: null,
      currentPrice: null,
      trendEvidence: null,
      momentumEvidence: null,
      volatilityEvidence: null,
      structureEvidence: null,
      supportResistanceEvidence: null,
      patternEvidence: null,
    };

    diagnosticsTracker.recordStage(ScannerStage.OBSERVATION, StageStatus.PASS, 'MarketObservation assembled');
    const diagnosticsReport = diagnosticsTracker.generateReport();

    return {
      observation,
      diagnostics: diagnosticsReport,
      diagnosticsTracker,
    };
  }

  setImageOcrEnabled(enabled: boolean): void {
    this.ocrService.setImageOcrEnabled(enabled);
  }

  clearCache(): void {
    this.cachedChartRegion = null;
    this.candleCache = null;
    this.scanCount = 0;
    this.captureService.clearCache();
    this.ocrService.clearCache();
  }

  private detectChartCropRatio(buffer: Buffer, frameW: number, frameH: number, region: ChartRegion): number {
    const startY = region.y + Math.floor(region.height * 0.55);
    const endY = region.y + Math.floor(region.height * 0.85);
    const sampleX1 = region.x + Math.floor(region.width * 0.2);
    const sampleX2 = region.x + Math.floor(region.width * 0.5);
    const sampleX3 = region.x + Math.floor(region.width * 0.8);

    for (let y = startY; y < endY; y++) {
      let darkCount = 0;
      for (const sx of [sampleX1, sampleX2, sampleX3]) {
        const clampedX = Math.max(0, Math.min(sx, frameW - 1));
        const clampedY = Math.max(0, Math.min(y, frameH - 1));
        const idx = (clampedY * frameW + clampedX) * 4;
        if (idx + 3 < buffer.length) {
          const b = buffer[idx];
          const g = buffer[idx + 1];
          const r = buffer[idx + 2];
          if (r < 80 && g < 80 && b < 80) darkCount++;
        }
      }
      if (darkCount >= 3) {
        const ratio = (y - region.y) / region.height;
        return Math.max(0.55, Math.min(0.85, ratio));
      }
    }

    return 0.72;
  }

  private isBlankFrame(buffer: Buffer): boolean {
    const pixelCount = Math.floor(buffer.length / 4);
    if (pixelCount === 0) return true;
    const step = Math.max(1, Math.floor(pixelCount / 4_000));
    let nonBlackSamples = 0;
    for (let pixel = 0; pixel < pixelCount; pixel += step) {
      const offset = pixel * 4;
      if (buffer[offset] > 4 || buffer[offset + 1] > 4 || buffer[offset + 2] > 4) nonBlackSamples++;
    }
    return nonBlackSamples < 3;
  }

  async scan(sessionId?: SessionId): Promise<ScanResult | null> {
    return this.scanOnce(sessionId || `session-${Date.now()}`);
  }

  async terminate(): Promise<void> {
    try {
      if ('terminate' in this.ocrService && typeof (this.ocrService as any).terminate === 'function') {
        await (this.ocrService as any).terminate();
      }
    } catch (err) {
      console.error('[MARS] Error terminating scanner OCR service:', err);
    } finally {
      this.clearCache();
    }
  }

  private deriveDataQuality(
    candleCount: number,
    candleQuality: QualityLevel,
    chartConfidence: number,
    asset: string | null,
  ): QualityLevel {
    if (!asset || candleCount < 3 || candleQuality === QualityLevel.FAILED || chartConfidence < 0.5) {
      return QualityLevel.FAILED;
    }
    if (candleCount < LiveScanner.MIN_SIGNAL_CANDLES || candleQuality === QualityLevel.LOW || chartConfidence < 0.65) {
      return QualityLevel.LOW;
    }
    if (candleQuality === QualityLevel.ACCEPTABLE || chartConfidence < 0.8) {
      return QualityLevel.ACCEPTABLE;
    }
    return QualityLevel.HIGH;
  }
}
