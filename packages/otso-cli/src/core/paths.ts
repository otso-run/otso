import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * Where otso keeps things on disk.
 *
 * Data and code are separate: point data-dir / sources-dir at a share once, and every checkout or branch of the repo reads
 * the same data while using its own sources.toml.
 *
 *   ~/.otso/config/          credentials + settings (owner-only, OTSO_CONFIG_DIR)
 *   <dataRoot>/config/       sources.toml (tracked in the repo)
 *   <dataRoot>/sources/      one folder per source: chronicle/chronicle.db + exports/
 *   <dataRoot>/otso/         event store + search projections built by otso-indexer
 *
 * The data root is resolved in this order:
 *   1. OTSO_DATA_DIR
 *   2. dataDir in ~/.otso/config/settings.json (set with `otso config set data-dir`)
 *   3. the nearest ancestor of the cwd that contains data/config/sources.toml
 *      (so running from packages/otso-cli still writes to the repo's data/)
 *   4. ~/.otso/data
 */

/** $HOME when set (so tests and sandboxes can redirect it), else the OS answer. */
export function homeDir(): string {
  return process.env.HOME || homedir();
}

export function expandHome(p: string): string {
  if (p === '~') return homeDir();
  if (p.startsWith('~/')) return join(homeDir(), p.slice(2));
  if (p.startsWith('$HOME/')) return join(homeDir(), p.slice(6));
  return p;
}

export function displayPath(p: string): string {
  const home = homeDir();
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

export function getConfigDir(): string {
  return process.env.OTSO_CONFIG_DIR || join(homeDir(), '.otso', 'config');
}

export interface Settings {
  dataDir?: string;
  /** Where per-source databases live, if not <dataDir>/sources (e.g. an existing Chronicle archive). */
  sourcesDir?: string;
  indexerPath?: string;
  /** This Mac's name for per-device sources (safari-<device>); defaults from the hostname. */
  device?: string;
}

export function readSettings(): Settings {
  const file = join(getConfigDir(), 'settings.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Settings;
  } catch {
    return {};
  }
}

export async function writeSettings(settings: Settings): Promise<void> {
  const { mkdir, writeFile, chmod } = await import('node:fs/promises');
  const dir = getConfigDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  await writeFile(join(dir, 'settings.json'), JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
}

/** Walk up from `start` looking for data/config/sources.toml. */
export function findRepoRoot(start: string = process.cwd()): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'data', 'config', 'sources.toml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function getDataRoot(): string {
  if (process.env.OTSO_DATA_DIR) return resolve(expandHome(process.env.OTSO_DATA_DIR));
  const settings = readSettings();
  if (settings.dataDir) return resolve(expandHome(settings.dataDir));
  const repo = findRepoRoot() ?? findRepoRoot(import.meta.dir);
  if (repo) return join(repo, 'data');
  return join(homeDir(), '.otso', 'data');
}

export function getSourcesDir(): string {
  if (process.env.OTSO_SOURCES_DIR) return resolve(expandHome(process.env.OTSO_SOURCES_DIR));
  const settings = readSettings();
  if (settings.sourcesDir) return resolve(expandHome(settings.sourcesDir));
  return join(getDataRoot(), 'sources');
}

/**
 * sources.toml is code (queries), so it comes from the checkout you're
 * running, letting a branch change queries while the data stays wherever
 * data-dir points (e.g. an SMB share). Order: OTSO_SOURCES_TOML, the repo
 * containing the cwd, the repo containing this CLI, then <data-dir>/config.
 */
export function getSourcesTomlPath(): string {
  if (process.env.OTSO_SOURCES_TOML) return resolve(expandHome(process.env.OTSO_SOURCES_TOML));
  const repo = findRepoRoot() ?? findRepoRoot(import.meta.dir);
  if (repo) return join(repo, 'data', 'config', 'sources.toml');
  return join(getDataRoot(), 'config', 'sources.toml');
}

export function getSourceDir(dbPath: string): string {
  // db_path looks like "<folder>/chronicle/chronicle.db"
  return join(getSourcesDir(), dbPath.split('/')[0]);
}
