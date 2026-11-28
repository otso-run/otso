import type { TableDef } from '../core/chronicle.js';
import type { Archive } from '../core/archive.js';
import { iso } from '../core/time.js';
import type { Connector, RunStats } from './types.js';
import { addStats, shortHash } from './util.js';
import { CHAT_TABLE, chatRows, conversationName } from './takeout/chat.js';
import { VOICE_TABLE, voiceRows } from './takeout/voice.js';
import { PLACES_TABLE, geoJsonPlaces, savedListPlaces, timelinePlaces } from './takeout/places.js';
import { KEEP_TABLE, keepRow } from './takeout/keep.js';
import { ACTIVITY_TABLE, GEMINI_TABLE, SKIPPED_ACTIVITY, activityRows, geminiRows } from './takeout/activity.js';
import { DOCUMENTS_TABLE, TEXT_FILE, documentRow } from './takeout/documents.js';
import { CONTACTS_TABLE, contactRow, parseVcf } from './takeout/contacts.js';
import { BLOGGER_TABLE, bloggerRows } from './takeout/blogger.js';
import { PHOTOS_TABLE, PHOTO_SIDECAR, mergePhoto, photoRow, type PhotoRow } from './takeout/photos.js';
import { MAIL_TABLE, ingestMbox, mailRow } from './gmail.js';
import { stat } from 'node:fs/promises';

/**
 * Google Takeout feeds several sources.toml entries from one db:
 *   google-search  My Activity/Search/MyActivity.json
 *   chrome         Chrome/History.json (BrowserHistory.json on newer exports)
 *   youtube        YouTube and YouTube Music/history/watch-history.json
 *   gcal           Calendar/*.ics
 *   google-chat    Google Chat/Groups/<id>/messages.json (+ group_info.json)
 *   google-voice   Voice/Calls/*.html
 *   google-maps    Maps (your places), Maps/My labeled places, Saved/*.csv, Timeline
 *   gemini         My Activity/Gemini Apps/MyActivity.json
 *   google-activity  every other My Activity product (Maps, Discover, Play, ...)
 *   notebooklm     NotebookLM/<notebook>/ text files (and Gemini/ Gems)
 *   google-keep    Keep/*.json
 *   google-contacts  Contacts/<group>/*.vcf
 *   blogger        Blogger/Blogs/<blog>/feed.atom
 *   google-groups  Groups/ mbox files
 *   googlephotos   Google Photos/<album>/*.json sidecars (metadata only)
 * Mail is its own source (gmail.ts) because of its size.
 * Takeout often arrives as several zips; ingest each one (any order).
 * Only the JSON formats are read, so choose JSON for My Activity.
 */

