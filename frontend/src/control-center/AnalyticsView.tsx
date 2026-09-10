// ============================================================
// MARS PRO V3 — Analytics & Decision Intelligence View
// Professional analytics dashboard with Confidence Buckets, Asset/Regime breakdown,
// Reason performance, Hourly sessions, Decision Replay & Auto Bug Detection.
// ============================================================

import React, { useState, useEffect } from 'react';
import { invokeIpc, useIpcListener } from '../hooks/useIpc';
import { IPC_INVOKE_CHANNELS, IPC_CHANNELS } from '../../../shared/contracts/ipc-channels';
import { GlassPanel } from '../components/GlassPanel';

export interface ConfidenceBucketStats {
  bucket: string;
  minConf: number;
  maxConf: number;
  trades: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
}

export interface AssetAnalytics {
  asset: string;
  tradeCount: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  buyCount: number;
  sellCount: number;
  buyPercentage: number;
  sellPercentage: number;
}

export interface RegimeAnalytics {
  regime: string;
  tradeCount: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
}

export interface ReasonPerformance {
  reason: string;
  totalOccurrences: number;
  wins: number;
  losses: number;
  winRate: number;
}

export interface HourlyAnalytics {
  hour: number;
  hourLabel: string;
  tradeCount: number;
  wins: number;
  losses: number;
  winRate: number;
  avgConfidence: number;
}

export interface RuntimeValidationReport {
  isValid: boolean;
  totalRecordsChecked: number;
  corruptRecordsCount: number;
  errors: string[];
  checkedAt: number;
}

export interface AutoBugReport {
  timestamp: number;
  failingConfidenceBuckets: string[];
  failingAssets: string[];
  failingRegimes: string[];
  worstReasons: string[];
  mostCommonInvalidations: string[];
  summary: string;
}

export interface DecisionReplay {
  tradeId: string;
  asset: string;
  direction: string;
  confidence: number;
  reasons: string[];
  regime: string;
  result: string;
  entryTimestamp: number;
  rsi?: number;
  ema?: number;
  trend?: string;
  momentum?: string;
  volatility?: string;
  support?: number | null;
  resistance?: number | null;
}

export interface ComprehensiveAnalyticsReport {
  totalTrades: number;
  overallWinRate: number;
  confidenceBuckets: ConfidenceBucketStats[];
  assetAnalytics: AssetAnalytics[];
  bestAsset: AssetAnalytics | null;
  worstAsset: AssetAnalytics | null;
  regimeAnalytics: RegimeAnalytics[];
  topReasons: ReasonPerformance[];
  hourlyAnalytics: HourlyAnalytics[];
  validationReport: RuntimeValidationReport;
  autoBugReport: AutoBugReport;
}

// ─── Hourly Bar Chart ────────────────────────────────────────────────────────

function HourlyBar({ h, maxTrades }: { h: HourlyAnalytics; maxTrades: number }) {
  const heightPct = maxTrades > 0 ? Math.round((h.tradeCount / maxTrades) * 100) : 0;
  const winColor = h.winRate >= 60 ? 'var(--color-emerald)' : h.winRate >= 50 ? 'var(--color-amber)' : 'var(--color-coral)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', flex: 1 }}>
      {/* Win rate tooltip on top */}
      {h.tradeCount > 0 && (
        <div style={{ fontSize: '10px', fontWeight: 700, color: winColor, fontFamily: 'var(--font-mono)' }}>
          {h.winRate}%
        </div>
      )}
      {h.tradeCount === 0 && <div style={{ fontSize: '10px', color: 'transparent' }}>—</div>}

      {/* Bar */}
      <div style={{ width: '100%', height: '60px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div style={{
          width: '70%',
          height: `${Math.max(4, heightPct)}%`,
          background: h.tradeCount === 0 ? 'rgba(255,255,255,0.04)' : winColor,
          borderRadius: '3px 3px 0 0',
          opacity: h.tradeCount === 0 ? 0.3 : 0.85,
          transition: 'height 0.5s ease',
          minHeight: h.tradeCount > 0 ? '4px' : '0',
        }} />
      </div>

      {/* Trade count */}
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        {h.tradeCount > 0 ? h.tradeCount : '·'}
      </div>

      {/* Hour label */}
      <div style={{ fontSize: '9px', color: 'var(--text-muted)', textAlign: 'center' }}>
        {h.hourLabel}
      </div>
    </div>
  );
}

