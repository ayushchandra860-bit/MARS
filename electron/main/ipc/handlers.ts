// ============================================================
// MARS PRO V3 — Privileged IPC Handlers
// Every request is authenticated to the trusted top-level renderer and every
// renderer-controlled argument is validated before reaching a subsystem.
// ============================================================

import { IpcMain, BrowserWindow, app, screen } from 'electron';
import path from 'node:path';
import { IPC_INVOKE_CHANNELS } from '../../../shared/contracts/ipc-channels';
import { AnalysisController } from '../lifecycle/AnalysisController';
import { OverlayManager } from '../overlay/OverlayManager';
import { Database } from '../database/Database';
import { SettingsRepository } from '../database/repositories/SettingsRepository';
import { SignalHistoryRepository } from '../database/repositories/SignalHistoryRepository';
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
import { assertTrustedIpcSender } from './trustedSender';
import {
  validateBoolean,
  validateBrowserUrl,
  validateHistoryQuery,
  validateIdentifier,
  validateIdentifierArray,
  validateLimit,
  validateManualExecution,
  validateManualTradeInput,
  validateOptionalIdentifier,
  validateOverlayPosition,
  validatePurgeDays,
  validateReplayObservation,
  validateSettingsPatch,
  validateWorkstationTab,
} from './inputValidation';
import {
  validateDisplayId,
  validateKnowledgeQuery,
  validateSavedFramePath,
} from './domainValidation';

