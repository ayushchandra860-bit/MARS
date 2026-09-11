import path from 'node:path';
import { validateIdentifier, validateLimit } from './inputValidation';

export interface ValidatedKnowledgeQuery {
  asset?: string;
  regime?: string;
  outcome?: string;
  minConfidence?: number;
  limit?: number;
}

function reject(message: string): never {
  throw new Error(`Invalid IPC input: ${message}`);
}

function finiteNumber(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    return reject(`${name} is outside the allowed range`);
  }
  return value;
}

function boundedText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string') return reject(`${name} must be text`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) return reject(`${name} is invalid`);
  return normalized;
}

export function validateKnowledgeQuery(value: unknown): ValidatedKnowledgeQuery {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return reject('knowledge query must be an object');
  const input = value as Record<string, unknown>;
  const allowed = new Set(['asset', 'regime', 'outcome', 'minConfidence', 'limit']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) return reject(`unknown knowledge filter '${key}'`);
  }
  const output: ValidatedKnowledgeQuery = {};
  if (input.asset !== undefined) output.asset = boundedText(input.asset, 'asset', 80);
  if (input.regime !== undefined) output.regime = boundedText(input.regime, 'regime', 40);
  if (input.outcome !== undefined) {
    const outcome = boundedText(input.outcome, 'outcome', 16).toUpperCase();
    if (!['WIN', 'LOSS', 'DRAW', 'UNRESOLVED'].includes(outcome)) return reject('unsupported knowledge outcome');
    output.outcome = outcome;
  }
  if (input.minConfidence !== undefined) output.minConfidence = finiteNumber(input.minConfidence, 'minConfidence', 0, 100);
  if (input.limit !== undefined) output.limit = validateLimit(input.limit, 'knowledge limit', 500, 100);
  return output;
}

export function validateSavedFramePath(value: unknown, approvedDirectory: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) {
    return reject('saved frame path is invalid');
  }
  const root = path.resolve(approvedDirectory);
  const target = path.resolve(value.trim());
  const relative = path.relative(root, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return reject('saved frame must be inside the MARS diagnostics directory');
  }
  if (!['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(path.extname(target).toLowerCase())) {
    return reject('saved frame extension is unsupported');
  }
  return target;
}

export function validateDisplayId(value: unknown, availableIds: string[]): string {
  const displayId = validateIdentifier(value, 'displayId');
  if (!availableIds.includes(displayId)) return reject('displayId is not currently available');
  return displayId;
}
