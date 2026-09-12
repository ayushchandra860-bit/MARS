import { PlatformMode } from '../../../shared/types/canonical';
import { AuthoritativeTradeRecord } from '../../../shared/types/decision';
import { BrowserTradeClickEvent } from './embeddedEventValidation';

export interface MarketSnapshotEvidence {
  asset: string | null;
  price: number | null;
  platformMode: PlatformMode | 'DEMO' | 'LIVE' | 'UNKNOWN';
  observedAt: number;
}

function normalizeAsset(value: string | null | undefined): string {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function validPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1e12;
}

function validAsset(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 80;
}

function isFresh(snapshot: MarketSnapshotEvidence | null | undefined, now: number, maxAgeMs: number): snapshot is MarketSnapshotEvidence {
  return Boolean(
    snapshot
    && Number.isFinite(snapshot.observedAt)
    && snapshot.observedAt <= now + 1_000
    && now - snapshot.observedAt <= Math.max(250, maxAgeMs)
  );
}

/**
 * A trade click and the quote heartbeat are both parsed in the main process from
 * the same allowlisted Olymp Trade page. Missing optional click fields may be
 * filled only from a fresh heartbeat; explicit click fields always win.
 */
export function enrichBrowserTradeClick(
  click: BrowserTradeClickEvent,
  snapshot: MarketSnapshotEvidence | null | undefined,
  now = Date.now(),
  maxAgeMs = 3_000,
): BrowserTradeClickEvent {
  if (!isFresh(snapshot, now, maxAgeMs)) return click;

  const asset = validAsset(click.asset)
    ? click.asset.trim()
    : validAsset(snapshot.asset) ? snapshot.asset.trim() : null;
  const entryPrice = validPrice(click.entryPrice)
    ? click.entryPrice
    : validPrice(snapshot.price) ? snapshot.price : null;
  const snapshotMode = String(snapshot.platformMode);
  const platformMode: PlatformMode = click.platformMode !== PlatformMode.UNKNOWN
    ? click.platformMode
    : snapshotMode === PlatformMode.LIVE
      ? PlatformMode.LIVE
      : snapshotMode === PlatformMode.DEMO
        ? PlatformMode.DEMO
        : PlatformMode.UNKNOWN;

  return {
    ...click,
    asset,
    entryPrice,
    platformMode,
    nodeInfo: {
      ...click.nodeInfo,
      assetName: asset,
      entryPrice,
      platformMode,
    },
  };
}

/**
 * A broker result may omit its closing quote. Reuse the latest heartbeat only
 * when it is fresh and belongs to the exactly correlated trade asset.
 */
export function deriveCorrelatedCompletionPrice(
  trade: Pick<AuthoritativeTradeRecord, 'asset'> | null | undefined,
  snapshot: MarketSnapshotEvidence | null | undefined,
  resultTimestamp: number,
  maxAgeMs = 5_000,
): string | null {
  if (!trade || !isFresh(snapshot, resultTimestamp, maxAgeMs)) return null;
  const tradeAsset = normalizeAsset(trade.asset);
  const snapshotAsset = normalizeAsset(snapshot.asset);
  if (!tradeAsset || !snapshotAsset || tradeAsset !== snapshotAsset || !validPrice(snapshot.price)) return null;
  return String(snapshot.price);
}