export function registerIpcHandlers(
  ipcMain: IpcMain,
  analysisController: AnalysisController,
  overlayManager: OverlayManager,
  db: Database,
  mainWindow: BrowserWindow,
  settingsRepo: SettingsRepository,
): void {
  const historyRepo = new SignalHistoryRepository(db);
  CanonicalDataAccessLayer.getInstance().setDatabase(db);
  CalibrationDatasetManager.getInstance().setDatabase(db);
  AnalyticsEngine.getInstance().setDatabase(db);
  PerformanceEngine.getInstance().setDatabase(db);

  const safeHandle = (channel: string, handler: (...args: any[]) => any) => {
    try { ipcMain.removeHandler(channel); } catch {}
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        assertTrustedIpcSender(event, mainWindow);
        return await handler(event, ...args);
      } catch (error) {
        console.error(`[MARS IPC ERROR] Channel '${channel}' rejected or failed:`, error);
        throw error;
      }
    });
  };

  safeHandle(IPC_INVOKE_CHANNELS.MINIMIZE_WINDOW, () => {
    mainWindow.minimize();
    return { success: true };
  });
  safeHandle(IPC_INVOKE_CHANNELS.MAXIMIZE_WINDOW, () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return { isMaximized: mainWindow.isMaximized() };
  });
  safeHandle(IPC_INVOKE_CHANNELS.CLOSE_WINDOW, () => {
    analysisController.stop();
    mainWindow.close();
    app.quit();
    return { success: true };
  });

  safeHandle(IPC_INVOKE_CHANNELS.GET_CONTROL_STATE, () => analysisController.getControlCenterState());
  safeHandle(IPC_INVOKE_CHANNELS.START_ANALYSIS, () => analysisController.start());
  safeHandle(IPC_INVOKE_CHANNELS.STOP_ANALYSIS, () => analysisController.stop());

  safeHandle(IPC_INVOKE_CHANNELS.TOGGLE_OVERLAY, () => {
    if (overlayManager.getIsVisible()) overlayManager.hide();
    else overlayManager.show();
    return { visible: overlayManager.getIsVisible() };
  });
  safeHandle(IPC_INVOKE_CHANNELS.SET_BROWSER_VISIBILITY, (_event, visible: unknown) => {
    EmbeddedBrowserManager.getInstance().setVisible(validateBoolean(visible, 'browser visibility'));
    return { success: true };
  });
  safeHandle(IPC_INVOKE_CHANNELS.SWITCH_TAB, (_event, tabId: unknown) => {
    const tab = validateWorkstationTab(tabId);
    EmbeddedBrowserManager.getInstance().setVisible(tab === 'workstation');
    return { success: true, tabId: tab };
  });
  safeHandle(IPC_INVOKE_CHANNELS.BROWSER_GO_BACK, () => {
    EmbeddedBrowserManager.getInstance().goBack();
    return { success: true };
  });
  safeHandle(IPC_INVOKE_CHANNELS.BROWSER_GO_FORWARD, () => {
    EmbeddedBrowserManager.getInstance().goForward();
    return { success: true };
  });
  safeHandle(IPC_INVOKE_CHANNELS.BROWSER_RELOAD, () => {
    EmbeddedBrowserManager.getInstance().reload();
    return { success: true };
  });
  safeHandle(IPC_INVOKE_CHANNELS.BROWSER_LOAD_URL, (_event, url: unknown) => {
    EmbeddedBrowserManager.getInstance().navigate(validateBrowserUrl(url));
    return { success: true };
  });
  safeHandle(IPC_INVOKE_CHANNELS.BROWSER_TOGGLE_FOCUS, () => ({
    isFocusMode: EmbeddedBrowserManager.getInstance().toggleFocusMode(),
  }));
  safeHandle(IPC_INVOKE_CHANNELS.BROWSER_ZOOM_IN, () => ({ zoomFactor: EmbeddedBrowserManager.getInstance().changeZoom(0.1) }));
  safeHandle(IPC_INVOKE_CHANNELS.BROWSER_ZOOM_OUT, () => ({ zoomFactor: EmbeddedBrowserManager.getInstance().changeZoom(-0.1) }));
  safeHandle(IPC_INVOKE_CHANNELS.BROWSER_ZOOM_RESET, () => ({ zoomFactor: EmbeddedBrowserManager.getInstance().resetZoom() }));

  safeHandle(IPC_INVOKE_CHANNELS.SAVE_OVERLAY_POSITION, (_event, position: unknown) => {
    overlayManager.savePosition(validateOverlayPosition(position));
    return { success: true };
  });
  safeHandle(IPC_INVOKE_CHANNELS.GET_OVERLAY_POSITIONS, () => overlayManager.getPositions());
  safeHandle(IPC_INVOKE_CHANNELS.OVERLAY_SAVE_BOUNDS, (_event, position: unknown) => {
    overlayManager.savePosition(validateOverlayPosition(position));
    return { success: true };
  });
  safeHandle(IPC_INVOKE_CHANNELS.OVERLAY_GET_BOUNDS, (_event, panelId?: unknown) => {
    const normalizedPanelId = validateOptionalIdentifier(panelId, 'panelId');
    const all = overlayManager.getPositions();
    return normalizedPanelId ? all.find((item) => item.panelId === normalizedPanelId) || null : all;
  });

  safeHandle(IPC_INVOKE_CHANNELS.GET_SETTINGS, () => {
    const saved = settingsRepo.getAll();
    analysisController.updateSettings(saved);
    return saved;
  });
  safeHandle(IPC_INVOKE_CHANNELS.UPDATE_SETTINGS, (_event, settings: unknown) => {
    settingsRepo.updateAll(validateSettingsPatch(settings));
    const full = settingsRepo.getAll();
    analysisController.updateSettings(full);
    return { success: true };
  });

  safeHandle(IPC_INVOKE_CHANNELS.GET_HISTORY, (_event, query: unknown) =>
    CanonicalDataAccessLayer.getInstance().getJournalEntries(validateHistoryQuery(query)));
  safeHandle(IPC_INVOKE_CHANNELS.GET_PERFORMANCE_STATS, (_event, sessionId?: unknown) =>
    CanonicalDataAccessLayer.getInstance().getPerformanceStats(validateOptionalIdentifier(sessionId, 'sessionId')));
  safeHandle(IPC_INVOKE_CHANNELS.GET_ACTIVE_TRADES, () =>
    TradeLifecycleManager.getInstance().getPanelActiveTrades());

  safeHandle(IPC_INVOKE_CHANNELS.DELETE_TRADE, (_event, id: unknown) => {
    const success = PerformanceEngine.getInstance().deleteTrade(validateIdentifier(id, 'tradeId'));
    analysisController.emitPerformanceRefresh();
    return { success };
  });
  safeHandle(IPC_INVOKE_CHANNELS.DELETE_SELECTED_TRADES, (_event, ids: unknown) => {
    const count = PerformanceEngine.getInstance().deleteSelectedTrades(validateIdentifierArray(ids, 'tradeIds'));
    analysisController.emitPerformanceRefresh();
    return { success: true, count };
  });
  safeHandle(IPC_INVOKE_CHANNELS.CLEAR_TODAY_HISTORY, () => {
    const count = PerformanceEngine.getInstance().clearTodayHistory();
    analysisController.emitPerformanceRefresh();
    return { success: true, count };
  });
  safeHandle(IPC_INVOKE_CHANNELS.CLEAR_SESSION_HISTORY, (_event, sessionId?: unknown) => {
    const explicit = validateOptionalIdentifier(sessionId, 'sessionId');
    const active = analysisController.getActiveSessionId();
    const sid = explicit || active;
    if (!sid) throw new Error('No active or explicit session was supplied.');
    const count = PerformanceEngine.getInstance().clearSessionHistory(sid);
    analysisController.emitPerformanceRefresh();
    return { success: true, count };
  });
  safeHandle(IPC_INVOKE_CHANNELS.CLEAR_ALL_HISTORY, () => {
    const count = PerformanceEngine.getInstance().clearAllHistory();
    analysisController.emitPerformanceRefresh();
    return { success: true, count };
  });
  safeHandle(IPC_INVOKE_CHANNELS.RECORD_MANUAL_TRADE, (_event, input: unknown) => {
    historyRepo.recordManualTrade(validateManualTradeInput(input));
    analysisController.emitPerformanceRefresh();
    return { success: true };
  });

  safeHandle(IPC_INVOKE_CHANNELS.GET_CALIBRATION_HEALTH, () =>
    CalibrationDatasetManager.getInstance().getCalibrationHealth());
  safeHandle(IPC_INVOKE_CHANNELS.GET_CALIBRATION_ANALYSIS, () =>
    analysisController.getCalibrationAnalysis());
  safeHandle(IPC_INVOKE_CHANNELS.GET_CALIBRATION_DATASET, () =>
    CalibrationDatasetManager.getInstance().getCalibrationObservations());

  SelfLearningDatasetManager.getInstance().setDatabase(db);
  safeHandle(IPC_INVOKE_CHANNELS.GET_LEARNING_DATASET_AUDIT, () =>
    SelfLearningDatasetManager.getInstance().getCompleteLearningRecords());
  safeHandle(IPC_INVOKE_CHANNELS.RUN_LEARNING_QUALITY_REPAIR, () =>
    SelfLearningDatasetManager.getInstance().auditAndRepairDataQuality());
  safeHandle(IPC_INVOKE_CHANNELS.GET_MODEL_READINESS_SCORE, () => {
    const ml = MLEngine.getInstance();
    return {
      readiness: ml.getReadiness(),
      sampleSize: ml.getSampleCount(),
      trainedModelLoaded: ml.hasTrainedModel(),
      ...SelfLearningDatasetManager.getInstance().getModelReadinessScore(),
    };
  });
  safeHandle(IPC_INVOKE_CHANNELS.RUN_TRADE_REPLAY_VALIDATION, (_event, tradeId?: unknown) =>
    SelfLearningDatasetManager.getInstance().validateTradeReplay(validateOptionalIdentifier(tradeId, 'tradeId')));
  safeHandle(IPC_INVOKE_CHANNELS.GET_SYSTEM_HEALTH, () => RuntimeHealthMonitor.getInstance().getHealthReport());
  safeHandle(IPC_INVOKE_CHANNELS.GET_ADAPTIVE_LEARNING_SUMMARY, () => {
    SignalVerificationEngine.getInstance().setDatabase(db);
    return SignalVerificationEngine.getInstance().getAdaptiveLearningSummary();
  });
  safeHandle(IPC_INVOKE_CHANNELS.GET_WATCHDOG_LOGS, () => CentralWatchdog.getInstance().getRecoveryLogs());
  safeHandle(IPC_INVOKE_CHANNELS.SEARCH_KNOWLEDGE_BASE, (_event, queryOptions?: unknown) => {
    KnowledgeBaseRepository.getInstance().setDatabase(db);
    return KnowledgeBaseRepository.getInstance().searchKnowledgeBase(validateKnowledgeQuery(queryOptions));
  });
  safeHandle(IPC_INVOKE_CHANNELS.GET_SIGNAL_QUALITY_TRACES, () => {
    SignalQualityInspector.getInstance().setDatabase(db);
    return SignalQualityInspector.getInstance().getAllTraces();
  });
  safeHandle(IPC_INVOKE_CHANNELS.VALIDATE_PIPELINE, (_event, signalId?: unknown, tradeId?: unknown) => {
    PipelineConsistencyValidator.getInstance().setDatabase(db);
    const safeSignalId = signalId === undefined ? 'latest' : validateIdentifier(signalId, 'signalId');
    return PipelineConsistencyValidator.getInstance().validateSignalPipeline(
      safeSignalId,
      validateOptionalIdentifier(tradeId, 'tradeId'),
    );
  });
  safeHandle(IPC_INVOKE_CHANNELS.GET_SELF_TEST_REPORT, () => {
    PipelineConsistencyValidator.getInstance().setDatabase(db);
    return PipelineConsistencyValidator.getInstance().run60SecondSelfTest();
  });

  safeHandle(IPC_INVOKE_CHANNELS.GET_ANALYTICS_REPORT, () => AnalyticsEngine.getInstance().getComprehensiveReport());
  safeHandle(IPC_INVOKE_CHANNELS.RUN_VALIDATION_CHECK, () => AnalyticsEngine.getInstance().validateRuntimeIntegrity());
  safeHandle(IPC_INVOKE_CHANNELS.EXPORT_ANALYTICS_CSV, () => AnalyticsEngine.getInstance().exportCsv());
  safeHandle(IPC_INVOKE_CHANNELS.EXPORT_ANALYTICS_JSON, () => AnalyticsEngine.getInstance().exportJson());

  safeHandle(IPC_INVOKE_CHANNELS.GET_DIAGNOSTICS, () => analysisController.getDeveloperDiagnostics());
  safeHandle(IPC_INVOKE_CHANNELS.TRIGGER_DIAGNOSTIC_CAPTURE, () => analysisController.triggerDiagnosticCapture());
  safeHandle(IPC_INVOKE_CHANNELS.GET_LIVE_DECISION_TRACES, (_event, limit?: unknown) =>
    LiveDecisionTraceEngine.getInstance().getScanTraces(validateLimit(limit, 'trace limit', 500, 20)));
  safeHandle(IPC_INVOKE_CHANNELS.GET_DECISION_CHANGE_LOGS, (_event, limit?: unknown) =>
    LiveDecisionTraceEngine.getInstance().getDecisionChangeLogs(validateLimit(limit, 'change-log limit', 500, 20)));
  safeHandle(IPC_INVOKE_CHANNELS.GET_RUNNING_TRADE_DEBUG, () =>
    LiveDecisionTraceEngine.getInstance().getRunningTradeDebugInfo());
  safeHandle(IPC_INVOKE_CHANNELS.SET_DEBUGGER_ENABLED, (_event, enabled: unknown) => {
    const safeEnabled = validateBoolean(enabled, 'debugger enabled');
    LiveDecisionTraceEngine.getInstance().setEnabled(safeEnabled);
    return { success: true, enabled: safeEnabled };
  });
  safeHandle(IPC_INVOKE_CHANNELS.GET_DEBUGGER_ENABLED, () => ({
    enabled: LiveDecisionTraceEngine.getInstance().getIsEnabled(),
  }));

  const diagnosticsDirectory = path.join(app.getPath('userData'), 'diagnostics');
  const runSavedFrame = (_event: unknown, framePath: unknown) =>
    analysisController.replayFrame(validateSavedFramePath(framePath, diagnosticsDirectory));
  safeHandle(IPC_INVOKE_CHANNELS.RUN_SAVED_FRAME, runSavedFrame);
  safeHandle(IPC_INVOKE_CHANNELS.START_FRAME_REPLAY, runSavedFrame);
  safeHandle(IPC_INVOKE_CHANNELS.START_OBSERVATION_REPLAY, (_event, observation: unknown) =>
    analysisController.replayObservation(validateReplayObservation(observation)));
  safeHandle(IPC_INVOKE_CHANNELS.STOP_REPLAY, () => ({ success: true, stoppedAt: Date.now() }));

  safeHandle(IPC_INVOKE_CHANNELS.GET_DISPLAYS, () => screen.getAllDisplays().map((display) => ({
    id: display.id.toString(),
    label: `Display ${display.id}${display.bounds.x === 0 && display.bounds.y === 0 ? ' (Primary)' : ''}`,
    bounds: display.bounds,
    scaleFactor: display.scaleFactor,
    isPrimary: display.bounds.x === 0 && display.bounds.y === 0,
  })));
  safeHandle(IPC_INVOKE_CHANNELS.SET_TARGET_DISPLAY, (_event, displayId: unknown) => {
    const availableIds = screen.getAllDisplays().map((display) => display.id.toString());
    settingsRepo.set('targetDisplayId', validateDisplayId(displayId, availableIds));
    return { success: true };
  });
  safeHandle(IPC_INVOKE_CHANNELS.EXECUTE_MANUAL_TRADE, (_event, action: unknown) => {
    analysisController.executeManualTrade(validateManualExecution(action));
    return { success: true };
  });
  safeHandle(IPC_INVOKE_CHANNELS.PURGE_HISTORY, (_event, days: unknown) => {
    historyRepo.purgeOlderThan(validatePurgeDays(days));
    return { success: true };
  });
}
