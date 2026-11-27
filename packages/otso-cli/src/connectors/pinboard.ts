import { EVENTS_TABLE } from '../core/chronicle.js';
import { getJson } from '../core/http.js';
import { iso } from '../core/time.js';
import type { Connector, RunStats } from './types.js';
import { addStats, shortHash } from './util.js';

/**
 * Pinboard bookmarks, either through the API (token) or the JSON export.
 * Both return the same shape, so they share pinboardRows().
 *
 * The API's posts/all is rate limited to once every five minutes, so a sync
 * first asks posts/update and skips the download when nothing has changed.
 */

const API = 'https://api.pinboard.in/v1';

export function pinboardRows(posts: any[]) {
  return posts.map((p) => {
    const tags = Array.isArray(p.tags) ? p.tags.join(' ') : (p.tags ?? '');
    return {
      source_id: `bookmark-${p.hash || shortHash(p.href)}`,
      type: 'BookmarkAction',
      source: 'pinboard',
      object: {
        name: p.description || p.href,
        description: p.extended || '',
        url: p.href,
        keywords: tags ? tags.split(/\s+/) : [],
        shared: p.shared !== 'no',
      },
      result: { name: tags },
      end_time: iso(p.time),
      actionStatus: p.toread === 'yes' ? 'toread' : null,
    };
  });
}

export const pinboard: Connector = {
  id: 'pinboard',
  displayName: 'Pinboard',
  description: 'Bookmarks',
  kind: 'api',
  dbPath: 'pinboard/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],

  auth: {
    setupUrl: 'https://pinboard.in/settings/password',
    instructions: ['Open pinboard.in/settings/password and copy the API token (it looks like username:ABC123).'],
    fields: [{ name: 'accessToken', label: 'API token', secret: true, placeholder: 'username:XXXXXXXX' }],
    async verify(creds) {
      const url = `${API}/user/api_token/?format=json&auth_token=${encodeURIComponent(creds.accessToken)}`;
      const res = await getJson<any>(url);
      if (!res?.result) throw new Error('Pinboard did not accept the token');
      return creds.accessToken.split(':')[0];
    },
  },

  exportGuide: {
    url: 'https://pinboard.in/export/',
    steps: ['Open pinboard.in/export', 'Click "JSON" to download all bookmarks'],
    filePatterns: ['pinboard_export*.json', 'pinboard*.json'],
  },

  async sync({ store, credentials, full, log }) {
    const token = encodeURIComponent(credentials.accessToken);
    const update = await getJson<any>(`${API}/posts/update?format=json&auth_token=${token}`);
    if (!full && update?.update_time && store.getState('update_time') === update.update_time) {
      log('No bookmarks changed since last sync');
      return {};
    }
    const posts = await getJson<any[]>(`${API}/posts/all?format=json&auth_token=${token}`);
    const stats: RunStats = {};
    addStats(stats, 'events', store.upsert(EVENTS_TABLE, pinboardRows(posts)));
    if (update?.update_time) store.setState('update_time', update.update_time);
    log(`${posts.length} bookmarks`);
    return stats;
  },

  async ingest({ store, log }, archive) {
    const stats: RunStats = {};
    for (const file of archive.find(/\.json$/i)) {
      const posts = await archive.readJson<any[]>(file);
      if (!Array.isArray(posts) || !posts[0]?.href) continue;
      addStats(stats, 'events', store.upsert(EVENTS_TABLE, pinboardRows(posts)));
      log(`${file}: ${posts.length} bookmarks`);
    }
    return stats;
  },
};
