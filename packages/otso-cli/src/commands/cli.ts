import { execa } from 'execa';
import { CONNECTORS, requireConnector } from '../connectors/index.js';
import { deleteCredentials } from '../core/credentials.js';
import { runIndexer } from '../core/indexer.js';
import { join, resolve } from 'node:path';
import {
  displayPath,
  expandHome,
  getConfigDir,
  getDataRoot,
  getSourcesDir,
  getSourcesTomlPath,
  readSettings,
  writeSettings,
} from '../core/paths.js';
import { authenticate, formatStats, runIngest, runSync, sourceStatuses } from '../core/runner.js';
import { configuredSourcesDir } from '../core/sources-config.js';
import { ask } from './prompt.js';
import { isNetworkPath } from '../core/storage.js';
import { NotOnThisMacError } from '../connectors/util.js';
import { SourceBusyError } from '../core/lock.js';
import { getDeviceName, ShareNotMountedError, slugDevice } from '../core/device.js';
import { appendRun, summarizeRun, type SourceRun } from '../core/runlog.js';
import { archive, archivedSources, isArchived, unarchive } from '../core/archived.js';

/**
 * The scriptable commands: everything the TUI does, without the TUI, so
 * syncs can run from cron/launchd and from tests.
 */

const log = (m: string) => console.log(`  ${m}`);

function fail(err: unknown): never {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

async function openUrl(url: string) {
  await execa(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]).catch(() => {});
}

export async function statusCommand() {
  const rows = await sourceStatuses();
  console.log(`Data:        ${displayPath(getDataRoot())}`);
  console.log(`Credentials: ${displayPath(getConfigDir())}\n`);
  const kindLabel = { api: 'API', export: 'export', local: 'local' } as const;
  console.log(`${'Source'.padEnd(16)} ${'Type'.padEnd(7)} ${'Login'.padEnd(22)} ${'Rows'.padStart(9)}  Last run`);
  console.log('─'.repeat(76));
  const archived = archivedSources();
  for (const s of rows) {
    const login = s.connected === null ? '' : s.connected ? `✓ ${s.account ?? ''}`.slice(0, 21) : '✗ run otso auth';
    const last = isArchived(s.id, archived)
      ? 'archived'
      : s.lastRun
        ? `${s.lastRun.kind} ${s.lastRun.at.slice(0, 16).replace('T', ' ')}`
        : '';
    console.log(
      `${s.id.padEnd(16)} ${kindLabel[s.kind].padEnd(7)} ${login.padEnd(22)} ${String(s.dbExists ? s.rows : '').padStart(9)}  ${last}`
    );
  }
  const configured = await configuredSourcesDir();
  if (configured && configured.includes('fixtures')) {
    console.log(
      `\nNote: sources.toml defaults.data_dir is "${configured}". \`otso index\` passes --sources-dir, so it indexes ${displayPath(getSourcesDir())} regardless.`
    );
  }
}

export async function authCommand(id: string, opts: { logout?: boolean; open?: boolean }) {
  try {
    const c = requireConnector(id);
    if (opts.logout) {
      console.log((await deleteCredentials(id)) ? `Removed ${c.displayName} credentials` : 'No credentials saved');
      return;
    }
    if (!c.auth) fail(`${c.displayName} doesn't use an API login. ${c.kind === 'export' ? `Use: otso ingest ${id} <file>` : `Use: otso sync ${id}`}`);
    console.log(`\n${c.displayName}\n`);
    for (const line of c.auth.instructions) console.log(`  ${line}`);
    console.log(`\n  ${c.auth.setupUrl}\n`);
    if (opts.open !== false && process.stdout.isTTY) await openUrl(c.auth.setupUrl);

    const input: Record<string, string> = {};
    for (const f of c.auth.fields) {
      const envKey = `OTSO_${id.toUpperCase().replace(/-/g, '_')}_${f.name.replace(/[A-Z]/g, (m) => '_' + m).toUpperCase()}`;
      input[f.name] = process.env[envKey] ?? (await ask(`${f.label}: `, { secret: f.secret }));
    }
    console.log('\nChecking with the API…');
    const account = await authenticate(id, input);
    console.log(`✓ Connected as ${account}. Saved to ${displayPath(getConfigDir())}\n`);
    console.log(`Next: otso sync ${id}`);
  } catch (err) {
    fail(err);
  }
}

