import fs from 'node:fs';

const replaceRange = (text, startToken, endToken, replacement, label) => {
  const start = text.indexOf(startToken);
  const end = text.indexOf(endToken, start);
  if (start < 0 || end <= start) throw new Error(`${label} bounds missing: start=${start}, end=${end}`);
  return text.slice(0, start) + replacement + text.slice(end);
};

const controllerPath = 'electron/main/lifecycle/AnalysisController.ts';
let controller = fs.readFileSync(controllerPath, 'utf8');
const loopLines = [
  '  private startScanLoop(intervalMs: number): void {',
  '    this.stopScanLoop();',
  '    const scheduleNext = (): void => {',
  '      if (this.state !== AnalysisState.RUNNING) return;',
  '      const scheduledAt = Date.now();',
  '      this.scanTimer = setTimeout(async () => {',
  '        this.scanTimer = null;',
  '        this.lastEventLoopLagMs = Math.max(0, Date.now() - scheduledAt - intervalMs);',
  '        try {',
  '          await this.runScanCycle();',
  '        } catch (err) {',
  "          console.error('[MARS] Unhandled scan cycle error:', err);",
  '        } finally {',
  '          scheduleNext();',
  '        }',
  '      }, intervalMs);',
  '    };',
  '    scheduleNext();',
  '  }',
  '',
  '  private stopScanLoop(): void {',
  '    if (this.scanTimer) {',
  '      clearTimeout(this.scanTimer);',
  '      this.scanTimer = null;',
  '    }',
  '  }',
  '',
].join('\n');
controller = replaceRange(controller,
  '  private startScanLoop(intervalMs: number): void {',
  '  private async runScanCycle', loopLines, 'controller scan loop');

if (!controller.includes('private lastScanDurationMs')) {
  controller = controller.replace(
    '  private lastObservedTrend: any = null;\n',
    '  private lastObservedTrend: any = null;\n  private database: Database | null = null;\n  private lastScanDurationMs = 0;\n  private maxScanDurationMs = 0;\n  private completedScanCount = 0;\n  private skippedScanCount = 0;\n  private lastEventLoopLagMs = 0;\n'
  );
  controller = controller.replace(
    '  constructor(overlayManager: OverlayManager, mainWindow: BrowserWindow | null = null, database?: Database) {\n',
    '  constructor(overlayManager: OverlayManager, mainWindow: BrowserWindow | null = null, database?: Database) {\n    this.database = database || null;\n'
  );
}
const oldScanStart = '  private async runScanCycle(): Promise<void> {\n    if (this.isScanningActive || this.state !== AnalysisState.RUNNING) return;\n    this.isScanningActive = true;\n    this.framesProcessed++;';
const newScanStart = '  private async runScanCycle(): Promise<void> {\n    if (this.state !== AnalysisState.RUNNING) return;\n    if (this.isScanningActive) {\n      this.skippedScanCount++;\n      return;\n    }\n    this.isScanningActive = true;\n    this.framesProcessed++;\n    const scanStartedAt = Date.now();';
if (!controller.includes(oldScanStart)) throw new Error('Scan-cycle start block missing');
controller = controller.replace(oldScanStart, newScanStart);
const oldScanFinally = '    } finally {\n      this.isScanningActive = false;\n    }\n  }\n\n  // ----------------------------------------------------------\n  // Entry Timing';
const newScanFinally = '    } finally {\n      this.lastScanDurationMs = Date.now() - scanStartedAt;\n      this.maxScanDurationMs = Math.max(this.maxScanDurationMs, this.lastScanDurationMs);\n      this.completedScanCount++;\n      this.isScanningActive = false;\n    }\n  }\n\n  // ----------------------------------------------------------\n  // Entry Timing';
if (!controller.includes(oldScanFinally)) throw new Error('Scan-cycle finalizer block missing');
controller = controller.replace(oldScanFinally, newScanFinally);
const oldDiagnostics = `  public getDeveloperDiagnostics(): DeveloperDiagnostics {
    return {
      latestReport: this.latestDiagnosticsReport,
      scanCadenceMs: this.currentSettings.scanIntervalMs || 900,
      framesProcessed: this.framesProcessed,
      pipelineErrorCount: this.pipelineErrorCount,
    };
  }`;
