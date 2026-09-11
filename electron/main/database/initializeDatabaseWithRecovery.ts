import fs from 'fs';
import path from 'path';

export interface StartupDatabase {
  initialize(): Promise<void>;
  close(): void;
}

export interface DatabaseStartupResult<T extends StartupDatabase> {
  database: T;
  recovered: boolean;
  quarantinedPaths: string[];
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function recoveryCandidates(dbPath: string): string[] {
  const directory = path.dirname(dbPath);
  if (!fs.existsSync(directory)) return [];
  const base = path.basename(dbPath);
  return fs.readdirSync(directory)
    .filter((name) => (
      name === base
      || name === `${base}.bak`
      || name.startsWith(`${base}.tmp-`)
      || name.startsWith(`${base}.replace-`)
    ))
    .map((name) => path.join(directory, name));
}

/**
 * Preserve every file involved in the failed startup instead of deleting user
 * data. A fresh database can then be created at the canonical path while the
 * original bytes remain available for forensic recovery.
 */
export function quarantineDatabaseFiles(dbPath: string, now = Date.now()): string[] {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const archived: string[] = [];

  for (const source of recoveryCandidates(dbPath)) {
    let target = `${source}.startup-failed-${stamp}`;
    let suffix = 1;
    while (fs.existsSync(target)) {
      target = `${source}.startup-failed-${stamp}-${suffix}`;
      suffix += 1;
    }
    fs.renameSync(source, target);
    archived.push(target);
  }

  return archived;
}

/**
 * Open the user's durable database. If both the normal primary/backup recovery
 * and migrations fail for existing local data, preserve the failed files and
 * make one clean startup attempt. Missing runtime dependencies are not retried
 * or disguised as data corruption.
 */
export async function initializeDatabaseWithRecovery<T extends StartupDatabase>(
  dbPath: string,
  factory: () => T,
  onRecovery: (message: string, error: unknown) => void = () => {},
): Promise<DatabaseStartupResult<T>> {
  const first = factory();
  try {
    await first.initialize();
    return { database: first, recovered: false, quarantinedPaths: [] };
  } catch (initialError) {
    try { first.close(); } catch {}

    if (recoveryCandidates(dbPath).length === 0) {
      throw initialError;
    }

    let quarantinedPaths: string[];
    try {
      quarantinedPaths = quarantineDatabaseFiles(dbPath);
    } catch (quarantineError) {
      throw new Error(
        `Local database failed to open and could not be preserved: ${describeError(quarantineError)}`,
        { cause: initialError },
      );
    }

    onRecovery(
      `Existing local database could not be opened. Preserved ${quarantinedPaths.length} file(s) before a clean recovery.`,
      initialError,
    );

    const fresh = factory();
    try {
      await fresh.initialize();
      return { database: fresh, recovered: true, quarantinedPaths };
    } catch (freshError) {
      try { fresh.close(); } catch {}
      throw new Error(
        `Fresh database startup also failed after preserving the old files: ${describeError(freshError)}`,
        { cause: initialError },
      );
    }
  }
}
