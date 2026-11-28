import { EVENTS_TABLE } from '../core/chronicle.js';
import { APPLE_EPOCH_OFFSET, fromAppleTime } from '../core/time.js';
import type { Connector, RunStats } from './types.js';
import { addStats, columnsOf, NotOnThisMacError, resolveLocalPath, shortHash, withDatabaseCopy } from './util.js';

/**
 * Apple Calendar, read from the cache Calendar.app keeps of every account it
 * shows (iCloud, Google, Exchange, subscriptions). Fantastical and most other
 * calendar apps read the same accounts through EventKit, so this covers them.
 *
 * Calendar.app stores one row per event, plus one per moved or edited
 * occurrence of a repeating event. Repeats are expanded in OccurrenceCache,
 * which only covers about a year back and a few years ahead, so each sync
 * adds the past occurrences it can see and keeps the ones it already stored.
 *
 * Events are keyed on their iCalendar UID and start, the same on every Mac.
 * An event deleted in Calendar is removed here on the next sync; an older
 * occurrence that has left the cache's window is kept.
 */

const calendarPaths = [
  '~/Library/Group Containers/group.com.apple.calendar/Calendar.sqlitedb',
  '~/Library/Calendars/Calendar.sqlitedb',
];

/** Calendar uses this year for birthdays and anniversaries with no year. */
const EARLIEST = Date.UTC(1900, 0, 1) / 1000 - APPLE_EPOCH_OFFSET;

const STATUS: Record<number, string> = { 1: 'confirmed', 2: 'tentative', 3: 'canceled' };

export const eventKey = (uid: string, start: number) => `event-${shortHash(uid, Math.round(start))}`;

interface ItemRow {
  id: number;
  uid: string | null;
  summary: string | null;
  description: string | null;
  start: number;
  end: number | null;
  all_day: number | null;
  status: number | null;
  url: string | null;
  recurs: number | null;
  calendar: string | null;
  loc_title: string | null;
  loc_address: string | null;
  lat: number | null;
  lon: number | null;
}

/** Invites can come from anyone; keep only links a browser should open. */
function webUrl(url: string | null): string | undefined {
  try {
    return url && ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

function eventRow(r: ItemRow, start: number, end: number | null, occurrence: boolean) {
  const place = r.loc_title || r.loc_address;
  const hasGeo = r.lat != null && r.lon != null && !(r.lat === 0 && r.lon === 0);
  return {
    source_id: eventKey(r.uid ?? String(r.id), start),
    type: 'Event',
    source: 'apple-calendar',
    name: r.summary || '(No title)',
    description: r.description ?? '',
    startTime: fromAppleTime(start),
    endTime: fromAppleTime(end),
    additionalType: r.calendar ?? null,
    actionStatus: r.status != null ? STATUS[r.status] ?? null : null,
    contentLocation: place
      ? { name: r.loc_title ?? undefined, address: r.loc_address ?? undefined, geo: hasGeo ? { latitude: r.lat, longitude: r.lon } : undefined }
      : null,
    object: {
      calendar: r.calendar ?? undefined,
      allDay: !!r.all_day,
      url: webUrl(r.url),
      repeats: !!r.recurs,
      occurrence,
    },
  };
}

export const appleCalendar: Connector = {
  id: 'apple-calendar',
  displayName: 'Calendar',
  description: 'Events from every account in Calendar.app',
  kind: 'local',
  dbPath: 'apple-calendar/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],
  localPaths: calendarPaths,
  permission: 'full-disk-access',

  async sync({ store, log }) {
    const path = calendarPaths.map(resolveLocalPath).find(Boolean);
    if (!path) throw new NotOnThisMacError('Calendar');

    return withDatabaseCopy(path, (db) => {
      const cols = columnsOf(db, 'CalendarItem');
      const hasOccurrences = (db.query(`SELECT 1 FROM sqlite_master WHERE name = 'OccurrenceCache'`).get() as unknown) != null;
      // Older caches mixed reminders (entity_type 3) in with events (2).
      const eventsOnly = cols.has('entity_type') ? 'AND COALESCE(i.entity_type, 2) = 2' : '';
      const notHidden = cols.has('hidden') ? 'AND COALESCE(i.hidden, 0) = 0' : '';

      const items = db
        .query(
          `SELECT i.ROWID AS id, i.unique_identifier AS uid, i.summary, i.description,
                  i.start_date AS start, i.end_date AS "end", i.all_day, i.status, i.url,
                  ${cols.has('has_recurrences') ? 'i.has_recurrences' : '0'} AS recurs,
                  c.title AS calendar, l.title AS loc_title, l.address AS loc_address,
                  l.latitude AS lat, l.longitude AS lon
           FROM CalendarItem i
           LEFT JOIN Calendar c ON c.ROWID = i.calendar_id
           LEFT JOIN Location l ON l.ROWID = i.location_id
           WHERE i.start_date IS NOT NULL AND i.start_date >= ? ${eventsOnly} ${notHidden}`
        )
        .all(EARLIEST) as ItemRow[];

      const rows = new Map<string, ReturnType<typeof eventRow>>();
      const byId = new Map<number, ItemRow>();
      for (const r of items) {
        byId.set(r.id, r);
        const row = eventRow(r, r.start, r.end, false);
        rows.set(row.source_id, row);
      }

      // Past occurrences of repeating events, as far back as the cache goes.
      let windowStart: number | null = null;
      if (hasOccurrences) {
        const now = Date.now() / 1000 - APPLE_EPOCH_OFFSET;
        const occ = db
          .query(
            `SELECT event_id, COALESCE(occurrence_start_date, occurrence_date) AS start, occurrence_end_date AS "end"
             FROM OccurrenceCache WHERE next_reminder_date IS NULL`
          )
          .all() as { event_id: number; start: number; end: number | null }[];
        for (const o of occ) {
          windowStart = windowStart === null ? o.start : Math.min(windowStart, o.start);
          const item = byId.get(o.event_id);
          if (!item?.recurs || o.start > now) continue;
          const row = eventRow(item, o.start, o.end, true);
          if (!rows.has(row.source_id)) rows.set(row.source_id, row);
        }
      }

      const stats: RunStats = {};
      addStats(stats, 'events', store.upsert(EVENTS_TABLE, rows.values()));

      // Anything stored that Calendar no longer has was deleted there, except
      // occurrences older than the cache's window, which it has simply forgotten.
      const cutoff = windowStart === null ? null : fromAppleTime(windowStart);
      const gone = (
        store.db
          .query(`SELECT source_id, startTime, json_extract(object, '$.occurrence') AS occ FROM events`)
          .all() as { source_id: string; startTime: string | null; occ: number | null }[]
      )
        .filter((r) => !rows.has(r.source_id))
        .filter((r) => !(r.occ && (cutoff === null || (r.startTime ?? '') < cutoff)))
        .map((r) => r.source_id);
      const removed = store.deleteKeys(EVENTS_TABLE, gone);

      log(
        `${items.length.toLocaleString()} events and ${(rows.size - items.length).toLocaleString()} past repeats read from Calendar` +
          (removed ? `, ${removed.toLocaleString()} deleted in Calendar removed` : '')
      );
      return stats;
    });
  },
};
