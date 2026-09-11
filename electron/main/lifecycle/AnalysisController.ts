// ============================================================
// MARS PRO V3 â€” Analysis Controller
// Controls active session lifecycle and orchestrates pipeline.
// Signal lifecycle, entry timing, trade tracking, deterioration detection,
// three-sound alerts, non-overlapping scans.
// ============================================================

import { app, BrowserWindow, nativeImage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { LiveScanner } from '../scanner/LiveScanner';
import { DataQualityGate } from '../market/DataQualityGate';
import { FeatureExtractor } from '../market/FeatureExtractor';
import { DecisionEngine } from '../decision/DecisionEngine';
import { SignalStabilizer } from '../decision/SignalStabilizer';
import { ExpiryEngine } from '../decision/ExpiryEngine';
import { DiagnosticsTracker } from '../scanner/ScannerDiagnostics';
import { OverlayManager } from '../overlay/OverlayManager';
import { SessionId } from '../../../shared/types/scanner';
import { AnalysisState, SystemStatus } from '../../../shared/types/session';
import { ScannerStage, StageStatus } from '../../../shared/types/diagnostics';
import { TradingAction, SignalLifecycle, RiskLevel, SignalStatusLabel, TradeStatusLabel, SignalStatusState, TradeStatusState, TradeHealth, TradeExplanation } from '../../../shared/types/decision';
import { MarketRegime, TrendDirection, MomentumLevel, MarketStructure } from '../../../shared/types/market';
import { OverlayState, SignalLifecycleStage, ControlCenterState, DeveloperDiagnostics, AppSettings, DEFAULT_SETTINGS } from '../../../shared/types/ipc';
import { IPC_CHANNELS } from '../../../shared/contracts/ipc-channels';
import { confidenceToWaitScore } from '../../../shared/utils/waitScore';
import { ExpiryPreset } from '../../../shared/types/ipc';
import { Database } from '../database/Database';
import { TradeRepository } from '../database/repositories/TradeRepository';
import { SignalHistoryRepository } from '../database/repositories/SignalHistoryRepository';
import { EnrichedSignalRecord } from '../database/repositories/SignalHistoryRepository';
import { EmbeddedBrowserManager } from '../view/EmbeddedBrowserManager';
import { deriveVerifiedPriceOutcome } from '../trade/verifiedTradeOutcome';

import { MarketIntelEngine } from '../market/MarketIntelEngine';
import { CalibrationDatasetManager } from '../brain/CalibrationDatasetManager';
import { MLEngine } from '../decision/MLEngine';
import { TradeLifecycleManager } from '../trade/TradeLifecycleManager';
import { isValidAssetName, AnalysisMode } from '../../../shared/types/canonical';
import { formatConfidence, formatRisk } from '../../../shared/utils/formatters';

export class AnalysisController {
  private state: AnalysisState = AnalysisState.STOPPED;
  private activeSessionId: SessionId | null = null;
  private scanTimer: NodeJS.Timeout | null = null;
  private isScanningActive = false;

  private scanner: LiveScanner;
  private qualityGate: DataQualityGate;
  private featureExtractor: FeatureExtractor;
  private decisionEngine: DecisionEngine;
  private stabilizer: SignalStabilizer;
  private expiryEngine: ExpiryEngine;
  private marketIntelEngine: MarketIntelEngine;
  private overlayManager: OverlayManager;
  private tradeRepo: TradeRepository | null = null;
  private historyRepo: SignalHistoryRepository | null = null;
  private mainWindow: BrowserWindow | null = null;

  private decisionsProduced = 0;
  private framesProcessed = 0;
  private pipelineErrorCount = 0;
  private lastOverlayState: OverlayState | null = null;
  private lastControlState: ControlCenterState | null = null;
  private latestDiagnosticsReport: any = null;
  private currentSettings: AppSettings = { ...DEFAULT_SETTINGS };
  private lastObservationWithFeatures: any = null;

  // Active signal tracking (broader than a trade â€” covers the signal lifecycle)
  private activeSignal: {
    action: TradingAction;
    confirmedAt: number;
    expiryLabel: string;
    expirySec: number | null;
    originalReasons: string[];
    originalConfidence: number;
    regime: MarketRegime;
    asset: string | null;
    invalidated: boolean;
    signalId: string;
  } | null = null;

  // Entry timing: genuine countdown based on market analysis
  private entryWindowStart: number | null = null;
  private entryWindowDurationMs: number = 0;
  private entryIsValid: boolean = false;

  // Deterioration tracking for active trade sound
  private lastDeteriorationSoundTime: number = 0;
  private static readonly DETERIORATION_SOUND_COOLDOWN_MS = 15000;

  // Audio deduplication (per signal type)
  private lastAlertedBuyTime: number = 0;
  private lastAlertedSellTime: number = 0;
  private static readonly AUDIO_COOLDOWN_MS = 5000;

  // IPC throttle
  private lastOverlaySendTime: number = 0;
  private static readonly OVERLAY_THROTTLE_MS = 200;

  // Signal history & grace period tracking
  private totalConfirmedSignals: number = 0;
  private consecutiveInvalidationScans: number = 0;

  // Phase B.2 Execution Quality Refinement state
  private currentTradeHealth: TradeHealth = TradeHealth.HEALTHY;
  private healthyRecoveryScanCount: number = 0;
  private degradedEntryScanCount: number = 0;
  private smoothedConfidence: number | null = null;
  private lastObservedRegime: any = null;
  private lastObservedTrend: any = null;
  private lastTradeStatusState: TradeStatusState = 'NO TRADE';
  private latestTradeExplanation: TradeExplanation | null = null;

  constructor(overlayManager: OverlayManager, mainWindow: BrowserWindow | null = null, database?: Database) {
    this.scanner = new LiveScanner();
    this.qualityGate = new DataQualityGate();
    this.featureExtractor = new FeatureExtractor();
    this.decisionEngine = new DecisionEngine();
    this.stabilizer = new SignalStabilizer();
    this.expiryEngine = new ExpiryEngine();
    this.marketIntelEngine = new MarketIntelEngine();
    this.overlayManager = overlayManager;
    this.mainWindow = mainWindow;
    EmbeddedBrowserManager.getInstance().setTradeClickHandler((event) => {
      this.handleDetectedTradeClick(event);
    });


    if (database) {
      this.tradeRepo = new TradeRepository(database);
      this.historyRepo = new SignalHistoryRepository(database);

      // Initialize ML Engine persistence
      const dbDir = require('path').dirname(database.getDbPath());
      if (dbDir) {
        MLEngine.getInstance().setPersistencePath(dbDir);
      }

      // Initialize CalibrationDatasetManager with DB connection
      const calibrationManager = CalibrationDatasetManager.getInstance();
      calibrationManager.setDatabase(database);

      // Reconcile model state with the authoritative bounded trade history.
      // This covers a fresh install, deleted/corrupt model file, and upgrades
      // from the old 500-tail learner without allowing stale state to win.
      const ml = MLEngine.getInstance();
      const historicalExamples = calibrationManager.getLabeledFeatureExamples();
      if (historicalExamples.length > 0 && ml.getSampleCount() < historicalExamples.length) {
        ml.hydrateFromCompletedTrades(historicalExamples);
      }
    }
  }

  public getState(): AnalysisState {
    return this.state;
  }

  public getActiveSessionId(): SessionId | null {
    return this.activeSessionId;
  }

  public updateSettings(settings: AppSettings): void {
    const supportedExpiries: ExpiryPreset[] = ['auto', '30s', '45s', '1m', '2m', '3m', '4m', '5m'];
    const enabledExpiries = (settings.enabledExpiries || DEFAULT_SETTINGS.enabledExpiries)
      .filter((expiry): expiry is ExpiryPreset => supportedExpiries.includes(expiry as ExpiryPreset));
    const calibrationMode = settings.calibrationMode || DEFAULT_SETTINGS.calibrationMode;
    const minConfidenceToAlert = Math.max(1, Math.min(100, Number(settings.minConfidenceToAlert || DEFAULT_SETTINGS.minConfidenceToAlert)));

    this.currentSettings = {
      ...settings,
      enabledExpiries: enabledExpiries.length > 0 ? enabledExpiries : DEFAULT_SETTINGS.enabledExpiries,
      expiryOverride: supportedExpiries.includes(settings.expiryOverride as ExpiryPreset)
        ? settings.expiryOverride
        : DEFAULT_SETTINGS.expiryOverride,
      calibrationMode,
      minConfidenceToAlert,
      scanIntervalMs: Math.max(500, Math.min(5000, Number(settings.scanIntervalMs || DEFAULT_SETTINGS.scanIntervalMs))),
    };

    this.decisionEngine.setCalibrationMode(calibrationMode);
    this.stabilizer.setCalibrationMode(calibrationMode);
  }

  public getSettings(): AppSettings {
    return { ...this.currentSettings };
  }

  public start(): { success: boolean; error?: string } {
    if (this.state === AnalysisState.RUNNING) {
      return { success: true };
    }

    this.state = AnalysisState.STARTING;
    this.activeSessionId = `session-${Date.now()}`;
    this.state = AnalysisState.RUNNING;

    this.overlayManager.show();
    this.emitPipelineStatus(SystemStatus.SCANNING, 'Waiting for the first live market observation.');

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.CONTROL_STATE_UPDATE, this.getControlCenterState());
    }

    const interval = this.currentSettings.scanIntervalMs || 900;
    this.startScanLoop(interval);
    return { success: true };
  }

  public stop(): { success: boolean } {
    this.state = AnalysisState.STOPPING;
    this.stopScanLoop();
    try {
      this.scanner.terminate().catch(() => {});
    } catch {}
    this.scanner.clearCache();
    this.stabilizer.reset();
    this.activeSessionId = null;
    this.lastOverlayState = null;
    this.latestDiagnosticsReport = null;
    this.decisionsProduced = 0;
    this.framesProcessed = 0;
    this.isScanningActive = false;
    this.activeSignal = null;
    this.entryWindowStart = null;
    this.entryIsValid = false;
    this.lastAlertedBuyTime = 0;
    this.lastAlertedSellTime = 0;
    this.lastDeteriorationSoundTime = 0;
    this.state = AnalysisState.STOPPED;

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.CONTROL_STATE_UPDATE, this.getControlCenterState());
    }

    return { success: true };
  }

  // ----------------------------------------------------------
  // Scan Loop
  // ----------------------------------------------------------

  private startScanLoop(intervalMs: number): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
    }
    this.scanTimer = setInterval(() => {
      this.runScanCycle().catch((err) => {
        console.error('[MARS] Unhandled scan cycle error:', err);
      });
    }, intervalMs);
  }

  private stopScanLoop(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  private async runScanCycle(): Promise<void> {
    if (this.isScanningActive || this.state !== AnalysisState.RUNNING) return;
    this.isScanningActive = true;
    this.framesProcessed++;

    try {
      const scanResult = await this.scanner.scan();
      this.latestDiagnosticsReport = scanResult?.diagnostics || this.latestDiagnosticsReport;
      if (!scanResult) {
        // Expiry resolution must not depend on a fresh scanner frame.
        this.updateTradeLifecycle(null);
        this.emitPipelineStatus(SystemStatus.DEGRADED, 'Scanner did not return a result. Retrying live capture.');
        return;
      }

      const scanResultObservation = scanResult.observation;
      if (!scanResultObservation) {
        // Preserve existing active-trade lifecycle even while OCR/observation is unavailable.
        this.updateTradeLifecycle(null);
        const failedStage = scanResult.diagnostics?.firstFailedStage || 'OBSERVATION';
        this.emitPipelineStatus(
          SystemStatus.DEGRADED,
          `Live observation unavailable at ${failedStage}. Retrying capture.`,
        );
        return;
      }

      const qualityCheck = this.qualityGate.evaluate(scanResultObservation, true);
      if (!qualityCheck.passed) {
        // A rejected observation cannot create a signal, but existing trades
        // still need expiry processing and the UI must show a real WAIT state.
        this.updateTradeLifecycle(scanResultObservation);
        this.emitPipelineStatus(
          SystemStatus.DEGRADED,
          `Live data warming or rejected: ${qualityCheck.reason || 'quality gate failed'}.`,
          scanResultObservation,
        );
        return;
      }

      const features = this.featureExtractor.extract(scanResultObservation);
      const observationWithFeatures = { ...scanResultObservation, ...features };
      this.lastObservationWithFeatures = observationWithFeatures;

      const enabledExpiries = this.currentSettings.enabledExpiries || ['auto'];
      const currentStableAction = this.activeSignal && !this.activeSignal.invalidated
        ? this.activeSignal.action
        : TradingAction.WAIT;
      const rawDecision = this.decisionEngine.decide(observationWithFeatures, enabledExpiries, currentStableAction);
      this.latestDiagnosticsReport = {
        ...(scanResult.diagnostics || {}),
        rawDecision: rawDecision.action,
        dataQuality: observationWithFeatures.dataQuality,
        timestamp: Date.now(),
      };

      const smoothedState = this.stabilizer.smoothMarketState(
        observationWithFeatures.trendEvidence?.direction || null,
        rawDecision.marketBias,
        observationWithFeatures.momentumEvidence?.level || null
      );

      const stabilized = this.stabilizer.stabilize(rawDecision);
      this.stabilizer.updateLifecycle();
      this.decisionsProduced++;

      // Compute entry timing
      this.updateEntryTiming(stabilized, observationWithFeatures);

      // Track active signal
      this.updateActiveSignal(stabilized, observationWithFeatures);

      // Evaluate active trade deterioration with backend feature evidence
      const deterioration = this.evaluateDeterioration(stabilized, observationWithFeatures);

      // Update active trade lifecycle (check for expiry)
      this.updateTradeLifecycle(observationWithFeatures);

      // Record signal in history
      this.recordSignal(stabilized, observationWithFeatures);

      // Build overlay state and emit
      this.emitOverlayState(stabilized, observationWithFeatures, deterioration);

      // Audio alerts (with per-sound-type deduplication)
      this.emitAudioAlert(stabilized, deterioration);

    } catch (err) {
      this.pipelineErrorCount++;
      const message = err instanceof Error ? err.message : String(err);
      console.error('[MARS] Scan cycle error:', err);
      this.emitPipelineStatus(SystemStatus.DEGRADED, `Live analysis error: ${message}`);
    } finally {
      this.isScanningActive = false;
    }
  }

  // ----------------------------------------------------------
  // Entry Timing â€” dynamic evidence alignment with stability filter (Regression Fix 5)
  // ----------------------------------------------------------

  private updateEntryTiming(stabilized: any, observation: any): void {
    const action = stabilized.action;

    if (action === TradingAction.WAIT) {
      this.entryIsValid = false;
      this.degradedEntryScanCount = 0;
      return;
    }

    const rawScore = this.calculateTradeHealthScore(stabilized, observation);
    const evidenceHealthy = rawScore >= 60;

    if (evidenceHealthy) {
      this.degradedEntryScanCount = 0;
      this.entryIsValid = true;
    } else {
      // Require 2 consecutive degraded scans before closing an open Entry Window (Fix 5 stability filter)
      this.degradedEntryScanCount++;
      if (this.degradedEntryScanCount >= 2) {
        this.entryIsValid = false;
      }
    }
  }

  public computeEntryGuidance(): string {
    if (!this.activeSignal || this.activeSignal.invalidated || this.activeSignal.action === TradingAction.WAIT) return 'WAIT';
    return this.entryIsValid ? 'ENTRY NOW' : 'WAIT';
  }

  public computeEntryCountdown(): number | null {
    return null; // Dynamic evidence alignment, no artificial timer
  }

  // ----------------------------------------------------------
  // Phase B.2 Execution Quality Algorithms
  // ----------------------------------------------------------

  /**
   * Regression Fix 3: Internal TradeHealth numerical scoring (0 - 100)
   * Derived 100% strictly from backend evidence.
   */
  public calculateTradeHealthScore(stabilized: any, observation?: any): number {
    if (!this.activeSignal || this.activeSignal.invalidated) return 0;

    const signalAction = this.activeSignal.action;
    const currentAction = stabilized.action;
    let score = 100;

    // 1. Trend alignment (-30 if opposing, -15 if neutral)
    const liveTrend = observation?.trendEvidence?.direction;
    if ((signalAction === TradingAction.BUY && liveTrend === TrendDirection.BEARISH) ||
        (signalAction === TradingAction.SELL && liveTrend === TrendDirection.BULLISH) ||
        (currentAction !== TradingAction.WAIT && currentAction !== signalAction)) {
      score -= 30;
    } else if (liveTrend === TrendDirection.NEUTRAL) {
      score -= 15;
    }

    // 2. Momentum strength (-20 if WEAK, -10 if MODERATE)
    const momentum = observation?.momentumEvidence;
    if (momentum?.level === MomentumLevel.WEAK) {
      score -= 20;
    } else if (momentum?.level === MomentumLevel.MODERATE) {
      score -= 10;
    }

    // 3. Structure breakdown (-20 if opposing structure)
    const struct = observation?.structureEvidence?.structure;
    if ((signalAction === TradingAction.BUY && (struct === MarketStructure.DOWNTREND || struct === MarketStructure.BREAKOUT_DOWN)) ||
        (signalAction === TradingAction.SELL && (struct === MarketStructure.UPTREND || struct === MarketStructure.BREAKOUT_UP))) {
      score -= 20;
    }

    // 4. Risk escalation (-15 if HIGH risk in volatile/choppy market, -5 if MEDIUM)
    const regime = observation?.marketRegime;
    if (stabilized.risk === RiskLevel.HIGH && (regime === MarketRegime.HIGH_VOLATILITY || regime === MarketRegime.CHOPPY)) {
      score -= 15;
    } else if (stabilized.risk === RiskLevel.MEDIUM) {
      score -= 5;
    }

    // 5. Evidence agreement (-15 if agreementScore < 0.35)
    const agreement = observation?.evidenceBreakdown?.agreementScore ?? 0.0;
    if (agreement < 0.35) {
      score -= 15;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Regression Fix 1 & 4: Gradual step-by-step trade recovery and integrity verification
   * Prevents direct CRITICAL -> HEALTHY jumps. INVALID state is terminal.
   */
  private updateTradeHealthState(rawScore: number): TradeHealth {
    if (this.currentTradeHealth === TradeHealth.INVALID) {
      return TradeHealth.INVALID; // Terminal!
    }

    // Immediate state degradation on evidence breakdown
    if (rawScore < 40) {
      this.currentTradeHealth = TradeHealth.INVALID;
      this.healthyRecoveryScanCount = 0;
      return TradeHealth.INVALID;
    }

    if (this.currentTradeHealth === TradeHealth.HEALTHY && rawScore < 60) {
      this.currentTradeHealth = TradeHealth.WEAKENING;
      this.healthyRecoveryScanCount = 0;
      return TradeHealth.WEAKENING;
    }

    if (this.currentTradeHealth === TradeHealth.WEAKENING && rawScore < 40) {
      this.currentTradeHealth = TradeHealth.CRITICAL;
      this.healthyRecoveryScanCount = 0;
      return TradeHealth.CRITICAL;
    }

    if (this.currentTradeHealth === TradeHealth.HEALTHY && rawScore < 80) {
      this.currentTradeHealth = TradeHealth.WEAKENING;
      this.healthyRecoveryScanCount = 0;
      return TradeHealth.WEAKENING;
    }

    // Step-by-step gradual recovery requiring 2 consecutive healthy scans per step
    if (this.currentTradeHealth === TradeHealth.CRITICAL && rawScore >= 60) {
      this.healthyRecoveryScanCount++;
      if (this.healthyRecoveryScanCount >= 2) {
        this.currentTradeHealth = TradeHealth.WEAKENING; // Step up to WEAKENING first!
        this.healthyRecoveryScanCount = 0;
      }
      return this.currentTradeHealth;
    }

    if (this.currentTradeHealth === TradeHealth.WEAKENING && rawScore >= 80) {
      this.healthyRecoveryScanCount++;
      if (this.healthyRecoveryScanCount >= 2) {
        this.currentTradeHealth = TradeHealth.HEALTHY; // Step up to HEALTHY!
        this.healthyRecoveryScanCount = 0;
      }
      return this.currentTradeHealth;
    }

    // Reset recovery counter if score drops back down
    if (this.currentTradeHealth === TradeHealth.CRITICAL && rawScore < 60) {
      this.healthyRecoveryScanCount = 0;
    } else if (this.currentTradeHealth === TradeHealth.WEAKENING && rawScore < 80 && rawScore >= 60) {
      this.healthyRecoveryScanCount = 0;
    }

    return this.currentTradeHealth;
  }

  /**
   * Regression Fix 2: Confidence Hysteresis Smoothing
   * Suppresses single-scan noise while adapting immediately to multi-pillar structural shifts.
   */
  public smoothConfidence(rawConfidence: number, observation?: any): number {
    rawConfidence = this.normalizeConfidencePercent(rawConfidence);

    if (this.smoothedConfidence === null) {
      this.smoothedConfidence = rawConfidence;
      return rawConfidence;
    }

    const regimeChanged = observation?.marketRegime && this.lastObservedRegime !== observation.marketRegime;
    const trendChanged = observation?.trendEvidence?.direction && this.lastObservedTrend !== observation.trendEvidence.direction;
    this.lastObservedRegime = observation?.marketRegime || null;
    this.lastObservedTrend = observation?.trendEvidence?.direction || null;

    // Rate-of-Change Slew Limiter: Smoothly glides confidence up and down in real-time with trend
    // Max delta per scan (~900ms): 5% for gradual momentum, 8% on regime/trend shift
    // Eliminates erratic jumping ("ek baar me zameen pe, ek baar me aasmaan me")
    const maxDelta = (regimeChanged || trendChanged) ? 8 : 5;
    const diff = rawConfidence - this.smoothedConfidence;

    if (Math.abs(diff) <= maxDelta) {
      this.smoothedConfidence = rawConfidence;
    } else {
      this.smoothedConfidence += Math.sign(diff) * maxDelta;
    }

    return Math.max(1, Math.min(100, Math.round(this.smoothedConfidence)));
  }

  private normalizeConfidencePercent(value: unknown): number {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return 0;
    const percent = numeric <= 1 ? numeric * 100 : numeric;
    return Math.max(1, Math.min(100, Math.round(percent)));
  }

  private normalizeConfidenceRatio(value: unknown): number {
    return this.normalizeConfidencePercent(value) / 100;
  }

  private isValidAssetName(asset: unknown): asset is string {
    const text = String(asset || '').trim();
    return text.length > 1 && !['▲', '▼', 'UNKNOWN'].includes(text.toUpperCase());
  }

  private getLatestObservedPrice(observation?: any): number | null {
    const candidates = [
      observation?.currentPrice,
      this.lastOverlayState?.currentPrice,
    ];

    for (const candidate of candidates) {
      const numeric = typeof candidate === 'number' ? candidate : Number(String(candidate || '').replace(/,/g, ''));
      if (Number.isFinite(numeric) && numeric > 0) return numeric;
    }

    return null;
  }

  /**
   * Regression Fix 6: Backend-only TradeExplanation object
   */
  public generateTradeExplanation(stabilized: any, observation?: any): TradeExplanation {
    return {
      trend: observation?.trendEvidence?.direction || 'NEUTRAL',
      momentum: observation?.momentumEvidence?.level || 'MODERATE',
      structure: observation?.structureEvidence?.structure || 'INSUFFICIENT_DATA',
      risk: stabilized.risk,
      support: observation?.supportLevel ? `${observation.supportLevel.distancePts} PTS BELOW` : 'UNKNOWN',
      resistance: observation?.resistanceLevel ? `${observation.resistanceLevel.distancePts} PTS ABOVE` : 'UNKNOWN',
    };
  }

  /**
   * Regression Fix 7: Deterministic Lifecycle State Machine Guard
   */
  public isValidLifecycleTransition(fromState: TradeStatusState, toState: TradeStatusState): boolean {
    if (fromState === toState) return true;

    // Terminal states cannot transition to active states
    if (fromState === 'TRADE INVALIDATED' && toState !== 'NO TRADE') return false;
    if (fromState === 'TRADE COMPLETED' && toState !== 'NO TRADE') return false;

    // Forbidden jumps
    if (fromState === 'ENTRY WINDOW' && toState === 'TRADE COMPLETED') return false;

    const validTransitions: Record<TradeStatusState, TradeStatusState[]> = {
      'NO TRADE': ['ENTRY WINDOW', 'TRADE ACTIVE'],
      'ENTRY WINDOW': ['TRADE ACTIVE', 'TRADE INVALIDATED', 'NO TRADE'],
      'TRADE ACTIVE': ['TRADE COMPLETED', 'TRADE INVALIDATED'],
      'TRADE INVALIDATED': ['NO TRADE'],
      'TRADE COMPLETED': ['NO TRADE'],
    };

    return validTransitions[fromState]?.includes(toState) ?? false;
  }

  // ----------------------------------------------------------
  // Active Signal & Trade Lifecycle
  // ----------------------------------------------------------

  private updateActiveSignal(stabilized: any, observation: any): void {
    const now = Date.now();
    if (!stabilized || stabilized.action === TradingAction.WAIT) {
      if (this.activeSignal && !this.activeSignal.invalidated) {
        // Check if the signal has expired
        if (this.activeSignal.expirySec && (now - this.activeSignal.confirmedAt) > this.activeSignal.expirySec * 1000) {
          this.activeSignal.invalidated = true;
          this.entryWindowStart = null;
          this.entryIsValid = false;
        }
      }
      return;
    }

    // New signal or direction change
    if (!this.activeSignal || this.activeSignal.action !== stabilized.action || this.activeSignal.invalidated) {
      const expirySec = ExpiryEngine.labelToSeconds(stabilized.recommendedExpiry);
      this.activeSignal = {
        action: stabilized.action,
        confirmedAt: now,
        expiryLabel: stabilized.recommendedExpiry || '1 min',
        expirySec,
        originalReasons: [...(stabilized.reasons || [])],
        originalConfidence: stabilized.confidence,
        regime: observation.marketRegime || MarketRegime.UNKNOWN,
        asset: observation.asset,
        invalidated: false,
        signalId: `signal-${now}`,
      };
      this.totalConfirmedSignals++;
      this.currentTradeHealth = TradeHealth.HEALTHY;
      this.healthyRecoveryScanCount = 0;
    }
  }

  private evaluateTradeHealth(stabilized: any, observation?: any): TradeHealth {
    const score = this.calculateTradeHealthScore(stabilized, observation);
    return this.updateTradeHealthState(score);
  }

  private evaluateDeterioration(stabilized: any, observation?: any): 'STABLE' | 'DETERIORATING' | 'AGAINST_THESIS' {
    const health = this.evaluateTradeHealth(stabilized, observation);

    if (health === TradeHealth.INVALID) {
      return 'AGAINST_THESIS';
    }

    if (health === TradeHealth.CRITICAL) {
      this.consecutiveInvalidationScans++;
      if (this.consecutiveInvalidationScans >= 2) {
        this.currentTradeHealth = TradeHealth.INVALID;
        return 'AGAINST_THESIS';
      }
      return 'DETERIORATING';
    }

    this.consecutiveInvalidationScans = 0;

    if (health === TradeHealth.WEAKENING) {
      return 'DETERIORATING';
    }

    return 'STABLE';
  }

  private updateTradeLifecycle(observation: any): void {
    const manager = TradeLifecycleManager.getInstance();
    const activeTrades = manager.getActiveTrades();
    if (activeTrades.length === 0) return;

    const now = Date.now();
    let anyResolved = false;
    for (const trade of activeTrades) {
      if (trade.expiryTimestamp > now) continue;
      manager.handleTradeExpiry(trade.id);
      const verified = deriveVerifiedPriceOutcome(trade, observation);
      if (!verified) continue;
      if (manager.resolveTradeOutcome(trade.id, verified.outcome, verified.completionPrice)) {
        anyResolved = true;
      }
    }
    if (anyResolved) this.emitPerformanceRefresh();
  }

  private createTrackedTrade(stabilized: any, observation: any): void {
    if (!this.activeSessionId || !this.activeSignal) return;
    if (!isValidAssetName(this.activeSignal.asset)) return;

    const expirySec = this.activeSignal.expirySec || 60;
    const entryPrice = this.getLatestObservedPrice(observation);
    if (!entryPrice) return;

    TradeLifecycleManager.getInstance().registerTrade({
      sessionId: this.activeSessionId,
      signalId: this.activeSignal.signalId,
      asset: this.activeSignal.asset,
      direction: this.activeSignal.action,
      expirySeconds: expirySec,
      confidence: this.activeSignal.originalConfidence ?? null,
      entryPrice: entryPrice.toString(),
      reasons: this.activeSignal.originalReasons,
      timeframe: observation?.timeframe || '1m',
      regime: this.activeSignal.regime,
      mlFeatures: MLEngine.getInstance().extractFeatures(observation || {}),
    });

    this.emitPerformanceRefresh();
  }

  private buildActiveTradeContext(deterioration?: string, observation?: any) {
    const now = Date.now();
    const activeTrades = TradeLifecycleManager.getInstance().getActiveTrades();

    // 1. Prioritize any active executed trade from TradeLifecycleManager
    // When multiple trades are running on this asset, track the LATEST active trade so new 1m trades aren't overshadowed by old expiring trades
    const matchingTrades = activeTrades.filter((t) =>
      (this.activeSignal?.signalId && t.signalId === this.activeSignal?.signalId) ||
      (observation?.asset && t.asset?.toUpperCase() === String(observation.asset).toUpperCase())
    );
    const activeTrade = matchingTrades.length > 0
      ? matchingTrades[matchingTrades.length - 1]
      : (activeTrades.length > 0 ? activeTrades[activeTrades.length - 1] : null);

    if (activeTrade) {
      const remaining = Math.max(0, Math.ceil((activeTrade.expiryTimestamp - now) / 1000));
      const health = this.evaluateTradeHealth({ action: activeTrade.direction }, observation);
      this.latestTradeExplanation = this.generateTradeExplanation(this.lastOverlayState || {}, observation);

      let status: 'STABLE' | 'DETERIORATING' | 'AGAINST_THESIS' = 'STABLE';
      let proposedTradeStatus: TradeStatusState = remaining > 0 ? 'TRADE ACTIVE' : 'TRADE COMPLETED';

      if (deterioration === 'AGAINST_THESIS' || health === TradeHealth.INVALID) {
        status = 'AGAINST_THESIS';
        proposedTradeStatus = 'TRADE INVALIDATED';
      } else if (remaining > 0 && (deterioration === 'DETERIORATING' || health === TradeHealth.CRITICAL || health === TradeHealth.WEAKENING)) {
        status = 'DETERIORATING';
        proposedTradeStatus = 'TRADE ACTIVE';
      } else if (remaining === 0) {
        proposedTradeStatus = 'TRADE COMPLETED';
      }

      this.lastTradeStatusState = proposedTradeStatus;

      return {
        signalId: activeTrade.signalId || `trade-${activeTrade.id}`,
        originalAction: activeTrade.direction,
        originalConfidence: activeTrade.confidence ?? 0,
        entryTimestamp: activeTrade.entryTimestamp,
        recommendedExpiry: activeTrade.expiryLabel || '1 min',
        remainingSeconds: remaining,
        status,
        tradeStatus: proposedTradeStatus,
        tradeHealth: health,
        reason: activeTrade.reasons?.[0] || 'Active trade running',
      };
    }

    // 2. If no executed trade is active, check for an actionable signal entry window
    if (!this.activeSignal || this.activeSignal.action === TradingAction.WAIT || this.activeSignal.invalidated) {
      return null;
    }

    const health = this.evaluateTradeHealth(
      this.lastOverlayState?.decision ? { action: this.lastOverlayState.decision } : { action: this.activeSignal.action },
      observation
    );
    this.latestTradeExplanation = this.generateTradeExplanation(this.lastOverlayState || {}, observation);

    let status: 'STABLE' | 'DETERIORATING' | 'AGAINST_THESIS' = 'STABLE';
    let proposedTradeStatus: TradeStatusState = this.entryIsValid ? 'ENTRY WINDOW' : 'NO TRADE';

    if (deterioration === 'AGAINST_THESIS' || this.activeSignal.invalidated || health === TradeHealth.INVALID) {
      status = 'AGAINST_THESIS';
      proposedTradeStatus = 'TRADE INVALIDATED';
    }

    if (this.isValidLifecycleTransition(this.lastTradeStatusState, proposedTradeStatus)) {
      this.lastTradeStatusState = proposedTradeStatus;
    }

    return {
      signalId: this.activeSignal.signalId,
      originalAction: this.activeSignal.action,
      originalConfidence: this.activeSignal.originalConfidence,
      entryTimestamp: this.activeSignal.confirmedAt,
      recommendedExpiry: this.activeSignal.expiryLabel,
      remainingSeconds: null,
      status,
      tradeStatus: this.lastTradeStatusState,
      tradeHealth: health,
      reason: this.activeSignal.originalReasons[0] || 'Active trade context',
    };
  }

  // ----------------------------------------------------------
  // Signal History Recording
  // ----------------------------------------------------------

  private recordSignal(stabilized: any, observation: any): void {
    if (!this.historyRepo || !this.activeSessionId) return;

    // Only record actionable BUY/SELL signals to history.
    // WAIT signals are the vast majority of scan cycles and recording them
    // causes massive DB bloat with no analytical value.
    if (stabilized.action === TradingAction.WAIT) return;

    // Use the activeSignal signalId as the record ID so tracked_trades.signal_id
    // matches signal_history.id â€” this fixes the calibration JOIN that was broken
    // because signal_history used 'record-{ts}-{frame}' while tracked_trades used
    // 'signal-{ts}', and the JOIN ON s.id = t.signal_id never matched.
    const signalRecordId = this.activeSignal?.signalId || `record-${Date.now()}-${this.framesProcessed}`;
    const record: EnrichedSignalRecord = {
      id: signalRecordId,
      sessionId: this.activeSessionId,
      frameId: `frame-${this.framesProcessed}`,
      timestamp: Date.now(),
      asset: observation?.asset || null,
      timeframe: observation?.timeframe || null,
      rawDecision: stabilized.action,
      stabilizedDecision: stabilized.action,
      rawReason: stabilized.reason || '',
      stabilizedReason: stabilized.reason || '',
      signalStrength: stabilized.signalStrength || 0,
      risk: stabilized.risk,
      dataQuality: stabilized.dataQuality || 'UNKNOWN' as any,
      marketBias: stabilized.marketBias || 'NEUTRAL' as any,
      recommendedExpiry: stabilized.recommendedExpiry || null,
      outcome: null,
      confidence: this.normalizeConfidencePercent(stabilized.confidence),
      marketRegime: observation?.marketRegime || null,
      evidenceSummary: JSON.stringify({
        reasons: stabilized.reasons,
        strength: stabilized.signalStrength,
      }),
      marketState: JSON.stringify({
        trend: observation?.trendEvidence?.direction,
        momentum: observation?.momentumEvidence?.level,
        volatility: observation?.volatilityEvidence?.level,
      }),
      entryContext: JSON.stringify({
        entryGuidance: this.computeEntryGuidance(),
        entryCountdown: this.computeEntryCountdown(),
      }),
    };

    this.historyRepo.recordEnriched(record);

    // Signal history is intentionally separate from trade execution.
    // A trade is created only when the user clicks UP/DOWN on the embedded
    // platform and the click can be linked to a valid live signal.
  }

  // ----------------------------------------------------------
  // Audio Alerts â€” three distinct sounds with per-type deduplication
  // ----------------------------------------------------------

  private shouldPlayBuyAlert(): boolean {
    if (!this.currentSettings.soundEnabled || !this.currentSettings.soundBuyEnabled) return false;
    const now = Date.now();
    if (now - this.lastAlertedBuyTime < AnalysisController.AUDIO_COOLDOWN_MS) return false;
    this.lastAlertedBuyTime = now;
    return true;
  }

  private shouldPlaySellAlert(): boolean {
    if (!this.currentSettings.soundEnabled || !this.currentSettings.soundSellEnabled) return false;
    const now = Date.now();
    if (now - this.lastAlertedSellTime < AnalysisController.AUDIO_COOLDOWN_MS) return false;
    this.lastAlertedSellTime = now;
    return true;
  }

  private shouldPlayDeteriorationAlert(): boolean {
    if (!this.currentSettings.soundEnabled || !this.currentSettings.soundDeteriorationEnabled) return false;
    const now = Date.now();
    if (now - this.lastDeteriorationSoundTime < AnalysisController.DETERIORATION_SOUND_COOLDOWN_MS) return false;
    this.lastDeteriorationSoundTime = now;
    return true;
  }

  private emitAudioAlert(stabilized: any, deterioration: string): void {
    if (!stabilized) return;

    // Deterioration warning sound
    if (deterioration === 'DETERIORATING' || deterioration === 'AGAINST_THESIS') {
      if (this.shouldPlayDeteriorationAlert()) {
        this.sendSoundToOverlay('DETERIORATION');
      }
    }

    // Only play BUY/SELL sounds for genuinely new actionable signals
    if (stabilized.action === TradingAction.BUY && !stabilized.wasStabilized) {
      if (this.shouldPlayBuyAlert()) {
        this.sendSoundToOverlay('BUY');
      }
    } else if (stabilized.action === TradingAction.SELL && !stabilized.wasStabilized) {
      if (this.shouldPlaySellAlert()) {
        this.sendSoundToOverlay('SELL');
      }
    }
  }

  private sendSoundToOverlay(type: 'BUY' | 'SELL' | 'DETERIORATION'): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.OVERLAY_STATE_UPDATE, {
        soundAlertType: type,
        soundAlert: true,
      });
    }
  }

    // ----------------------------------------------------------
  // Overlay State Emission
  // ----------------------------------------------------------

  /**
   * Publish an explicit live status whenever scanning is warming, rejected,
   * or temporarily unavailable. This prevents the renderer from mistaking
   * an absent update for a real WAIT/50-50 decision.
   */
  private emitPipelineStatus(
    systemStatus: SystemStatus,
    reason: string,
    observation?: any,
  ): void {
    const now = Date.now();
    const intel = this.marketIntelEngine.evaluate({
      observation: observation || null,
      decision: null,
    });
    const activeTrades = TradeLifecycleManager.getInstance().getActiveTrades();
    const matchingTrades = activeTrades.filter((t) =>
      observation?.asset && t.asset?.toUpperCase() === String(observation.asset).toUpperCase()
    );
    const activeTrade = matchingTrades.length > 0
      ? matchingTrades[matchingTrades.length - 1]
      : (activeTrades.length > 0 ? activeTrades[activeTrades.length - 1] : null);

    let activeTradeContext = this.lastOverlayState?.activeTradeContext || null;
    let effectiveTradeStatus: TradeStatusState = 'NO TRADE';

    if (activeTrade) {
      const remaining = Math.max(0, Math.ceil((activeTrade.expiryTimestamp - now) / 1000));
      effectiveTradeStatus = remaining > 0 ? 'TRADE ACTIVE' : 'TRADE COMPLETED';
      activeTradeContext = {
        signalId: activeTrade.signalId || `trade-${activeTrade.id}`,
        originalAction: activeTrade.direction,
        originalConfidence: activeTrade.confidence ?? 0,
        entryTimestamp: activeTrade.entryTimestamp,
        recommendedExpiry: activeTrade.expiryLabel || '1 min',
        remainingSeconds: remaining,
        status: 'STABLE',
        tradeStatus: effectiveTradeStatus,
        tradeHealth: undefined,
        reason: activeTrade.reasons?.[0] || 'Active trade running',
      };
    } else if (activeTradeContext && (activeTradeContext.remainingSeconds ?? 0) > 0) {
      effectiveTradeStatus = activeTradeContext.tradeStatus || 'TRADE ACTIVE';
    }

    const calHealth = CalibrationDatasetManager.getInstance().getCalibrationHealth();

    const fallbackState: OverlayState = {
      systemStatus,
      analysisState: this.state,
      decision: null,
      signalStatus: 'WAIT',
      tradeStatus: effectiveTradeStatus,
      tradeHealth: activeTradeContext ? activeTradeContext.tradeHealth : undefined,
      signalStrength: null,
      confidence: null,
      waitScore: 1,
      winProbability: null,
      calibrationActive: calHealth.isReadyForCalibration,
      calibrationEce: this.lastOverlayState?.calibrationEce,
      risk: null,
      reason,
      reasons: [reason],
      entryGuidance: 'WAIT',
      recommendedExpiry: null,
      lifecycleStage: SignalLifecycleStage.CANDIDATE,
      activeTradeContext,
      entryCountdownSec: null,
      marketRegime: observation?.marketRegime || null,
      trend: observation?.trendEvidence?.direction || null,
      momentum: observation?.momentumEvidence?.level || null,
      volatility: observation?.volatilityEvidence?.level || null,
      marketBias: null,
      supportLevel: observation?.supportResistanceEvidence?.nearestSupport || null,
      resistanceLevel: observation?.supportResistanceEvidence?.nearestResistance || null,
      marketIntelState: intel,
      asset: observation?.asset || this.lastOverlayState?.asset || null,
      timeframe: observation?.timeframe || this.lastOverlayState?.timeframe || null,
      currentPrice: typeof observation?.currentPrice === 'number'
        ? String(observation.currentPrice)
        : this.lastOverlayState?.currentPrice || null,
      lastUpdate: now,
      soundEnabled: this.currentSettings.soundEnabled,
    };

    this.lastOverlayState = fallbackState;
    this.latestDiagnosticsReport = this.latestDiagnosticsReport || { timestamp: now };
    this.overlayManager.sendState(fallbackState);

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.DEVELOPER_DIAGNOSTICS, this.getDeveloperDiagnostics());
      const nextControlState = this.getControlCenterState();
      this.lastControlState = nextControlState;
      this.mainWindow.webContents.send(IPC_CHANNELS.CONTROL_STATE_UPDATE, nextControlState);
    }
  }

  private emitOverlayState(stabilized: any, observation: any, deterioration: string): void {
    const now = Date.now();

    // Throttle IPC emissions
    if (now - this.lastOverlaySendTime < AnalysisController.OVERLAY_THROTTLE_MS) {
      return;
    }
    this.lastOverlaySendTime = now;

    const entryGuidance = this.computeEntryGuidance();
    const entryCountdownSec = this.computeEntryCountdown();

    const marketIntelState = this.marketIntelEngine.evaluate({
      observation,
      decision: stabilized,
    });

    const signalStatus: SignalStatusState =
      stabilized.action === TradingAction.BUY
        ? 'BUY SIGNAL ACTIVE'
        : stabilized.action === TradingAction.SELL
        ? 'SELL SIGNAL ACTIVE'
        : 'WAIT';

    const activeTradeContext = this.buildActiveTradeContext(deterioration, observation);

    let tradeStatus: TradeStatusState = 'NO TRADE';
    if (activeTradeContext) {
      tradeStatus = activeTradeContext.tradeStatus;
    } else if (this.entryIsValid && (stabilized.action === TradingAction.BUY || stabilized.action === TradingAction.SELL)) {
      tradeStatus = 'ENTRY WINDOW';
    }

    const calHealth = CalibrationDatasetManager.getInstance().getCalibrationHealth();

    const overlayState: OverlayState = {
      systemStatus: SystemStatus.SCANNING,
      analysisState: this.state,

      decision: stabilized.action,
      signalStatus,
      tradeStatus,
      tradeHealth: activeTradeContext ? activeTradeContext.tradeHealth : undefined,
      signalStrength: stabilized.signalStrength,
      waitScore: typeof stabilized.confidence === 'number'
        ? confidenceToWaitScore(this.normalizeConfidenceRatio(this.smoothConfidence(this.normalizeConfidencePercent(stabilized.confidence), observation)))
        : confidenceToWaitScore(this.normalizeConfidenceRatio(stabilized.confidence)),
      confidence: typeof stabilized.confidence === 'number'
        ? this.smoothConfidence(this.normalizeConfidencePercent(stabilized.confidence), observation)
        : stabilized.confidence,
      calibrationActive: calHealth.isReadyForCalibration,
      risk: stabilized.risk,
      reason: stabilized.reason,
      reasons: stabilized.reasons || [],
      entryGuidance: entryGuidance as any,
      recommendedExpiry: stabilized.recommendedExpiry,
      lifecycleStage: this.mapLifecycleToStage(this.stabilizer.getLifecycle()),
      activeTradeContext,

      entryCountdownSec,
      marketRegime: observation?.marketRegime || null,

      trend: observation?.trendEvidence?.direction || null,
      momentum: observation?.momentumEvidence?.level || null,
      volatility: observation?.volatilityEvidence?.level || null,
      marketBias: stabilized.marketBias,
      supportLevel: observation?.supportResistanceEvidence?.nearestSupport || null,
      resistanceLevel: observation?.supportResistanceEvidence?.nearestResistance || null,
      marketIntelState,

      asset: observation?.asset || null,
      timeframe: observation?.timeframe || null,
      currentPrice: observation?.currentPrice ? observation.currentPrice.toString() : null,
      lastUpdate: now,
      soundEnabled: this.currentSettings.soundEnabled,
    };

    this.lastOverlayState = overlayState;
    this.overlayManager.sendState(overlayState);

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.DEVELOPER_DIAGNOSTICS, this.getDeveloperDiagnostics());
      const nextControlState = this.getControlCenterState();
      // lastUpdate is part of the renderer contract; publish each authoritative
      // cycle so Dashboard and dependent panels never look frozen while the
      // overlay is receiving fresh state.
      this.lastControlState = nextControlState;
      this.mainWindow.webContents.send(IPC_CHANNELS.CONTROL_STATE_UPDATE, nextControlState);
    }
  }

  // ----------------------------------------------------------
  // Performance Refresh
  // ----------------------------------------------------------

  public emitPerformanceRefresh(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.PERFORMANCE_REFRESH);
      this.mainWindow.webContents.send(IPC_CHANNELS.ACTIVE_TRADES_UPDATE);
    }
  }

  // ----------------------------------------------------------
  // Public State Accessors
  // ----------------------------------------------------------

  public getControlCenterState(): ControlCenterState {
    const activeTradeCount = Math.max(
      TradeLifecycleManager.getInstance().getActiveTrades().length,
      this.tradeRepo ? this.tradeRepo.getActiveTradeCount() : 0
    );
    return {
      analysisState: this.state,
      systemStatus: this.lastOverlayState?.systemStatus
        || (this.state === AnalysisState.RUNNING ? SystemStatus.SCANNING : SystemStatus.UNAVAILABLE),
      asset: this.lastOverlayState?.asset || null,
      timeframe: this.lastOverlayState?.timeframe || null,
      overlayVisible: true,
      sessionId: this.activeSessionId,
      totalSignals: this.totalConfirmedSignals,
      activeTradeCount,
      lastUpdate: this.lastOverlayState?.lastUpdate || null,
    };
  }

  public getDeveloperDiagnostics(): DeveloperDiagnostics {
    return {
      latestReport: this.latestDiagnosticsReport,
      scanCadenceMs: this.currentSettings.scanIntervalMs || 900,
      framesProcessed: this.framesProcessed,
      pipelineErrorCount: this.pipelineErrorCount,
    };
  }

  public async triggerDiagnosticCapture(): Promise<{ success: boolean; path?: string; error?: string }> {
    try {
      const frame = await EmbeddedBrowserManager.getInstance().captureFrame('diagnostic');
      const diagnosticsDir = path.join(app.getPath('userData'), 'diagnostics');
      await fs.mkdir(diagnosticsDir, { recursive: true });
      const safeTimestamp = new Date(frame.timestamp).toISOString().replace(/[:.]/g, '-');
      const imagePath = path.join(diagnosticsDir, `mars-diagnostic-${safeTimestamp}-${frame.frameId}.png`);
      const png = nativeImage.createFromBitmap(frame.buffer, {
        width: frame.width,
        height: frame.height,
      }).toPNG();
      await fs.writeFile(imagePath, png);
      this.latestDiagnosticsReport = {
        capturedAt: frame.timestamp,
        frameId: frame.frameId,
        path: imagePath,
        width: frame.width,
        height: frame.height,
      };
      return { success: true, path: imagePath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.latestDiagnosticsReport = { capturedAt: Date.now(), error: message };
      return { success: false, error: message };
    }
  }

  public async replayFrame(framePath: string): Promise<any> {
    if (typeof framePath !== 'string' || !framePath.trim()) {
      return { success: false, error: 'A saved frame path is required.' };
    }
    try {
      const stats = await fs.stat(framePath);
      if (!stats.isFile() || stats.size <= 0 || stats.size > 25 * 1024 * 1024) {
        return { success: false, error: 'Saved frame must be a non-empty image smaller than 25 MB.' };
      }
      const buffer = await fs.readFile(framePath);
      const image = nativeImage.createFromBuffer(buffer);
      if (image.isEmpty()) return { success: false, error: 'Saved frame is not a readable image.' };
      const size = image.getSize();
      const scanResult = await this.scanner.scanFrame(`replay-${Date.now()}`, buffer, size.width, size.height);
      if (!scanResult?.observation) {
        return { success: false, error: 'The saved frame did not produce a market observation.', diagnostics: scanResult?.diagnostics };
      }
      return this.replayObservation(scanResult.observation, scanResult.diagnostics);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Frame replay failed: ${message}` };
    }
  }

  public replayObservation(input: unknown, diagnosticsReport?: unknown): any {
    try {
      const observation = typeof input === 'string' ? JSON.parse(input) : input;
      if (!observation || typeof observation !== 'object') {
        return { success: false, error: 'Observation replay requires a JSON object.' };
      }
      const qualityCheck = this.qualityGate.evaluate(observation as any, true);
      if (!qualityCheck.passed) {
        return { success: false, stage: 'quality-gate', qualityCheck, diagnosticsReport };
      }
      const enriched = { ...(observation as any), ...this.featureExtractor.extract(observation as any) };
      const decision = this.decisionEngine.decide(
        enriched,
        this.currentSettings.enabledExpiries || ['auto'],
        this.activeSignal && !this.activeSignal.invalidated ? this.activeSignal.action : TradingAction.WAIT
      );
      return {
        success: true,
        observation: enriched,
        decision,
        diagnosticsReport,
        replayedAt: Date.now(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Observation replay failed: ${message}` };
    }
  }

  // ----------------------------------------------------------
  // Calibration Analysis
  // ----------------------------------------------------------

  public getCalibrationAnalysis(): any {
    const calibrationManager = CalibrationDatasetManager.getInstance();
    const health = calibrationManager.getCalibrationHealth();
    const observations = calibrationManager.getCalibrationObservations();

    const totalTrades = health.totalTrades;
    const winningTrades = health.winningTrades;
    const losingTrades = health.losingTrades;
    const drawTrades = health.drawTrades;

    const active = totalTrades >= 100;
    const sampleCount = totalTrades;
    const overallWinRate = totalTrades > 0 ? winningTrades / totalTrades : 0;

    // Build calibration bins from observations
    const bins: any[] = [];
    if (observations.length > 0) {
      const confidenceBuckets = new Map<string, { total: number; wins: number }>();
      for (const obs of observations) {
        const conf = (obs as any).confidence;
        const bucket = Math.floor(conf * 10) / 10;
        const key = bucket.toFixed(1);
        if (!confidenceBuckets.has(key)) confidenceBuckets.set(key, { total: 0, wins: 0 });
        const entry = confidenceBuckets.get(key)!;
        entry.total++;
        if ((obs as any).outcome === 'WIN') entry.wins++;
      }
      for (const [key, val] of confidenceBuckets) {
        bins.push({ confidence: parseFloat(key), predicted: parseFloat(key), actual: val.total > 0 ? val.wins / val.total : 0, count: val.total });
      }
      bins.sort((a, b) => a.confidence - b.confidence);
    }

    // Compute Expected Calibration Error (ECE)
    let ece = 0;
    for (const bin of bins) {
      ece += (bin.count / sampleCount) * Math.abs(bin.predicted - bin.actual);
    }

    const wellCalibratedPct = bins.length > 0
      ? bins.filter(b => Math.abs(b.predicted - b.actual) <= 0.05).length / bins.length * 100
      : 0;

    return {
      active,
      ece,
      wellCalibratedPct,
      sampleCount,
      overallWinRate,
      bins,
      mlValidation: [],
      anomaly: null,
      disabledReason: active ? null : 'Insufficient calibration data (need >= 100 trades)',
    };
  }

  // ----------------------------------------------------------
  // Manual Trade Execution
  // ----------------------------------------------------------

  public executeManualTrade(action?: any): void {
    if (!action) return;
    this.handleDetectedTradeClick({
      action: action.action === TradingAction.SELL || action.action === 'SELL' ? TradingAction.SELL : TradingAction.BUY,
      eventId: action.eventId || `manual-${Date.now()}`,
      timestamp: Date.now(),
      nodeInfo: action,
    });
  }

  private handleDetectedTradeClick(event: { action: TradingAction; eventId: string; timestamp: number; nodeInfo?: any }): void {
    const activeSignalMatches = Boolean(
      this.activeSignal &&
      !this.activeSignal.invalidated &&
      this.activeSignal.action === event.action &&
      this.isValidAssetName(this.activeSignal.asset)
    );

    const nodeInfo = event.nodeInfo || {};
    let asset = activeSignalMatches
      ? this.activeSignal!.asset
      : (nodeInfo.asset || nodeInfo.assetName || this.lastOverlayState?.asset || null);

    if (!this.isValidAssetName(asset)) {
      const activeTitle = EmbeddedBrowserManager.getInstance().getActiveTitle();
      const titleWithoutPrice = activeTitle
        ? activeTitle.replace(/^[0-9.,\s▲▼\u25B2\u25BC\u2191\u2193Ð$€₹]+/, '').split('|')[0].trim()
        : '';
      if (this.isValidAssetName(titleWithoutPrice)) {
        asset = titleWithoutPrice;
      }
    }
    if (!this.isValidAssetName(asset)) {
      asset = null;
    }

    const priceCandidates = [
      this.getLatestObservedPrice(this.lastObservationWithFeatures),
      nodeInfo.entryPrice,
      nodeInfo.price,
      this.lastOverlayState?.currentPrice,
    ];
    let entryPrice: number | null = null;
    for (const cand of priceCandidates) {
      const num = typeof cand === 'number' ? cand : Number(String(cand || '').replace(/,/g, ''));
      if (Number.isFinite(num) && num > 0) {
        entryPrice = num;
        break;
      }
    }

    const expiryLabel = activeSignalMatches
      ? this.activeSignal!.expiryLabel
      : (nodeInfo.expiryLabel || nodeInfo.expiryText || this.expiryEngine.presetToLabel(this.currentSettings.expiryOverride === 'auto' ? '1m' : this.currentSettings.expiryOverride));
    const expirySeconds = ExpiryEngine.labelToSeconds(expiryLabel) || 60;
    const signalId = activeSignalMatches
      ? this.activeSignal!.signalId
      : `manual-signal-${event.eventId || Date.now()}`;

    const registeredTrade = TradeLifecycleManager.getInstance().registerTrade({
      sessionId: this.activeSessionId || `manual-${Date.now()}`,
      signalId,
      eventId: event.eventId,
      executionId: typeof (event as any).executionId === 'string' ? (event as any).executionId : undefined,
      platformMode: (event as any).platformMode,
      direction: event.action,
      asset,
      timeframe: this.lastObservationWithFeatures?.timeframe || '1m',
      expirySeconds,
      confidence: activeSignalMatches ? this.activeSignal!.originalConfidence : null,
      regime: activeSignalMatches ? this.activeSignal!.regime : (this.lastObservationWithFeatures?.marketRegime || null),
      entryPrice: entryPrice ? entryPrice.toString() : null,
      reasons: activeSignalMatches ? this.activeSignal!.originalReasons : [],
      mlFeatures: MLEngine.getInstance().extractFeatures(this.lastObservationWithFeatures || {}),
    });

    if (!registeredTrade) return;
    const confirmedSignalId = registeredTrade.signalId || `trade-${registeredTrade.id}`;

    this.lastTradeStatusState = 'TRADE ACTIVE';
    this.lastOverlaySendTime = 0;

    // Immediately emit overlay state with TRADE ACTIVE and active countdown context
    if (this.lastOverlayState) {
      const remaining = registeredTrade.expirySeconds;
      const updatedOverlay: OverlayState = {
        ...this.lastOverlayState,
        tradeStatus: 'TRADE ACTIVE',
        activeTradeContext: {
          signalId: confirmedSignalId,
          originalAction: registeredTrade.direction,
          originalConfidence: registeredTrade.confidence ?? 0,
          entryTimestamp: registeredTrade.entryTimestamp,
          recommendedExpiry: registeredTrade.expiryLabel || expiryLabel,
          remainingSeconds: remaining,
          status: 'STABLE',
          tradeStatus: 'TRADE ACTIVE',
          reason: registeredTrade.reasons?.[0] || 'Verified trade execution',
        },
        lastUpdate: Date.now(),
      };
      this.lastOverlayState = updatedOverlay;
      this.overlayManager.sendState(updatedOverlay);
    }

    this.emitPerformanceRefresh();
  }

  // ----------------------------------------------------------
  // Helpers
  private mapLifecycleToStage(lifecycle: SignalLifecycle): SignalLifecycleStage {
    switch (lifecycle) {
      case SignalLifecycle.CONFIRMED:
      case SignalLifecycle.CONFIRMING:
        return SignalLifecycleStage.CONFIRMED;
      case SignalLifecycle.ENTRY_WINDOW:
        return SignalLifecycleStage.ENTRY_WINDOW;
      case SignalLifecycle.ACTIVE:
        return SignalLifecycleStage.ACTIVE_CONTEXT;
      case SignalLifecycle.EXPIRED:
      case SignalLifecycle.INVALIDATED:
        return SignalLifecycleStage.EXPIRED;
      default:
        return SignalLifecycleStage.CANDIDATE;
    }
  }
}


