import { Database } from 'bun:sqlite';
import { copyFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ARENA_BLOCKS, ARENA_CHANNELS } from '../connectors/arena.js';
import { CLAUDE_CONVERSATIONS } from '../connectors/claude.js';
import { calendarKey, CALENDAR, CHROME_HISTORY, chromeKey, GOOGLE_SEARCH, searchKey, watchKey, YOUTUBE_WATCH } from '../connectors/google-takeout.js';
import { LINKEDIN_MESSAGES, linkedinDate } from '../connectors/linkedin.js';
import { safariKey } from '../connectors/local.js';
import { LIKES, TWEETS, tomlBlock as twitterToml } from '../connectors/twitter.js';
import { shortHash } from '../connectors/util.js';
import { ChronicleStore, EVENTS_TABLE, type Row, type TableDef, type UpsertStats } from './chronicle.js';
import { getSourcesDir } from './paths.js';
import { ensureSourceBlock, readSourcesToml } from './sources-config.js';
import { iso } from './time.js';
import { isNetworkPath } from './storage.js';

/**
 * Bring a chronicle-etl archive into otso's sources-dir, so `otso sync` and
 * `otso ingest` continue from it instead of storing everything twice.
 *
 * The archive is opened read-only (immutable) and never changed. For each
 * table, rows keep every column they had, but their key is rewritten to the
 * id otso's connector produces for the same item, and repeated rows collapse
 * to one. Sources otso has no connector for are copied as they are.
 * Running it again is safe: it upserts the same keys.
 */


type Mapper = (row: Row) => Row | null;

interface TableAdoption {
  from: string;
  def: TableDef;
  map: Mapper;
}

interface Adoption {
  name: string;
  from: string; // db path inside the archive
  to: string; // db path inside sources-dir
  tables: TableAdoption[];
  toml?: { source: string; block: string };
}

const json = (v: unknown): any => {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

/** Chronicle wrote times as "2025-01-04 18:56:09 UTC", "... -0500" or naive ISO (UTC). */
export function normalizeTime(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  let s = String(v).trim().replace(' UTC', 'Z');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) s = `${m[1]}T${m[2]}${m[3] ?? ''}${m[4] ? m[4].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2') : 'Z'}`;
  return iso(s);
}

const keep = (row: Row) => row;

const events = (map: Mapper): TableAdoption[] => [{ from: 'events', def: EVENTS_TABLE, map }];

function lastfmArtist(o: any): string {
  const named = o?.byArtist?.[0]?.name;
  if (named) return named;
  const m = String(o?.url ?? '').match(/last\.fm\/music\/([^/]+)\//);
  return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
}

/** Chronicle kept one folder per Twitter account: twitter/@<handle>/. */
function twitterAccounts(archive: string): string[] {
  const dir = join(archive, 'twitter');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => /^@[A-Za-z0-9_]{1,15}$/.test(d))
    .map((d) => d.slice(1).toLowerCase());
}

