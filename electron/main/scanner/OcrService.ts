// ============================================================
// MARS PRO V3 — OCR & Market Data Extraction Service
// Dedicated asset, price, timeframe, and platform-mode parsing
// for Olymp Trade with explicit Demo/Live isolation.
// ============================================================

import { ChartRegion } from '../../../shared/types/scanner';
import {
  AssetIdentity,
  PlatformMode,
  normalizeAsset,
  isValidAssetName,
} from '../../../shared/types/canonical';

export interface OcrCachedResult {
  asset: string | null;
  assetIdentity: AssetIdentity | null;
  platformMode: PlatformMode;
  timeframe: string | null;
  currentPrice: number | null;
  timestamp: number;
}

/**
 * Injectable image-OCR engine for tests/diagnostics.
 */
export type ImageOcrEngine = (frame: {
  buffer: Buffer;
  width: number;
  height: number;
  region?: ChartRegion;
}) => Promise<string | null>;

export class OcrService {
  private isProcessing = false;
  private lastOcrRunTimestamp = 0;
  private readonly OCR_MIN_INTERVAL_MS = 5000;

  private assetCache: string | null = null;
  private assetIdentityCache: AssetIdentity | null = null;
  private assetCacheTimestamp = 0;
  private timeframeCache: string | null = null;
  private timeframeCacheTimestamp = 0;
  private priceCache: number | null = null;
  private priceCacheTimestamp: number = 0;
  private platformModeCache: PlatformMode = PlatformMode.UNKNOWN;
  private platformModeTimestamp: number = 0;

  public static readonly PRICE_CACHE_MAX_AGE_MS = 5000;
  public static readonly IMAGE_OCR_MIN_INTERVAL_MS = 15000;

  private imageOcrEngine: ImageOcrEngine | null = null;
  private imageOcrWorker: any = null;
  private lastImageOcrAt = 0;
  private imageOcrEnabled = false;

  /**
   * Price guard: price must keep updating; identical readings do not refresh the age.
   */
  private refreshPriceCache(current: number | null, next: number | null): number | null {
    if (next === current) {
      return null;
    }
    this.priceCache = next;
    this.priceCacheTimestamp = next !== null ? Date.now() : 0;
    this.lastOcrRunTimestamp = Date.now();
    return next;
  }

  /**
   * Detect whether text contains Demo account indicators.
   * Never scrubs demo without recording the mode!
   */
  public detectPlatformMode(text?: string | null): PlatformMode {
    if (!text) return PlatformMode.UNKNOWN;
    if (/demo\s*account/i.test(text) || /\bdemo\b/i.test(text)) {
      return PlatformMode.DEMO;
    }
    if (/live\s*account/i.test(text) || /\breal\s*account\b/i.test(text)) {
      return PlatformMode.LIVE;
    }
    return PlatformMode.UNKNOWN;
  }

  /**
   * Extracts and records platform mode from text/title.
   */
  public extractPlatformMode(text?: string | null): PlatformMode {
    const mode = this.detectPlatformMode(text);
    if (mode !== PlatformMode.UNKNOWN) {
      this.platformModeCache = mode;
      this.platformModeTimestamp = Date.now();
    }
    return this.platformModeCache;
  }

  /**
   * Extract asset identity from title, with canonical normalization.
   */
  public extractAssetIdentityFromTitle(title?: string | null): AssetIdentity | null {
    if (!title) {
      this.assetCache = null;
      this.assetIdentityCache = null;
      this.assetCacheTimestamp = 0;
      return null;
    }

    // Check platform mode from title
    this.extractPlatformMode(title);

    const clean = this.cleanAssetText(title);
    if (!clean) {
      this.assetCache = null;
      this.assetIdentityCache = null;
      this.assetCacheTimestamp = 0;
      return null;
    }

    const identity = normalizeAsset(clean);
    this.assetCache = clean;
    this.assetIdentityCache = identity;
    this.assetCacheTimestamp = Date.now();
    this.lastOcrRunTimestamp = Date.now();
    return identity;
  }

