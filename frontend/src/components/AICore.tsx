import React from 'react';
import { AnalysisState, SystemStatus } from '../../../shared/types/session';

interface AICoreProps {
  analysisState: AnalysisState;
  systemStatus: SystemStatus;
}

export const AICore: React.FC<AICoreProps> = ({ analysisState, systemStatus }) => {
  const isRunning = analysisState === AnalysisState.RUNNING || analysisState === AnalysisState.STARTING;

  const getCoreClass = () => {
    if (systemStatus === SystemStatus.DEGRADED) return 'degraded';
    if (isRunning) return 'running';
    return 'stopped';
  };

  const getStatusLabel = () => {
    if (analysisState === AnalysisState.STARTING) return 'INITIALIZING CORE...';
    if (analysisState === AnalysisState.STOPPING) return 'HALTING AI CORE...';
    if (analysisState === AnalysisState.STOPPED) return 'AI ENGINE OFFLINE';
    if (systemStatus === SystemStatus.SCANNING) return 'SCANNING MARKET...';
    if (systemStatus === SystemStatus.READY) return 'AI MARKET MODEL ACTIVE';
    if (systemStatus === SystemStatus.DEGRADED) return 'DEGRADED CONTEXT';
    return 'SYSTEM OFFLINE';
  };

  return (
    <div className="ai-core-container">
      <div className="ai-core-wrapper">
        <div className="ai-core-ring-outer"></div>
        <div className="ai-core-ring-middle"></div>
        <div className={`ai-core-center ${getCoreClass()}`}>
          <svg className="ai-core-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.037-.501.08-.75.13s-.495.114-.738.191m1.488-.321c.5-.062 1.006-.1 1.517-.113m0 0a27.18 27.18 0 013.738.258m-3.738-.258a27.18 27.18 0 00-3.738.258m10.476 10.975l-4.091-4.091a2.25 2.25 0 01-.659-1.591V3.104m7.24 11.396a24.89 24.89 0 01-1.282 2.378 2.25 2.25 0 01-1.59.882H8.632a2.25 2.25 0 01-1.59-.882 24.88 24.88 0 01-1.282-2.378M12 21a9 9 0 100-18 9 9 0 000 18z" />
          </svg>
        </div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '1.5px',
          color: isRunning ? 'var(--accent-cyan)' : 'var(--text-muted)',
          textTransform: 'uppercase',
          marginBottom: '4px'
        }}>
          {getStatusLabel()}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          {isRunning ? 'Real-time observation active' : 'Click below to launch scanner'}
        </div>
      </div>
    </div>
  );
};
