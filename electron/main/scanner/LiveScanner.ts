// ============================================================
// MARS PRO V3 — Live Scanner Pipeline
// Lightweight quote observations are separated from worker-based chart scans.
// ============================================================

import { ScreenCaptureService } from './ScreenCaptureService';
import { ChartLocator } from './ChartLocator';
import { CandleDetector } from './CandleDetector';
import { OcrService } from './OcrService';
import { PixelAnalysisResult, PixelAnalysisWorker } from './PixelAnalysisWorker';
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
  private pixelWorker = new PixelAnalysisWorker();

  private cachedChartRegion: ChartRegion | null = null;
  private cachedChartRegionTimestamp = 0;
  private scanCount = 0;
  private consecutiveQuoteMisses = 0;
  private static readonly MIN_SIGNAL_CANDLES = 8;
  private static readonly HEAVY_SCAN_INTERVAL_MS = 3000;
  private static readonly CANDLE_CACHE_MAX_AGE_MS = 12000;
  private static readonly REGION_CACHE_MAX_AGE_MS = 10000;

  private candleCache: {
    candles: any[];
    candleQuality: QualityLevel;
    region: ChartRegion;
    cropRatio: number;
    capturedAt: number;
    assetId: string | null;
    timeframeKey: string | null;
    generation: number;
  } | null = null;
  private backgroundCapturePending = false;
  private marketContextKey: string | null = null;
  private marketContextGeneration = 0;

  async scanOnce(sessionId: SessionId, _overlayBounds?: ScreenRect): Promise<ScanResult> {
    const diagnosticsTracker = new DiagnosticsTracker();
    this.scanCount++;

    try {
      const snapshot = this.captureService.getActiveMarketSnapshot(2200);
      const sourceTitle = snapshot?.title || this.captureService.getActiveSourceName() || '';
      const snapshotAsset = snapshot?.asset ? this.ocrService.cleanAssetText(snapshot.asset) : null;
      const titleAsset = snapshotAsset || this.ocrService.cleanAssetText(sourceTitle);
      const snapshotPrice = typeof snapshot?.price === 'number'
        ? this.ocrService.extractPriceFromText(`Price: ${snapshot.price}`)
        : null;
      const titlePrice = snapshotPrice ?? this.ocrService.extractPriceFromTitle(sourceTitle);
      if (snapshot?.platformMode) this.ocrService.extractPlatformMode(snapshot.platformMode);
      if (snapshot?.timeframe) this.ocrService.extractTimeframeFromText(snapshot.timeframe);

      const now = Date.now();
      const quoteObservedAt = snapshot?.observedAt ?? now;
      const activeAssetId = normalizeAsset(titleAsset, quoteObservedAt)?.assetId || null;
      const activeTimeframeKey = snapshot?.timeframe?.trim().toLowerCase() || null;
      const contextKey = activeAssetId ? `${activeAssetId}|${activeTimeframeKey || 'UNKNOWN'}` : null;
      if (contextKey && this.marketContextKey && contextKey !== this.marketContextKey) {
        this.marketContextGeneration++;
        this.candleCache = null;
      }
      if (contextKey) this.marketContextKey = contextKey;
      const contextGeneration = this.marketContextGeneration;
      const cacheAge = this.candleCache ? now - this.candleCache.capturedAt : Number.POSITIVE_INFINITY;
      const cacheMatchesContext = !!this.candleCache
        && this.candleCache.assetId === activeAssetId
        && this.candleCache.timeframeKey === activeTimeframeKey
        && this.candleCache.generation === contextGeneration;
      const cacheUsable = cacheMatchesContext && cacheAge <= LiveScanner.CANDLE_CACHE_MAX_AGE_MS;

      if (titleAsset && titlePrice !== null && cacheUsable) {
        this.consecutiveQuoteMisses = 0;
        if (cacheAge >= LiveScanner.HEAVY_SCAN_INTERVAL_MS) {
          this.scheduleBackgroundCapture(sessionId, activeAssetId, activeTimeframeKey, contextGeneration);
        }
        return this.buildFastObservation(
          sessionId,
          sourceTitle,
          titleAsset,
          titlePrice,
          snapshot ? DataSource.DOM_BODY : DataSource.DOM_TITLE,
          diagnosticsTracker,
          now,
          quoteObservedAt,
          snapshot?.timeframe || null,
        );
      }

      const heavy = await this.captureAndAnalyze(sessionId, diagnosticsTracker);
      if (!heavy) return { observation: null, diagnostics: diagnosticsTracker.generateReport(), diagnosticsTracker };
      if (contextKey && (contextGeneration !== this.marketContextGeneration || contextKey !== this.marketContextKey)) {
        diagnosticsTracker.recordStage(ScannerStage.OBSERVATION, StageStatus.FAIL, 'Discarded capture from a previous market context');
        return { observation: null, diagnostics: diagnosticsTracker.generateReport(), diagnosticsTracker };
      }
      const { frame, region, cropRatio, candleResult } = heavy;
      const candleCount = candleResult.validatedCandleCount || 0;

      const snapshotText = snapshot
        ? [snapshot.asset, snapshot.price !== null ? `Price: ${snapshot.price}` : '', snapshot.timeframe, snapshot.platformMode]
            .filter(Boolean).join(' | ')
        : '';
      const needFallbackText = titlePrice === null || !titleAsset;
      const sourceText = needFallbackText
        ? (snapshotText || await this.captureService.getActiveMarketText())
        : snapshotText;

      let extractedAsset: string | null = titleAsset;
      if (extractedAsset) this.ocrService.extractAssetFromTitle(extractedAsset);
      else extractedAsset = this.ocrService.extractAssetFromTitle(sourceText);

      const extractedPrice = titlePrice ?? (sourceText ? this.ocrService.extractPriceFromText(sourceText) : null);
      const extractedTimeframe = snapshot?.timeframe || (sourceText ? this.ocrService.extractTimeframeFromText(sourceText) : null);
      const ocrResults = this.ocrService.getCachedOcrResults();
      const cleanAsset = extractedAsset || (typeof ocrResults?.asset === 'string' ? ocrResults.asset : null);
      const cleanTimeframe = extractedTimeframe || (typeof ocrResults?.timeframe === 'string' ? ocrResults.timeframe : null);
      const cleanPrice = extractedPrice ?? (typeof ocrResults?.currentPrice === 'number' ? ocrResults.currentPrice : null);
      const resolvedAssetId = normalizeAsset(cleanAsset, quoteObservedAt)?.assetId || activeAssetId;
      const resolvedTimeframeKey = cleanTimeframe?.trim().toLowerCase() || activeTimeframeKey;
      this.candleCache = {
        candles: candleResult.candles || [],
        candleQuality: candleResult.candleQuality || QualityLevel.ACCEPTABLE,
        region,
        cropRatio,
        capturedAt: Date.now(),
        assetId: resolvedAssetId,
        timeframeKey: resolvedTimeframeKey,
        generation: contextGeneration,
      };

      if (cleanPrice === null) {
        this.consecutiveQuoteMisses++;
        if (this.consecutiveQuoteMisses >= 3) {
          this.ocrService.triggerBackgroundOcr(frame.buffer, frame.width, frame.height, region);
        }
      } else {
        this.consecutiveQuoteMisses = 0;
      }

      diagnosticsTracker.recordStage(
        ScannerStage.OCR,
        cleanAsset ? StageStatus.PASS : StageStatus.PARTIAL,
        cleanAsset ? `Asset identified: ${cleanAsset}` : 'Asset not identified',
      );

      const timestamp = snapshot && snapshotPrice !== null && cleanPrice === snapshotPrice
        ? snapshot.observedAt
        : Date.now();
      const dataQuality = this.deriveDataQuality(candleCount, candleResult.candleQuality, region.confidence, cleanAsset);
      const observation: MarketObservation = {
        observationId: `obs_${frame.frameId}_${timestamp}`,
        sessionId,
        frameId: frame.frameId,
        timestamp,
        asset: cleanAsset,
        assetIdentity: ocrResults?.assetIdentity || normalizeAsset(cleanAsset, timestamp),
        platformMode: snapshot?.platformMode as PlatformMode || ocrResults?.platformMode || this.ocrService.extractPlatformMode(sourceTitle || sourceText),
        freshness: computeFreshness(timestamp, Date.now()),
        source: snapshot?.price !== null && snapshot?.price !== undefined
          ? DataSource.DOM_BODY
          : titlePrice !== null ? DataSource.DOM_TITLE : sourceText ? DataSource.DOM_BODY : DataSource.OCR,
        timeframe: cleanTimeframe,
        currentPrice: cleanPrice,
        candles: candleResult.candles || [],
        candleQuality: candleResult.candleQuality || QualityLevel.ACCEPTABLE,
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
        candleCount >= 3 ? 'Observation assembled' : 'Observation assembled with insufficient candle evidence',
      );
      return { observation, diagnostics: diagnosticsTracker.generateReport(), diagnosticsTracker };
    } catch (error) {
      diagnosticsTracker.recordStage(ScannerStage.CAPTURE, StageStatus.FAIL, error instanceof Error ? error.message : String(error));
      return { observation: null, diagnostics: diagnosticsTracker.generateReport(), diagnosticsTracker };
    }
  }

  private scheduleBackgroundCapture(
    sessionId: SessionId,
    expectedAssetId: string | null,
    expectedTimeframeKey: string | null,
    expectedGeneration: number,
  ): void {
    if (this.backgroundCapturePending) return;
    this.backgroundCapturePending = true;
    const tracker = new DiagnosticsTracker();
    const expectedContextKey = expectedAssetId ? `${expectedAssetId}|${expectedTimeframeKey || 'UNKNOWN'}` : null;
    void this.captureAndAnalyze(sessionId, tracker)
      .then((heavy) => {
        if (!heavy) return;
        if (expectedGeneration !== this.marketContextGeneration || expectedContextKey !== this.marketContextKey) return;
        this.candleCache = {
          candles: heavy.candleResult.candles || [],
          candleQuality: heavy.candleResult.candleQuality || QualityLevel.ACCEPTABLE,
          region: heavy.region,
          cropRatio: heavy.cropRatio,
          capturedAt: Date.now(),
          assetId: expectedAssetId,
          timeframeKey: expectedTimeframeKey,
          generation: expectedGeneration,
        };
      })
      .catch((error) => console.warn('[MARS SCANNER] Background chart refresh failed:', error))
      .finally(() => { this.backgroundCapturePending = false; });
  }

  private async captureAndAnalyze(sessionId: SessionId, diagnostics: DiagnosticsTracker): Promise<{
    frame: Awaited<ReturnType<ScreenCaptureService['captureFrame']>>;
    region: ChartRegion;
    cropRatio: number;
    candleResult: PixelAnalysisResult['candleResult'];
  } | null> {
    diagnostics.recordStage(ScannerStage.CAPTURE, StageStatus.PASS, 'Bounded screen capture started');
    const frame = await this.captureService.captureFrame('embedded', sessionId);
    if (!frame?.buffer || frame.width <= 0 || frame.height <= 0) {
      diagnostics.recordStage(ScannerStage.CAPTURE, StageStatus.FAIL, 'Empty frame buffer');
      return null;
    }
    if (this.isBlankFrame(frame.buffer)) {
      diagnostics.recordStage(ScannerStage.FRAME, StageStatus.FAIL, 'Capture contains no visible workstation pixels');
      return null;
    }
    diagnostics.recordStage(ScannerStage.FRAME, StageStatus.PASS, `${frame.width}x${frame.height}`);

    const regionCacheFresh = this.cachedChartRegion
      && Date.now() - this.cachedChartRegionTimestamp <= LiveScanner.REGION_CACHE_MAX_AGE_MS;
    const result = await this.analyzePixels(
      frame.buffer,
      frame.width,
      frame.height,
      regionCacheFresh ? this.cachedChartRegion : null,
    );
    const region = result.region;
    if (!region || region.confidence < 0.5) {
      diagnostics.recordStage(ScannerStage.CHART_ROI, StageStatus.FAIL, 'Chart region could not be located');
      return null;
    }
    this.cachedChartRegion = region;
    this.cachedChartRegionTimestamp = Date.now();
    diagnostics.recordStage(ScannerStage.CHART_ROI, StageStatus.PASS, `${region.width}x${region.height} @ (${region.x},${region.y})`);
    diagnostics.recordStage(
      ScannerStage.CANDLES,
      result.candleResult.validatedCandleCount >= 3 ? StageStatus.PASS : StageStatus.PARTIAL,
      `Worker validated: ${result.candleResult.validatedCandleCount}`,
    );
    return { frame, ...result };
  }

  private async analyzePixels(
    buffer: Buffer,
    width: number,
    height: number,
    regionHint?: ChartRegion | null,
  ): Promise<PixelAnalysisResult> {
    try {
      return await this.pixelWorker.analyze(buffer, width, height, regionHint);
    } catch (error) {
      console.warn('[MARS SCANNER] Pixel worker unavailable; using bounded local fallback:', error);
      const region = regionHint || this.chartLocator.locateChart(buffer, width, height, 1);
      const cropRatio = this.detectChartCropRatio(buffer, width, height, region);
      const candleResult = this.candleDetector.detect(buffer, width, height, {
        ...region,
        height: Math.max(1, Math.floor(region.height * cropRatio)),
      });
      return { region, cropRatio, candleResult };
    }
  }

  private buildFastObservation(
    sessionId: SessionId,
    sourceTitle: string,
    asset: string,
    price: number,
    source: DataSource,
    diagnosticsTracker: DiagnosticsTracker,
    now: number,
    observedAt: number,
    timeframe: string | null,
  ): ScanResult {
    const assetIdentity = this.ocrService.extractAssetIdentityFromTitle(sourceTitle || asset) || normalizeAsset(asset, observedAt);
    this.ocrService.extractPriceFromText(`Price: ${price}`);
    const platformMode = this.ocrService.extractPlatformMode(sourceTitle);
    const cache = this.candleCache!;
    const cacheAge = Math.max(0, now - cache.capturedAt);
    const cacheDegraded = cacheAge > LiveScanner.HEAVY_SCAN_INTERVAL_MS * 2;
    const candleQuality = cacheDegraded ? QualityLevel.LOW : cache.candleQuality;
    const candleCount = cache.candles.length;
    const dataQuality = this.deriveDataQuality(candleCount, candleQuality, cache.region.confidence, asset);

    diagnosticsTracker.recordStage(ScannerStage.CAPTURE, StageStatus.PASS, `Quote fast-path; chart cache ${Math.round(cacheAge / 1000)}s old`);
    diagnosticsTracker.recordStage(ScannerStage.CHART_ROI, StageStatus.PASS, `Cached region ${cache.region.width}x${cache.region.height}`);
    diagnosticsTracker.recordStage(ScannerStage.CANDLES, candleCount >= 3 ? StageStatus.PASS : StageStatus.PARTIAL, `Cached: ${candleCount}`);
    diagnosticsTracker.recordStage(ScannerStage.OCR, StageStatus.PASS, `Targeted quote feed: ${asset}`);

    const observation: MarketObservation = {
      observationId: `obs_fast_${observedAt}`,
      sessionId,
      frameId: `fast-${observedAt}`,
      timestamp: observedAt,
      asset,
      assetIdentity,
      platformMode,
      freshness: computeFreshness(observedAt, now),
      source,
      timeframe,
      currentPrice: price,
      candles: cache.candles,
      candleQuality,
      captureQuality: cacheDegraded ? QualityLevel.LOW : QualityLevel.HIGH,
      chartQuality: cacheDegraded ? QualityLevel.LOW : cache.region.confidence >= 0.8 ? QualityLevel.HIGH : QualityLevel.ACCEPTABLE,
      dataQuality,
      trendEvidence: null,
      momentumEvidence: null,
      volatilityEvidence: null,
      structureEvidence: null,
      supportResistanceEvidence: null,
      patternEvidence: null,
    };
    diagnosticsTracker.recordStage(ScannerStage.OBSERVATION, candleCount >= 3 ? StageStatus.PASS : StageStatus.PARTIAL, 'Observation assembled from live quote and worker cache');
    return { observation, diagnostics: diagnosticsTracker.generateReport(), diagnosticsTracker };
  }

  async scanFrame(sessionId: SessionId, frameBuffer: Buffer, width: number, height: number): Promise<ScanResult> {
    const diagnosticsTracker = new DiagnosticsTracker();
    diagnosticsTracker.recordStage(ScannerStage.CAPTURE, StageStatus.PASS, 'Frame supplied directly');
    diagnosticsTracker.recordStage(ScannerStage.FRAME, StageStatus.PASS, `${width}x${height}`);
    const result = await this.analyzePixels(frameBuffer, width, height, null);
    diagnosticsTracker.recordStage(ScannerStage.CHART_ROI, StageStatus.PASS, `${result.region.width}x${result.region.height} @ (${result.region.x},${result.region.y})`);
    diagnosticsTracker.recordStage(ScannerStage.CANDLES, StageStatus.PASS, `Count: ${result.candleResult.validatedCandleCount}`);

    const timestamp = Date.now();
    const frameId = `frame-${timestamp}`;
    const observation: MarketObservation = {
      observationId: `obs_${frameId}_${timestamp}`,
      sessionId,
      frameId,
      timestamp,
      captureQuality: QualityLevel.HIGH,
      chartQuality: result.region.confidence >= 0.8 ? QualityLevel.HIGH : QualityLevel.ACCEPTABLE,
      candleQuality: result.candleResult.candleQuality,
      dataQuality: QualityLevel.HIGH,
      candles: result.candleResult.candles,
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
    return { observation, diagnostics: diagnosticsTracker.generateReport(), diagnosticsTracker };
  }

  setImageOcrEnabled(enabled: boolean): void {
    this.ocrService.setImageOcrEnabled(enabled);
  }

  clearCache(): void {
    this.cachedChartRegion = null;
    this.cachedChartRegionTimestamp = 0;
    this.candleCache = null;
    this.scanCount = 0;
    this.consecutiveQuoteMisses = 0;
    this.backgroundCapturePending = false;
    this.marketContextKey = null;
    this.marketContextGeneration++;
    this.captureService.clearCache();
    this.ocrService.clearCache();
  }

  private detectChartCropRatio(buffer: Buffer, frameW: number, frameH: number, region: ChartRegion): number {
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

  private isBlankFrame(buffer: Buffer): boolean {
    const pixelCount = Math.floor(buffer.length / 4);
    if (pixelCount === 0) return true;
    const step = Math.max(1, Math.floor(pixelCount / 4000));
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
      await Promise.allSettled([this.ocrService.terminate(), this.pixelWorker.terminate()]);
    } catch (error) {
      console.error('[MARS] Error terminating scanner services:', error);
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
    if (!asset || candleCount < 3 || candleQuality === QualityLevel.FAILED || chartConfidence < 0.5) return QualityLevel.FAILED;
    if (candleCount < LiveScanner.MIN_SIGNAL_CANDLES || candleQuality === QualityLevel.LOW || chartConfidence < 0.65) return QualityLevel.LOW;
    if (candleQuality === QualityLevel.ACCEPTABLE || chartConfidence < 0.8) return QualityLevel.ACCEPTABLE;
    return QualityLevel.HIGH;
  }
}
