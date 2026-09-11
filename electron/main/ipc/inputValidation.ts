import {
  AppSettings,
  DEFAULT_SETTINGS,
  HistoryQuery,
  ManualTradeInput,
  OverlayPosition,
} from '../../../shared/types/ipc';
import { TradingAction } from '../../../shared/types/decision';
import { isTrustedOlympTradeUrl } from '../security/urlPolicy';

const ID_PATTERN = /^[A-Za-z0-9._:@-]+$/;
const EXPIRIES = new Set(['auto', '30s', '45s', '1m', '2m', '3m', '4m', '5m']);
const CALIBRATION_MODES = new Set(['SAFE', 'BALANCED', 'COMPREHENSIVE', 'SNIPER', 'AGGRESSIVE']);
const SENSITIVITIES = new Set(['conservative', 'balanced', 'aggressive']);
const RISK_LEVELS = new Set(['LOW', 'MEDIUM', 'HIGH']);
const OUTCOMES = new Set(['WIN', 'LOSS', 'DRAW', 'UNRESOLVED']);
export const WORKSTATION_TABS = new Set([
  'workstation', 'command', 'analytics', 'journal', 'history', 'performance', 'settings',
]);

function reject(message: string): never {
  throw new Error(`Invalid IPC input: ${message}`);
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return reject(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') return reject(`${name} must be a boolean`);
  return value;
}

function asNumber(
  value: unknown,
  name: string,
  min: number,
  max: number,
  integer = false,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return reject(`${name} must be a finite number`);
  }
  if (integer && !Number.isInteger(value)) return reject(`${name} must be an integer`);
  if (value < min || value > max) return reject(`${name} is outside the allowed range`);
  return value;
}

function asText(
  value: unknown,
  name: string,
  maxLength: number,
  allowEmpty = false,
): string {
  if (typeof value !== 'string') return reject(`${name} must be text`);
  const normalized = value.trim();
  if (!allowEmpty && !normalized) return reject(`${name} is required`);
  if (normalized.length > maxLength) return reject(`${name} is too long`);
  return normalized;
}

export function validateIdentifier(value: unknown, name = 'identifier'): string {
  const normalized = asText(value, name, 200);
  if (!ID_PATTERN.test(normalized)) return reject(`${name} contains unsupported characters`);
  return normalized;
}

export function validateOptionalIdentifier(value: unknown, name = 'identifier'): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return validateIdentifier(value, name);
}

export function validateIdentifierArray(value: unknown, name = 'identifiers'): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 250) {
    return reject(`${name} must contain 1 to 250 items`);
  }
  return Array.from(new Set(value.map((item) => validateIdentifier(item, name))));
}

export function validateWorkstationTab(value: unknown): string {
  const tab = asText(value, 'tab', 32);
  if (!WORKSTATION_TABS.has(tab)) return reject('unsupported workstation tab');
  return tab;
}

export function validateBrowserUrl(value: unknown): string {
  const rawUrl = asText(value, 'browser URL', 2048);
  if (!isTrustedOlympTradeUrl(rawUrl)) return reject('browser URL is not an approved Olymp Trade HTTPS URL');
  return new URL(rawUrl).toString();
}

function validateBounds(value: unknown, name: string): { x: number; y: number; width: number; height: number } {
  const bounds = asRecord(value, name);
  return {
    x: asNumber(bounds.x, `${name}.x`, -20_000, 20_000, true),
    y: asNumber(bounds.y, `${name}.y`, -20_000, 20_000, true),
    width: asNumber(bounds.width, `${name}.width`, 200, 8_000, true),
    height: asNumber(bounds.height, `${name}.height`, 200, 8_000, true),
  };
}

export function validateOverlayPosition(value: unknown): OverlayPosition {
  const input = asRecord(value, 'overlay position');
  const bounds = validateBounds(input, 'overlay position');
  return {
    panelId: validateIdentifier(input.panelId, 'panel ID'),
    ...bounds,
  };
}