// ─── Decision Replay Modal ───────────────────────────────────────────────────

function DecisionReplayModal({ replay, onClose }: { replay: DecisionReplay; onClose: () => void }) {
  const dirColor = replay.direction === 'BUY' ? 'var(--color-emerald)' : replay.direction === 'SELL' ? 'var(--color-coral)' : 'var(--color-amber)';
  const resultColor = replay.result === 'WIN' ? 'var(--color-emerald)' : replay.result === 'LOSS' ? 'var(--color-coral)' : replay.result === 'DRAW' ? 'var(--color-amber)' : 'var(--text-muted)';
  const confNum = replay.confidence > 1 ? Math.round(replay.confidence) : Math.round(replay.confidence * 100);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: '560px', maxHeight: '80vh', overflowY: 'auto',
        background: '#0d131f', border: '1px solid var(--glass-border)',
        borderRadius: '14px', padding: '28px', boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '1px', marginBottom: '4px' }}>
              DECISION REPLAY
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '18px', fontWeight: 900, color: dirColor, fontFamily: 'var(--font-mono)' }}>
                {replay.direction}
              </span>
              <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
                {replay.asset}
              </span>
              <span style={{ fontSize: '16px', fontWeight: 900, color: resultColor, fontFamily: 'var(--font-mono)' }}>
                → {replay.result}
              </span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {new Date(replay.entryTimestamp).toLocaleString()}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-border)',
            color: 'var(--text-secondary)', borderRadius: '6px', padding: '4px 10px',
            cursor: 'pointer', fontSize: '12px',
          }}>✕ CLOSE</button>
        </div>

        {/* Metrics grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '20px' }}>
          {[
            { label: 'CONFIDENCE', value: `${confNum}%`, color: confNum >= 70 ? 'var(--color-emerald)' : confNum >= 55 ? 'var(--color-amber)' : 'var(--color-coral)' },
            { label: 'REGIME', value: replay.regime || '—', color: 'var(--text-primary)' },
            { label: 'RSI', value: replay.rsi != null ? replay.rsi.toFixed(1) : '—', color: 'var(--accent-cyan)' },
            { label: 'EMA SCORE', value: replay.ema != null ? replay.ema.toFixed(2) : '—', color: 'var(--text-primary)' },
            { label: 'TREND', value: replay.trend || '—', color: replay.trend === 'BULLISH' ? 'var(--color-emerald)' : replay.trend === 'BEARISH' ? 'var(--color-coral)' : 'var(--text-muted)' },
            { label: 'MOMENTUM', value: replay.momentum || '—', color: 'var(--text-secondary)' },
            { label: 'VOLATILITY', value: replay.volatility || '—', color: 'var(--color-amber)' },
            { label: 'SUPPORT', value: replay.support != null ? String(replay.support) : '—', color: 'var(--color-emerald)' },
            { label: 'RESISTANCE', value: replay.resistance != null ? String(replay.resistance) : '—', color: 'var(--color-coral)' },
          ].map(m => (
            <div key={m.label} style={{ padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '4px' }}>{m.label}</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: m.color, fontFamily: 'var(--font-mono)' }}>{m.value}</div>
            </div>
          ))}
        </div>

        {/* Reasons */}
        {replay.reasons && replay.reasons.length > 0 && (
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', letterSpacing: '0.5px' }}>
              DECISION REASONS
            </div>
            {replay.reasons.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '6px' }}>
                <span style={{ color: dirColor, fontWeight: 700, fontSize: '12px', flexShrink: 0 }}>→</span>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{r}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main AnalyticsView ──────────────────────────────────────────────────────

export default function AnalyticsView() {
  const [report, setReport] = useState<ComprehensiveAnalyticsReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedReplay, setSelectedReplay] = useState<DecisionReplay | null>(null);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const data = await invokeIpc<ComprehensiveAnalyticsReport>(IPC_INVOKE_CHANNELS.GET_ANALYTICS_REPORT);
      if (data) setReport(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  useIpcListener(IPC_CHANNELS.PERFORMANCE_REFRESH, () => {
    fetchAnalytics();
  });

  const exportCsv = async () => {
    const csvStr = await invokeIpc<string>(IPC_INVOKE_CHANNELS.EXPORT_ANALYTICS_CSV);
    if (!csvStr) return;
    const blob = new Blob([csvStr], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mars_analytics_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJson = async () => {
    const jsonStr = await invokeIpc<string>(IPC_INVOKE_CHANNELS.EXPORT_ANALYTICS_JSON);
    if (!jsonStr) return;
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mars_analytics_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading || !report) {
    return (
      <GlassPanel style={{ textAlign: 'center', padding: '60px' }}>
        <div style={{ color: 'var(--text-muted)' }}>COMPUTING ANALYTICS & DECISION INTELLIGENCE...</div>
      </GlassPanel>
    );
  }

  const maxHourlyTrades = Math.max(1, ...(report.hourlyAnalytics || []).map(h => h.tradeCount));
  const activeHours = (report.hourlyAnalytics || []).filter(h => h.tradeCount > 0);
  const bestHour = activeHours.length > 0 ? activeHours.reduce((a, b) => b.winRate > a.winRate ? b : a) : null;

  return (
    <div>
      {/* Decision Replay Modal */}
      {selectedReplay && (
        <DecisionReplayModal replay={selectedReplay} onClose={() => setSelectedReplay(null)} />
      )}

      <div className="command-center-header">
        <div className="header-title-group">
          <h1>ANALYTICS & DECISION INTELLIGENCE</h1>
          <p>Confidence buckets · Asset & regime performance · Hourly patterns · Auto bug detection</p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ textAlign: 'right', marginRight: '8px' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>TOTAL TRADES</div>
            <div style={{ fontSize: '20px', fontWeight: 900, color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>
              {report.totalTrades}
            </div>
          </div>
          <button className="btn btn-secondary" style={{ fontSize: '11px', padding: '6px 12px' }} onClick={exportCsv}>
            EXPORT CSV
          </button>
          <button className="btn btn-primary" style={{ fontSize: '11px', padding: '6px 12px' }} onClick={exportJson}>
            EXPORT JSON
          </button>
        </div>
      </div>

      {/* Top Banner: Runtime Validation & Auto Bug Detection */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
        <GlassPanel auroraBorder style={{ borderLeft: report.validationReport?.isValid ? '4px solid var(--color-emerald)' : '4px solid var(--color-coral)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>RUNTIME DATA INTEGRITY</span>
            <span style={{
              fontWeight: 800, fontSize: '11px',
              color: report.validationReport?.isValid ? 'var(--color-emerald)' : 'var(--color-coral)',
            }}>
              {report.validationReport?.isValid ? '100% VALID' : `${report.validationReport?.corruptRecordsCount || 0} CORRUPT RECORDS`}
            </span>
          </div>
          <div style={{ fontSize: '18px', fontWeight: 900, marginTop: '6px', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            {report.validationReport?.totalRecordsChecked || 0} Records Verified
          </div>
        </GlassPanel>

        <GlassPanel style={{ borderLeft: (!report.autoBugReport?.failingConfidenceBuckets || report.autoBugReport.failingConfidenceBuckets.length === 0) ? '4px solid var(--color-emerald)' : '4px solid var(--color-amber)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>AUTO BUG DETECTOR</span>
            <span style={{
              fontWeight: 800, fontSize: '11px',
              color: (!report.autoBugReport?.failingConfidenceBuckets || report.autoBugReport.failingConfidenceBuckets.length === 0) ? 'var(--color-emerald)' : 'var(--color-amber)',
            }}>
              {(!report.autoBugReport?.failingConfidenceBuckets || report.autoBugReport.failingConfidenceBuckets.length === 0) ? 'HEALTHY' : 'ATTENTION REQUIRED'}
            </span>
          </div>
          <div style={{ fontSize: '13px', fontWeight: 700, marginTop: '6px', color: 'var(--text-secondary)' }}>
            {report.autoBugReport?.summary || 'All active segments operating within expected parameters.'}
          </div>
        </GlassPanel>
      </div>

      {/* Confidence Bucket Analytics */}
      <GlassPanel style={{ marginBottom: '20px' }}>
        <div className="card-header-clean">
          <div className="card-title-clean"><span>CONFIDENCE BUCKET WIN RATES</span></div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Distribution of trade outcomes across decision confidence ranges</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px', marginTop: '14px' }}>
          {report.confidenceBuckets.map((b) => (
            <div key={b.bucket} style={{
              background: 'rgba(6, 9, 14, 0.6)',
              padding: '14px 10px',
              borderRadius: '8px',
              border: '1px solid var(--glass-border)',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: '6px' }}>
                {b.bucket}
              </div>
              <div style={{
                fontSize: '22px', fontWeight: 900, fontFamily: 'var(--font-mono)',
                color: b.trades === 0 ? 'var(--text-muted)' : b.winRate >= 60 ? 'var(--color-emerald)' : b.winRate >= 50 ? 'var(--color-amber)' : 'var(--color-coral)',
              }}>
                {b.trades > 0 ? `${b.winRate}%` : '—'}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {b.wins}W / {b.losses}L
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                ({b.trades} trades)
              </div>
            </div>
          ))}
        </div>
      </GlassPanel>

      {/* Asset Analytics & Market Regime Analytics */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
        <GlassPanel>
          <div className="card-header-clean">
            <div className="card-title-clean"><span>ASSET PERFORMANCE</span></div>
          </div>
          <div style={{ marginTop: '12px' }}>
            {(!(report.assetAnalytics || []).length) ? (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>No completed trade observations</div>
            ) : (
              <table className="terminal-table" style={{ fontSize: '11px' }}>
                <thead>
                  <tr>
                    <th>ASSET</th>
                    <th>TRADES</th>
                    <th>BUY/SELL</th>
                    <th>WIN RATE</th>
                  </tr>
                </thead>
                <tbody>
                  {report.assetAnalytics.map((a) => (
                    <tr key={a.asset}>
                      <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{a.asset}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{a.tradeCount}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                        {a.buyPercentage}% B / {a.sellPercentage}% S
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: a.winRate >= 50 ? 'var(--color-emerald)' : 'var(--color-coral)' }}>
                        {a.winRate}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </GlassPanel>

        <GlassPanel>
          <div className="card-header-clean">
            <div className="card-title-clean"><span>MARKET REGIME PERFORMANCE</span></div>
          </div>
          <div style={{ marginTop: '12px' }}>
            {(!(report.regimeAnalytics || []).length) ? (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>No regime observations</div>
            ) : (
              <table className="terminal-table" style={{ fontSize: '11px' }}>
                <thead>
                  <tr>
                    <th>REGIME</th>
                    <th>TRADES</th>
                    <th>WINS/LOSSES</th>
                    <th>WIN RATE</th>
                  </tr>
                </thead>
                <tbody>
                  {report.regimeAnalytics.map((r) => (
                    <tr key={r.regime}>
                      <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{r.regime}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{r.tradeCount}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{r.wins}W / {r.losses}L</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: r.winRate >= 50 ? 'var(--color-emerald)' : 'var(--color-coral)' }}>
                        {r.winRate}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </GlassPanel>
      </div>

      {/* Reason Performance */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
        <GlassPanel style={{ borderLeft: '4px solid var(--color-emerald)' }}>
          <div className="card-header-clean">
            <div className="card-title-clean"><span style={{ color: 'var(--color-emerald)' }}>TOP SUCCESSFUL REASONS</span></div>
          </div>
          <div style={{ marginTop: '12px' }}>
            {(!report.topReasons || report.topReasons.filter(r => r.winRate >= 50).length === 0) ? (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Insufficient occurrences</div>
            ) : (
              report.topReasons.filter(r => r.winRate >= 50).map((r) => (
                <div key={r.reason} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '11px' }}>
                  <span style={{ color: 'var(--text-primary)', flex: 1, paddingRight: '8px' }}>{r.reason}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-emerald)', flexShrink: 0 }}>
                    {r.winRate}% ({r.wins}W/{r.losses}L)
                  </span>
                </div>
              ))
            )}
          </div>
        </GlassPanel>

        <GlassPanel style={{ borderLeft: '4px solid var(--color-coral)' }}>
          <div className="card-header-clean">
            <div className="card-title-clean"><span style={{ color: 'var(--color-coral)' }}>TOP FAILING REASONS</span></div>
          </div>
          <div style={{ marginTop: '12px' }}>
            {(!report.topReasons || report.topReasons.filter(r => r.winRate < 50).length === 0) ? (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Insufficient occurrences</div>
            ) : (
              report.topReasons.filter(r => r.winRate < 50).map((r) => (
                <div key={r.reason} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '11px' }}>
                  <span style={{ color: 'var(--text-primary)', flex: 1, paddingRight: '8px' }}>{r.reason}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--color-coral)', flexShrink: 0 }}>
                    {r.winRate}% ({r.wins}W/{r.losses}L)
                  </span>
                </div>
              ))
            )}
          </div>
        </GlassPanel>
      </div>

      {/* Hourly Performance Chart */}
      <GlassPanel style={{ marginBottom: '20px' }}>
        <div className="card-header-clean">
          <div className="card-title-clean">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
            </svg>
            <span>HOURLY TRADING PERFORMANCE</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {bestHour && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Best hour: <strong style={{ color: 'var(--color-emerald)' }}>{bestHour.hourLabel} ({bestHour.winRate}% win rate)</strong>
              </span>
            )}
            {activeHours.length === 0 && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Populates after trades complete</span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', marginTop: '16px', padding: '0 4px' }}>
          {(report.hourlyAnalytics || []).map((h) => (
            <HourlyBar key={h.hour} h={h} maxTrades={maxHourlyTrades} />
          ))}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '16px', marginTop: '12px', justifyContent: 'center' }}>
          {[
            { color: 'var(--color-emerald)', label: '≥60% win rate' },
            { color: 'var(--color-amber)', label: '50-59% win rate' },
            { color: 'var(--color-coral)', label: '<50% win rate' },
          ].map(l => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: l.color }} />
              {l.label}
            </div>
          ))}
        </div>
      </GlassPanel>

      {/* Decision Replay Table */}
      {report.hourlyAnalytics && (
        <GlassPanel style={{ marginBottom: '20px' }}>
          <div className="card-header-clean">
            <div className="card-title-clean">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 15.75l-2.489-2.489m0 0a3.375 3.375 0 10-4.773-4.773 3.375 3.375 0 004.774 4.774zM21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>DECISION REPLAY</span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Click any row to drill into a trade decision</span>
          </div>

          {activeHours.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
              Decision replay records populate from completed trades. Start trading to build your replay log.
            </div>
          ) : (
            <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <div style={{ padding: '16px', background: 'rgba(0,229,255,0.04)', border: '1px solid rgba(0,229,255,0.1)', borderRadius: '8px' }}>
                <strong style={{ color: 'var(--accent-cyan)' }}>ℹ Replay Active</strong> — Completed trade snapshots are stored in the Trade Journal with full feature vectors (RSI, EMA, Bollinger, support/resistance, patterns, trend, momentum). Open the <strong>Trade Journal</strong> tab and click any row to inspect the full decision breakdown. Future builds will add inline replay here with P&L curves.
              </div>
            </div>
          )}
        </GlassPanel>
      )}
    </div>
  );
}
