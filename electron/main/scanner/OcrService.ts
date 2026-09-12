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

export type ImageOcrEngine = (frame: {
  buffer: Buffer;
  width: number;
  height: number;
  region?: ChartRegion;
}) => Promise<string | null>;

export class OcrService {
  private isProcessing = false;
  private imageOcrInFlight = false;
  private lastOcrRunTimestamp = 0;
  private readonly OCR_MIN_INTERVAL_MS = 5000;

  private assetCache: string | null = null;
  private assetIdentityCache: AssetIdentity | null = null;
  private assetCacheTimestamp = 0;
  private timeframeCache: string | null = null;
  private timeframeCacheTimestamp = 0;
  private priceCache: number | null = null;
  private priceObservedTimestamp = 0;
  private priceChangedTimestamp = 0;
  private platformModeCache: PlatformMode = PlatformMode.UNKNOWN;
  private platformModeTimestamp = 0;

  public static readonly PRICE_CACHE_MAX_AGE_MS = 5000;
  public static readonly IMAGE_OCR_MIN_INTERVAL_MS = 15000;

  private imageOcrEngine: ImageOcrEngine | null = null;
  private imageOcrWorker: any = null;
  private lastImageOcrAt = 0;
  private imageOcrEnabled = false;

  /**
   * A valid repeated quote is a fresh observation, not missing data. Keep a
   * separate change timestamp so anomaly detection can still tell that the
   * numeric value has not moved for a long time.
   */
  private refreshPriceCache(current: number | null, next: number | null): number | null {
    if (next === null) return null;
    const now = Date.now();
    if (current !== next || this.priceChangedTimestamp === 0) this.priceChangedTimestamp = now;
    this.priceCache = next;
    this.priceObservedTimestamp = now;
    this.lastOcrRunTimestamp = now;
    return next;
  }

  public detectPlatformMode(text?: string | null): PlatformMode {
    if (!text) return PlatformMode.UNKNOWN;
    if (/demo\s*account/i.test(text) || /\bdemo\b/i.test(text)) return PlatformMode.DEMO;
    if (/live\s*account/i.test(text) || /\breal\s*account\b/i.test(text)) return PlatformMode.LIVE;
    return PlatformMode.UNKNOWN;
  }

  public extractPlatformMode(text?: string | null): PlatformMode {
    const mode = this.detectPlatformMode(text);
    if (mode !== PlatformMode.UNKNOWN) {
      this.platformModeCache = mode;
      this.platformModeTimestamp = Date.now();
    }
    return this.platformModeCache;
  }

