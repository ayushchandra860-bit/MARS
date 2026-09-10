// ============================================================
// MARS PRO V3 — Runtime Health Monitor
// Tracks live heartbeats, processing latency, memory usage,
// error recovery, and 10-second stall detection across 17 core modules.
// ============================================================

export type ModuleStatus = 'RUNNING' | 'STOPPED' | 'WAITING' | 'ERROR';

export interface ModuleHealthReport {
  moduleName: string;
  status: ModuleStatus;
  isHealthy: boolean;
  lastUpdateTimestamp: number;
  lastProcessedSignalId: string | null;
  lastProcessedTradeId: string | null;
  processingTimeMs: number;
  memoryUsageMb: number;
  errorCount: number;
  recoveryCount: number;
  rootCause: string | null;
}

export interface SystemHealthReport {
  timestamp: number;
  overallStatus: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  healthyModuleCount: number;
  totalModuleCount: number;
  modules: ModuleHealthReport[];
}

export class RuntimeHealthMonitor {
  private static instance: RuntimeHealthMonitor | null = null;

  private modules: Map<string, ModuleHealthReport> = new Map();
  private readonly STALL_THRESHOLD_MS = 10000; // 10 seconds

  private readonly ALL_MODULES = [
    'Scanner',
    'OCR',
    'QuantitativeEngine',
    'EvidenceEngine',
    'DecisionEngine',
    'RiskEngine',
    'SignalStabilizer',
    'AnalysisController',
    'RunningTradeManager',
    'OutcomeEvaluator',
    'TradeRepository',
    'SQLite',
    'PerformanceEngine',
    'AnalyticsEngine',
    'Overlay',
    'EmbeddedBrowser',
    'IPC',
  ];

  private constructor() {
    this.initDefaultModules();
  }

  public static getInstance(): RuntimeHealthMonitor {
    if (!RuntimeHealthMonitor.instance) {
      RuntimeHealthMonitor.instance = new RuntimeHealthMonitor();
    }
    return RuntimeHealthMonitor.instance;
  }

  private initDefaultModules(): void {
    const now = Date.now();
    for (const name of this.ALL_MODULES) {
      this.modules.set(name, {
        moduleName: name,
        status: 'STOPPED',
        isHealthy: true,
        lastUpdateTimestamp: now,
        lastProcessedSignalId: null,
        lastProcessedTradeId: null,
        processingTimeMs: 0,
        memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        errorCount: 0,
        recoveryCount: 0,
        rootCause: null,
      });
    }
  }

  public recordHeartbeat(
    moduleName: string,
    status: ModuleStatus,
    data?: {
      signalId?: string;
      tradeId?: string;
      processingTimeMs?: number;
      error?: string;
      recovered?: boolean;
    }
  ): void {
    const now = Date.now();
    const existing = this.modules.get(moduleName) || {
      moduleName,
      status: 'STOPPED',
      isHealthy: true,
      lastUpdateTimestamp: now,
      lastProcessedSignalId: null,
      lastProcessedTradeId: null,
      processingTimeMs: 0,
      memoryUsageMb: 0,
      errorCount: 0,
      recoveryCount: 0,
      rootCause: null,
    };

    let newErrorCount = existing.errorCount;
    let newRecoveryCount = existing.recoveryCount;
    let rootCause = existing.rootCause;

    if (data?.error) {
      newErrorCount++;
      rootCause = data.error;
    } else if (data?.recovered) {
      newRecoveryCount++;
      rootCause = null;
    }

    this.modules.set(moduleName, {
      ...existing,
      status,
      isHealthy: status !== 'ERROR',
      lastUpdateTimestamp: now,
      lastProcessedSignalId: data?.signalId || existing.lastProcessedSignalId,
      lastProcessedTradeId: data?.tradeId || existing.lastProcessedTradeId,
      processingTimeMs: data?.processingTimeMs ?? existing.processingTimeMs,
      memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      errorCount: newErrorCount,
      recoveryCount: newRecoveryCount,
      rootCause,
    });
  }

  public getHealthReport(): SystemHealthReport {
    const now = Date.now();
    const reports: ModuleHealthReport[] = [];
    let healthyCount = 0;

    for (const [name, mod] of this.modules.entries()) {
      let isHealthy = mod.status !== 'ERROR';
      let rootCause = mod.rootCause;

      // Stall detection: If running and no update in > 10,000ms
      if (mod.status === 'RUNNING' && (now - mod.lastUpdateTimestamp) > this.STALL_THRESHOLD_MS) {
        isHealthy = false;
        rootCause = `No heartbeat in ${Math.round((now - mod.lastUpdateTimestamp) / 1000)}s (> 10s threshold). Module stalled.`;
      }

      if (isHealthy) healthyCount++;

      reports.push({
        ...mod,
        isHealthy,
        rootCause,
      });
    }

    const overallStatus =
      healthyCount === reports.length
        ? 'HEALTHY'
        : healthyCount >= Math.floor(reports.length * 0.7)
        ? 'DEGRADED'
        : 'UNHEALTHY';

    return {
      timestamp: now,
      overallStatus,
      healthyModuleCount: healthyCount,
      totalModuleCount: reports.length,
      modules: reports,
    };
  }
}
