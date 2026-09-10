// ============================================================
// MARS PRO V3 â€” Embedded Browser Manager
// Directly loads trading platform: https://olymptrade.com/platform
// Supports 36px permanent toolbar, focus mode, and goBack/goForward.
// ============================================================

import { BrowserWindow, BrowserView, session, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { CapturedFrame } from '../../../shared/types/scanner';
import { TradingAction, TradeOutcome } from '../../../shared/types/decision';
import { RunningTradeManager } from '../trade/RunningTradeManager';

export class EmbeddedBrowserManager {
  private static instance: EmbeddedBrowserManager | null = null;
  private browserView: BrowserView | null = null;
  private parentWindow: BrowserWindow | null = null;
  private currentUrl = 'https://olymptrade.com/platform';
  private tradeClickHandler: ((event: { action: TradingAction; eventId: string; timestamp: number; nodeInfo?: any }) => void) | null = null;
  private tradeResultHandler: ((event: { outcome: string; amount: number; rawText: string; timestamp: number }) => void) | null = null;
  private isVisible = true;
  private isFocusMode = false;

  // Workstation Layout Dimensions
  private readonly TOOLBAR_HEIGHT = 36;
  private readonly DEFAULT_SIDEBAR_WIDTH = 240;

  private bounds = { x: 240, y: 36, width: 1280, height: 720 };

  private constructor() {}

  public static getInstance(): EmbeddedBrowserManager {
    if (!EmbeddedBrowserManager.instance) {
      EmbeddedBrowserManager.instance = new EmbeddedBrowserManager();
    }
    return EmbeddedBrowserManager.instance;
  }

  public initialize(parentWindow: BrowserWindow, initialUrl: string = 'https://olymptrade.com/platform'): void {
    this.parentWindow = parentWindow;
    this.currentUrl = initialUrl;

    if (!this.browserView) {
      const customSession = session.fromPartition('persist:olymptrade_session');

      this.browserView = new BrowserView({
        webPreferences: {
          session: customSession,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
        },
      });

      this.parentWindow.setBrowserView(this.browserView);
      this.updateBounds();

      // THE critical CPU fix for weak machines: the embedded trading page
      // continuously animates its canvas chart at display rate (~60fps). With
      // hardware acceleration disabled (needed to stop GPU-process crashes),
      // that software canvas rendering saturates both cores of a 2-core CPU
      // and starves the main process â†’ window freezes and WER kills the app.
      // Capping the page's frame rate cuts its render work massively while the
      // chart stays perfectly readable.
      this.browserView.webContents.setFrameRate(15);

      // Drop the page to 1fps whenever the app loses focus: the user only
      // looks at the chart while the app is focused, so rendering it at full
      // tilt in the background just burns CPU and can starve the main process.
      // Restored to 20fps on focus (chart animations resume smoothly).
      parentWindow.on('focus', () => {
        try {
          if (this.browserView && !this.browserView.webContents.isDestroyed()) {
            this.browserView.webContents.setFrameRate(15);
          }
        } catch {}
      });
      parentWindow.on('blur', () => {
        try {
          if (this.browserView && !this.browserView.webContents.isDestroyed()) {
            this.browserView.webContents.setFrameRate(1);
          }
        } catch {}
      });

      // Renderer crash recovery: a starved/overloaded page renderer must never
      // take the whole app down. On crash, log it and reload the page â€” the
      // app stays alive and trading resumes after the reload.
      this.browserView.webContents.on('render-process-gone', (_event, details) => {
        console.error(`[MARS BROWSER] Page renderer gone (${details.reason}) â€” reloading page`);
        try {
          fs.appendFileSync(
            path.join(app.getPath('userData'), 'mars-errors.log'),
            `[${new Date().toISOString()}] BROWSER_RENDERER_GONE: ${details.reason}\n`
          );
        } catch {}
        setTimeout(() => {
          if (this.browserView && !this.browserView.webContents.isDestroyed()) {
            this.browserView.webContents.loadURL(this.currentUrl).catch(() => {});
          }
        }, 3000);
      });

      this.browserView.webContents.loadURL(this.currentUrl);

      // Auto-redirect marketing pages directly to trading platform chart
      this.browserView.webContents.on('did-navigate', (_, url) => {
        if (url === 'https://olymptrade.com' || url === 'https://olymptrade.com/' || url.includes('/home') || url.includes('/landing')) {
          this.browserView?.webContents.loadURL('https://olymptrade.com/platform');
        }
      });

      // Throttle title forwarding: the live price in the title updates many
      // times per second; forwarding every change spams IPC + re-renders in
      // the control center. Only forward when the title actually changed AND
      // at most every 2s.
      let lastForwardedTitle = '';
      let lastTitleForwardAt = 0;
      this.browserView.webContents.on('page-title-updated', (_, title) => {
        const now = Date.now();
        if (title !== lastForwardedTitle && now - lastTitleForwardAt >= 2000) {
          lastForwardedTitle = title;
          lastTitleForwardAt = now;
          if (this.parentWindow && !this.parentWindow.isDestroyed() && !this.parentWindow.webContents.isDestroyed()) {
            this.parentWindow.webContents.send('browser-title-updated', title);
          }
        }
      });

      // Task T1.1, T1.2, & Task 5: Advanced DOM detector & browser reload state
      // restoration. Runs once per page load (did-finish-load) â€” the previous
      // triple registration (dom-ready / did-finish-load / did-frame-finish-load)
      // re-ran DB recovery + script injection up to 3Ã— per load.
      this.browserView.webContents.on('did-finish-load', () => {
        this.injectTradeDetectorScript();
        RunningTradeManager.getInstance().loadAndRecoverPendingTrades('live-browser');
      });

      this.browserView.webContents.on('console-message', (_event, _level, message) => {
        if (message.startsWith('[MARS_TRADE_CLICK]:')) {
          try {
            const data = JSON.parse(message.substring(19));
            const action = data.action === 'BUY' ? TradingAction.BUY : TradingAction.SELL;
            if (this.tradeClickHandler) {
              this.tradeClickHandler({
                action,
                eventId: data.eventId,
                timestamp: data.timestamp || Date.now(),
                nodeInfo: data.nodeInfo,
              });
            } else {
              // The embedded platform is the authoritative source for a manual
              // order click. Preserve the detected asset and expiry instead of
              // silently replacing them with hard-coded defaults.
              const nodeInfo = data.nodeInfo || {};
              const activeTitle = this.getActiveTitle();
              const titleWithoutPrice = activeTitle
                ? activeTitle.replace(/^[0-9.,\s▲▼\u25B2\u25BC\u2191\u2193Ð$€₹]+/, '').split('|')[0].trim()
                : '';
              const assetName = String(
                data.asset || nodeInfo.assetName || titleWithoutPrice
              ).trim() || 'UNKNOWN';
              const expirySeconds = this.parseExpirySeconds(data.expiryText || nodeInfo.expiryText);
              const trade = RunningTradeManager.getInstance().registerTrade({
                sessionId: 'live-browser',
                asset: assetName,
                direction: action,
                expirySeconds,
                eventId: data.eventId,
              });
              if (trade) this.emitTradeStateRefresh();
            }
          } catch (err) {
            console.error('[MARS Browser Detector] Error parsing click event:', err);
          }
        } else if (message.startsWith('[MARS_TRADE_RESULT]:')) {
          try {
            const resultData = JSON.parse(message.substring(20));
            if (this.tradeResultHandler) {
              this.tradeResultHandler(resultData);
            } else {
              // The result detector was previously a dead end whenever no custom
              // callback was registered. Complete the next pending browser trade
              // directly so the browser result reaches the journal and analytics.
              const rawOutcome = String(resultData.outcome || '').toUpperCase();
              const outcome = rawOutcome === 'WIN'
                ? TradeOutcome.WIN
                : rawOutcome === 'LOSS'
                ? TradeOutcome.LOSS
                : rawOutcome === 'DRAW'
                ? TradeOutcome.DRAW
                : null;
              if (outcome) {
                const completed = RunningTradeManager.getInstance().resolveNextActiveTrade(
                  outcome,
                  String(resultData.amount ?? '0'),
                );
                if (completed) this.emitTradeStateRefresh();
              }
            }
          } catch (err) {
            console.error('[MARS Browser Detector] Error parsing result event:', err);
          }
        }
      });
    }
  }

  public setTradeClickHandler(handler: ((event: { action: TradingAction; eventId: string; timestamp: number; nodeInfo?: any }) => void) | null): void {
    this.tradeClickHandler = handler;
  }

  public setTradeResultHandler(handler: ((event: { outcome: string; amount: number; rawText: string; timestamp: number }) => void) | null): void {
    this.tradeResultHandler = handler;
  }

  private parseExpirySeconds(rawExpiry: unknown): number {
    const text = String(rawExpiry || '').trim().toLowerCase();
    // 1. Check hh:mm:ss format (e.g. 00:01:00 -> 60s)
    const hms = text.match(/(\d{1,2}):(\d{2}):(\d{2})/);
    if (hms) {
      const seconds = Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
      if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 24 * 60 * 60);
    }
    // 2. Check mm:ss format (e.g. 01:00 -> 60s)
    const clock = text.match(/(\d{1,2}):(\d{2})/);
    if (clock) {
      const seconds = Number(clock[1]) * 60 + Number(clock[2]);
      if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 24 * 60 * 60);
    }
    // 3. Check duration unit format (e.g. 1 min, 5 mins, 60s)
    const duration = text.match(/(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/);
    if (duration) {
      const value = Number(duration[1]);
      const unit = duration[2];
      const multiplier = unit.startsWith('h') ? 3600 : unit.startsWith('m') ? 60 : 1;
      const seconds = Math.round(value * multiplier);
      if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 24 * 60 * 60);
    }
    // 4. Pure integer fallback (>= 10 is assumed seconds, 1-5 is assumed minutes)
    const plainNum = text.match(/^(\d+)$/);
    if (plainNum) {
      const val = Number(plainNum[1]);
      if (val >= 10) return Math.min(val, 24 * 60 * 60);
      if (val > 0) return val * 60;
    }
    return 60;
  }


  private emitTradeStateRefresh(): void {
    if (this.parentWindow && !this.parentWindow.isDestroyed() && !this.parentWindow.webContents.isDestroyed()) {
      this.parentWindow.webContents.send('mars:trade:active-update');
      this.parentWindow.webContents.send('mars:performance:refresh');
    }
  }
  private injectTradeDetectorScript(): void {
    if (!this.browserView || this.browserView.webContents.isDestroyed()) return;

    const script = `
      (function() {
        function attachToDocument(doc) {
          if (!doc || doc.__mars_trade_detector_active) return;
          doc.__mars_trade_detector_active = true;

          doc.addEventListener('click', function(e) {
            try {
              // Shadow DOM compatibility via composedPath()
              var path = e.composedPath ? e.composedPath() : [e.target];
              var btn = null;
              var isBuy = false;
              var isSell = false;
              var matchedBtn = null;

              for (var i = 0; i < path.length; i++) {
                var el = path[i];
                if (!el || !el.getAttribute) continue;
                var testAttr = (
                  el.getAttribute('data-test') ||
                  el.getAttribute('data-qa') ||
                  el.getAttribute('data-test-id') ||
                  el.getAttribute('data-testid') ||
                  el.getAttribute('aria-label') ||
                  el.getAttribute('id') ||
                  ''
                ).toLowerCase();
                var className = (el.className || '').toString().toLowerCase();
                var text = (el.innerText || el.textContent || '').trim().toLowerCase();

                var isStrictUp = testAttr.includes('deal-button-up') || testAttr.includes('button-up') || className.includes('btn-up') || className.includes('deal-button-up') || testAttr === 'up';
                var isStrictDown = testAttr.includes('deal-button-down') || testAttr.includes('button-down') || className.includes('btn-down') || className.includes('deal-button-down') || testAttr === 'down';

                if (isStrictUp || ((testAttr.includes('buy') || testAttr.includes('call') || text === 'up' || text.startsWith('up') || text === 'call') && (testAttr.includes('deal') || className.includes('btn') || className.includes('button') || el.tagName === 'BUTTON'))) {
                  isBuy = true;
                  matchedBtn = el;
                  break;
                }
                if (isStrictDown || ((testAttr.includes('sell') || testAttr.includes('put') || text === 'down' || text.startsWith('down') || text === 'put') && (testAttr.includes('deal') || className.includes('btn') || className.includes('button') || el.tagName === 'BUTTON'))) {
                  isSell = true;
                  matchedBtn = el;
                  break;
                }
              }

              if (!isBuy && !isSell && e.target && e.target.closest) {
                var closestBtn = e.target.closest('button, [role="button"]');
                if (closestBtn) {
                  var bTxt = (closestBtn.innerText || closestBtn.textContent || '').trim().toLowerCase();
                  var bAttr = ((closestBtn.getAttribute('data-test') || '') + ' ' + (closestBtn.getAttribute('aria-label') || '') + ' ' + (closestBtn.className || '')).toLowerCase();
                  if (bTxt.startsWith('up') || bAttr.includes('deal-button-up') || bAttr.includes('btn-up')) {
                    isBuy = true;
                    matchedBtn = closestBtn;
                  } else if (bTxt.startsWith('down') || bAttr.includes('deal-button-down') || bAttr.includes('btn-down')) {
                    isSell = true;
                    matchedBtn = closestBtn;
                  }
                }
              }

              if (isBuy || isSell) {
                var action = isBuy ? 'BUY' : 'SELL';
                var eventId = [e.timeStamp, Math.round(e.clientX || 0), Math.round(e.clientY || 0), action].join('_');
                var activeBtn = matchedBtn || e.target;

                // Dynamic Asset Extraction from Olymp Trade DOM (strips leading price)
                var assetName = '';
                try {
                  var assetEl = document.querySelector('[data-test="asset-select-button"], [data-test="asset-name"], .asset-select__name, .asset-name, [class*="assetName"], [class*="asset-title"]');
                  if (assetEl) assetName = (assetEl.innerText || assetEl.textContent || '').trim();
                  if (!assetName && document.title) {
                    var titleWithoutPrice = document.title.replace(/^[0-9.,\s▲▼\u25B2\u25BC\u2191\u2193Ð$€₹]+/, '');
                    assetName = titleWithoutPrice.split('|')[0].trim() || '';
                  }
                } catch(aErr) {}

                // Dynamic Expiry Extraction from Olymp Trade DOM
                var expiryText = '';
                try {
                  var expiryEl = document.querySelector(
                    '[data-test="expiration-input"], [data-test="expiry-time"], [data-test*="duration"], [data-test*="expiry"], input[name="expiry"], input[name="duration"], .expiration-select, [class*="deal-duration"], [class*="duration-input"], [class*="duration-value"], [data-test="duration-value"]'
                  );
                  if (expiryEl) {
                    expiryText = (expiryEl.value || expiryEl.innerText || expiryEl.textContent || '').trim();
                  }
                  // Fallback: search for Duration/Expiration label in trading sidebar
                  if (!expiryText) {
                    var labels = document.querySelectorAll('label, span, div, p');
                    for (var li = 0; li < labels.length; li++) {
                      var lt = (labels[li].innerText || '').trim();
                      if (/^(Duration|Expiration|Expiry|Time)$/i.test(lt)) {
                        var parentEl = labels[li].parentElement;
                        if (parentEl) {
                          var inp = parentEl.querySelector('input, select, [class*="value"], [class*="content"]');
                          if (inp) {
                            expiryText = (inp.value || inp.innerText || inp.textContent || '').trim();
                            if (expiryText) break;
                          }
                          var nextEl = labels[li].nextElementSibling;
                          if (nextEl) {
                            expiryText = (nextEl.value || nextEl.innerText || nextEl.textContent || '').trim();
                            if (expiryText) break;
                          }
                        }
                      }
                    }
                  }
                } catch(eErr) {}

                var rect = activeBtn && activeBtn.getBoundingClientRect ? activeBtn.getBoundingClientRect() : { top: 0, left: 0, width: 0, height: 0 };
                var nodeInfo = {
                  tagName: activeBtn.tagName || 'BUTTON',
                  className: activeBtn.className || '',
                  id: activeBtn.id || '',
                  assetName: assetName,
                  expiryText: expiryText,
                  rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) }
                };
                console.log('[MARS_TRADE_CLICK]:' + JSON.stringify({ action: action, eventId: eventId, asset: assetName, expiryText: expiryText, nodeInfo: nodeInfo, timestamp: Date.now() }));
              }
            } catch(err) {}
          }, true);
        }

        attachToDocument(document);

        // Iframe compatibility
        try {
          for (var i = 0; i < window.frames.length; i++) {
            try { attachToDocument(window.frames[i].document); } catch(fErr) {}
          }
        } catch(err) {}

        // Re-attach periodically in case of SPA re-mounts
        setInterval(function() {
          try { attachToDocument(document); } catch(e) {}
        }, 3000);

        // ---- TRADE RESULT DETECTION ------------------------------------
        var lastResultTime = 0;
        var RESULT_COOLDOWN_MS = 3000;

        var resultSelectors = [
          '[data-test*="deal-result"]',
          '[data-test*="trade-result"]',
          '.deal-notification',
          '.trade-result',
          '.profit-notification',
          '.deal__result',
          '.result-popup',
          '[class*="result"]'
        ];
        var profitPattern = /([+-]\s*[\$ÐD€₹£]?\s*[\d,]+\.?\d*)/;

        function scanForResult(root) {
          try {
            var now = Date.now();
            if (now - lastResultTime < RESULT_COOLDOWN_MS) return;

            // 1. Check known selectors
            for (var s = 0; s < resultSelectors.length; s++) {
              var els = root.querySelectorAll(resultSelectors[s]);
              for (var i = 0; i < els.length; i++) {
                var text = (els[i].innerText || els[i].textContent || '').trim();
                var match = text.match(profitPattern);
                if (match) {
                  lastResultTime = now;
                  var isProfit = match[1].charAt(0) === '+';
                  var amount = parseFloat(match[1].replace(/[+$,ÐD€₹£\s]/g, '')) || 0;
                  console.log('[MARS_TRADE_RESULT]:' + JSON.stringify({
                    outcome: isProfit ? 'WIN' : 'LOSS',
                    amount: amount,
                    rawText: text.substring(0, 200),
                    timestamp: now
                  }));
                  return;
                }
              }
            }

            // 2. Scan any new nodes for profit/loss text
            var allEls = root.querySelectorAll('span, div, p, td, a');
            for (var j = 0; j < allEls.length; j++) {
              var elText = (allEls[j].innerText || '').trim();
              if (elText.length > 2 && elText.length < 100) {
                var m = elText.match(profitPattern);
                if (m) {
                  // Heuristic: must be near a trade-related context
                  var parent = allEls[j].closest('[class*="deal"], [class*="trade"], [class*="result"], [class*="profit"], [class*="notification"], [class*="toast"], [class*="popup"]');
                  if (parent) {
                    lastResultTime = now;
                    var isWin = m[1].charAt(0) === '+';
                    var amt = parseFloat(m[1].replace(/[+$,ÐD€₹£\s]/g, '')) || 0;
                    console.log('[MARS_TRADE_RESULT]:' + JSON.stringify({
                      outcome: isWin ? 'WIN' : 'LOSS',
                      amount: amt,
                      rawText: elText.substring(0, 200),
                      timestamp: now
                    }));
                    return;
                  }
                }
              }
            }
          } catch(e) {}
        }

        // Observe DOM mutations for new result elements
        try {
          var observer = new MutationObserver(function(mutations) {
            for (var k = 0; k < mutations.length; k++) {
              var added = mutations[k].addedNodes;
              for (var n = 0; n < added.length; n++) {
                if (added[n].nodeType === 1) {
                  scanForResult(added[n]);
                }
              }
            }
          });
          observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
        } catch(obsErr) {}

        // Also poll every 2s as fallback (catches results that don't trigger mutations)
        setInterval(function() {
          try { scanForResult(document); } catch(e) {}
        }, 2000);
      })();
    `;

    this.browserView.webContents.executeJavaScript(script, true).catch(() => {});
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

  public setVisible(visible: boolean): void {
    if (visible) {
      this.show();
    } else {
      this.hide();
    }
  }

  public setFocusMode(focus: boolean): void {
    this.isFocusMode = focus;
    this.updateBounds();
  }

  public getIsFocusMode(): boolean {
    return this.isFocusMode;
  }

  public toggleFocusMode(): boolean {
    this.isFocusMode = !this.isFocusMode;
    this.updateBounds();
    return this.isFocusMode;
  }

  public updateBounds(explicitBounds?: { x: number; y: number; width: number; height: number }): void {
    if (explicitBounds) {
      this.bounds = explicitBounds;
    } else if (this.parentWindow && !this.parentWindow.isDestroyed()) {
      if (!this.isVisible) {
        this.bounds = { x: -9999, y: -9999, width: 0, height: 0 };
      } else {
        const [winW, winH] = this.parentWindow.getContentSize();
        const sidebarWidth = this.isFocusMode ? 0 : this.DEFAULT_SIDEBAR_WIDTH;
        const w = Math.max(400, winW - sidebarWidth);
        const h = Math.max(300, winH - this.TOOLBAR_HEIGHT);
        this.bounds = { x: sidebarWidth, y: this.TOOLBAR_HEIGHT, width: w, height: h };
      }
    }

    if (this.browserView && this.isVisible) {
      this.browserView.setBounds(this.bounds);
      this.browserView.setAutoResize({ width: true, height: true, horizontal: true, vertical: true });
    }
  }

  public goBack(): void {
    if (this.browserView && this.browserView.webContents.canGoBack()) {
      this.browserView.webContents.goBack();
    }
  }

  public goForward(): void {
    if (this.browserView && this.browserView.webContents.canGoForward()) {
      this.browserView.webContents.goForward();
    }
  }

  public reload(): void {
    if (this.browserView) {
      this.browserView.webContents.reload();
    }
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

  public navigate(url: string): void {
    if (this.browserView && url) {
      this.currentUrl = url;
      this.browserView.webContents.loadURL(url);
    }
  }

  public getActiveTitle(): string {
    if (this.browserView && !this.browserView.webContents.isDestroyed()) {
      return this.browserView.webContents.getTitle() || '';
    }
    return '';
  }

  /** Visible text is session evidence from the active Browser Workstation, not a fallback value. */
  public async getVisibleText(): Promise<string> {
    if (!this.browserView || this.browserView.webContents.isDestroyed()) return '';
    try {
      // userGesture=false: the scrape runs as an idle task instead of interrupting
      // the renderer's animation/layout work, which keeps the embedded page smooth.
      const scrape = this.browserView.webContents.executeJavaScript(
        'document.body ? document.body.innerText.slice(0, 12000) : ""',
        false
      );
      // Hard timeout: if the embedded page is unresponsive, never let the scan
      // cycle hang forever on executeJavaScript â€” resolve empty and move on.
      const result = await Promise.race([
        scrape,
        new Promise<string>((resolve) => setTimeout(() => resolve(''), 2000)),
      ]);
      return result;
    } catch {
      return '';
    }
  }

  public async captureFrame(sessionId: string = 'live'): Promise<CapturedFrame> {
    if (!this.browserView || this.browserView.webContents.isDestroyed()) {
      throw new Error('Browser Workstation is not available for capture');
    }

    try {
      // Timeout guard: capturePage can stall indefinitely when the embedded
      // page's renderer is unresponsive â€” fail the cycle fast instead of
      // stacking pending scans that make the app appear frozen.
      const image = await Promise.race([
        this.browserView.webContents.capturePage(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('capturePage timed out (page unresponsive)')), 3000)
        ),
      ]);
      if (!image || image.isEmpty()) {
        throw new Error('Browser Workstation returned an empty capture');
      }

      const buffer = image.toBitmap();
      const size = image.getSize();

      return {
        frameId: randomUUID(),
        sessionId,
        timestamp: Date.now(),
        displayId: 'embedded',
        buffer,
        width: size.width || this.bounds.width,
        height: size.height || this.bounds.height,
        scaleFactor: 1.0,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Browser Workstation capture failed: ${message}`);
    }
  }

  public clearCache(): void {}

  public destroy(): void {
    if (this.browserView) {
      try {
        if (this.parentWindow && !this.parentWindow.isDestroyed()) {
          this.parentWindow.setBrowserView(null);
        }
      } catch {}

      try {
        if (!this.browserView.webContents.isDestroyed()) {
          (this.browserView.webContents as any).destroy();
        }
      } catch {}

      this.browserView = null;
    }
    this.parentWindow = null;
  }
}
