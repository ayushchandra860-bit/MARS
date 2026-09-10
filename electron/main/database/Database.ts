// ============================================================
// MARS PRO V3 — SQLite Database Foundation (sql.js / WASM)
// Atomic durable saves, backup recovery, transactional migrations.
// ============================================================

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';

export interface PreparedStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export class Database {
  private db: SqlJsDatabase | null = null;
  private readonly dbPath: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private isDirty = false;
  private mutationVersion = 0;
  private persistedVersion = 0;
  private inTransaction = false;
  private skipBackupOnNextSave = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    const SQL = await initSqlJs();
    const directory = path.dirname(this.dbPath);
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });

    const backupPath = this.getBackupPath();
    const primaryExists = fs.existsSync(this.dbPath);
    const backupExists = fs.existsSync(backupPath);
    let lastOpenError: unknown = null;

    for (const candidatePath of [this.dbPath, backupPath]) {
      if (!fs.existsSync(candidatePath)) continue;
      try {
        const candidate = new SQL.Database(fs.readFileSync(candidatePath));
        this.assertQuickCheck(candidate, candidatePath);
        this.db = candidate;
        if (candidatePath === backupPath) {
          console.warn('[MARS DB] Primary database unavailable; recovered from verified backup.');
          this.skipBackupOnNextSave = true;
          this.markDirty();
        }
        break;
      } catch (error) {
        lastOpenError = error;
        console.error(`[MARS DB] Failed to open ${candidatePath}:`, error);
      }
    }

    if (!this.db) {
      if (primaryExists || backupExists) {
        throw new Error(`Database and backup are unreadable: ${String(lastOpenError)}`);
      }
      this.db = new SQL.Database();
      this.markDirty();
    }

    this.db.exec('PRAGMA foreign_keys = ON;');
    this.runMigrations();
    this.assertRuntimeIntegrity();
    this.saveToFile();
  }

  getDb(): SqlJsDatabase {
    if (!this.db) throw new Error('Database not initialized. Call initialize() first.');
    return this.db;
  }

  getDbPath(): string {
    return this.dbPath;
  }

  private getBackupPath(): string {
    return `${this.dbPath}.bak`;
  }

  private markDirty(): void {
    this.isDirty = true;
    this.mutationVersion += 1;
  }

  scheduleSave(): void {
    this.markDirty();
    if (this.inTransaction || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushAsync().catch((error) => {
        console.error('[MARS DB] Scheduled atomic save failed:', error);
      });
    }, 1000);
  }

  /**
   * Kept asynchronous for callers, while the bounded sql.js snapshot is written
   * synchronously and atomically to prevent overlapping exports/renames.
   */
  async flushAsync(): Promise<void> {
    this.saveToFile();
  }

  saveToFile(): void {
    if (!this.db || !this.isDirty) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    const snapshotVersion = this.mutationVersion;
    const buffer = Buffer.from(this.db.export());
    try {
      this.atomicReplace(buffer);
      this.persistedVersion = snapshotVersion;
      this.isDirty = this.persistedVersion < this.mutationVersion;
    } catch (error) {
      this.isDirty = true;
      console.error('[MARS DB] Atomic database save failed:', error);
      throw error;
    }
  }

  private atomicReplace(buffer: Buffer): void {
    const tempPath = `${this.dbPath}.tmp-${process.pid}`;
    const stalePath = `${this.dbPath}.replace-${process.pid}`;
    const backupPath = this.getBackupPath();
    const directory = path.dirname(this.dbPath);

    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      fs.writeFileSync(tempPath, buffer);
      const tempFd = fs.openSync(tempPath, 'r');
      try { fs.fsyncSync(tempFd); } finally { fs.closeSync(tempFd); }

      if (fs.existsSync(this.dbPath) && !this.skipBackupOnNextSave) {
        fs.copyFileSync(this.dbPath, backupPath);
        const backupFd = fs.openSync(backupPath, 'r');
        try { fs.fsyncSync(backupFd); } finally { fs.closeSync(backupFd); }
      }

      try {
        fs.renameSync(tempPath, this.dbPath);
      } catch (replaceError) {
        // Windows may not replace an existing file with rename(). Move the old
        // primary aside first, then restore it if the new rename fails.
        if (!fs.existsSync(this.dbPath)) throw replaceError;
        if (fs.existsSync(stalePath)) fs.unlinkSync(stalePath);
        fs.renameSync(this.dbPath, stalePath);
        try {
          fs.renameSync(tempPath, this.dbPath);
          fs.unlinkSync(stalePath);
        } catch (secondError) {
          if (!fs.existsSync(this.dbPath) && fs.existsSync(stalePath)) {
            fs.renameSync(stalePath, this.dbPath);
          }
          throw secondError;
        }
      }

      this.skipBackupOnNextSave = false;
      try {
        const directoryFd = fs.openSync(directory, 'r');
        try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
      } catch {
        // Directory fsync is unsupported on some Windows filesystems.
      }
    } finally {
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
      if (fs.existsSync(stalePath) && fs.existsSync(this.dbPath)) {
        try { fs.unlinkSync(stalePath); } catch {}
      }
    }
  }

  close(): void {
    if (!this.db) return;
    this.saveToFile();
    this.db.close();
    this.db = null;
  }

  prepare(sql: string): PreparedStatement {
    const db = this.getDb();
    return {
      run: (...params: unknown[]) => {
        db.run(sql, params as any);
        const changes = db.getRowsModified();
        if (!this.inTransaction && changes > 0) this.scheduleSave();
        return { changes };
      },
      get: (...params: unknown[]) => {
        const statement = db.prepare(sql);
        try {
          statement.bind(params as any);
          return statement.step() ? statement.getAsObject() : undefined;
        } finally {
          statement.free();
        }
      },
      all: (...params: unknown[]) => {
        const statement = db.prepare(sql);
        const results: unknown[] = [];
        try {
          statement.bind(params as any);
          while (statement.step()) results.push(statement.getAsObject());
          return results;
        } finally {
          statement.free();
        }
      },
    };
  }

  exec(sql: string): void {
    this.getDb().exec(sql);
    if (!this.inTransaction) this.scheduleSave();
  }

  transaction<T>(fn: () => T): T {
    const isOuter = !this.inTransaction;
    if (isOuter) {
      this.inTransaction = true;
      try {
        this.getDb().exec('BEGIN TRANSACTION');
      } catch (error) {
        this.inTransaction = false;
        throw error;
      }
    }

    try {
      const result = fn();
      if (result && typeof (result as any).then === 'function') {
        throw new Error('[Database] transaction() supports synchronous operations only.');
      }
      if (isOuter) {
        try {
          this.getDb().exec('COMMIT');
        } finally {
          this.inTransaction = false;
        }
        this.scheduleSave();
      }
      return result;
    } catch (error) {
      if (isOuter) {
        try { this.getDb().exec('ROLLBACK'); } catch {}
        this.inTransaction = false;
      }
      throw error;
    }
  }

  getSetting(key: string): string | null {
    const row = this.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }

  saveOverlayBounds(panelId: string, x: number, y: number, width: number, height: number): void {
    this.prepare(
      'INSERT OR REPLACE INTO overlay_positions (panel_id, x, y, width, height) VALUES (?, ?, ?, ?, ?)'
    ).run(panelId, x, y, width, height);
  }

  getOverlayBounds(panelId?: string): unknown {
    return panelId
      ? this.prepare('SELECT panel_id, x, y, width, height FROM overlay_positions WHERE panel_id = ?').get(panelId)
      : this.prepare('SELECT panel_id, x, y, width, height FROM overlay_positions').all();
  }

  private assertQuickCheck(candidate: SqlJsDatabase, sourcePath: string): void {
    const result = candidate.exec('PRAGMA quick_check;');
    const status = result[0]?.values?.[0]?.[0];
    if (status !== 'ok') {
      candidate.close();
      throw new Error(`SQLite quick_check failed for ${sourcePath}: ${String(status)}`);
    }
  }

  private assertRuntimeIntegrity(): void {
    const db = this.getDb();
    const quickCheck = db.exec('PRAGMA quick_check;')[0]?.values?.[0]?.[0];
    if (quickCheck !== 'ok') throw new Error(`SQLite quick_check failed: ${String(quickCheck)}`);

    const foreignKeys = db.exec('PRAGMA foreign_keys;')[0]?.values?.[0]?.[0];
    if (Number(foreignKeys) !== 1) throw new Error('SQLite foreign key enforcement is disabled.');

    const foreignKeyViolations = db.exec('PRAGMA foreign_key_check;');
    if (foreignKeyViolations.some((result) => result.values.length > 0)) {
      throw new Error('SQLite foreign key integrity check failed.');
    }

    for (const indexName of ['idx_tracked_trades_signal_unique', 'idx_tracked_trades_execution_unique']) {
      const row = this.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?"
      ).get(indexName) as { name: string } | undefined;
      if (!row) throw new Error(`Required database index is missing: ${indexName}`);
    }
  }

  private runMigrations(): void {
    this.getDb().exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);
    const currentVersion = this.getCurrentVersion();
    if (currentVersion >= 6) return;

    this.transaction(() => {
      if (currentVersion < 1) this.migrateV1();
      if (currentVersion < 2) this.migrateV2();
      if (currentVersion < 3) this.migrateV3();
      if (currentVersion < 4) this.migrateV4();
      if (currentVersion < 5) this.migrateV5();
      if (currentVersion < 6) this.migrateV6();
    });
  }

  private getCurrentVersion(): number {
    const row = this.prepare('SELECT MAX(version) as version FROM schema_migrations').get()
      as { version: number | null } | undefined;
    return row?.version ?? 0;
  }

  private recordMigration(version: number): void {
    this.prepare(
      'INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)'
    ).run(version, Date.now());
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const safeTable = table.replace(/"/g, '""');
    const safeColumn = column.replace(/"/g, '""');
    const info = this.prepare(`PRAGMA table_info("${safeTable}")`).all() as Array<{ name: string }>;
    if (!info.some((item) => item.name === column)) {
      this.exec(`ALTER TABLE "${safeTable}" ADD COLUMN "${safeColumn}" ${definition}`);
    }
  }

  private migrateV1(): void {
    this.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS overlay_positions (
        panel_id TEXT PRIMARY KEY,
        x REAL NOT NULL DEFAULT 0,
        y REAL NOT NULL DEFAULT 0,
        width REAL NOT NULL DEFAULT 300,
        height REAL NOT NULL DEFAULT 200
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        display_id TEXT NOT NULL,
        total_frames INTEGER NOT NULL DEFAULT 0,
        total_decisions INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS signal_history (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        frame_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        asset TEXT,
        timeframe TEXT,
        raw_decision TEXT NOT NULL,
        stabilized_decision TEXT NOT NULL,
        raw_reason TEXT NOT NULL,
        stabilized_reason TEXT NOT NULL,
        signal_strength REAL NOT NULL,
        risk TEXT NOT NULL,
        data_quality TEXT NOT NULL,
        market_bias TEXT NOT NULL,
        recommended_expiry TEXT,
        outcome TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
    `);
    this.recordMigration(1);
  }

  private migrateV2(): void {
    this.addColumnIfMissing('signal_history', 'confidence', 'REAL DEFAULT NULL');
    this.addColumnIfMissing('signal_history', 'market_regime', 'TEXT DEFAULT NULL');
    this.addColumnIfMissing('signal_history', 'evidence_summary', 'TEXT DEFAULT NULL');
    this.addColumnIfMissing('signal_history', 'market_state', 'TEXT DEFAULT NULL');
    this.addColumnIfMissing('signal_history', 'entry_context', 'TEXT DEFAULT NULL');
    this.recordMigration(2);
  }

  private migrateV3(): void {
    this.exec(`
      CREATE TABLE IF NOT EXISTS tracked_trades (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        signal_id TEXT NOT NULL,
        action TEXT NOT NULL,
        asset TEXT,
        timeframe TEXT,
        expiry_label TEXT NOT NULL,
        expiry_seconds INTEGER NOT NULL,
        confidence REAL DEFAULT NULL,
        regime TEXT,
        entry_price TEXT,
        entry_timestamp INTEGER NOT NULL,
        expiry_timestamp INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING_ENTRY',
        outcome TEXT,
        original_reasons TEXT,
        completion_timestamp INTEGER,
        completion_price TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tracked_trades_status ON tracked_trades(status);
      CREATE INDEX IF NOT EXISTS idx_tracked_trades_session ON tracked_trades(session_id);
      CREATE INDEX IF NOT EXISTS idx_tracked_trades_expiry ON tracked_trades(expiry_timestamp);
    `);
    this.recordMigration(3);
  }

  private migrateV4(): void {
    this.addColumnIfMissing('tracked_trades', 'ml_features', 'TEXT DEFAULT NULL');
    this.recordMigration(4);
  }

  private migrateV5(): void {
    this.addColumnIfMissing('tracked_trades', 'platform_mode', 'TEXT DEFAULT NULL');
    this.addColumnIfMissing('signal_history', 'platform_mode', 'TEXT DEFAULT NULL');
    this.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_trades_signal_unique ON tracked_trades(signal_id);');
    this.recordMigration(5);
  }

  private migrateV6(): void {
    this.addColumnIfMissing('tracked_trades', 'execution_id', 'TEXT DEFAULT NULL');

    // Repair historical orphan sessions created while FK checks were disabled.
    this.exec(`
      INSERT OR IGNORE INTO sessions (id, started_at, display_id)
      SELECT session_id, MIN(timestamp), 'recovered'
      FROM signal_history
      WHERE session_id IS NOT NULL AND TRIM(session_id) != ''
      GROUP BY session_id;
    `);

    this.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_trades_execution_unique
      ON tracked_trades(session_id, execution_id)
      WHERE execution_id IS NOT NULL AND TRIM(execution_id) != '';
    `);
    this.recordMigration(6);
  }
}
