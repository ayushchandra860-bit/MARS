import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Database } from '../electron/main/database/Database';

const createdPaths: string[] = [];

function newPath(name: string): string {
  const dbPath = path.join(__dirname, `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  createdPaths.push(dbPath);
  return dbPath;
}

function cleanup(dbPath: string): void {
  const directory = path.dirname(dbPath);
  const base = path.basename(dbPath);
  for (const file of fs.readdirSync(directory).filter((item) => item.startsWith(base))) {
    try { fs.unlinkSync(path.join(directory, file)); } catch {}
  }
}

afterEach(() => {
  while (createdPaths.length) cleanup(createdPaths.pop()!);
});

describe('atomic database persistence and recovery', () => {
  it('persists the latest dirty version across concurrent flush requests', async () => {
    const dbPath = newPath('atomic-flush');
    const db = new Database(dbPath);
    await db.initialize();
    for (let index = 0; index < 100; index += 1) db.setSetting('counter', String(index));
    await Promise.all([db.flushAsync(), db.flushAsync(), db.flushAsync()]);
    db.close();

    const reopened = new Database(dbPath);
    await reopened.initialize();
    expect(reopened.getSetting('counter')).toBe('99');
    reopened.close();
    expect(fs.readdirSync(path.dirname(dbPath)).some(
      (file) => file.startsWith(path.basename(dbPath)) && file.includes('.tmp-'),
    )).toBe(false);
  });

  it('recovers the last verified backup when the primary file is corrupt', async () => {
    const dbPath = newPath('backup-recovery');
    const first = new Database(dbPath);
    await first.initialize();
    first.setSetting('release', 'verified-v1');
    first.close();

    const second = new Database(dbPath);
    await second.initialize();
    second.setSetting('release', 'newer-v2');
    second.close();
    expect(fs.existsSync(`${dbPath}.bak`)).toBe(true);

    fs.writeFileSync(dbPath, Buffer.from('not-a-sqlite-database'));
    const recovered = new Database(dbPath);
    await recovered.initialize();
    expect(recovered.getSetting('release')).toBe('verified-v1');
    recovered.close();
  });

  it('enforces foreign keys and all required migration indexes', async () => {
    const dbPath = newPath('schema-integrity');
    const db = new Database(dbPath);
    await db.initialize();
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get())
      .toEqual({ version: 6 });
    const indexes = db.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'index' AND name IN (?, ?) ORDER BY name`
    ).all('idx_tracked_trades_execution_unique', 'idx_tracked_trades_signal_unique');
    expect(indexes).toEqual([
      { name: 'idx_tracked_trades_execution_unique' },
      { name: 'idx_tracked_trades_signal_unique' },
    ]);
    db.close();
  });
});
