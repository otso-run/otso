import { EVENTS_TABLE } from '../core/chronicle.js';
import { parseCsv } from '../core/archive.js';
import { getJson } from '../core/http.js';
import { fromUnixSeconds, iso } from '../core/time.js';
import type { Connector, RunStats } from './types.js';
import { addStats, shortHash } from './util.js';

/**
 * Last.fm scrobbles via user.getrecenttracks. The first sync walks the whole
 * history (200 per page); later syncs ask only for scrobbles after the newest
 * one already stored. CSVs from lastfm-to-csv can be ingested too.
 */

const API = 'https://ws.audioscrobbler.com/2.0/';

function scrobbleRow(artist: string, album: string, track: string, when: string | null, url?: string) {
  return {
    source_id: `scrobble-${when}-${shortHash(artist, track)}`,
    type: 'ListenAction',
    source: 'lastfm',
    object: {
      name: track,
      byArtist: [{ name: artist }],
      inAlbum: { name: album },
      url: url ?? null,
    },
    startTime: when,
  };
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** lastfm-to-csv writes "05 Jan 2024 18:22" (UTC). */
export function parseLastfmDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2}) (\w{3}) (\d{4}),? (\d{1,2}):(\d{2})$/);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
    return iso(Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +m[4], +m[5]));
  }
  if (/^\d{9,10}$/.test(s.trim())) return fromUnixSeconds(s);
  return iso(s);
}

export const lastfm: Connector = {
  id: 'lastfm',
  displayName: 'Last.fm',
  description: 'Scrobble history',
  kind: 'api',
  dbPath: 'lastfm/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],

  auth: {
    setupUrl: 'https://www.last.fm/api/account/create',
    instructions: [
      'Create an API account at last.fm/api/account/create (any name works).',
      'Copy the API key it shows, and enter your Last.fm username.',
    ],
    fields: [
      { name: 'username', label: 'Last.fm username' },
      { name: 'apiKey', label: 'API key', secret: true },
    ],
    async verify(creds) {
      const p = new URLSearchParams({ method: 'user.getinfo', user: creds.username, api_key: creds.apiKey, format: 'json' });
      const res = await getJson<any>(`${API}?${p}`);
      if (res?.error) throw new Error(res.message ?? 'Last.fm rejected the request');
      return res.user?.name ?? creds.username;
    },
  },

  exportGuide: {
    url: 'https://benjaminbenben.com/lastfm-to-csv/',
    steps: ['Last.fm has no native export; enter your username at lastfm-to-csv', 'Download the CSV'],
    filePatterns: ['*.csv'],
  },

  async sync({ store, credentials, full, log }) {
    const from = full ? null : store.getState('lastUts');
    const stats: RunStats = {};
    let newest = Number(from ?? 0);
    let totalPages = 1;

    for (let page = 1; page <= totalPages; page++) {
      const p = new URLSearchParams({
        method: 'user.getrecenttracks',
        user: credentials.username,
        api_key: credentials.apiKey,
        format: 'json',
        limit: '200',
        page: String(page),
      });
      if (from) p.set('from', String(Number(from) + 1));
      const res = await getJson<any>(`${API}?${p}`);
      if (res?.error) throw new Error(res.message);
      const rt = res.recenttracks;
      totalPages = Number(rt?.['@attr']?.totalPages ?? 1);
      const tracks: any[] = Array.isArray(rt?.track) ? rt.track : rt?.track ? [rt.track] : [];
      const rows = [];
      for (const t of tracks) {
        if (t['@attr']?.nowplaying || !t.date?.uts) continue;
        const uts = Number(t.date.uts);
        newest = Math.max(newest, uts);
        rows.push(scrobbleRow(t.artist?.['#text'] ?? t.artist?.name ?? '', t.album?.['#text'] ?? '', t.name, fromUnixSeconds(uts), t.url));
      }
      addStats(stats, 'events', store.upsert(EVENTS_TABLE, rows));
      if (page % 10 === 0 || page === totalPages) log(`page ${page}/${totalPages}`);
    }
    // Only advance the cursor once every page is stored.
    if (newest) store.setState('lastUts', String(newest));
    return stats;
  },

  async ingest({ store, log }, archive) {
    const stats: RunStats = {};
    for (const file of archive.find(/\.csv$/i)) {
      const text = await archive.readText(file);
      const hasHeader = /^﻿?\s*"?(artist|uts|utc_time)/i.test(text);
      const rows = (hasHeader ? parseCsv(text) : parseCsv('artist,album,track,date\n' + text)).map((r) => {
        const when = r.uts ? fromUnixSeconds(r.uts) : parseLastfmDate(r.date ?? r.utc_time ?? '');
        return scrobbleRow(r.artist, r.album, r.track, when);
      });
      addStats(stats, 'events', store.upsert(EVENTS_TABLE, rows.filter((r) => r.startTime)));
      log(`${file}: ${rows.length} scrobbles`);
    }
    return stats;
  },
};
