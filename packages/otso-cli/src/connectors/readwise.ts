import { EVENTS_TABLE, type TableDef } from '../core/chronicle.js';
import { getJson, request } from '../core/http.js';
import type { Connector, RunStats } from './types.js';
import { addStats, htmlToText } from './util.js';

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

/**
 * Reader article bodies, one row per document, kept apart from the events
 * row so the metadata queries stay small. html is Reader's cleaned article
 * HTML (withHtmlContent=true); text is that HTML as plain text, which the
 * sources.toml query indexes for full-text search.
 */
export const READER_CONTENT_TABLE: TableDef = {
  name: 'reader_content',
  key: 'source_id',
  columns: ['source_id', 'html', 'text', 'word_count', 'updated_at'],
};

/** Reader locations we sync. "feed" (RSS items) is left out on purpose. */
export const READER_LOCATIONS = ['new', 'later', 'shortlist', 'archive'] as const;

/**
 * Bump when Reader rows gain fields that older syncs didn't store; the next
 * sync then re-fetches every document once (a backfill) instead of only the
 * ones updated since the last run.
 */
export const READER_SCHEMA_VERSION = '2';

/** Reader's list endpoint allows 20 requests a minute; stay under it. */
export const readerPacing = { minIntervalMs: 3100 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isDoc = (d: any) => !d.parent_id && d.location !== 'feed'; // skip highlights/notes and RSS items

/** Reader documents (saved articles, PDFs, …), keyed by Reader's own id. */
export function readerRows(docs: any[]) {
  return docs.filter(isDoc).map((d) => ({
    source_id: d.id,
    type: 'ReadAction',
    source: 'readwise',
    object: {
      '@type': 'Article',
      name: d.title,
      url: d.source_url || d.url,
      readerUrl: d.url || undefined,
      author: d.author || undefined,
      category: d.category,
      summary: d.summary || undefined,
      site_name: d.site_name || undefined,
      word_count: d.word_count ?? undefined,
      reading_time: d.reading_time || undefined,
      published_date: d.published_date || undefined,
      image_url: d.image_url || undefined,
      origin: d.source || undefined,
    },
    result: {
      location: d.location,
      readingProgress: d.reading_progress,
      tags: Object.keys(d.tags ?? {}),
      notes: d.notes || undefined,
      savedAt: d.saved_at || undefined,
      firstOpenedAt: d.first_opened_at || undefined,
      lastOpenedAt: d.last_opened_at || undefined,
      lastMovedAt: d.last_moved_at || undefined,
      updatedAt: d.updated_at || undefined,
    },
    startTime: d.saved_at || d.created_at,
    endTime: d.last_opened_at || null,
  }));
}

/** Article bodies for documents that came with html_content. */
export function readerContentRows(docs: any[]) {
  return docs
    .filter((d) => isDoc(d) && typeof d.html_content === 'string' && d.html_content.trim())
    .map((d) => ({
      source_id: d.id,
      html: d.html_content,
      text: htmlToText(d.html_content),
      word_count: d.word_count ?? null,
      updated_at: d.updated_at ?? null,
    }));
}

export const readwise: Connector = {
  id: 'readwise',
  displayName: 'Readwise',
  description: 'Highlights and Reader articles',
  kind: 'api',
  dbPath: 'readwise/chronicle/chronicle.db',
  tables: [EVENTS_TABLE, READER_CONTENT_TABLE],

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

    // Reader documents, one location at a time so RSS feed items (often far
    // more numerous) are never downloaded. A schema bump forces one full pass.
    const backfill = store.getState('readerSchemaVersion') !== READER_SCHEMA_VERSION;
    const readerSince = full || backfill ? null : store.getState('readerUpdatedAfter');
    if (backfill && !full) log('Fetching every Reader document once to store article text');
    let docs = 0;
    let bodies = 0;
    let lastRequest = 0;
    for (const location of READER_LOCATIONS) {
      cursor = null;
      do {
        const params = new URLSearchParams({ location, withHtmlContent: 'true' });
        if (readerSince) params.set('updatedAfter', readerSince);
        if (cursor) params.set('pageCursor', cursor);
        const wait = lastRequest + readerPacing.minIntervalMs - Date.now();
        if (wait > 0) await sleep(wait);
        lastRequest = Date.now();
        const page: any = await getJson(`https://readwise.io/api/v3/list/?${params}`, {
          headers: auth(credentials.accessToken),
        });
        const results = page.results ?? [];
        const rows = readerRows(results);
        docs += rows.length;
        addStats(stats, 'events', store.upsert(EVENTS_TABLE, rows));
        const content = readerContentRows(results);
        bodies += content.length;
        addStats(stats, 'reader_content', store.upsert(READER_CONTENT_TABLE, content));
        cursor = page.nextPageCursor ?? null;
      } while (cursor);
      if (backfill || full) log(`  ${location}: ${docs} Reader documents so far`);
    }
    store.setState('readerUpdatedAfter', startedAt);
    store.setState('readerSchemaVersion', READER_SCHEMA_VERSION);
    log(`${docs} new or changed Reader documents (${bodies} with article text)`);
    return stats;
  },
};
