import { EVENTS_TABLE } from '../core/chronicle.js';
import { getJson, request } from '../core/http.js';
import type { Connector, RunStats } from './types.js';
import { addStats } from './util.js';

/**
 * Readwise highlights (v2 export API) and Reader documents (v3 list API:
 * saved articles, PDFs, etc., minus RSS feed items). After the first full
 * pull, each only asks for items updated since the previous sync.
 */

const API = 'https://readwise.io/api/v2';
const auth = (token: string) => ({ Authorization: `Token ${token}` });

export function readwiseRows(books: any[]) {
  const rows = [];
  for (const book of books) {
    for (const h of book.highlights ?? []) {
      if (h.is_deleted) continue;
      rows.push({
        source_id: `highlight-${h.id}`,
        type: 'HighlightAction',
        source: 'readwise',
        object: {
          name: h.text,
          url: h.url || book.source_url || h.readwise_url || book.readwise_url || null,
          note: h.note || undefined,
          tags: (h.tags ?? []).map((t: any) => t.name),
        },
        result: {
          name: book.readable_title || book.title,
          author: book.author,
          category: book.category,
        },
        startTime: h.highlighted_at || h.created_at,
        endTime: h.updated_at,
      });
    }
  }
  return rows;
}

/** Reader documents (saved articles, PDFs, …), keyed by Reader's own id. */
export function readerRows(docs: any[]) {
  return docs
    .filter((d) => !d.parent_id && d.location !== 'feed') // skip highlights/notes and RSS items
    .map((d) => ({
      source_id: d.id,
      type: 'ReadAction',
      source: 'readwise',
      object: {
        '@type': 'Article',
        name: d.title,
        url: d.source_url || d.url,
        author: d.author,
        category: d.category,
        summary: d.summary,
        site_name: d.site_name,
        word_count: d.word_count,
      },
      result: {
        location: d.location,
        readingProgress: d.reading_progress,
        tags: Object.keys(d.tags ?? {}),
      },
      startTime: d.saved_at || d.created_at,
      endTime: d.last_opened_at || null,
    }));
}

export const readwise: Connector = {
  id: 'readwise',
  displayName: 'Readwise',
  description: 'Highlights and Reader articles',
  kind: 'api',
  dbPath: 'readwise/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],

  auth: {
    setupUrl: 'https://readwise.io/access_token',
    instructions: ['Open readwise.io/access_token and copy your access token.'],
    fields: [{ name: 'accessToken', label: 'Access token', secret: true }],
    async verify(creds) {
      const res = await request(`${API}/auth/`, { headers: auth(creds.accessToken) });
      if (res.status !== 204) throw new Error(`Readwise rejected the token (HTTP ${res.status})`);
      return 'Readwise account';
    },
  },

  async sync({ store, credentials, full, log }) {
    const stats: RunStats = {};
    const startedAt = new Date().toISOString();
    const since = full ? null : store.getState('updatedAfter');
    if (since) log(`Fetching highlights updated since ${since}`);

    let cursor: string | null = null;
    let books = 0;
    do {
      const params = new URLSearchParams();
      if (since) params.set('updatedAfter', since);
      if (cursor) params.set('pageCursor', cursor);
      const page: any = await getJson(`${API}/export/?${params}`, { headers: auth(credentials.accessToken) });
      books += page.results?.length ?? 0;
      addStats(stats, 'events', store.upsert(EVENTS_TABLE, readwiseRows(page.results ?? [])));
      cursor = page.nextPageCursor ?? null;
    } while (cursor);

    store.setState('updatedAfter', startedAt);
    log(`${books} books with new or changed highlights`);

    // Reader documents
    const readerSince = full ? null : store.getState('readerUpdatedAfter');
    let docs = 0;
    cursor = null;
    do {
      const params = new URLSearchParams();
      if (readerSince) params.set('updatedAfter', readerSince);
      if (cursor) params.set('pageCursor', cursor);
      const page: any = await getJson(`https://readwise.io/api/v3/list/?${params}`, {
        headers: auth(credentials.accessToken),
      });
      const rows = readerRows(page.results ?? []);
      docs += rows.length;
      addStats(stats, 'events', store.upsert(EVENTS_TABLE, rows));
      cursor = page.nextPageCursor ?? null;
    } while (cursor);
    store.setState('readerUpdatedAfter', startedAt);
    log(`${docs} new or changed Reader documents`);
    return stats;
  },
};
