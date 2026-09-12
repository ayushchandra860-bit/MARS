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