/** Google's groups messages share the Gmail columns, in their own table. */
export const GROUPS_TABLE: TableDef = { ...MAIL_TABLE, name: 'google_groups' };

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
  description: 'Search, Chrome, YouTube, Calendar, Chat, Voice, Maps, Gemini, NotebookLM, Keep, Contacts, Blogger, Groups, My Activity and Photos metadata',
  kind: 'export',
  dbPath: 'google-takeout/chronicle/chronicle.db',
  tables: [
    GOOGLE_SEARCH,
    CHROME_HISTORY,
    YOUTUBE_WATCH,
    CALENDAR,
    CHAT_TABLE,
    VOICE_TABLE,
    PLACES_TABLE,
    GEMINI_TABLE,
    ACTIVITY_TABLE,
    DOCUMENTS_TABLE,
    KEEP_TABLE,
    CONTACTS_TABLE,
    BLOGGER_TABLE,
    GROUPS_TABLE,
    PHOTOS_TABLE,
  ],
  configSources: [
    'google-search',
    'chrome',
    'youtube',
    'gcal',
    'google-chat',
    'google-voice',
    'google-maps',
    'gemini',
    'google-activity',
    'notebooklm',
    'google-keep',
    'google-contacts',
    'blogger',
    'google-groups',
    'googlephotos',
  ],

  exportGuide: {
    url: 'https://takeout.google.com/',
    steps: [
      'Click "Deselect all"',
      'Tick the products you want; otso reads Blogger, Calendar, Chrome, Contacts, Gemini, Google Chat, Google Photos (metadata), Groups, Keep, Maps, Maps (your places), My Activity, NotebookLM, Saved, Timeline, Voice and YouTube',
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

    const fileSet = new Set(archive.files);
    const chatFiles = archive.find(/Google Chat\/Groups\/[^/]+\/messages\.json$/i);
    let chatCount = 0;
    for (const file of chatFiles) {
      const folder = file.split('/').slice(-2)[0];
      const infoFile = file.replace(/messages\.json$/i, 'group_info.json');
      const info = fileSet.has(infoFile) ? await archive.readJson(infoFile).catch(() => null) : null;
      const rows = chatRows(await archive.readJson(file), conversationName(info, folder));
      addStats(stats, 'google_chat', store.upsert(CHAT_TABLE, rows));
      chatCount += rows.length;
      found++;
    }
    if (chatFiles.length) log(`Google Chat: ${chatCount} messages in ${chatFiles.length} conversations`);

    const voiceFiles = archive.find(/Voice\/Calls\/[^/]+\.html$/i);
    let voiceCount = 0;
    for (const file of voiceFiles) {
      const rows = voiceRows(file.split('/').pop()!, await archive.readText(file));
      addStats(stats, 'google_voice', store.upsert(VOICE_TABLE, rows));
      voiceCount += rows.length;
      found++;
    }
    if (voiceFiles.length) log(`Voice: ${voiceCount} texts and calls`);

    const one = async (table: TableDef, rows: Record<string, unknown>[], label: string) => {
      addStats(stats, table.name, store.upsert(table, rows));
      if (rows.length) log(`${label}: ${rows.length.toLocaleString()}`);
      found++;
    };
    // Lists without dates of their own are dated by the export's file times.
    const fileTime = async (rel: string) => stat(archive.abs(rel)).then((s) => s.mtime).catch(() => null);

    // Maps, saved lists and Timeline
    for (const file of archive.find(/Maps \(your places\)\/(Saved Places|Reviews)\.json$/i)) {
      const kind = /Reviews\.json$/i.test(file) ? 'review' : 'starred';
      const list = kind === 'review' ? 'Reviews' : 'Starred places';
      await one(PLACES_TABLE, geoJsonPlaces(await archive.readJson(file), kind, list, iso(await fileTime(file))), `Maps ${list}`);
    }
    for (const file of archive.find(/(^|\/)Maps\/My labeled places\/[^/]+\.json$/i)) {
      await one(PLACES_TABLE, geoJsonPlaces(await archive.readJson(file), 'labeled', 'Labeled places', iso(await fileTime(file))), 'Maps labeled places');
    }
    for (const file of archive.find(/(^|\/)Saved\/[^/]+\.csv$/i)) {
      const list = file.split('/').pop()!.replace(/\.csv$/i, '');
      await one(PLACES_TABLE, savedListPlaces(await archive.readText(file), list, iso(await fileTime(file))), `Saved "${list}"`);
    }
    for (const file of archive.find(/(Semantic Location History\/\d{4}\/[^/]+|Timeline\/[^/]*Timeline[^/]*|location-history)\.json$/i)) {
      const rows = timelinePlaces(await archive.readJson(file).catch(() => null));
      if (rows.length) await one(PLACES_TABLE, rows, `Timeline ${file.split('/').pop()}`);
    }

    // My Activity: Gemini, then every other product
    for (const file of archive.find(/My Activity\/Gemini Apps\/MyActivity\.json$/i)) {
      await one(GEMINI_TABLE, geminiRows(await archive.readJson(file)), 'Gemini');
    }
    for (const file of archive.find(/My Activity\/[^/]+\/MyActivity\.json$/i)) {
      const product = file.split('/').slice(-2)[0];
      if (SKIPPED_ACTIVITY.test(product)) continue;
      await one(ACTIVITY_TABLE, activityRows(await archive.readJson(file), product), `My Activity ${product}`);
    }

    // NotebookLM notebooks and Gemini files (Gems)
    for (const product of ['NotebookLM', 'Gemini']) {
      const prefix = new RegExp(`(^|/)${product}/`);
      const files = archive.find(new RegExp(`(^|/)${product}/.+`)).filter((f) => TEXT_FILE.test(f));
      const rows = [];
      for (const file of files) {
        const rel = file.slice(file.search(prefix)).replace(prefix, '');
        const row = documentRow(product, rel, await archive.readText(file), await fileTime(file));
        if (row) rows.push(row);
      }
      if (files.length) await one(DOCUMENTS_TABLE, rows, product);
    }

    // Keep
    const keepRows = [];
    const keepFiles = archive.find(/(^|\/)Keep\/[^/]+\.json$/i);
    for (const file of keepFiles) {
      const row = keepRow(await archive.readJson(file).catch(() => null), file.split('/').pop()!);
      if (row) keepRows.push(row);
    }
    if (keepFiles.length) await one(KEEP_TABLE, keepRows, 'Keep');

    // Contacts: one row per person, merging the groups they appear in
    const contactFiles = archive.find(/(^|\/)Contacts\/.+\.vcf$/i);
    const contacts = new Map<string, any>();
    for (const file of contactFiles) {
      const group = file.split('/').slice(-2)[0];
      const exportedAt = iso(await fileTime(file));
      for (const card of parseVcf(await archive.readText(file))) {
        const row = contactRow(card, group, exportedAt);
        if (!row) continue;
        const prev = contacts.get(row.source_id);
        if (!prev) contacts.set(row.source_id, row);
        else for (const g of row.groups) if (!prev.groups.includes(g)) prev.groups.push(g);
      }
    }
    if (contactFiles.length) await one(CONTACTS_TABLE, [...contacts.values()], 'Contacts');

    // Blogger
    for (const file of archive.find(/(^|\/)Blogger\/Blogs\/[^/]+\/feed\.atom$/i)) {
      const blog = file.split('/').slice(-2)[0];
      await one(BLOGGER_TABLE, bloggerRows(await archive.readText(file), blog), `Blogger "${blog}"`);
    }

    // Groups: any mbox under Groups/, named after its folder
    for (const file of archive.find(/(^|\/)Groups\/.+\.mbox$/i)) {
      const group = file.split('/').slice(-2)[0];
      const n = await ingestMbox(store, stats, GROUPS_TABLE, archive.abs(file), (raw, fromLine) => mailRow(raw, fromLine, group), log);
      log(`Groups "${group}": ${n.toLocaleString()}`);
      found++;
    }

    // Google Photos: metadata sidecars only, merged across albums
    const photoFiles = archive.find(PHOTO_SIDECAR);
    if (photoFiles.length) {
      const photos = new Map<string, PhotoRow>();
      for (const file of photoFiles) {
        const row = photoRow(await archive.readJson(file).catch(() => null), file.split('/').slice(-2)[0]);
        if (row) mergePhoto(photos, row);
      }
      await one(PHOTOS_TABLE, [...photos.values()] as any[], 'Google Photos (metadata)');
    }

    if (archive.find(/(^|\/)Mail\/[^/]+\.mbox$/i).length) {
      log('Mail is in this Takeout too. It is its own source: otso ingest gmail <the same path>');
    }

    if (!found) {
      const html = archive.find(/My Activity\/.*\.html$/i).length;
      throw new Error(
        html
          ? 'This Takeout has My Activity as HTML. Re-export with JSON selected under "Multiple formats".'
          : 'Found no Google product otso can read in this Takeout.'
      );
    }
    return stats;
  },
};
