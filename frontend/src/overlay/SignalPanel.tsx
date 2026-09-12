// ============================================================
// MARS PRO V3 â€” MARS SIGNAL Panel (single combined panel)
// Three sections in one window:
//   1. SIGNAL        â€” latched decision (stays until expiry/trade)
//   2. TRADE MONITOR â€” active trade analyzed to expiry (manual + signal equal)
//   3. MARKET INTEL  â€” compact essentials (regime, pressure, S&L, volatility)
// Draggable via the header, resizable via window edges; the whole panel
// zooms (font scales) with the window size.
// ============================================================

import React, { useState, useEffect, useRef } from 'react';

interface SignalPanelProps {
  state: any;
}

function SignalPanelComponent({ state }: SignalPanelProps) {
  const anyState = (state || {}) as any;
  const systemStatus = state?.systemStatus || anyState.systemStatus;
  const isOffline = systemStatus === 'UNAVAILABLE' || systemStatus === 'DEGRADED';

  const rawAsset = state?.asset || anyState.asset;
  const isAssetLocked = !!(rawAsset && rawAsset !== 'UNKNOWN');
  const activeTrade = state?.activeTradeContext || anyState.activeTradeContext || null;
  const tradeMonitor = state?.tradeMonitor || null;
  const lastTradeResult = state?.lastTradeResult || null;
  const bestSetup = state?.bestSetup || null;

  // ---- Font scaling: the window is resizable â€” zoom the whole panel so
  //      text grows/shrinks with the panel size (drag edges to resize).
  // Uses window.innerWidth (NOT ResizeObserver): panel-internal scrollbars
  // would otherwise change the content width and re-trigger zoom in a loop
  // that shows up as visible vibration.
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const apply = () => {
      const w = window.innerWidth;
      if (w > 0) {
        // 340px design width â†’ zoom 1.0; scale between 0.75x and 1.4x.
        const next = Math.max(0.75, Math.min(1.4, w / 340));
        setZoom((prev) => (Math.abs(prev - next) < 0.05 ? prev : next));
      }
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  // ---- Latched decision (never flip-flops back to WAIT) ----
  const rawAction = state?.decision || anyState.signal || anyState.action || 'WAIT';
  const actionText = isOffline
    ? (systemStatus === 'DEGRADED' ? 'DEGRADED' : 'UNAVAILABLE')
    : (!isAssetLocked ? 'SEARCHING' : (rawAction || 'WAIT'));

  // One absolute-time ticker drives both countdowns without recreating intervals.
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

  const normalizePercent = (value: unknown): number | null => {
    if (typeof value === 'number' && !isNaN(value)) {
      let normalized = value <= 1 ? value * 100 : value;
      if (normalized > 100 && normalized <= 10000) normalized = normalized / 100;
      return Math.max(0, Math.min(100, Math.round(normalized)));
    }
    if (typeof value === 'string') {
      const parsed = Number(value.replace('%', '').trim());
      if (!isNaN(parsed)) return normalizePercent(parsed);
    }
    return null;
  };

  const normalizePrice = (value: unknown): number | null => {
    const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, '').trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const calibrationActive = !!state?.calibrationActive;
  const winProb = typeof state?.winProbability === 'number' ? state.winProbability : null;

  let displayConfidence = '\u2014';
  if (!isOffline && isAssetLocked) {
    // Use calibrated win probability when available (honest journal-based),
    // otherwise fall back to raw confidence.
    if (calibrationActive && winProb !== null) {
      displayConfidence = winProb + '%';
    } else {
      const confPercent = normalizePercent(state?.confidence ?? anyState.confidence);
      if (confPercent !== null) displayConfidence = confPercent + '%';
    }
  }

  const rawStrength = state?.signalStrength ?? anyState.signalStrength;
  const strengthPercent = normalizePercent(rawStrength);

  const whyWaitText = anyState.whyWait || anyState.reason || state?.reasons?.[0] || 'Analyzing market structure & indicator confluence...';
  const whyTakeReasons: string[] = anyState.whyTake || state?.reasons || [];

  const displayReasons = isOffline
    ? [anyState.reason || (systemStatus === 'DEGRADED' ? 'Waiting for usable market evidence.' : 'Scanner offline')]
    : !isAssetLocked
    ? ['Searching active asset on chart...']
    : (actionText === 'BUY' || actionText === 'SELL')
    ? (whyTakeReasons.length > 0 ? whyTakeReasons : [anyState.reason || 'Confluence setup detected'])
    : [whyWaitText];

  let countdownDisplay = '--';
  if (!isOffline && isAssetLocked && (actionText === 'BUY' || actionText === 'SELL')) {
    const activeSec = typeof localVisualSec === 'number' ? localVisualSec : entryCountdownSec;
    if (typeof activeSec === 'number' && activeSec > 0) countdownDisplay = `${activeSec}s`;
    else if (activeSec === 0) countdownDisplay = 'NOW';
    else if (typeof entryGuidance === 'string' && entryGuidance.startsWith('ENTRY IN')) countdownDisplay = entryGuidance.replace('ENTRY IN', '').trim();
    else if (entryGuidance === 'ENTRY NOW') countdownDisplay = 'NOW';
    else countdownDisplay = '--';
  }

  const displayExpiry = isAssetLocked ? (state?.recommendedExpiry || anyState.expiry || '1 min') : '\u2014';
  const displayRisk = isAssetLocked ? (state?.risk || anyState.riskLevel || 'LOW') : '\u2014';

  const actionColor = actionText === 'BUY' ? 'var(--color-emerald)' : actionText === 'SELL' ? 'var(--color-coral)' : actionText === 'WAIT' ? 'var(--color-amber)' : 'var(--text-muted)';

  // Status banner
  const signalStatus = state?.signalStatus || 'WAIT';
  const waitScore = typeof state?.waitScore === 'number'
    ? Math.max(1, Math.min(100, Math.round(state.waitScore)))
    : Math.max(1, Math.min(100, normalizePercent(state?.confidence) ?? 1));
  if (actionText === 'WAIT' && !isOffline && isAssetLocked) {
    displayConfidence = `${waitScore}%`;
  }
  const tradeStatus = state?.tradeStatus || 'NO TRADE';
  const hasRunningTrade = !!activeTrade && typeof activeTrade.remainingSeconds === 'number' && activeTrade.remainingSeconds > 0;
  const tradeDirectionLabel = hasRunningTrade
    ? tradeMonitor?.health === 'IN PROFIT' ? 'CURRENTLY IN PROFIT'
      : tradeMonitor?.health === 'AGAINST' ? 'CURRENTLY AGAINST'
      : activeTrade.status === 'AGAINST_THESIS' ? 'SETUP CONFLICT'
      : activeTrade.status === 'DETERIORATING' ? 'SETUP WEAKENING'
      : 'TRADE ACTIVE'
    : tradeStatus;
  // All trades (manual or signal) are treated identically â€” no MANUAL label.
  const primaryStatusLabel = hasRunningTrade ? tradeDirectionLabel : signalStatus;
  const primaryStatusColor = primaryStatusLabel.includes('AGAINST') || primaryStatusLabel.includes('CONFLICT') || primaryStatusLabel.includes('INVALIDATED')
    ? 'var(--color-coral)'
    : primaryStatusLabel.includes('WEAKENING') || primaryStatusLabel.includes('WAIT')
    ? 'var(--color-amber)'
    : 'var(--color-emerald)';

  let strengthLabel = 'N/A';
  let strengthColor = 'var(--text-muted)';
  if (strengthPercent !== null) {
    if (strengthPercent >= 75) { strengthLabel = 'STRONG'; strengthColor = 'var(--color-emerald)'; }
    else if (strengthPercent >= 50) { strengthLabel = 'MODERATE'; strengthColor = 'var(--color-amber)'; }
    else { strengthLabel = 'WEAK'; strengthColor = 'var(--color-coral)'; }
  }

  // ---- Trade monitor (Section 2) ----
  const tm = tradeMonitor;
  const monitorEntryPrice = normalizePrice(tm?.entryPrice);
  const monitorCurrentPrice = normalizePrice(tm?.currentPrice);
  const pnlPct = typeof tm?.pnlPct === 'number' ? tm.pnlPct : null;
  const pnlColor = pnlPct === null ? 'var(--text-muted)' : pnlPct >= 0 ? 'var(--color-emerald)' : 'var(--color-coral)';
  const healthColor = tm?.health === 'IN PROFIT' ? 'var(--color-emerald)' : tm?.health === 'AGAINST' ? 'var(--color-coral)' : 'var(--color-amber)';
  const tradeWinProb = typeof tm?.winProb === 'number' ? tm.winProb : null;

  // ---- Market intel (Section 3) ----
  const intel = state?.marketIntelState || null;
  const regimePrimary = intel?.regime?.primary || (state?.marketRegime || 'UNKNOWN');
  const regimeSecondary = intel?.regime?.secondary || state?.trend || null;
  const momentumPrimary = intel?.momentum?.primary || state?.momentum || 'UNKNOWN';
  const pressureStr = intel?.pressure || 'PRESSURE UNAVAILABLE';
  const buyPct = typeof intel?.pressureBuyPercent === 'number' ? intel.pressureBuyPercent : null;
  const sellPct = typeof intel?.pressureSellPercent === 'number' ? intel.pressureSellPercent : null;
  const pressureAvailable = buyPct !== null && sellPct !== null && intel?.pressureSource !== 'UNAVAILABLE';
  const pressureSide = pressureAvailable ? (buyPct! >= 50 ? 'BUYERS' : 'SELLERS') : 'N/A';
  const pressureDelta = pressureAvailable ? Math.abs(buyPct! - 50) : 0;
  const pressureStrength = !pressureAvailable ? 'UNAVAILABLE' : pressureDelta >= 16 ? 'STRONG' : pressureDelta >= 5 ? 'MODERATE' : 'BALANCED';
  const trendStrength = typeof intel?.trendStrength === 'number' ? intel.trendStrength : null;
  const trendStrengthStatus = intel?.trendStrengthStatus || 'UNAVAILABLE';
  const volatilityLabel = state?.volatility || 'UNKNOWN';

  // ---- Proximity Alert (replaces volatility bar) ----
  // Warns when price is close to support/resistance â€” the most critical
  // decision point for entry/exit timing.
  const supportDist = intel?.support?.distancePts ?? state?.supportLevel?.distancePts ?? null;
  const resistanceDist = intel?.resistance?.distancePts ?? state?.resistanceLevel?.distancePts ?? null;
  const VISUAL_PROXIMITY_THRESHOLD_PX = 8;
  let proximityAlert = '';
  let proximityColor = 'var(--text-muted)';
  if (supportDist !== null && resistanceDist !== null) {
    const nearSupport = Math.abs(supportDist) <= VISUAL_PROXIMITY_THRESHOLD_PX;
    const nearResistance = Math.abs(resistanceDist) <= VISUAL_PROXIMITY_THRESHOLD_PX;
    if (nearSupport && nearResistance) {
      proximityAlert = 'VISUAL SQUEEZE';
      proximityColor = 'var(--color-amber)';
    } else if (nearSupport) {
      proximityAlert = 'NEAR VISUAL SUPPORT';
      proximityColor = 'var(--color-emerald)';
    } else if (nearResistance) {
      proximityAlert = 'NEAR VISUAL RESISTANCE';
      proximityColor = 'var(--color-coral)';
    } else {
      proximityAlert = 'CLEAR VISUAL ZONE';
      proximityColor = 'var(--accent-cyan)';
    }
  }
  const supportDisplay = intel?.support?.display || (state?.supportLevel ? 'VISUAL LEVEL DETECTED' : '--');
  const supportStatus = intel?.support?.status || 'UNKNOWN';
  const resistanceDisplay = intel?.resistance?.display || (state?.resistanceLevel ? 'VISUAL LEVEL DETECTED' : '--');
  const resistanceStatus = intel?.resistance?.status || 'UNKNOWN';
  const sHitColor = (st: string) => st === 'HIT' ? 'var(--color-amber)' : st === 'BROKEN' ? 'var(--color-coral)' : 'var(--text-muted)';

  return (
    <div className="overlay-panel" style={{ height: '100%', position: 'relative', zoom }}>
      {/* Panel Header â€” draggable */}
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: 'var(--accent-cyan)', fontSize: '13px' }}>{'\u{1F4E1}'}</span>
          <span className="panel-title">MARS SIGNAL</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {(() => {
            const mode = state?.calibrationMode || anyState.calibrationMode;
            if (!mode) return null;
            const modeColor = mode === 'SNIPER' ? '#e0a94b' : mode === 'AGGRESSIVE' ? 'var(--color-coral)' : 'var(--accent-cyan)';
            return (
              <span style={{ fontSize: '9px', fontWeight: 800, color: modeColor, fontFamily: 'var(--font-mono)', padding: '2px 6px', borderRadius: '4px', border: `1px solid ${modeColor}`, background: 'rgba(255,255,255,0.05)', letterSpacing: '0.5px' }}>
                {mode}
              </span>
            );
          })()}
          <span style={{
            fontSize: '9px', fontWeight: 700, fontFamily: 'var(--font-mono)', padding: '2px 6px', borderRadius: '4px',
            color: tradeStatus === 'TRADE ACTIVE' ? 'var(--color-emerald)' : tradeStatus === 'ENTRY WINDOW' ? 'var(--accent-cyan)' : tradeStatus === 'TRADE INVALIDATED' ? 'var(--color-coral)' : 'var(--text-muted)',
            background: 'rgba(255,255,255,0.05)', letterSpacing: '0.5px',
          }}>
            {tradeStatus === 'TRADE INVALIDATED' ? 'ENTRY INVALIDATED' : tradeStatus}
          </span>
        </div>
      </div>

      <div className="panel-body" style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 44px)' }}>
        {/* ================= SECTION 1: SIGNAL ================= */}
        <div className="decision-box" style={{ padding: '12px 14px', borderRadius: '10px' }}>
          <div>
            <div className={'decision-action ' + actionText}>{actionText}</div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', fontFamily: 'var(--font-mono)', letterSpacing: '0.5px' }}>
              {actionText === 'BUY' || actionText === 'SELL' ? `EXPIRY ${displayExpiry.toUpperCase()}` : actionText === 'WAIT' ? 'ANALYZING MARKET' : 'SCANNER SEARCHING'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '20px', fontWeight: 800, color: actionColor, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{displayConfidence}</div>
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '4px', letterSpacing: '0.5px' }}>
              {actionText === 'WAIT' ? 'WAIT SCORE' : 'CONFIDENCE'}
            </div>
            <div style={{ fontSize: '7.5px', color: calibrationActive ? 'var(--color-emerald)' : 'rgba(255,255,255,0.4)' }}>
              {actionText === 'WAIT'
                ? 'No trade until setup confirms'
                : calibrationActive ? 'JOURNAL-BASED WIN PROB' : 'Trade Probability'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderRadius: '6px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', marginTop: '8px', fontSize: '9px', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
          <span style={{ color: primaryStatusColor }}>{primaryStatusLabel}</span>
          <span style={{ color: 'var(--text-secondary)' }}>
            {hasRunningTrade && localExpirySec !== null ? `${localExpirySec}s EXPIRY LEFT` : (actionText === 'BUY' || actionText === 'SELL') && localVisualSec !== null && localVisualSec > 0 ? `${localVisualSec}s ENTRY LEFT` : tradeStatus}
          </span>
        </div>

        {actionText === 'WAIT' && (
          <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(255,193,7,0.28)', borderRadius: '7px', padding: '7px 9px', background: 'rgba(255,193,7,0.06)' }}>
            <span style={{ fontSize: '9px', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>WAIT SCORE</span>
            <span style={{ fontSize: '12px', fontWeight: 900, color: 'var(--color-amber)', fontFamily: 'var(--font-mono)' }}>WAIT {waitScore}%</span>
          </div>
        )}
        {strengthPercent !== null && (
          <div className="strength-container" style={{ marginTop: '10px' }}>
            <div className="strength-label">
              <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)' }}>Signal Strength <span style={{ fontSize: '8px', opacity: 0.6 }}>(Technical Setup)</span></span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '9px', fontWeight: 700, color: strengthColor, fontFamily: 'var(--font-mono)' }}>{strengthLabel}</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)', fontSize: '10px', fontWeight: 700 }}>{strengthPercent}%</span>
              </div>
            </div>
            <div className="strength-bar-bg"><div className="strength-bar-fill" style={{ width: strengthPercent + '%' }} /></div>
          </div>
        )}

        <div className="info-grid" style={{ marginTop: '10px' }}>
          <div>
            <div className="detail-label" style={{ fontSize: '9px', letterSpacing: '0.5px' }}>ENTRY IN</div>
            <div style={{ fontSize: '13px', fontWeight: 800, color: !isOffline && countdownDisplay !== '--' ? 'var(--color-emerald)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{isOffline ? '--' : countdownDisplay}</div>
          </div>
          <div>
            <div className="detail-label" style={{ fontSize: '9px', letterSpacing: '0.5px' }}>EXPIRY</div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>{isOffline ? '--' : displayExpiry}</div>
          </div>
          <div>
            <div className="detail-label" style={{ fontSize: '9px', letterSpacing: '0.5px' }}>RISK</div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: displayRisk === 'LOW' ? 'var(--color-emerald)' : displayRisk === 'HIGH' ? 'var(--color-coral)' : 'var(--color-amber)', fontFamily: 'var(--font-mono)' }}>{isOffline ? '--' : displayRisk}</div>
          </div>
        </div>

        <div className="reasons-section" style={{ marginTop: '10px' }}>
          <div className="detail-label" style={{ marginBottom: '6px', fontSize: '9px', letterSpacing: '0.5px' }}>
            {isOffline ? '\u26A0 FAILURE REASON' : actionText === 'WAIT' || actionText === 'SEARCHING' ? '\uD83D\uDCCA MARKET STATUS' : '\u2714 CONFLUENCE EVIDENCE'}
          </div>
          <div className="reasons-list">
            {displayReasons.slice(0, 3).map((r: string, i: number) => (
              <div key={i} className="reason-item" style={{ fontSize: '11px', lineHeight: 1.4 }}>
                <span className="reason-bullet" style={{ color: actionText === 'BUY' ? 'var(--color-emerald)' : actionText === 'SELL' ? 'var(--color-coral)' : 'var(--color-amber)' }}>
                  {isOffline ? '\u26A0' : actionText === 'BUY' || actionText === 'SELL' ? '\u2714' : '\u25CF'}
                </span>
                <span>{r}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ================= SECTION 2: TRADE MONITOR ================= */}
        {tm && (
          <div style={{ marginTop: '12px', border: '1px solid rgba(0, 242, 254, 0.25)', borderRadius: '10px', padding: '10px', background: 'linear-gradient(135deg, rgba(15,23,42,0.7), rgba(2,6,23,0.6))' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--accent-cyan)', letterSpacing: '1px' }}>
                TRADE ACTIVE {tm.asset ? `\u2022 ${tm.asset}` : ''}
              </span>
              <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                {localExpirySec !== null ? `${localExpirySec}s LEFT` : '--'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                ENTRY {monitorEntryPrice !== null ? monitorEntryPrice.toFixed(5) : '--'}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                NOW {monitorCurrentPrice !== null ? monitorCurrentPrice.toFixed(5) : '--'}
              </span>
              <span style={{ fontSize: '13px', fontWeight: 800, color: pnlColor, fontFamily: 'var(--font-mono)' }}>
                {pnlPct === null ? '--' : (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(2) + '%'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '10px', fontWeight: 800, color: healthColor }}>{tm.health}</span>
              <span style={{ fontSize: '9px', color: 'var(--text-secondary)', maxWidth: '60%', textAlign: 'right' }}>{tm.healthReason}</span>
            </div>

            <div className="info-grid" style={{ gap: '6px' }}>
              <div>
                <div className="detail-label" style={{ fontSize: '8px', letterSpacing: '0.5px', color: 'var(--color-emerald)' }}>TARGET</div>
                <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--color-emerald)', fontFamily: 'var(--font-mono)' }}>
                  {typeof tm.targetPoints === 'number' ? `${Math.abs(Math.round(tm.targetPoints))} PTS` : '--'}
                </div>
              </div>
              <div>
                <div className="detail-label" style={{ fontSize: '8px', letterSpacing: '0.5px', color: 'var(--color-coral)' }}>STOP</div>
                <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--color-coral)', fontFamily: 'var(--font-mono)' }}>
                  {typeof tm.stopPoints === 'number' ? `${Math.abs(Math.round(tm.stopPoints))} PTS` : '--'}
                </div>
              </div>
              <div>
                <div className="detail-label" style={{ fontSize: '8px', letterSpacing: '0.5px' }}>WIN PROB</div>
                <div style={{ fontSize: '11px', fontWeight: 800, color: tradeWinProb !== null ? (tradeWinProb >= 60 ? 'var(--color-emerald)' : 'var(--color-amber)') : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {tradeWinProb !== null ? `${tradeWinProb}%` : '--'}
                </div>
              </div>
            </div>

            {lastTradeResult && (
              <div style={{ marginTop: '8px', padding: '6px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
                <span style={{ color: 'var(--text-muted)' }}>LAST RESULT</span>
                <span style={{ color: lastTradeResult.outcome === 'WIN' ? 'var(--color-emerald)' : lastTradeResult.outcome === 'LOSS' ? 'var(--color-coral)' : 'var(--color-amber)', fontWeight: 800 }}>
                  {lastTradeResult.outcome} {lastTradeResult.asset || ''}
                </span>
              </div>
            )}
          </div>
        )}

        {/* ================= SECTION 3: MARKET INTEL (compact) ================= */}
        <div style={{ marginTop: '12px', border: '1px solid rgba(180, 74, 255, 0.22)', borderRadius: '10px', padding: '10px' }}>
          <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--accent-purple)', letterSpacing: '1px', marginBottom: '8px' }}>MARKET INTEL</div>

          <div className="analysis-grid">
            <div className="analysis-cell">
              <div className="detail-label" style={{ fontSize: '8px' }}>REGIME</div>
              <div style={{ fontSize: '10px', fontWeight: 800, color: regimePrimary.includes('BULLISH') ? 'var(--color-emerald)' : regimePrimary.includes('BEARISH') ? 'var(--color-coral)' : regimePrimary.includes('RANG') ? 'var(--color-amber)' : 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {regimePrimary}
              </div>
              {regimeSecondary && <div style={{ fontSize: '8px', fontWeight: 700, color: 'var(--text-muted)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>{regimeSecondary}</div>}
            </div>
            <div className="analysis-cell">
              <div className="detail-label" style={{ fontSize: '8px' }}>MOMENTUM</div>
              <div style={{ fontSize: '10px', fontWeight: 800, color: momentumPrimary.includes('STRONG') ? 'var(--color-emerald)' : momentumPrimary.includes('WEAK') ? 'var(--color-coral)' : 'var(--color-amber)', fontFamily: 'var(--font-mono)' }}>
                {momentumPrimary}
              </div>
              <div style={{ fontSize: '8px', fontWeight: 700, color: 'var(--text-muted)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                VOL {volatilityLabel}
              </div>
            </div>
          </div>

          <div className="analysis-cell" style={{ marginTop: '8px' }}>
            <div className="detail-label" style={{ fontSize: '8px' }}>PRESSURE</div>
            <div style={{ fontSize: '10px', fontWeight: 800, color: !pressureAvailable ? 'var(--text-muted)' : buyPct! >= 50 ? 'var(--color-emerald)' : 'var(--color-coral)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
              {pressureAvailable ? `${pressureSide} ${pressureStrength} (${buyPct}% / ${sellPct}%)` : `${pressureStr} (waiting for evidence)`}
            </div>
            {pressureAvailable && (
              <div className="strength-bar-bg" style={{ marginTop: '5px' }}>
                <div className="strength-bar-fill" style={{ width: buyPct + '%', background: 'linear-gradient(90deg, var(--color-coral), var(--color-amber), var(--color-emerald))' }} />
              </div>
            )}
          </div>

          <div className="analysis-cell" style={{ marginTop: '8px' }}>
            <div className="detail-label" style={{ fontSize: '8px' }}>TREND STRENGTH</div>
            <div style={{ fontSize: '10px', fontWeight: 800, color: trendStrengthStatus === 'CALCULATED' ? 'var(--accent-cyan)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
              {trendStrengthStatus === 'CALCULATED' && trendStrength !== null ? `${trendStrength}%` : trendStrengthStatus}
            </div>
            {trendStrength !== null && trendStrengthStatus === 'CALCULATED' && (
              <div className="strength-bar-bg" style={{ marginTop: '5px' }}>
                <div className="strength-bar-fill" style={{ width: trendStrength + '%', background: 'linear-gradient(90deg, var(--color-coral), var(--color-amber), var(--accent-cyan))' }} />
              </div>
            )}
          </div>

          <div className="analysis-grid" style={{ marginTop: '8px' }}>
            <div className="analysis-cell" style={{ background: 'rgba(16,185,129,0.06)', borderColor: 'rgba(16,185,129,0.2)' }}>
              <div className="detail-label" style={{ fontSize: '8px', color: 'var(--color-emerald)' }}>VISUAL SUPPORT {supportStatus === 'HIT' ? '\u2022 HIT' : supportStatus === 'BROKEN' ? '\u2022 BROKEN' : ''}</div>
              <div style={{ fontSize: '10px', fontWeight: 800, color: sHitColor(supportStatus), fontFamily: 'var(--font-mono)' }}>{supportDisplay}</div>
            </div>
            <div className="analysis-cell" style={{ background: 'rgba(244,63,94,0.06)', borderColor: 'rgba(244,63,94,0.2)' }}>
              <div className="detail-label" style={{ fontSize: '8px', color: 'var(--color-coral)' }}>VISUAL RESISTANCE {resistanceStatus === 'HIT' ? '\u2022 HIT' : resistanceStatus === 'BROKEN' ? '\u2022 BROKEN' : ''}</div>
              <div style={{ fontSize: '10px', fontWeight: 800, color: sHitColor(resistanceStatus), fontFamily: 'var(--font-mono)' }}>{resistanceDisplay}</div>
            </div>
          </div>

          {proximityAlert && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', padding: '5px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${proximityColor}33`, fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
              <span style={{ color: 'var(--text-muted)' }}>PROXIMITY</span>
              <span style={{ color: proximityColor, fontWeight: 800 }}>{proximityAlert}</span>
            </div>
          )}

          {bestSetup && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', padding: '5px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
              <span style={{ color: 'var(--text-muted)' }}>BEST SETUP</span>
              <span style={{ color: 'var(--color-emerald)', fontWeight: 800 }}>{bestSetup.asset} {typeof bestSetup.winProb === 'number' ? Math.round(bestSetup.winProb * 100) + '%' : ''}</span>
            </div>
          )}
        </div>
      </div>

      {/* Resize Indicator */}
      <div className="resize-indicator">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M11 1L1 11M11 5L5 11M11 9L9 11" stroke="var(--text-muted)" strokeWidth="1" />
        </svg>
      </div>
    </div>
  );
}

export default React.memo(SignalPanelComponent);
