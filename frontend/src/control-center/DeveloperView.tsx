import React, { useEffect, useState } from 'react';
import { useIpcListener, invokeIpc } from '../hooks/useIpc';
import { IPC_CHANNELS, IPC_INVOKE_CHANNELS } from '../../../shared/contracts/ipc-channels';
import { DeveloperDiagnostics } from '../../../shared/types/ipc';
import { StageTrace } from '../../../shared/types/scanner';

import { GlassPanel } from '../components/GlassPanel';

const ALL_PIPELINE_STAGES = [
  'CAPTURE',
  'FRAME',
  'CHART_ROI',
  'CANDLES',
  'OCR',
  'OBSERVATION',
  'QUALITY_GATE',
  'DECISION',
  'OVERLAY',
];

export default function DeveloperView() {
  const [diagnostics, setDiagnostics] = useState<DeveloperDiagnostics | null>(null);
  const [qualityTraces, setQualityTraces] = useState<any[]>([]);
  const [selfTestReport, setSelfTestReport] = useState<any | null>(null);
  const [captureStatus, setCaptureStatus] = useState<string>('');
  const [replayPath, setReplayPath] = useState<string>('');
  const [observationJson, setObservationJson] = useState<string>('');
  const [replayStatus, setReplayStatus] = useState<string>('');

  useEffect(() => {
    invokeIpc<DeveloperDiagnostics>(IPC_INVOKE_CHANNELS.GET_DIAGNOSTICS)
      .then(setDiagnostics)
      .catch(() => {});

    invokeIpc<any[]>(IPC_INVOKE_CHANNELS.GET_SIGNAL_QUALITY_TRACES)
      .then((data) => { if (Array.isArray(data)) setQualityTraces(data); })
      .catch(() => {});

    invokeIpc<any>(IPC_INVOKE_CHANNELS.GET_SELF_TEST_REPORT)
      .then(setSelfTestReport)
      .catch(() => {});

    const timer = setInterval(() => {
      invokeIpc<any[]>(IPC_INVOKE_CHANNELS.GET_SIGNAL_QUALITY_TRACES)
        .then((data) => { if (Array.isArray(data)) setQualityTraces(data); })
        .catch(() => {});
      invokeIpc<any>(IPC_INVOKE_CHANNELS.GET_SELF_TEST_REPORT)
        .then(setSelfTestReport)
        .catch(() => {});
    }, 3000);

    return () => clearInterval(timer);
  }, []);

  useIpcListener(IPC_CHANNELS.DEVELOPER_DIAGNOSTICS, (data: unknown) => {
    setDiagnostics(data as DeveloperDiagnostics);
  });

  const handleCapture = async () => {
    setCaptureStatus('Capturing…');
    try {
      const result = await invokeIpc<{ success: boolean; path?: string; error?: string }>(
        IPC_INVOKE_CHANNELS.TRIGGER_DIAGNOSTIC_CAPTURE
      );
      if (!result?.success) {
        setCaptureStatus(result?.error || 'Capture failed');
        return;
      }
      const latest = await invokeIpc<DeveloperDiagnostics>(IPC_INVOKE_CHANNELS.GET_DIAGNOSTICS);
      setDiagnostics(latest);
      setCaptureStatus(result.path ? `Saved: ${result.path}` : 'Capture saved');
    } catch (error) {
      setCaptureStatus(error instanceof Error ? error.message : 'Capture failed');
    }
  };

  const runReplay = async (
    channel: typeof IPC_INVOKE_CHANNELS.RUN_SAVED_FRAME | typeof IPC_INVOKE_CHANNELS.START_OBSERVATION_REPLAY,
    payload: string
  ) => {
    if (!payload.trim()) {
      setReplayStatus('Replay input is required');
      return;
    }
    setReplayStatus('Replay running…');
    try {
      const result = await invokeIpc<any>(channel, payload.trim());
      setReplayStatus(result?.success === false ? (result.error || 'Replay failed') : 'Replay completed');
      const latest = await invokeIpc<DeveloperDiagnostics>(IPC_INVOKE_CHANNELS.GET_DIAGNOSTICS);
      setDiagnostics(latest);
    } catch (error) {
      setReplayStatus(error instanceof Error ? error.message : 'Replay failed');
    }
  };

  const stopReplay = async () => {
    try {
      await invokeIpc(IPC_INVOKE_CHANNELS.STOP_REPLAY);
      setReplayStatus('Replay stopped');
    } catch (error) {
      setReplayStatus(error instanceof Error ? error.message : 'Unable to stop replay');
    }
  };

  const getStageStatus = (stageName: string): string => {
    if (!diagnostics?.latestReport?.stages) return 'PENDING';
    const trace = diagnostics.latestReport.stages.find((s) => s.stage === stageName);
    if (!trace) return 'PENDING';
    return trace.status;
  };

  const getStageColor = (status: string): string => {
    switch (status) {
      case 'PASS': return 'var(--color-emerald)';
      case 'PARTIAL': return 'var(--color-amber)';
      case 'FAIL': return 'var(--color-coral)';
      default: return 'var(--color-muted)';
    }
  };

  // Sprint T7: Live Decision Trace & Trade Debugger State
  const [debuggerEnabled, setDebuggerEnabled] = useState<boolean>(false);
  const [scanTraces, setScanTraces] = useState<any[]>([]);
  const [changeLogs, setChangeLogs] = useState<any[]>([]);
  const [activeTradeDebug, setActiveTradeDebug] = useState<any[]>([]);

  useEffect(() => {
    invokeIpc<{ enabled: boolean }>(IPC_INVOKE_CHANNELS.GET_DEBUGGER_ENABLED)
      .then((res) => {
        if (res) setDebuggerEnabled(res.enabled);
      })
      .catch(() => {});
  }, []);

  const toggleDebugger = async () => {
    const nextState = !debuggerEnabled;
    setDebuggerEnabled(nextState);
    await invokeIpc(IPC_INVOKE_CHANNELS.SET_DEBUGGER_ENABLED, nextState);
  };

  useEffect(() => {
    if (!debuggerEnabled) return;
    const fetchDebugData = () => {
      invokeIpc(IPC_INVOKE_CHANNELS.GET_LIVE_DECISION_TRACES, 20).then((data: any) => {
        if (Array.isArray(data)) setScanTraces(data);
      });
      invokeIpc(IPC_INVOKE_CHANNELS.GET_DECISION_CHANGE_LOGS, 20).then((data: any) => {
        if (Array.isArray(data)) setChangeLogs(data);
      });
      invokeIpc(IPC_INVOKE_CHANNELS.GET_RUNNING_TRADE_DEBUG).then((data: any) => {
        if (Array.isArray(data)) setActiveTradeDebug(data);
      });
    };
    fetchDebugData();
    // 5s poll (was 1s): the Diagnostics tab is a debugging aid, not a live
    // feed — 5s keeps it current with far less main-process/DB churn.
    const interval = setInterval(fetchDebugData, 5000);
    return () => clearInterval(interval);
  }, [debuggerEnabled]);

  const report = diagnostics?.latestReport;
  const traces: StageTrace[] = report?.stages || [];
  const failedTrace = traces.find((t) => t.status === 'FAIL');

  return (
    <div>
      <div className="command-center-header">
        <div className="header-title-group">
          <h1>DEVELOPER DIAGNOSTICS & LIVE DEBUGGER</h1>
          <p>Pipeline stage traces, decision trace engine & active trade debugger</p>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            className={`btn ${debuggerEnabled ? 'btn-danger' : 'btn-primary'}`}
            onClick={toggleDebugger}
          >
            {debuggerEnabled ? 'DISABLE LIVE TRACE DEBUGGER' : 'ENABLE LIVE TRACE DEBUGGER'}
          </button>
                    <button className="btn btn-secondary" onClick={handleCapture}>
            TRIGGER DIAGNOSTIC CAPTURE
          </button>
          {captureStatus && (
            <span style={{ maxWidth: '260px', fontSize: '10px', color: captureStatus.startsWith('Saved') || captureStatus === 'Capture saved' ? 'var(--color-emerald)' : 'var(--color-amber)', fontFamily: 'var(--font-mono)' }}>
              {captureStatus}
            </span>
          )}

        </div>
      </div>

      <GlassPanel style={{ marginBottom: '24px' }}>
        <div className="card-header-clean">
          <div className="card-title-clean"><span>DETERMINISTIC REPLAY WORKBENCH</span></div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Run saved evidence through the same scanner and decision pipeline</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px' }}>SAVED FRAME PATH</label>
            <input value={replayPath} onChange={(event) => setReplayPath(event.target.value)} placeholder="C:\\path\\to\\frame.png" style={{ width: '100%' }} />
            <button className="btn btn-secondary" style={{ marginTop: '8px' }} onClick={() => runReplay(IPC_INVOKE_CHANNELS.RUN_SAVED_FRAME, replayPath)}>RUN FRAME REPLAY</button>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px' }}>OBSERVATION JSON</label>
            <textarea value={observationJson} onChange={(event) => setObservationJson(event.target.value)} placeholder='{"asset":"Demo","currentPrice":100}' rows={3} style={{ width: '100%', resize: 'vertical' }} />
            <button className="btn btn-secondary" style={{ marginTop: '8px' }} onClick={() => runReplay(IPC_INVOKE_CHANNELS.START_OBSERVATION_REPLAY, observationJson)}>RUN OBSERVATION REPLAY</button>
          </div>
        </div>
        {replayStatus && <div style={{ marginTop: '10px', fontSize: '11px', color: replayStatus.includes('completed') || replayStatus.includes('stopped') ? 'var(--color-emerald)' : 'var(--color-amber)', fontFamily: 'var(--font-mono)' }}>{replayStatus}</div>}
        <button className="btn btn-danger" style={{ marginTop: '10px' }} onClick={stopReplay}>STOP REPLAY</button>
      </GlassPanel>

      {/* Task T7.3: Active Running Trade Debugger Panel */}
      {debuggerEnabled && (
        <GlassPanel auroraBorder style={{ marginBottom: '24px' }}>
          <div className="card-header-clean">
            <div className="card-title-clean">
              <span style={{ color: 'var(--accent-cyan)' }}>RUNNING TRADE DEBUGGER</span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{activeTradeDebug.length} Active Positions Under Debugging</span>
          </div>

          <div style={{ marginTop: '12px' }}>
            {activeTradeDebug.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
                No active trades running. Engine will capture entries automatically upon detection.
              </div>
            ) : (
              <table className="terminal-table">
                <thead>
                  <tr>
                    <th>TRADE ID</th>
                    <th>ASSET</th>
                    <th>DIR</th>
                    <th>ENTRY PRICE</th>
                    <th>CURRENT PRICE</th>
                    <th>REMAINING</th>
                    <th>STATE</th>
                    <th>CURRENT SIGNAL</th>
                    <th>CONF</th>
                  </tr>
                </thead>
                <tbody>
                  {activeTradeDebug.map((t) => (
                    <tr key={t.tradeId}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{t.tradeId}</td>
                      <td style={{ fontWeight: 700 }}>{t.asset}</td>
                      <td style={{ fontWeight: 800, color: t.direction === 'BUY' ? 'var(--color-emerald)' : 'var(--color-coral)' }}>{t.direction}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{t.entryPrice || 'LIVE'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>{t.currentPrice || 'LIVE'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{t.remainingSeconds}s</td>
                      <td style={{ fontWeight: 700, fontSize: '11px' }}>{t.tradeState}</td>
                      <td style={{ fontWeight: 700 }}>{t.currentSignal}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{t.currentConfidence}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </GlassPanel>
      )}

      {/* Task T7.2: Decision Change Log Panel */}
      {debuggerEnabled && (
        <GlassPanel style={{ marginBottom: '24px' }}>
          <div className="card-header-clean">
            <div className="card-title-clean">
              <span style={{ color: 'var(--color-amber)' }}>DECISION CHANGE LOG (SIGNAL FLIP AUDIT)</span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{changeLogs.length} Signal Transitions Recorded</span>
          </div>

          <div style={{ marginTop: '12px' }}>
            {changeLogs.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
                No signal transitions recorded yet. Signals will log transitions when directions or states flip.
              </div>
            ) : (
              <table className="terminal-table">
                <thead>
                  <tr>
                    <th>TIME</th>
                    <th>TRANSITION</th>
                    <th>CAUSATIVE ENGINE</th>
                    <th>CONFIDENCE SHIFT</th>
                    <th>WHAT CHANGED</th>
                  </tr>
                </thead>
                <tbody>
                  {changeLogs.map((log) => (
                    <tr key={log.logId}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{new Date(log.timestamp).toLocaleTimeString()}</td>
                      <td style={{ fontWeight: 800 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{log.oldDecision}</span>
                        <span style={{ margin: '0 6px', color: 'var(--accent-cyan)' }}>&rarr;</span>
                        <span style={{ color: log.newDecision === 'BUY' ? 'var(--color-emerald)' : log.newDecision === 'SELL' ? 'var(--color-coral)' : 'var(--color-amber)' }}>{log.newDecision}</span>
                      </td>
                      <td>
                        <span className="status-chip" style={{ fontSize: '10px', background: 'rgba(255, 171, 0, 0.1)', color: 'var(--color-amber)' }}>
                          {log.causativeEngine}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{log.oldConfidence}% &rarr; {log.newConfidence}%</td>
                      <td style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{log.whatChanged}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </GlassPanel>
      )}

      {/* Task T7.1: Live Decision Trace Feed Panel */}
      {debuggerEnabled && (
        <GlassPanel style={{ marginBottom: '24px' }}>
          <div className="card-header-clean">
            <div className="card-title-clean">
              <span>LIVE SCAN DECISION TRACE FEED</span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{scanTraces.length} Scan Frames Trace Buffer</span>
          </div>

          <div style={{ marginTop: '12px', maxHeight: '400px', overflowY: 'auto' }}>
            {scanTraces.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0' }}>
                No scan traces recorded yet. Active scanning will record full multi-factor traces.
              </div>
            ) : (
              <table className="terminal-table">
                <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0d131f' }}>
                  <tr>
                    <th>TIME</th>
                    <th>ASSET</th>
                    <th>DECISION</th>
                    <th>CONF</th>
                    <th>TREND</th>
                    <th>STRUCTURE</th>
                    <th>MOMENTUM</th>
                    <th>REGIME</th>
                    <th>RSI</th>
                    <th>EMA</th>
                    <th>REASONS</th>
                  </tr>
                </thead>
                <tbody>
                  {scanTraces.map((t) => (
                    <tr key={t.scanId}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{new Date(t.timestamp).toLocaleTimeString()}</td>
                      <td style={{ fontWeight: 700 }}>{t.asset || 'EUR/USD'}</td>
                      <td style={{ fontWeight: 800, color: t.finalDecision === 'BUY' ? 'var(--color-emerald)' : t.finalDecision === 'SELL' ? 'var(--color-coral)' : 'var(--color-amber)' }}>{t.finalDecision}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{t.confidence}%</td>
                      <td style={{ fontSize: '11px' }}>{t.trend}</td>
                      <td style={{ fontSize: '11px' }}>{t.structure}</td>
                      <td style={{ fontSize: '11px' }}>{t.momentum}</td>
                      <td style={{ fontSize: '11px', color: 'var(--accent-cyan)' }}>{t.marketRegime}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{t.rsi ? t.rsi.toFixed(1) : '\u2014'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{t.ema ? t.ema.toFixed(2) : '\u2014'}</td>
                      <td style={{ fontSize: '10px', color: 'var(--text-muted)', maxWidth: '200px' }}>{(t.reasons || []).join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </GlassPanel>
      )}

      {/* Pipeline Flowchart Visualization */}
      <GlassPanel auroraBorder style={{ marginBottom: '24px' }}>
        <div className="card-header-clean">
          <div className="card-title-clean">
            <span>PIPELINE STAGE TRACE FLOW</span>
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Pipeline Duration: {report?.pipelineDurationMs || 0}ms
          </span>
        </div>

        <div className="metric-grid" style={{ marginTop: '16px' }}>
          {ALL_PIPELINE_STAGES.map((stage) => {
            const status = getStageStatus(stage);
            const dotClass = status === 'PASS' ? 'green' : status === 'FAIL' ? 'red' : status === 'PARTIAL' ? 'yellow' : 'muted';
            return (
              <div key={stage} className="metric-item" style={{ borderColor: getStageColor(status) }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  <div className={`dot ${dotClass}`} />
                  <span style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: getStageColor(status) }}>
                    {stage}
                  </span>
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  {status}
                </div>
              </div>
            );
          })}
        </div>
      </GlassPanel>

      {/* Pipeline Stats Grid */}
      <div className="grid-4" style={{ marginBottom: '24px' }}>
        <GlassPanel>
          <div className="metric-label">SCAN CADENCE</div>
          <div className="metric-value">{diagnostics?.scanCadenceMs || 2000}ms</div>
        </GlassPanel>

        <GlassPanel>
          <div className="metric-label">PIPELINE DURATION</div>
          <div className="metric-value" style={{ color: 'var(--accent-cyan)' }}>
            {report?.pipelineDurationMs || 0}ms
          </div>
        </GlassPanel>

        <GlassPanel>
          <div className="metric-label">FRAMES PROCESSED</div>
          <div className="metric-value">{diagnostics?.framesProcessed || 0}</div>
        </GlassPanel>

        <GlassPanel>
          <div className="metric-label">PIPELINE ERRORS</div>
          <div className="metric-value" style={{ color: (diagnostics?.pipelineErrorCount || 0) > 0 ? 'var(--color-coral)' : 'var(--text-primary)' }}>
            {diagnostics?.pipelineErrorCount || 0}
          </div>
        </GlassPanel>
      </div>

      {/* Failure Highlight Banner */}
      {failedTrace ? (
        <GlassPanel style={{ borderLeft: '4px solid var(--color-coral)', marginBottom: '24px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-coral)', marginBottom: '4px' }}>
            FIRST FAILED STAGE DETECTED: {failedTrace.stage}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            {failedTrace.detail || 'Stage failed validation'}
          </div>
        </GlassPanel>
      ) : null}

      {/* Detailed Stage Trace Table */}
      <GlassPanel style={{ padding: 0 }}>
        <table className="terminal-table">
          <thead>
            <tr>
              <th>STAGE</th>
              <th>STATUS</th>
              <th>DURATION (MS)</th>
              <th>STAGE DETAIL / ERROR</th>
            </tr>
          </thead>
          <tbody>
            {traces.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                  NO DIAGNOSTIC TRACES RECORDED YET
                </td>
              </tr>
            ) : (
              traces.map((trace, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {trace.stage}
                  </td>
                  <td>
                    <span style={{
                      fontWeight: 700,
                      fontSize: '11px',
                      color: getStageColor(trace.status)
                    }}>
                      {trace.status}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>
                    {trace.durationMs}ms
                  </td>
                  <td style={{ maxWidth: '400px', color: trace.status === 'FAIL' ? 'var(--color-coral)' : 'var(--text-secondary)' }}>
                    {trace.detail || '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </GlassPanel>
      {/* Task 1 & 5: Live Signal Quality Inspector & Self-Test Panel */}
      <GlassPanel style={{ marginTop: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '14px', letterSpacing: '0.05em' }}>LIVE SIGNAL QUALITY INSPECTOR & 10-LINK PIPELINE TRACES</h3>
          <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', background: selfTestReport?.dataIntegrityStatus === 'HEALTHY' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)', color: selfTestReport?.dataIntegrityStatus === 'HEALTHY' ? 'var(--color-emerald)' : 'var(--color-amber)' }}>
            SELF-TEST: {selfTestReport?.dataIntegrityStatus || 'RUNNING'} ({selfTestReport?.totalSignalsAudited || 0} SIGNALS AUDITED)
          </span>
        </div>

        {qualityTraces.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
            NO RUNTIME SIGNAL TRACES CAPTURED YET
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {qualityTraces.slice(0, 5).map((q, idx) => (
              <div key={idx} style={{ padding: '12px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                  <span style={{ fontWeight: 700 }}>ID: {q.signalId}</span>
                  <span style={{ color: q.direction === 'BUY' ? 'var(--color-emerald)' : q.direction === 'SELL' ? 'var(--color-coral)' : 'var(--color-amber)', fontWeight: 700 }}>
                    {q.direction} ({q.confidence}%)
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  EXPLANATION: {q.explanation?.decisionReason || 'Standard pattern match'} | MOST CONTRIB: {q.explanation?.mostContributedEvidence || 'Trend'}
                </div>
                <div style={{ display: 'flex', gap: '8px', fontSize: '10px', fontWeight: 700 }}>
                  <span style={{ padding: '2px 6px', borderRadius: '3px', background: q.verificationResult === 'CORRECT' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.1)', color: q.verificationResult === 'CORRECT' ? 'var(--color-emerald)' : 'var(--text-primary)' }}>
                    VERIFICATION: {q.verificationResult}
                  </span>
                  <span style={{ padding: '2px 6px', borderRadius: '3px', background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' }}>
                    TRADE LINKED: {q.tradeLinked ? 'YES' : 'NO'}
                  </span>
                  <span style={{ padding: '2px 6px', borderRadius: '3px', background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc' }}>
                    KNOWLEDGE LINKED: {q.knowledgeLinked ? 'YES' : 'NO'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
