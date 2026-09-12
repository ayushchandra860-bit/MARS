import fs from 'node:fs';

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, content) { fs.writeFileSync(file, content, 'utf8'); }
function replaceOnce(file, oldText, newText) {
  const source = read(file);
  const occurrences = source.split(oldText).length - 1;
  if (occurrences !== 1) throw new Error(`${file}: expected one match, found ${occurrences}`);
  write(file, source.replace(oldText, newText));
}
function replaceSection(file, start, end, replacement) {
  const source = read(file);
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) throw new Error(`${file}: section markers not found`);
  if (source.indexOf(start, startIndex + 1) >= 0) throw new Error(`${file}: start marker is not unique`);
  write(file, source.slice(0, startIndex) + replacement + source.slice(endIndex));
}

const lifecycle = 'electron/main/trade/TradeLifecycleManager.ts';
replaceOnce(lifecycle,
  [
    '    const asset = trusted ? trusted.asset : params.asset;',
    '    const contextMatchesEvidence = !trusted || Boolean(',
    '      trusted.asset',
    '      && this.assetKey(trusted.asset) === this.assetKey(params.asset)',
    '      && trusted.action === params.direction',
    '    );',
  ].join('\n'),
  [
    "    const trustedAsset = typeof trusted?.asset === 'string' && trusted.asset.trim() ? trusted.asset.trim() : null;",
    "    const fallbackAsset = typeof params.asset === 'string' && params.asset.trim() ? params.asset.trim() : null;",
    '    const asset = trustedAsset || fallbackAsset;',
    '    const hasMainProcessFeatureContext = Array.isArray(params.mlFeatures) && params.mlFeatures.length > 0;',
    '    const contextMatchesEvidence = !trusted || Boolean(',
    '      trusted.action === params.direction',
    '      && (',
    '        trustedAsset',
    '          ? this.assetKey(trustedAsset) === this.assetKey(fallbackAsset)',
    '          : fallbackAsset && hasMainProcessFeatureContext',
    '      )',
    '    );',
  ].join('\n'));
replaceOnce(lifecycle,
  [
    '    const entryPrice = trusted',
    '      ? trusted.entryPrice === null ? null : String(trusted.entryPrice)',
    '      : params.entryPrice ?? null;',
  ].join('\n'),
  [
    "    const fallbackEntryPrice = typeof params.entryPrice === 'string' && params.entryPrice.trim()",
    '      ? params.entryPrice.trim()',
    '      : null;',
    '    const entryPrice = trusted?.entryPrice !== null && trusted?.entryPrice !== undefined',
    '      ? String(trusted.entryPrice)',
    '      : fallbackEntryPrice;',
  ].join('\n'));
replaceOnce(lifecycle,
  '      platformMode: trusted?.platformMode ?? params.platformMode ?? PlatformMode.UNKNOWN,',
  [
    '      platformMode: trusted?.platformMode && trusted.platformMode !== PlatformMode.UNKNOWN',
    '        ? trusted.platformMode',
    '        : params.platformMode ?? trusted?.platformMode ?? PlatformMode.UNKNOWN,',
  ].join('\n'));

const browser = 'electron/main/view/EmbeddedBrowserManager.ts';
replaceOnce(browser,
  "} from './embeddedEventValidation';",
  [
    "} from './embeddedEventValidation';",
    "import { deriveCorrelatedCompletionPrice, enrichBrowserTradeClick } from './tradeEvidenceEnrichment';",
  ].join('\n'));
