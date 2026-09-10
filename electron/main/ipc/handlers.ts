// ============================================================
// MARS PRO V3 — IPC Handlers
// Typed IPC handler registration for Main <-> Renderer.
// Connected directly to CanonicalDataAccessLayer & TradeLifecycleManager.
// ============================================================

import { IpcMain, BrowserWindow, app } from 'electron';
import { IPC_INVOKE_CHANNELS } from '../../../shared/contracts/ipc-channels';
import { AnalysisController } from '../lifecycle/AnalysisController';
import { OverlayManager } from '../overlay/OverlayManager';
import { Database } from '../database/Database';
import { SettingsRepository } from '../database/repositories/SettingsRepository';
import { SignalHistoryRepository } from '../database/repositories/SignalHistoryRepository';
import { AppSettings, OverlayPosition, HistoryQuery, ManualTradeInput } from '../../../shared/types/ipc';
import { EmbeddedBrowserManager } from '../view/EmbeddedBrowserManager';
import { TradeLifecycleManager } from '../trade/TradeLifecycleManager';
import { CanonicalDataAccessLayer } from '../database/CanonicalDataAccessLayer';
import { PerformanceEngine } from '../performance/PerformanceEngine';
import { CalibrationDatasetManager } from '../brain/CalibrationDatasetManager';
import { AnalyticsEngine } from '../analytics/AnalyticsEngine';
import { LiveDecisionTraceEngine } from '../analytics/LiveDecisionTraceEngine';
import { SelfLearningDatasetManager } from '../brain/SelfLearningDatasetManager';
import { MLEngine } from '../decision/MLEngine';
import { RuntimeHealthMonitor } from '../diagnostics/RuntimeHealthMonitor';
import { SignalVerificationEngine } from '../brain/SignalVerificationEngine';
import { CentralWatchdog } from '../diagnostics/CentralWatchdog';
import { KnowledgeBaseRepository } from '../brain/KnowledgeBaseRepository';
import { SignalQualityInspector } from '../brain/SignalQualityInspector';
import { PipelineConsistencyValidator } from '../diagnostics/PipelineConsistencyValidator';

