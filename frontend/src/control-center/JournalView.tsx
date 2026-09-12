// ============================================================
// MARS PRO V3 — Trade Journal & Calibration Dataset
// Authoritative lightweight calibration observations & immutable journal.
// Includes full-detail drilldown modal for every trade snapshot.
// ============================================================

import React, { useState, useEffect } from 'react';
import { invokeIpc, useIpcListener } from '../hooks/useIpc';
import { IPC_INVOKE_CHANNELS, IPC_CHANNELS } from '../../../shared/contracts/ipc-channels';
import { GlassPanel } from '../components/GlassPanel';
import TradePipelineSummary from './TradePipelineSummary';
import { formatConfidence } from '../../../shared/utils/formatters';

export interface CalibrationHealth {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  drawTrades: number;
  datasetSize: number;
  health: 'EXCELLENT' | 'GOOD' | 'INSUFFICIENT_DATA';
  statusMessage: string;
  isReadyForCalibration: boolean;
}

export interface ImmutableSnapshot {
  tradeId: string;
  sessionId: string;
  asset: string;
  direction: string;
  entryTimestamp: number;
  exitTimestamp: number;
  expirySeconds: number;
  result: string;
  confidence: number;
  agreementScore: number;
  overallStrength: number;
  risk: string;
  trend: string;
  structure: string;
  momentum: string;
  volatility: string;
  marketRegime: string;
  rsi: number;
  ema: number;
  bollinger: number;
  pattern: string[];
  support: number | null;
  resistance: number | null;
  reasons: string[];
  snapshotTimestamp: number;
}

// ─── Snapshot Detail Modal ───────────────────────────────────────────────────

