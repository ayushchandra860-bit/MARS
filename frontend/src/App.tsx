import React, { useState, useEffect } from 'react';
import { useIpcListener, invokeIpc } from './hooks/useIpc';
import { IPC_CHANNELS, IPC_INVOKE_CHANNELS } from '../../shared/contracts/ipc-channels';
import { ControlCenterState, AppSettings } from '../../shared/types/ipc';

import DashboardView from './control-center/DashboardView';
import HistoryView from './control-center/HistoryView';
import PerformanceView from './control-center/PerformanceView';
import JournalView from './control-center/JournalView';
import AnalyticsView from './control-center/AnalyticsView';
import SettingsView from './control-center/SettingsView';

type NavTab = 'workstation' | 'command' | 'analytics' | 'journal' | 'history' | 'performance' | 'settings';
export type BootState = 'BOOTING' | 'READY' | 'FAILED';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('workstation');
  const [controlState, setControlState] = useState<ControlCenterState | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [bootState, setBootState] = useState<BootState>('BOOTING');
  const [isFocusMode, setIsFocusMode] = useState<boolean>(false);
  const [browserTitle, setBrowserTitle] = useState<string>('Olymp Trade Trading Platform');

  useEffect(() => {
    invokeIpc(IPC_INVOKE_CHANNELS.GET_CONTROL_STATE)
      .then((state: unknown) => {
        if (state) {
          setControlState(state as ControlCenterState);
          setBootState('READY');
        }
      })
      .catch(() => setBootState('FAILED'));

    invokeIpc(IPC_INVOKE_CHANNELS.GET_SETTINGS)
      .then((fetchedSettings: unknown) => {
        if (fetchedSettings) {
          setSettings(fetchedSettings as AppSettings);
        }
      })
      .catch(() => {});
  }, []);

  useIpcListener(IPC_CHANNELS.CONTROL_STATE_UPDATE, (state: unknown) => {
    if (state) {
      setControlState(state as ControlCenterState);
      setBootState('READY');
    }
  });

  useIpcListener(IPC_CHANNELS.BROWSER_TITLE_UPDATED, (title: unknown) => {
    if (typeof title === 'string' && title.trim()) {
      setBrowserTitle(title);
    }
  });

  const handleTabChange = (tab: NavTab) => {
    setActiveTab(tab);
    if ((window as any).electronAPI && typeof (window as any).electronAPI.switchTab === 'function') {
      (window as any).electronAPI.switchTab(tab);
    } else {
      invokeIpc('switch-tab', tab).catch(() => {});
    }
  };

  const handleToggleFocusMode = () => {
    invokeIpc(IPC_INVOKE_CHANNELS.BROWSER_TOGGLE_FOCUS).then((res: any) => {
      if (res && typeof res.isFocusMode === 'boolean') {
        setIsFocusMode(res.isFocusMode);
      } else {
        setIsFocusMode((prev) => !prev);
      }
    });
  };

  const isRunning = controlState?.analysisState === 'RUNNING';

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0a0e17' }}>
      {/* Permanent 36px Workstation Navigation Toolbar */}
      <div style={{
        height: '36px',
        minHeight: '36px',
        background: '#06090e',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        zIndex: 2000,
        userSelect: 'none',
      }}>
        {/* Left: Navigation Actions & Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            title="Go Back"
            onClick={() => invokeIpc(IPC_INVOKE_CHANNELS.BROWSER_GO_BACK)}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>

          <button
            title="Go Forward"
            onClick={() => invokeIpc(IPC_INVOKE_CHANNELS.BROWSER_GO_FORWARD)}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>

          <button
            title="Reload Page"
            onClick={() => invokeIpc(IPC_INVOKE_CHANNELS.BROWSER_RELOAD)}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>

          <button
            title="Platform Home"
            onClick={() => invokeIpc(IPC_INVOKE_CHANNELS.BROWSER_LOAD_URL, 'https://olymptrade.com/platform')}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
            </svg>
          </button>

          <div style={{ width: '1px', height: '14px', background: 'rgba(255, 255, 255, 0.12)', margin: '0 4px' }} />

          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {browserTitle}
          </div>
        </div>

        {/* Right: Scan Toggle Pill & Fullscreen Maximize Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            className={`btn ${isRunning ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              if (isRunning) {
                invokeIpc(IPC_INVOKE_CHANNELS.STOP_ANALYSIS);
              } else {
                invokeIpc(IPC_INVOKE_CHANNELS.START_ANALYSIS);
              }
            }}
            style={{ padding: '3px 12px', fontSize: '11px', fontWeight: 700, borderRadius: '4px' }}
          >
            {isRunning ? 'STOP SCAN' : 'START ANALYSIS'}
          </button>

          <button
            title={isFocusMode ? 'Restore Normal Mode' : 'Focus Mode (Fullscreen Chart)'}
            onClick={handleToggleFocusMode}
            style={{
              background: isFocusMode ? 'var(--accent-cyan)' : 'rgba(255, 255, 255, 0.08)',
              color: isFocusMode ? '#000' : 'var(--text-primary)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '4px',
              padding: '3px 10px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75v4.5m0-4.5h-4.5m4.5 0L15 9m5.25 11.25v-4.5m0 4.5h-4.5m4.5 0L15 15" />
            </svg>
            <span>{isFocusMode ? 'EXIT FOCUS' : 'FOCUS MODE'}</span>
          </button>

          <div style={{ display: 'flex', overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '4px' }}>
            <button title="Zoom out chart" onClick={() => invokeIpc(IPC_INVOKE_CHANNELS.BROWSER_ZOOM_OUT)} style={{ border: 'none', background: 'rgba(255,255,255,0.08)', color: 'var(--text-primary)', padding: '3px 9px', cursor: 'pointer' }}>−</button>
            <button title="Reset chart zoom" onClick={() => invokeIpc(IPC_INVOKE_CHANNELS.BROWSER_ZOOM_RESET)} style={{ border: 'none', borderLeft: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.08)', color: 'var(--text-primary)', padding: '3px 8px', cursor: 'pointer', fontSize: '10px' }}>100%</button>
            <button title="Zoom in chart" onClick={() => invokeIpc(IPC_INVOKE_CHANNELS.BROWSER_ZOOM_IN)} style={{ border: 'none', borderLeft: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.08)', color: 'var(--text-primary)', padding: '3px 9px', cursor: 'pointer' }}>+</button>
          </div>

          <div style={{ display: 'flex', overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: '4px' }}>
            <button title="Minimize MARS" onClick={() => invokeIpc(IPC_INVOKE_CHANNELS.MINIMIZE_WINDOW)} style={{ border: 'none', background: 'rgba(255,255,255,0.08)', color: 'var(--text-primary)', padding: '3px 9px', cursor: 'pointer' }}>—</button>
            <button title="Maximize or restore MARS" onClick={() => invokeIpc(IPC_INVOKE_CHANNELS.MAXIMIZE_WINDOW)} style={{ border: 'none', borderLeft: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.08)', color: 'var(--text-primary)', padding: '3px 9px', cursor: 'pointer' }}>□</button>
            <button title="Close MARS" onClick={() => invokeIpc(IPC_INVOKE_CHANNELS.CLOSE_WINDOW)} style={{ border: 'none', borderLeft: '1px solid rgba(255,255,255,0.12)', background: '#a83d4a', color: '#fff', padding: '3px 9px', cursor: 'pointer' }}>×</button>
          </div>
        </div>
      </div>

      <div className="app-container" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left Navigation Sidebar (Collapsible in Focus Mode) */}
        {!isFocusMode && (
          <div className="app-sidebar" style={{ width: '240px', minWidth: '240px', zIndex: 1000, background: '#0a0e17', borderRight: '1px solid rgba(255,255,255,0.08)' }}>
            <div>
              <div className="sidebar-header">
                <div className="sidebar-logo">
                  <div className="sidebar-logo-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                    </svg>
                  </div>
                  <div className="sidebar-logo-text">
                    <span className="sidebar-logo-name">MARS PRO</span>
                    <span className="sidebar-logo-sub">AI WORKSTATION</span>
                  </div>
                </div>
              </div>

              <div className="nav-section">
                <div className="nav-section-title">Navigation</div>

                <button
                  className={`nav-item ${activeTab === 'workstation' ? 'active' : ''}`}
                  onClick={() => handleTabChange('workstation')}
                >
                  <div className="nav-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18zM3.6 9h16.8M3.6 15h16.8" />
                    </svg>
                  </div>
                  <span>Browser Workstation</span>
                </button>

                <button
                  className={`nav-item ${activeTab === 'analytics' ? 'active' : ''}`}
                  onClick={() => handleTabChange('analytics')}
                >
                  <div className="nav-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z" />
                    </svg>
                  </div>
                  <span>Analytics & Intelligence</span>
                </button>

                <button
                  className={`nav-item ${activeTab === 'journal' ? 'active' : ''}`}
                  onClick={() => handleTabChange('journal')}
                >
                  <div className="nav-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18c-2.305 0-4.408.867-6 2.292m0-14.25v14.25" />
                    </svg>
                  </div>
                  <span>Trade Journal</span>
                </button>

                <button
                  className={`nav-item ${activeTab === 'command' ? 'active' : ''}`}
                  onClick={() => handleTabChange('command')}
                >
                  <div className="nav-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                    </svg>
                  </div>
                  <span>Command Center</span>
                </button>

                <button
                  className={`nav-item ${activeTab === 'performance' ? 'active' : ''}`}
                  onClick={() => handleTabChange('performance')}
                >
                  <div className="nav-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                    </svg>
                  </div>
                  <span>Performance</span>
                </button>

                <button
                  className={`nav-item ${activeTab === 'history' ? 'active' : ''}`}
                  onClick={() => handleTabChange('history')}
                >
                  <div className="nav-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
                    </svg>
                  </div>
                  <span>Signal Log & Cleanup</span>
                </button>

                <button
                  className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
                  onClick={() => handleTabChange('settings')}
                >
                  <div className="nav-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <span>Settings</span>
                </button>
              </div>
            </div>

            <div className="sidebar-footer">
              {/* Live mini-status widget */}
              <div style={{
                padding: '10px 12px',
                background: 'rgba(13, 19, 32, 0.6)',
                border: '1px solid var(--glass-border)',
                borderRadius: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}>
                {/* Engine badge + state */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.5px' }}>ENGINE</span>
                  <span style={{
                    fontSize: '10px', fontWeight: 800, fontFamily: 'var(--font-mono)',
                    color: isRunning ? 'var(--color-emerald)' : 'var(--text-muted)',
                    padding: '1px 6px', borderRadius: '4px',
                    background: isRunning ? 'rgba(0, 255, 170, 0.1)' : 'transparent',
                  }}>
                    {isRunning ? '● LIVE' : '○ IDLE'}
                  </span>
                </div>

                {/* Asset */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>ASSET</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: controlState?.asset ? 'var(--text-primary)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {controlState?.asset || '—'}
                  </span>
                </div>

                {/* Signals */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>SIGNALS</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>
                    {controlState?.totalSignals ?? 0}
                  </span>
                </div>

                {/* Version tag */}
                <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '6px', display: 'flex', justifyContent: 'center' }}>
                  <span style={{ fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '1px', fontWeight: 700 }}>
                    MARS PRO V3
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* View Router Main Content Area */}
        <div className="app-content" style={{ flex: 1, position: 'relative', overflowY: 'auto', background: '#0a0e17' }}>
          {activeTab === 'workstation' && (
            <div style={{ width: '100%', height: '100%', position: 'relative' }} />
          )}

          {activeTab === 'command' && (
            <DashboardView
              state={controlState}
              bootState={bootState}
              onRetry={() => {
                invokeIpc(IPC_INVOKE_CHANNELS.GET_CONTROL_STATE)
                  .then((state: unknown) => {
                    if (state) setControlState(state as ControlCenterState);
                  });
              }}
            />
          )}

          {activeTab === 'analytics' && <AnalyticsView />}
          {activeTab === 'journal' && <JournalView />}
          {activeTab === 'history' && <HistoryView />}
          {activeTab === 'performance' && <PerformanceView />}
          {activeTab === 'settings' && (
            <SettingsView settings={settings} onUpdate={(u) => setSettings(u)} />
          )}
        </div>
      </div>
    </div>
  );
}
