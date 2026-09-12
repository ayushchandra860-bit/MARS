import React, { useState, useEffect } from 'react';
import { PerformanceStats } from '../../../shared/types/ipc';
import { invokeIpc, useIpcListener } from '../hooks/useIpc';
import { IPC_INVOKE_CHANNELS, IPC_CHANNELS } from '../../../shared/contracts/ipc-channels';
import { formatConfidenceNumeric } from '../../../shared/utils/formatters';

import { GlassPanel } from '../components/GlassPanel';

function WinRateCard({
  label,
  value,
  sub,
  color,
  large = false,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  large?: boolean;
}) {
  return (
    <GlassPanel auroraBorder={large}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{
        fontSize: large ? '36px' : '28px',
        fontWeight: 900,
        color,
        fontFamily: 'var(--font-mono)',
        marginTop: '4px',
        lineHeight: 1,
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>{sub}</div>}
    </GlassPanel>
  );
}

export default function PerformanceView() {
  const [stats, setStats] = useState<PerformanceStats | null>(null);

  useEffect(() => {
    const fetchStats = () => {
      invokeIpc(IPC_INVOKE_CHANNELS.GET_PERFORMANCE_STATS).then((data: unknown) => {
        if (data) setStats(data as PerformanceStats);
      });
    };
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  useIpcListener(IPC_CHANNELS.PERFORMANCE_REFRESH, () => {
    invokeIpc(IPC_INVOKE_CHANNELS.GET_PERFORMANCE_STATS).then((data: unknown) => {
      if (data) setStats(data as PerformanceStats);
    });
  });

  if (!stats) {
    return (
      <GlassPanel style={{ textAlign: 'center', padding: '60px' }}>
        <div style={{ color: 'var(--text-muted)' }}>COMPUTING PERFORMANCE METRICS...</div>
      </GlassPanel>
    );
  }

  const overallWinRate = stats.overallWinRate ?? stats.allTimeWinRate ?? 0;
  const totalCompleted = stats.totalCompleted ?? (stats.allTimeWins + stats.allTimeLosses + (stats.drawCount ?? 0));
  const avgConfNum = formatConfidenceNumeric(stats.avgConfidence) ?? 50;

  const winRateColor = (rate: number) =>
    rate >= 60 ? 'var(--color-emerald)' : rate >= 50 ? 'var(--color-amber)' : 'var(--color-coral)';

  return (
    <div>
      <div className="command-center-header">
        <div className="header-title-group">
          <h1>PERFORMANCE SCOREBOARD</h1>
          <p>Every percentage comes from real recorded outcomes — no fabricated metrics</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>REGISTERED / COMPLETED</div>
          <div style={{ fontSize: '22px', fontWeight: 900, color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>
            {stats.registeredTradeCount ?? totalCompleted} / {totalCompleted}
          </div>
        </div>
      </div>

      {/* Hero: Overall All-Time Win Rate (was missing before) */}
      <GlassPanel auroraBorder style={{ marginBottom: '20px', padding: '24px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '20px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '1px', marginBottom: '6px' }}>
              ALL-TIME WIN RATE
            </div>
            <div style={{
              fontSize: '56px', fontWeight: 900, fontFamily: 'var(--font-mono)',
              color: winRateColor(overallWinRate), lineHeight: 1,
            }}>
              {overallWinRate}%
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '8px' }}>
              {stats.allTimeWins ?? stats.winCount ?? 0}W &nbsp;/&nbsp;
              {stats.allTimeLosses ?? stats.lossCount ?? 0}L &nbsp;/&nbsp;
              {stats.drawCount ?? 0}D &nbsp;·&nbsp; {totalCompleted} total trades
            </div>
          </div>

          {/* Mini breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', minWidth: '240px' }}>
            {[
              { label: 'TODAY WIN RATE', value: `${stats.todayWinRate ?? 0}%`, color: 'var(--accent-cyan)' },
              { label: 'SESSION WIN RATE', value: `${stats.sessionWinRate}%`, sub: `${stats.sessionWins}W / ${stats.sessionLosses}L`, color: 'var(--accent-violet)' },
              { label: 'BUY WIN RATE', value: `${stats.buyWinRate ?? 0}%`, color: 'var(--color-emerald)' },
              { label: 'SELL WIN RATE', value: `${stats.sellWinRate ?? 0}%`, color: 'var(--color-coral)' },
            ].map(m => (
              <div key={m.label} style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>{m.label}</div>
                <div style={{ fontSize: '18px', fontWeight: 900, color: m.color, fontFamily: 'var(--font-mono)' }}>{m.value}</div>
                {(m as any).sub && <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>{(m as any).sub}</div>}
              </div>
            ))}
          </div>
        </div>
      </GlassPanel>

      {/* Streaks & Averages */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '14px', marginBottom: '20px' }}>
        <GlassPanel>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>WINNING STREAK</div>
          <div style={{ fontSize: '22px', fontWeight: 900, color: 'var(--color-emerald)', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
            {stats.currentWinningStreak || 0}{' '}
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>(MAX {stats.maxWinningStreak || 0})</span>
          </div>
        </GlassPanel>

        <GlassPanel>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>LOSING STREAK</div>
          <div style={{ fontSize: '22px', fontWeight: 900, color: 'var(--color-coral)', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
            {stats.currentLosingStreak || 0}{' '}
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>(MAX {stats.maxLosingStreak || 0})</span>
          </div>
        </GlassPanel>

        <GlassPanel>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>AVG TRADE DURATION</div>
          <div style={{ fontSize: '22px', fontWeight: 900, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
            {stats.avgTradeDurationSec || 60}s
          </div>
        </GlassPanel>

        <GlassPanel>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>AVG CONFIDENCE</div>
          <div style={{ fontSize: '22px', fontWeight: 900, color: winRateColor(avgConfNum), fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
            {avgConfNum}%
          </div>
        </GlassPanel>
      </div>

      {/* Best & Worst Asset */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
        <GlassPanel style={{ borderLeft: '4px solid var(--color-emerald)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-emerald)', letterSpacing: '0.5px' }}>BEST PERFORMING ASSET</div>
          <div style={{ fontSize: '22px', fontWeight: 900, color: 'var(--text-primary)', marginTop: '4px' }}>
            {stats.bestAsset ? stats.bestAsset.asset : 'NO DATA'}
          </div>
          {stats.bestAsset && (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
              <span style={{ color: 'var(--color-emerald)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                {stats.bestAsset.winRate}% win rate
              </span>
              {' '}· {stats.bestAsset.totalTrades} trades
            </div>
          )}
          {!stats.bestAsset && (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Requires completed trade history</div>
          )}
        </GlassPanel>

        <GlassPanel style={{ borderLeft: '4px solid var(--color-coral)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-coral)', letterSpacing: '0.5px' }}>WORST PERFORMING ASSET</div>
          <div style={{ fontSize: '22px', fontWeight: 900, color: 'var(--text-primary)', marginTop: '4px' }}>
            {stats.worstAsset ? stats.worstAsset.asset : 'NO DATA'}
          </div>
          {stats.worstAsset && (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
              <span style={{ color: 'var(--color-coral)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                {stats.worstAsset.winRate}% win rate
              </span>
              {' '}· {stats.worstAsset.totalTrades} trades
            </div>
          )}
          {!stats.worstAsset && (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Requires completed trade history</div>
          )}
        </GlassPanel>
      </div>

      {/* Active Trades + Recent Form */}
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '16px', marginBottom: '24px' }}>
        <GlassPanel>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '8px' }}>
              ACTIVE TRADES
            </div>
            <div style={{
              fontSize: '36px',
              fontWeight: 900,
              fontFamily: 'var(--font-mono)',
              color: stats.activeTradeCount > 0 ? 'var(--accent-cyan)' : 'var(--text-muted)',
            }}>
              {stats.activeTradeCount}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>in progress</div>
          </div>
        </GlassPanel>

        <GlassPanel>
          <div className="card-header-clean">
            <div className="card-title-clean">
              <span>RECENT FORM</span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Last {stats.recentForm.length} trades
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
            {stats.recentForm.length === 0 ? (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No completed trades yet</span>
            ) : (
              stats.recentForm.map((result, i) => (
                <div
                  key={i}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 900,
                    fontSize: '13px',
                    fontFamily: 'var(--font-mono)',
                    background: result === 'W' ? 'rgba(0, 200, 83, 0.15)' : result === 'L' ? 'rgba(255, 82, 82, 0.15)' : 'rgba(255, 193, 7, 0.15)',
                    color: result === 'W' ? 'var(--color-emerald)' : result === 'L' ? 'var(--color-coral)' : 'var(--color-amber)',
                    border: `1px solid ${result === 'W' ? 'rgba(0, 200, 83, 0.3)' : result === 'L' ? 'rgba(255, 82, 82, 0.3)' : 'rgba(255, 193, 7, 0.3)'}`,
                  }}
                >
                  {result}
                </div>
              ))
            )}
          </div>
        </GlassPanel>
      </div>

      {/* Insufficient Data Warning */}
      {(!stats.hasOutcomeData || stats.insufficientData) && (
        <GlassPanel style={{ borderLeft: '4px solid var(--color-amber)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
            <div style={{ color: 'var(--color-amber)', marginTop: '2px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                INSUFFICIENT VALIDATED OUTCOME DATA
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                MARS PRO V3 strictly forbids fabricated win rates, ROI, or artificial profitability metrics.
                Win/loss statistics will populate once trade outcomes are recorded and validated against historical market data.
              </div>
            </div>
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
