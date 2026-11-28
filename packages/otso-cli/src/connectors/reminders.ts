import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EVENTS_TABLE } from '../core/chronicle.js';
import { expandHome } from '../core/paths.js';
import { fromAppleTime } from '../core/time.js';
import type { Connector, RunStats } from './types.js';
import { addStats, columnsOf, NotOnThisMacError, withDatabaseCopy } from './util.js';

/**
 * Apple Reminders. The app keeps one SQLite store per account (iCloud, local,
 * Exchange) under Container_v1/Stores, so every Data-*.sqlite there is read.
 * Rows are keyed on the reminder's CloudKit id, the same on every Mac, and
 * shaped like Things to-dos so the two read alike in search. A reminder
 * deleted in the app is removed on the next sync.
 */

const STORES = '~/Library/Group Containers/group.com.apple.reminders/Container_v1/Stores';

function storeFiles(): string[] {
  const dir = expandHome(STORES);
  try {
    return readdirSync(dir)
      .filter((f) => /^Data-.*\.sqlite$/.test(f))
      .sort()
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

export const appleReminders: Connector = {
  id: 'apple-reminders',
  displayName: 'Reminders',
  description: 'Reminders and lists',
  kind: 'local',
  dbPath: 'apple-reminders/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],
  localPaths: [`${STORES}/Data-*.sqlite`],
  permission: 'full-disk-access',

  async sync({ store, log }) {
    const files = storeFiles();
    if (!files.length) throw new NotOnThisMacError('Reminders');
    const rows: Record<string, unknown>[] = [];
    const deleted: string[] = [];

    for (const file of files) {
      await withDatabaseCopy(file, (db) => {
        const tables = new Set((db.query(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name));
        if (!tables.has('ZREMCDREMINDER')) return;
        const cols = columnsOf(db, 'ZREMCDREMINDER');
        const has = (c: string) => (cols.has(c) ? `r.${c}` : 'NULL');
        const lists = tables.has('ZREMCDBASELIST');
        const storeId = file.match(/Data-(.+)\.sqlite$/)?.[1] ?? 'local';
        for (const r of db
          .query(
            `SELECT r.Z_PK AS pk, ${has('ZCKIDENTIFIER')} AS ck, r.ZTITLE AS title, ${has('ZNOTES')} AS notes,
                    ${has('ZCOMPLETED')} AS completed, ${has('ZCOMPLETIONDATE')} AS completed_at,
                    ${has('ZCREATIONDATE')} AS created, ${has('ZDUEDATE')} AS due, ${has('ZFLAGGED')} AS flagged,
                    ${has('ZPRIORITY')} AS priority, ${has('ZMARKEDFORDELETION')} AS gone,
                    ${lists ? 'l.ZNAME' : 'NULL'} AS list
             FROM ZREMCDREMINDER r
             ${lists ? 'LEFT JOIN ZREMCDBASELIST l ON l.Z_PK = r.ZLIST' : ''}`
          )
          .all() as any[]) {
          const id = r.ck || `${storeId}-${r.pk}`;
          if (r.gone || !r.title) {
            deleted.push(id);
            continue;
          }
          rows.push({
            source_id: id,
            type: 'CreateAction',
            source: 'apple-reminders',
            additionalType: 'Reminder',
            name: r.title,
            description: r.notes ?? '',
            startTime: fromAppleTime(r.created),
            endTime: r.completed ? fromAppleTime(r.completed_at) : null,
            actionStatus: r.completed ? 'completed' : 'open',
            result: r.list ? { name: r.list } : null,
            object: { due: fromAppleTime(r.due) ?? undefined, flagged: !!r.flagged, priority: r.priority || undefined },
          });
        }
      });
    }

    const stats: RunStats = {};
    addStats(stats, 'events', store.upsert(EVENTS_TABLE, rows));
    const removed = store.deleteKeys(EVENTS_TABLE, deleted);
    log(`${rows.length.toLocaleString()} reminders read from ${files.length} store${files.length === 1 ? '' : 's'}${removed ? `, ${removed} deleted in Reminders removed` : ''}`);
    return stats;
  },
};
