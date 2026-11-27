import { existsSync, rmSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { getConnector, requireConnector, CONNECTORS } from '../connectors/index.js';
import type { Connector, RunStats } from '../connectors/types.js';
import { openArchive, keepExportCopy } from './archive.js';
import { ChronicleStore } from './chronicle.js';
import { loadCredentials, saveCredentials, type Credentials } from './credentials.js';
import { getSourcesDir } from './paths.js';
import { ensureSourceBlock, getLocalSourcesPath, readSourcesToml } from './sources-config.js';
import { withLocalStaging } from './staging.js';

/**
 * The engine shared by the CLI commands and the TUI: authenticate, sync and
 * ingest a source into data/sources/<db_path>.
 */

export type Log = (message: string) => void;

export interface RunResult {
  source: string;
  dbPath: string;
  stats: RunStats;
  notes: string[];
}

function storePath(dbPath: string) {
  const root = resolve(getSourcesDir());
  const full = resolve(root, dbPath);
  if (!full.startsWith(root + sep)) throw new Error(`Refusing to write outside ${root}: ${dbPath}`);
  return full;
}

function prepare(store: ChronicleStore, connector: Connector) {
  // Create every table the sources.toml queries expect, even ones this run
  // won't fill, so the indexer doesn't fail on a missing table.
  for (const t of connector.tables) store.ensureTable(t);
}

function recordRun(store: ChronicleStore, kind: string, stats: RunStats) {
  store.setState('last_run', JSON.stringify({ kind, at: new Date().toISOString(), stats }));
}

export async function authenticate(id: string, input: Credentials, log: Log = () => {}): Promise<string> {
  const connector = requireConnector(id);
  if (!connector.auth) throw new Error(`${connector.displayName} doesn't use an API login`);
  for (const f of connector.auth.fields) {
    if (!input[f.name]?.trim()) throw new Error(`${f.label} is required`);
    input[f.name] = input[f.name].trim();
  }
  const creds = { ...input };
  const account = await connector.auth.verify(creds);
  await saveCredentials(id, { ...creds, account, source: id, savedAt: new Date().toISOString() });
  log(`Connected to ${connector.displayName} as ${account}`);
  return account;
}

export async function runSync(id: string, opts: { full?: boolean; log?: Log } = {}): Promise<RunResult> {
  const log = opts.log ?? (() => {});
  const connector = requireConnector(id);
  if (!connector.sync) {
    throw new Error(`${connector.displayName} has no API or local database; use: otso ingest ${id} <export file>`);
  }
  let credentials: Credentials = {};
  if (connector.auth) {
    const saved = await loadCredentials(id);
    if (!saved) throw new Error(`Not connected to ${connector.displayName} yet. Run: otso auth ${id}`);
    credentials = saved;
  }
  const dbFile = storePath(connector.dbPath);
  // On a network share, sync into a local copy and move the result over at the end.
  return withLocalStaging(dbFile, async (path) => {
    const existed = existsSync(path);
    const store = ChronicleStore.open(path);
    let ok = false;
    try {
      prepare(store, connector);
      const stats = await connector.sync!({
        store,
        credentials,
        full: !!opts.full,
        log,
        sourceDir: join(getSourcesDir(), connector.dbPath.split('/')[0]),
      });
      recordRun(store, 'sync', stats);
      ok = true;
      return { source: id, dbPath: connector.dbPath, stats, notes: [] };
    } finally {
      store.close();
      // Don't leave an empty database behind when the very first sync fails.
      if (!ok && !existed) for (const f of [path, `${path}-wal`, `${path}-shm`]) rmSync(f, { force: true });
    }
  });
}

export async function runIngest(id: string, inputs: string[], opts: { log?: Log } = {}): Promise<RunResult[]> {
  const log = opts.log ?? (() => {});
  const connector = requireConnector(id);
  if (!connector.ingest) throw new Error(`${connector.displayName} doesn't read export files; use: otso sync ${id}`);
  if (!inputs.length) throw new Error('Give the path to the downloaded export (zip, json, csv or folder)');

  const results: RunResult[] = [];
  for (const input of inputs) {
    log(`Reading ${input}`);
    const archive = await openArchive(input);
    try {
      const notes: string[] = [];
      let dbPath = connector.dbPath;
      let sourceName = connector.id;
      if (connector.resolveTarget) {
        const target = await connector.resolveTarget(archive);
        dbPath = target.dbPath;
        sourceName = target.sourceName;
        if (target.tomlBlock && (await ensureSourceBlock(sourceName, target.tomlBlock))) {
          notes.push(`Added "${sourceName}" to ~/.otso/config/sources.local.toml`);
        }
      }
      const sourceDir = join(getSourcesDir(), dbPath.split('/')[0]);
      const stats = await withLocalStaging(storePath(dbPath), async (path) => {
        const store = ChronicleStore.open(path);
        try {
          prepare(store, connector);
          const s = await connector.ingest!({ store, credentials: {}, full: false, log, sourceDir }, archive);
          recordRun(store, 'ingest', s);
          return s;
        } finally {
          store.close();
        }
      });
      const kept = await keepExportCopy(input, sourceDir);
      if (kept) notes.push(`Kept a copy of the export in ${kept}`);
      results.push({ source: sourceName, dbPath, stats, notes });
    } finally {
      await archive.dispose();
    }
  }
  return results;
}

export interface SourceStatus {
  id: string;
  displayName: string;
  kind: Connector['kind'];
  connected: boolean | null; // null when the source has no login
  account?: string;
  dbExists: boolean;
  rows: number;
  lastRun?: { kind: string; at: string };
}

export async function sourceStatuses(): Promise<SourceStatus[]> {
  const out: SourceStatus[] = [];
  for (const c of CONNECTORS) {
    const creds = c.auth ? await loadCredentials(c.id) : null;
    const path = join(getSourcesDir(), c.dbPath);
    const status: SourceStatus = {
      id: c.id,
      displayName: c.displayName,
      kind: c.kind,
      connected: c.auth ? !!creds : null,
      account: creds?.account,
      dbExists: existsSync(path) && statSync(path).size > 0,
      rows: 0,
    };
    if (status.dbExists) {
      const store = ChronicleStore.open(path);
      try {
        status.rows = c.tables.reduce((n, t) => n + store.count(t.name), 0);
        const last = store.getState('last_run');
        if (last) status.lastRun = JSON.parse(last);
      } finally {
        store.close();
      }
    }
    out.push(status);
  }

  // Personal sources from ~/.otso/config/sources.local.toml (e.g. twitter-<handle>).
  const known = new Set(CONNECTORS.map((c) => c.dbPath));
  for (const s of (await readSourcesToml(getLocalSourcesPath())).sources ?? []) {
    if (!s.db_path || known.has(s.db_path)) continue;
    const base = getConnector(s.name.replace(/-[^-]+$/, ''));
    const path = join(getSourcesDir(), s.db_path);
    const status: SourceStatus = {
      id: s.name,
      displayName: s.name,
      kind: base?.kind ?? 'export',
      connected: null,
      dbExists: existsSync(path) && statSync(path).size > 0,
      rows: 0,
    };
    if (status.dbExists) {
      const store = ChronicleStore.open(path);
      try {
        status.rows = (base?.tables ?? []).reduce((n, t) => n + store.count(t.name), 0);
        const last = store.getState('last_run');
        if (last) status.lastRun = JSON.parse(last);
      } finally {
        store.close();
      }
    }
    out.push(status);
  }
  return out;
}

export function formatStats(stats: RunStats): string {
  const parts = Object.entries(stats).map(([t, s]) => `${t}: ${s.inserted} new, ${s.updated} already stored`);
  return parts.length ? parts.join('; ') : 'nothing new';
}