export function adoptions(archive: string): Adoption[] {
  return [
    {
      name: 'pinboard',
      from: 'pinboard/chronicle/chronicle.db',
      to: 'pinboard/chronicle/chronicle.db',
      tables: events((r) => ({ ...r, source_id: `bookmark-${r.source_id}` })),
    },
    {
      name: 'lastfm',
      from: 'lastfm/chronicle/chronicle.db',
      to: 'lastfm/chronicle/chronicle.db',
      tables: events((r) => {
        const o = json(r.object);
        const when = normalizeTime(r.startTime);
        if (!when || !o?.name) return null;
        return { ...r, startTime: when, source_id: `scrobble-${when}-${shortHash(lastfmArtist(o), o.name)}` };
      }),
    },
    {
      name: 'github',
      from: 'github/chronicle/chronicle.db',
      to: 'github/chronicle/chronicle.db',
      tables: events((r) => (/Event$/.test(String(r.additionalType ?? '')) ? { ...r, source_id: `event-${r.source_id}` } : r)),
    },
    {
      name: 'safari',
      from: 'safari/chronicle/chronicle.db',
      to: 'safari/chronicle/chronicle.db',
      tables: events((r) => {
        const o = json(r.object);
        const when = normalizeTime(r.end_time);
        if (!when || !o?.url) return null;
        return { ...r, end_time: when, source_id: safariKey(Date.parse(when) / 1000, o.url) };
      }),
    },
    // Same ids in Chronicle and otso: copied with their keys as they are.
    ...['readwise', 'spotify', 'imessage', 'apple-notes', 'apple-photos', 'apple-podcasts', 'things'].map((name) => ({
      name,
      from: `${name}/chronicle/chronicle.db`,
      to: `${name}/chronicle/chronicle.db`,
      tables: events(keep),
    })),
    {
      name: 'claude',
      from: 'claude/chronicle/chronicle.db',
      to: 'claude/chronicle/chronicle.db',
      tables: [{ from: 'conversations', def: CLAUDE_CONVERSATIONS, map: keep }],
    },
    {
      name: 'linkedin',
      from: 'linkedin/chronicle/chronicle.db',
      to: 'linkedin/chronicle/chronicle.db',
      tables: [
        {
          from: 'messages',
          def: LINKEDIN_MESSAGES,
          map: (r) => ({
            ...r,
            otso_key: shortHash(r['CONVERSATION ID'], r['DATE'], r['FROM'], r['CONTENT']),
            DATE: linkedinDate(String(r['DATE'] ?? '')) ?? r['DATE'],
          }),
        },
      ],
    },
    {
      name: 'google-takeout',
      from: 'google-takeout/chronicle/chronicle.db',
      to: 'google-takeout/chronicle/chronicle.db',
      tables: [
        {
          from: 'google_search',
          def: GOOGLE_SEARCH,
          map: (r) => {
            const when = normalizeTime(r.startTime);
            return { ...r, startTime: when, source_id: searchKey(when, String(r.query ?? '')) };
          },
        },
        {
          from: 'chrome_history',
          def: CHROME_HISTORY,
          map: (r) => {
            const o = json(r.object);
            const usec = String(r.source_id ?? '').split(':').pop();
            if (!o?.url || !usec || !/^\d+$/.test(usec)) return r;
            return { ...r, startTime: normalizeTime(r.startTime), source_id: chromeKey(usec, o.url) };
          },
        },
        {
          from: 'youtube_watch',
          def: YOUTUBE_WATCH,
          map: (r) => {
            const o = json(r.object);
            const when = normalizeTime(r.startTime);
            if (!o?.url) return r;
            return { ...r, startTime: when, source_id: watchKey(when, o.url) };
          },
        },
        {
          from: 'calendar',
          def: CALENDAR,
          map: (r) => ({ ...r, source_id: calendarKey(String(r.source_id ?? '')) }),
        },
      ],
    },
    {
      name: 'arena',
      from: 'arena/chronicle/chronicle.db',
      to: 'arena/chronicle/chronicle.db',
      tables: [
        {
          from: 'records',
          def: ARENA_CHANNELS,
          map: (r) =>
            r.record_type !== 'channel'
              ? null
              : {
                  id: `channel-${r.id}`,
                  title: r.title,
                  metadata: r.description ?? '',
                  created_at: r.created_at,
                  slug: r.slug,
                  updated_at: r.updated_at,
                  status: r.status,
                  length: r.contents_count,
                },
        },
        {
          from: 'records',
          def: ARENA_BLOCKS,
          map: (r) =>
            r.record_type !== 'block'
              ? null
              : {
                  id: `block-${r.id}`,
                  title: r.title || r.source_title || r.generated_title || '',
                  content: r.content ?? '',
                  description: r.description ?? '',
                  created_at: r.created_at,
                  source_url: r.source_url ?? r.attachment_url ?? null,
                  class: r.class,
                  image_url: r.image_original ?? r.image_display ?? null,
                  channel_slug: r.channel_slug,
                  connected_at: r.connected_at,
                },
        },
      ],
    },
    ...twitterAccounts(archive).map((user) => ({
      name: `twitter-${user}`,
      from: `twitter/@${user}/chronicle/chronicle.db`,
      to: `twitter-${user}/chronicle/chronicle.db`,
      tables: [
        { from: 'tweets', def: TWEETS, map: keep },
        { from: 'likes', def: LIKES, map: keep },
      ],
      toml: { source: `twitter-${user}`, block: twitterToml(user) },
    })),
  ];
}

export interface AdoptResult {
  name: string;
  status: 'adopted' | 'copied' | 'skipped' | 'missing' | 'failed';
  detail: string;
}

function openArchiveDb(path: string): Database {
  return new Database(`file:${path}?mode=ro&immutable=1`, { readonly: true });
}

/**
 * SQLite over SMB is latency-bound (every small write is a locked round trip),
 * so when sources-dir is a network share, build each database in a local
 * staging folder and copy the finished file over in one sequential transfer.
 */