const newDiagnostics = `  public getDeveloperDiagnostics(): DeveloperDiagnostics {
    const stages = Array.isArray(this.latestDiagnosticsReport?.stages) ? this.latestDiagnosticsReport.stages : [];
    const stageDuration = (stage: ScannerStage): number | null => {
      const trace = stages.find((item: any) => item?.stage === stage);
      return typeof trace?.durationMs === 'number' ? trace.durationMs : null;
    };
    const overlayMetrics = this.overlayManager.getRuntimeMetrics();
    return {
      latestReport: this.latestDiagnosticsReport,
      scanCadenceMs: this.currentSettings.scanIntervalMs || 900,
      framesProcessed: this.framesProcessed,
      pipelineErrorCount: this.pipelineErrorCount,
      runtimePerformance: {
        completedScans: this.completedScanCount,
        skippedScans: this.skippedScanCount,
        lastScanDurationMs: this.lastScanDurationMs,
        maxScanDurationMs: this.maxScanDurationMs,
        captureDurationMs: stageDuration(ScannerStage.CAPTURE),
        workerAnalysisDurationMs: stageDuration(ScannerStage.CANDLES),
        quoteHeartbeatAgeMs: overlayMetrics.latestQuoteAgeMs,
        eventLoopLagMs: this.lastEventLoopLagMs,
        overlayIpcUpdates: overlayMetrics.ipcUpdateCount,
        quoteIpcUpdates: overlayMetrics.quoteUpdateCount,
        databasePersistence: this.database?.getPersistenceMetrics() || null,
      },
    };
  }`;
if (!controller.includes(oldDiagnostics)) throw new Error('Developer diagnostics block missing');
controller = controller.replace(oldDiagnostics, newDiagnostics);
fs.writeFileSync(controllerPath, controller);

const overlayPath = 'electron/main/overlay/OverlayManager.ts';
let overlay = fs.readFileSync(overlayPath, 'utf8');
if (!overlay.includes('private quoteUpdateCount')) {
  overlay = overlay.replace('  private latestQuoteAt = 0;\n', '  private latestQuoteAt = 0;\n  private quoteUpdateCount = 0;\n  private ipcUpdateCount = 0;\n');
}
const quoteMethod = `  public sendQuote(snapshot: {
    asset: string | null;
    price: number | null;
    timeframe: string | null;
    platformMode: 'DEMO' | 'LIVE' | 'UNKNOWN';
    observedAt: number;
  }): void {
    if (!snapshot || Date.now() - snapshot.observedAt > 5000) return;
    const numericPrice = typeof snapshot.price === 'number' && Number.isFinite(snapshot.price) && snapshot.price > 0
      ? snapshot.price
      : null;
    const nextPrice = numericPrice !== null ? String(numericPrice) : null;
    const patch: Record<string, any> = {
      lastUpdate: snapshot.observedAt,
      platformMode: snapshot.platformMode,
    };
    if (snapshot.asset) patch.asset = snapshot.asset;
    if (snapshot.timeframe) patch.timeframe = snapshot.timeframe;
    if (nextPrice !== null) patch.currentPrice = nextPrice;

    const priorMonitor = this.latestPayload?.tradeMonitor;
    if (numericPrice !== null && priorMonitor) {
      const entryPrice = Number(priorMonitor.entryPrice);
      const action = String(priorMonitor.action || '').toUpperCase();
      const direction = action === 'SELL' ? -1 : 1;
      const rawMove = Number.isFinite(entryPrice) && entryPrice > 0
        ? (numericPrice - entryPrice) * direction
        : null;
      const pnlPct = rawMove === null ? null : (rawMove / entryPrice) * 100;
      const health = pnlPct === null ? priorMonitor.health : pnlPct > 0 ? 'IN PROFIT' : pnlPct < 0 ? 'AGAINST' : 'AT ENTRY';
      patch.tradeMonitor = {
        ...priorMonitor,
        currentPrice: numericPrice,
        pnlPoints: rawMove,
        pnlPct,
        health,
        healthReason: 'Indicative live quote only; final result remains evidence-verified.',
      };
    }

    const quoteKey = `${patch.asset || this.latestPayload?.asset || ''}|${patch.currentPrice || this.latestPayload?.currentPrice || ''}|${patch.timeframe || ''}|${patch.platformMode || ''}`;
    if (quoteKey === this.latestPayload?.__quoteKey && snapshot.observedAt - this.latestQuoteAt < 900) return;
    this.latestQuoteAt = snapshot.observedAt;
    this.quoteUpdateCount++;
    this.latestPayload = { ...(this.latestPayload || {}), ...patch, __quoteKey: quoteKey };
    this.sendPayload(patch);
  }

`;
overlay = replaceRange(overlay, '  public sendQuote(snapshot: {', '  public sendState(', quoteMethod, 'overlay quote method');
if (!overlay.includes('this.ipcUpdateCount++;')) {
  overlay = overlay.replace(
    '    window.webContents.send(IPC_CHANNELS.OVERLAY_STATE_UPDATE, payload);',
    '    this.ipcUpdateCount++;\n    window.webContents.send(IPC_CHANNELS.OVERLAY_STATE_UPDATE, payload);'
  );
}
if (!overlay.includes('public getRuntimeMetrics')) {
  overlay = overlay.replace(
    '  public getIsVisible(): boolean { return this.isVisible; }',
    `  public getRuntimeMetrics(): { latestQuoteAgeMs: number | null; quoteUpdateCount: number; ipcUpdateCount: number } {
    return {
      latestQuoteAgeMs: this.latestQuoteAt > 0 ? Math.max(0, Date.now() - this.latestQuoteAt) : null,
      quoteUpdateCount: this.quoteUpdateCount,
      ipcUpdateCount: this.ipcUpdateCount,
    };
  }

  public getIsVisible(): boolean { return this.isVisible; }`
  );
}
fs.writeFileSync(overlayPath, overlay);

