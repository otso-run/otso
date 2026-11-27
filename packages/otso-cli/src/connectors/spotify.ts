import { EVENTS_TABLE } from '../core/chronicle.js';
import { iso } from '../core/time.js';
import type { Connector, RunStats } from './types.js';
import { addStats } from './util.js';

/**
 * Spotify has no history API beyond the last 50 plays, so this reads the
 * privacy export. Both kinds are understood:
 *   Extended streaming history  Streaming_History_Audio_*.json (full, keyed by ts + uri)
 *   Account data                StreamingHistory_music_*.json / StreamingHistory*.json (past year)
 * Plays shorter than 30 seconds are left out, which is Spotify's own
 * threshold for counting a stream. The original zip is kept in exports/.
 */

const MIN_MS = 30_000;

function trackUrl(uri?: string | null): string | null {
  const m = uri?.match(/^spotify:(track|episode):(\w+)$/);
  return m ? `https://open.spotify.com/${m[1]}/${m[2]}` : null;
}

export function extendedRows(items: any[]) {
  const rows = [];
  for (const it of items) {
    if ((it.ms_played ?? 0) < MIN_MS) continue;
    const isEpisode = !it.master_metadata_track_name && it.episode_name;
    const name = it.master_metadata_track_name ?? it.episode_name;
    if (!name) continue;
    const uri = it.spotify_track_uri ?? it.spotify_episode_uri;
    const end = new Date(it.ts);
    rows.push({
      source_id: `listen-${it.ts}-${uri ?? name}`,
      type: 'ListenAction',
      source: 'spotify',
      object: isEpisode
        ? { name, partOfSeries: { name: it.episode_show_name }, byArtist: [{ name: it.episode_show_name }], url: trackUrl(uri) }
        : {
            name,
            byArtist: [{ name: it.master_metadata_album_artist_name }],
            inAlbum: { name: it.master_metadata_album_album_name },
            url: trackUrl(uri),
          },
      result: { duration_ms: it.ms_played, skipped: it.skipped ?? null, platform: it.platform },
      startTime: iso(end.getTime() - it.ms_played),
      endTime: iso(end),
    });
  }
  return rows;
}

export function accountRows(items: any[]) {
  const rows = [];
  for (const it of items) {
    const ms = it.msPlayed ?? 0;
    if (ms < MIN_MS) continue;
    // "2024-01-15 10:30" in UTC
    const end = new Date(String(it.endTime).replace(' ', 'T') + ':00Z');
    const name = it.trackName ?? it.episodeName;
    const artist = it.artistName ?? it.podcastName;
    rows.push({
      source_id: `listen-${iso(end)}-${artist}-${name}`,
      type: 'ListenAction',
      source: 'spotify',
      object: { name, byArtist: [{ name: artist }], inAlbum: { name: '' }, url: null },
      result: { duration_ms: ms },
      startTime: iso(end.getTime() - ms),
      endTime: iso(end),
    });
  }
  return rows;
}

export const spotify: Connector = {
  id: 'spotify',
  displayName: 'Spotify',
  description: 'Streaming history',
  kind: 'export',
  dbPath: 'spotify/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],

  exportGuide: {
    url: 'https://www.spotify.com/account/privacy/',
    steps: [
      'Log in and scroll to "Download your data"',
      'Tick "Extended streaming history" (the full archive), then "Request data"',
      'Confirm the request from the email Spotify sends',
      'When the "ready" email arrives, download my_spotify_data.zip',
    ],
    filePatterns: ['my_spotify_data*.zip', 'spotify_extended*.zip', 'Spotify Extended Streaming History*.zip'],
    wait: 'up to 30 days (usually a few days)',
  },

  async ingest({ store, log }, archive) {
    const stats: RunStats = {};
    const extended = archive.find(/Streaming_History_(Audio|Video)_.*\.json$/i);
    const account = extended.length ? [] : archive.find(/StreamingHistory[^/]*\.json$/i);
    for (const file of extended) {
      const rows = extendedRows(await archive.readJson(file));
      addStats(stats, 'events', store.upsert(EVENTS_TABLE, rows));
      log(`${file}: ${rows.length} plays`);
    }
    for (const file of account) {
      const rows = accountRows(await archive.readJson(file));
      addStats(stats, 'events', store.upsert(EVENTS_TABLE, rows));
      log(`${file}: ${rows.length} plays`);
    }
    if (!extended.length && !account.length) {
      throw new Error('No streaming history found. Expected Streaming_History_Audio_*.json in the export.');
    }
    return stats;
  },
};
