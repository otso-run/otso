import { EVENTS_TABLE } from '../core/chronicle.js';
import { saveCredentials, type Credentials } from '../core/credentials.js';
import { getJson } from '../core/http.js';
import { redirectUri, waitForAuthorizationCode } from '../core/oauth.js';
import { iso } from '../core/time.js';
import type { Connector, RunStats } from './types.js';
import { addStats } from './util.js';

/**
 * Spotify's API only remembers the last 50 plays, so the full history comes
 * from the privacy export, and `otso sync spotify` keeps it going from there:
 * run on a schedule, it picks up recent plays before they fall off that list.
 * Synced plays use the same key as the export's (end time + track URI), so a
 * later export lines up with them. Signing in needs your own Spotify
 * developer app with redirect URI http://127.0.0.1:8765/callback.
 *
 * Export kinds understood:
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

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';

/** A play from /me/player/recently-played, keyed like the export's rows. */
export function recentRow(item: any) {
  const t = item.track ?? {};
  const end = iso(item.played_at);
  const isEpisode = t.type === 'episode';
  return {
    source_id: `listen-${end}-${t.uri ?? t.name}`,
    type: 'ListenAction',
    source: 'spotify',
    object: {
      name: t.name,
      byArtist: isEpisode ? [{ name: t.show?.name }] : (t.artists ?? []).map((a: any) => ({ name: a.name })),
      inAlbum: isEpisode ? undefined : { name: t.album?.name },
      partOfSeries: isEpisode ? { name: t.show?.name } : undefined,
      url: t.external_urls?.spotify ?? trackUrl(t.uri),
    },
    result: { duration_ms: t.duration_ms, context: item.context?.type ?? null },
    startTime: t.duration_ms && end ? iso(Date.parse(end) - t.duration_ms) : null,
    endTime: end,
  };
}

async function token(creds: Credentials, body: Record<string, string>) {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  return getJson<any>(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
}

export const spotify: Connector = {
  id: 'spotify',
  displayName: 'Spotify',
  description: 'Streaming history',
  kind: 'api',
  dbPath: 'spotify/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],

  auth: {
    setupUrl: 'https://developer.spotify.com/dashboard',
    instructions: [
      'Create an app at developer.spotify.com/dashboard (Web API) with redirect URI http://127.0.0.1:8765/callback.',
      'Enter its client id and secret; your browser then opens to approve access to recently played tracks.',
    ],
    fields: [
      { name: 'clientId', label: 'Client ID' },
      { name: 'clientSecret', label: 'Client secret', secret: true },
    ],
    async verify(creds) {
      if (!creds.refreshToken) {
        const authorize = new URL(`${ACCOUNTS}/authorize`);
        authorize.search = new URLSearchParams({
          client_id: creds.clientId,
          response_type: 'code',
          redirect_uri: redirectUri(),
          scope: 'user-read-recently-played',
        }).toString();
        const code = await waitForAuthorizationCode({ authorizeUrl: authorize.toString(), log: console.log });
        const t = await token(creds, { grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
        if (!t?.refresh_token) throw new Error('Spotify did not return a refresh token');
        creds.refreshToken = t.refresh_token;
      }
      const t = await token(creds, { grant_type: 'refresh_token', refresh_token: creds.refreshToken });
      if (t?.refresh_token) creds.refreshToken = t.refresh_token;
      const me = await getJson<any>(`${API}/me`, { headers: { Authorization: `Bearer ${t.access_token}` } }).catch(() => null);
      return me?.display_name || me?.id || 'Spotify';
    },
  },

  async sync({ store, credentials, log }) {
    if (!credentials.refreshToken) throw new Error('Not signed in to Spotify. Run: otso auth spotify');
    const t = await token(credentials, { grant_type: 'refresh_token', refresh_token: credentials.refreshToken });
    if (!t?.access_token) throw new Error('Spotify did not accept the saved sign-in. Run: otso auth spotify');
    // Spotify may hand out a new refresh token; the old one then stops working.
    if (t.refresh_token && t.refresh_token !== credentials.refreshToken) {
      await saveCredentials('spotify', { ...credentials, refreshToken: t.refresh_token });
    }
    const after = Number(store.getState('recent_after')) || 0;
    const p = new URLSearchParams({ limit: '50' });
    if (after) p.set('after', String(after));
    const res = await getJson<any>(`${API}/me/player/recently-played?${p}`, { headers: { Authorization: `Bearer ${t.access_token}` } });
    const items: any[] = res?.items ?? [];
    const stats: RunStats = {};
    addStats(stats, 'events', store.upsert(EVENTS_TABLE, items.filter((i) => i.track && i.played_at).map(recentRow)));
    const newest = Math.max(after, ...items.map((i) => Date.parse(i.played_at) || 0));
    if (newest) store.setState('recent_after', String(newest));
    log(`${items.length} recent plays${items.length === 50 ? ' (the most Spotify keeps; sync more often to miss none)' : ''}`);
    return stats;
  },

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
