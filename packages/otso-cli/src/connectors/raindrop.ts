import { EVENTS_TABLE } from '../core/chronicle.js';
import { getJson } from '../core/http.js';
import { iso } from '../core/time.js';
import type { Connector, RunStats } from './types.js';
import { addStats } from './util.js';

/**
 * Raindrop.io bookmarks, with their notes, tags, collection and highlights.
 *
 * The first sync pages through every bookmark (collection 0 is "all except
 * trash"). Raindrop can sort by last update, so later syncs read newest
 * changes first and stop at the first bookmark not changed since the
 * previous sync. Bookmarks moved to the trash are removed.
 */

const API = 'https://api.raindrop.io/rest/v1';
const PER_PAGE = 50;
const TRASH = -99;
const CURSOR = 'lastUpdate';

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

/** Map collection ids to their titles, nested ones included. */
async function collectionNames(token: string): Promise<Map<number, string>> {
  const names = new Map<number, string>([[-1, 'Unsorted']]);
  for (const path of ['/collections', '/collections/childrens']) {
    const res = await getJson<any>(`${API}${path}`, auth(token));
    for (const c of res?.items ?? []) names.set(c._id, c.title);
  }
  return names;
}

export function raindropRows(items: any[], collections: Map<number, string> = new Map()) {
  return items.map((r) => {
    const collectionId = r.collection?.$id ?? r.collectionId;
    const highlights = (r.highlights ?? []).map((h: any) => ({ text: h.text, note: h.note || undefined, created: h.created }));
    return {
      source_id: `raindrop-${r._id}`,
      type: 'BookmarkAction',
      source: 'raindrop',
      object: {
        name: r.title || r.link,
        description: r.excerpt || '',
        url: r.link,
        note: r.note || undefined,
        keywords: r.tags ?? [],
        kind: r.type,
        domain: r.domain,
        highlights,
      },
      result: { name: collections.get(collectionId) ?? null, id: collectionId ?? null },
      end_time: iso(r.created),
      endTime: iso(r.lastUpdate),
      actionStatus: r.important ? 'favorite' : null,
    };
  });
}

export const raindrop: Connector = {
  id: 'raindrop',
  displayName: 'Raindrop.io',
  description: 'Bookmarks, notes and highlights',
  kind: 'api',
  dbPath: 'raindrop/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],

  auth: {
    setupUrl: 'https://app.raindrop.io/settings/integrations',
    instructions: [
      'Open app.raindrop.io/settings/integrations and click "Create new app" (any name).',
      'Open the app and click "Create test token", then copy it.',
    ],
    fields: [{ name: 'accessToken', label: 'Test token', secret: true }],
    async verify(creds) {
      const res = await getJson<any>(`${API}/user`, auth(creds.accessToken));
      if (!res?.result) throw new Error('Raindrop did not accept the token');
      return res.user?.fullName || res.user?.name || 'Raindrop';
    },
  },

  async sync({ store, credentials, full, log }) {
    const token = credentials.accessToken;
    const since = full ? null : store.getState(CURSOR);
    const collections = await collectionNames(token);
    const stats: RunStats = {};
    let newest = since ?? '';
    let read = 0;

    pages: for (let page = 0; ; page++) {
      const p = new URLSearchParams({ perpage: String(PER_PAGE), page: String(page), sort: '-lastUpdate' });
      const res = await getJson<any>(`${API}/raindrops/0?${p}`, auth(token));
      const items: any[] = res?.items ?? [];
      const fresh = since ? items.filter((r) => (r.lastUpdate ?? '') > since) : items;
      for (const r of fresh) if ((r.lastUpdate ?? '') > newest) newest = r.lastUpdate;
      addStats(stats, 'events', store.upsert(EVENTS_TABLE, raindropRows(fresh, collections)));
      read += fresh.length;
      if (page % 20 === 19) log(`${read.toLocaleString()} bookmarks so far`);
      // Sorted newest change first: once a page reaches unchanged ones, we're done.
      if (items.length < PER_PAGE || fresh.length < items.length) break pages;
    }

    // Bookmarks in the trash were deleted in Raindrop.
    const trashed: string[] = [];
    for (let page = 0; ; page++) {
      const p = new URLSearchParams({ perpage: String(PER_PAGE), page: String(page) });
      const res = await getJson<any>(`${API}/raindrops/${TRASH}?${p}`, auth(token));
      const items: any[] = res?.items ?? [];
      trashed.push(...items.map((r) => `raindrop-${r._id}`));
      if (items.length < PER_PAGE) break;
    }
    const removed = store.deleteKeys(EVENTS_TABLE, trashed);

    // Only advance the cursor once every changed bookmark is stored.
    if (newest) store.setState(CURSOR, newest);
    log(`${read.toLocaleString()} bookmarks${since ? ' changed since last sync' : ''}${removed ? `, ${removed} in the trash removed` : ''}`);
    return stats;
  },
};
