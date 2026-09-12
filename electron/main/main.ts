// ============================================================
// MARS PRO V3 — Electron Main Process Entry
// Visible, recoverable Windows startup with persistent diagnostics.
// ============================================================

import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import { AnalysisController } from './lifecycle/AnalysisController';
import { OverlayManager } from './overlay/OverlayManager';
import { Database } from './database/Database';
import { initializeDatabaseWithRecovery } from './database/initializeDatabaseWithRecovery';
import { registerIpcHandlers } from './ipc/handlers';
import { registerAnalyticsIpcHandlers } from './ipc/analyticsHandlers';
import { SettingsRepository } from './database/repositories/SettingsRepository';
import { EmbeddedBrowserManager } from './view/EmbeddedBrowserManager';
import { RunningTradeManager } from './trade/RunningTradeManager';
import { TradeRepository } from './database/repositories/TradeRepository';
import { GraphicsStartupGuard, SAFE_GRAPHICS_ARG } from './performance/GraphicsStartupGuard';
import {
  isTrustedDevServerUrl,
  isTrustedRendererNavigation,
  OLYMP_TRADE_PLATFORM_URL,
} from './security/urlPolicy';

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
  return String(error);
}

function startupLogPath(): string {
  try { return path.join(app.getPath('userData'), 'mars-startup.log'); }
  catch { return path.join(process.cwd(), 'mars-startup.log'); }
}

function appendStartupLog(event: string, detail?: unknown): string {
  const filePath = startupLogPath();
  const rendered = detail === undefined ? '' : `\n${describeError(detail)}`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `[${new Date().toISOString()}] ${event}${rendered}\n`);
  } catch {}
  return filePath;
}

// Hardware acceleration is the normal Windows path. If the GPU process
// actually fails, the guard records it and relaunches once in safe graphics
// mode. This preserves rc.2 startup recovery without forcing every machine to
// render the live chart and transparent overlay in software.
let graphicsGuard: GraphicsStartupGuard | null = null;
let safeGraphicsMode = false;
let graphicsRelaunching = false;
if (process.platform === 'win32') {
  const graphicsStatePath = path.join(app.getPath('userData'), 'mars-graphics-startup.json');
  graphicsGuard = new GraphicsStartupGuard(graphicsStatePath);
  safeGraphicsMode = graphicsGuard.beginAttempt(process.argv);
  if (safeGraphicsMode) app.disableHardwareAcceleration();
}

app.on('child-process-gone', (_event, details) => {
  const processType = String(details.type || '').toLowerCase();
  const reason = String(details.reason || 'unknown');
  if (process.platform !== 'win32' || safeGraphicsMode || graphicsRelaunching || !processType.includes('gpu')) return;
  if (!['crashed', 'oom', 'launch-failed', 'integrity-failure'].includes(reason)) return;

  graphicsRelaunching = true;
  const detail = `${details.type}: ${reason} (exit ${details.exitCode})`;
  graphicsGuard?.recordGpuFailure(detail);
  appendStartupLog('GPU process failed; relaunching in Safe Graphics Mode', detail);
  const args = process.argv.slice(1).filter((arg) => arg !== SAFE_GRAPHICS_ARG);
  app.relaunch({ args: [...args, SAFE_GRAPHICS_ARG] });
  app.exit(0);
});

function showFatalProcessError(title: string, error: unknown): void {
  const logPath = appendStartupLog(title, error);
  const show = () => {
    try {
      dialog.showErrorBox(
        'MARS PRO V3 startup error',
        `${describeError(error)}\n\nDiagnostic log:\n${logPath}`,
      );
    } catch {}
  };
  if (app.isReady()) show();
  else app.once('ready', show);
}

