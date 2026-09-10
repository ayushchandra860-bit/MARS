// ============================================================
// MARS PRO V3 — Settings Repository
// ============================================================

import { Database } from '../Database';
import { AppSettings, DEFAULT_SETTINGS } from '../../../../shared/types/ipc';

export class SettingsRepository {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  getAll(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{
      key: string;
      value: string;
    }>;

    const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };

    for (const row of rows) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    }

    return settings as unknown as AppSettings;
  }

  get(key: keyof AppSettings): unknown {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined;

    if (!row) {
      return DEFAULT_SETTINGS[key];
    }

    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }

  set(key: keyof AppSettings, value: unknown): void {
    if (value === undefined) return;
    const serialized = JSON.stringify(value);
    this.db
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(key, serialized);
  }

  updateAll(settings: Partial<AppSettings>): void {
    if (!settings || typeof settings !== 'object') return;
    this.db.transaction(() => {
      const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      for (const [key, value] of Object.entries(settings)) {
        if (value === undefined) continue;
        const serialized = JSON.stringify(value);
        stmt.run(key, serialized);
      }
    });
  }
}
