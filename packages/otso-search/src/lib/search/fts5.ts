import Database from 'better-sqlite3';
import path from 'path';
import type { SearchBackend, SearchResponse, StatsResponse, TimelineResponse, DateRange, DocumentResponse } from './types';

// Path to Otso's FTS5 search database
// In dev: cwd is packages/otso-search, so ../../data/otso/search.db
// In production: adjust as needed
const DB_PATH = path.join(process.cwd(), '../../data/otso/search.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma('journal_mode = WAL');
    db.pragma('mmap_size = 268435456');
    db.pragma('cache_size = -32000');
  }
  return db;
}

export class FTS5Backend implements SearchBackend {
  readonly name = 'fts5';

  async search(query: string, limit = 100, sources?: string[], offset = 0, dateRange?: DateRange): Promise<SearchResponse> {
    const database = getDb();

    const trimmedQuery = query.trim();
    const hasQuery = trimmedQuery.length > 0;

    // Build filters (shared between FTS and non-FTS paths)
    const filters: string[] = [];
    const params: (string | number)[] = [];

    if (sources && sources.length > 0) {
      const placeholders = sources.map(() => '?').join(',');
      filters.push(`source IN (${placeholders})`);
      params.push(...sources);
    }

    if (dateRange) {
      // Convert YYYY-MM to unix timestamps
      const [startYear, startMonth] = dateRange.start.split('-').map(Number);
      const startTs = Math.floor(new Date(Date.UTC(startYear, startMonth - 1, 1)).getTime() / 1000);
      const [endYear, endMonth] = dateRange.end.split('-').map(Number);
      const endTs = Math.floor(new Date(Date.UTC(endYear, endMonth, 1)).getTime() / 1000) - 1;
      filters.push(`ts >= ? AND ts <= ?`);
      params.push(startTs, endTs);
    }

    let results: SearchResponse['results'];
    let facets: SearchResponse['facets'];

    if (hasQuery) {
      // FTS5 search path - use MATCH for full-text search
      const ftsQuery = trimmedQuery.split(/\s+/).map(term => `${term}*`).join(' ');
      const ftsParams = [ftsQuery, ...params, limit, offset];
      const filterClause = filters.length > 0 ? 'AND ' + filters.join(' AND ') : '';

      const stmt = database.prepare(`
        SELECT
          source,
          entry_type,
          title,
          snippet(search_entries, 1, '<mark>', '</mark>', '...', 32) as snippet,
          ts,
          content_rowid as id,
          event_id,
          external_id,
          url,
          category,
          bm25(search_entries) as rank
        FROM search_entries
        WHERE search_entries MATCH ?
        ${filterClause}
        ORDER BY rank
        LIMIT ? OFFSET ?
      `);

      results = stmt.all(...ftsParams) as SearchResponse['results'];

      // Get facet counts for this query
      const facetStmt = database.prepare(`
        SELECT
          source,
          COUNT(*) as count
        FROM search_entries
        WHERE search_entries MATCH ?
        GROUP BY source
        ORDER BY count DESC
      `);

      facets = facetStmt.all(ftsQuery) as SearchResponse['facets'];
    } else {
      // No query - return recent entries sorted by timestamp (browsing mode)
      const filterClause = filters.length > 0 ? 'WHERE ' + filters.join(' AND ') : '';
      const browseParams = [...params, limit, offset];

      const stmt = database.prepare(`
        SELECT
          source,
          entry_type,
          title,
          substr(content, 1, 200) as snippet,
          ts,
          content_rowid as id,
          event_id,
          external_id,
          url,
          category,
          0 as rank
        FROM search_entries
        ${filterClause}
        ORDER BY ts DESC
        LIMIT ? OFFSET ?
      `);

      results = stmt.all(...browseParams) as SearchResponse['results'];

      // Get facet counts for all entries (no query filter)
      const facetStmt = database.prepare(`
        SELECT
          source,
          COUNT(*) as count
        FROM search_entries
        ${filterClause}
        GROUP BY source
        ORDER BY count DESC
      `);

      facets = facetStmt.all(...params) as SearchResponse['facets'];
    }

    // Calculate total for pagination
    const total = facets.reduce((sum, f) => sum + f.count, 0);

    return { results, facets, total };
  }

  async getStats(): Promise<StatsResponse> {
    const database = getDb();

    // Use the search_entry_map table for efficient counting
    const total = database.prepare('SELECT COUNT(*) as count FROM search_entry_map').get() as { count: number };
    const sources = database.prepare(`
      SELECT source as name, COUNT(*) as count
      FROM search_entry_map
      GROUP BY source
      ORDER BY count DESC
    `).all() as { name: string; count: number }[];

    return { total: total.count, sources };
  }

  async getTimeline(query?: string, sources?: string[]): Promise<TimelineResponse> {
    const database = getDb();

    // Build WHERE clause based on query and sources
    const whereClauses: string[] = [];
    const params: (string | number)[] = [];

    if (query?.trim()) {
      // Use FTS5 for search queries
      const ftsQuery = query.trim().split(/\s+/).map(term => `${term}*`).join(' ');
      whereClauses.push('search_entries MATCH ?');
      params.push(ftsQuery);
    }

    if (sources && sources.length > 0) {
      const placeholders = sources.map(() => '?').join(',');
      whereClauses.push(`source IN (${placeholders})`);
      params.push(...sources);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Use the month column directly from Otso schema (pre-computed)
    const stmt = database.prepare(`
      SELECT
        month,
        source,
        COUNT(*) as count
      FROM search_entries
      ${whereClause}
      GROUP BY month, source
      ORDER BY month ASC
    `);

    const buckets = stmt.all(...params) as { month: string; source: string; count: number }[];

    // Get min/max months
    const months = buckets.map(b => b.month).filter(Boolean);
    const uniqueMonths = [...new Set(months)].sort();
    const minMonth = uniqueMonths.length > 0 ? uniqueMonths[0] : '';
    const maxMonth = uniqueMonths.length > 0 ? uniqueMonths[uniqueMonths.length - 1] : '';

    // Get total counts per source
    const totalsStmt = database.prepare(`
      SELECT source, COUNT(*) as count
      FROM search_entries
      ${whereClause}
      GROUP BY source
      ORDER BY count DESC
    `);

    const sourceTotals = totalsStmt.all(...params) as { source: string; count: number }[];

    return { buckets, minMonth, maxMonth, sourceTotals };
  }

  async getDocument(id: number): Promise<DocumentResponse | null> {
    try {
      const database = getDb();
      const doc = database.prepare(`
        SELECT
          content_rowid as id,
          event_id,
          source,
          entry_type,
          action_type,
          object_type,
          title,
          content,
          ts,
          external_id,
          url,
          visibility,
          category,
          year,
          month
        FROM search_entries
        WHERE content_rowid = ?
      `).get(id) as DocumentResponse | undefined;
      return doc || null;
    } catch {
      return null;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const database = getDb();
      database.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }
}
