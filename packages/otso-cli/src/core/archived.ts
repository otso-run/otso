import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getSourcesDir } from './paths.js';

/**
 * Archived sources: ones you've stopped using (an old check-in app, a closed
 * account). Their data stays in the archive and in search, but `otso sync`
 * and the scheduled sync skip them, and the coverage page doesn't flag them
 * as having gone quiet.
 *
 * Stored in <sources-dir>/archived.json, beside the data it describes, so
 * every Mac that syncs into the same sources-dir sees the same list. It's
 * outside the repo because which services someone has used is personal.
 * otso-search reads and writes the same file.
 *
 * Names are source names as search shows them (`foursquare`,
 * `safari-old-mac`) or connector ids (`safari`). Archiving a name also
 * covers its per-device and per-account variants: `safari` covers
 * `safari-<any mac>`, but `safari-old-mac` covers only that one.
 */

export const archivedPath = () => join(getSourcesDir(), 'archived.json');

export function archivedSources(): string[] {
  const file = archivedPath();
  if (!existsSync(file)) return [];
  try {
    const list = JSON.parse(readFileSync(file, 'utf8')).archived;
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export function isArchived(name: string, archived: string[] = archivedSources()): boolean {
  return archived.some((a) => name === a || name.startsWith(`${a}-`));
}

async function save(list: string[]) {
  const file = archivedPath();
  await mkdir(getSourcesDir(), { recursive: true });
  // Write beside it and rename, so an interrupted write can't leave half a file
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ archived: [...list].sort() }, null, 2) + '\n');
  await rename(tmp, file);
}

/** Add names to the archived list. Returns the ones that weren't archived yet. */
export async function archive(names: string[]): Promise<string[]> {
  const current = archivedSources();
  const added = [...new Set(names)].filter((n) => !current.includes(n));
  if (added.length) await save([...current, ...added]);
  return added;
}

/** Remove names from the archived list. Returns the ones that were removed. */
export async function unarchive(names: string[]): Promise<string[]> {
  const current = archivedSources();
  const removed = current.filter((a) => names.includes(a));
  if (removed.length) await save(current.filter((a) => !removed.includes(a)));
  return removed;
}
