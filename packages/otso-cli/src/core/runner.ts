import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { getConnector, requireConnector, CONNECTORS } from '../connectors/index.js';
import type { Connector, RunStats } from '../connectors/types.js';
import { openArchive, keepExportCopy } from './archive.js';
import { ChronicleStore } from './chronicle.js';
import { loadCredentials, saveCredentials, type Credentials } from './credentials.js';
import { assertSourcesDirMounted, getDeviceName } from './device.js';
import { EVENTS_TABLE } from './chronicle.js';
import { resolveLocalPath } from '../connectors/util.js';
import { getSourcesDir } from './paths.js';
import { ensureSourceBlock, getLocalSourcesPath, readSourcesToml } from './sources-config.js';
import { withLocalStaging } from './staging.js';

/**
 * The engine shared by the CLI commands and the TUI: authenticate, sync and
 * ingest a source into data/sources/<db_path>.
 */

export type Log = (message: string) => void;

export interface LastRun {
  kind: string;
  at: string;
  /** Which Mac ran it (absent for runs from before otso recorded it). */
  device?: string;
  stats?: RunStats;
}

export interface RunResult {
  source: string;
  dbPath: string;
  stats: RunStats;
  notes: string[];
  /** Rows now stored per table, across every sync so far (from any Mac). */
  totals?: Record<string, number>;
  /** The run before this one, so output can say what was already there. */
  previous?: LastRun;
}

/** Where a sync writes: <id>, or <id>-<device> for per-device sources. */
export async function syncTarget(connector: Connector): Promise<{ sourceName: string; dbPath: string }> {
  if (!connector.perDevice) return { sourceName: connector.id, dbPath: connector.dbPath };
  const sourceName = `${connector.id}-${await getDeviceName()}`;
  return { sourceName, dbPath: `${sourceName}/chronicle/chronicle.db` };
}

/** Other Macs' folders for a per-device source (<id>-<device>/), by name. */
export function deviceFolders(connector: Connector): string[] {
  if (!connector.perDevice) return [];
  try {
    return readdirSync(getSourcesDir())
      .filter((d) => d.startsWith(`${connector.id}-`) && existsSync(join(getSourcesDir(), d, 'chronicle', 'chronicle.db')))
      .sort();
  } catch {
    return [];
  }
}

/** Is this local source's app database on this Mac? */
export function isOnThisMac(connector: Connector): boolean {
  return connector.kind === 'local' && !!connector.localPaths?.some((p) => resolveLocalPath(p));
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

function readLastRun(store: ChronicleStore): LastRun | undefined {
  const raw = store.getState('last_run');
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as LastRun;
  } catch {
    return undefined;
  }
}

async function recordRun(store: ChronicleStore, kind: string, stats: RunStats) {
  const run: LastRun = { kind, at: new Date().toISOString(), device: await getDeviceName(), stats };
  store.setState('last_run', JSON.stringify(run));
}

function totalsOf(store: ChronicleStore, connector: Connector): Record<string, number> {
  return Object.fromEntries(connector.tables.map((t) => [t.name, store.count(t.name)]));
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
  assertSourcesDirMounted(getSourcesDir());
  const target = await syncTarget(connector);
  const dbFile = storePath(target.dbPath);
  // On a network share, sync into a local copy and move the result over at the end.
  return withLocalStaging(dbFile, async (path) => {
    const existed = existsSync(path);
    const store = ChronicleStore.open(path);
    let ok = false;
    try {
      prepare(store, connector);
      const previous = readLastRun(store);
      const stats = await connector.sync!({
        store,
        credentials,
        full: !!opts.full,
        log,
        sourceDir: join(getSourcesDir(), target.dbPath.split('/')[0]),
      });
      await recordRun(store, 'sync', stats);
      if (connector.perDevice) await moveOutOfSharedSource(connector, store, log);
      ok = true;
      return { source: target.sourceName, dbPath: target.dbPath, stats, notes: [], totals: totalsOf(store, connector), previous };
    } finally {
      store.close();
      // Don't leave an empty database behind when the very first sync fails.
      if (!ok && !existed) for (const f of [path, `${path}-wal`, `${path}-shm`]) rmSync(f, { force: true });
    }
  });
}

/**
 * Before per-device sources, every Mac wrote browser history into one shared
 * <id>/ source. Whatever this Mac's sync just stored is this Mac's, so take
 * those rows out of the shared source; what's left there is history no Mac
 * still has (kept as an archive and still indexed as <id>).
 */
