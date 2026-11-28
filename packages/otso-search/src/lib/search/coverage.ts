import { statSync } from 'fs';
import { DB_PATH, getDb } from './fts5';

/**
 * Per-source activity by day, for the coverage view. Days are counted from the
 * Unix epoch in UTC. Each source's days are delta-encoded (the first value is
 * the day itself, the rest are the distance from the previous active day) so
 * a long archive stays small on the wire.
 */
export interface CoverageSource {
  source: string;
  /** Records with a timestamp */
  total: number;
  /** Records without one (ts = 0); they can't be placed on the timeline */
  undated: number;
  firstDay: number;
  lastDay: number;
  /** Delta-encoded active days */
  days: number[];
  /** Record count for each active day, in the same order */
  counts: number[];
}

export interface CoverageResponse {
  sources: CoverageSource[];
  minDay: number;
  maxDay: number;
  /** Today, in the same day numbering */
  today: number;
  /** When the server built this from the index (ms since epoch) */
  builtAt: number;
}

let cached: { key: string; data: CoverageResponse } | null = null;

// The index changes only when the indexer runs, so rebuild when the database
// or its write-ahead log changes on disk.
function cacheKey(): string {
  const parts: string[] = [];
  for (const file of [DB_PATH, `${DB_PATH}-wal`]) {
    try {
      const s = statSync(file);
      parts.push(`${s.mtimeMs}:${s.size}`);
    } catch {
      parts.push('-');
    }
  }
  return parts.join('|');
}

export function getCoverage(): CoverageResponse {
  const key = cacheKey();
  if (cached && cached.key === key) return cached.data;

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT source, ts / 86400 AS day, COUNT(*) AS n
       FROM search_entry_map
       WHERE ts > 0
       GROUP BY source, day
       ORDER BY source, day`
    )
    .raw()
    .all() as [string, number, number][];

  const undatedRows = db
    .prepare(`SELECT source, COUNT(*) FROM search_entry_map WHERE ts <= 0 GROUP BY source`)
    .raw()
    .all() as [string, number][];
  const undated = new Map(undatedRows);

  const bySource = new Map<string, CoverageSource>();
  let prevDay = 0;
  for (const [source, day, n] of rows) {
    let s = bySource.get(source);
    if (!s) {
      s = { source, total: 0, undated: undated.get(source) ?? 0, firstDay: day, lastDay: day, days: [], counts: [] };
      bySource.set(source, s);
      s.days.push(day);
    } else {
      s.days.push(day - prevDay);
    }
    prevDay = day;
    s.counts.push(n);
    s.total += n;
    s.lastDay = day;
  }

  // Sources whose records are all undated still get a (blank) lane
  for (const [source, n] of undated) {
    if (!bySource.has(source)) {
      bySource.set(source, { source, total: 0, undated: n, firstDay: 0, lastDay: 0, days: [], counts: [] });
    }
  }

  const sources = [...bySource.values()].sort((a, b) => b.total - a.total);
  const dated = sources.filter((s) => s.days.length > 0);
  const today = Math.floor(Date.now() / 86_400_000);
  const data: CoverageResponse = {
    sources,
    minDay: dated.length ? Math.min(...dated.map((s) => s.firstDay)) : today,
    maxDay: dated.length ? Math.max(...dated.map((s) => s.lastDay)) : today,
    today,
    builtAt: Date.now()
  };
  cached = { key, data };
  return data;
}
