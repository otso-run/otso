import { existsSync } from 'node:fs';
import { execa } from 'execa';
import { EVENTS_TABLE } from '../core/chronicle.js';
import { iso } from '../core/time.js';
import type { Connector, RunStats } from './types.js';
import { addStats, NotOnThisMacError } from './util.js';

/**
 * DEVONthink records, through DEVONthink's own scripting interface (its
 * database files aren't a documented format). Every open database is read:
 * name, kind, tags, comment, URL, group path and the plain text DEVONthink
 * extracted. DEVONthink is started if it isn't running, and the first run
 * asks once for permission to control it (System Settings > Privacy &
 * Security > Automation).
 *
 * Records are keyed on DEVONthink's uuid, which DEVONthink sync keeps the
 * same across Macs. Records removed from an open database are removed here;
 * a database that isn't open is left as it was.
 */

const APPS = ['DEVONthink', 'DEVONthink 3'];
const MAX_TEXT = 200_000;

/** JXA that prints one JSON object: { databases: [{ name, uuid, records: [...] }] }. */
const SCRIPT = (appName: string) => `
const app = Application(${JSON.stringify(appName)});
const out = [];
for (const db of app.databases()) {
  const c = db.contents;
  const cols = {};
  for (const p of ['uuid', 'name', 'recordType', 'creationDate', 'modificationDate', 'tags', 'comment', 'url', 'location', 'plainText']) {
    try { cols[p] = c[p](); } catch (e) { cols[p] = []; }
  }
  const records = cols.uuid.map((u, i) => ({
    uuid: u, name: cols.name[i], kind: String(cols.recordType[i] || ''),
    created: cols.creationDate[i] ? cols.creationDate[i].toISOString() : null,
    modified: cols.modificationDate[i] ? cols.modificationDate[i].toISOString() : null,
    tags: cols.tags[i] || [], comment: cols.comment[i] || '', url: cols.url[i] || '',
    location: cols.location[i] || '', text: String(cols.plainText[i] || '').slice(0, ${MAX_TEXT}),
  }));
  out.push({ name: db.name(), uuid: db.uuid(), records });
}
JSON.stringify({ databases: out });
`;

export interface DtRecord {
  uuid: string;
  name: string;
  kind: string;
  created: string | null;
  modified: string | null;
  tags: string[];
  comment: string;
  url: string;
  location: string;
  text: string;
}

/** Groups are folders, not documents: they're left out. */
const SKIP_KINDS = new Set(['group', 'smart group', 'feed', 'tag']);

export function devonthinkRows(database: string, records: DtRecord[]) {
  return records
    .filter((r) => r.uuid && !SKIP_KINDS.has(r.kind.toLowerCase()))
    .map((r) => ({
      source_id: r.uuid,
      type: 'CreateAction',
      source: 'devonthink',
      additionalType: r.kind || 'record',
      name: r.name || '(untitled)',
      description: r.comment,
      text: r.text,
      dateCreated: iso(r.created),
      endTime: iso(r.modified),
      object: { database, location: r.location, url: /^https?:/.test(r.url) ? r.url : undefined, keywords: r.tags },
    }));
}

/** Swappable in tests. */
export const devonthinkRunner = {
  async run(appName: string): Promise<{ databases: { name: string; uuid: string; records: DtRecord[] }[] }> {
    const { stdout } = await execa('osascript', ['-l', 'JavaScript', '-e', SCRIPT(appName)], { maxBuffer: 1024 * 1024 * 1024 });
    return JSON.parse(stdout);
  },
  appName(): string | null {
    return APPS.find((a) => existsSync(`/Applications/${a}.app`)) ?? null;
  },
};

export const devonthink: Connector = {
  id: 'devonthink',
  displayName: 'DEVONthink',
  description: 'Documents, notes and bookmarks in open databases',
  kind: 'local',
  dbPath: 'devonthink/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],
  localPaths: APPS.map((a) => `/Applications/${a}.app`),

  async sync({ store, log }) {
    const appName = devonthinkRunner.appName();
    if (!appName) throw new NotOnThisMacError('DEVONthink');
    let result;
    try {
      result = await devonthinkRunner.run(appName);
    } catch (err: any) {
      if (/-1743|not allowed|Not authorized/i.test(String(err?.stderr ?? err?.message))) {
        throw new Error(
          'otso is not allowed to control DEVONthink. Allow your terminal under System Settings > Privacy & Security > Automation > DEVONthink, then run the sync again.'
        );
      }
      throw err;
    }

    const stats: RunStats = {};
    let read = 0;
    const gone: string[] = [];
    for (const db of result.databases) {
      const rows = devonthinkRows(db.name, db.records);
      read += rows.length;
      addStats(stats, 'events', store.upsert(EVENTS_TABLE, rows));
      const keep = new Set(rows.map((r) => r.source_id));
      for (const r of store.db
        .query(`SELECT source_id FROM events WHERE json_extract(object, '$.database') = ?`)
        .all(db.name) as { source_id: string }[]) {
        if (!keep.has(r.source_id)) gone.push(r.source_id);
      }
    }
    const removed = store.deleteKeys(EVENTS_TABLE, gone);
    log(
      `${read.toLocaleString()} records from ${result.databases.map((d) => d.name).join(', ') || 'no open databases'}` +
        (removed ? `, ${removed} removed` : '')
    );
    return stats;
  },
};
