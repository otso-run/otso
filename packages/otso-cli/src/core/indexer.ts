import { execa } from 'execa';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { appendRun, indexRunFromReport, type IndexerReport, type RunEntry } from './runlog.js';
import { getDeviceName } from './device.js';
import { isNetworkPath, journalModeFor } from './storage.js';
import { indexerConfigPath } from './sources-config.js';
import { findRepoRoot, getConfigDir, getDataRoot, getSourcesDir, getSourcesTomlPath, readSettings } from './paths.js';

/**
 * Runs packages/otso-indexer over data/sources, building data/otso/events.db
 * and the search projection that otso-search reads.
 *
 * Binary lookup: OTSO_INDEXER, settings.indexerPath, the repo's release
 * build, then `cargo run --release` from the repo.
 */

function indexerCommand(): { cmd: string; args: string[] } {
  const explicit = process.env.OTSO_INDEXER || readSettings().indexerPath;
  if (explicit) return { cmd: explicit, args: [] };

  const repo = findRepoRoot() ?? findRepoRoot(dirname(getDataRoot()));
  if (repo) {
    const built = join(repo, 'packages', 'otso-indexer', 'target', 'release', 'otso-indexer');
    if (existsSync(built)) return { cmd: built, args: [] };
    const manifest = join(repo, 'packages', 'otso-indexer', 'Cargo.toml');
    if (existsSync(manifest)) {
      return { cmd: 'cargo', args: ['run', '--quiet', '--release', '--manifest-path', manifest, '--'] };
    }
  }
  throw new Error('otso-indexer not found. Build it with `cargo build --release` in packages/otso-indexer, or set OTSO_INDEXER.');
}

/**
 * Where the indexer keeps local copies of source databases that live on a
 * network share (reused while a source is unchanged): ~/.otso/cache/sources.
 */
export function getSourceCacheDir(): string {
  return join(dirname(getConfigDir()), 'cache', 'sources');
}

/**
 * Does this indexer build take --report / --local-copy-dir? A binary built
 * before them would reject the flags, so ask its --help once.
 */
async function supportsReports(cmd: string, args: string[]): Promise<boolean> {
  const res = await execa(cmd, [...args, '--help'], { reject: false });
  return /--report\b/.test(`${res.stdout}`);
}

export function indexerArgs(
  subcommand: string[],
  opts: { fixtures?: boolean; config?: string; report?: string; legacy?: boolean } = {}
): string[] {
  const root = getDataRoot();
  const sourcesDir = opts.fixtures ? join(root, 'fixtures') : getSourcesDir();
  const sub = [...subcommand];
  if (opts.fixtures && sub[0] === 'build' && !opts.legacy) sub.push('--include-fixtures');
  return [
    '--config',
    opts.config ?? getSourcesTomlPath(),
    '--data-dir',
    root,
    '--sources-dir',
    sourcesDir,
    // Reading SQLite over SMB is a round trip per page; copy each source
    // once and read the local copy instead.
    ...(isNetworkPath(sourcesDir) && !opts.legacy ? ['--local-copy-dir', getSourceCacheDir()] : []),
    ...(opts.report ? ['--report', opts.report] : []),
    ...sub,
  ];
}

export async function runIndexer(
  subcommand: string[],
  opts: { fixtures?: boolean; stdio?: 'inherit' | 'pipe' } = {}
): Promise<{ exitCode: number; output: string; report?: IndexerReport; run?: RunEntry }> {
  const { cmd, args } = indexerCommand();
  const config = await indexerConfigPath();
  const legacy = !(await supportsReports(cmd, args));
  if (legacy) {
    console.log(
      'Note: this otso-indexer build predates run logs and local source copies. Rebuild it with `cargo build --release` in packages/otso-indexer.'
    );
  }
  const reportDir = await mkdtemp(join(tmpdir(), 'otso-index-'));
  const report = legacy ? undefined : join(reportDir, 'report.json');
  try {
    const res = await execa(cmd, [...args, ...indexerArgs(subcommand, { ...opts, config, report, legacy })], {
    stdio: opts.stdio ?? 'inherit',
    reject: false,
    all: opts.stdio === 'pipe',
    // Sources that haven't been imported yet each log "Database not found";
    // keep those quiet unless the caller asked for RUST_LOG.
    env: {
      // Sources not imported yet each log "Database not found", and sqlx
      // warns on every slow statement; the run report has the timings, so
      // keep both out of the terminal unless the caller set RUST_LOG.
      RUST_LOG: process.env.RUST_LOG ?? 'info,otso_indexer::extractors=error,sqlx=error',
      // events.db / search.db live in <data-dir>/otso; skip WAL on network shares.
      OTSO_SQLITE_JOURNAL: journalModeFor(join(getDataRoot(), 'otso')),
    },
    });
    let parsed: IndexerReport | undefined;
    try {
      if (report && existsSync(report)) parsed = JSON.parse(readFileSync(report, 'utf8')) as IndexerReport;
    } catch {
      // it stopped before writing one
    }
    let run: RunEntry | undefined;
    if (parsed) {
      run = indexRunFromReport(parsed, await getDeviceName().catch(() => undefined));
      if (res.exitCode !== 0) run.ok = false;
    } else if (subcommand[0] === 'build' && !legacy) {
      const ms = Math.round(res.durationMs ?? 0);
      run = { kind: 'index', started_at: new Date(Date.now() - ms).toISOString(), duration_ms: ms, ok: false, sources: [], error: `otso-indexer exited with ${res.exitCode}` };
    }
    if (run && subcommand[0] === 'build') await appendRun(run);
    return { exitCode: res.exitCode ?? 1, output: (res.all as string | undefined) ?? '', report: parsed, run };
  } finally {
    await rm(reportDir, { recursive: true, force: true });
  }
}