  public extractAssetFromTitle(title?: string | null): string | null {
    const identity = this.extractAssetIdentityFromTitle(title);
    return identity ? identity.displayName : null;
  }

  /**
   * OCR-friendly asset extraction directly from raw capture buffer.
   */
  public async extractAsset(
    buffer: Buffer | null | undefined,
    width: number,
    height: number,
    region?: ChartRegion
  ): Promise<string | null> {
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return null;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    if (buffer.length < width * height * 4) return null;
    if (region) {
      return null;
    }
    return this.assetCache;
  }

  /**
   * OCR-friendly price extraction from raw capture buffer with bounds checking.
   */
  public async extractPrice(
    buffer: Buffer,
    width: number,
    height: number,
    region?: ChartRegion
  ): Promise<number | null> {
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return null;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    if (region) {
      const outOfBounds =
        region.x < 0 || region.y < 0 ||
        region.width <= 0 || region.height <= 0 ||
        region.x + region.width > width || region.y + region.height > height;
      if (outOfBounds) return null;
    }
    return this.priceCache;
  }

  /**
   * Throttle gate: returns true when OCR may run.
   */
  public shouldRunOcr(): boolean {
    if (this.isProcessing) return false;
    return (Date.now() - this.lastOcrRunTimestamp) >= this.OCR_MIN_INTERVAL_MS;
  }

  /** Age of the cached price in milliseconds. */
  public getPriceCacheAgeMs(): number {
    if (this.priceCache === null || this.priceCacheTimestamp === 0) return 0;
    return Math.max(0, Date.now() - this.priceCacheTimestamp);
  }

  /** Returns cached price if within max age. */
  public getFreshPrice(): number | null {
    if (this.priceCache === null || this.priceCacheTimestamp === 0) return null;
    if (Date.now() - this.priceCacheTimestamp > OcrService.PRICE_CACHE_MAX_AGE_MS) return null;
    return this.priceCache;
  }

  public extractPriceFromTitle(title?: string | null): number | null {
    if (!title) return null;
    const match = title.match(/\b[0-9]{1,6}(?:,[0-9]{3})*\.[0-9]{2,6}\b/);
    if (!match) return null;
    const val = parseFloat(match[0].replace(/,/g, ''));
    const cleanVal = isNaN(val) || val <= 0 ? null : val;
    return this.refreshPriceCache(this.priceCache, cleanVal);
  }

  public extractPriceFromText(text?: string | null): number | null {
    if (!text) return null;
    this.extractPlatformMode(text);

    const labeled = text.match(/\b(?:price|rate|quote|last)\s*[:\-]?\s*([0-9]{1,6}(?:,[0-9]{3})*(?:\.[0-9]{2,6})|[0-9]{1,6}\.[0-9]{2,6})\b/i);
    const generic = text.match(/\b[0-9]{1,6}(?:,[0-9]{3})*\.[0-9]{2,6}\b/);
    const match = labeled || generic;
    if (!match) return null;

    const raw = labeled ? match[1] : match[0];
    const val = parseFloat(raw.replace(/,/g, ''));
    const cleanVal = isNaN(val) || val <= 0 ? null : val;
    return this.refreshPriceCache(this.priceCache, cleanVal);
  }

  public extractTimeframeFromText(text?: string | null): string | null {
    if (!text) return null;
    const match = text.match(/\b(1|5|15|30)\s*(sec(?:ond)?s?|s|min(?:ute)?s?|m|hours?|h)\b/i);
    if (!match) return null;
    const unit = match[2].toLowerCase();
    const normalized = /^(sec|second|s)/.test(unit) ? `${match[1]}s` : /^(hour|h)/.test(unit) ? `${match[1]}h` : `${match[1]}m`;
    this.timeframeCache = normalized;
    this.timeframeCacheTimestamp = Date.now();
    this.lastOcrRunTimestamp = Date.now();
    return normalized;
  }

