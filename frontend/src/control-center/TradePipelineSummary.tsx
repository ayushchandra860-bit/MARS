import React, { useCallback, useEffect, useState } from 'react';
import { IPC_CHANNELS, IPC_INVOKE_CHANNELS } from '../../../shared/contracts/ipc-channels';
import { HistoryEntry, PerformanceStats } from '../../../shared/types/ipc';
import { GlassPanel } from '../components/GlassPanel';
import { invokeIpc, useIpcListener } from '../hooks/useIpc';

type LearningStatus = {
  readiness?: 'DORMANT' | 'TRAINING' | 'READY';
  sampleSize?: number;
  trainedModelLoaded?: boolean;
};

export default function TradePipelineSummary() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState<PerformanceStats | null>(null);
  const [learning, setLearning] = useState<LearningStatus | null>(null);

  const refresh = useCallback(async () => {
    const [nextHistory, nextStats, nextLearning] = await Promise.all([
      invokeIpc<HistoryEntry[]>(IPC_INVOKE_CHANNELS.GET_HISTORY, { limit: 500 }),
      invokeIpc<PerformanceStats>(IPC_INVOKE_CHANNELS.GET_PERFORMANCE_STATS),
      invokeIpc<LearningStatus>(IPC_INVOKE_CHANNELS.GET_MODEL_READINESS_SCORE),
    ]);
    setHistory(Array.isArray(nextHistory) ? nextHistory : []);
    setStats(nextStats || null);
    setLearning(nextLearning || null);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useIpcListener(IPC_CHANNELS.PERFORMANCE_REFRESH, () => { void refresh(); });
  useIpcListener(IPC_CHANNELS.ACTIVE_TRADES_UPDATE, () => { void refresh(); });

  const registered = stats?.registeredTradeCount ?? history.length;
  const completed = stats?.totalCompleted ?? history.filter((trade) => Boolean(trade.outcome)).length;
  const active = stats?.activeTradeCount ?? history.filter((trade) => !trade.outcome).length;
  const samples = learning?.sampleSize ?? 0;
  const recent = history.slice(0, 12);

  const cards = [
    { label: 'REGISTERED TRADES', value: registered, color: 'var(--accent-cyan)' },
    { label: 'ACTIVE / UNRESOLVED', value: active, color: 'var(--color-amber)' },
    { label: 'COMPLETED OUTCOMES', value: completed, color: 'var(--color-emerald)' },
    { label: 'ML CLEAN SAMPLES', value: samples, color: 'var(--accent-violet)' },
  ];

  return (
    <GlassPanel style={{ marginBottom: '20px' }}>
      <div className="card-header-clean">
        <div className="card-title-clean"><span>TRADE CAPTURE & LEARNING PIPELINE</span></div>
        <span style={{ fontSize: '11px', color: learning?.readiness === 'READY' ? 'var(--color-emerald)' : 'var(--color-amber)' }}>
          ML: {learning?.readiness || 'DORMANT'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))', gap: '10px', margin: '14px 0' }}>
        {cards.map((card) => (
          <div key={card.label} style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', borderRadius: '8px' }}>
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.5px' }}>{card.label}</div>
            <div style={{ marginTop: '4px', fontSize: '24px', fontWeight: 900, color: card.color, fontFamily: 'var(--font-mono)' }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: recent.length ? '12px' : 0 }}>
        Har captured trade ledger me dikhna chahiye. ML me sirf verified <strong>LIVE</strong> WIN/LOSS trade jayega jisme valid asset, entry/exit quote aur feature snapshot ho. DEMO, UNKNOWN ya unresolved trades ledger me dikhenge, par LIVE model ko contaminate nahi karenge.
      </div>

      {recent.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="terminal-table">
            <thead><tr><th>TIME</th><th>ASSET</th><th>MODE</th><th>ACTION</th><th>STATE</th><th>RESULT</th></tr></thead>
            <tbody>
              {recent.map((trade) => (
                <tr key={trade.id}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '10px' }}>{new Date(trade.timestamp).toLocaleTimeString()}</td>
                  <td style={{ fontWeight: 700 }}>{trade.asset || 'UNRESOLVED ASSET'}</td>
                  <td>{trade.platformMode || 'UNKNOWN'}</td>
                  <td style={{ color: trade.stabilizedDecision === 'BUY' ? 'var(--color-emerald)' : 'var(--color-coral)', fontWeight: 800 }}>{trade.stabilizedDecision}</td>
                  <td>{trade.tradeStatus || (trade.outcome ? 'COMPLETED' : 'ACTIVE')}</td>
                  <td style={{ fontWeight: 800 }}>{trade.outcome || 'PENDING'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GlassPanel>
  );
}
