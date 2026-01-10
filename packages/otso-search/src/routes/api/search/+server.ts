import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSearchBackend } from '$lib/search';
import type { DateRange } from '$lib/search/types';

export const GET: RequestHandler = async ({ url }) => {
  const query = url.searchParams.get('q') ?? '';
  const limit = parseInt(url.searchParams.get('limit') ?? '100');
  const offset = parseInt(url.searchParams.get('offset') ?? '0');
  console.log(`[search] q="${query}" limit=${limit} offset=${offset}`);
  const sourcesParam = url.searchParams.get('sources');
  const sources = sourcesParam ? sourcesParam.split(',').filter(Boolean) : undefined;
  const recent = url.searchParams.get('recent') === '1';

  // Parse date range if provided (format: YYYY-MM)
  const startMonth = url.searchParams.get('startMonth');
  const endMonth = url.searchParams.get('endMonth');
  const dateRange: DateRange | undefined = startMonth && endMonth
    ? { start: startMonth, end: endMonth }
    : undefined;

  // Allow empty query for browse mode (sources specified), recent mode, or date range mode
  if (!query.trim() && !recent && !dateRange && (!sources || sources.length === 0)) {
    return json({ results: [], facets: [], query: '', time: 0, backend: 'none', hasMore: false });
  }

  const backend = await getSearchBackend();
  const start = performance.now();
  const { results, facets, total } = await backend.search(query, limit, sources, offset, dateRange);
  const time = performance.now() - start;

  const response = {
    results,
    facets,
    query,
    time: Math.round(time * 100) / 100,
    backend: backend.name,
    hasMore: offset + results.length < (total ?? results.length),
    total
  };
  console.log(`[search] response: ${results.length} results, ${JSON.stringify(response).length} bytes`);
  return json(response);
};