process.on('uncaughtException', (error) => showFatalProcessError('Uncaught main-process exception', error));
process.on('unhandledRejection', (reason) => showFatalProcessError('Unhandled main-process rejection', reason));

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let analysisController: AnalysisController | null = null;
  let overlayManager: OverlayManager | null = null;
  let database: Database | null = null;
  let isShuttingDown = false;

  const configuredDevServerUrl = process.env.VITE_DEV_SERVER_URL;
  const devServerUrl = configuredDevServerUrl && isTrustedDevServerUrl(configuredDevServerUrl)
    ? configuredDevServerUrl
    : undefined;
  if (configuredDevServerUrl && !devServerUrl) {
    appendStartupLog('Ignored untrusted VITE_DEV_SERVER_URL');
  }

  function createMainWindow(): BrowserWindow {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    const distHtmlPath = path.join(__dirname, '../../dist/index.html');
    const win = new BrowserWindow({
      width: Math.min(1600, Math.round(width * 0.9)),
      height: Math.min(1000, Math.round(height * 0.9)),
      minWidth: 1024,
      minHeight: 700,
      title: 'MARS PRO V3 Workstation',
      frame: false,
      backgroundColor: '#0a0e17',
      show: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });

    win.webContents.on('will-navigate', (event, url) => {
      if (!isTrustedRendererNavigation(url, distHtmlPath, devServerUrl)) {
        appendStartupLog(`Blocked renderer navigation to ${url}`);
        event.preventDefault();
      }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame) return;
      appendStartupLog(`Renderer failed to load ${url} (${code}: ${description})`);
      if (!win.isDestroyed() && !win.isVisible()) win.show();
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      appendStartupLog(`Main renderer exited (${details.reason}, code ${details.exitCode})`);
      if (!win.isDestroyed() && !win.isVisible()) win.show();
    });
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) {
        win.show();
        win.maximize();
      }
    });
    win.webContents.once('did-finish-load', () => {
      graphicsGuard?.recordHealthy(safeGraphicsMode);
      appendStartupLog(`Main renderer loaded (graphics=${safeGraphicsMode ? 'safe-software' : 'hardware-accelerated'})`);
    });

    const load = devServerUrl
      ? win.loadURL(devServerUrl)
      : fs.existsSync(distHtmlPath)
        ? win.loadFile(distHtmlPath)
        : Promise.reject(new Error(`Renderer build missing at ${distHtmlPath}`));
    void load.catch((error) => {
      const logPath = appendStartupLog('Main renderer load promise failed', error);
      if (!win.isDestroyed() && !win.isVisible()) win.show();
      try {
        dialog.showErrorBox(
          'MARS PRO V3 display error',
          `The application window could not load.\n\nDiagnostic log:\n${logPath}`,
        );
      } catch {}
    });

    return win;
  }

  function showStartupFailure(error: unknown): void {
    const logPath = appendStartupLog('Application initialization failed', error);
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = new BrowserWindow({
        width: 760,
        height: 520,
        minWidth: 600,
        minHeight: 400,
        title: 'MARS PRO V3 startup error',
        backgroundColor: '#0a0e17',
        show: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      const escape = (value: string) => value
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const html = encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><title>MARS startup error</title></head><body style="font-family:Segoe UI,sans-serif;background:#0a0e17;color:#f8fafc;padding:32px"><h1>MARS PRO V3 could not start</h1><p>The original data has been preserved. Please share the diagnostic log shown below.</p><pre style="white-space:pre-wrap;background:#111827;padding:16px;border-radius:8px">${escape(describeError(error))}</pre><p><b>Diagnostic log</b><br>${escape(logPath)}</p></body></html>`);
      void mainWindow.loadURL(`data:text/html;charset=utf-8,${html}`).catch(() => {});
    } else if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    try {
      dialog.showErrorBox('MARS PRO V3 could not start', `Your data was not deleted.\n\nDiagnostic log:\n${logPath}`);
    } catch {}
  }

  function shutdownApp(): void {
    if (isShuttingDown) return;
    isShuttingDown = true;
    try { analysisController?.stop(); analysisController = null; }
    catch (error) { appendStartupLog('Error stopping analysis controller', error); }
    try { EmbeddedBrowserManager.getInstance().destroy(); }
    catch (error) { appendStartupLog('Error destroying browser manager', error); }
    try { overlayManager?.destroy(); overlayManager = null; }
    catch (error) { appendStartupLog('Error destroying overlay manager', error); }
    try { database?.close(); database = null; }
    catch (error) { appendStartupLog('Error closing database', error); }
  }

  async function initializeApp(): Promise<void> {
    try {
      isShuttingDown = false;
      appendStartupLog(`Starting MARS ${app.getVersion()} (packaged=${app.isPackaged}, graphics=${safeGraphicsMode ? 'safe-software' : 'hardware-accelerated'})`);
      const dbPath = path.join(app.getPath('userData'), 'mars-pro.db');
      const recovery = await initializeDatabaseWithRecovery(
        dbPath,
        () => new Database(dbPath),
        (message, error) => appendStartupLog(message, error),
      );
      database = recovery.database;
      if (recovery.recovered) {
        appendStartupLog(`Clean database recovery succeeded; preserved: ${recovery.quarantinedPaths.join(', ')}`);
      }

      mainWindow = createMainWindow();
      EmbeddedBrowserManager.getInstance().initialize(mainWindow, OLYMP_TRADE_PLATFORM_URL);
      mainWindow.on('resize', () => EmbeddedBrowserManager.getInstance().updateBounds());

      overlayManager = new OverlayManager();
      overlayManager.createWindows();
      EmbeddedBrowserManager.getInstance().setMarketSnapshotHandler((snapshot) => {
        overlayManager?.sendQuote(snapshot);
      });
      analysisController = new AnalysisController(overlayManager, mainWindow, database);

      const tradeRepo = new TradeRepository(database);
      RunningTradeManager.getInstance().setRepository(tradeRepo);
      RunningTradeManager.getInstance().loadAndRecoverPendingTrades();
      const settingsRepo = new SettingsRepository(database);

      registerIpcHandlers(ipcMain, analysisController, overlayManager, database, mainWindow, settingsRepo);
      registerAnalyticsIpcHandlers(ipcMain, mainWindow);

      app.on('second-instance', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      });
      mainWindow.on('closed', () => {
        mainWindow = null;
        shutdownApp();
      });
      appendStartupLog('Application initialization completed');
    } catch (error) {
      showStartupFailure(error);
    }
  }

  void app.whenReady().then(initializeApp).catch((error) => showStartupFailure(error));
  app.on('before-quit', shutdownApp);
  app.on('window-all-closed', () => {
    shutdownApp();
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void initializeApp();
  });
}
