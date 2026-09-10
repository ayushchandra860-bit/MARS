// ============================================================
// MARS PRO V3 — IPC Channel Contracts
// Typed channel names for Main ↔ Renderer IPC.
// All IPC must go through these named channels only.
// ============================================================

/** Channels from Main → Renderer (one-way push) */
export const IPC_CHANNELS = {
  // Overlay
  OVERLAY_STATE_UPDATE: 'mars:overlay:state-update',
  OVERLAY_SHOW: 'mars:overlay:show',
  OVERLAY_HIDE: 'mars:overlay:hide',

  // Control Center
  CONTROL_STATE_UPDATE: 'mars:control:state-update',
  DEVELOPER_DIAGNOSTICS: 'mars:control:developer-diagnostics',

  // Notifications
  NOTIFICATION: 'mars:notification',
  BROWSER_TITLE_UPDATED: 'browser-title-updated',
  PERFORMANCE_REFRESH: 'mars:performance:refresh',
  ACTIVE_TRADES_UPDATE: 'mars:trade:active-update',
} as const;

/** Channels from Renderer → Main (invoke/request) */
export const IPC_INVOKE_CHANNELS = {
  // Window Controls
  MINIMIZE_WINDOW: 'mars:window:minimize',
  MAXIMIZE_WINDOW: 'mars:window:maximize',
  CLOSE_WINDOW: 'mars:window:close',

  // Control Center State Request (Authoritative Initial Fetch)
  GET_CONTROL_STATE: 'mars:control:get-state',

  // Lifecycle
  START_ANALYSIS: 'mars:lifecycle:start',
  STOP_ANALYSIS: 'mars:lifecycle:stop',

  // Overlay management
  TOGGLE_OVERLAY: 'mars:overlay:toggle',
  SAVE_OVERLAY_POSITION: 'mars:overlay:save-position',
  GET_OVERLAY_POSITIONS: 'mars:overlay:get-positions',
  OVERLAY_SAVE_BOUNDS: 'overlay:save-bounds',
  OVERLAY_GET_BOUNDS: 'overlay:get-bounds',

  // Settings
  GET_SETTINGS: 'mars:settings:get',
  UPDATE_SETTINGS: 'mars:settings:update',

  // History
  GET_HISTORY: 'mars:history:get',
  GET_PERFORMANCE_STATS: 'mars:history:performance',
  RECORD_MANUAL_TRADE: 'mars:history:record-manual-trade',
  GET_ACTIVE_TRADES: 'mars:trade:get-active',
  DELETE_TRADE: 'mars:history:delete-trade',
  DELETE_SELECTED_TRADES: 'mars:history:delete-selected',
  CLEAR_TODAY_HISTORY: 'mars:history:clear-today',
  CLEAR_SESSION_HISTORY: 'mars:history:clear-session',
  CLEAR_ALL_HISTORY: 'mars:history:clear-all',

  // Calibration Dataset & Trade Journal (Sprint T3 & T9)
  GET_CALIBRATION_HEALTH: 'mars:calibration:get-health',
  GET_CALIBRATION_DATASET: 'mars:calibration:get-dataset',
  GET_CALIBRATION_ANALYSIS: 'mars:calibration:get-analysis',
  GET_LEARNING_DATASET_AUDIT: 'mars:learning:get-audit',
  RUN_LEARNING_QUALITY_REPAIR: 'mars:learning:run-repair',
  GET_MODEL_READINESS_SCORE: 'mars:learning:get-readiness-score',
  RUN_TRADE_REPLAY_VALIDATION: 'mars:learning:run-replay-validation',

  // Analytics Engine & Decision Intelligence (Sprint T4)
  GET_ANALYTICS_REPORT: 'mars:analytics:get-report',
  GET_DECISION_REPLAY: 'mars:analytics:get-replay',
  RUN_VALIDATION_CHECK: 'mars:analytics:run-validation',
  RUN_AUTO_BUG_DETECTOR: 'mars:analytics:auto-bug-detector',
  EXPORT_ANALYTICS_CSV: 'mars:analytics:export-csv',
  EXPORT_ANALYTICS_JSON: 'mars:analytics:export-json',

  // Developer & Live Decision Trace Debugger (Sprint T7)
  GET_DIAGNOSTICS: 'mars:developer:diagnostics',
  TRIGGER_DIAGNOSTIC_CAPTURE: 'mars:developer:capture',
  RUN_SAVED_FRAME: 'mars:developer:run-saved-frame',
  GET_LIVE_DECISION_TRACES: 'mars:debug:get-decision-traces',
  GET_DECISION_CHANGE_LOGS: 'mars:debug:get-change-logs',
  GET_RUNNING_TRADE_DEBUG: 'mars:debug:get-trade-debug',
  SET_DEBUGGER_ENABLED: 'mars:debug:set-enabled',
  GET_DEBUGGER_ENABLED: 'mars:debug:get-enabled',
  GET_SYSTEM_HEALTH: 'mars:health:get-system-health',
  GET_ADAPTIVE_LEARNING_SUMMARY: 'mars:learning:get-adaptive-summary',
  GET_WATCHDOG_LOGS: 'mars:watchdog:get-logs',
  EXECUTE_MANUAL_TRADE: 'mars:trade:execute',
  PURGE_HISTORY: 'mars:history:purge',
  SEARCH_KNOWLEDGE_BASE: 'mars:knowledge:search',
  GET_SIGNAL_QUALITY_TRACES: 'mars:quality:get-traces',
  VALIDATE_PIPELINE: 'mars:quality:validate-pipeline',
  GET_SELF_TEST_REPORT: 'mars:quality:get-self-test-report',

  // Replay
  START_FRAME_REPLAY: 'mars:replay:start-frame',
  START_OBSERVATION_REPLAY: 'mars:replay:start-observation',
  STOP_REPLAY: 'mars:replay:stop',

  // System
  GET_DISPLAYS: 'mars:system:displays',
  SET_TARGET_DISPLAY: 'mars:system:set-display',
  SWITCH_TAB: 'switch-tab',
  SET_BROWSER_VISIBILITY: 'set-browser-visibility',
  BROWSER_GO_BACK: 'browser:go-back',
  BROWSER_GO_FORWARD: 'browser:go-forward',
  BROWSER_RELOAD: 'browser:reload',
  BROWSER_LOAD_URL: 'browser:load-url',
  BROWSER_TOGGLE_FOCUS: 'browser:toggle-focus',
  BROWSER_ZOOM_IN: 'browser:zoom-in',
  BROWSER_ZOOM_OUT: 'browser:zoom-out',
  BROWSER_ZOOM_RESET: 'browser:zoom-reset',
} as const;

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
export type IpcInvokeChannel = typeof IPC_INVOKE_CHANNELS[keyof typeof IPC_INVOKE_CHANNELS];
