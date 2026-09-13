import { PlatformMode } from '../../../shared/types/canonical';
import { TradingAction } from '../../../shared/types/decision';

const CLICK_PREFIX = '[MARS_TRADE_CLICK]:';
const RESULT_PREFIX = '[MARS_TRADE_RESULT]:';
const ID_PATTERN = /^[A-Za-z0-9._:@-]+$/;

export interface BrowserTradeClickEvent {
  action: TradingAction.BUY | TradingAction.SELL;
  eventId: string;
  executionId: string;
  timestamp: number;
  asset: string | null;
  expiryText: string | null;
  expirySeconds: number | null;
  entryPrice: number | null;
  platformMode: PlatformMode;
  nodeInfo: Record<string, unknown>;
}

export interface BrowserTradeResultEvent {
  outcome: 'WIN' | 'LOSS' | 'DRAW';
  executionId: string | null;
  profitAmount: number | null;
  completionPrice: number | null;
  rawText: string;
  timestamp: number;
}

function parseMessage(message: string, prefix: string): Record<string, unknown> | null {
  if (typeof message !== 'string' || !message.startsWith(prefix) || message.length > 16_384) return null;
  try {
    const value = JSON.parse(message.slice(prefix.length));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function safeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 200 && ID_PATTERN.test(normalized)
    ? normalized
    : null;
}

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function safeNumber(value: unknown, min: number, max: number): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= min && numeric <= max ? numeric : null;
}

export function parseDurationSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  const hms = text.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (hms) return Math.min(86_400, Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]));
  const clock = text.match(/^(\d{1,2}):(\d{2})$/);
  if (clock) return Math.min(86_400, Number(clock[1]) * 60 + Number(clock[2]));
  const duration = text.match(/^(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)$/);
  if (!duration) return null;
  const multiplier = duration[2].startsWith('h') ? 3600 : duration[2].startsWith('m') ? 60 : 1;
  const seconds = Math.round(Number(duration[1]) * multiplier);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(86_400, seconds) : null;
}

function safeTimestamp(value: unknown, now = Date.now()): number {
  const numeric = safeNumber(value, now - 24 * 60 * 60 * 1000, now + 5 * 60 * 1000);
  return numeric === null ? now : Math.round(numeric);
}

export function parseBrowserTradeClickMessage(message: string, now = Date.now()): BrowserTradeClickEvent | null {
  const data = parseMessage(message, CLICK_PREFIX);
  if (!data) return null;
  const action = data.action === TradingAction.BUY
    ? TradingAction.BUY
    : data.action === TradingAction.SELL ? TradingAction.SELL : null;
  const eventId = safeId(data.eventId);
  const executionId = safeId(data.executionId) || eventId;
  if (!action || !eventId || !executionId) return null;

  const expiryText = safeText(data.expiryText, 64);
  const expirySeconds = safeNumber(data.expirySeconds, 1, 24 * 60 * 60)
    ?? parseDurationSeconds(expiryText);
  const entryPrice = safeNumber(data.entryPrice, Number.MIN_VALUE, Number.MAX_VALUE);
  const platformMode = data.platformMode === PlatformMode.LIVE
    ? PlatformMode.LIVE
    : data.platformMode === PlatformMode.DEMO ? PlatformMode.DEMO : PlatformMode.UNKNOWN;
  const asset = safeText(data.asset, 80);

  return {
    action,
    eventId,
    executionId,
    timestamp: safeTimestamp(data.timestamp, now),
    asset,
    expiryText,
    expirySeconds: expirySeconds === null ? null : Math.round(expirySeconds),
    entryPrice,
    platformMode,
    nodeInfo: {
      assetName: asset,
      expiryText,
      executionId,
      entryPrice,
      platformMode,
    },
  };
}

export function parseBrowserTradeResultMessage(message: string, now = Date.now()): BrowserTradeResultEvent | null {
  const data = parseMessage(message, RESULT_PREFIX);
  if (!data) return null;
  const rawOutcome = safeText(data.outcome, 8)?.toUpperCase();
  if (rawOutcome !== 'WIN' && rawOutcome !== 'LOSS' && rawOutcome !== 'DRAW') return null;
  return {
    outcome: rawOutcome,
    executionId: safeId(data.executionId),
    profitAmount: safeNumber(data.profitAmount ?? data.amount, -1_000_000_000, 1_000_000_000),
    completionPrice: safeNumber(data.completionPrice, Number.MIN_VALUE, Number.MAX_VALUE),
    rawText: safeText(data.rawText, 500) || '',
    timestamp: safeTimestamp(data.timestamp, now),
  };
}
