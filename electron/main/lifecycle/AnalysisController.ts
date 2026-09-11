// ============================================================
// MARS PRO V3 — Analysis Controller (Integration Layer)
// Wires: capture → analysis → decision → overlay → trade tracking
// ============================================================

import { BrowserWindow } from 'electron';
import { ScreenCaptureManager } from '../capture/ScreenCaptureManager';
import { AnalysisPipeline } from '../pipeline/AnalysisPipeline';
import { OverlayManager } from '../overlay/OverlayManager';
import { ScreenshotManager } from '../screenshot/ScreenshotManager';
import { TradeLifecycleManager } from '../trade/TradeLifecycleManager';
import { SettingsManager } from '../settings/SettingsManager';
import { RawFrameRepository } from '../database/repositories/RawFrameRepository';
import { ObservationRepository } from '../database/repositories/ObservationRepository';
import { DecisionRepository } from '../database/repositories/DecisionRepository';
import { SignalRepository } from '../database/repositories/SignalRepository';
import { TradeRepository } from '../database/repositories/TradeRepository';
import { SessionRepository } from '../database/repositories/SessionRepository';
import { DecisionEngine } from '../decision/DecisionEngine';
import { ReasonEngine } from '../decision/ReasonEngine';
import { SignalStabilizer } from '../decision/SignalStabilizer';
import { TradingAction } from '../../../shared/types/decision';
import { OverlayState } from '../../../shared/types/overlay';
import { Signal } from '../../../shared/types/signal';
import { MarketObservation } from '../../../shared/types/observation';
import { randomUUID } from 'crypto';
import { IPC_CHANNELS } from '../../../shared/contracts/ipc-channels';
import { EmbeddedBrowserManager } from '../view/EmbeddedBrowserManager';
import { BrowserTradeClickEvent } from '../view/embeddedEventValidation';
import { deriveVerifiedPriceOutcome } from '../trade/verifiedTradeOutcome';

export type AnalysisStatus = 'STOPPED' | 'RUNNING' | 'ERROR';

export class AnalysisController {
  private captureManager: ScreenCaptureManager;
  private pipeline: AnalysisPipeline;
  private overlayManager: OverlayManager;
  private screenshotManager: ScreenshotManager;
  private tradeManager: TradeLifecycleManager;
  private settingsManager: SettingsManager;
  private decisionEngine: DecisionEngine;
  private reasonEngine: ReasonEngine;
  private stabilizer: SignalStabilizer;

  private rawFrameRepo: RawFrameRepository;
  private observationRepo: ObservationRepository;
  private decisionRepo: DecisionRepository;
  private signalRepo: SignalRepository;
  private tradeRepo: TradeRepository;
  private sessionRepo: SessionRepository;

  private status: AnalysisStatus = 'STOPPED';
  private sessionId: string | null = null;
  private intervalHandle: NodeJS.Timeout | null = null;
  private mainWindow: BrowserWindow | null = null;
  private scanCount = 0;
  private consecutivePriceFailures = 0;
  private lastObservation: MarketObservation | null = null;
  private lastSignal: Signal | null = null;
  private activeSignal: Signal | null = null;
  private signalSequence = 0;
  private inFlightCycle: Promise<void> | null = null;
  private subscribedToTradeState = false;
  private readonly analysisSource: 'EMBEDDED_BROWSER' | 'DESKTOP_CAPTURE' = 'EMBEDDED_BROWSER';

  constructor(deps: {
    captureManager: ScreenCaptureManager;
    pipeline: AnalysisPipeline;
    overlayManager: OverlayManager;
    screenshotManager: ScreenshotManager;
    tradeManager: TradeLifecycleManager;
    settingsManager: SettingsManager;
    rawFrameRepo: RawFrameRepository;
    observationRepo: ObservationRepository;
    decisionRepo: DecisionRepository;
    signalRepo: SignalRepository;
    tradeRepo: TradeRepository;
    sessionRepo: SessionRepository;
  }) {
    this.captureManager = deps.captureManager;
    this.pipeline = deps.pipeline;
    this.overlayManager = deps.overlayManager;
    this.screenshotManager = deps.screenshotManager;
    this.tradeManager = deps.tradeManager;
    this.settingsManager = deps.settingsManager;
    this.rawFrameRepo = deps.rawFrameRepo;
    this.observationRepo = deps.observationRepo;
    this.decisionRepo = deps.decisionRepo;
    this.signalRepo = deps.signalRepo;
    this.tradeRepo = deps.tradeRepo;
    this.sessionRepo = deps.sessionRepo;
    this.decisionEngine = new DecisionEngine();
    this.reasonEngine = new ReasonEngine();
    this.stabilizer = new SignalStabilizer();

    this.tradeManager.setRepository(this.tradeRepo);
    if (!this.subscribedToTradeState) {
      this.tradeManager.subscribeTradeStateChange((trade) => {
        if (trade.result) {
          this.decisionEngine.ingestVerifiedCompletedTrades([
            {
              id: trade.id,
              asset: trade.asset,
              action: trade.direction,
              outcome: trade.result,
              entryPrice: trade.entryPrice ?? null,
              completionPrice: trade.completionPrice ?? null,
              platformMode: trade.platformMode,
              mlFeatures: trade.mlFeatures ?? null,
            },
          ]);
          this.decisionEngine.getMLEngine().save();
        }
        this.emitTradeStateRefresh();
      });
      this.subscribedToTradeState = true;
    }

    EmbeddedBrowserManager.getInstance().setTradeClickHandler((event) => this.onTradeClicked(event));
    this.hydrateLearningFromVerifiedHistory();
  }