export function validateSettingsPatch(value: unknown): Partial<AppSettings> {
  const input = asRecord(value, 'settings');
  const output: Partial<AppSettings> = {};
  const knownKeys = new Set(Object.keys(DEFAULT_SETTINGS));

  for (const key of Object.keys(input)) {
    if (!knownKeys.has(key)) return reject(`unknown setting '${key}'`);
  }

  const booleanKeys: Array<keyof AppSettings> = [
    'overlayEnabled', 'notificationsEnabled', 'soundEnabled', 'developerMode',
    'diagnosticCapture', 'autoExpiry', 'soundBuyEnabled', 'soundSellEnabled',
    'soundDeteriorationEnabled', 'enableImageOcr',
  ];
  for (const key of booleanKeys) {
    if (input[key] !== undefined) (output as Record<string, unknown>)[key] = asBoolean(input[key], key);
  }

  const numberSpecs: Array<[keyof AppSettings, number, number, boolean]> = [
    ['overlayScale', 0.5, 2, false],
    ['overlayOpacity', 0.5, 1, false],
    ['historyRetentionDays', 1, 365, true],
    ['scanIntervalMs', 500, 5_000, true],
    ['minConfidenceToAlert', 1, 100, false],
    ['signalCooldownSec', 0, 60, true],
  ];
  for (const [key, min, max, integer] of numberSpecs) {
    if (input[key] !== undefined) {
      (output as Record<string, unknown>)[key] = asNumber(input[key], key, min, max, integer);
    }
  }

  if (input.targetDisplayId !== undefined) {
    output.targetDisplayId = input.targetDisplayId === null
      ? null
      : asText(input.targetDisplayId, 'targetDisplayId', 64);
  }

  if (input.expiryOverride !== undefined) {
    const expiry = asText(input.expiryOverride, 'expiryOverride', 8);
    if (!EXPIRIES.has(expiry)) return reject('unsupported expiryOverride');
    output.expiryOverride = expiry as AppSettings['expiryOverride'];
  }

  if (input.enabledExpiries !== undefined) {
    if (!Array.isArray(input.enabledExpiries) || input.enabledExpiries.length < 1 || input.enabledExpiries.length > 8) {
      return reject('enabledExpiries must contain 1 to 8 values');
    }
    const expiries = Array.from(new Set(input.enabledExpiries.map((item) => asText(item, 'expiry', 8))));
    if (expiries.some((expiry) => !EXPIRIES.has(expiry))) return reject('enabledExpiries contains an unsupported value');
    output.enabledExpiries = expiries as AppSettings['enabledExpiries'];
  }

  if (input.signalSensitivity !== undefined) {
    const sensitivity = asText(input.signalSensitivity, 'signalSensitivity', 16);
    if (!SENSITIVITIES.has(sensitivity)) return reject('unsupported signalSensitivity');
    output.signalSensitivity = sensitivity as AppSettings['signalSensitivity'];
  }

  if (input.calibrationMode !== undefined) {
    const mode = asText(input.calibrationMode, 'calibrationMode', 24).toUpperCase();
    if (!CALIBRATION_MODES.has(mode)) return reject('unsupported calibrationMode');
    output.calibrationMode = mode as AppSettings['calibrationMode'];
  }

  if (input.overlayBounds !== undefined) {
    output.overlayBounds = input.overlayBounds === null
      ? null
      : validateBounds(input.overlayBounds, 'overlayBounds');
  }

  return output;
}

export function validateHistoryQuery(value: unknown): HistoryQuery {
  if (value === undefined || value === null) return {};
  const input = asRecord(value, 'history query');
  const allowedKeys = new Set([
    'sessionId', 'asset', 'fromTimestamp', 'toTimestamp', 'action', 'outcome', 'todayOnly', 'limit', 'offset',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) return reject(`unknown history filter '${key}'`);
  }

  const output: HistoryQuery = {};
  if (input.sessionId !== undefined) output.sessionId = validateIdentifier(input.sessionId, 'sessionId');
  if (input.asset !== undefined) output.asset = asText(input.asset, 'asset', 80);
  if (input.fromTimestamp !== undefined) output.fromTimestamp = asNumber(input.fromTimestamp, 'fromTimestamp', 0, Number.MAX_SAFE_INTEGER, true);
  if (input.toTimestamp !== undefined) output.toTimestamp = asNumber(input.toTimestamp, 'toTimestamp', 0, Number.MAX_SAFE_INTEGER, true);
  if (output.fromTimestamp !== undefined && output.toTimestamp !== undefined && output.fromTimestamp > output.toTimestamp) {
    return reject('fromTimestamp must not be later than toTimestamp');
  }
  if (input.action !== undefined) {
    const action = asText(input.action, 'action', 8).toUpperCase();
    if (!Object.values(TradingAction).includes(action as TradingAction)) return reject('unsupported history action');
    output.action = action as TradingAction;
  }
  if (input.outcome !== undefined) {
    const outcome = asText(input.outcome, 'outcome', 16).toUpperCase();
    if (!OUTCOMES.has(outcome)) return reject('unsupported history outcome');
    output.outcome = outcome;
  }
  if (input.todayOnly !== undefined) output.todayOnly = asBoolean(input.todayOnly, 'todayOnly');
  if (input.limit !== undefined) output.limit = asNumber(input.limit, 'limit', 1, 1_000, true);
  if (input.offset !== undefined) output.offset = asNumber(input.offset, 'offset', 0, 1_000_000, true);
  return output;
}

