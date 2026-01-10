import { FTS5Backend } from './fts5';
import { MeilisearchBackend } from './meilisearch';
import type { SearchBackend } from './types';

export type { SearchBackend, SearchResponse, StatsResponse, SearchResult } from './types';

let fts5Backend: FTS5Backend | null = null;
let meilisearchBackend: MeilisearchBackend | null = null;
let cachedBackend: SearchBackend | null = null;
let lastCheck = 0;
const CHECK_INTERVAL = 30_000; // Re-check every 30 seconds

function getFTS5Backend(): FTS5Backend {
  if (!fts5Backend) {
    fts5Backend = new FTS5Backend();
  }
  return fts5Backend;
}

function getMeilisearchBackend(): MeilisearchBackend {
  if (!meilisearchBackend) {
    meilisearchBackend = new MeilisearchBackend();
  }
  return meilisearchBackend;
}

/**
 * Get the best available search backend.
 * Prefers Meilisearch if available, falls back to FTS5.
 * Caches the result for CHECK_INTERVAL ms to avoid repeated health checks.
 */
export async function getSearchBackend(): Promise<SearchBackend> {
  const now = Date.now();

  // Use cached backend if recent
  if (cachedBackend && now - lastCheck < CHECK_INTERVAL) {
    return cachedBackend;
  }

  // Try Meilisearch first
  const meili = getMeilisearchBackend();
  if (await meili.isAvailable()) {
    cachedBackend = meili;
    lastCheck = now;
    return meili;
  }

  // Fall back to FTS5
  cachedBackend = getFTS5Backend();
  lastCheck = now;
  return cachedBackend;
}

/**
 * Force a specific backend (useful for testing)
 */
export function getSpecificBackend(name: 'fts5' | 'meilisearch'): SearchBackend {
  return name === 'meilisearch' ? getMeilisearchBackend() : getFTS5Backend();
}

/**
 * Clear cached backend (forces re-check on next call)
 */
export function clearBackendCache(): void {
  cachedBackend = null;
  lastCheck = 0;
}
