import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SignalPanel from './SignalPanel';
import { useIpcListener } from '../hooks/useIpc';
import { IPC_CHANNELS } from '../../../shared/contracts/ipc-channels';

interface OverlayAppProps {
  panelType?: 'signal' | 'analysis';
}

function equivalentValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

export default function OverlayApp({ panelType = 'signal' }: OverlayAppProps) {
  const [state, setState] = useState<any>(null);
  const [visible, setVisible] = useState(true);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastSoundRef = useRef<{ type: string; at: number }>({ type: '', at: 0 });

  const mergeState = useCallback((incoming: any) => {
    if (!incoming || typeof incoming !== 'object') return;
    setState((previous: any) => {
      const prev = previous || {};
      const normalized = { ...incoming };
      if (incoming.asset !== undefined) {
        normalized.asset = incoming.asset && incoming.asset !== 'UNKNOWN' ? incoming.asset : null;
      }

      let meaningfulChange = previous === null;
      for (const [key, value] of Object.entries(normalized)) {
        if (key === 'lastUpdate') continue;
        if (!equivalentValue(prev[key], value)) {
          meaningfulChange = true;
          break;
        }
      }
      if (!meaningfulChange) return previous;
      return { ...prev, ...normalized };
    });
  }, []);

  const getAudioContext = useCallback((): AudioContext | null => {
    try {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtor) return null;
        audioContextRef.current = new AudioCtor();
      }
      if (audioContextRef.current.state === 'suspended') void audioContextRef.current.resume().catch(() => {});
      return audioContextRef.current;
    } catch {
      return null;
    }
  }, []);

  const playTone = useCallback((startHz: number, endHz: number, duration: number, type: OscillatorType = 'sine', delay = 0) => {
    const context = getAudioContext();
    if (!context) return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startHz, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endHz), start + duration * 0.48);
    gain.gain.setValueAtTime(type === 'square' ? 0.1 : 0.18, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }, [getAudioContext]);

  const handleAudioAlert = useCallback((payload: any) => {
    if (panelType !== 'signal' || !payload?.soundAlert || payload.soundEnabled === false) return;
    const type = String(payload.soundAlertType || '');
    if (!type) return;
    const now = Date.now();
    if (lastSoundRef.current.type === type && now - lastSoundRef.current.at < 500) return;
    lastSoundRef.current = { type, at: now };

    if (type === 'BUY' && payload.soundBuyEnabled !== false) playTone(523.25, 659.25, 0.28);
    else if (type === 'SELL' && payload.soundSellEnabled !== false) playTone(659.25, 440, 0.3);
    else if (type === 'DETERIORATION' && payload.soundDeteriorationEnabled !== false) {
      playTone(440, 440, 0.08, 'square');
      playTone(440, 440, 0.08, 'square', 0.12);
    }
  }, [panelType, playTone]);

  useIpcListener(IPC_CHANNELS.OVERLAY_STATE_UPDATE, (incoming: unknown) => {
    mergeState(incoming);
    handleAudioAlert(incoming);
  });
  useIpcListener(IPC_CHANNELS.OVERLAY_SHOW, () => setVisible(true));
  useIpcListener(IPC_CHANNELS.OVERLAY_HIDE, () => setVisible(false));

  useEffect(() => () => {
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }, []);

  const activeAsset = state?.asset && state.asset !== 'UNKNOWN' ? state.asset : null;
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
    reason: analysisUnavailable ? (state?.reason || 'Waiting for usable market evidence.') : state?.reason,
    reasons: analysisUnavailable ? [state?.reason || 'Waiting for usable market evidence.'] : (state?.reasons || state?.whyTake || []),
    whyWait: analysisUnavailable ? (state?.whyWait || state?.reason || 'Waiting for usable market evidence.') : (state?.whyWait || state?.reason),
    whyTake: activeAsset ? (state?.whyTake || state?.reasons || []) : [],
    entryGuidance: activeAsset ? (state?.entryGuidance || state?.entry || 'WAIT') : 'WAIT',
    entry: activeAsset ? (state?.entry || state?.entryGuidance || 'WAIT') : 'WAIT',
    recommendedExpiry: activeAsset ? (state?.recommendedExpiry || state?.expiry || null) : null,
    expiry: activeAsset ? (state?.expiry || state?.recommendedExpiry || null) : null,
    lifecycleStage: state?.lifecycleStage || 'CANDIDATE',
    activeTradeContext: state?.activeTradeContext || null,
    tradeMonitor: state?.tradeMonitor || null,
    lastTradeResult: state?.lastTradeResult || null,
    bestSetup: state?.bestSetup || null,
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
    calibrationActive: state?.calibrationActive || false,
    winProbability: state?.winProbability ?? null,
    waitScore: state?.waitScore ?? null,
    calibrationMode: state?.calibrationMode || null,
    soundEnabled: state?.soundEnabled ?? true,
    soundBuyEnabled: state?.soundBuyEnabled ?? true,
    soundSellEnabled: state?.soundSellEnabled ?? true,
    soundDeteriorationEnabled: state?.soundDeteriorationEnabled ?? true,
  }), [state, activeAsset, analysisUnavailable]);

  if (!visible) return null;
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0a0e1a' }}>
      <SignalPanel state={activeState} />
    </div>
  );
}
