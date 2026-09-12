import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invokeIpc, useIpcListener } from '../hooks/useIpc';
import { IPC_CHANNELS, IPC_INVOKE_CHANNELS } from '../../../shared/contracts/ipc-channels';
import { GlassPanel } from './GlassPanel';
import { formatConfidenceNumeric } from '../../../shared/utils/formatters';

type ActiveTrade = {
  id: string;
  asset: string | null;
  direction: 'BUY' | 'SELL' | 'WAIT' | string;
  timeframe?: string | null;
  confidence: number;
  entryPrice?: string | null;
  entryTimestamp: number;
  expiryTimestamp: number;
  expiryLabel?: string | null;
  status?: string;
  risk?: string | null;
  reasons?: string[];
};

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function getRiskColor(risk: string | null | undefined): string {
  if (risk === 'LOW') return 'var(--color-emerald)';
  if (risk === 'MEDIUM') return 'var(--color-amber)';
  if (risk === 'HIGH') return 'var(--color-coral)';
  return 'var(--text-muted)';
}

export function ActiveTradesPanel() {
  const [trades, setTrades] = useState<ActiveTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const now = useNow();

  const refresh = useCallback((): Promise<void> => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const task = (async () => {
      try {
        const next = await invokeIpc<ActiveTrade[]>(IPC_INVOKE_CHANNELS.GET_ACTIVE_TRADES);
        setTrades(Array.isArray(next) ? next : []);
      } finally {
        setLoading(false);
      }
    })();
    refreshInFlight.current = task;
    void task.finally(() => {
      if (refreshInFlight.current === task) refreshInFlight.current = null;
    });
    return task;
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useIpcListener(IPC_CHANNELS.ACTIVE_TRADES_UPDATE, () => { void refresh(); });

  return (
    <GlassPanel auroraBorder>
      <div className="card-header-clean">
        <div className="card-title-clean"><span>ACTIVE TRADE MONITOR</span></div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: trades.length ? 'var(--color-emerald)' : 'var(--text-muted)' }}>
          {trades.length} ACTIVE
        </span>
      </div>
      <p style={{ margin: '8px 0 14px', color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.45 }}>
        Verified Browser Workstation entries remain visible until expiry or resolution.
      </p>
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '14px 0' }}>SYNCING ACTIVE TRADES…</div>
      ) : trades.length === 0 ? (
        <div style={{ border: '1px dashed var(--glass-border)', borderRadius: 10, padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>
          No active trade is recorded.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {trades.map((trade) => {
            const strength = formatConfidenceNumeric(trade.confidence) ?? 0;
            const remaining = Math.max(0, Math.ceil((trade.expiryTimestamp - now) / 1000));
            const elapsed = Math.max(0, Math.floor((now - trade.entryTimestamp) / 1000));
            const total = Math.max(1, Math.ceil((trade.expiryTimestamp - trade.entryTimestamp) / 1000));
            const progress = Math.min(100, Math.round((elapsed / total) * 100));
            const actionColor = trade.direction === 'BUY' ? 'var(--color-emerald)' : trade.direction === 'SELL' ? 'var(--color-coral)' : 'var(--color-amber)';
            const expiring = remaining > 0 && remaining <= 10;
            return (
              <div key={trade.id} style={{
                border: `1px solid ${expiring ? 'rgba(251,191,36,.4)' : 'var(--glass-border)'}`,
                borderRadius: 10,
                padding: 14,
                background: expiring ? 'rgba(251,191,36,.04)' : 'rgba(255,255,255,.018)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ color: actionColor, fontFamily: 'var(--font-mono)', fontWeight: 900, fontSize: 15 }}>{trade.direction}</span>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{trade.asset || 'UNKNOWN ASSET'}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{trade.timeframe || '—'} · {trade.expiryLabel || 'AUTO'}</span>
                  </div>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 900, color: remaining === 0 ? 'var(--text-muted)' : expiring ? 'var(--color-amber)' : 'var(--accent-cyan)' }}>
                    {remaining === 0 ? 'EXPIRED' : `${remaining}s`}
                  </div>
                </div>
                <div style={{ height: 3, background: 'rgba(255,255,255,.06)', borderRadius: 2, marginBottom: 12, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${progress}%`, background: expiring ? 'var(--color-amber)' : actionColor, transition: 'width 1s linear' }} />
                </div>
                <div className="grid-3" style={{ gap: 8 }}>
                  <div className="metric-item"><div className="metric-label">CONFIDENCE</div><div className="metric-value">{strength}%</div></div>
                  <div className="metric-item"><div className="metric-label">RISK LEVEL</div><div className="metric-value" style={{ color: getRiskColor(trade.risk), fontSize: 14 }}>{trade.risk || 'UNASSESSED'}</div></div>
                  <div className="metric-item"><div className="metric-label">ENTRY PRICE</div><div className="metric-value" style={{ fontSize: 13 }}>{trade.entryPrice || '—'}</div></div>
                </div>
                {trade.reasons?.length ? <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-secondary)' }}>{trade.reasons.slice(0, 2).join(' · ')}</div> : null}
              </div>
            );
          })}
        </div>
      )}
    </GlassPanel>
  );
}