async function moveOutOfSharedSource(connector: Connector, store: ChronicleStore, log: Log) {
  const shared = storePath(connector.dbPath);
  if (!existsSync(shared)) return;
  const keys = (store.db.query(`SELECT source_id FROM events`).all() as { source_id: string }[]).map((r) => r.source_id);
  if (!keys.length) return;
  const moved = await withLocalStaging(shared, async (path) => {
    const legacy = ChronicleStore.open(path);
    try {
      return legacy.deleteKeys(EVENTS_TABLE, keys);
    } finally {
      legacy.close();
    }
  });
  if (moved) log(`Moved ${moved.toLocaleString()} of this Mac's rows out of the shared ${connector.id} source`);
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
          await recordRun(store, 'ingest', s);
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
  lastRun?: LastRun;
  /** Local sources: is the app's database on this Mac? */
  onThisMac?: boolean;
  /** Per-device sources: some Mac (or the shared pre-split source) has synced it. */
  syncedAnywhere?: boolean;
  /** Another Mac's copy of a per-device source (or the shared pre-split one): the connector id it belongs to. */
  parent?: string;
}

function fillFromDb(status: SourceStatus, path: string, tables: Connector['tables']) {
  status.dbExists = existsSync(path) && statSync(path).size > 0;
  if (!status.dbExists) return;
  // Another Mac's sync can replace this file on the share while we read it
  // (SQLITE_IOERR_VNODE). The counts are only for display, so carry on
  // without them rather than failing the whole sync.
  let store: ChronicleStore | undefined;
  try {
    store = ChronicleStore.open(path);
    status.rows = tables.reduce((n, t) => n + store!.count(t.name), 0);
    status.lastRun = readLastRun(store);
  } catch {
    // leave rows and lastRun unset
  } finally {
    try {
      store?.close();
    } catch {
      // already gone
    }
  }
}

export async function sourceStatuses(): Promise<SourceStatus[]> {
  const out: SourceStatus[] = [];
  const known = new Set(CONNECTORS.map((c) => c.dbPath));
  for (const c of CONNECTORS) {
    const creds = c.auth ? await loadCredentials(c.id) : null;
    const target = await syncTarget(c);
    const status: SourceStatus = {
      id: c.id,
      displayName: c.displayName,
      kind: c.kind,
      connected: c.auth ? !!creds : null,
      account: creds?.account,
      dbExists: false,
      rows: 0,
    };
    if (c.kind === 'local') status.onThisMac = isOnThisMac(c);
    fillFromDb(status, join(getSourcesDir(), target.dbPath), c.tables);
    out.push(status);
    if (!c.perDevice) continue;

    // The shared pre-split source and every other Mac's <id>-<device>.
    known.add(target.dbPath);
    const others: SourceStatus[] = [];
    const shared: SourceStatus = { id: `${c.id} (shared)`, displayName: `${c.displayName} (shared, before per-device)`, kind: c.kind, connected: null, dbExists: false, rows: 0, parent: c.id };
    fillFromDb(shared, join(getSourcesDir(), c.dbPath), c.tables);
    if (shared.dbExists) others.push(shared);
    for (const dir of deviceFolders(c)) {
      const dbPath = `${dir}/chronicle/chronicle.db`;
      known.add(dbPath);
      if (dbPath === target.dbPath) continue;
      const o: SourceStatus = { id: dir, displayName: `${c.displayName} (${dir.slice(c.id.length + 1)})`, kind: c.kind, connected: null, dbExists: false, rows: 0, parent: c.id };
      fillFromDb(o, join(getSourcesDir(), dbPath), c.tables);
      others.push(o);
    }
    status.syncedAnywhere = status.dbExists || others.length > 0;
    out.push(...others);
  }

  // Personal sources from ~/.otso/config/sources.local.toml (e.g. twitter-<handle>).
  for (const s of (await readSourcesToml(getLocalSourcesPath())).sources ?? []) {
    if (!s.db_path || known.has(s.db_path)) continue;
    known.add(s.db_path);
    const base = getConnector(s.name.replace(/-[^-]+$/, ''));
    const status: SourceStatus = {
      id: s.name,
      displayName: s.name,
      kind: base?.kind ?? 'export',
      connected: null,
      dbExists: false,
      rows: 0,
      parent: base?.id,
    };
    fillFromDb(status, join(getSourcesDir(), s.db_path), base?.tables ?? []);
    out.push(status);
  }
  return out;
}

export function formatStats(stats: RunStats): string {
  const parts = Object.entries(stats).map(([t, s]) => `${t}: ${s.inserted} new, ${s.updated} already stored`);
  return parts.length ? parts.join('; ') : 'nothing new';
}
