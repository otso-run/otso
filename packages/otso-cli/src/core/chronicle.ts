import { Database } from 'bun:sqlite';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { journalModeFor } from './storage.js';

/**
 * A source's chronicle.db: the SQLite file otso-indexer reads through the
 * queries in data/config/sources.toml.
 *
 * Every table we write has a natural key with a UNIQUE index, and rows are
 * upserted on it, so running a sync or re-importing the same export twice
 * leaves the database unchanged (idempotent). Rows keep their rowid on
 * update, which matters for sources whose query uses rowid as external_id.
 *
 * Sync cursors (e.g. "last fetched at") live in an _otso_sync table inside
 * the same file, so deleting chronicle.db also resets the cursor.
 */

export interface TableDef {
  name: string;
  columns: string[];
  key: string;
}

/** The wide Chronicle-ETL style table most sources.toml queries read. */
export const EVENTS_TABLE: TableDef = {
  name: 'events',
  key: 'source_id',
  columns: [
    'agent',
    'end_time',
    'object',
    'source',
    'source_id',
    'type',
    'result',
    'startTime',
    'name',
    'description',
    'text',
    'date_created',
    'dateCreated',
    'contentLocation',
    'additionalType',
    'actionStatus',
    'endTime',
  ],
};

export type Row = Record<string, unknown>;

export interface UpsertStats {
  inserted: number;
  updated: number;
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

function toSqlValue(v: unknown): string | number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

export class ChronicleStore {
  readonly db: Database;
  private ensured = new Set<string>();

  private constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    // WAL locally; rollback journal on network shares (see storage.ts).
    this.db.exec(`PRAGMA journal_mode = ${journalModeFor(path) === 'wal' ? 'WAL' : 'DELETE'}`);
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS _otso_sync (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)'
    );
  }

  static open(path: string): ChronicleStore {
    return new ChronicleStore(path);
  }

  ensureTable(def: TableDef): void {
    if (this.ensured.has(def.name)) return;
    const cols = def.columns.map((c) => `${q(c)} TEXT`).join(', ');
    this.db.exec(`CREATE TABLE IF NOT EXISTS ${q(def.name)} (${cols})`);

    // Older databases (e.g. written by chronicle-etl) may lack columns.
    const existing = new Set(
      (this.db.query(`PRAGMA table_info(${q(def.name)})`).all() as { name: string }[]).map(
        (r) => r.name
      )
    );
    for (const c of def.columns) {
      if (!existing.has(c)) this.db.exec(`ALTER TABLE ${q(def.name)} ADD COLUMN ${q(c)} TEXT`);
    }

    const index = q(`otso_${def.name}_${def.key}_key`);
    try {
      this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${index} ON ${q(def.name)} (${q(def.key)})`);
    } catch {
      // Duplicate keys from an older writer. Keep a backup, then keep the
      // first row for each key so upserts can work from here on.
      copyFileSync(this.path, `${this.path}.bak-${Date.now()}`);
      this.db.exec(
        `DELETE FROM ${q(def.name)} WHERE rowid NOT IN (SELECT MIN(rowid) FROM ${q(def.name)} GROUP BY ${q(def.key)})`
      );
      this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${index} ON ${q(def.name)} (${q(def.key)})`);
    }
    this.ensured.add(def.name);
  }

  upsert(def: TableDef, rows: Iterable<Row>): UpsertStats {
    this.ensureTable(def);
    const cols = def.columns;
    const insert = this.db.prepare(
      `INSERT INTO ${q(def.name)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
       ON CONFLICT(${q(def.key)}) DO UPDATE SET ${cols
         .filter((c) => c !== def.key)
         .map((c) => `${q(c)} = excluded.${q(c)}`)
         .join(', ')}`
    );
    const exists = this.db.prepare(`SELECT 1 FROM ${q(def.name)} WHERE ${q(def.key)} = ? LIMIT 1`);

    const stats: UpsertStats = { inserted: 0, updated: 0 };
    const run = this.db.transaction((batch: Row[]) => {
      for (const row of batch) {
        const key = toSqlValue(row[def.key]);
        if (key === null || key === '') continue;
        if (exists.get(key)) stats.updated++;
        else stats.inserted++;
        insert.run(...cols.map((c) => toSqlValue(row[c])));
      }
    });

    let batch: Row[] = [];
    for (const row of rows) {
      batch.push(row);
      if (batch.length >= 1000) {
        run(batch);
        batch = [];
      }
    }
    if (batch.length) run(batch);
    return stats;
  }

  /** Delete rows by key; returns how many existed. */
  deleteKeys(def: TableDef, keys: Iterable<string>): number {
    this.ensureTable(def);
    const del = this.db.prepare(`DELETE FROM ${q(def.name)} WHERE ${q(def.key)} = ?`);
    let n = 0;
    const run = this.db.transaction((batch: string[]) => {
      for (const k of batch) n += del.run(k).changes;
    });
    run([...keys]);
    return n;
  }

  count(table: string): number {
    try {
      const r = this.db.query(`SELECT COUNT(*) AS n FROM ${q(table)}`).get() as { n: number };
      return r.n;
    } catch {
      return 0;
    }
  }

  getState(key: string): string | null {
    const r = this.db.query('SELECT value FROM _otso_sync WHERE key = ?').get(key) as
      | { value: string }
      | null;
    return r?.value ?? null;
  }

  setState(key: string, value: string): void {
    this.db
      .query(
        'INSERT INTO _otso_sync (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
      )
      .run(key, value, new Date().toISOString());
  }

  close(): void {
    this.db.close();
  }
}
