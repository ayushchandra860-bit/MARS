import React, { useState, useRef, useMemo } from 'react';
import SignalPanel from './SignalPanel';
import { useIpcListener } from '../hooks/useIpc';
import { IPC_CHANNELS } from '../../../shared/contracts/ipc-channels';

interface OverlayAppProps {
  panelType?: 'signal' | 'analysis';
}

export default function OverlayApp({ panelType = 'signal' }: OverlayAppProps) {
  const [state, setState] = useState<any>(null);
  const [visible, setVisible] = useState(true);
  const lastSoundSignalTime = useRef<number>(0);
  const lastPlayedState = useRef<string | null>(null);

  const mergeState = (incoming: any) => {
    if (!incoming) return;
    setState((prev: any) => {
      const merged = { ...prev, ...incoming };
      if (incoming.asset !== undefined) {
        merged.asset = (incoming.asset && incoming.asset !== 'UNKNOWN') ? incoming.asset : null;
      }
      return merged;
    });
  };

  useIpcListener(IPC_CHANNELS.OVERLAY_STATE_UPDATE, (newState: unknown) => {
    const s = newState as any;
    mergeState(newState);
    handleAudioAlert(s);
  });

  useIpcListener(IPC_CHANNELS.OVERLAY_SHOW, () => setVisible(true));
  useIpcListener(IPC_CHANNELS.OVERLAY_HIDE, () => setVisible(false));

  const handleAudioAlert = (s: any) => {
    if (panelType !== 'signal' || !s || !s.soundAlert) return;
    if (s.soundEnabled === false) return;

    const alertType = s.soundAlertType;
    if (!alertType) return;

    if (alertType === 'BUY') {
      if (s.soundBuyEnabled !== false) {
        playBuyChime();
      }
    } else if (alertType === 'SELL') {
      if (s.soundSellEnabled !== false) {
        playSellChime();
      }
    } else if (alertType === 'DETERIORATION') {
      if (s.soundDeteriorationEnabled !== false) {
        playWarningChime();
      }
    }
  };

  // Sound 1: BUY Signal (Ascending Chime)
  const playBuyChime = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.12); // E5
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.28);
      setTimeout(() => { try { ctx.close().catch(() => {}); } catch {} }, 350);
    } catch {}
  };

  // Sound 2: SELL Signal (Descending Chime)
  const playSellChime = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
      osc.frequency.exponentialRampToValueAtTime(440.00, ctx.currentTime + 0.14); // A4
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.30);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.30);
      setTimeout(() => { try { ctx.close().catch(() => {}); } catch {} }, 350);
    } catch {}
  };

  // Sound 3: Trade Deterioration Warning (Double Beep Alert)
  const playWarningChime = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const playPulse = (startTime: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(440.0, startTime);
        gain.gain.setValueAtTime(0.10, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.08);
      };
      playPulse(ctx.currentTime);
      playPulse(ctx.currentTime + 0.12);
      setTimeout(() => { try { ctx.close().catch(() => {}); } catch {} }, 400);
    } catch {}
  };

  if (!visible) return null;

  const activeAsset = (state?.asset && state.asset !== 'UNKNOWN') ? state.asset : null;
  const hasDecision = state?.decision === 'BUY' || state?.decision === 'SELL' || state?.decision === 'WAIT';
  const analysisUnavailable = state?.systemStatus === 'UNAVAILABLE' || state?.systemStatus === 'DEGRADED' || !hasDecision;

  const activeState = useMemo(() => ({
    systemStatus: state?.systemStatus || 'READY',
    analysisState: state?.analysisState || 'RUNNING',
    decision: analysisUnavailable ? null : state.decision,
    signal: analysisUnavailable ? null : (state?.signal || state.decision),
    signalStrength: analysisUnavailable ? null : (state?.signalStrength ?? null),
    confidence: analysisUnavailable ? null : (state?.confidence ?? null),
    risk: analysisUnavailable ? null : (state?.risk || state?.riskLevel || null),
    riskLevel: analysisUnavailable ? null : (state?.riskLevel || state?.risk || null),
    reason: analysisUnavailable ? (state?.reason || 'Waiting for usable market evidence.') : state.reason,
    reasons: analysisUnavailable ? [state?.reason || 'Waiting for usable market evidence.'] : (state?.reasons || state?.whyTake || []),
    whyWait: analysisUnavailable ? (state?.whyWait || state?.reason || 'Waiting for usable market evidence.') : (state?.whyWait || state?.reason),
    whyTake: activeAsset ? (state?.whyTake || state?.reasons || []) : [],
    entryGuidance: activeAsset ? (state?.entryGuidance || state?.entry || 'WAIT') : 'WAIT',
    entry: activeAsset ? (state?.entry || state?.entryGuidance || 'WAIT') : 'WAIT',
    recommendedExpiry: activeAsset ? (state?.recommendedExpiry || state?.expiry || null) : null,
    expiry: activeAsset ? (state?.expiry || state?.recommendedExpiry || null) : null,
    lifecycleStage: state?.lifecycleStage || 'CANDIDATE',
    activeTradeContext: state?.activeTradeContext || null,
    entryCountdownSec: state?.entryCountdownSec ?? null,
    marketRegime: state?.marketRegime ?? null,
    trend: activeAsset ? (state?.trend || null) : null,
    momentum: activeAsset ? (state?.momentum || null) : null,
    volatility: activeAsset ? (state?.volatility || null) : null,
    marketBias: activeAsset ? (state?.bias || state?.marketBias || null) : null,
    bias: activeAsset ? (state?.bias || state?.marketBias || null) : null,
    supportLevel: activeAsset ? (state?.supportLevel || state?.support || null) : null,
    support: activeAsset ? (state?.support || state?.supportLevel || null) : null,
    resistanceLevel: activeAsset ? (state?.resistanceLevel || state?.resistance || null) : null,
    resistance: activeAsset ? (state?.resistance || state?.resistanceLevel || null) : null,
    asset: activeAsset,
    timeframe: activeAsset ? (state?.timeframe || null) : null,
    currentPrice: activeAsset ? (state?.currentPrice || null) : null,
    lastUpdate: state?.lastUpdate || null,
    marketIntelState: state?.marketIntelState || null,
    signalStatus: state?.signalStatus || 'WAIT',
    tradeStatus: state?.tradeStatus || 'NO TRADE',
    soundEnabled: state?.soundEnabled ?? true,
    soundBuyEnabled: state?.soundBuyEnabled ?? true,
    soundSellEnabled: state?.soundSellEnabled ?? true,
    soundDeteriorationEnabled: state?.soundDeteriorationEnabled ?? true,
  }), [state, activeAsset, analysisUnavailable]);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0a0e1a' }}>
      {/* Single combined panel — Signal + Trade Monitor + Market Intel */}
      <SignalPanel state={activeState} />
    </div>
  );
}
