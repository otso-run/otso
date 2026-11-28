import { getConnector } from '../connectors/index.js';
import { readSettings, writeSettings, type Settings } from './paths.js';
import type { SourceStatus } from './runner.js';

/**
 * Which sources a bare `otso sync` (and the scheduled sync) runs on this Mac.
 *
 * Without any choices, the automatic rule applies: every connected API
 * source, and every local app installed on this Mac. `otso config sources` stores explicit
 * choices on top of that, per Mac, in ~/.otso/config/settings.json:
 *
 *   "sync": { "timing": false, "things": true }
 *
 * Only sources that differ from the automatic rule are written, so a new
 * connector or a newly connected account still joins by default. Choosing a
 * source on one Mac and not another is how a shared source (Timing, Notes)
 * gets a single Mac to sync it.
 */

export type SyncChoice = 'on' | 'off' | 'auto';

/** Can this Mac sync it at all right now? (connected, or the app is here) */
export function canSync(s: SourceStatus): boolean {
  if (s.kind === 'api') return !!s.connected;
  if (s.kind === 'local') return !!s.onThisMac;
  return false;
}

/** The automatic choice: connected, or installed here. */
export function autoSelected(s: SourceStatus): boolean {
  if (s.kind === 'api') return !!s.connected;
  // Any app installed on this Mac, synced before or not, so a new app (Helium
  // on a second Mac) isn't silently left out until someone syncs it by hand.
  if (s.kind === 'local') return !!s.onThisMac;
  return false;
}

export function syncChoice(id: string, settings: Settings = readSettings()): SyncChoice {
  const v = settings.sync?.[id];
  return v === true ? 'on' : v === false ? 'off' : 'auto';
}

/** Is this source in a bare `otso sync` on this Mac? */
export function isSelected(s: SourceStatus, settings: Settings = readSettings()): boolean {
  if (!canSync(s)) return false;
  const choice = syncChoice(s.id, settings);
  return choice === 'auto' ? autoSelected(s) : choice === 'on';
}

/** The connector ids a bare `otso sync` runs, in the usual order. */
export function selectedSources(statuses: SourceStatus[], settings: Settings = readSettings()): string[] {
  return statuses.filter((s) => isSyncable(s) && isSelected(s, settings)).map((s) => s.id);
}

/** Rows that are a connector with a sync, not another Mac's folder or an export. */
export function isSyncable(s: SourceStatus): boolean {
  return (s.kind === 'api' || s.kind === 'local') && !s.parent && !!getConnector(s.id)?.sync;
}

/**
 * Turn a set of checked ids into the choices to store: only what differs
 * from the automatic rule, so defaults keep following new connections.
 */
export function choicesFor(statuses: SourceStatus[], checked: Set<string>, previous: Settings['sync'] = {}): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const listed = new Set<string>();
  for (const s of statuses.filter(isSyncable)) {
    listed.add(s.id);
    if (!canSync(s)) {
      // Can't change it from here (not connected, app not on this Mac): keep what was stored.
      if (previous?.[s.id] !== undefined) out[s.id] = previous[s.id];
      continue;
    }
    const want = checked.has(s.id);
    if (want !== autoSelected(s)) out[s.id] = want;
  }
  // Choices for sources this checkout doesn't know (another branch's connector) stay.
  for (const [id, v] of Object.entries(previous ?? {})) if (!listed.has(id)) out[id] = v;
  return out;
}

export function indexAfterSync(settings: Settings = readSettings()): boolean {
  return settings.indexAfterSync ?? true;
}

export async function saveSelection(sync: Record<string, boolean>, index: boolean): Promise<void> {
  const settings = readSettings();
  if (Object.keys(sync).length) settings.sync = sync;
  else delete settings.sync;
  if (index) delete settings.indexAfterSync;
  else settings.indexAfterSync = false;
  await writeSettings(settings);
}

export async function setChoices(ids: string[], choice: SyncChoice): Promise<void> {
  const settings = readSettings();
  const sync = { ...(settings.sync ?? {}) };
  for (const id of ids) {
    if (choice === 'auto') delete sync[id];
    else sync[id] = choice === 'on';
  }
  if (Object.keys(sync).length) settings.sync = sync;
  else delete settings.sync;
  await writeSettings(settings);
}
