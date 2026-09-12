import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GraphicsStartupGuard, SAFE_GRAPHICS_ARG } from '../electron/main/performance/GraphicsStartupGuard';

const directories: string[] = [];

function statePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mars-graphics-'));
  directories.push(directory);
  return path.join(directory, 'graphics.json');
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('graphics startup guard', () => {
  it('uses hardware acceleration on a healthy normal launch', () => {
    let now = 1_000_000;
    const guard = new GraphicsStartupGuard(statePath(), () => now);
    expect(guard.beginAttempt([])).toBe(false);
    guard.recordHealthy(false);
    now += 1000;
    const next = new GraphicsStartupGuard((guard as any).statePath, () => now);
    expect(next.beginAttempt([])).toBe(false);
  });

  it('honors an explicit safe graphics launch', () => {
    const guard = new GraphicsStartupGuard(statePath(), () => 1_000_000);
    expect(guard.beginAttempt([SAFE_GRAPHICS_ARG])).toBe(true);
  });

  it('enters safe mode immediately after a verified GPU failure', () => {
    let now = 1_000_000;
    const file = statePath();
    const first = new GraphicsStartupGuard(file, () => now);
    expect(first.beginAttempt([])).toBe(false);
    first.recordGpuFailure('GPU: crashed');
    now += 100;
    const retry = new GraphicsStartupGuard(file, () => now);
    expect(retry.beginAttempt([])).toBe(true);
    expect(retry.getState().lastFailureReason).toContain('GPU');
  });

  it('falls back after repeated unfinished startup attempts', () => {
    let now = 1_000_000;
    const file = statePath();
    expect(new GraphicsStartupGuard(file, () => now).beginAttempt([])).toBe(false);
    now += 100;
    expect(new GraphicsStartupGuard(file, () => now).beginAttempt([])).toBe(false);
    now += 100;
    expect(new GraphicsStartupGuard(file, () => now).beginAttempt([])).toBe(true);
  });
});
