// ============================================================
// MARS PRO V3 — Electron Main Process Entry
// Security-first Electron configuration with embedded browser workstation layout.
// ============================================================

import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
} from 'electron';
import path from 'path';
import fs from 'fs';
import { AnalysisController } from './lifecycle/AnalysisController';
import { OverlayManager } from './overlay/OverlayManager';
import { Database } from './database/Database';
import { registerIpcHandlers } from './ipc/handlers';
import { registerAnalyticsIpcHandlers } from './ipc/analyticsHandlers';
import { SettingsRepository } from './database/repositories/SettingsRepository';
import { EmbeddedBrowserManager } from './view/EmbeddedBrowserManager';
import { RunningTradeManager } from './trade/RunningTradeManager';
import { TradeRepository } from './database/repositories/TradeRepository';
import {
  isTrustedDevServerUrl,
  isTrustedRendererNavigation,
} from './security/urlPolicy';

process.on('uncaughtException', (err) => {
  console.error('[MARS MAIN FATAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[MARS MAIN FATAL] Unhandled Rejection:', reason);
});

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
    console.error('[MARS SECURITY] Ignoring untrusted VITE_DEV_SERVER_URL. Only loopback origins are allowed.');
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
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: true,
      },
    });

    win.webContents.on('will-navigate', (event, url) => {
      if (!isTrustedRendererNavigation(url, distHtmlPath, devServerUrl)) {
        console.warn(`[MARS SECURITY] Blocked renderer navigation to ${url}`);
        event.preventDefault();
      }
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) {
        win.show();
        win.maximize();
      }
    });

    if (devServerUrl) {
      void win.loadURL(devServerUrl);
    } else if (fs.existsSync(distHtmlPath)) {
      void win.loadFile(distHtmlPath);
    } else {
      const errorPage = encodeURIComponent(`
        <!doctype html>
        <html lang="en">
          <head><meta charset="utf-8"><title>MARS build missing</title></head>
          <body style="font-family:Segoe UI,sans-serif;background:#0a0e17;color:#f8fafc;padding:32px">
            <h1>MARS renderer build is missing</h1>
            <p>Run <code>npm run build</code>, then start the application again.</p>
          </body>
        </html>
      `);
      void win.loadURL(`data:text/html;charset=utf-8,${errorPage}`);
    }

    return win;
  }

  function shutdownApp(): void {
    if (isShuttingDown) return;
    isShuttingDown = true;

    try {
      if (analysisController) {
        analysisController.stop();
        analysisController = null;
      }
    } catch (err) {
      console.error('[MARS] Error stopping analysis controller:', err);
    }

    try {
      EmbeddedBrowserManager.getInstance().destroy();
    } catch (err) {
      console.error('[MARS] Error destroying browser manager:', err);
    }

    try {
      if (overlayManager) {
        overlayManager.destroy();
        overlayManager = null;
      }
    } catch (err) {
      console.error('[MARS] Error destroying overlay manager:', err);
    }

    try {
      if (database) {
        database.close();
        database = null;
      }
    } catch (err) {
      console.error('[MARS] Error closing database:', err);
    }
  }

  async function initializeApp(): Promise<void> {
    try {
      const dbPath = path.join(app.getPath('userData'), 'mars-pro.db');
      database = new Database(dbPath);
      await database.initialize();

      mainWindow = createMainWindow();

      EmbeddedBrowserManager.getInstance().initialize(mainWindow, 'https://olymptrade.com');

      mainWindow.on('resize', () => {
        EmbeddedBrowserManager.getInstance().updateBounds();
      });

      overlayManager = new OverlayManager();
      overlayManager.createWindows();

      analysisController = new AnalysisController(overlayManager, mainWindow, database);

      const tradeRepo = new TradeRepository(database);
      RunningTradeManager.getInstance().setRepository(tradeRepo);
      RunningTradeManager.getInstance().loadAndRecoverPendingTrades();

      const settingsRepo = new SettingsRepository(database);

      registerIpcHandlers(
        ipcMain,
        analysisController,
        overlayManager,
        database,
        mainWindow,
        settingsRepo,
      );
      registerAnalyticsIpcHandlers(ipcMain);

      app.on('second-instance', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      });

      mainWindow.on('closed', () => {
        mainWindow = null;
        shutdownApp();
      });
    } catch (err) {
      console.error('[MARS MAIN] App initialization error:', err);
    }
  }

  app.whenReady().then(initializeApp);

  app.on('before-quit', () => {
    shutdownApp();
  });

  app.on('window-all-closed', () => {
    shutdownApp();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void initializeApp();
    }
  });
}