export function validateManualTradeInput(value: unknown): ManualTradeInput {
  const input = asRecord(value, 'manual trade');
  const asset = asText(input.asset, 'asset', 80);
  const action = asText(input.action, 'action', 8).toUpperCase();
  const outcome = asText(input.outcome, 'outcome', 8).toUpperCase();
  if (action !== TradingAction.BUY && action !== TradingAction.SELL) return reject('manual trade action must be BUY or SELL');
  if (!new Set(['WIN', 'LOSS', 'DRAW']).has(outcome)) return reject('unsupported manual trade outcome');

  const result: ManualTradeInput = {
    asset,
    timeframe: input.timeframe === null || input.timeframe === undefined
      ? null
      : asText(input.timeframe, 'timeframe', 24),
    action: action as TradingAction,
    outcome: outcome as ManualTradeInput['outcome'],
  };
  if (input.reason !== undefined) result.reason = asText(input.reason, 'reason', 1_000, true);
  if (input.signalStrength !== undefined) result.signalStrength = asNumber(input.signalStrength, 'signalStrength', 0, 100);
  if (input.risk !== undefined && input.risk !== null) {
    const risk = asText(input.risk, 'risk', 8).toUpperCase();
    if (!RISK_LEVELS.has(risk)) return reject('unsupported risk');
    result.risk = risk as ManualTradeInput['risk'];
  }
  if (input.recommendedExpiry !== undefined) {
    result.recommendedExpiry = input.recommendedExpiry === null
      ? null
      : asText(input.recommendedExpiry, 'recommendedExpiry', 32);
  }
  return result;
}

export function validateManualExecution(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    const action = value.toUpperCase();
    if (action !== TradingAction.BUY && action !== TradingAction.SELL) return reject('execution action must be BUY or SELL');
    return { action };
  }
  const input = asRecord(value, 'manual execution');
  const action = asText(input.action, 'action', 8).toUpperCase();
  if (action !== TradingAction.BUY && action !== TradingAction.SELL) return reject('execution action must be BUY or SELL');
  const output: Record<string, unknown> = { action };
  if (input.eventId !== undefined) output.eventId = validateIdentifier(input.eventId, 'eventId');
  if (input.asset !== undefined) output.asset = asText(input.asset, 'asset', 80);
  if (input.expiryLabel !== undefined) output.expiryLabel = asText(input.expiryLabel, 'expiryLabel', 32);
  if (input.entryPrice !== undefined) output.entryPrice = asNumber(input.entryPrice, 'entryPrice', Number.MIN_VALUE, Number.MAX_VALUE);
  return output;
}

export function validateBoolean(value: unknown, name: string): boolean {
  return asBoolean(value, name);
}

export function validateLimit(value: unknown, name: string, maximum = 500, fallback = 50): number {
  if (value === undefined || value === null) return fallback;
  return asNumber(value, name, 1, maximum, true);
}

export function validatePurgeDays(value: unknown): number {
  return asNumber(value, 'purge days', 1, 3_650, true);
}

export function validateReplayObservation(value: unknown): Record<string, unknown> {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > 1_000_000) return reject('observation JSON exceeds 1 MB');
    try { parsed = JSON.parse(value); } catch { return reject('observation replay is not valid JSON'); }
  }
  const record = asRecord(parsed, 'observation replay');
  let serialized: string;
  try { serialized = JSON.stringify(record); } catch { return reject('observation replay is not serializable'); }
  if (Buffer.byteLength(serialized, 'utf8') > 1_000_000) return reject('observation payload exceeds 1 MB');
  return record;
}

export function validateAutoBugOptions(value: unknown): string | { minTradeCount?: number; minWinRate?: number } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return validateIdentifier(value, 'sessionId');
  const input = asRecord(value, 'bug detector options');
  const output: { minTradeCount?: number; minWinRate?: number } = {};
  if (input.minTradeCount !== undefined) output.minTradeCount = asNumber(input.minTradeCount, 'minTradeCount', 1, 100_000, true);
  if (input.minWinRate !== undefined) output.minWinRate = asNumber(input.minWinRate, 'minWinRate', 0, 100);
  return output;
}