async function withLocalStaging<T>(dest: string, fn: (path: string) => Promise<T>): Promise<T> {
  if (!isNetworkPath(dest)) return fn(dest);
  const stageDir = await mkdtemp(join(tmpdir(), 'otso-stage-'));
  const staged = join(stageDir, 'chronicle.db');
  try {
    if (existsSync(dest)) {
      // Opening first lets SQLite roll back any interrupted write before we copy.
      ChronicleStore.open(dest).close();
      await copyFile(dest, staged);
    }
    // Build the staged file with a rollback journal, as it will be used on the share.
    const previous = process.env.OTSO_SQLITE_JOURNAL;
    process.env.OTSO_SQLITE_JOURNAL = 'delete';
    let result: T;
    try {
      result = await fn(staged);
    } finally {
      if (previous === undefined) delete process.env.OTSO_SQLITE_JOURNAL;
      else process.env.OTSO_SQLITE_JOURNAL = previous;
    }
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(staged, `${dest}.incoming`);
    await rename(`${dest}.incoming`, dest);
    return result;
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
}

async function adoptOne(archive: string, a: Adoption, log: (m: string) => void): Promise<AdoptResult> {
  const src = join(archive, a.from);
  if (!existsSync(src)) return { name: a.name, status: 'missing', detail: `no ${a.from} in the archive` };
  return withLocalStaging(join(getSourcesDir(), a.to), (path) => adoptInto(path, src, a, log));
}

async function adoptInto(path: string, src: string, a: Adoption, log: (m: string) => void): Promise<AdoptResult> {
  const db = openArchiveDb(src);
  const store = ChronicleStore.open(path);
  try {
    const parts: string[] = [];
    for (const t of a.tables) {
      const cols = (db.query(`PRAGMA table_info("${t.from}")`).all() as { name: string }[]).map((c) => c.name);
      if (!cols.length) {
        parts.push(`${t.def.name}: no ${t.from} table`);
        continue;
      }
      // Keep every column the archive had; otso's columns come first.
      const passthrough = t.def.name === t.from || t.def === EVENTS_TABLE;
      const def: TableDef = passthrough ? { ...t.def, columns: [...new Set([...t.def.columns, ...cols])] } : t.def;
      const rows: Row[] = [];
      let read = 0;
      for (const r of db.query(`SELECT * FROM "${t.from}" ORDER BY rowid`).iterate() as Iterable<Row>) {
        read++;
        const m = t.map(r);
        if (m) rows.push(m);
      }
      const s: UpsertStats = store.upsert(def, rows);
      parts.push(`${def.name}: ${read} read → ${s.inserted} stored${s.updated ? `, ${s.updated} already stored or repeated` : ''}`);
    }
    store.setState('adopted_from', JSON.stringify({ archive: src, at: new Date().toISOString() }));
    if (a.toml && (await ensureSourceBlock(a.toml.source, a.toml.block))) parts.push(`added "${a.toml.source}" to ~/.otso/config/sources.local.toml`);
    log(`${a.name}: ${parts.join('; ')}`);
    return { name: a.name, status: 'adopted', detail: parts.join('; ') };
  } finally {
    store.close();
    db.close();
  }
}

export async function adoptChronicle(
  opts: { archive: string; only?: string[]; log?: (m: string) => void }
): Promise<AdoptResult[]> {
  const archive = opts.archive;
  const log = opts.log ?? (() => {});
  if (!existsSync(archive)) throw new Error(`Archive not found: ${archive}`);
  const results: AdoptResult[] = [];
  const list = adoptions(archive).filter((a) => !opts.only?.length || opts.only.includes(a.name));
  for (const a of list) {
    try {
      results.push(await adoptOne(archive, a, log));
    } catch (err) {
      results.push({ name: a.name, status: 'failed', detail: err instanceof Error ? err.message : String(err) });
    }
  }

  // Sources otso has no connector for (Timing, Foursquare, Notion, …): copy
  // the database as it is so the sources.toml queries keep working.
  if (!opts.only?.length) {
    const covered = new Set(adoptions(archive).map((a) => a.to));
    for (const s of (await readSourcesToml()).sources ?? []) {
      if (!s.db_path || covered.has(s.db_path)) continue;
      const src = join(archive, s.db_path);
      const dest = join(getSourcesDir(), s.db_path);
      if (!existsSync(src)) continue;
      if (existsSync(dest)) {
        results.push({ name: s.name, status: 'skipped', detail: 'already in sources-dir' });
        continue;
      }
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(src, dest);
      log(`${s.name}: copied as is`);
      results.push({ name: s.name, status: 'copied', detail: 'copied as is (no otso connector)' });
    }
  }
  return results;
}
