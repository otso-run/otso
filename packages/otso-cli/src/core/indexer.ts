import { execa } from 'execa';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { journalModeFor } from './storage.js';
import { indexerConfigPath } from './sources-config.js';
import { findRepoRoot, getDataRoot, getSourcesDir, getSourcesTomlPath, readSettings } from './paths.js';

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

export function indexerArgs(subcommand: string[], opts: { fixtures?: boolean; config?: string } = {}): string[] {
  const root = getDataRoot();
  return [
    '--config',
    opts.config ?? getSourcesTomlPath(),
    '--data-dir',
    root,
    '--sources-dir',
    opts.fixtures ? join(root, 'fixtures') : getSourcesDir(),
    ...subcommand,
  ];
}

export async function runIndexer(
  subcommand: string[],
  opts: { fixtures?: boolean; stdio?: 'inherit' | 'pipe' } = {}
): Promise<{ exitCode: number; output: string }> {
  const { cmd, args } = indexerCommand();
  const config = await indexerConfigPath();
  const res = await execa(cmd, [...args, ...indexerArgs(subcommand, { ...opts, config })], {
    stdio: opts.stdio ?? 'inherit',
    reject: false,
    all: opts.stdio === 'pipe',
    // Sources that haven't been imported yet each log "Database not found";
    // keep those quiet unless the caller asked for RUST_LOG.
    env: {
      RUST_LOG: process.env.RUST_LOG ?? 'info,otso_indexer::extractors=error',
      // events.db / search.db live in <data-dir>/otso; skip WAL on network shares.
      OTSO_SQLITE_JOURNAL: journalModeFor(join(getDataRoot(), 'otso')),
    },
  });
  return { exitCode: res.exitCode ?? 1, output: (res.all as string | undefined) ?? '' };
}
