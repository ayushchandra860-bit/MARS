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
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
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
  const now = useNow(1000); // live tick — updates every second

  const refresh = useCallback(async () => {
    try {
      const next = await invokeIpc<ActiveTrade[]>(IPC_INVOKE_CHANNELS.GET_ACTIVE_TRADES);
      setTrades(Array.isArray(next) ? next : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useIpcListener(IPC_CHANNELS.ACTIVE_TRADES_UPDATE, refresh);
  useIpcListener(IPC_CHANNELS.PERFORMANCE_REFRESH, refresh);

  return (
    <GlassPanel auroraBorder>
      <div className="card-header-clean">
        <div className="card-title-clean">
          <span>ACTIVE TRADE MONITOR</span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: trades.length ? 'var(--color-emerald)' : 'var(--text-muted)' }}>
          {trades.length} ACTIVE
        </span>
      </div>
      <p style={{ margin: '8px 0 14px', color: 'var(--text-muted)', fontSize: '11px', lineHeight: 1.45 }}>
        BUY and SELL entries from the AI signal flow or Browser Workstation appear here immediately. Confidence is the AI model's certainty score.
      </p>
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '14px 0' }}>SYNCING ACTIVE TRADES…</div>
      ) : trades.length === 0 ? (
        <div style={{ border: '1px dashed var(--glass-border)', borderRadius: '10px', padding: '16px', color: 'var(--text-muted)', fontSize: '12px' }}>
          No active trade is recorded. When a valid BUY or SELL is created, it will remain visible here until expiry or resolution.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '10px' }}>
          {trades.map((trade) => {
            const strength = formatConfidenceNumeric(trade.confidence) ?? 0;
            const remaining = Math.max(0, Math.ceil((trade.expiryTimestamp - now) / 1000));
            const elapsed = Math.floor((now - trade.entryTimestamp) / 1000);
            const totalDuration = Math.max(1, Math.ceil((trade.expiryTimestamp - trade.entryTimestamp) / 1000));
            const progressPct = Math.min(100, Math.round((elapsed / totalDuration) * 100));
            const actionColor = trade.direction === 'BUY' ? 'var(--color-emerald)' : trade.direction === 'SELL' ? 'var(--color-coral)' : 'var(--color-amber)';
            const riskColor = getRiskColor(trade.risk);
            const isExpiring = remaining <= 10 && remaining > 0;
            const isExpired = remaining === 0;

            return (
              <div key={trade.id} style={{
                border: `1px solid ${isExpiring ? 'rgba(255, 184, 0, 0.4)' : 'var(--glass-border)'}`,
                borderRadius: '10px',
                padding: '14px',
                background: isExpiring ? 'rgba(255, 184, 0, 0.04)' : 'rgba(255,255,255,0.018)',
                transition: 'border-color 0.3s ease',
              }}>
                {/* Header row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <span style={{
                      color: actionColor,
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 900,
                      fontSize: '15px',
                      padding: '2px 10px',
                      background: trade.direction === 'BUY' ? 'rgba(0, 255, 170, 0.1)' : trade.direction === 'SELL' ? 'rgba(255, 68, 102, 0.1)' : 'rgba(255, 184, 0, 0.1)',
                      borderRadius: '6px',
                    }}>
                      {trade.direction}
                    </span>
                    <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>
                      {trade.asset || 'UNKNOWN ASSET'}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                      {trade.timeframe || '—'} · {trade.expiryLabel || 'AUTO'}
                    </span>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '20px',
                      fontWeight: 900,
                      color: isExpired ? 'var(--text-muted)' : isExpiring ? 'var(--color-amber)' : 'var(--accent-cyan)',
                    }}>
                      {isExpired ? 'EXPIRED' : `${remaining}s`}
                    </div>
                    {!isExpired && (
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'right' }}>remaining</div>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{ height: '3px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', marginBottom: '12px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${progressPct}%`,
                    borderRadius: '2px',
                    background: isExpiring ? 'var(--color-amber)' : actionColor,
                    transition: 'width 1s linear',
                  }} />
                </div>

                {/* Metrics row */}
                <div className="grid-3" style={{ gap: '8px' }}>
                  <div className="metric-item">
                    <div className="metric-label">CONFIDENCE</div>
                    <div className="metric-value" style={{ color: strength >= 70 ? 'var(--color-emerald)' : strength >= 55 ? 'var(--color-amber)' : 'var(--color-coral)' }}>
                      {strength}%
                    </div>
                  </div>
                  <div className="metric-item">
                    <div className="metric-label">RISK LEVEL</div>
                    <div className="metric-value" style={{ color: riskColor, fontSize: '14px' }}>
                      {trade.risk || 'UNASSESSED'}
                    </div>
                  </div>
                  <div className="metric-item">
                    <div className="metric-label">ENTRY PRICE</div>
                    <div className="metric-value" style={{ fontSize: '13px' }}>
                      {trade.entryPrice || '—'}
                    </div>
                  </div>
                </div>

                {/* Reasons */}
                {trade.reasons && trade.reasons.length > 0 && (
                  <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {trade.reasons.slice(0, 2).join(' · ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </GlassPanel>
  );
}