export async function syncCommand(ids: string[], opts: { full?: boolean; index?: boolean }) {
  // With no names: every connected API, and every local app that's on this
  // Mac and has been synced before (by this Mac or another one).
  const requested = ids.length
    ? ids
    : (await sourceStatuses())
        .filter((s) => (s.kind === 'api' ? s.connected : s.kind === 'local' && s.onThisMac && (s.dbExists || s.syncedAnywhere)))
        .map((s) => s.id);
  // Archived sources are kept but never synced, even when named
  const archived = archivedSources();
  const device = archived.length ? await getDeviceName().catch(() => undefined) : undefined;
  const skip = (id: string) => isArchived(id, archived) || (!!device && isArchived(`${id}-${device}`, archived));
  const targets = requested.filter((id) => !skip(id));
  const skippedArchived = requested.filter(skip);
  if (skippedArchived.length) {
    console.log(`Skipping archived: ${skippedArchived.join(', ')} (otso unarchive <source> to sync again)`);
  }
  if (!targets.length) {
    if (!skippedArchived.length) {
      console.log('Nothing to sync yet. Connect a service with `otso auth <source>`, or run `otso sync <local source>`.');
    }
    return;
  }
  let failed = 0;
  let synced = 0;
  const started = Date.now();
  const runs: SourceRun[] = [];
  const done = (name: string, t0: number, rest: Partial<SourceRun> & { ok: boolean }) =>
    runs.push({ name, ms: Date.now() - t0, ...rest });
  const logRun = async () =>
    appendRun({
      kind: 'sync',
      started_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
      device: await getDeviceName().catch(() => undefined),
      ok: runs.every((r) => r.ok),
      sources: runs,
    });
  for (const id of targets) {
    console.log(`\n${requireConnector(id).displayName}`);
    const t0 = Date.now();
    try {
      const r = await runSync(id, { full: opts.full, log });
      synced++;
      done(r.source, t0, { ok: true, ...sumStats(r.stats) });
      console.log(`  ✓ ${formatStats(r.stats)}`);
      const stored = describeStored(r, id);
      if (stored) console.log(`    ${stored}`);
    } catch (err) {
      if (err instanceof SourceBusyError) {
        console.log(`  – skipped: ${err.message}`);
        continue;
      }
      if (err instanceof NotOnThisMacError) {
        console.log(`  – skipped: ${err.message}`);
        continue;
      }
      if (err instanceof ShareNotMountedError) {
        console.error(`  ✗ ${err.message}`);
        done(id, t0, { ok: false, error: err.message });
        await logRun();
        process.exitCode = 1;
        return;
      }
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      done(id, t0, { ok: false, error: message });
      console.error(`  ✗ ${message}`);
    }
  }
  await logRun();
  if (opts.index && synced) await indexCommand({});
  if (failed) process.exitCode = 1;
}

/** Rows new / already stored across a run's tables. */
function sumStats(stats: Record<string, { inserted: number; updated: number }>) {
  const all = Object.values(stats);
  return { inserted: all.reduce((n, s) => n + s.inserted, 0), skipped: all.reduce((n, s) => n + s.updated, 0) };
}

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** "7,633 events stored in total · previous sync 3:39 PM from caseys-macbook-pro" */
export function describeStored(
  r: { source: string; totals?: Record<string, number>; previous?: { at: string; device?: string } },
  requested?: string
): string {
  const parts: string[] = [];
  const totals = Object.entries(r.totals ?? {}).filter(([, n]) => n > 0);
  if (totals.length) parts.push(`${totals.map(([t, n]) => `${n.toLocaleString()} ${t}`).join(', ')} stored in total`);
  if (r.previous?.at) parts.push(`previous sync ${fmtTime(r.previous.at)}${r.previous.device ? ` from ${r.previous.device}` : ''}`);
  if (requested && r.source !== requested) parts.push(`saved as ${r.source}`);
  return parts.join(' · ');
}

