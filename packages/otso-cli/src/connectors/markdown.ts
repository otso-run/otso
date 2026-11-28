import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { EVENTS_TABLE } from '../core/chronicle.js';
import { expandHome, readSettings } from '../core/paths.js';
import { iso } from '../core/time.js';
import type { Connector, RunContext, RunStats } from './types.js';
import { addStats, NotOnThisMacError, shortHash } from './util.js';

/**
 * Folders of Markdown and plain-text files: Obsidian vaults and iA Writer's
 * iCloud library. Each sync walks the folders, re-reads only files whose
 * modification time changed, and removes notes whose file is gone.
 * Hidden folders (.obsidian, .trash, .git) are skipped.
 *
 * Notes are keyed on the folder's name and the path inside it, so the same
 * vault synced on two Macs (through iCloud or Obsidian Sync) is stored once.
 */

export interface NoteFolder {
  /** Absolute path. */
  path: string;
  /** Stable name for keys; the folder's own name. */
  name: string;
}

const MAX_BYTES = 2 * 1024 * 1024;
const EXTENSIONS = new Set(['.md', '.markdown', '.txt']);

function* walk(dir: string): Generator<string> {
  let entries: import('node:fs').Dirent[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && EXTENSIONS.has(extname(e.name).toLowerCase())) yield p;
  }
}

/** Split YAML front matter off and pull out the few keys we use. */
export function parseNote(raw: string): { body: string; title?: string; created?: string; tags: string[] } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { body: raw, tags: inlineTags(raw) };
  const fm = m[1];
  const body = raw.slice(m[0].length);
  const value = (key: string) => fm.match(new RegExp(`^${key}:[ \\t]*["']?(.+?)["']?[ \\t]*$`, 'mi'))?.[1];
  const tags: string[] = [];
  const inline = value('tags');
  if (inline && !/^\[?\s*\]?$/.test(inline)) tags.push(...inline.replace(/[[\]]/g, '').split(/[,\s]+/));
  else {
    const list = fm.match(/^tags:[ \t]*\r?\n((?:[ \t]*-[ \t]*.+\r?\n?)+)/mi)?.[1];
    if (list) tags.push(...list.split('\n').map((l) => l.replace(/^[ \t]*-[ \t]*/, '').trim()));
  }
  return {
    body,
    title: value('title'),
    created: value('created') ?? value('date created') ?? value('date'),
    tags: [...new Set([...tags, ...inlineTags(body)].map((t) => t.replace(/^#/, '')).filter(Boolean))],
  };
}

function inlineTags(text: string): string[] {
  return [...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu)].map((m) => m[1]);
}

export function markdownFolders(
  id: string,
  displayName: string,
  description: string,
  folders: () => NoteFolder[]
): Connector {
  return {
    id,
    displayName,
    description,
    kind: 'local',
    dbPath: `${id}/chronicle/chronicle.db`,
    tables: [EVENTS_TABLE],
    get localPaths() {
      return folders().map((f) => f.path);
    },
    async sync({ store, full, log }: RunContext): Promise<RunStats> {
      const roots = folders().filter((f) => existsSync(f.path));
      if (!roots.length) throw new NotOnThisMacError(displayName);

      // What's stored, and the file time it was stored at.
      const known = new Map<string, string | null>();
      for (const r of store.db.query(`SELECT source_id, endTime FROM events`).all() as { source_id: string; endTime: string | null }[]) {
        known.set(r.source_id, r.endTime);
      }

      const seen = new Set<string>();
      let changed = 0;
      const rows = function* () {
        for (const root of roots) {
          for (const file of walk(root.path)) {
            const rel = relative(root.path, file);
            const key = `note-${shortHash(root.name, rel)}`;
            seen.add(key);
            let st;
            try {
              st = statSync(file);
            } catch {
              continue;
            }
            const modified = iso(st.mtimeMs);
            if (!full && known.get(key) === modified) continue;
            if (st.size > MAX_BYTES) continue;
            const note = parseNote(readFileSync(file, 'utf8'));
            changed++;
            yield {
              source_id: key,
              type: 'CreateAction',
              source: id,
              additionalType: 'Note',
              name: note.title || basename(file, extname(file)),
              text: note.body,
              dateCreated: iso(note.created ?? '') ?? iso(st.birthtimeMs) ?? modified,
              endTime: modified,
              object: { folder: root.name, path: rel, keywords: note.tags },
            };
          }
        }
      };
      const stats: RunStats = {};
      addStats(stats, 'events', store.upsert(EVENTS_TABLE, rows()));
      const removed = store.deleteKeys(EVENTS_TABLE, [...known.keys()].filter((k) => !seen.has(k)));
      log(
        `${seen.size.toLocaleString()} notes in ${roots.map((r) => r.name).join(', ')}, ${changed.toLocaleString()} new or changed` +
          (removed ? `, ${removed.toLocaleString()} removed` : '')
      );
      return stats;
    },
  };
}

/** Vaults from settings.obsidianVaults, else the ones Obsidian has open, else all it knows. */
function obsidianVaults(): NoteFolder[] {
  const fromSettings = readSettings().obsidianVaults;
  let paths: string[] = fromSettings?.map(expandHome) ?? [];
  if (!paths.length) {
    try {
      const cfg = JSON.parse(readFileSync(expandHome('~/Library/Application Support/obsidian/obsidian.json'), 'utf8'));
      const vaults = Object.values(cfg.vaults ?? {}) as { path: string; open?: boolean }[];
      const open = vaults.filter((v) => v.open);
      paths = (open.length ? open : vaults).map((v) => v.path);
    } catch {
      paths = [];
    }
  }
  return paths.map((p) => ({ path: p, name: basename(p) }));
}

export const obsidian = markdownFolders('obsidian', 'Obsidian', 'Notes in your Obsidian vaults', obsidianVaults);

export const iaWriter = markdownFolders('ia-writer', 'iA Writer', 'Documents in iA Writer’s iCloud library', () => [
  { path: expandHome('~/Library/Mobile Documents/27N4MQEA55~pro~writer/Documents'), name: 'iA Writer' },
]);
