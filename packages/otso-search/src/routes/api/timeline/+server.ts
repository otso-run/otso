import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile } from 'fs/promises';
import { join } from 'path';

const DATA_DIR = process.env.CHRONICLE_DATA_DIR || join(process.cwd(), '../../data');
const TIMELINE_PATH = join(DATA_DIR, 'search/timeline.json');

interface TimelineData {
  buckets: { month: string; source: string; count: number }[];
  minMonth: string;
  maxMonth: string;
  sourceTotals: { source: string; count: number }[];
}

// Cache for pre-computed timeline
let cachedTimeline: TimelineData | null = null;
let cacheTime = 0;
const CACHE_TTL = 60_000; // 1 minute

async function getPrecomputedTimeline(): Promise<TimelineData | null> {
  const now = Date.now();
  if (cachedTimeline && now - cacheTime < CACHE_TTL) {
    return cachedTimeline;
  }

  try {
    const data = await readFile(TIMELINE_PATH, 'utf-8');
    cachedTimeline = JSON.parse(data);
    cacheTime = now;
    return cachedTimeline;
  } catch {
    return null;
  }
}

export const GET: RequestHandler = async ({ url }) => {
  const query = url.searchParams.get('q') ?? '';
  const sourcesParam = url.searchParams.get('sources');
  const sources = sourcesParam ? sourcesParam.split(',').filter(Boolean) : undefined;
  console.log(`[timeline] q="${query}" sources=${sources?.join(',') || 'all'}`);

  const start = performance.now();

  // Use pre-computed timeline when no query (even with source filters)
  if (!query) {
    const timeline = await getPrecomputedTimeline();
    if (timeline) {
      let filteredTimeline = timeline;

      // Filter by sources if specified
      if (sources && sources.length > 0) {
        const sourceSet = new Set(sources);
        filteredTimeline = {
          buckets: timeline.buckets.filter(b => sourceSet.has(b.source)),
          minMonth: timeline.minMonth, // Keep global range
          maxMonth: timeline.maxMonth,
          sourceTotals: timeline.sourceTotals.filter(s => sourceSet.has(s.source))
        };
      }

      const time = performance.now() - start;
      const response = {
        ...filteredTimeline,
        time: Math.round(time * 100) / 100,
        backend: 'precomputed-filtered'
      };
      console.log(`[timeline] response: ${JSON.stringify(response).length} bytes`);
      return json(response);
    }
  }

  // Fall back to Meilisearch only for text queries
  const { getSearchBackend } = await import('$lib/search');
  const backend = await getSearchBackend();
  const timeline = await backend.getTimeline(query || undefined, sources);
  const time = performance.now() - start;

  return json({
    ...timeline,
    time: Math.round(time * 100) / 100,
    backend: backend.name
  });
};
