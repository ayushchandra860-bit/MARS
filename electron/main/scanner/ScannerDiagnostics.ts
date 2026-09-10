// ============================================================
// MARS PRO V3 — Scanner Diagnostics Tracker
// Tracks core scanner pipeline stage latencies and status.
// ============================================================

import { ScannerStage, StageStatus, StageTrace, ScannerDiagnosticReport } from '../../../shared/types/scanner';

export type DiagnosticsReport = ScannerDiagnosticReport;

export class DiagnosticsTracker {
  private startTime: number = Date.now();
  private traces: Map<ScannerStage, StageTrace> = new Map();

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.startTime = Date.now();
    this.traces.clear();

    const allStages = [
      ScannerStage.CAPTURE,
      ScannerStage.FRAME,
      ScannerStage.CHART_ROI,
      ScannerStage.CANDLES,
      ScannerStage.OCR,
      ScannerStage.OBSERVATION,
      ScannerStage.QUALITY_GATE,
      ScannerStage.DECISION,
      ScannerStage.OVERLAY,
    ];

    for (const stage of allStages) {
      this.traces.set(stage, {
        stage,
        status: StageStatus.PARTIAL,
        durationMs: 0,
        detail: 'Pending execution',
      });
    }
  }

  public recordStage(stage: ScannerStage, status: StageStatus, detail: string = ''): void {
    const trace = this.traces.get(stage);
    if (trace) {
      trace.status = status;
      trace.durationMs = Date.now() - this.startTime;
      trace.detail = detail;
    }
  }

  public generateReport(): ScannerDiagnosticReport {
    const stageTraces = Array.from(this.traces.values());
    const firstFailedStageTrace = stageTraces.find(t => t.status === StageStatus.FAIL);

    return {
      sessionId: `diag-${this.startTime}`,
      frameId: `frame-${this.startTime}`,
      timestamp: Date.now(),
      displayId: '1',
      captureWidth: 1280,
      captureHeight: 720,
      scaleFactor: 1.0,
      stages: stageTraces,
      firstFailedStage: firstFailedStageTrace ? firstFailedStageTrace.stage : null,
      chartRegion: null,
      rawCandidateCount: 0,
      validatedCandleCount: 0,
      candleQuality: null,
      ocrResults: null,
      dataQuality: null,
      rawDecision: null,
      stabilizedDecision: null,
      pipelineDurationMs: Date.now() - this.startTime,
    };
  }
}
