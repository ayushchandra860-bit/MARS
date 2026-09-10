// ============================================================
// MARS PRO V3 — Overlay Window Manager
// Manages frameless transparent windows for Signal & Intelligence panels.
// ============================================================

import { BrowserWindow, screen, app } from 'electron';
import * as path from 'path';
import { OverlayState, OverlayPosition } from '../../../shared/types/ipc';
import { IPC_CHANNELS } from '../../../shared/contracts/ipc-channels';

export class OverlayManager {
  private signalWindow: BrowserWindow | null = null;
  private intelWindow: BrowserWindow | null = null;
  private isVisible = true;
  private savedPositions: Map<string, OverlayPosition> = new Map();
  private latestPayload: any = null;

  constructor() {}

  public createWindows(): void {
    if (this.signalWindow && !this.signalWindow.isDestroyed()) return;

    const display = screen.getPrimaryDisplay();
    const { width: screenW } = display.bounds;

    const windowWidth = 320;
    const windowHeight = 440;
    const padding = 20;

    const signalX = Math.max(0, screenW - windowWidth * 2 - padding * 2);
    const intelX = Math.max(0, screenW - windowWidth - padding);
    const windowY = 80;

    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

    const commonConfig: Electron.BrowserWindowConstructorOptions = {
      width: windowWidth,
      height: windowHeight,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: true,
      minWidth: 280,
      minHeight: 300,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/overlay-preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
    };

    this.signalWindow = new BrowserWindow({
      ...commonConfig,
      x: signalX,
      y: windowY,
    });

    this.intelWindow = new BrowserWindow({
      ...commonConfig,
      x: intelX,
      y: windowY,
    });

    this.signalWindow.setResizable(true);
    this.intelWindow.setResizable(true);

    this.signalWindow.on('closed', () => {
      this.signalWindow = null;
    });

    this.intelWindow.on('closed', () => {
      this.intelWindow = null;
    });

    const resendLatestState = () => {
      if (!this.latestPayload || !this.isVisible) return;
      if (this.signalWindow && !this.signalWindow.isDestroyed()) {
        this.signalWindow.webContents.send(IPC_CHANNELS.OVERLAY_STATE_UPDATE, this.latestPayload);
        this.signalWindow.webContents.send('signal-update', this.latestPayload);
      }
      if (this.intelWindow && !this.intelWindow.isDestroyed()) {
        this.intelWindow.webContents.send(IPC_CHANNELS.OVERLAY_STATE_UPDATE, this.latestPayload);
        this.intelWindow.webContents.send('signal-update', this.latestPayload);
      }
    };
    this.signalWindow.webContents.once('did-finish-load', resendLatestState);
    this.intelWindow.webContents.once('did-finish-load', resendLatestState);

    this.signalWindow.once('ready-to-show', () => {
      if (this.signalWindow && !this.signalWindow.isDestroyed() && this.isVisible) {
        this.signalWindow.showInactive();
        this.signalWindow.setAlwaysOnTop(true, 'screen-saver');
        this.signalWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      }
    });

    this.intelWindow.once('ready-to-show', () => {
      if (this.intelWindow && !this.intelWindow.isDestroyed() && this.isVisible) {
        this.intelWindow.showInactive();
        this.intelWindow.setAlwaysOnTop(true, 'screen-saver');
        this.intelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      }
    });

    if (isDev && process.env.VITE_DEV_SERVER_URL) {
      this.signalWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}/overlay.html?panel=signal`);
      this.intelWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}/overlay.html?panel=intelligence`);
    } else {
      const overlayPath = path.join(__dirname, '../../dist/overlay.html');
      this.signalWindow.loadFile(overlayPath, { query: { panel: 'signal' } });
      this.intelWindow.loadFile(overlayPath, { query: { panel: 'intelligence' } });
    }
  }

  public show(): void {
    this.isVisible = true;
    if (!this.signalWindow || this.signalWindow.isDestroyed()) {
      this.createWindows();
    }
    if (this.signalWindow && !this.signalWindow.isDestroyed()) {
      this.signalWindow.showInactive();
      this.signalWindow.setAlwaysOnTop(true, 'screen-saver');
      this.signalWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    if (this.intelWindow && !this.intelWindow.isDestroyed()) {
      this.intelWindow.showInactive();
      this.intelWindow.setAlwaysOnTop(true, 'screen-saver');
      this.intelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
  }

  public hide(): void {
    this.isVisible = false;
    if (this.signalWindow && !this.signalWindow.isDestroyed()) this.signalWindow.hide();
    if (this.intelWindow && !this.intelWindow.isDestroyed()) this.intelWindow.hide();
  }

  public savePosition(pos: OverlayPosition): void {
    if (pos && pos.panelId) {
      this.savedPositions.set(pos.panelId, pos);
    }
  }

  public getPositions(): OverlayPosition[] {
    return Array.from(this.savedPositions.values());
  }

  public sendState(state: OverlayState, livePayload?: any): void {
    const resolveAsset = (val: any): string | null => {
      if (!val) return null;
      if (typeof val === 'string' && val !== 'UNKNOWN') return val;
      if (typeof val === 'object' && val.value && val.value !== 'UNKNOWN') return val.value;
      return null;
    };

    const resolveTimeframe = (val: any): string | null => {
      if (!val) return null;
      if (typeof val === 'string') return val;
      if (typeof val === 'object' && val.value) return val.value;
      return null;
    };

    const unifiedPayload = {
      ...state,
      ...(livePayload || {}),
      asset: resolveAsset(livePayload?.asset) || resolveAsset(state?.asset) || null,
      timeframe: resolveTimeframe(livePayload?.timeframe) || resolveTimeframe(state?.timeframe) || null,
      currentPrice: livePayload?.currentPrice || state?.currentPrice || null,
      support: livePayload?.support || state?.supportLevel || null,
      supportLevel: state?.supportLevel || livePayload?.support || null,
      resistance: livePayload?.resistance || state?.resistanceLevel || null,
      resistanceLevel: state?.resistanceLevel || livePayload?.resistance || null,
      signal: livePayload?.signal ?? state?.decision ?? null,
      decision: state?.decision ?? livePayload?.signal ?? null,
      confidence: livePayload?.confidence ?? (typeof state?.confidence === "number" ? `${Math.round(state.confidence)}%` : null),
      whyWait: livePayload?.whyWait || state?.reason || 'Scanning market structure...',
      whyTake: livePayload?.whyTake || state?.reasons || [],
      riskLevel: livePayload?.riskLevel ?? state?.risk ?? null,
      risk: state?.risk ?? livePayload?.riskLevel ?? null,
      entry: livePayload?.entry || state?.entryGuidance || 'WAIT',
      entryGuidance: state?.entryGuidance || livePayload?.entry || 'WAIT',
      expiry: livePayload?.expiry || state?.recommendedExpiry || null,
      recommendedExpiry: state?.recommendedExpiry || livePayload?.expiry || null,
      entryCountdownSec: state?.entryCountdownSec ?? null,
      marketRegime: state?.marketRegime ?? null,
      lifecycleStage: state?.lifecycleStage || null,
      activeTradeContext: state?.activeTradeContext || (livePayload as any)?.activeTradeContext || null,
      soundAlert: livePayload?.soundAlert || false,
      soundAlertType: livePayload?.soundAlertType || null,
      systemStatus: state?.systemStatus || 'READY',
      analysisState: state?.analysisState || 'RUNNING',
      lastUpdate: Date.now(),
    };

    if (this.latestPayload && !unifiedPayload.soundAlert) {
      const p = this.latestPayload;
      const elapsedSinceLastSend = Date.now() - (p.lastUpdate || 0);
      if (
        elapsedSinceLastSend < 1000 &&
        p.decision === unifiedPayload.decision &&
        p.asset === unifiedPayload.asset &&
        p.currentPrice === unifiedPayload.currentPrice &&
        p.entryGuidance === unifiedPayload.entryGuidance &&
        p.entryCountdownSec === unifiedPayload.entryCountdownSec &&
        p.confidence === unifiedPayload.confidence &&
        p.recommendedExpiry === unifiedPayload.recommendedExpiry &&
        p.analysisState === unifiedPayload.analysisState &&
        p.systemStatus === unifiedPayload.systemStatus &&
        JSON.stringify(p.activeTradeContext) === JSON.stringify(unifiedPayload.activeTradeContext)
      ) {
        return;
      }
    }

    this.latestPayload = unifiedPayload;

    if (this.isVisible) {
      if (this.signalWindow && !this.signalWindow.isDestroyed()) {
        if (!this.signalWindow.isVisible()) {
          this.signalWindow.showInactive();
          this.signalWindow.setAlwaysOnTop(true, 'screen-saver');
        }
        this.signalWindow.webContents.send(IPC_CHANNELS.OVERLAY_STATE_UPDATE, unifiedPayload);
        this.signalWindow.webContents.send('signal-update', unifiedPayload);
      }
      if (this.intelWindow && !this.intelWindow.isDestroyed()) {
        if (!this.intelWindow.isVisible()) {
          this.intelWindow.showInactive();
          this.intelWindow.setAlwaysOnTop(true, 'screen-saver');
        }
        this.intelWindow.webContents.send(IPC_CHANNELS.OVERLAY_STATE_UPDATE, unifiedPayload);
        this.intelWindow.webContents.send('signal-update', unifiedPayload);
      }
    }
  }

  public getIsVisible(): boolean {
    return this.isVisible;
  }

  public toggleVisibility(): boolean {
    if (this.isVisible) this.hide();
    else this.show();
    return this.isVisible;
  }

  public destroy(): void {
    this.isVisible = false;
    if (this.signalWindow && !this.signalWindow.isDestroyed()) {
      this.signalWindow.destroy();
      this.signalWindow = null;
    }
    if (this.intelWindow && !this.intelWindow.isDestroyed()) {
      this.intelWindow.destroy();
      this.intelWindow = null;
    }
  }
}