const signalPath = 'frontend/src/overlay/SignalPanel.tsx';
let signal = fs.readFileSync(signalPath, 'utf8');
const countdown = `  // One absolute-time ticker drives both countdowns without recreating intervals.
  const entryCountdownSec = state?.entryCountdownSec ?? null;
  const entryGuidance = state?.entryGuidance || anyState.entry;
  const tradeRemaining = typeof tradeMonitor?.remainingSeconds === 'number' ? tradeMonitor.remainingSeconds : null;
  const tradeSignalId = tradeMonitor?.signalId || activeTrade?.signalId || null;
  const [clockNow, setClockNow] = useState(() => Date.now());
  const lastSyncRef = useRef<{ val: number | null; time: number }>({ val: null, time: 0 });
  const lastExpirySyncRef = useRef<{ val: number | null; time: number; signalId: string | null }>({ val: null, time: 0, signalId: null });

  useEffect(() => {
    const now = Date.now();
    lastSyncRef.current = typeof entryCountdownSec === 'number'
      ? { val: entryCountdownSec, time: now }
      : { val: null, time: 0 };
    setClockNow(now);
  }, [entryCountdownSec]);

  useEffect(() => {
    const remaining = tradeRemaining ?? activeTrade?.remainingSeconds ?? null;
    const now = Date.now();
    lastExpirySyncRef.current = typeof remaining === 'number'
      ? { val: remaining, time: now, signalId: tradeSignalId }
      : { val: null, time: 0, signalId: null };
    setClockNow(now);
  }, [tradeRemaining, activeTrade?.remainingSeconds, activeTrade?.entryTimestamp, tradeSignalId]);

  const shouldTick = typeof entryCountdownSec === 'number'
    || typeof tradeRemaining === 'number'
    || typeof activeTrade?.remainingSeconds === 'number';
  useEffect(() => {
    if (!shouldTick) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [shouldTick]);

  const localVisualSec = typeof lastSyncRef.current.val === 'number' && lastSyncRef.current.time > 0
    ? Math.max(0, lastSyncRef.current.val - Math.floor((clockNow - lastSyncRef.current.time) / 1000))
    : null;
  const localExpirySec = typeof lastExpirySyncRef.current.val === 'number'
    && lastExpirySyncRef.current.time > 0
    && lastExpirySyncRef.current.signalId === tradeSignalId
    ? Math.max(0, lastExpirySyncRef.current.val - Math.floor((clockNow - lastExpirySyncRef.current.time) / 1000))
    : null;

`;
signal = replaceRange(signal,
  '  // Entry guidance & countdown with 1s local interpolation',
  '  const normalizePercent =', countdown, 'signal countdown');
const priceHelper = `  const normalizePrice = (value: unknown): number | null => {
    const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, '').trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

`;
signal = signal.replace('  const calibrationActive =', priceHelper + '  const calibrationActive =');
signal = signal.replace(
  '  const tm = tradeMonitor;\n  const pnlPct =',
  '  const tm = tradeMonitor;\n  const monitorEntryPrice = normalizePrice(tm?.entryPrice);\n  const monitorCurrentPrice = normalizePrice(tm?.currentPrice);\n  const pnlPct ='
);
signal = signal.replace("{typeof tm.entryPrice === 'number' ? tm.entryPrice.toFixed(5) : '--'}", "{monitorEntryPrice !== null ? monitorEntryPrice.toFixed(5) : '--'}");
signal = signal.replace("{typeof tm.currentPrice === 'number' ? tm.currentPrice.toFixed(5) : '--'}", "{monitorCurrentPrice !== null ? monitorCurrentPrice.toFixed(5) : '--'}");
fs.writeFileSync(signalPath, signal);

const ipcPath = 'shared/types/ipc.ts';
let ipc = fs.readFileSync(ipcPath, 'utf8');
if (!ipc.includes('runtimePerformance?:')) {
  ipc = ipc.replace(
    '  pipelineErrorCount: number;\n}',
    `  pipelineErrorCount: number;
  runtimePerformance?: {
    completedScans: number;
    skippedScans: number;
    lastScanDurationMs: number;
    maxScanDurationMs: number;
    captureDurationMs: number | null;
    workerAnalysisDurationMs: number | null;
    quoteHeartbeatAgeMs: number | null;
    eventLoopLagMs: number;
    overlayIpcUpdates: number;
    quoteIpcUpdates: number;
    databasePersistence: {
      completedSaves: number;
      skippedNoopTransactions: number;
      lastSaveDurationMs: number;
      dirty: boolean;
    } | null;
  };
}`
  );
}
fs.writeFileSync(ipcPath, ipc);

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
lock.version = pkg.version;
if (lock.packages && lock.packages['']) lock.packages[''].version = pkg.version;
fs.writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n');

console.log('RC3 deterministic source patch applied.');
