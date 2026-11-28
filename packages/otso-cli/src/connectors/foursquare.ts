import { EVENTS_TABLE } from '../core/chronicle.js';
import { getJson } from '../core/http.js';
import { redirectUri, waitForAuthorizationCode } from '../core/oauth.js';
import { fromUnixSeconds } from '../core/time.js';
import type { Connector, RunStats } from './types.js';
import { addStats } from './util.js';

/**
 * Swarm / Foursquare check-ins through the Foursquare v2 API.
 *
 * Signing in needs a Foursquare developer app (its client id and secret)
 * whose redirect URI is http://127.0.0.1:8765/callback; `otso auth
 * foursquare` opens the consent page and keeps the token it gets back.
 *
 * The first sync pages back through every check-in (250 at a time); later
 * ones ask only for check-ins after the newest one stored.
 *
 * The one-time Chronicle import kept check-ins without an id. A check-in it
 * already has (same moment) is replaced by the synced copy, so nothing is
 * stored twice.
 */

const API = 'https://api.foursquare.com/v2';
const VERSION = '20240101';
const PAGE = 250;

export function checkinRow(c: any) {
  const v = c.venue ?? {};
  const loc = v.location ?? {};
  return {
    source_id: `checkin-${c.id}`,
    type: 'CheckInAction',
    source: 'foursquare',
    object: {
      name: v.name ?? c.shout ?? 'Check-in',
      address: { streetAddress: loc.address, addressLocality: [loc.city, loc.state, loc.country].filter(Boolean).join(', ') || undefined },
      geo: loc.lat != null ? { latitude: loc.lat, longitude: loc.lng } : undefined,
      category: v.categories?.find((x: any) => x.primary)?.name ?? v.categories?.[0]?.name,
      url: v.id ? `https://foursquare.com/v/${v.id}` : undefined,
      shout: c.shout || undefined,
    },
    end_time: fromUnixSeconds(c.createdAt),
  };
}

/** Chronicle wrote "2009-08-31 14:42:37 -0400". */
function legacySeconds(s: string | null): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/);
  const t = Date.parse(m ? `${m[1]}T${m[2]}${m[3]}:${m[4]}` : s);
  return Number.isFinite(t) ? Math.round(t / 1000) : null;
}

export const foursquare: Connector = {
  id: 'foursquare',
  displayName: 'Foursquare / Swarm',
  description: 'Check-ins',
  kind: 'api',
  dbPath: 'foursquare/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],

  auth: {
    setupUrl: 'https://foursquare.com/developers/apps',
    instructions: [
      'Create an app at foursquare.com/developers/apps with redirect URI http://127.0.0.1:8765/callback.',
      'Enter its client id and secret; your browser then opens to approve access.',
    ],
    fields: [
      { name: 'clientId', label: 'Client ID' },
      { name: 'clientSecret', label: 'Client secret', secret: true },
    ],
    async verify(creds) {
      if (!creds.accessToken) {
        const authorize = new URL('https://foursquare.com/oauth2/authenticate');
        authorize.search = new URLSearchParams({ client_id: creds.clientId, response_type: 'code', redirect_uri: redirectUri() }).toString();
        const code = await waitForAuthorizationCode({ authorizeUrl: authorize.toString(), log: console.log });
        const p = new URLSearchParams({
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri(),
          code,
        });
        const token = await getJson<any>(`https://foursquare.com/oauth2/access_token?${p}`);
        if (!token?.access_token) throw new Error('Foursquare did not return an access token');
        creds.accessToken = token.access_token;
      }
      const me = await getJson<any>(`${API}/users/self?oauth_token=${encodeURIComponent(creds.accessToken)}&v=${VERSION}`);
      const u = me?.response?.user;
      if (!u) throw new Error('Foursquare did not accept the token');
      return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.handle || 'Foursquare';
    },
  },

  async sync({ store, credentials, full, log }) {
    const token = encodeURIComponent(credentials.accessToken ?? '');
    if (!token) throw new Error('Not signed in to Foursquare. Run: otso auth foursquare');
    const after = full ? null : Number(store.getState('afterTimestamp')) || null;
    const stats: RunStats = {};
    let newest = after ?? 0;
    let read = 0;
    const times = new Set<number>();

    for (let offset = 0; ; offset += PAGE) {
      const p = new URLSearchParams({ oauth_token: decodeURIComponent(token), v: VERSION, limit: String(PAGE), offset: String(offset), sort: 'newestfirst' });
      if (after) p.set('afterTimestamp', String(after));
      const res = await getJson<any>(`${API}/users/self/checkins?${p}`);
      const items: any[] = res?.response?.checkins?.items ?? [];
      for (const c of items) {
        newest = Math.max(newest, c.createdAt ?? 0);
        times.add(c.createdAt);
      }
      addStats(stats, 'events', store.upsert(EVENTS_TABLE, items.map(checkinRow)));
      read += items.length;
      if (offset && offset % 2500 === 0) log(`${read.toLocaleString()} check-ins so far`);
      if (items.length < PAGE) break;
    }

    // Chronicle-era rows (no id) for check-ins we now have properly.
    const legacy = (store.db.query(`SELECT rowid AS r, end_time FROM events WHERE source_id IS NULL`).all() as { r: number; end_time: string | null }[]).filter(
      (row) => times.has(legacySeconds(row.end_time) ?? -1)
    );
    const del = store.db.prepare('DELETE FROM events WHERE rowid = ?');
    store.db.transaction(() => legacy.forEach((row) => del.run(row.r)))();

    if (newest) store.setState('afterTimestamp', String(newest));
    log(`${read.toLocaleString()} check-ins${after ? ' since last sync' : ''}${legacy.length ? `, ${legacy.length.toLocaleString()} older imported copies replaced` : ''}`);
    return stats;
  },
};
