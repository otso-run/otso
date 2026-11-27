import type { TableDef } from '../core/chronicle.js';
import type { Archive } from '../core/archive.js';
import { iso } from '../core/time.js';
import type { Connector, RunStats } from './types.js';
import { addStats, shortHash } from './util.js';

/**
 * Google Takeout feeds four sources.toml entries from one db:
 *   google-search  My Activity/Search/MyActivity.json
 *   chrome         Chrome/History.json (BrowserHistory.json on newer exports)
 *   youtube        YouTube and YouTube Music/history/watch-history.json
 *   gcal           Calendar/*.ics
 * Takeout often arrives as several zips; ingest each one (any order).
 * Only the JSON formats are read, so choose JSON for My Activity.
 */

export const GOOGLE_SEARCH: TableDef = { name: 'google_search', key: 'source_id', columns: ['source_id', 'query', 'startTime'] };
export const CHROME_HISTORY: TableDef = { name: 'chrome_history', key: 'source_id', columns: ['source_id', 'object', 'startTime'] };
export const YOUTUBE_WATCH: TableDef = { name: 'youtube_watch', key: 'source_id', columns: ['source_id', 'object', 'startTime'] };
export const CALENDAR: TableDef = {
  name: 'calendar',
  key: 'source_id',
  columns: ['source_id', 'name', 'description', 'location', 'startDate', 'endDate', 'calendar'],
};

// Keys use second-precision ISO times so rows adopted from a Chronicle
// archive (which dropped milliseconds) match later Takeout imports.
export const searchKey = (time: string | null, query: string) => `search-${shortHash(time, query)}`;
export const watchKey = (time: string | null, url: string) => `watch-${shortHash(time, url)}`;
export const chromeKey = (timeUsec: string | number, url: string) => `chrome-${timeUsec}-${shortHash(url)}`;
export const calendarKey = (uid: string, recurrenceId?: string) => `cal-${shortHash(uid, recurrenceId)}`;

export function searchRows(items: any[]) {
  return items
    .filter((i) => typeof i.title === 'string' && /^Searched for /.test(i.title))
    .map((i) => ({
      source_id: searchKey(iso(i.time), i.title.replace(/^Searched for /, '')),
      query: i.title.replace(/^Searched for /, ''),
      startTime: iso(i.time),
    }));
}

export function chromeRows(data: any) {
  const items: any[] = data?.['Browser History'] ?? [];
  return items.map((i) => ({
    source_id: chromeKey(i.time_usec, i.url),
    object: { name: i.title || i.url, url: i.url },
    startTime: iso(Math.floor(Number(i.time_usec) / 1000)),
  }));
}

export function youtubeRows(items: any[]) {
  return items
    .filter((i) => i.titleUrl && typeof i.title === 'string')
    .map((i) => ({
      source_id: watchKey(iso(i.time), i.titleUrl),
      object: {
        name: i.title.replace(/^Watched /, ''),
        url: i.titleUrl,
        author: i.subtitles?.[0]?.name ?? null,
      },
      startTime: iso(i.time),
    }));
}

/** Unfold and split an .ics file into VEVENT property maps. */
export function parseIcs(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const events: Record<string, string>[] = [];
  let cur: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') {
      if (cur) events.push(cur);
      cur = null;
    } else if (cur) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const key = line.slice(0, i).split(';')[0];
      cur[key] = line
        .slice(i + 1)
        .replace(/\\n/gi, '\n')
        .replace(/\\([,;\\])/g, '$1');
    }
  }
  return events;
}

/** 20240115T103000Z / 20240115T103000 / 20240115 -> ISO */
export function icsDate(v?: string): string | null {
  if (!v) return null;
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  if (!m[4]) return `${m[1]}-${m[2]}-${m[3]}`;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? 'Z' : ''}`;
}

async function calendarRows(archive: Archive, file: string) {
  const cal = file.split('/').pop()!.replace(/\.ics$/i, '');
  return parseIcs(await archive.readText(file)).map((e) => ({
    source_id: e.UID ? calendarKey(e.UID, e['RECURRENCE-ID']) : `cal-${shortHash(e.DTSTART, e.SUMMARY)}`,
    name: e.SUMMARY ?? '',
    description: e.DESCRIPTION ?? '',
    location: e.LOCATION ?? '',
    startDate: icsDate(e.DTSTART),
    endDate: icsDate(e.DTEND),
    calendar: cal,
  }));
}

export const googleTakeout: Connector = {
  id: 'google-takeout',
  displayName: 'Google Takeout',
  description: 'Search, Chrome, YouTube and Calendar',
  kind: 'export',
  dbPath: 'google-takeout/chronicle/chronicle.db',
  tables: [GOOGLE_SEARCH, CHROME_HISTORY, YOUTUBE_WATCH, CALENDAR],
  configSources: ['google-search', 'chrome', 'youtube', 'gcal'],

  exportGuide: {
    url: 'https://takeout.google.com/',
    steps: [
      'Click "Deselect all"',
      'Tick Chrome, Calendar, My Activity and YouTube and YouTube Music',
      'Under My Activity, click "Multiple formats" and choose JSON',
      'Under YouTube, "Multiple formats" > history: JSON',
      'Next step: export once, .zip, 50 GB, then "Create export"',
      'Download every part from the email Google sends',
    ],
    filePatterns: ['takeout-*.zip', 'takeout-*.tgz'],
    wait: 'hours to a couple of days',
  },

  async ingest({ store, log }, archive) {
    const stats: RunStats = {};
    let found = 0;

    for (const file of archive.find(/My Activity\/Search\/MyActivity\.json$/i)) {
      const rows = searchRows(await archive.readJson(file));
      addStats(stats, 'google_search', store.upsert(GOOGLE_SEARCH, rows));
      log(`Search: ${rows.length}`);
      found++;
    }
    for (const file of archive.find(/Chrome\/(Browser)?History\.json$/i)) {
      const rows = chromeRows(await archive.readJson(file));
      addStats(stats, 'chrome_history', store.upsert(CHROME_HISTORY, rows));
      log(`Chrome: ${rows.length}`);
      found++;
    }
    for (const file of archive.find(/history\/watch-history\.json$/i)) {
      const rows = youtubeRows(await archive.readJson(file));
      addStats(stats, 'youtube_watch', store.upsert(YOUTUBE_WATCH, rows));
      log(`YouTube: ${rows.length}`);
      found++;
    }
    for (const file of archive.find(/Calendar\/[^/]+\.ics$/i)) {
      const rows = await calendarRows(archive, file);
      addStats(stats, 'calendar', store.upsert(CALENDAR, rows));
      log(`Calendar ${file.split('/').pop()}: ${rows.length}`);
      found++;
    }

    if (!found) {
      const html = archive.find(/My Activity\/.*\.html$/i).length;
      throw new Error(
        html
          ? 'This Takeout has My Activity as HTML. Re-export with JSON selected under "Multiple formats".'
          : 'No Search, Chrome, YouTube or Calendar data found in this Takeout.'
      );
    }
    return stats;
  },
};
