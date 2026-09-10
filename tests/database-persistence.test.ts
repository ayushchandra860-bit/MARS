// ============================================================
// MARS PRO V3 — Database Persistence & Transaction Tests
// Tests transaction safety, nested transactions, error preservation,
// and settings persistence.
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../electron/main/database/Database';
import { SettingsRepository } from '../electron/main/database/repositories/SettingsRepository';
import fs from 'fs';
import path from 'path';

describe('Database & Settings Persistence', () => {
  let db: Database;
  let settingsRepo: SettingsRepository;
  const testDbPath = path.join(__dirname, '../scratch/test_mars_settings.db');

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    db = new Database(testDbPath);
    await db.initialize();
    settingsRepo = new SettingsRepository(db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it('saves and retrieves single setting atomically', () => {
    settingsRepo.set('soundEnabled', false);
    expect(settingsRepo.get('soundEnabled')).toBe(false);
  });

  it('updates multiple settings cleanly via transaction', () => {
    settingsRepo.updateAll({
      soundEnabled: true,
      scanIntervalMs: 1500,
      enabledExpiries: ['1m', '2m', '5m'],
    });

    const all = settingsRepo.getAll();
    expect(all.soundEnabled).toBe(true);
    expect(all.scanIntervalMs).toBe(1500);
    expect(all.enabledExpiries).toEqual(['1m', '2m', '5m']);
  });

  it('handles nested transactions without crashing or losing active transaction', () => {
    db.transaction(() => {
      settingsRepo.set('developerMode', true);
      // Nested transaction call inside outer transaction
      db.transaction(() => {
        settingsRepo.set('scanIntervalMs', 800);
      });
      settingsRepo.set('soundBuyEnabled', true);
    });

    expect(settingsRepo.get('developerMode')).toBe(true);
    expect(settingsRepo.get('scanIntervalMs')).toBe(800);
    expect(settingsRepo.get('soundBuyEnabled')).toBe(true);
  });

  it('preserves the original database exception on failed transaction', () => {
    const customError = new Error('Custom SQL execution failure');

    expect(() => {
      db.transaction(() => {
        settingsRepo.set('soundEnabled', true);
        throw customError;
      });
    }).toThrow(customError);

    // Rollback error should NOT overwrite the original error
  });

  it('persists data to disk across database re-initialization', async () => {
    settingsRepo.updateAll({
      minConfidenceToAlert: 75,
      enabledExpiries: ['30s', '1m'],
      signalSensitivity: 'aggressive',
    });

    db.close();

    // Re-open database file from disk
    const db2 = new Database(testDbPath);
    await db2.initialize();
    const repo2 = new SettingsRepository(db2);

    const restored = repo2.getAll();
    expect(restored.minConfidenceToAlert).toBe(75);
    expect(restored.enabledExpiries).toEqual(['30s', '1m']);
    expect(restored.signalSensitivity).toBe('aggressive');

    db2.close();
  });
});