  public setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  public async start(): Promise<{ success: boolean; error?: string }> {
    if (this.status === 'RUNNING') return { success: true };
    try {
      this.status = 'RUNNING';
      this.sessionId = randomUUID();
      this.scanCount = 0;
      this.consecutivePriceFailures = 0;
      this.lastObservation = null;
      this.lastSignal = null;
      this.activeSignal = null;
      this.decisionEngine.reset();
      this.stabilizer.reset();

      this.sessionRepo.createSession({
        id: this.sessionId,
        start_timestamp: Date.now(),
        active_calibration_profile: this.settingsManager.getCalibrationMode(),
        mode: 'ANALYSIS',
        version: '3.0.0',
      });
      this.tradeManager.loadAndRecoverPendingTrades();
      this.decisionEngine.setCalibrationMode(this.settingsManager.getCalibrationMode());

      this.runCycleNonOverlapping();
      this.intervalHandle = setInterval(() => this.runCycleNonOverlapping(), this.settingsManager.getScanIntervalMs());
      return { success: true };
    } catch (error) {
      this.status = 'ERROR';
      console.error('[AnalysisController] Failed to start:', error);
      return { success: false, error: String(error) };
    }
  }

  public async stop(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.inFlightCycle) {
      try { await this.inFlightCycle; } catch {}
    }
    if (this.sessionId) {
      try { this.sessionRepo.endSession(this.sessionId, Date.now()); } catch {}
    }
    this.status = 'STOPPED';
    this.sessionId = null;
    this.activeSignal = null;
    this.stabilizer.reset();
  }

  private runCycleNonOverlapping(): void {
    if (this.inFlightCycle) return;
    this.inFlightCycle = this.scanCycle()
      .catch((error) => console.error('[AnalysisController] Scan cycle error:', error))
      .finally(() => { this.inFlightCycle = null; });
  }

  private async scanCycle(): Promise<void> {
    if (this.status !== 'RUNNING' || !this.sessionId) return;
    try {
      let frame;
      if (this.analysisSource === 'EMBEDDED_BROWSER') {
        try {
          frame = await EmbeddedBrowserManager.getInstance().captureFrame(this.sessionId);
        } catch (captureError) {
          console.error('[AnalysisController] Embedded Browser Workstation capture failed:', captureError);
          return;
        }
      } else {
        frame = await this.captureManager.captureFrame(this.sessionId);
      }

      this.rawFrameRepo.saveFrame({
        id: frame.frameId, session_id: this.sessionId, timestamp: frame.timestamp,
        display_id: frame.displayId, width: frame.width, height: frame.height,
        scale_factor: frame.scaleFactor, buffer: Buffer.from(frame.buffer),
      });

      const previousObservation = this.lastObservation;
      const observation = await this.pipeline.processFrame(frame);
      if (!observation) return;
      this.lastObservation = observation;
      this.scanCount++;
      this.observationRepo.saveObservation({
        id: observation.id, session_id: this.sessionId, frame_id: frame.frameId,
        timestamp: observation.timestamp, asset: observation.asset, timeframe: observation.timeframe,
        candle_count: observation.candles.length, current_price: observation.currentPrice,
        pattern_json: JSON.stringify(observation.patternEvidence), trend_json: JSON.stringify(observation.trendEvidence),
        momentum_json: JSON.stringify(observation.momentumEvidence), structure_json: JSON.stringify(observation.structureEvidence),
        sr_json: JSON.stringify(observation.supportResistanceEvidence), volatility_json: JSON.stringify(observation.volatilityEvidence),
        quantitative_json: JSON.stringify(observation.quantitativeMetrics),
        data_quality: observation.dataQuality, quality_gate_passed: observation.qualityGatePassed === true,
        quality_gate_reasons: JSON.stringify(observation.qualityGateReasons || []),
        market_regime: observation.marketRegime,
      });

      if (observation.currentPrice && observation.currentPrice > 0) this.consecutivePriceFailures = 0;
      else this.consecutivePriceFailures++;
      if (this.consecutivePriceFailures > 10) {
        console.error('[AnalysisController] Unable to read a valid market price after 10 consecutive scans. Stopping analysis safely.');
        await this.stop();
        return;
      }

      const expiringTrades = this.tradeManager.getActiveTrades().filter((trade) => trade.status === 'EXPIRING');
      for (const trade of expiringTrades) {
        const verified = deriveVerifiedPriceOutcome(trade, observation);
        if (!verified) continue;
        this.tradeManager.resolveTradeOutcome(trade.id, verified.outcome, verified.completionPrice);
      }

      const decision = this.decisionEngine.decide(observation);
      const stabilizedDecision = this.stabilizer.stabilize(decision);
      const degraded = observation.qualityGatePassed === false
        || observation.dataQuality !== 'HIGH'
        || !observation.asset
        || !observation.currentPrice
        || observation.currentPrice <= 0;
      const safeDecision = degraded
        ? {
            ...stabilizedDecision,
            action: TradingAction.WAIT,
            confidence: 0,
            reason: `WAIT: ${observation.qualityGateReasons?.join('; ') || 'insufficient market evidence'}`,
            reasons: observation.qualityGateReasons?.length
              ? [...observation.qualityGateReasons]
              : ['Insufficient market evidence for a safe actionable signal.'],
          }
        : stabilizedDecision;

      const reasons = this.reasonEngine.generateReasons(observation, safeDecision);
      this.decisionRepo.saveDecision({
        id: safeDecision.id || randomUUID(), session_id: this.sessionId, observation_id: observation.id,
        timestamp: safeDecision.timestamp, action: safeDecision.action, confidence: safeDecision.confidence,
        risk: safeDecision.risk, expiry: safeDecision.recommendedExpiry,
        reasons_json: JSON.stringify(reasons), rejection_reasons_json: JSON.stringify(safeDecision.rejectionReasons || []),
        market_regime: observation.marketRegime,
      });

      const shouldEmitSignal = safeDecision.action !== TradingAction.WAIT &&
        (!this.lastSignal || this.lastSignal.action !== safeDecision.action || Date.now() - this.lastSignal.timestamp > 10000);
      if (shouldEmitSignal) {
        const signalId = this.createSignalId(safeDecision.action);
        const signal: Signal = {
          id: signalId, sessionId: this.sessionId, decisionId: safeDecision.id || randomUUID(),
          timestamp: Date.now(), action: safeDecision.action,
          confidence: safeDecision.confidence, risk: safeDecision.risk,
          expiry: safeDecision.recommendedExpiry, asset: observation.asset,
          timeframe: observation.timeframe, reasons, regime: observation.marketRegime,
        };
        this.signalRepo.saveSignal({
          id: signal.id, session_id: signal.sessionId, decision_id: signal.decisionId,
          timestamp: signal.timestamp, action: signal.action, confidence: signal.confidence,
          risk: signal.risk, expiry: signal.expiry, asset: signal.asset,
          timeframe: signal.timeframe, reasons_json: JSON.stringify(reasons), outcome: null,
        });
        this.lastSignal = signal;
        this.activeSignal = signal;
        this.screenshotManager.requestScreenshot({
          type: 'SIGNAL_EVENT', signalId: signal.id, sessionId: this.sessionId,
          asset: signal.asset, action: signal.action, timestamp: signal.timestamp,
          frameBuffer: frame.buffer, width: frame.width, height: frame.height,
        });
      }

      if (this.activeSignal && previousObservation && this.isSignalDeteriorated(this.activeSignal, observation, previousObservation)) {
        this.screenshotManager.requestScreenshot({
          type: 'CONDITION_DETERIORATION', signalId: this.activeSignal.id, sessionId: this.sessionId,
          asset: this.activeSignal.asset, action: this.activeSignal.action,
          timestamp: Date.now(), frameBuffer: frame.buffer, width: frame.width, height: frame.height,
        });
        this.activeSignal = null;
      }

      const overlayState: OverlayState = {
        visible: true, clickThrough: this.settingsManager.isClickThrough(),
        signal: safeDecision.action, confidence: safeDecision.confidence,
        risk: safeDecision.risk, expiry: safeDecision.recommendedExpiry,
        reasons, isScanning: true, lastUpdateTimestamp: Date.now(),
        dataQuality: observation.dataQuality, stabilityStatus: safeDecision.stabilityStatus,
      };
      this.overlayManager.updateState(overlayState);
      this.emitStatusUpdate();
    } catch (error) {
      console.error('[AnalysisController] Scan cycle failed:', error);
    }
  }

  private onTradeClicked(click: BrowserTradeClickEvent): void {
    if (!this.sessionId) return;
    const action = click.action;
    const matchingSignal = this.activeSignal?.action === action ? this.activeSignal : null;
    const asset = matchingSignal?.asset || this.lastObservation?.asset || null;
    const observedPrice = Number(this.lastObservation?.currentPrice);
    const entryPrice = Number.isFinite(observedPrice) && observedPrice > 0 ? String(observedPrice) : null;
    const expirySeconds = click.expirySeconds || this.parseExpirySeconds(matchingSignal?.expiry || '1 min');
    const mlFeatures = this.lastObservation
      ? this.decisionEngine.getMLEngine().extractFeatures(this.lastObservation, this.lastObservation.candles as any)
      : undefined;
    const registered = this.tradeManager.registerTrade({
      sessionId: this.sessionId,
      signalId: matchingSignal?.id || `browser-${click.executionId}`,
      executionId: click.executionId,
      asset,
      direction: action,
      expirySeconds,
      confidence: matchingSignal?.confidence,
      entryPrice,
      reasons: matchingSignal?.reasons || [],
      timeframe: matchingSignal?.timeframe || this.lastObservation?.timeframe,
      regime: matchingSignal?.regime || this.lastObservation?.marketRegime,
      mlFeatures,
      eventId: click.eventId,
      platformMode: click.platformMode,
    });
    if (registered) {
      this.activeSignal = null;
      this.emitTradeStateRefresh();
    }
  }

  private hydrateLearningFromVerifiedHistory(): void {
    try {
      this.decisionEngine.hydrateMLEngineFromCompletedTrades(this.tradeRepo.getCompletedTrades(1000).map((trade) => ({
        id: trade.id,
        asset: trade.asset,
        action: trade.action as TradingAction,
        outcome: trade.outcome as any,
        entryPrice: trade.entry_price,
        completionPrice: trade.completion_price,
        platformMode: trade.platform_mode as any,
        mlFeatures: this.tradeRepo.getFeatureSnapshot(trade.id),
      })));
    } catch (error) {
      console.error('[AnalysisController] Failed to hydrate verified learning history:', error);
    }
  }

  private isSignalDeteriorated(signal: Signal, current: MarketObservation, previous: MarketObservation): boolean {
    const previousStrength = previous.trendEvidence.strength;
    const currentStrength = current.trendEvidence.strength;
    const directionReversed = signal.action === TradingAction.BUY
      ? current.trendEvidence.direction === 'BEARISH'
      : current.trendEvidence.direction === 'BULLISH';
    return directionReversed || currentStrength < previousStrength * 0.6 || current.dataQuality === 'LOW';
  }

  private parseExpirySeconds(expiry: string): number {
    const match = expiry.match(/(\d+)\s*(min|sec)/i);
    if (!match) return 60;
    const value = parseInt(match[1], 10);
    return match[2].toLowerCase() === 'min' ? value * 60 : value;
  }

  private createSignalId(action: TradingAction): string {
    this.signalSequence += 1;
    return `sig-${this.sessionId?.slice(0, 8) || 'session'}-${action}-${Date.now()}-${this.signalSequence}`;
  }

  private emitStatusUpdate(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed() && !this.mainWindow.webContents.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.ANALYSIS_STATUS_CHANGED, this.getStatus());
    }
  }

  private emitTradeStateRefresh(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed() && !this.mainWindow.webContents.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.ACTIVE_TRADES_UPDATE);
      this.mainWindow.webContents.send(IPC_CHANNELS.PERFORMANCE_REFRESH);
    }
  }

  public getStatus(): { status: AnalysisStatus; sessionId: string | null; scanCount: number; activeSignal: Signal | null } {
    return { status: this.status, sessionId: this.sessionId, scanCount: this.scanCount, activeSignal: this.activeSignal };
  }

  public getActiveSignal(): Signal | null { return this.activeSignal; }
  public resetStability(): void { this.stabilizer.reset(); }
}