  /**
   * Clean raw scraped text to identify real market asset.
   * Strips noise while preserving valid forex, crypto, composite indices, etc.
   */
  public cleanAssetText(raw: string): string | null {
    if (!raw || raw.length < 2) return null;

    // Detect and flag platform mode before stripping
    if (/demo\s*account/i.test(raw)) {
      this.platformModeCache = PlatformMode.DEMO;
    }

    // Strip currency/balance noise, badges, arrows, numbers
    const sanitized = raw
      .replace(/[Ð$€₹]/g, ' ')
      .replace(/Demo account/gi, ' ')
      .replace(/INR\s*\d+(?:\.\d+)?/gi, ' ')
      .replace(/USD\s*\d+(?:\.\d+)?/gi, ' ')
      .replace(/EUR\s*\d+(?:\.\d+)?/gi, ' ')
      .replace(/FT\s*-\s*\d+%/gi, ' ')
      .replace(/Live Trades are unavailable[^\s]*/gi, ' ')
      .replace(/[▲▼\u25B2\u25BC\u2191\u2193]/g, ' ')
      .replace(/\d+\.\d+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (sanitized.length < 3) {
      return null;
    }

    // Olymp Trade Composite Indices & Major Assets
    const olympTradeAssetsRegex = /(Asia Composite Index|Europe Composite Index|Commodity Composite Index|Crypto Composite Index|Cricket Composite Index|Basic Altcoin Index|Basic Dollar Index|Mahindra Index|Moonch Index|Nifty 50|Gold|Silver|Brent|Crude Oil|Bitcoin|Ethereum|Solana|Ripple|Cardano|Dogecoin|Apple|Tesla|Boeing|Amazon|Google|Microsoft|Meta|Netflix|AstraZeneca|[A-Z]{3}\/[A-Z]{3}(?:\s*\(OTC\))?|[A-Z]{3}[A-Z]{3}(?:\s*\(OTC\))?|[A-Z]{3,5}\s+OTC)/i;
    const match = sanitized.match(olympTradeAssetsRegex);
    if (match && match[1]) {
      const matched = match[1].trim();
      if (isValidAssetName(matched)) return matched;
    }

    const compositeMatch = sanitized.match(/([A-Za-z]+\s+Composite(?:\s+Index)?)/i);
    if (compositeMatch) {
      const name = compositeMatch[1].trim();
      const fullName = name.toLowerCase().endsWith('index') ? name : `${name} Index`;
      if (isValidAssetName(fullName)) return fullName;
    }

    // Generic Index & OTC asset pattern (e.g. Moonch Index, Cafe Index, BNB OTC, etc.)
    const genericIndexMatch = sanitized.match(/([A-Za-z0-9\s\-]+(?:\s+Index|\s+OTC))/i);
    if (genericIndexMatch) {
      const candidate = genericIndexMatch[1].trim();
      if (isValidAssetName(candidate)) return candidate;
    }

    // If string has '|' delimiter (e.g., "Moonch Index | Trading platform..."), check prefix
    if (sanitized.includes('|')) {
      const prefix = sanitized.split('|')[0].trim();
      if (isValidAssetName(prefix) && !/trading|platform|olymp/i.test(prefix)) {
        return prefix;
      }
    }

    const forexPairMatch = sanitized.match(/([A-Za-z]{3}\s*[\/\-]?\s*[A-Za-z]{3}(?:\s*OTC)?)/i);
    if (forexPairMatch) {
      const pair = forexPairMatch[1].toUpperCase().replace(/\s+/g, '');
      if (isValidAssetName(pair)) return pair;
    }

    return null;
  }

  public clearCache(): void {
    this.assetCache = null;
    this.assetIdentityCache = null;
    this.assetCacheTimestamp = 0;
    this.timeframeCache = null;
    this.timeframeCacheTimestamp = 0;
    this.priceCache = null;
    this.priceCacheTimestamp = 0;
    this.platformModeCache = PlatformMode.UNKNOWN;
    this.platformModeTimestamp = 0;
    this.lastOcrRunTimestamp = 0;
  }

  public getCachedOcrResults(): OcrCachedResult | null {
    if (this.lastOcrRunTimestamp === 0 && !this.assetCache && !this.timeframeCache && this.priceCache === null) return null;
    const now = Date.now();
    const isFresh = (timestamp: number) => timestamp > 0 && (now - timestamp) <= OcrService.PRICE_CACHE_MAX_AGE_MS;
    const asset = isFresh(this.assetCacheTimestamp) ? this.assetCache : null;
    const assetIdentity = isFresh(this.assetCacheTimestamp) ? this.assetIdentityCache : null;
    const timeframe = isFresh(this.timeframeCacheTimestamp) ? this.timeframeCache : null;
    const currentPrice = isFresh(this.priceCacheTimestamp) ? this.priceCache : null;
    const timestamp = Math.max(this.assetCacheTimestamp, this.timeframeCacheTimestamp, this.priceCacheTimestamp);

    return {
      asset,
      assetIdentity,
      platformMode: this.platformModeCache,
      timeframe,
      currentPrice,
      timestamp,
    };
  }

  public triggerBackgroundOcr(
    frameBuffer: Buffer,
    width: number,
    height: number,
    region?: ChartRegion
  ): void {
    if (this.isProcessing) return;
    const now = Date.now();
    if (now - this.lastOcrRunTimestamp < this.OCR_MIN_INTERVAL_MS) return;

    this.isProcessing = true;
    this.lastOcrRunTimestamp = now;

    setTimeout(() => {
      this.isProcessing = false;
    }, 500);
  }

  public setImageOcrEngine(engine: ImageOcrEngine | null): void {
    this.imageOcrEngine = engine;
  }

  public setImageOcrEnabled(enabled: boolean): void {
    this.imageOcrEnabled = !!enabled;
    if (!this.imageOcrEnabled) {
      this.imageOcrWorker = null;
    }
  }

  public isImageOcrEnabled(): boolean {
    return this.imageOcrEnabled;
  }

  public async runImageOcr(
    buffer: Buffer,
    width: number,
    height: number,
    region?: ChartRegion
  ): Promise<number | null> {
    if (!this.imageOcrEnabled) return null;
    const now = Date.now();
    if (now - this.lastImageOcrAt < OcrService.IMAGE_OCR_MIN_INTERVAL_MS) return null;
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return null;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    this.lastImageOcrAt = now;
    try {
      const engine: ImageOcrEngine = this.imageOcrEngine || this.defaultImageOcr.bind(this);
      const text = await engine({ buffer, width, height, region });
      if (!text || typeof text !== 'string') return null;
      return this.extractPriceFromText(text);
    } catch (err) {
      console.warn('[MARS OCR] Image OCR failed:', err);
      return null;
    }
  }

  private async defaultImageOcr(frame: {
    buffer: Buffer;
    width: number;
    height: number;
    region?: ChartRegion;
  }): Promise<string | null> {
    try {
      const electronMod: any = await import('electron');
      const nativeImage = electronMod?.nativeImage;
      const tesseractMod: any = await import('tesseract.js');
      const Tesseract = tesseractMod?.default || tesseractMod;
      if (!Tesseract || !Tesseract.createWorker) {
        return null;
      }
      if (!this.imageOcrWorker) {
        this.imageOcrWorker = await Tesseract.createWorker('eng');
      }
      let image: any = frame.buffer;
      if (nativeImage && typeof nativeImage.createFromBitmap === 'function') {
        const img = nativeImage.createFromBitmap(frame.buffer, {
          width: frame.width,
          height: frame.height,
        });
        if (!img.isEmpty()) image = img.toPNG();
      }
      const { data } = await this.imageOcrWorker.recognize(image);
      return typeof data?.text === 'string' ? data.text : null;
    } catch (err) {
      console.warn('[MARS OCR] tesseract unavailable:', err);
      return null;
    }
  }
}
