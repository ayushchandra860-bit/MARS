// ============================================================
// MARS PRO V3 — Hardened Embedded Browser Manager
// ============================================================

import { BrowserWindow, BrowserView, session, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { CapturedFrame } from '../../../shared/types/scanner';
import { TradingAction, TradeOutcome } from '../../../shared/types/decision';
import { PlatformMode } from '../../../shared/types/canonical';
import { IPC_CHANNELS } from '../../../shared/contracts/ipc-channels';
import { RunningTradeManager } from '../trade/RunningTradeManager';
import {
  isTrustedOlympTradeUrl,
  normalizeOlympTradeUrl,
  OLYMP_TRADE_PLATFORM_URL,
} from '../security/urlPolicy';
import { buildEmbeddedTradeDetectorScript } from './embeddedTradeDetector';
import {
  BrowserTradeClickEvent,
  parseBrowserTradeClickMessage,
  parseBrowserTradeResultMessage,
} from './embeddedEventValidation';

export class EmbeddedBrowserManager {
  private static instance: EmbeddedBrowserManager | null = null;
  private browserView: BrowserView | null = null;
  private parentWindow: BrowserWindow | null = null;
  private currentUrl = OLYMP_TRADE_PLATFORM_URL;
  private tradeClickHandler: ((event: BrowserTradeClickEvent) => void) | null = null;
  private isVisible = true;
  private isFocusMode = false;
  private readonly TOOLBAR_HEIGHT = 36;
  private readonly DEFAULT_SIDEBAR_WIDTH = 240;
  private bounds = { x: 240, y: 36, width: 1280, height: 720 };

  private constructor() {}

  public static getInstance(): EmbeddedBrowserManager {
    if (!EmbeddedBrowserManager.instance) EmbeddedBrowserManager.instance = new EmbeddedBrowserManager();
    return EmbeddedBrowserManager.instance;
  }

  public initialize(parentWindow: BrowserWindow, initialUrl: string = OLYMP_TRADE_PLATFORM_URL): void {
    this.parentWindow = parentWindow;
    this.currentUrl = normalizeOlympTradeUrl(initialUrl);
    if (this.browserView) return;

    const customSession = session.fromPartition('persist:olymptrade_session');
    customSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    customSession.on('will-download', (event) => event.preventDefault());

    this.browserView = new BrowserView({
      webPreferences: {
        session: customSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    const contents = this.browserView.webContents;
    this.parentWindow.setBrowserView(this.browserView);
    this.updateBounds();
    contents.setFrameRate(15);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));

    const blockUntrustedNavigation = (event: Electron.Event, targetUrl: string) => {
      if (!isTrustedOlympTradeUrl(targetUrl)) {
        console.warn(`[MARS SECURITY] Blocked embedded navigation to ${targetUrl}`);
        event.preventDefault();
      }
    };
    contents.on('will-navigate', blockUntrustedNavigation);
    contents.on('will-redirect', blockUntrustedNavigation);

    parentWindow.on('focus', () => {
      try { if (this.browserView && !this.browserView.webContents.isDestroyed()) this.browserView.webContents.setFrameRate(15); } catch {}
    });
    parentWindow.on('blur', () => {
      try { if (this.browserView && !this.browserView.webContents.isDestroyed()) this.browserView.webContents.setFrameRate(1); } catch {}
    });

    contents.on('render-process-gone', (_event, details) => {
      console.error(`[MARS BROWSER] Page renderer gone (${details.reason}); scheduling a safe reload.`);
      try {
        fs.appendFileSync(path.join(app.getPath('userData'), 'mars-errors.log'), `[${new Date().toISOString()}] BROWSER_RENDERER_GONE: ${details.reason}\n`);
      } catch {}
      setTimeout(() => {
        if (this.browserView && !this.browserView.webContents.isDestroyed()) {
          const reloadUrl = isTrustedOlympTradeUrl(this.currentUrl) ? this.currentUrl : OLYMP_TRADE_PLATFORM_URL;
          void this.browserView.webContents.loadURL(reloadUrl).catch(() => {});
        }
      }, 3000);
    });

    contents.on('did-navigate', (_event, targetUrl) => {
      if (!isTrustedOlympTradeUrl(targetUrl)) {
        this.currentUrl = OLYMP_TRADE_PLATFORM_URL;
        void contents.loadURL(OLYMP_TRADE_PLATFORM_URL).catch(() => {});
        return;
      }
      this.currentUrl = targetUrl;
      try {
        const parsed = new URL(targetUrl);
        const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
        if (normalizedPath === '/' || normalizedPath === '/home' || normalizedPath === '/landing') {
          this.currentUrl = OLYMP_TRADE_PLATFORM_URL;
          void contents.loadURL(OLYMP_TRADE_PLATFORM_URL).catch(() => {});
        }
      } catch {}
    });

    let lastForwardedTitle = '';
    let lastTitleForwardAt = 0;
    contents.on('page-title-updated', (_event, title) => {
      if (!isTrustedOlympTradeUrl(contents.getURL())) return;
      const now = Date.now();
      if (typeof title === 'string' && title.length <= 300 && title !== lastForwardedTitle && now - lastTitleForwardAt >= 2000) {
        lastForwardedTitle = title;
        lastTitleForwardAt = now;
        if (this.parentWindow && !this.parentWindow.isDestroyed() && !this.parentWindow.webContents.isDestroyed()) {
          this.parentWindow.webContents.send(IPC_CHANNELS.BROWSER_TITLE_UPDATED, title);
        }
      }
    });

    contents.on('did-finish-load', () => {
      if (!isTrustedOlympTradeUrl(contents.getURL())) return;
      this.injectTradeDetectorScript();
      RunningTradeManager.getInstance().loadAndRecoverPendingTrades();
    });

    contents.on('console-message', (_event, _level, message, _line, sourceId) => {
      if (!isTrustedOlympTradeUrl(contents.getURL())) return;
      if (sourceId && /^https?:/i.test(sourceId) && !isTrustedOlympTradeUrl(sourceId)) return;

      const click = parseBrowserTradeClickMessage(message);
      if (click) {
        const trade = RunningTradeManager.getInstance().registerTrade({
          sessionId: 'live-browser',
          signalId: `browser-${click.executionId}`,
          executionId: click.executionId,
          asset: click.asset,
          direction: click.action,
          expirySeconds: click.expirySeconds,
          entryPrice: click.entryPrice === null ? null : String(click.entryPrice),
          eventId: click.eventId,
          platformMode: click.platformMode,
        });
        if (trade) this.emitTradeStateRefresh();
        // The controller may update its immediate overlay context, but durable
        // registration above happens first and deduplication prevents a second row.
        try { this.tradeClickHandler?.(click); } catch (error) {
          console.error('[MARS Browser Detector] Trade-click subscriber failed:', error);
        }
        return;
      }

      const result = parseBrowserTradeResultMessage(message);
      if (!result) return;
      const outcome = result.outcome === 'WIN'
        ? TradeOutcome.WIN
        : result.outcome === 'LOSS' ? TradeOutcome.LOSS : TradeOutcome.DRAW;
      const verifiedExitPrice = result.completionPrice === null ? null : String(result.completionPrice);
      const completed = result.executionId
        ? RunningTradeManager.getInstance().resolveTradeByExecutionId(result.executionId, outcome, verifiedExitPrice)
        : RunningTradeManager.getInstance().resolveNextActiveTrade(outcome, null);
      if (completed) this.emitTradeStateRefresh();
    });

    void contents.loadURL(this.currentUrl).catch((error) => {
      console.error('[MARS BROWSER] Initial platform load failed:', error);
    });
  }

  public setTradeClickHandler(handler: ((event: BrowserTradeClickEvent) => void) | null): void {
    this.tradeClickHandler = handler;
  }

  /** Result correlation is owned by this manager; legacy subscribers are intentionally ignored. */
  public setTradeResultHandler(_handler: ((event: { outcome: string; amount: number; rawText: string; timestamp: number }) => void) | null): void {}

  private injectTradeDetectorScript(): void {
    if (!this.browserView || this.browserView.webContents.isDestroyed()) return;
    if (!isTrustedOlympTradeUrl(this.browserView.webContents.getURL())) return;
    void this.browserView.webContents.executeJavaScript(buildEmbeddedTradeDetectorScript(), true).catch((error) => {
      console.error('[MARS Browser Detector] Injection failed:', error);
    });
  }

  private emitTradeStateRefresh(): void {
    if (this.parentWindow && !this.parentWindow.isDestroyed() && !this.parentWindow.webContents.isDestroyed()) {
      this.parentWindow.webContents.send(IPC_CHANNELS.ACTIVE_TRADES_UPDATE);
      this.parentWindow.webContents.send(IPC_CHANNELS.PERFORMANCE_REFRESH);
    }
  }

  public show(): void {
    this.isVisible = true;
    if (this.parentWindow && !this.parentWindow.isDestroyed() && this.browserView) {
      this.parentWindow.setBrowserView(this.browserView);
      this.updateBounds();
    }
  }

  public hide(): void {
    this.isVisible = false;
    if (this.parentWindow && !this.parentWindow.isDestroyed() && this.browserView) {
      this.parentWindow.setBrowserView(null);
      this.browserView.setBounds({ x: -9999, y: -9999, width: 0, height: 0 });
    }
  }

  public setVisible(visible: boolean): void { visible ? this.show() : this.hide(); }
  public setFocusMode(focus: boolean): void { this.isFocusMode = focus; this.updateBounds(); }
  public getIsFocusMode(): boolean { return this.isFocusMode; }
  public toggleFocusMode(): boolean { this.isFocusMode = !this.isFocusMode; this.updateBounds(); return this.isFocusMode; }

  public updateBounds(explicitBounds?: { x: number; y: number; width: number; height: number }): void {
    if (explicitBounds) this.bounds = explicitBounds;
    else if (this.parentWindow && !this.parentWindow.isDestroyed()) {
      if (!this.isVisible) this.bounds = { x: -9999, y: -9999, width: 0, height: 0 };
      else {
        const [windowWidth, windowHeight] = this.parentWindow.getContentSize();
        const sidebarWidth = this.isFocusMode ? 0 : this.DEFAULT_SIDEBAR_WIDTH;
        this.bounds = {
          x: sidebarWidth,
          y: this.TOOLBAR_HEIGHT,
          width: Math.max(400, windowWidth - sidebarWidth),
          height: Math.max(300, windowHeight - this.TOOLBAR_HEIGHT),
        };
      }
    }
    if (this.browserView && this.isVisible) {
      this.browserView.setBounds(this.bounds);
      this.browserView.setAutoResize({ width: true, height: true, horizontal: true, vertical: true });
    }
  }

  public goBack(): void {
    if (this.browserView && !this.browserView.webContents.isDestroyed() && this.browserView.webContents.canGoBack()) this.browserView.webContents.goBack();
  }
  public goForward(): void {
    if (this.browserView && !this.browserView.webContents.isDestroyed() && this.browserView.webContents.canGoForward()) this.browserView.webContents.goForward();
  }
  public reload(): void {
    if (this.browserView && !this.browserView.webContents.isDestroyed() && isTrustedOlympTradeUrl(this.browserView.webContents.getURL())) this.browserView.webContents.reload();
  }
  public changeZoom(delta: number): number {
    if (!this.browserView || this.browserView.webContents.isDestroyed()) return 1;
    const next = Math.max(0.5, Math.min(3, this.browserView.webContents.getZoomFactor() + delta));
    this.browserView.webContents.setZoomFactor(next);
    return next;
  }
  public resetZoom(): number {
    if (!this.browserView || this.browserView.webContents.isDestroyed()) return 1;
    this.browserView.webContents.setZoomFactor(1);
    return 1;
  }
  public navigate(url: string): boolean {
    if (!this.browserView || this.browserView.webContents.isDestroyed() || !isTrustedOlympTradeUrl(url)) return false;
    this.currentUrl = new URL(url).toString();
    void this.browserView.webContents.loadURL(this.currentUrl).catch(() => {});
    return true;
  }
  public getActiveTitle(): string {
    if (this.browserView && !this.browserView.webContents.isDestroyed() && isTrustedOlympTradeUrl(this.browserView.webContents.getURL())) {
      return this.browserView.webContents.getTitle() || '';
    }
    return '';
  }

  public async getVisibleText(): Promise<string> {
    if (!this.browserView || this.browserView.webContents.isDestroyed() || !isTrustedOlympTradeUrl(this.browserView.webContents.getURL())) return '';
    try {
      const scrape = this.browserView.webContents.executeJavaScript('document.body ? document.body.innerText.slice(0, 12000) : ""', false);
      return await Promise.race([scrape, new Promise<string>((resolve) => setTimeout(() => resolve(''), 2000))]);
    } catch { return ''; }
  }

  public async captureFrame(sessionId: string = 'live'): Promise<CapturedFrame> {
    if (!this.browserView || this.browserView.webContents.isDestroyed() || !isTrustedOlympTradeUrl(this.browserView.webContents.getURL())) {
      throw new Error('Trusted Browser Workstation is not available for capture');
    }
    try {
      const image = await Promise.race([
        this.browserView.webContents.capturePage(),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('capturePage timed out')), 3000)),
      ]);
      if (!image || image.isEmpty()) throw new Error('Browser Workstation returned an empty capture');
      const size = image.getSize();
      return {
        frameId: randomUUID(), sessionId, timestamp: Date.now(), displayId: 'embedded',
        buffer: image.toBitmap(), width: size.width || this.bounds.width,
        height: size.height || this.bounds.height, scaleFactor: 1,
      };
    } catch (error) {
      throw new Error(`Browser Workstation capture failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public clearCache(): void {}

  public destroy(): void {
    if (this.browserView) {
      try { if (this.parentWindow && !this.parentWindow.isDestroyed()) this.parentWindow.setBrowserView(null); } catch {}
      try { if (!this.browserView.webContents.isDestroyed()) (this.browserView.webContents as any).destroy(); } catch {}
      this.browserView = null;
    }
    this.tradeClickHandler = null;
    this.parentWindow = null;
    this.currentUrl = OLYMP_TRADE_PLATFORM_URL;
  }
}
