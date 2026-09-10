// ============================================================
// MARS PRO V3 â€” Electron Main Process Entry
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
import { SettingsRepository } from './database/repositories/SettingsRepository';
import { EmbeddedBrowserManager } from './view/EmbeddedBrowserManager';
import { RunningTradeManager } from './trade/RunningTradeManager';
import { TradeRepository } from './database/repositories/TradeRepository';

// Global process exception safety
process.on('uncaughtException', (err) => {
  console.error('[MARS MAIN FATAL] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[MARS MAIN FATAL] Unhandled Rejection:', reason);
});

// Single-instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let analysisController: AnalysisController | null = null;
  let overlayManager: OverlayManager | null = null;
  let database: Database | null = null;
  let isShuttingDown = false;

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  function createMainWindow(): BrowserWindow {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    const win = new BrowserWindow({
      width: Math.min(1600, Math.round(width * 0.9)),
      height: Math.min(1000, Math.round(height * 0.9)),
      minWidth: 1024,
      minHeight: 700,
      title: 'MARS PRO V3 Workstation',
      frame: false, // Custom integrated title bar
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

    // Prevent navigation to external URLs in the UI frame
    win.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('file://') && !url.startsWith('http://localhost')) {
        event.preventDefault();
      }
    });

    // Block new window creation
    win.webContents.setWindowOpenHandler(() => {
      return { action: 'deny' };
    });

    win.once('ready-to-show', () => {
      if (win && !win.isDestroyed()) {
        win.show();
        win.maximize();
      }
    });

    const distHtmlPath = path.join(__dirname, '../../dist/index.html');

    if (devServerUrl) {
      win.loadURL(devServerUrl);
    } else if (fs.existsSync(distHtmlPath)) {
      win.loadFile(distHtmlPath);
    } else {
      win.loadURL('http://localhost:5173');
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
      // Initialize database
      const dbPath = path.join(app.getPath('userData'), 'mars-pro.db');
      database = new Database(dbPath);
      await database.initialize();

      // Create main window
      mainWindow = createMainWindow();

      // Initialize embedded browser manager inside main workstation window
      EmbeddedBrowserManager.getInstance().initialize(mainWindow, 'https://olymptrade.com');

      mainWindow.on('resize', () => {
        EmbeddedBrowserManager.getInstance().updateBounds();
      });

      // Initialize overlay manager
      overlayManager = new OverlayManager();
      overlayManager.createWindows();

      // Initialize analysis controller (launches in strict STOPPED state)
      analysisController = new AnalysisController(overlayManager, mainWindow, database!);

      // Initialize trade manager with DB connection
      const tradeRepo = new TradeRepository(database!);
      RunningTradeManager.getInstance().setRepository(tradeRepo);
      RunningTradeManager.getInstance().loadAndRecoverPendingTrades();

      // Initialize settings repository
      const settingsRepo = new SettingsRepository(database!);

      // Register IPC handlers
      registerIpcHandlers(
        ipcMain,
        analysisController,
        overlayManager,
        database!,
        mainWindow,
        settingsRepo
      );

      // Handle second instance
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
      initializeApp();
    }
  });
}

