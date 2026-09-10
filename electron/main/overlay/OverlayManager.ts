// ============================================================
// MARS PRO V3 — Sandboxed, navigation-locked overlay windows
// ============================================================

import { BrowserWindow, screen, app } from 'electron';
import * as path from 'path';
import { OverlayState, OverlayPosition } from '../../../shared/types/ipc';
import { IPC_CHANNELS } from '../../../shared/contracts/ipc-channels';
import { isTrustedDevServerUrl, isTrustedRendererNavigation } from '../security/urlPolicy';

export class OverlayManager {
  private signalWindow: BrowserWindow | null = null;
  private intelWindow: BrowserWindow | null = null;
  private isVisible = true;
  private savedPositions = new Map<string, OverlayPosition>();
  private latestPayload: any = null;

  public createWindows(): void {
    if (this.signalWindow && !this.signalWindow.isDestroyed()) return;
    const { width: screenWidth } = screen.getPrimaryDisplay().bounds;
    const width = 320;
    const height = 440;
    const padding = 20;
    const overlayPath = path.join(__dirname, '../../dist/overlay.html');
    const configuredDevUrl = process.env.VITE_DEV_SERVER_URL;
    const trustedDevUrl = (process.env.NODE_ENV === 'development' || !app.isPackaged)
      && configuredDevUrl && isTrustedDevServerUrl(configuredDevUrl)
      ? configuredDevUrl
      : undefined;

    const common: Electron.BrowserWindowConstructorOptions = {
      width, height, frame: false, transparent: true, alwaysOnTop: true,
      resizable: true, minWidth: 280, minHeight: 300, show: false, skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/overlay-preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    };
    this.signalWindow = new BrowserWindow({ ...common, x: Math.max(0, screenWidth - width * 2 - padding * 2), y: 80 });
    this.intelWindow = new BrowserWindow({ ...common, x: Math.max(0, screenWidth - width - padding), y: 80 });

    const configure = (window: BrowserWindow, panel: 'signal' | 'intelligence') => {
      window.setResizable(true);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-attach-webview', (event) => event.preventDefault());
      const navigationGuard = (event: Electron.Event, targetUrl: string) => {
        if (!isTrustedRendererNavigation(targetUrl, overlayPath, trustedDevUrl)) {
          console.warn(`[MARS SECURITY] Blocked overlay navigation to ${targetUrl}`);
          event.preventDefault();
        }
      };
      window.webContents.on('will-navigate', navigationGuard);
      window.webContents.on('will-redirect', navigationGuard);
      window.on('closed', () => {
        if (panel === 'signal') this.signalWindow = null;
        else this.intelWindow = null;
      });
      window.once('ready-to-show', () => {
        if (!window.isDestroyed() && this.isVisible) {
          window.showInactive();
          window.setAlwaysOnTop(true, 'screen-saver');
          window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        }
      });
      window.webContents.once('did-finish-load', () => {
        if (this.latestPayload && this.isVisible && !window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.OVERLAY_STATE_UPDATE, this.latestPayload);
        }
      });
      if (trustedDevUrl) {
        const target = new URL('/overlay.html', trustedDevUrl);
        target.searchParams.set('panel', panel);
        void window.loadURL(target.toString()).catch((error) => console.error('[OverlayManager] Dev overlay load failed:', error));
      } else {
        void window.loadFile(overlayPath, { query: { panel } }).catch((error) => console.error('[OverlayManager] Packaged overlay load failed:', error));
      }
    };
    configure(this.signalWindow, 'signal');
    configure(this.intelWindow, 'intelligence');
  }

  public show(): void {
    this.isVisible = true;
    if (!this.signalWindow || this.signalWindow.isDestroyed()) this.createWindows();
    for (const window of [this.signalWindow, this.intelWindow]) {
      if (window && !window.isDestroyed()) {
        window.showInactive();
        window.setAlwaysOnTop(true, 'screen-saver');
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      }
    }
  }
  public hide(): void {
    this.isVisible = false;
    for (const window of [this.signalWindow, this.intelWindow]) if (window && !window.isDestroyed()) window.hide();
  }
  public savePosition(position: OverlayPosition): void { if (position?.panelId) this.savedPositions.set(position.panelId, position); }
  public getPositions(): OverlayPosition[] { return Array.from(this.savedPositions.values()); }

  public sendState(state: OverlayState, livePayload?: any): void {
    const asset = (value: any): string | null => {
      if (typeof value === 'string' && value !== 'UNKNOWN') return value;
      return value && typeof value === 'object' && typeof value.value === 'string' && value.value !== 'UNKNOWN' ? value.value : null;
    };
    const timeframe = (value: any): string | null => typeof value === 'string'
      ? value : value && typeof value.value === 'string' ? value.value : null;
    const unified = {
      ...state, ...(livePayload || {}),
      asset: asset(livePayload?.asset) || asset(state.asset),
      timeframe: timeframe(livePayload?.timeframe) || timeframe(state.timeframe),
      currentPrice: livePayload?.currentPrice ?? state.currentPrice ?? null,
      support: livePayload?.support ?? state.supportLevel ?? null,
      supportLevel: state.supportLevel ?? livePayload?.support ?? null,
      resistance: livePayload?.resistance ?? state.resistanceLevel ?? null,
      resistanceLevel: state.resistanceLevel ?? livePayload?.resistance ?? null,
      signal: livePayload?.signal ?? state.decision ?? null,
      decision: state.decision ?? livePayload?.signal ?? null,
      confidence: livePayload?.confidence ?? (typeof state.confidence === 'number' ? `${Math.round(state.confidence)}%` : null),
      whyWait: livePayload?.whyWait || state.reason || 'Scanning market structure...',
      whyTake: livePayload?.whyTake || state.reasons || [],
      riskLevel: livePayload?.riskLevel ?? state.risk ?? null,
      risk: state.risk ?? livePayload?.riskLevel ?? null,
      entry: livePayload?.entry || state.entryGuidance || 'WAIT',
      entryGuidance: state.entryGuidance || livePayload?.entry || 'WAIT',
      expiry: livePayload?.expiry || state.recommendedExpiry || null,
      recommendedExpiry: state.recommendedExpiry || livePayload?.expiry || null,
      entryCountdownSec: state.entryCountdownSec ?? null,
      marketRegime: state.marketRegime ?? null,
      lifecycleStage: state.lifecycleStage || null,
      activeTradeContext: state.activeTradeContext || livePayload?.activeTradeContext || null,
      soundAlert: livePayload?.soundAlert || false,
      soundAlertType: livePayload?.soundAlertType || null,
      systemStatus: state.systemStatus || 'READY',
      analysisState: state.analysisState || 'RUNNING',
      lastUpdate: Date.now(),
    };
    if (this.latestPayload && !unified.soundAlert) {
      const previous = this.latestPayload;
      if (Date.now() - (previous.lastUpdate || 0) < 1000
        && previous.decision === unified.decision && previous.asset === unified.asset
        && previous.currentPrice === unified.currentPrice && previous.entryGuidance === unified.entryGuidance
        && previous.entryCountdownSec === unified.entryCountdownSec && previous.confidence === unified.confidence
        && previous.recommendedExpiry === unified.recommendedExpiry && previous.analysisState === unified.analysisState
        && previous.systemStatus === unified.systemStatus
        && JSON.stringify(previous.activeTradeContext) === JSON.stringify(unified.activeTradeContext)) return;
    }
    this.latestPayload = unified;
    if (!this.isVisible) return;
    for (const window of [this.signalWindow, this.intelWindow]) {
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) continue;
      if (!window.isVisible()) { window.showInactive(); window.setAlwaysOnTop(true, 'screen-saver'); }
      window.webContents.send(IPC_CHANNELS.OVERLAY_STATE_UPDATE, unified);
    }
  }

  public getIsVisible(): boolean { return this.isVisible; }
  public toggleVisibility(): boolean { this.isVisible ? this.hide() : this.show(); return this.isVisible; }
  public destroy(): void {
    this.isVisible = false;
    for (const window of [this.signalWindow, this.intelWindow]) if (window && !window.isDestroyed()) window.destroy();
    this.signalWindow = null;
    this.intelWindow = null;
  }
}