replaceSection(browser,
  '      const click = parseBrowserTradeClickMessage(message);',
  '      const result = parseBrowserTradeResultMessage(message);',
  [
    '      const click = parseBrowserTradeClickMessage(message);',
    '      if (click) {',
    '        const contextualClick = enrichBrowserTradeClick(click, this.latestMarketSnapshot);',
    '        const manager = RunningTradeManager.getInstance();',
    '        const evidence = TrustedExecutionEvidenceRegistry.getInstance();',
    '        evidence.stage({',
    '          executionId: contextualClick.executionId,',
    '          eventId: contextualClick.eventId,',
    '          action: contextualClick.action,',
    '          asset: contextualClick.asset,',
    '          entryPrice: contextualClick.entryPrice,',
    '          expirySeconds: contextualClick.expirySeconds,',
    '          platformMode: contextualClick.platformMode,',
    '          capturedAt: contextualClick.timestamp,',
    '        });',
    '',
    '        let trade = manager.findTradeByExecutionId(contextualClick.executionId);',
    '        if (!trade) {',
    '          try { this.tradeClickHandler?.(contextualClick); } catch (error) {',
    "            console.error('[MARS Browser Detector] Trade-click subscriber failed:', error);",
    '          }',
    '          trade = manager.findTradeByExecutionId(contextualClick.executionId);',
    '        }',
    '',
    '        if (!trade) {',
    '          trade = manager.registerTrade({',
    "            sessionId: 'live-browser',",
    "            signalId: 'browser-' + contextualClick.executionId,",
    '            executionId: contextualClick.executionId,',
    '            asset: contextualClick.asset,',
    '            direction: contextualClick.action,',
    '            expirySeconds: contextualClick.expirySeconds,',
    '            entryPrice: contextualClick.entryPrice === null ? null : String(contextualClick.entryPrice),',
    '            eventId: contextualClick.eventId,',
    '            platformMode: contextualClick.platformMode,',
    '          }) ?? undefined;',
    '        }',
    '        evidence.discard(contextualClick.executionId);',
    '        if (trade) this.emitTradeStateRefresh();',
    '        return;',
    '      }',
    '',
  ].join('\n'));
replaceSection(browser,
  '      const result = parseBrowserTradeResultMessage(message);',
  '    });\n\n    void contents.loadURL',
  [
    '      const result = parseBrowserTradeResultMessage(message);',
    '      if (!result) return;',
    "      const outcome = result.outcome === 'WIN'",
    '        ? TradeOutcome.WIN',
    "        : result.outcome === 'LOSS' ? TradeOutcome.LOSS : TradeOutcome.DRAW;",
    '      const manager = RunningTradeManager.getInstance();',
    '      const correlatedTrade = result.executionId',
    '        ? manager.findTradeByExecutionId(result.executionId)',
    '        : undefined;',
    '      const verifiedExitPrice = result.completionPrice !== null',
    '        ? String(result.completionPrice)',
    '        : deriveCorrelatedCompletionPrice(correlatedTrade, this.latestMarketSnapshot, result.timestamp);',
    '      const completed = result.executionId',
    '        ? manager.resolveTradeByExecutionId(result.executionId, outcome, verifiedExitPrice)',
    '        : manager.resolveNextActiveTrade(outcome, null);',
    '      if (completed) this.emitTradeStateRefresh();',
  ].join('\n'));

const detector = 'electron/main/view/embeddedTradeDetector.ts';
replaceOnce(detector,
  "  function textOf(el) { return el ? String(el.value || el.innerText || el.textContent || '').trim() : ''; }",
  "  function textOf(el) { return el ? String(el.value || el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim() : ''; }");
replaceOnce(detector,
  "    var value = firstText('[data-test=\"asset-select-button\"], [data-test=\"asset-name\"], .asset-select__name, .asset-name, [class*=\"assetName\"], [class*=\"asset-title\"]', root);",
  "    var value = firstText('[data-test=\"asset-select-button\"], [data-test=\"asset-name\"], [data-qa*=\"asset\"], [data-testid*=\"asset\"], [aria-label*=\"asset\" i], .asset-select__name, .asset-name, [class*=\"assetName\"], [class*=\"asset-title\"]', root);");
