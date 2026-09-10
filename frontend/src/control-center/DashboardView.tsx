import React, { useState, useEffect } from 'react';
import { ControlCenterState } from '../../../shared/types/ipc';
import { invokeIpc } from '../hooks/useIpc';
import { IPC_INVOKE_CHANNELS } from '../../../shared/contracts/ipc-channels';
import { AnalysisState } from '../../../shared/types/session';

import { GlassPanel } from '../components/GlassPanel';
import { AICore } from '../components/AICore';
import { ActiveTradesPanel } from '../components/ActiveTradesPanel';
import { BootState } from '../App';

interface DashboardViewProps {
  state: ControlCenterState | null;
  bootState?: BootState;
  onRetry?: () => void;
}

export default function DashboardView({ state, bootState = 'READY', onRetry }: DashboardViewProps) {
  const [elapsedTime, setElapsedTime] = useState<string>('00:00:00');
  const sessionStartRef = React.useRef<number | null>(null);

  // Track session timer
  useEffect(() => {
    if (state?.analysisState === AnalysisState.RUNNING) {
      if (!sessionStartRef.current) sessionStartRef.current = Date.now();
      const interval = setInterval(() => {
        if (sessionStartRef.current) {
          const diff = Math.floor((Date.now() - sessionStartRef.current) / 1000);
          const hrs = Math.floor(diff / 3600).toString().padStart(2, '0');
          const mins = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
          const secs = (diff % 60).toString().padStart(2, '0');
          setElapsedTime(`${hrs}:${mins}:${secs}`);
        }
      }, 1000);
      return () => clearInterval(interval);
    } else {
      sessionStartRef.current = null;
      setElapsedTime('00:00:00');
    }
  }, [state?.analysisState]);

  if (bootState === 'BOOTING' || (!state && bootState !== 'FAILED')) {
    return (
      <GlassPanel style={{ textAlign: 'center', padding: '60px' }}>
        <div className="dot blue pulsating" style={{ margin: '0 auto 16px auto', width: '16px', height: '16px' }} />
        <div style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '1px', color: 'var(--text-primary)', marginBottom: '6px' }}>
          CONNECTING TO MARS CORE...
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Establishing IPC state channel bridge
        </div>
      </GlassPanel>
    );
  }

  if (bootState === 'FAILED' || !state) {
    return (
      <GlassPanel style={{ borderLeft: '4px solid var(--color-coral)', padding: '40px' }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-coral)', marginBottom: '8px' }}>
          SYSTEM ATTENTION REQUIRED
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.6 }}>
          Could not establish initial state synchronization with MARS Main Process. Please verify Electron background process status.
        </div>
        {onRetry && (
          <button className="btn btn-primary" onClick={onRetry}>
            RETRY INITIALIZATION
          </button>
        )}
      </GlassPanel>
    );
  }

  const isRunning = state.analysisState === AnalysisState.RUNNING;
  const isStarting = state.analysisState === AnalysisState.STARTING;
  const isStopping = state.analysisState === AnalysisState.STOPPING;

  const handleStartStop = () => {
    if (isRunning || isStarting) {
      invokeIpc(IPC_INVOKE_CHANNELS.STOP_ANALYSIS);
    } else {
      invokeIpc(IPC_INVOKE_CHANNELS.START_ANALYSIS);
    }
  };

  const handleToggleOverlay = () => {
    invokeIpc(IPC_INVOKE_CHANNELS.TOGGLE_OVERLAY);
  };

  return (
    <div>
      {/* Command Center Header */}
      <div className="command-center-header">
        <div className="header-title-group">
          <h1>COMMAND CENTER</h1>
          <p>System status & real-time execution oversight</p>
        </div>

        <div className="header-actions">
          <button
            className={`btn ${isRunning ? 'btn-danger' : 'btn-primary'}`}
            onClick={handleStartStop}
            disabled={isStarting || isStopping}
          >
            {isStarting ? 'STARTING...' : isStopping ? 'STOPPING...' : isRunning ? 'STOP ANALYSIS' : 'START ANALYSIS'}
          </button>

          <button
            className={`btn ${state.overlayVisible ? 'btn-secondary' : 'btn-primary'}`}
            onClick={handleToggleOverlay}
          >
            {state.overlayVisible ? 'HIDE OVERLAY' : 'SHOW OVERLAY'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Hero Control Area */}
        <GlassPanel auroraBorder style={{ textAlign: 'center', padding: '36px 20px' }}>
          <AICore
            analysisState={state.analysisState}
            systemStatus={state.systemStatus}
          />

          <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'center', gap: '16px' }}>
            <button
              className={`btn-hero ${isRunning || isStarting ? 'stop' : 'start'}`}
              onClick={handleStartStop}
              disabled={isStarting || isStopping}
            >
              {isStarting ? (
                <span>INITIALIZING...</span>
              ) : isStopping ? (
                <span>STOPPING...</span>
              ) : isRunning ? (
                <span>STOP ANALYSIS</span>
              ) : (
                <span>START ANALYSIS</span>
              )}
            </button>

            <button
              className="btn-hero"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--glass-border)',
                color: 'var(--text-primary)',
                boxShadow: 'none',
              }}
              onClick={handleToggleOverlay}
            >
              {state.overlayVisible ? 'HIDE OVERLAY' : 'SHOW OVERLAY'}
            </button>
          </div>
        </GlassPanel>

        {/* Live Session Strip */}
        <div className="session-strip">
          <div className="strip-item">
            <span className="strip-item-label">DETECTED ASSET</span>
            <span className="strip-item-value">{state.asset || 'Awaiting detection'}</span>
          </div>

          <div className="strip-item">
            <span className="strip-item-label">TIMEFRAME</span>
            <span className="strip-item-value">{state.timeframe || '\u2014'}</span>
          </div>

          <div className="strip-item">
            <span className="strip-item-label">SESSION DURATION</span>
            <span className="strip-item-value">{elapsedTime}</span>
          </div>

          <div className="strip-item">
            <span className="strip-item-label">TOTAL SIGNALS</span>
            <span className="strip-item-value">{state.totalSignals}</span>
          </div>

          <div className="strip-item">
            <span className="strip-item-label">LAST UPDATE</span>
            <span className="strip-item-value">
              {state.lastUpdate ? new Date(state.lastUpdate).toLocaleTimeString() : '\u2014'}
            </span>
          </div>
        </div>

        <ActiveTradesPanel />
        {/* Market Intelligence Context Card */}
        <GlassPanel>
          <div className="card-header-clean">
            <div className="card-title-clean">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12 12 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.516 0c.85.493 1.508 1.333 1.508 2.316V18" />
              </svg>
              <span>MARKET INTELLIGENCE CONTEXT</span>
            </div>
            <span style={{ fontSize: '11px', color: isRunning ? 'var(--color-emerald)' : 'var(--text-muted)' }}>
              {isRunning ? '● LIVE FEED' : '○ OFFLINE'}
            </span>
          </div>

          {!isRunning ? (
            <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
              AI ENGINE OFFLINE — Start analysis to begin real-time market observation.
            </div>
          ) : (
            <div style={{ marginTop: '12px' }}>
              {/* Primary metrics row */}
              <div className="grid-4" style={{ marginBottom: '16px' }}>
                <div className="metric-item">
                  <div className="metric-label">System Status</div>
                  <div className="metric-value" style={{ fontSize: '13px', color: state.systemStatus === 'READY' ? 'var(--color-emerald)' : 'var(--color-amber)' }}>
                    {state.systemStatus}
                  </div>
                </div>
                <div className="metric-item">
                  <div className="metric-label">Active Asset</div>
                  <div className="metric-value" style={{ fontSize: '13px', color: state.asset ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {state.asset || 'SCANNING...'}
                  </div>
                </div>
                <div className="metric-item">
                  <div className="metric-label">Timeframe</div>
                  <div className="metric-value" style={{ fontSize: '13px', color: 'var(--accent-cyan)' }}>
                    {state.timeframe || '—'}
                  </div>
                </div>
                <div className="metric-item">
                  <div className="metric-label">Signals Recorded</div>
                  <div className="metric-value" style={{ fontSize: '13px' }}>
                    {state.totalSignals}
                  </div>
                </div>
              </div>

              {/* Secondary metrics row */}
              <div className="grid-4">
                <div className="metric-item">
                  <div className="metric-label">Active Trades</div>
                  <div className="metric-value" style={{ fontSize: '13px', color: state.activeTradeCount > 0 ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
                    {state.activeTradeCount} OPEN
                  </div>
                </div>
                <div className="metric-item">
                  <div className="metric-label">Overlay Panel</div>
                  <div className="metric-value" style={{ fontSize: '13px', color: state.overlayVisible ? 'var(--color-emerald)' : 'var(--text-muted)' }}>
                    {state.overlayVisible ? 'VISIBLE' : 'HIDDEN'}
                  </div>
                </div>
                <div className="metric-item">
                  <div className="metric-label">Session</div>
                  <div className="metric-value" style={{ fontSize: '10px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {state.sessionId ? state.sessionId.slice(0, 12) + '...' : '—'}
                  </div>
                </div>
                <div className="metric-item">
                  <div className="metric-label">Last Update</div>
                  <div className="metric-value" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {state.lastUpdate ? new Date(state.lastUpdate).toLocaleTimeString() : '—'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </GlassPanel>
      </div>
    </div>
  );
}