export async function ingestCommand(id: string, files: string[], opts: { index?: boolean }) {
  try {
    const c = requireConnector(id);
    if (!files.length && c.exportGuide) {
      console.log(`\nTo get your ${c.displayName} export:\n`);
      c.exportGuide.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
      console.log(`\n  ${c.exportGuide.url}`);
      if (c.exportGuide.wait) console.log(`  Usually ready in ${c.exportGuide.wait}.`);
      console.log(`\nThen run: otso ingest ${id} ~/Downloads/<file>`);
      if (process.stdout.isTTY) await openUrl(c.exportGuide.url);
      return;
    }
    console.log(`\n${c.displayName}`);
    for (const r of await runIngest(id, files, { log })) {
      console.log(`  ✓ ${r.source}: ${formatStats(r.stats)}`);
      r.notes.forEach((n) => console.log(`  ${n}`));
    }
    if (opts.index) await indexCommand({});
  } catch (err) {
    fail(err);
  }
}

export async function indexCommand(opts: { source?: string; fixtures?: boolean; fresh?: boolean }) {
  if (opts.fresh) {
    // Start the event store and search index over; keep the old ones beside them.
    const { existsSync } = await import('node:fs');
    const { rename } = await import('node:fs/promises');
    const dir = join(getDataRoot(), 'otso');
    if (existsSync(dir)) {
      const backup = `${dir}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await rename(dir, backup);
      console.log(`Moved the previous index to ${displayPath(backup)}`);
    }
  }
  console.log(`\nIndexing ${displayPath(opts.fixtures ? getDataRoot() + '/fixtures' : getSourcesDir())}`);
  if (isNetworkPath(getDataRoot())) {
    // Measured on SMB: the indexer's parallel batches hit "database is locked".
    console.log(
      '⚠ data-dir is on a network share. The index (events.db, search.db) is written much more reliably on a local disk.\n' +
        '  Keep data-dir local and point only sources-dir at the share (otso config set sources-dir <path>).'
    );
  }
  try {
    // build appends new events to events.db (skipping ones already there) and
    // adds just those to the search.db projection otso-search reads.
    const build = await runIndexer(['build', ...(opts.source ? ['--source', opts.source] : [])], {
      fixtures: opts.fixtures,
    });
    if (build.run?.sources.length) {
      console.log('');
      for (const line of summarizeRun(build.run)) console.log(line);
      console.log('Details: otso log');
    }
    if (build.exitCode !== 0) fail(`otso-indexer build exited with ${build.exitCode}`);
    console.log(`\n✓ Search index updated: ${displayPath(getDataRoot())}/otso/search.db`);
  } catch (err) {
    fail(err);
  }
}

export function sourcesCommand() {
  for (const kind of ['api', 'export', 'local'] as const) {
    const title = { api: 'Connect with an API token (otso auth, then otso sync)', export: 'Import a downloaded archive (otso ingest)', local: 'Read from this Mac (otso sync)' }[kind];
    console.log(`\n${title}`);
    for (const c of CONNECTORS.filter((c) => c.kind === kind)) {
      const extra = c.kind === 'api' && c.ingest ? ' (also accepts an export file)' : '';
      console.log(`  ${c.id.padEnd(16)} ${c.description}${extra}`);
    }
  }
  console.log(`\nConfig: ${displayPath(getSourcesTomlPath())}`);
}

const SETTING_KEYS = { 'data-dir': 'dataDir', 'sources-dir': 'sourcesDir', indexer: 'indexerPath', device: 'device' } as const;

export async function configCommand(action?: string, key?: string, value?: string) {
  if (action === 'set' || action === 'unset') {
    const k = SETTING_KEYS[key as keyof typeof SETTING_KEYS];
    if (!k) fail(`Unknown setting "${key}". Settings: ${Object.keys(SETTING_KEYS).join(', ')}`);
    if (action === 'set' && !value) fail(`Usage: otso config set ${key} <value>`);
    const settings = readSettings();
    if (action === 'set') settings[k] = key === 'indexer' ? value : key === 'device' ? slugDevice(value!) : resolve(expandHome(value!));
    else delete settings[k];
    await writeSettings(settings);
    console.log(action === 'set' ? `✓ ${key} = ${settings[k]}` : `✓ ${key} reset to default`);
    return;
  }
  const settings = readSettings();
  console.log(`data-dir     ${displayPath(getDataRoot())}${settings.dataDir ? '' : process.env.OTSO_DATA_DIR ? '  (OTSO_DATA_DIR)' : '  (default)'}`);
  console.log(`sources-dir  ${displayPath(getSourcesDir())}${settings.sourcesDir ? '' : process.env.OTSO_SOURCES_DIR ? '  (OTSO_SOURCES_DIR)' : '  (<data-dir>/sources)'}`);
  console.log(`sources.toml ${displayPath(getSourcesTomlPath())}`);
  console.log(`credentials  ${displayPath(getConfigDir())}`);
  console.log(`indexer      ${settings.indexerPath ?? process.env.OTSO_INDEXER ?? '(repo build, or cargo run)'}`);
  console.log(`device       ${await getDeviceName()}${settings.device ? '' : '  (from hostname)'}`);
  if (isNetworkPath(getDataRoot())) {
    console.log('\n⚠ data-dir is on a network share. Keep it local and set sources-dir to the share instead; the index needs a local disk.');
  } else if (isNetworkPath(getSourcesDir())) {
    console.log('\nsources-dir is on a network share: source databases there use a rollback journal instead of WAL.');
  }
  console.log(`\nChange with: otso config set data-dir|sources-dir|indexer <path>, or otso config set device <name>`);
}

export async function migrateCommand(from: string, opts: { dir?: string; verify?: boolean; overwrite?: boolean }) {
  if (from !== 'chronicle') fail('Only "chronicle" (chronicle-etl config) can be migrated so far');
  const { migrateChronicle } = await import('../core/migrate.js');
  try {
    const { results, unsupported } = await migrateChronicle(opts);
    if (!results.length) console.log('No credentials for otso sources found in the chronicle config.');
    for (const r of results) {
      const icon = r.status === 'saved' ? '✓' : r.status === 'kept-existing' ? '·' : '✗';
      console.log(`${icon} ${r.source.padEnd(10)} ${r.detail}`);
    }
    if (unsupported.length) console.log(`\nNot migrated (otso has no API login for these): ${unsupported.join(', ')}`);
    console.log(`\nSaved to ${displayPath(getConfigDir())}. The chronicle files were not changed.`);
    if (results.some((r) => r.status === 'failed')) process.exitCode = 1;
  } catch (err) {
    fail(err);
  }
}

export async function adoptCommand(from: string, opts: { archive?: string; only?: string }) {
  if (from !== 'chronicle') fail('Only "chronicle" archives can be adopted so far');
  const { adoptChronicle } = await import('../core/adopt.js');
  if (!opts.archive) fail('Usage: otso adopt chronicle --archive <path to the Chronicle data folder>');
  const archive = resolve(expandHome(opts.archive));
  console.log(`Adopting ${displayPath(archive)} (read-only) into ${displayPath(getSourcesDir())}\n`);
  try {
    const results = await adoptChronicle({ archive, only: opts.only?.split(',').map((s) => s.trim()), log });
    const failed = results.filter((r) => r.status === 'failed');
    for (const r of results.filter((r) => r.status !== 'adopted' && r.status !== 'copied')) {
      console.log(`  ${r.status === 'failed' ? '✗' : '·'} ${r.name}: ${r.detail}`);
    }
    console.log(`\n✓ ${results.filter((r) => r.status === 'adopted' || r.status === 'copied').length} sources in place. The archive was not changed.`);
    console.log('Next: otso index --fresh   (rebuilds the index from sources-dir with the new ids)');
    if (failed.length) process.exitCode = 1;
  } catch (err) {
    fail(err);
  }
}

export async function archiveCommand(names: string[]) {
  if (!names.length) {
    const list = archivedSources();
    if (!list.length) {
      console.log('Nothing archived. Archive a source you no longer use with: otso archive <source>');
      return;
    }
    console.log('Archived (kept and searchable, not synced):');
    for (const name of list) console.log(`  ${name}`);
    console.log('\nSync one again with: otso unarchive <source>');
    return;
  }
  const added = await archive(names);
  for (const name of names) {
    console.log(added.includes(name) ? `✓ ${name} archived` : `· ${name} was already archived`);
  }
  if (added.length) console.log('\nIts data stays in search; otso sync and the scheduled sync will skip it.');
}

export async function unarchiveCommand(names: string[]) {
  const removed = await unarchive(names);
  for (const name of names) {
    if (removed.includes(name)) console.log(`✓ ${name} will sync again`);
    else {
      const covering = archivedSources().find((a) => isArchived(name, [a]));
      console.log(covering ? `· ${name} is covered by "${covering}"; run otso unarchive ${covering}` : `· ${name} wasn't archived`);
    }
  }
}
