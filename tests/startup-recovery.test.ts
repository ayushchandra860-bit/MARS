import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Database } from '../electron/main/database/Database';
import { initializeDatabaseWithRecovery } from '../electron/main/database/initializeDatabaseWithRecovery';

const createdDirectories: string[] = [];

function tempDatabasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mars-startup-recovery-'));
  createdDirectories.push(directory);
  return path.join(directory, 'mars-pro.db');
}

afterEach(() => {
  while (createdDirectories.length) {
    fs.rmSync(createdDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('startup database recovery', () => {
  it('preserves an unreadable primary and backup before opening a clean database', async () => {
    const dbPath = tempDatabasePath();
    const primaryBytes = Buffer.from('corrupt-primary-database');
    const backupBytes = Buffer.from('corrupt-backup-database');
    fs.writeFileSync(dbPath, primaryBytes);
    fs.writeFileSync(`${dbPath}.bak`, backupBytes);

    const notices: string[] = [];
    const result = await initializeDatabaseWithRecovery(
      dbPath,
      () => new Database(dbPath),
      (message) => notices.push(message),
    );

    expect(result.recovered).toBe(true);
    expect(result.quarantinedPaths).toHaveLength(2);
    expect(result.quarantinedPaths.every((file) => fs.existsSync(file))).toBe(true);
    expect(result.quarantinedPaths.map((file) => fs.readFileSync(file).toString()).sort())
      .toEqual([backupBytes.toString(), primaryBytes.toString()].sort());
    expect(result.database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get())
      .toEqual({ version: 6 });
    expect(notices[0]).toContain('Preserved 2 file(s)');
    result.database.close();
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('does not disguise a dependency/startup failure when no database files exist', async () => {
    const dbPath = tempDatabasePath();
    let attempts = 0;
    const failure = new Error('runtime dependency missing');

    await expect(initializeDatabaseWithRecovery(dbPath, () => ({
      async initialize() {
        attempts += 1;
        throw failure;
      },
      close() {},
    }))).rejects.toBe(failure);
    expect(attempts).toBe(1);
  });
});