replaceOnce(detector,
  "    var raw = firstText('[data-test=\"current-price\"], [data-test=\"current-quote\"], [data-test*=\"asset-price\"], [class*=\"current-price\"], [class*=\"currentPrice\"]', root);",
  "    var raw = firstText('[data-test=\"current-price\"], [data-test=\"current-quote\"], [data-test*=\"asset-price\"], [data-qa*=\"current-price\"], [data-testid*=\"current-price\"], [class*=\"current-price\"], [class*=\"currentPrice\"]', root);");
replaceOnce(detector,
  "    var mode = firstText('[data-test*=\"account-mode\"], [data-test*=\"account-type\"], [class*=\"account-mode\"], [class*=\"accountMode\"], [class*=\"account-type\"], [class*=\"accountType\"]');",
  "    var mode = firstText('[data-test*=\"account-mode\"], [data-test*=\"account-type\"], [data-qa*=\"account\"], [data-testid*=\"account\"], [aria-label*=\"account\" i], [title*=\"account\" i], [class*=\"account-mode\"], [class*=\"accountMode\"], [class*=\"account-type\"], [class*=\"accountType\"]');");

const dal = 'electron/main/database/CanonicalDataAccessLayer.ts';
replaceOnce(dal,
  [
    '      const conditions: string[] = [',
    "        \"t.asset IS NOT NULL AND TRIM(t.asset) NOT IN ('', '▲', '▼', 'UNKNOWN')\",",
    "        \"(s.id IS NOT NULL OR t.signal_id LIKE 'manual-%' OR t.signal_id LIKE 'trade-%' OR t.signal_id LIKE 'signal-%')\"",
    '      ];',
  ].join('\n'),
  '      const conditions: string[] = [];');
replaceOnce(dal,
  '          platformMode: (r.platform_mode as PlatformMode) || null,',
  [
    '          platformMode: (r.platform_mode as PlatformMode) || null,',
    '          tradeStatus: r.status || null,',
  ].join('\n'));
replaceOnce(dal,
  '      const activeTradeCount = activeCountRow?.count ?? 0;',
  [
    '      const activeTradeCount = activeCountRow?.count ?? 0;',
    '      const registeredCountRow = this.db.prepare(',
    "        'SELECT COUNT(*) as count FROM tracked_trades'",
    '      ).get() as { count: number } | undefined;',
    '      const registeredTradeCount = registeredCountRow?.count ?? 0;',
  ].join('\n'));
replaceOnce(dal,
  '        activeTradeCount,\n        recentForm,',
  '        activeTradeCount,\n        registeredTradeCount,\n        unresolvedTradeCount: activeTradeCount,\n        recentForm,');
replaceOnce(dal,
  '      activeTradeCount: 0,\n      recentForm: [],',
  '      activeTradeCount: 0,\n      registeredTradeCount: 0,\n      unresolvedTradeCount: 0,\n      recentForm: [],');

const ipcTypes = 'shared/types/ipc.ts';
replaceOnce(ipcTypes,
  '  platformMode?: PlatformMode | null;\n  timeframe: string | null;',
  '  platformMode?: PlatformMode | null;\n  tradeStatus?: string | null;\n  timeframe: string | null;');
replaceOnce(ipcTypes,
  '  activeTradeCount: number;\n  recentForm:',
  '  activeTradeCount: number;\n  /** Every captured execution, including active or incomplete records. */\n  registeredTradeCount?: number;\n  unresolvedTradeCount?: number;\n  recentForm:');

const journal = 'frontend/src/control-center/JournalView.tsx';
replaceOnce(journal,
  "import { GlassPanel } from '../components/GlassPanel';",
  "import { GlassPanel } from '../components/GlassPanel';\nimport TradePipelineSummary from './TradePipelineSummary';");
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
  write(file, source.replaceAll('3.0.1-rc.3', '3.0.1-rc.4').replaceAll('v3.0.1-rc.3', 'v3.0.1-rc.4'));
}

console.log('RC4 trade pipeline source patch applied successfully.');