  public extractAssetIdentityFromTitle(title?: string | null): AssetIdentity | null {
    if (!title) {
      this.assetCache = null;
      this.assetIdentityCache = null;
      this.assetCacheTimestamp = 0;
      return null;
    }

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

  public async extractAsset(
    buffer: Buffer | null | undefined,
    width: number,
    height: number,
    region?: ChartRegion,
  ): Promise<string | null> {
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return null;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    if (buffer.length < width * height * 4) return null;
    if (region) return null;
    return this.assetCache;
  }

  public async extractPrice(
    buffer: Buffer,
    width: number,
    height: number,
    region?: ChartRegion,
  ): Promise<number | null> {
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return null;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    if (region) {
      const outOfBounds = region.x < 0 || region.y < 0
        || region.width <= 0 || region.height <= 0
        || region.x + region.width > width || region.y + region.height > height;
      if (outOfBounds) return null;
    }
    return this.priceCache;
  }

  public shouldRunOcr(): boolean {
    if (this.isProcessing || this.imageOcrInFlight) return false;
    return Date.now() - this.lastOcrRunTimestamp >= this.OCR_MIN_INTERVAL_MS;
  }

  /** Age since the source last supplied a valid quote heartbeat. */
  public getPriceCacheAgeMs(): number {
    if (this.priceCache === null || this.priceObservedTimestamp === 0) return 0;
    return Math.max(0, Date.now() - this.priceObservedTimestamp);
  }

  /** Age since the quote value itself last changed. */
  public getPriceChangeAgeMs(): number {
    if (this.priceCache === null || this.priceChangedTimestamp === 0) return 0;
    return Math.max(0, Date.now() - this.priceChangedTimestamp);
  }

  public getFreshPrice(): number | null {
    if (this.priceCache === null || this.priceObservedTimestamp === 0) return null;
    if (Date.now() - this.priceObservedTimestamp > OcrService.PRICE_CACHE_MAX_AGE_MS) return null;
    return this.priceCache;
  }

  public extractPriceFromTitle(title?: string | null): number | null {
    if (!title) return null;
    const match = title.match(/\b[0-9]{1,6}(?:,[0-9]{3})*\.[0-9]{2,6}\b/);
    if (!match) return null;
    const val = parseFloat(match[0].replace(/,/g, ''));
    return this.refreshPriceCache(this.priceCache, Number.isFinite(val) && val > 0 ? val : null);
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
    return this.refreshPriceCache(this.priceCache, Number.isFinite(val) && val > 0 ? val : null);
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

  public cleanAssetText(raw: string): string | null {
    if (!raw || raw.length < 2) return null;
    if (/demo\s*account/i.test(raw)) this.platformModeCache = PlatformMode.DEMO;

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

    if (sanitized.length < 3) return null;

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

    const genericIndexMatch = sanitized.match(/([A-Za-z0-9\s\-]+(?:\s+Index|\s+OTC))/i);
    if (genericIndexMatch) {
      const candidate = genericIndexMatch[1].trim();
      if (isValidAssetName(candidate)) return candidate;
    }

    if (sanitized.includes('|')) {
      const prefix = sanitized.split('|')[0].trim();
      if (isValidAssetName(prefix) && !/trading|platform|olymp/i.test(prefix)) return prefix;
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
    this.priceObservedTimestamp = 0;
    this.priceChangedTimestamp = 0;
    this.platformModeCache = PlatformMode.UNKNOWN;
    this.platformModeTimestamp = 0;
    this.lastOcrRunTimestamp = 0;
    this.lastImageOcrAt = 0;
  }

  public getCachedOcrResults(): OcrCachedResult | null {
    if (this.lastOcrRunTimestamp === 0 && !this.assetCache && !this.timeframeCache && this.priceCache === null) return null;
    const now = Date.now();
    const isFresh = (timestamp: number) => timestamp > 0 && now - timestamp <= OcrService.PRICE_CACHE_MAX_AGE_MS;
    const asset = isFresh(this.assetCacheTimestamp) ? this.assetCache : null;
    const assetIdentity = isFresh(this.assetCacheTimestamp) ? this.assetIdentityCache : null;
    const timeframe = isFresh(this.timeframeCacheTimestamp) ? this.timeframeCache : null;
    const currentPrice = isFresh(this.priceObservedTimestamp) ? this.priceCache : null;
    const timestamp = Math.max(this.assetCacheTimestamp, this.timeframeCacheTimestamp, this.priceObservedTimestamp);

    return { asset, assetIdentity, platformMode: this.platformModeCache, timeframe, currentPrice, timestamp };
  }

  public triggerBackgroundOcr(
    frameBuffer: Buffer,
    width: number,
    height: number,
    region?: ChartRegion,
  ): void {
    if (!this.imageOcrEnabled || this.isProcessing || this.imageOcrInFlight) return;
    if (Date.now() - this.lastImageOcrAt < OcrService.IMAGE_OCR_MIN_INTERVAL_MS) return;
    this.isProcessing = true;
    void this.runImageOcr(frameBuffer, width, height, region)
      .catch(() => null)
      .finally(() => { this.isProcessing = false; });
  }

  public setImageOcrEngine(engine: ImageOcrEngine | null): void {
    this.imageOcrEngine = engine;
  }

  public setImageOcrEnabled(enabled: boolean): void {
    this.imageOcrEnabled = !!enabled;
    if (!this.imageOcrEnabled) void this.terminateImageWorker();
  }

  public isImageOcrEnabled(): boolean {
    return this.imageOcrEnabled;
  }

  public async runImageOcr(
    buffer: Buffer,
    width: number,
    height: number,
    region?: ChartRegion,
  ): Promise<number | null> {
    if (!this.imageOcrEnabled || this.imageOcrInFlight) return null;
    const now = Date.now();
    if (now - this.lastImageOcrAt < OcrService.IMAGE_OCR_MIN_INTERVAL_MS) return null;
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return null;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

    this.lastImageOcrAt = now;
    this.imageOcrInFlight = true;
    try {
      const engine: ImageOcrEngine = this.imageOcrEngine || this.defaultImageOcr.bind(this);
      const text = await engine({ buffer, width, height, region });
      if (!text || typeof text !== 'string') return null;
      return this.extractPriceFromText(text);
    } catch (err) {
      console.warn('[MARS OCR] Image OCR failed:', err);
      return null;
    } finally {
      this.imageOcrInFlight = false;
    }
  }

  public async terminate(): Promise<void> {
    this.imageOcrEnabled = false;
    await this.terminateImageWorker();
    this.clearCache();
  }

  private async terminateImageWorker(): Promise<void> {
    const worker = this.imageOcrWorker;
    this.imageOcrWorker = null;
    if (!worker || typeof worker.terminate !== 'function') return;
    try { await worker.terminate(); } catch {}
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
      if (!Tesseract || !Tesseract.createWorker) return null;
      if (!this.imageOcrWorker) this.imageOcrWorker = await Tesseract.createWorker('eng');

      let image: any = frame.buffer;
      if (nativeImage && typeof nativeImage.createFromBitmap === 'function') {
        let bitmapImage = nativeImage.createFromBitmap(frame.buffer, { width: frame.width, height: frame.height });
        if (!bitmapImage.isEmpty() && frame.region) {
          const x = Math.max(0, Math.min(Math.floor(frame.region.x), frame.width - 1));
          const y = Math.max(0, Math.min(Math.floor(frame.region.y), frame.height - 1));
          const width = Math.max(1, Math.min(Math.floor(frame.region.width), frame.width - x));
          const height = Math.max(1, Math.min(Math.floor(frame.region.height), frame.height - y));
          bitmapImage = bitmapImage.crop({ x, y, width, height });
        }
        const size = bitmapImage.getSize();
        if (!bitmapImage.isEmpty() && size.width > 800) {
          bitmapImage = bitmapImage.resize({
            width: 800,
            height: Math.max(1, Math.round(size.height * (800 / size.width))),
            quality: 'good',
          });
        }
        if (!bitmapImage.isEmpty()) image = bitmapImage.toPNG();
      }
      const { data } = await this.imageOcrWorker.recognize(image);
      return typeof data?.text === 'string' ? data.text : null;
    } catch (err) {
      console.warn('[MARS OCR] tesseract unavailable:', err);
      return null;
    }
  }
}