function SnapshotDetailModal({ snap, onClose }: { snap: ImmutableSnapshot; onClose: () => void }) {
  const dirColor = snap.direction === 'BUY' ? 'var(--color-emerald)' : snap.direction === 'SELL' ? 'var(--color-coral)' : 'var(--color-amber)';
  const resultColor = snap.result === 'WIN' ? 'var(--color-emerald)' : snap.result === 'LOSS' ? 'var(--color-coral)' : snap.result === 'DRAW' ? 'var(--color-amber)' : 'var(--text-muted)';
  const confNum = snap.confidence > 1 ? Math.round(snap.confidence) : Math.round(snap.confidence * 100);
  const duration = snap.exitTimestamp && snap.entryTimestamp ? Math.round((snap.exitTimestamp - snap.entryTimestamp) / 1000) : snap.expirySeconds;

  const MetricBox = ({ label, value, color }: { label: string; value: string | number; color?: string }) => (
    <div style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '4px', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: '13px', fontWeight: 700, color: color || 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{value}</div>
    </div>
  );

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '620px', maxHeight: '85vh', overflowY: 'auto',
          background: '#0d131f', border: '1px solid var(--glass-border)',
          borderRadius: '16px', padding: '28px',
          boxShadow: '0 30px 80px rgba(0,0,0,0.7)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <div>
            <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '1px', marginBottom: '6px' }}>
              IMMUTABLE TRADE SNAPSHOT
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '16px', fontWeight: 900, color: dirColor, fontFamily: 'var(--font-mono)',
                padding: '3px 10px', background: `${dirColor}18`, borderRadius: '6px',
              }}>{snap.direction}</span>
              <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>{snap.asset}</span>
              <span style={{
                fontSize: '16px', fontWeight: 900, color: resultColor, fontFamily: 'var(--font-mono)',
                padding: '3px 10px', background: `${resultColor}18`, borderRadius: '6px',
              }}>{snap.result}</span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
              {new Date(snap.entryTimestamp).toLocaleString()} · {snap.expirySeconds}s expiry
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-border)',
              color: 'var(--text-secondary)', borderRadius: '6px', padding: '5px 12px',
              cursor: 'pointer', fontSize: '12px', flexShrink: 0,
            }}
          >✕ CLOSE</button>
        </div>

        {/* AI Decision Score */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
          <MetricBox label="CONFIDENCE" value={`${confNum}%`} color={confNum >= 70 ? 'var(--color-emerald)' : confNum >= 55 ? 'var(--color-amber)' : 'var(--color-coral)'} />
          <MetricBox label="AGREEMENT" value={`${Math.round((snap.agreementScore ?? 0) * 100)}%`} color="var(--accent-cyan)" />
          <MetricBox label="STRENGTH" value={`${Math.round((snap.overallStrength ?? 0) * 100)}%`} color="var(--accent-violet)" />
          <MetricBox label="RISK" value={snap.risk || 'UNASSESSED'} color={snap.risk === 'LOW' ? 'var(--color-emerald)' : snap.risk === 'MEDIUM' ? 'var(--color-amber)' : 'var(--color-coral)'} />
        </div>

        {/* Market Context */}
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '8px' }}>
          MARKET CONTEXT AT ENTRY
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
          <MetricBox label="REGIME" value={snap.marketRegime || '—'} />
          <MetricBox label="TREND" value={snap.trend || '—'} color={snap.trend === 'BULLISH' ? 'var(--color-emerald)' : snap.trend === 'BEARISH' ? 'var(--color-coral)' : 'var(--text-secondary)'} />
          <MetricBox label="MOMENTUM" value={snap.momentum || '—'} />
          <MetricBox label="VOLATILITY" value={snap.volatility || '—'} color={snap.volatility === 'HIGH' ? 'var(--color-amber)' : 'var(--text-secondary)'} />
        </div>

        {/* Technical Indicators */}
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '8px' }}>
          TECHNICAL INDICATORS
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
          <MetricBox label="RSI" value={snap.rsi != null ? snap.rsi.toFixed(1) : '—'} color={snap.rsi > 70 ? 'var(--color-coral)' : snap.rsi < 30 ? 'var(--color-emerald)' : 'var(--text-primary)'} />
          <MetricBox label="EMA SCORE" value={snap.ema != null ? snap.ema.toFixed(3) : '—'} />
          <MetricBox label="BOLLINGER" value={snap.bollinger != null ? snap.bollinger.toFixed(3) : '—'} />
          <MetricBox label="DURATION" value={`${duration}s`} color="var(--accent-cyan)" />
        </div>

        {/* Support & Resistance */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
          <MetricBox label="SUPPORT LEVEL" value={snap.support != null ? snap.support.toFixed(5) : '—'} color="var(--color-emerald)" />
          <MetricBox label="RESISTANCE LEVEL" value={snap.resistance != null ? snap.resistance.toFixed(5) : '—'} color="var(--color-coral)" />
        </div>

        {/* Patterns */}
        {snap.pattern && snap.pattern.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '8px' }}>
              DETECTED PATTERNS
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {snap.pattern.map((p, i) => (
                <span key={i} style={{
                  padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600,
                  background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.2)',
                  color: 'var(--accent-cyan)',
                }}>{p}</span>
              ))}
            </div>
          </div>
        )}

        {/* Decision Reasons */}
        {snap.reasons && snap.reasons.length > 0 && (
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '8px' }}>
              DECISION REASONS ({snap.reasons.length})
            </div>
            {snap.reasons.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '6px' }}>
                <span style={{ color: dirColor, fontWeight: 900, fontSize: '13px', flexShrink: 0, marginTop: '1px' }}>→</span>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.55 }}>{r}</span>
              </div>
            ))}
          </div>
        )}

        {/* Snapshot ID */}
        <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--glass-border)' }}>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            SNAPSHOT ID: {snap.tradeId}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
            RECORDED: {new Date(snap.snapshotTimestamp).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main JournalView ────────────────────────────────────────────────────────

export default function JournalView() {
  const [health, setHealth] = useState<CalibrationHealth | null>(null);
  const [dataset, setDataset] = useState<ImmutableSnapshot[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchAsset, setSearchAsset] = useState<string>('');
  const [selectedSnap, setSelectedSnap] = useState<ImmutableSnapshot | null>(null);
  const [filterResult, setFilterResult] = useState<string>('ALL');

  const fetchData = async () => {
    setLoading(true);
    try {
      const hData = await invokeIpc<CalibrationHealth>(IPC_INVOKE_CHANNELS.GET_CALIBRATION_HEALTH);
      if (hData) setHealth(hData);

      const dData = await invokeIpc<ImmutableSnapshot[]>(IPC_INVOKE_CHANNELS.GET_CALIBRATION_DATASET);
      if (Array.isArray(dData)) setDataset(dData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useIpcListener(IPC_CHANNELS.PERFORMANCE_REFRESH, () => {
    fetchData();
  });

  const exportDatasetJson = () => {
    const jsonStr = JSON.stringify(dataset, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mars_calibration_dataset_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredDataset = dataset.filter((item) => {
    const matchesAsset = !searchAsset.trim() || item.asset.toLowerCase().includes(searchAsset.trim().toLowerCase());
    const matchesResult = filterResult === 'ALL' || item.result === filterResult;
    return matchesAsset && matchesResult;
  });

  // Quick summary stats for filtered set
  const wins = filteredDataset.filter(d => d.result === 'WIN').length;
  const losses = filteredDataset.filter(d => d.result === 'LOSS').length;
  const draws = filteredDataset.filter(d => d.result === 'DRAW').length;
  const winRate = filteredDataset.length > 0 ? Math.round((wins / filteredDataset.length) * 100) : 0;

  return (
    <div>
      {/* Detail Modal */}
      {selectedSnap && (
        <SnapshotDetailModal snap={selectedSnap} onClose={() => setSelectedSnap(null)} />
      )}

      <div className="command-center-header">
        <div className="header-title-group">
          <h1>TRADE JOURNAL & CALIBRATION DATASET</h1>
          <p>Immutable trade snapshots with full feature vectors — click any row for full details</p>
        </div>

        <button
          className="btn btn-primary"
          style={{ fontSize: '11px', padding: '6px 14px' }}
          onClick={exportDatasetJson}
          disabled={dataset.length === 0}
        >
          EXPORT CALIBRATION JSON ({dataset.length})
        </button>
      </div>

      <TradePipelineSummary />

      {/* Calibration Dataset Readiness Banner */}
      <GlassPanel auroraBorder style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
              CALIBRATION DATASET READINESS
            </div>
            <div style={{ fontSize: '20px', fontWeight: 900, fontFamily: 'var(--font-mono)', marginTop: '4px', color: health?.isReadyForCalibration ? 'var(--color-emerald)' : 'var(--color-amber)' }}>
              {health?.statusMessage || 'CHECKING DATASET HEALTH...'}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Observations: <strong>{health?.datasetSize || 0}</strong> ({health?.winningTrades || 0} W / {health?.losingTrades || 0} L / {health?.drawTrades || 0} D)
            </div>
          </div>

          <div style={{
            padding: '8px 16px', borderRadius: '8px',
            background: health?.isReadyForCalibration ? 'rgba(0, 200, 83, 0.12)' : 'rgba(255, 193, 7, 0.12)',
            border: `1px solid ${health?.isReadyForCalibration ? 'rgba(0, 200, 83, 0.3)' : 'rgba(255, 193, 7, 0.3)'}`,
            fontWeight: 800, fontSize: '12px', fontFamily: 'var(--font-mono)',
            color: health?.isReadyForCalibration ? 'var(--color-emerald)' : 'var(--color-amber)',
          }}>
            STATUS: {health?.health || 'PENDING'}
          </div>
        </div>
      </GlassPanel>

      {/* Filters & Summary Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            type="text"
            className="form-input"
            style={{ width: '200px', height: '32px', fontSize: '12px' }}
            placeholder="Filter by asset..."
            value={searchAsset}
            onChange={(e) => setSearchAsset(e.target.value)}
          />
          <select
            className="form-input"
            style={{ width: '120px', height: '32px', fontSize: '12px' }}
            value={filterResult}
            onChange={(e) => setFilterResult(e.target.value)}
          >
            <option value="ALL">ALL RESULTS</option>
            <option value="WIN">WIN</option>
            <option value="LOSS">LOSS</option>
            <option value="DRAW">DRAW</option>
          </select>
        </div>

        {/* Live summary stats */}
        {filteredDataset.length > 0 && (
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {filteredDataset.length} snapshots
            </span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-emerald)', fontFamily: 'var(--font-mono)' }}>
              {wins}W
            </span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-coral)', fontFamily: 'var(--font-mono)' }}>
              {losses}L
            </span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-amber)', fontFamily: 'var(--font-mono)' }}>
              {draws}D
            </span>
            <span style={{
              fontSize: '13px', fontWeight: 900, fontFamily: 'var(--font-mono)',
              color: winRate >= 60 ? 'var(--color-emerald)' : winRate >= 50 ? 'var(--color-amber)' : 'var(--color-coral)',
              padding: '2px 10px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px',
            }}>
              {winRate}% WR
            </span>
          </div>
        )}
      </div>

      {/* Journal Table */}
      <GlassPanel style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            LOADING IMMUTABLE JOURNAL OBSERVATIONS...
          </div>
        ) : filteredDataset.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              NO CALIBRATION OBSERVATIONS RECORDED
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Trade snapshots are generated automatically upon trade completion with 100% feature immutability.
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="terminal-table">
              <thead>
                <tr>
                  <th>ENTRY TIME</th>
                  <th>ASSET</th>
                  <th>DIR</th>
                  <th>EXPIRY</th>
                  <th>CONF</th>
                  <th>RSI</th>
                  <th>REGIME</th>
                  <th>RESULT</th>
                  <th>DETAILS</th>
                </tr>
              </thead>
              <tbody>
                {filteredDataset.map((snap) => {
                  const dirColor = snap.direction === 'BUY' ? 'var(--color-emerald)' : snap.direction === 'SELL' ? 'var(--color-coral)' : 'var(--color-amber)';
                  const resultColor = snap.result === 'WIN' ? 'var(--color-emerald)' : snap.result === 'LOSS' ? 'var(--color-coral)' : snap.result === 'DRAW' ? 'var(--color-amber)' : 'var(--text-muted)';
                  return (
                    <tr
                      key={snap.tradeId}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setSelectedSnap(snap)}
                    >
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                        {new Date(snap.entryTimestamp).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{snap.asset}</td>
                      <td>
                        <span style={{ fontWeight: 800, color: dirColor, fontFamily: 'var(--font-mono)' }}>
                          {snap.direction}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>
                        {snap.expirySeconds}s
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {formatConfidence(snap.confidence)}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: snap.rsi > 70 ? 'var(--color-coral)' : snap.rsi < 30 ? 'var(--color-emerald)' : 'var(--text-secondary)' }}>
                        {snap.rsi != null ? snap.rsi.toFixed(1) : '—'}
                      </td>
                      <td style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{snap.marketRegime}</td>
                      <td>
                        <span style={{ fontWeight: 900, fontSize: '11px', fontFamily: 'var(--font-mono)', color: resultColor }}>
                          {snap.result}
                        </span>
                      </td>
                      <td>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '2px 8px', fontSize: '10px' }}
                          onClick={(e) => { e.stopPropagation(); setSelectedSnap(snap); }}
                        >
                          VIEW
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
