import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Database } from '../electron/main/database/Database';
import { CanonicalDataAccessLayer } from '../electron/main/database/CanonicalDataAccessLayer';
import { TradeRepository } from '../electron/main/database/repositories/TradeRepository';
import { MLEngine, FEATURE_NAMES } from '../electron/main/decision/MLEngine';
import { RunningTradeManager } from '../electron/main/trade/RunningTradeManager';
import { TrustedExecutionEvidenceRegistry } from '../electron/main/trade/TrustedExecutionEvidence';
import { parseBrowserTradeClickMessage } from '../electron/main/view/embeddedEventValidation';
import { deriveCorrelatedCompletionPrice, enrichBrowserTradeClick } from '../electron/main/view/tradeEvidenceEnrichment';
import { PlatformMode } from '../shared/types/canonical';
import { TradeOutcome, TradingAction } from '../shared/types/decision';

describe('trade journal and verified learning pipeline', () => {
  let db: Database;
  let dbPath: string;
  let repository: TradeRepository;
  const manager = RunningTradeManager.getInstance();
  const evidence = TrustedExecutionEvidenceRegistry.getInstance();

  beforeEach(async () => {
    dbPath = path.join(__dirname, `trade-pipeline-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = new Database(dbPath);
    await db.initialize();
    repository = new TradeRepository(db);
    manager.clearAll();
    manager.setRepository(repository);
    evidence.clear();
    MLEngine.getInstance().reset();
    CanonicalDataAccessLayer.getInstance().setDatabase(db);
  });

  afterEach(() => {
    evidence.clear();
    manager.clearAll();
    db.close();
    for (const candidate of [dbPath, `${dbPath}.bak`]) if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
  });

  it('fills missing click context only from a fresh allowlisted-page heartbeat', () => {
    const now = 1_800_000_000_000;
    const click = parseBrowserTradeClickMessage('[MARS_TRADE_CLICK]:' + JSON.stringify({
      action: 'BUY', eventId: 'click-context', executionId: 'exec-context',
      expirySeconds: 60, timestamp: now,
    }), now)!;
    const enriched = enrichBrowserTradeClick(click, {
      asset: 'EUR/USD', price: 1.0875, platformMode: PlatformMode.LIVE, observedAt: now - 200,
    }, now);
    expect(enriched).toMatchObject({ asset: 'EUR/USD', entryPrice: 1.0875, platformMode: PlatformMode.LIVE });

    const stale = enrichBrowserTradeClick(click, {
      asset: 'GBP/USD', price: 1.2, platformMode: PlatformMode.LIVE, observedAt: now - 10_000,
    }, now);
    expect(stale.asset).toBeNull();
    expect(stale.entryPrice).toBeNull();
    expect(stale.platformMode).toBe(PlatformMode.UNKNOWN);
  });

  it('keeps incomplete captured trades visible in the authoritative journal ledger', () => {
    const trade = manager.registerTrade({
      sessionId: 'journal-session', signalId: 'signal-visible', asset: null,
      direction: TradingAction.BUY, eventId: 'journal-click', platformMode: PlatformMode.UNKNOWN,
    });
    expect(trade).not.toBeNull();
    const entries = CanonicalDataAccessLayer.getInstance().getJournalEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: trade!.id, asset: null, tradeStatus: 'ACTIVE', outcome: null });
    expect(CanonicalDataAccessLayer.getInstance().getPerformanceStats().registeredTradeCount).toBe(1);
  });

  it('preserves fresh fallback facts and learns after a verified LIVE completion', () => {
    evidence.stage({
      executionId: 'exec-fallback', eventId: 'click-fallback', action: TradingAction.SELL,
      asset: null, entryPrice: null, expirySeconds: 60,
      platformMode: PlatformMode.UNKNOWN, capturedAt: Date.now(),
    });
    const features = new Array(FEATURE_NAMES.length).fill(0.5);
    const trade = manager.registerTrade({
      sessionId: 'live-session', signalId: 'signal-fallback', executionId: 'exec-fallback',
      eventId: 'click-fallback', asset: 'EUR/USD', direction: TradingAction.SELL,
      entryPrice: '1.0900', platformMode: PlatformMode.LIVE,
      confidence: 0.7, mlFeatures: features,
    });
    expect(trade).toMatchObject({
      signalId: 'signal-fallback', asset: 'EUR/USD', entryPrice: '1.0900',
      platformMode: PlatformMode.LIVE,
    });
    expect(manager.resolveTradeOutcome(trade!.id, TradeOutcome.WIN, '1.0890')).toBe(true);
    expect(MLEngine.getInstance().getSampleCount('EUR/USD')).toBe(1);
  });

  it('uses a result-time quote only for a fresh exact-asset correlation', () => {
    const trade = { asset: 'EUR/USD' } as any;
    const now = Date.now();
    expect(deriveCorrelatedCompletionPrice(trade, {
      asset: 'EUR/USD', price: 1.0891, platformMode: PlatformMode.LIVE, observedAt: now - 100,
    }, now)).toBe('1.0891');
    expect(deriveCorrelatedCompletionPrice(trade, {
      asset: 'GBP/USD', price: 1.25, platformMode: PlatformMode.LIVE, observedAt: now - 100,
    }, now)).toBeNull();
    expect(deriveCorrelatedCompletionPrice(trade, {
      asset: 'EUR/USD', price: 1.0891, platformMode: PlatformMode.LIVE, observedAt: now - 10_000,
    }, now)).toBeNull();
  });
});
