import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { isAbsolute, join, resolve } from 'path';

/**
 * Archived sources live in <sources-dir>/archived.json, shared by every Mac
 * that syncs into that sources-dir. `otso archive` writes the same file; see
 * packages/otso-cli/src/core/archived.ts.
 *
 * sources-dir is found the way the CLI finds it: $OTSO_SOURCES_DIR, then
 * sourcesDir or dataDir in ~/.otso/config/settings.json, then $OTSO_DATA_DIR,
 * then ~/.otso/data/sources.
 */

const home = () => process.env.HOME || homedir();
const expand = (p: string) => (p === '~' ? home() : p.startsWith('~/') ? join(home(), p.slice(2)) : p);
const abs = (p: string) => (isAbsolute(expand(p)) ? expand(p) : resolve(expand(p)));

async function sourcesDir(): Promise<string> {
  if (process.env.OTSO_SOURCES_DIR) return abs(process.env.OTSO_SOURCES_DIR);
  if (process.env.OTSO_DATA_DIR) return join(abs(process.env.OTSO_DATA_DIR), 'sources');
  const configDir = process.env.OTSO_CONFIG_DIR || join(home(), '.otso', 'config');
  try {
    const settings = JSON.parse(await readFile(join(configDir, 'settings.json'), 'utf8'));
    if (typeof settings.sourcesDir === 'string') return abs(settings.sourcesDir);
    if (typeof settings.dataDir === 'string') return join(abs(settings.dataDir), 'sources');
  } catch {
    // No settings: fall through to the default
  }
  return join(home(), '.otso', 'data', 'sources');
}

const archivedFile = async () => join(await sourcesDir(), 'archived.json');

export function isArchived(name: string, archived: string[]): boolean {
  return archived.some((a) => name === a || name.startsWith(`${a}-`));
}

export async function getArchived(): Promise<string[]> {
  try {
    const list = JSON.parse(await readFile(await archivedFile(), 'utf8')).archived;
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Archive or unarchive one source. Unarchiving also removes any broader
 * entry that covers it (unarchiving safari-old-mac when "safari" is archived
 * removes "safari").
 */
export async function setArchived(source: string, archived: boolean): Promise<string[]> {
  const current = await getArchived();
  const next = (archived ? [...new Set([...current, source])] : current.filter((a) => !isArchived(source, [a]))).sort();
  const dir = await sourcesDir();
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'archived.json');
  // Write beside it and rename, so an interrupted write can't leave half a file
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ archived: next }, null, 2) + '\n');
  await rename(tmp, file);
  return next;
}
