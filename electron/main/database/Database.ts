// ============================================================
// MARS PRO V3 — SQLite Database Foundation (sql.js / WASM)
// Pure JavaScript / WebAssembly SQLite implementation that works
// without native compilation dependencies.
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

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    const SQL = await initSqlJs();

    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.dbPath)) {
      const filebuffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(filebuffer);
    } else {
      this.db = new SQL.Database();
    }

    this.runMigrations();
    this.saveToFile();
  }

  getDb(): SqlJsDatabase {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  getDbPath(): string {
    return this.dbPath;
  }

  private saveTimer: NodeJS.Timeout | null = null;
  private isDirty = false;

  scheduleSave(): void {
    this.isDirty = true;
    if (this.inTransaction) return;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushAsync().catch((err) => console.error('[MARS DB] Error in async save:', err));
    }, 1000);
  }

  async flushAsync(): Promise<void> {
    if (!this.db || !this.isDirty) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      await fs.promises.writeFile(this.dbPath, buffer);
      this.isDirty = false;
    } catch (err) {
      console.error('[MARS DB] Error saving database asynchronously:', err);
    }
  }

  saveToFile(): void {
    if (!this.db) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
      this.isDirty = false;
    } catch (err) {
      console.error('[MARS DB] Error saving database to file:', err);
    }
  }

  close(): void {
    if (this.db) {
      this.saveToFile();
      this.db.close();
      this.db = null;
    }
  }

  prepare(sql: string): PreparedStatement {
    const db = this.getDb();

    return {
      run: (...params: unknown[]) => {
        db.run(sql, params as any);
        if (!this.inTransaction) {
          this.scheduleSave();
        }
        return { changes: db.getRowsModified() };
      },
      get: (...params: unknown[]) => {
        const stmt = db.prepare(sql);
        stmt.bind(params as any);
        let result: unknown = undefined;
        if (stmt.step()) {
          result = stmt.getAsObject();
        }
        stmt.free();
        return result;
      },
      all: (...params: unknown[]) => {
        const stmt = db.prepare(sql);
        stmt.bind(params as any);
        const results: unknown[] = [];
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      },
    };
  }

  private inTransaction = false;

  exec(sql: string): void {
    const db = this.getDb();
    db.exec(sql);
    if (!this.inTransaction) {
      this.scheduleSave();
    }
  }

  transaction<T>(fn: () => T): T {
    const isOuter = !this.inTransaction;

    if (isOuter) {
      this.inTransaction = true;
      try {
        const db = this.getDb();
        db.exec('BEGIN TRANSACTION');
      } catch (beginErr) {
        this.inTransaction = false;
        throw beginErr;
      }
    }

    try {
      const result = fn();

      if (result && typeof (result as any).then === 'function') {
        throw new Error('[Database] transaction() does not support async functions. Use synchronous operations only.');
      }

      if (isOuter) {
        try {
          const db = this.getDb();
          db.exec('COMMIT');
        } finally {
          this.inTransaction = false;
          this.scheduleSave();
        }
      }

      return result;
    } catch (err) {
      if (isOuter) {
        try {
          const db = this.getDb();
          db.exec('ROLLBACK');
        } catch {
          // Preserve original error
        } finally {
          this.inTransaction = false;
        }
      }
      throw err;
    }
  }

  // Atomic Settings & Overlay Bounds Helpers
  getSetting(key: string): string | null {
    const row = this.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : null;
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
    if (panelId) {
      return this.prepare('SELECT panel_id, x, y, width, height FROM overlay_positions WHERE panel_id = ?').get(panelId);
    }
    return this.prepare('SELECT panel_id, x, y, width, height FROM overlay_positions').all();
  }

  private runMigrations(): void {
    this.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);

    const currentVersion = this.getCurrentVersion();

    if (currentVersion < 1) {
      this.migrateV1();
    }
    if (currentVersion < 2) {
      this.migrateV2();
    }
    if (currentVersion < 3) {
      this.migrateV3();
    }
    if (currentVersion < 4) {
      this.migrateV4();
    }
    if (currentVersion < 5) {
      this.migrateV5();
    }
  }

  private getCurrentVersion(): number {
    try {
      const row = this.prepare(
        'SELECT MAX(version) as version FROM schema_migrations'
      ).get() as { version: number | null } | undefined;
      return row?.version ?? 0;
    } catch {
      return 0;
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

    this.prepare(
      'INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)'
    ).run(1, Date.now());
  }

  private migrateV2(): void {
    const addColumnIfMissing = (table: string, column: string, definition: string) => {
      try {
        const info = this.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        if (!info.some((col) => col.name === column)) {
          this.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
      } catch {
        // Table may not exist yet in edge cases
      }
    };

    addColumnIfMissing('signal_history', 'confidence', 'REAL DEFAULT NULL');
    addColumnIfMissing('signal_history', 'market_regime', 'TEXT DEFAULT NULL');
    addColumnIfMissing('signal_history', 'evidence_summary', 'TEXT DEFAULT NULL');
    addColumnIfMissing('signal_history', 'market_state', 'TEXT DEFAULT NULL');
    addColumnIfMissing('signal_history', 'entry_context', 'TEXT DEFAULT NULL');

    this.prepare(
      'INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)'
    ).run(2, Date.now());
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

    this.prepare(
      'INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)'
    ).run(3, Date.now());
  }

  private migrateV4(): void {
    const addColumnIfMissing = (table: string, column: string, definition: string) => {
      try {
        const info = this.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        if (!info.some((col) => col.name === column)) {
          this.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
      } catch {
        // Safe to ignore
      }
    };
    addColumnIfMissing('tracked_trades', 'ml_features', 'TEXT DEFAULT NULL');
    this.prepare(
      'INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)'
    ).run(4, Date.now());
  }

  private migrateV5(): void {
    const addColumnIfMissing = (table: string, column: string, definition: string) => {
      try {
        const info = this.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        if (!info.some((col) => col.name === column)) {
          this.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
      } catch {
        // Safe to ignore
      }
    };

    addColumnIfMissing('tracked_trades', 'platform_mode', 'TEXT DEFAULT NULL');
    addColumnIfMissing('signal_history', 'platform_mode', 'TEXT DEFAULT NULL');

    try {
      this.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_trades_signal_unique ON tracked_trades(signal_id);
      `);
    } catch {
      // Best-effort
    }

    this.prepare(
      'INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)'
    ).run(5, Date.now());
  }
}