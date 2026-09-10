import React, { useState, useEffect } from 'react';
import { HistoryEntry, HistoryQuery } from '../../../shared/types/ipc';
import { invokeIpc } from '../hooks/useIpc';
import { IPC_INVOKE_CHANNELS } from '../../../shared/contracts/ipc-channels';
import { TradingAction } from '../../../shared/types/decision';
import { formatConfidence, formatRisk } from '../../../shared/utils/formatters';

import { GlassPanel } from '../components/GlassPanel';

function formatEntryTime(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString();
  return d.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function HistoryView() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filterAction, setFilterAction] = useState<string>('ALL');
  const [filterOutcome, setFilterOutcome] = useState<string>('ALL');
  const [todayOnly, setTodayOnly] = useState<boolean>(false);
  const [searchAsset, setSearchAsset] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);

  const fetchHistory = () => {
    setLoading(true);
    const query: HistoryQuery = {
      limit: 1000,
      action: filterAction !== 'ALL' ? (filterAction as TradingAction) : undefined,
      outcome: filterOutcome !== 'ALL' ? filterOutcome : undefined,
      todayOnly: todayOnly ? true : undefined,
      asset: searchAsset.trim() ? searchAsset.trim() : undefined,
    };

    invokeIpc(IPC_INVOKE_CHANNELS.GET_HISTORY, query)
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setHistory(data as HistoryEntry[]);
        } else {
          setHistory([]);
        }
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    setPage(1);
    fetchHistory();
  }, [filterAction, filterOutcome, todayOnly]);

  const deleteSingleTrade = async (id: string) => {
    await invokeIpc(IPC_INVOKE_CHANNELS.DELETE_TRADE, id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    fetchHistory();
  };

  const deleteSelected = async () => {
    if (selectedIds.size === 0) return;
    await invokeIpc(IPC_INVOKE_CHANNELS.DELETE_SELECTED_TRADES, Array.from(selectedIds));
    setSelectedIds(new Set());
    fetchHistory();
  };

  const clearToday = async () => {
    await invokeIpc(IPC_INVOKE_CHANNELS.CLEAR_TODAY_HISTORY);
    fetchHistory();
  };

  const clearSession = async () => {
    await invokeIpc(IPC_INVOKE_CHANNELS.CLEAR_SESSION_HISTORY);
    fetchHistory();
  };

  const clearAll = async () => {
    if (window.confirm('Are you sure you want to clear all trade history?')) {
      await invokeIpc(IPC_INVOKE_CHANNELS.CLEAR_ALL_HISTORY);
      fetchHistory();
    }
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(history.map(h => h.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const toggleSelectOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  return (
    <div>
      <div className="command-center-header">
        <div className="header-title-group">
          <h1>TRADE HISTORY & JOURNAL</h1>
          <p>Clean signal and trade records used by performance, journal, and intelligence reports</p>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            className="form-input"
            style={{ width: '160px', height: '32px', fontSize: '12px' }}
            placeholder="Search asset..."
            value={searchAsset}
            onChange={(e) => setSearchAsset(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchHistory()}
          />

          <select className="form-input" style={{ width: '100px', height: '32px', fontSize: '12px' }} value={filterAction} onChange={(e) => setFilterAction(e.target.value)}>
            <option value="ALL">ALL DIRS</option>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>

          <select className="form-input" style={{ width: '110px', height: '32px', fontSize: '12px' }} value={filterOutcome} onChange={(e) => setFilterOutcome(e.target.value)}>
            <option value="ALL">ALL RESULTS</option>
            <option value="WIN">WIN</option>
            <option value="LOSS">LOSS</option>
            <option value="DRAW">DRAW</option>
          </select>

          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={todayOnly} onChange={(e) => setTodayOnly(e.target.checked)} />
            Today Only
          </label>
        </div>
      </div>

      {/* Management Toolbar + Live Summary Stats */}
      <GlassPanel style={{ marginBottom: '16px', padding: '12px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="btn btn-secondary" style={{ fontSize: '11px', padding: '4px 10px' }} onClick={deleteSelected} disabled={selectedIds.size === 0}>
              DELETE SELECTED ({selectedIds.size})
            </button>
            <button className="btn btn-secondary" style={{ fontSize: '11px', padding: '4px 10px' }} onClick={clearToday}>
              CLEAR TODAY
            </button>
            <button className="btn btn-secondary" style={{ fontSize: '11px', padding: '4px 10px' }} onClick={clearSession}>
              CLEAR SESSION
            </button>
            {history.length > 0 && (() => {
              const w = history.filter(h => h.outcome === 'WIN').length;
              const l = history.filter(h => h.outcome === 'LOSS').length;
              const d = history.filter(h => h.outcome === 'DRAW').length;
              const completed = w + l + d;
              const wr = completed > 0 ? Math.round((w / completed) * 100) : null;
              return (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', paddingLeft: '8px', borderLeft: '1px solid var(--glass-border)' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-emerald)', fontFamily: 'var(--font-mono)' }}>{w}W</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-coral)', fontFamily: 'var(--font-mono)' }}>{l}L</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-amber)', fontFamily: 'var(--font-mono)' }}>{d}D</span>
                  {wr !== null && (
                    <span style={{
                      fontSize: '12px', fontWeight: 900, fontFamily: 'var(--font-mono)',
                      color: wr >= 60 ? 'var(--color-emerald)' : wr >= 50 ? 'var(--color-amber)' : 'var(--color-coral)',
                      padding: '2px 8px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px',
                    }}>{wr}% WR</span>
                  )}
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{history.length} records</span>
                </div>
              );
            })()}
          </div>
          <button className="btn btn-secondary" style={{ fontSize: '11px', padding: '4px 10px', color: 'var(--color-coral)', borderColor: 'rgba(239, 68, 68, 0.4)' }} onClick={clearAll}>
            CLEAR ALL SIGNAL + TRADE HISTORY
          </button>
        </div>
      </GlassPanel>

      <GlassPanel style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            QUERYING TRADE HISTORY...
          </div>
        ) : history.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              NO TRADE RECORDS FOUND
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Valid BUY/SELL signals and completed trades will appear here. Use cleanup actions if old corrupted rows are present.
            </div>
          </div>
        ) : (() => {
          const totalPages = Math.ceil(history.length / pageSize) || 1;
          const paginated = history.slice((page - 1) * pageSize, page * pageSize);

          return (
            <div>
              <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                <table className="terminal-table">
                  <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0d131f' }}>
                    <tr>
                      <th style={{ width: '30px' }}>
                        <input type="checkbox" checked={selectedIds.size === history.length && history.length > 0} onChange={(e) => toggleSelectAll(e.target.checked)} />
                      </th>
                      <th>TIME</th>
                      <th>SIGNAL</th>
                      <th>ASSET</th>
                      <th>TF</th>
                      <th>EXPIRY</th>
                      <th>CONF</th>
                      <th>RISK</th>
                      <th>OUTCOME</th>
                      <th>REASON</th>
                      <th>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((entry) => {
                      const actionColor = entry.stabilizedDecision === 'BUY' ? 'var(--color-emerald)' : entry.stabilizedDecision === 'SELL' ? 'var(--color-coral)' : 'var(--color-amber)';
                      const outcomeColor = entry.outcome === 'WIN' ? 'var(--color-emerald)' : entry.outcome === 'LOSS' ? 'var(--color-coral)' : entry.outcome === 'DRAW' ? 'var(--color-amber)' : 'var(--text-muted)';
                      return (
                        <tr key={entry.id}>
                          <td>
                            <input type="checkbox" checked={selectedIds.has(entry.id)} onChange={() => toggleSelectOne(entry.id)} />
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                            {formatEntryTime(entry.timestamp)}
                          </td>
                          <td>
                            <span style={{ fontWeight: 800, color: actionColor, fontFamily: 'var(--font-mono)' }}>
                              {entry.stabilizedDecision}
                            </span>
                          </td>
                          <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                            {entry.asset || '\u2014'}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>
                            {entry.timeframe || '\u2014'}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>
                            {entry.recommendedExpiry || '\u2014'}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                            {formatConfidence(entry.confidence)}
                          </td>
                          <td>
                            <span style={{
                              fontWeight: 600,
                              fontSize: '11px',
                              color: entry.risk === 'LOW' ? 'var(--color-emerald)' : entry.risk === 'MEDIUM' ? 'var(--color-amber)' : 'var(--color-coral)'
                            }}>
                              {formatRisk(entry.risk)}
                            </span>
                          </td>
                          <td>
                            <span style={{
                              fontWeight: 800,
                              fontSize: '11px',
                              fontFamily: 'var(--font-mono)',
                              color: outcomeColor,
                            }}>
                              {entry.outcome || '\u2014'}
                            </span>
                          </td>
                          <td style={{ maxWidth: '200px', color: 'var(--text-secondary)', fontSize: '11px' }}>
                            {entry.reason}
                          </td>
                          <td>
                            <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: '10px' }} onClick={() => deleteSingleTrade(entry.id)}>
                              DEL
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Task T5.5 Pagination Controls */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderTop: '1px solid var(--glass-border)', fontSize: '12px' }}>
                <div style={{ color: 'var(--text-muted)' }}>
                  Showing {paginated.length} of {history.length} records (Page {page} of {totalPages})
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select className="form-input" style={{ width: '80px', height: '28px', fontSize: '11px' }} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                    <option value={50}>50 / pg</option>
                    <option value={100}>100 / pg</option>
                    <option value={250}>250 / pg</option>
                  </select>
                  <button className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: '11px' }} disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                    PREV
                  </button>
                  <button className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: '11px' }} disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                    NEXT
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </GlassPanel>
    </div>
  );
}
