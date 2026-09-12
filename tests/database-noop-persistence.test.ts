import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Database } from '../electron/main/database/Database';

const paths: string[] = [];

function tempDb(): string {
  const value = path.join(__dirname, `noop-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  paths.push(value);
  return value;
}

afterEach(() => {
  for (const dbPath of paths.splice(0)) {
    for (const suffix of ['', '.bak']) {
      try { fs.unlinkSync(`${dbPath}${suffix}`); } catch {}
    }
  }
});

describe('database no-op persistence guard', () => {
  it('does not dirty or export after a zero-change transaction', async () => {
    const db = new Database(tempDb());
    await db.initialize();
    db.setSetting('same-key', 'same-value');
    await db.flushAsync();
    const before = db.getPersistenceMetrics();

    db.transaction(() => {
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
        .run('same-key', 'different-value');
    });
    const after = db.getPersistenceMetrics();
    expect(after.completedSaves).toBe(before.completedSaves);
    expect(after.dirty).toBe(false);
    expect(after.skippedNoopTransactions).toBe(before.skippedNoopTransactions + 1);
    db.close();
  });
});
