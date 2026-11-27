import { createHash } from 'node:crypto';
import { constants, existsSync, readdirSync } from 'node:fs';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Database } from 'bun:sqlite';
import { expandHome } from '../core/paths.js';
import type { RunStats } from './types.js';

export function shortHash(...parts: unknown[]): string {
  return createHash('sha1').update(parts.map((p) => String(p ?? '')).join('\u0000')).digest('hex').slice(0, 16);
}

export function addStats(total: RunStats, table: string, s: { inserted: number; updated: number }): void {
  const t = (total[table] ??= { inserted: 0, updated: 0 });
  t.inserted += s.inserted;
  t.updated += s.updated;
}

/**
 * Expand ~ and a single "*" segment (Things keeps its db under a
 * ThingsData-XXXXX folder whose suffix differs per Mac).
 */
export function resolveLocalPath(pattern: string): string | null {
  const full = expandHome(pattern);
  if (!full.includes('*')) return existsSync(full) ? full : null;
  const parts = full.split('/');
  const i = parts.findIndex((p) => p.includes('*'));
  const parent = parts.slice(0, i).join('/') || '/';
  const re = new RegExp('^' + parts[i].replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  let entries: string[] = [];
  try {
    entries = readdirSync(parent);
  } catch {
    return null;
  }
  for (const e of entries.filter((n) => re.test(n)).sort()) {
    const candidate = [parent, e, ...parts.slice(i + 1)].join('/');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export class PermissionError extends Error {
  constructor(path: string) {
    super(
      `Can't read ${path.replace(/^\/Users\/[^/]+/, '~')}. Give your terminal app Full Disk Access in ` +
        'System Settings > Privacy & Security > Full Disk Access, then restart the terminal.'
    );
  }
}

/**
 * Copy a live app database (and its -wal/-shm) to a temp folder and open the
 * copy read-only, so we never lock or modify the app's own file. On APFS the
 * copy is a clone, so even multi-GB libraries copy instantly.
 */
export async function withDatabaseCopy<T>(path: string, fn: (db: Database) => T | Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'otso-local-'));
  const dest = join(dir, basename(path));
  try {
    try {
      await copyFile(path, dest, constants.COPYFILE_FICLONE);
    } catch (err: any) {
      if (err?.code === 'EPERM' || err?.code === 'EACCES') throw new PermissionError(path);
      throw err;
    }
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(path + suffix)) {
        await copyFile(path + suffix, dest + suffix, constants.COPYFILE_FICLONE).catch(() => {});
      }
    }
    const db = new Database(dest);
    try {
      return await fn(db);
    } finally {
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function columnsOf(db: Database, table: string): Set<string> {
  return new Set((db.query(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((r) => r.name));
}

export function firstColumn(cols: Set<string>, candidates: string[]): string | null {
  return candidates.find((c) => cols.has(c)) ?? null;
}

