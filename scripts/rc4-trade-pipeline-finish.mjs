import fs from 'node:fs';

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, content) { fs.writeFileSync(file, content, 'utf8'); }
function replaceOnce(file, oldText, newText) {
  const source = read(file);
  if (source.includes(newText)) return;
  const count = source.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${file}: expected one match, found ${count}`);
  write(file, source.replace(oldText, newText));
}

const enrichment = 'electron/main/view/tradeEvidenceEnrichment.ts';
replaceOnce(enrichment,
  [
    '  const platformMode = click.platformMode !== PlatformMode.UNKNOWN',
    '    ? click.platformMode',
    '    : snapshot.platformMode === PlatformMode.LIVE || snapshot.platformMode === PlatformMode.DEMO',
    '      ? snapshot.platformMode',
    '      : PlatformMode.UNKNOWN;',
  ].join('\n'),
  [
    '  const platformMode: PlatformMode = click.platformMode !== PlatformMode.UNKNOWN',
    '    ? click.platformMode',
    "    : snapshot.platformMode === PlatformMode.LIVE || snapshot.platformMode === 'LIVE'",
    '      ? PlatformMode.LIVE',
    "      : snapshot.platformMode === PlatformMode.DEMO || snapshot.platformMode === 'DEMO'",
    '        ? PlatformMode.DEMO',
    '        : PlatformMode.UNKNOWN;',
  ].join('\n'));
replaceOnce(enrichment,
  [
    '  const platformMode: PlatformMode = click.platformMode !== PlatformMode.UNKNOWN',
    '    ? click.platformMode',
    "    : snapshot.platformMode === PlatformMode.LIVE || snapshot.platformMode === 'LIVE'",
    '      ? PlatformMode.LIVE',
    "      : snapshot.platformMode === PlatformMode.DEMO || snapshot.platformMode === 'DEMO'",
    '        ? PlatformMode.DEMO',
    '        : PlatformMode.UNKNOWN;',
  ].join('\n'),
  [
    '  const snapshotMode = String(snapshot.platformMode);',
    '  const platformMode: PlatformMode = click.platformMode !== PlatformMode.UNKNOWN',
    '    ? click.platformMode',
    '    : snapshotMode === PlatformMode.LIVE',
    '      ? PlatformMode.LIVE',
    '      : snapshotMode === PlatformMode.DEMO',
    '        ? PlatformMode.DEMO',
    '        : PlatformMode.UNKNOWN;',
  ].join('\n'));

const ipcTypes = 'shared/types/ipc.ts';
replaceOnce(ipcTypes,
  [
    'export interface HistoryEntry {',
    '  id: string;',
    '  signalId?: string | null;',
    '  sessionId: string;',
    '  timestamp: number;',
    '  asset: string | null;',
    '  platformMode?: PlatformMode | null;',
    '  timeframe: string | null;',
  ].join('\n'),
  [
    'export interface HistoryEntry {',
    '  id: string;',
    '  signalId?: string | null;',
    '  sessionId: string;',
    '  timestamp: number;',
    '  asset: string | null;',
    '  platformMode?: PlatformMode | null;',
    '  tradeStatus?: string | null;',
    '  timeframe: string | null;',
  ].join('\n'));
replaceOnce(ipcTypes,
  [
    '  allTimeLosses: number;',
    '  allTimeWinRate: number;',
    '  activeTradeCount: number;',
    "  recentForm: ('W' | 'L' | 'D')[];",
  ].join('\n'),
  [
    '  allTimeLosses: number;',
    '  allTimeWinRate: number;',
    '  activeTradeCount: number;',
    '  /** Every captured execution, including active or incomplete records. */',
    '  registeredTradeCount?: number;',
    '  unresolvedTradeCount?: number;',
    "  recentForm: ('W' | 'L' | 'D')[];",
  ].join('\n'));

const journal = 'frontend/src/control-center/JournalView.tsx';
replaceOnce(journal,
  [
    "import { GlassPanel } from '../components/GlassPanel';",
    "import { formatConfidence } from '../../../shared/utils/formatters';",
  ].join('\n'),
  [
    "import { GlassPanel } from '../components/GlassPanel';",
    "import TradePipelineSummary from './TradePipelineSummary';",
    "import { formatConfidence } from '../../../shared/utils/formatters';",
  ].join('\n'));
replaceOnce(journal,
  '      </div>\n\n      {/* Calibration Dataset Readiness Banner */}',
  '      </div>\n\n      <TradePipelineSummary />\n\n      {/* Calibration Dataset Readiness Banner */}');
replaceOnce(journal,
  '      {/* Journal Table */}\n      <GlassPanel style={{ padding: 0 }}>',
  [
    '      <div style={{ fontSize: \'11px\', fontWeight: 800, color: \'var(--text-muted)\', letterSpacing: \'0.6px\', margin: \'4px 0 10px\' }}>',
    '        ML-ELIGIBLE CALIBRATION SNAPSHOTS ONLY',
    '      </div>',
    '',
    '      {/* Strict calibration sample table; the complete execution ledger is above. */}',
    '      <GlassPanel style={{ padding: 0 }}>',
  ].join('\n'));

const performance = 'frontend/src/control-center/PerformanceView.tsx';
replaceOnce(performance,
  [
    "          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>COMPLETED TRADES</div>",
    "          <div style={{ fontSize: '22px', fontWeight: 900, color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>",
    '            {totalCompleted}',
    '          </div>',
  ].join('\n'),
  [
    "          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>REGISTERED / COMPLETED</div>",
    "          <div style={{ fontSize: '22px', fontWeight: 900, color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>",
    '            {stats.registeredTradeCount ?? totalCompleted} / {totalCompleted}',
    '          </div>',
  ].join('\n'));

const analytics = 'electron/main/analytics/AnalyticsEngine.ts';
replaceOnce(analytics,
  [
    "import { CanonicalDataAccessLayer } from '../database/CanonicalDataAccessLayer';",
    "import { PerformanceStats, HistoryEntry } from '../../../shared/types/ipc';",
  ].join('\n'),
  [
    "import { CanonicalDataAccessLayer } from '../database/CanonicalDataAccessLayer';",
    "import { CalibrationDatasetManager } from '../brain/CalibrationDatasetManager';",
    "import { PerformanceStats, HistoryEntry } from '../../../shared/types/ipc';",
  ].join('\n'));
replaceOnce(analytics,
  [
    '  public setDatabase(db: Database): void {',
    '    this.dal.setDatabase(db);',
    '  }',
  ].join('\n'),
  [
    '  public setDatabase(db: Database): void {',
    '    this.dal.setDatabase(db);',
    '    CalibrationDatasetManager.getInstance().setDatabase(db);',
    '  }',
  ].join('\n'));
replaceOnce(analytics,
  [
    '    const entries = this.dal.getJournalEntries(sessionId ? { sessionId } : {});',
    "    const completed = entries.filter((e) => e.outcome === 'WIN' || e.outcome === 'LOSS' || e.outcome === 'DRAW');",
  ].join('\n'),
  [
    '    const entries = this.dal.getJournalEntries(sessionId ? { sessionId } : {});',
    '    const verifiedTradeIds = new Set(',
    '      CalibrationDatasetManager.getInstance().getCalibrationObservations()',
    '        .filter((snapshot) => !sessionId || snapshot.sessionId === sessionId)',
    '        .map((snapshot) => snapshot.tradeId),',
    '    );',
    '    const completed = entries.filter((entry) => verifiedTradeIds.has(entry.id));',
  ].join('\n'));

const summary = 'frontend/src/control-center/TradePipelineSummary.tsx';
replaceOnce(summary,
  "      invokeIpc<HistoryEntry[]>(IPC_INVOKE_CHANNELS.GET_HISTORY, { limit: 500 }),",
  "      invokeIpc<HistoryEntry[]>(IPC_INVOKE_CHANNELS.GET_HISTORY, { limit: 1000 }),");
replaceOnce(summary,
  [
    '  const registered = stats?.registeredTradeCount ?? history.length;',
    '  const completed = stats?.totalCompleted ?? history.filter((trade) => Boolean(trade.outcome)).length;',
    '  const active = stats?.activeTradeCount ?? history.filter((trade) => !trade.outcome).length;',
    '  const samples = learning?.sampleSize ?? 0;',
    '  const recent = history.slice(0, 12);',
  ].join('\n'),
  [
    '  const registered = stats?.registeredTradeCount ?? history.length;',
    '  const completed = stats?.totalCompleted ?? history.filter((trade) => Boolean(trade.outcome)).length;',
    '  const unresolved = stats?.unresolvedTradeCount ?? stats?.activeTradeCount ?? history.filter((trade) => !trade.outcome).length;',
    '  const samples = learning?.sampleSize ?? 0;',
    '  const ledger = history;',
  ].join('\n'));
replaceOnce(summary,
  "    { label: 'ACTIVE / UNRESOLVED', value: active, color: 'var(--color-amber)' },",
  "    { label: 'ACTIVE / UNRESOLVED', value: unresolved, color: 'var(--color-amber)' },");
replaceOnce(summary,
  [
    "      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: recent.length ? '12px' : 0 }}>",
    '        Har captured trade ledger me dikhna chahiye. ML me sirf verified <strong>LIVE</strong> WIN/LOSS trade jayega jisme valid asset, entry/exit quote aur feature snapshot ho. DEMO, UNKNOWN ya unresolved trades ledger me dikhenge, par LIVE model ko contaminate nahi karenge.',
    '      </div>',
    '',
    '      {recent.length > 0 && (',
    "        <div style={{ overflowX: 'auto' }}>",
  ].join('\n'),
  [
    "      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: ledger.length ? '12px' : 0 }}>",
    '        Har captured trade neeche authoritative ledger me dikhega. ML me sirf verified <strong>LIVE</strong> WIN/LOSS trade jayega jisme valid asset, entry/exit quote aur 11-feature snapshot ho. DEMO, UNKNOWN, unresolved, stale ya mismatched trades ledger me rahenge, par LIVE model ko contaminate nahi karenge.',
    '      </div>',
    '',
    '      {ledger.length === 0 ? (',
    "        <div style={{ padding: '18px 0 6px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>",
    '          NO CAPTURED EXECUTIONS YET',
    '        </div>',
    '      ) : (',
    '        <>',
    "          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '0.6px', marginBottom: '8px' }}>",
    '            AUTHORITATIVE TRADE LEDGER · {ledger.length} LOADED',
    '          </div>',
    "          <div style={{ overflow: 'auto', maxHeight: '440px' }}>",
  ].join('\n'));
replaceOnce(summary,
  '              {recent.map((trade) => (',
  '              {ledger.map((trade) => (');
replaceOnce(summary,
  [
    '          </table>',
    '        </div>',
    '      )}',
    '    </GlassPanel>',
  ].join('\n'),
  [
    '            </table>',
    '          </div>',
    '        </>',
    '      )}',
    '    </GlassPanel>',
  ].join('\n'));

const pipelineTest = 'tests/trade-journal-learning-pipeline.test.ts';
replaceOnce(pipelineTest,
  "  it('uses a result-time quote only for a fresh exact-asset correlation', () => {",
  [
    "  it('does not train the LIVE model from DEMO or UNKNOWN-mode outcomes', () => {",
    '    const features = new Array(FEATURE_NAMES.length).fill(0.4);',
    '    for (const [index, platformMode] of [PlatformMode.DEMO, PlatformMode.UNKNOWN].entries()) {',
    '      const trade = manager.registerTrade({',
    "        sessionId: 'excluded-session', signalId: `excluded-signal-${index}`,",
    "        eventId: `excluded-click-${index}`, asset: 'EUR/USD', direction: TradingAction.BUY,",
    "        entryPrice: '1.0800', platformMode, confidence: 0.65, mlFeatures: features,",
    '      });',
    '      expect(trade).not.toBeNull();',
    "      expect(manager.resolveTradeOutcome(trade!.id, TradeOutcome.WIN, '1.0810')).toBe(true);",
    '    }',
    "    expect(MLEngine.getInstance().getSampleCount('EUR/USD')).toBe(0);",
    '  });',
    '',
    "  it('uses a result-time quote only for a fresh exact-asset correlation', () => {",
  ].join('\n'));

for (const file of ['package.json', 'package-lock.json']) {
  const json = JSON.parse(read(file));
  json.version = '3.0.1-rc.4';
  if (file === 'package-lock.json' && json.packages?.['']) json.packages[''].version = '3.0.1-rc.4';
  write(file, JSON.stringify(json, null, 2) + '\n');
}

for (const file of ['.github/workflows/windows-installer.yml', 'tests/rc3-final-performance-contract.test.ts']) {
  const source = read(file);
  write(file, source.replaceAll('v3.0.1-rc.3', 'v3.0.1-rc.4').replaceAll('3.0.1-rc.3', '3.0.1-rc.4'));
}

console.log('RC4 trade pipeline finish patch applied successfully.');