export function registerIpcHandlers(
  ipcMain: IpcMain,
  analysisController: AnalysisController,
  overlayManager: OverlayManager,
  db: Database,
  mainWindow: BrowserWindow,
  settingsRepo: SettingsRepository
): void {
  const historyRepo = new SignalHistoryRepository(db);
  CanonicalDataAccessLayer.getInstance().setDatabase(db);
  CalibrationDatasetManager.getInstance().setDatabase(db);
  AnalyticsEngine.getInstance().setDatabase(db);
  PerformanceEngine.getInstance().setDatabase(db);

  const safeHandle = (channel: string, handler: (...args: any[]) => any) => {
    try {
      ipcMain.removeHandler(channel);
    } catch {}
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await handler(event, ...args);
      } catch (err) {
        console.error(`[MARS IPC ERROR] Channel '${channel}' failed:`, err);
        throw err;
      }
    });
  };

  // ----------------------------------------------------------
  // Window Controls
  // ----------------------------------------------------------

  safeHandle(IPC_INVOKE_CHANNELS.MINIMIZE_WINDOW, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
    return { success: true };
  });

  safeHandle(IPC_INVOKE_CHANNELS.MAXIMIZE_WINDOW, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
    return { isMaximized: mainWindow?.isMaximized() ?? false };
  });

  safeHandle(IPC_INVOKE_CHANNELS.CLOSE_WINDOW, () => {
    analysisController.stop();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
    app.quit();
    return { success: true };
  });

  // ----------------------------------------------------------
  // Lifecycle & State Fetch
  // ----------------------------------------------------------

  safeHandle(IPC_INVOKE_CHANNELS.GET_CONTROL_STATE, () => {
    return analysisController.getControlCenterState();
  });

  safeHandle(IPC_INVOKE_CHANNELS.START_ANALYSIS, async () => {
    return analysisController.start();
  });

  safeHandle(IPC_INVOKE_CHANNELS.STOP_ANALYSIS, () => {
    return analysisController.stop();
  });

  // ----------------------------------------------------------
  // Overlay Management
  // ----------------------------------------------------------

  safeHandle(IPC_INVOKE_CHANNELS.TOGGLE_OVERLAY, () => {
    if (overlayManager.getIsVisible()) {
      overlayManager.hide();
    } else {
      overlayManager.show();
    }
    return { visible: overlayManager.getIsVisible() };
  });

  safeHandle('set-browser-visibility', (_event, visible: boolean) => {
    EmbeddedBrowserManager.getInstance().setVisible(visible);
    return { success: true };
  });

  safeHandle('switch-tab', (_event, tabId: string) => {
    const isBrowserTab = tabId === 'browser' || tabId === 'workstation';
    EmbeddedBrowserManager.getInstance().setVisible(isBrowserTab);
    return { success: true, tabId };
  });

  safeHandle('browser:go-back', () => {
    EmbeddedBrowserManager.getInstance().goBack();
    return { success: true };
  });

  safeHandle('browser:go-forward', () => {
    EmbeddedBrowserManager.getInstance().goForward();
    return { success: true };
  });

  safeHandle('browser:reload', () => {
    EmbeddedBrowserManager.getInstance().reload();
    return { success: true };
  });

  safeHandle('browser:load-url', (_event, url: string) => {
    EmbeddedBrowserManager.getInstance().navigate(url || 'https://olymptrade.com/platform');
    return { success: true };
  });

  safeHandle('browser:toggle-focus', () => {
    const isFocus = EmbeddedBrowserManager.getInstance().toggleFocusMode();
    return { isFocusMode: isFocus };
  });

  safeHandle('browser:zoom-in', () => ({ zoomFactor: EmbeddedBrowserManager.getInstance().changeZoom(0.1) }));
  safeHandle('browser:zoom-out', () => ({ zoomFactor: EmbeddedBrowserManager.getInstance().changeZoom(-0.1) }));
  safeHandle('browser:zoom-reset', () => ({ zoomFactor: EmbeddedBrowserManager.getInstance().resetZoom() }));

  safeHandle(
    IPC_INVOKE_CHANNELS.SAVE_OVERLAY_POSITION,
    (_event, position: OverlayPosition) => {
      overlayManager.savePosition(position);
      return { success: true };
    }
  );

  safeHandle(IPC_INVOKE_CHANNELS.GET_OVERLAY_POSITIONS, () => {
    return overlayManager.getPositions();
  });

  safeHandle(
    IPC_INVOKE_CHANNELS.OVERLAY_SAVE_BOUNDS,
    (_event, position: OverlayPosition) => {
      overlayManager.savePosition(position);
      return { success: true };
    }
  );

  safeHandle(IPC_INVOKE_CHANNELS.OVERLAY_GET_BOUNDS, (_event, panelId?: string) => {
    if (panelId) {
      const all = overlayManager.getPositions();
      return all.find((p) => p.panelId === panelId) || null;
    }
    return overlayManager.getPositions();
  });

  // ----------------------------------------------------------
  // Settings
  // ----------------------------------------------------------

  safeHandle(IPC_INVOKE_CHANNELS.GET_SETTINGS, () => {
    const saved = settingsRepo.getAll();
    analysisController.updateSettings(saved);
    return saved;
  });

  safeHandle(
    IPC_INVOKE_CHANNELS.UPDATE_SETTINGS,
    (_event, settings: Partial<AppSettings>) => {
      settingsRepo.updateAll(settings);
      const full = settingsRepo.getAll();
      analysisController.updateSettings(full);
      return { success: true };
    }
  );

  // ----------------------------------------------------------
  // History & Journal (Canonical Data Access Layer)
  // ----------------------------------------------------------
  safeHandle(
    IPC_INVOKE_CHANNELS.GET_HISTORY,
    (_event, query: HistoryQuery) => {
      return CanonicalDataAccessLayer.getInstance().getJournalEntries(query);
    }
  );

  safeHandle(
    IPC_INVOKE_CHANNELS.GET_PERFORMANCE_STATS,
    (_event, sessionId?: string) => {
      return CanonicalDataAccessLayer.getInstance().getPerformanceStats(sessionId);
    }
  );

  safeHandle(
    IPC_INVOKE_CHANNELS.GET_ACTIVE_TRADES,
    () => {
      return TradeLifecycleManager.getInstance().getPanelActiveTrades();
    }
  );

  safeHandle(
    IPC_INVOKE_CHANNELS.DELETE_TRADE,
    (_event, id: string) => {
      const success = PerformanceEngine.getInstance().deleteTrade(id);
      analysisController.emitPerformanceRefresh();
      return { success };
    }
  );

  safeHandle(
    IPC_INVOKE_CHANNELS.DELETE_SELECTED_TRADES,
    (_event, ids: string[]) => {
      const count = PerformanceEngine.getInstance().deleteSelectedTrades(ids);
      analysisController.emitPerformanceRefresh();
      return { success: true, count };
    }
  );

  safeHandle(
    IPC_INVOKE_CHANNELS.CLEAR_TODAY_HISTORY,
    () => {
      const count = PerformanceEngine.getInstance().clearTodayHistory();
      analysisController.emitPerformanceRefresh();
      return { success: true, count };
    }
  );

  safeHandle(
    IPC_INVOKE_CHANNELS.CLEAR_SESSION_HISTORY,
    (_event, sessionId?: string) => {
      const sid = sessionId || analysisController.getActiveSessionId() || '';
      const count = PerformanceEngine.getInstance().clearSessionHistory(sid);
      analysisController.emitPerformanceRefresh();
      return { success: true, count };
    }
  );

  safeHandle(
    IPC_INVOKE_CHANNELS.CLEAR_ALL_HISTORY,
    () => {
      const count = PerformanceEngine.getInstance().clearAllHistory();
      analysisController.emitPerformanceRefresh();
      return { success: true, count };
    }
  );

  safeHandle(IPC_INVOKE_CHANNELS.RECORD_MANUAL_TRADE, (_event, input: ManualTradeInput) => {
    if (!input?.asset?.trim() || !["BUY", "SELL"].includes(input.action) || !["WIN", "LOSS", "DRAW"].includes(input.outcome)) {
      return { success: false, error: 'Asset, direction, and outcome are required.' };
    }
    historyRepo.recordManualTrade(input);
    analysisController.emitPerformanceRefresh();
    return { success: true };
  });

  safeHandle(IPC_INVOKE_CHANNELS.GET_CALIBRATION_HEALTH, () => {
    return CalibrationDatasetManager.getInstance().getCalibrationHealth();
  });

  safeHandle(IPC_INVOKE_CHANNELS.GET_CALIBRATION_ANALYSIS, () => {
    return analysisController.getCalibrationAnalysis();
  });

  safeHandle(IPC_INVOKE_CHANNELS.GET_CALIBRATION_DATASET, () => {
    return CalibrationDatasetManager.getInstance().getCalibrationObservations();
  });

  // Self-Learning Dataset
  SelfLearningDatasetManager.getInstance().setDatabase(db);

  safeHandle(IPC_INVOKE_CHANNELS.GET_LEARNING_DATASET_AUDIT, () => {
    return SelfLearningDatasetManager.getInstance().getCompleteLearningRecords();
  });

  safeHandle(IPC_INVOKE_CHANNELS.RUN_LEARNING_QUALITY_REPAIR, () => {
    return SelfLearningDatasetManager.getInstance().auditAndRepairDataQuality();
  });

  safeHandle(IPC_INVOKE_CHANNELS.GET_MODEL_READINESS_SCORE, () => {
    const ml = MLEngine.getInstance();
    return {
      readiness: ml.getReadiness(),
      sampleSize: ml.getSampleCount(),
      trainedModelLoaded: ml.hasTrainedModel(),
      ...SelfLearningDatasetManager.getInstance().getModelReadinessScore(),
    };
  });

  safeHandle(IPC_INVOKE_CHANNELS.RUN_TRADE_REPLAY_VALIDATION, (_event, tradeId?: string) => {
    return SelfLearningDatasetManager.getInstance().validateTradeReplay(tradeId);
  });

  safeHandle(IPC_INVOKE_CHANNELS.GET_SYSTEM_HEALTH, () => {
    return RuntimeHealthMonitor.getInstance().getHealthReport();
  });

  safeHandle(IPC_INVOKE_CHANNELS.GET_ADAPTIVE_LEARNING_SUMMARY, () => {
    SignalVerificationEngine.getInstance().setDatabase(db);
    return SignalVerificationEngine.getInstance().getAdaptiveLearningSummary();
  });

  safeHandle(IPC_INVOKE_CHANNELS.GET_WATCHDOG_LOGS, () => {
    return CentralWatchdog.getInstance().getRecoveryLogs();
  });

  safeHandle(IPC_INVOKE_CHANNELS.SEARCH_KNOWLEDGE_BASE, (_event, queryOptions?: any) => {
    KnowledgeBaseRepository.getInstance().setDatabase(db);
    return KnowledgeBaseRepository.getInstance().searchKnowledgeBase(queryOptions || {});
  });

  safeHandle(IPC_INVOKE_CHANNELS.GET_SIGNAL_QUALITY_TRACES, () => {
    SignalQualityInspector.getInstance().setDatabase(db);
    return SignalQualityInspector.getInstance().getAllTraces();
  });

  safeHandle(IPC_INVOKE_CHANNELS.VALIDATE_PIPELINE, (_event, signalId?: string, tradeId?: string) => {
    PipelineConsistencyValidator.getInstance().setDatabase(db);
    return PipelineConsistencyValidator.getInstance().validateSignalPipeline(signalId || 'latest', tradeId);
  });

  safeHandle(IPC_INVOKE_CHANNELS.GET_SELF_TEST_REPORT, () => {
    PipelineConsistencyValidator.getInstance().setDatabase(db);
    return PipelineConsistencyValidator.getInstance().run60SecondSelfTest();
  });

  // Analytics Engine & Decision Intelligence
  safeHandle(IPC_INVOKE_CHANNELS.GET_ANALYTICS_REPORT, () => {
    return AnalyticsEngine.getInstance().getComprehensiveReport();
  });

  safeHandle(IPC_INVOKE_CHANNELS.RUN_VALIDATION_CHECK, () => {
    return AnalyticsEngine.getInstance().validateRuntimeIntegrity();
  });

  safeHandle(IPC_INVOKE_CHANNELS.EXPORT_ANALYTICS_CSV, () => {
    return AnalyticsEngine.getInstance().exportCsv();
  });

  safeHandle(IPC_INVOKE_CHANNELS.EXPORT_ANALYTICS_JSON, () => {
    return AnalyticsEngine.getInstance().exportJson();
  });

  // ----------------------------------------------------------
  // Developer & Diagnostics
  // ----------------------------------------------------------

  safeHandle(IPC_INVOKE_CHANNELS.GET_DIAGNOSTICS, () => {
    return analysisController.getDeveloperDiagnostics();
  });

  safeHandle(
    IPC_INVOKE_CHANNELS.TRIGGER_DIAGNOSTIC_CAPTURE,
    async () => {
      return await analysisController.triggerDiagnosticCapture();
    }
  );

  safeHandle(IPC_INVOKE_CHANNELS.GET_LIVE_DECISION_TRACES, (_event, limit?: number) => {
    return LiveDecisionTraceEngine.getInstance().getScanTraces(limit);
  });

  safeHandle(IPC_INVOKE_CHANNELS.GET_DECISION_CHANGE_LOGS, (_event, limit?: number) => {
    return LiveDecisionTraceEngine.getInstance().getDecisionChangeLogs(limit);
  });

  safeHandle(IPC_INVOKE_CHANNELS.GET_RUNNING_TRADE_DEBUG, () => {
    return LiveDecisionTraceEngine.getInstance().getRunningTradeDebugInfo();
  });

  safeHandle(IPC_INVOKE_CHANNELS.SET_DEBUGGER_ENABLED, (_event, enabled: boolean) => {
    LiveDecisionTraceEngine.getInstance().setEnabled(enabled);
    return { success: true, enabled };
  });

  safeHandle(IPC_INVOKE_CHANNELS.GET_DEBUGGER_ENABLED, () => {
    return { enabled: LiveDecisionTraceEngine.getInstance().getIsEnabled() };
  });

  // ----------------------------------------------------------
  // Replay
  // ----------------------------------------------------------

  safeHandle(
    IPC_INVOKE_CHANNELS.RUN_SAVED_FRAME,
    async (_event, framePath: string) => analysisController.replayFrame(framePath)
  );

  safeHandle(
    IPC_INVOKE_CHANNELS.START_FRAME_REPLAY,
    async (_event, framePath: string) => analysisController.replayFrame(framePath)
  );

  safeHandle(
    IPC_INVOKE_CHANNELS.START_OBSERVATION_REPLAY,
    async (_event, observationJson: string) => analysisController.replayObservation(observationJson)
  );

  safeHandle(IPC_INVOKE_CHANNELS.STOP_REPLAY, () => {
    return { success: true, stoppedAt: Date.now() };
  });

  // ----------------------------------------------------------
  // System
  // ----------------------------------------------------------

  safeHandle(IPC_INVOKE_CHANNELS.GET_DISPLAYS, () => {
    const { screen } = require('electron');
    const displays = screen.getAllDisplays();
    return displays.map((d: Electron.Display) => ({
      id: d.id.toString(),
      label: 'Display ' + d.id + (d.bounds.x === 0 && d.bounds.y === 0 ? ' (Primary)' : ''),
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      isPrimary: d.bounds.x === 0 && d.bounds.y === 0,
    }));
  });

  safeHandle(
    IPC_INVOKE_CHANNELS.SET_TARGET_DISPLAY,
    (_event, displayId: string) => {
      settingsRepo.set('targetDisplayId', displayId);
      return { success: true };
    }
  );

  safeHandle(IPC_INVOKE_CHANNELS.EXECUTE_MANUAL_TRADE, (_event, action?: any) => {
    analysisController.executeManualTrade(action);
    return { success: true };
  });

  safeHandle(IPC_INVOKE_CHANNELS.PURGE_HISTORY, (_event, days: number = 30) => {
    historyRepo.purgeOlderThan(days);
    return { success: true };
  });
}
