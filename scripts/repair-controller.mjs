import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const controllerPath = 'electron/main/lifecycle/AnalysisController.ts';
const greenCommit = 'ba8c2b0bd6de5056a32ce808b3a4af1df501a142';
let source = execFileSync('git', ['show', `${greenCommit}:${controllerPath}`], { encoding: 'utf8' });

source = source.replace("import { OutcomeEvaluator } from '../brain/OutcomeEvaluator';\n", '');
source = source.replace(
  "import { EmbeddedBrowserManager } from '../view/EmbeddedBrowserManager';\n",
  "import { EmbeddedBrowserManager } from '../view/EmbeddedBrowserManager';\nimport { deriveVerifiedPriceOutcome } from '../trade/verifiedTradeOutcome';\n",
);
source = source.replace('RiskLevel, TradeOutcome, SignalStatusLabel', 'RiskLevel, SignalStatusLabel');
source = source.replace('  private outcomeEvaluator: OutcomeEvaluator;\n', '');
source = source.replace('    this.outcomeEvaluator = new OutcomeEvaluator();\n', '');

const resultHandlerStart = source.indexOf('    EmbeddedBrowserManager.getInstance().setTradeResultHandler');
const resultHandlerEnd = source.indexOf('\n\n    if (database)', resultHandlerStart);
if (resultHandlerStart < 0 || resultHandlerEnd < 0) throw new Error('Legacy result handler not found.');
source = source.slice(0, resultHandlerStart) + source.slice(resultHandlerEnd);

const lifecycleStart = source.indexOf('  private updateTradeLifecycle(observation: any): void {');
const lifecycleEnd = source.indexOf('\n  private createTrackedTrade(', lifecycleStart);
if (lifecycleStart < 0 || lifecycleEnd < 0) throw new Error('Trade lifecycle method not found.');
const lifecycleMethod = `  private updateTradeLifecycle(observation: any): void {
    const manager = TradeLifecycleManager.getInstance();
    const activeTrades = manager.getActiveTrades();
    if (activeTrades.length === 0) return;

    const now = Date.now();
    let anyResolved = false;
    for (const trade of activeTrades) {
      if (trade.expiryTimestamp > now) continue;
      manager.handleTradeExpiry(trade.id);
      const verified = deriveVerifiedPriceOutcome(trade, observation);
      if (!verified) continue;
      if (manager.resolveTradeOutcome(trade.id, verified.outcome, verified.completionPrice)) {
        anyResolved = true;
      }
    }
    if (anyResolved) this.emitPerformanceRefresh();
  }
`;
source = source.slice(0, lifecycleStart) + lifecycleMethod + source.slice(lifecycleEnd);

const clickStart = source.indexOf('  private handleDetectedTradeClick(');
if (clickStart < 0) throw new Error('Trade click handler not found.');
let tail = source.slice(clickStart);
tail = tail.replace(
  "    if (!this.isValidAssetName(asset)) {\n      asset = 'OTC ASSET';\n    }",
  "    if (!this.isValidAssetName(asset)) {\n      asset = null;\n    }",
);
tail = tail.replace("    if (!entryPrice) {\n      entryPrice = 1.0;\n    }\n", '');
tail = tail.replace(
  '    TradeLifecycleManager.getInstance().registerTrade({\n',
  '    const registeredTrade = TradeLifecycleManager.getInstance().registerTrade({\n',
);
tail = tail.replace(
  '      eventId: event.eventId,\n      direction: event.action,',
  "      eventId: event.eventId,\n      executionId: typeof (event as any).executionId === 'string' ? (event as any).executionId : undefined,\n      platformMode: (event as any).platformMode,\n      direction: event.action,",
);
tail = tail.replace(
  '      entryPrice: entryPrice.toString(),',
  '      entryPrice: entryPrice ? entryPrice.toString() : null,',
);
tail = tail.replace(
  '    });\n\n    this.lastTradeStatusState =',
  "    });\n\n    if (!registeredTrade) return;\n    const confirmedSignalId = registeredTrade.signalId || `trade-${registeredTrade.id}`;\n\n    this.lastTradeStatusState =",
);
tail = tail.replace('      const remaining = expirySeconds;', '      const remaining = registeredTrade.expirySeconds;');
tail = tail.replace('          signalId,', '          signalId: confirmedSignalId,');
tail = tail.replace('          originalAction: event.action,', '          originalAction: registeredTrade.direction,');
tail = tail.replace(
  '          originalConfidence: activeSignalMatches ? (this.activeSignal!.originalConfidence ?? 0) : 0,',
  '          originalConfidence: registeredTrade.confidence ?? 0,',
);
tail = tail.replace('          entryTimestamp: Date.now(),', '          entryTimestamp: registeredTrade.entryTimestamp,');
tail = tail.replace('          recommendedExpiry: expiryLabel,', '          recommendedExpiry: registeredTrade.expiryLabel || expiryLabel,');
tail = tail.replace(
  "          reason: activeSignalMatches ? (this.activeSignal!.originalReasons[0] || 'Signal execution') : 'Manual trade entry',",
  "          reason: registeredTrade.reasons?.[0] || 'Verified trade execution',",
);
source = source.slice(0, clickStart) + tail;

const required = [
  'deriveVerifiedPriceOutcome(trade, observation)',
  'executionId: typeof (event as any).executionId',
  'if (!registeredTrade) return;',
  'asset = null;',
  'entryPrice: entryPrice ? entryPrice.toString() : null',
];
for (const marker of required) {
  if (!source.includes(marker)) throw new Error(`Required repair is missing: ${marker}`);
}
for (const marker of ["asset = 'OTC ASSET'", 'entryPrice = 1.0', "TradeOutcome.UNRESOLVED,\n            '0'"]) {
  if (source.includes(marker)) throw new Error(`Unsafe fallback survived: ${marker}`);
}

writeFileSync(controllerPath, source, 'utf8');
console.log(`Repaired ${controllerPath} (${readFileSync(controllerPath, 'utf8').length} chars).`);
