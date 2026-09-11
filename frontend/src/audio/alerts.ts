import { IPC_CHANNELS, IPC_INVOKE_CHANNELS } from '../../../shared/contracts/ipc-channels';

type AudioAlertType = 'BUY' | 'SELL' | 'DETERIORATION' | 'TRADE_CONFIRMED';

const ALERT_DEBOUNCE_MS = 2_500;

function playToneSequence(type: AudioAlertType): void {
  try {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context: AudioContext = new AudioContextCtor();

    const schedule = () => {
      const now = context.currentTime;
      const notes = type === 'BUY'
        ? [{ at: 0, from: 523.25, to: 659.25, duration: 0.22 }]
        : type === 'SELL'
          ? [{ at: 0, from: 659.25, to: 440, duration: 0.24 }]
          : type === 'DETERIORATION'
            ? [
                { at: 0, from: 392, to: 392, duration: 0.08 },
                { at: 0.14, from: 392, to: 392, duration: 0.08 },
              ]
            : [
                { at: 0, from: 587.33, to: 587.33, duration: 0.09 },
                { at: 0.12, from: 739.99, to: 739.99, duration: 0.09 },
                { at: 0.24, from: 880, to: 880, duration: 0.14 },
              ];

      for (const note of notes) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = now + note.at;
        oscillator.type = type === 'DETERIORATION' ? 'square' : 'sine';
        oscillator.frequency.setValueAtTime(note.from, start);
        oscillator.frequency.exponentialRampToValueAtTime(note.to, start + note.duration);
        gain.gain.setValueAtTime(type === 'TRADE_CONFIRMED' ? 0.16 : 0.13, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + note.duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + note.duration);
      }

      window.setTimeout(() => { void context.close().catch(() => undefined); }, 800);
    };

    if (context.state === 'suspended') void context.resume().then(schedule).catch(() => void context.close());
    else schedule();
  } catch {
    // Audio must never interrupt trading or crash the renderer.
  }
}

function normalizeTrades(value: unknown): Array<{ id?: unknown }> {
  if (Array.isArray(value)) return value as Array<{ id?: unknown }>;
  if (value && typeof value === 'object' && Array.isArray((value as any).trades)) {
    return (value as any).trades;
  }
  return [];
}

export function installAudioAlerts(): () => void {
  if (!window.marsApi) return () => {};

  const lastPlayedAt = new Map<AudioAlertType, number>();
  let knownTradeIds = new Set<string>();
  let tradeBaselineReady = false;
  let syncingTrades = false;

  const playOnce = (type: AudioAlertType) => {
    const now = Date.now();
    if (now - (lastPlayedAt.get(type) || 0) < ALERT_DEBOUNCE_MS) return;
    lastPlayedAt.set(type, now);
    playToneSequence(type);
  };

  const removeSignalListener = window.marsApi.on(IPC_CHANNELS.OVERLAY_STATE_UPDATE, (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const payload = value as Record<string, unknown>;
    if (payload.soundAlert !== true || payload.soundEnabled === false) return;
    const type = payload.soundAlertType;
    if (type === 'BUY' && payload.soundBuyEnabled !== false) playOnce('BUY');
    else if (type === 'SELL' && payload.soundSellEnabled !== false) playOnce('SELL');
    else if (type === 'DETERIORATION' && payload.soundDeteriorationEnabled !== false) playOnce('DETERIORATION');
  });

  const syncActiveTrades = async (announceNew: boolean) => {
    if (syncingTrades) return;
    syncingTrades = true;
    try {
      const [tradeValue, settingsValue] = await Promise.all([
        window.marsApi.invoke(IPC_INVOKE_CHANNELS.GET_ACTIVE_TRADES),
        window.marsApi.invoke(IPC_INVOKE_CHANNELS.GET_SETTINGS).catch(() => null),
      ]);
      const nextIds = new Set(
        normalizeTrades(tradeValue)
          .map((trade) => typeof trade.id === 'string' ? trade.id : '')
          .filter(Boolean),
      );
      const settings = settingsValue && typeof settingsValue === 'object'
        ? settingsValue as Record<string, unknown>
        : null;
      const hasNewTrade = Array.from(nextIds).some((id) => !knownTradeIds.has(id));
      if (announceNew && tradeBaselineReady && hasNewTrade && settings?.soundEnabled !== false) {
        playOnce('TRADE_CONFIRMED');
      }
      knownTradeIds = nextIds;
      tradeBaselineReady = true;
    } catch {
      // IPC may not be ready during the first renderer milliseconds; the next
      // active-trade event will retry without affecting the application.
    } finally {
      syncingTrades = false;
    }
  };

  const baselineTimer = window.setTimeout(() => { void syncActiveTrades(false); }, 750);
  const removeTradeListener = window.marsApi.on(IPC_CHANNELS.ACTIVE_TRADES_UPDATE, () => {
    void syncActiveTrades(true);
  });

  return () => {
    window.clearTimeout(baselineTimer);
    removeSignalListener();
    removeTradeListener();
  };
}
