// ============================================================
// MARS PRO V3 — Settings Repository
// Validates both renderer writes and values restored from disk.
// ============================================================

import { Database } from '../Database';
import { AppSettings, DEFAULT_SETTINGS } from '../../../../shared/types/ipc';
import { validateSettingsPatch } from '../../ipc/inputValidation';

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

    const settings: AppSettings = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.value);
        const validated = validateSettingsPatch({ [row.key]: parsed });
        Object.assign(settings, validated);
      } catch {
        // Unknown, malformed, or out-of-range persisted settings are ignored.
      }
    }
    return settings;
  }

  get(key: keyof AppSettings): unknown {
    return this.getAll()[key];
  }

  set(key: keyof AppSettings, value: unknown): void {
    if (value === undefined) return;
    const validated = validateSettingsPatch({ [key]: value });
    if (!(key in validated)) return;
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(key, JSON.stringify(validated[key]));
  }

  updateAll(settings: Partial<AppSettings>): void {
    const validated = validateSettingsPatch(settings);
    this.db.transaction(() => {
      const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      for (const [key, value] of Object.entries(validated)) {
        if (value !== undefined) stmt.run(key, JSON.stringify(value));
      }
    });
  }
}
