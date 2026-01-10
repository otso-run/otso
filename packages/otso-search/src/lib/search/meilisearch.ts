import { MeiliSearch } from 'meilisearch';
import type { SearchBackend, SearchResponse, StatsResponse, TimelineResponse, DateRange, DocumentResponse } from './types';

const MEILI_HOST = process.env.MEILISEARCH_URL || 'http://127.0.0.1:7700';
const MEILI_KEY = process.env.MEILISEARCH_API_KEY || '';
const INDEX_NAME = 'otso';

let client: MeiliSearch | null = null;

function getClient(): MeiliSearch {
  if (!client) {
    client = new MeiliSearch({
      host: MEILI_HOST,
      apiKey: MEILI_KEY
    });
  }
  return client;
}

export class MeilisearchBackend implements SearchBackend {
  readonly name = 'meilisearch';

  async search(query: string, limit = 100, sources?: string[], offset = 0, dateRange?: DateRange): Promise<SearchResponse> {
    const meili = getClient();
    const index = meili.index(INDEX_NAME);

    // Build filter conditions
    const filters: string[] = [];

    if (sources && sources.length > 0) {
      filters.push(`source IN [${sources.map(s => `"${s}"`).join(', ')}]`);
    }

    if (dateRange) {
      // Convert YYYY-MM to unix timestamps
      // Start of month: first day at midnight UTC
      const [startYear, startMonth] = dateRange.start.split('-').map(Number);
      const startTs = Math.floor(new Date(Date.UTC(startYear, startMonth - 1, 1)).getTime() / 1000);
      // End of month: last second of the month
      const [endYear, endMonth] = dateRange.end.split('-').map(Number);
      const endTs = Math.floor(new Date(Date.UTC(endYear, endMonth, 1)).getTime() / 1000) - 1;
      filters.push(`ts >= ${startTs} AND ts <= ${endTs}`);
    }

    const filter = filters.length > 0 ? filters.join(' AND ') : undefined;

    const response = await index.search(query, {
      limit,
      offset,
      filter,
      sort: ['ts:desc'], // Always sort by time, newest first
      attributesToHighlight: query ? ['title', 'content'] : [],
      highlightPreTag: '<mark>',
      highlightPostTag: '</mark>',
      attributesToRetrieve: ['id', 'source', 'entry_type', 'title', 'content', 'ts', 'url'],
      facets: ['source']
    });

    // Map hits to SearchResult format
    const results = response.hits.map((hit: Record<string, unknown>) => ({
      id: hit.id as number,
      source: hit.source as string,
      entry_type: hit.entry_type as string,
      title: ((hit._formatted as Record<string, string>)?.title || hit.title) as string,
      snippet: this.extractSnippet(
        ((hit._formatted as Record<string, string>)?.content || hit.content) as string
      ),
      ts: hit.ts as number,
      url: (hit.url as string) || null,
      rank: 0 // Meilisearch handles ranking internally
    }));

    // Map facet distribution to our format
    const facets = Object.entries(response.facetDistribution?.source || {})
      .map(([source, count]) => ({ source, count: count as number }))
      .sort((a, b) => b.count - a.count);

    return { results, facets, total: response.estimatedTotalHits };
  }

  async getStats(): Promise<StatsResponse> {
    const meili = getClient();
    const index = meili.index(INDEX_NAME);

    // Get total count from index stats
    const stats = await index.getStats();
    const total = stats.numberOfDocuments;

    // Use faceted search to get source breakdown
    const response = await index.search('', {
      limit: 0,
      facets: ['source']
    });

    const sources = Object.entries(response.facetDistribution?.source || {})
      .map(([name, count]) => ({ name, count: count as number }))
      .sort((a, b) => b.count - a.count);

    return { total, sources };
  }

  async getTimeline(query?: string, sources?: string[]): Promise<TimelineResponse> {
    const meili = getClient();
    const index = meili.index(INDEX_NAME);

    // Build filter for sources
    let filter: string | undefined;
    if (sources && sources.length > 0) {
      filter = `source IN [${sources.map(s => `"${s}"`).join(', ')}]`;
    }

    // Get source totals efficiently using facets (same as getStats)
    const facetResponse = await index.search(query || '', {
      limit: 0,
      filter,
      facets: ['source']
    });

    const sourceTotals = Object.entries(facetResponse.facetDistribution?.source || {})
      .map(([source, count]) => ({ source, count: count as number }))
      .sort((a, b) => b.count - a.count);

    // For timeline buckets, we need to iterate through documents with timestamps
    // This is slower but necessary for temporal visualization
    // Use higher limit for better coverage of large datasets
    const bucketMap: Record<string, Record<string, number>> = {};
    let offset = 0;
    const batchSize = 1000;
    const maxDocs = 200000; // Increased to handle large sources like Last.fm
    let hasMore = true;

    while (hasMore && offset < maxDocs) {
      const response = await index.search(query || '', {
        limit: batchSize,
        offset,
        filter,
        sort: ['ts:asc'], // Sort by timestamp to get chronological coverage
        attributesToRetrieve: ['ts', 'source'],
        attributesToHighlight: [],
      });

      for (const hit of response.hits) {
        const ts = hit.ts as number;
        const source = hit.source as string;
        if (!source || !ts || ts <= 0) continue;

        const date = new Date(ts * 1000);
        const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        if (!bucketMap[month]) bucketMap[month] = {};
        bucketMap[month][source] = (bucketMap[month][source] || 0) + 1;
      }

      offset += response.hits.length;
      hasMore = response.hits.length === batchSize && offset < (response.estimatedTotalHits || 0);
    }

    // Convert to flat bucket array
    const buckets: { month: string; source: string; count: number }[] = [];
    const months = Object.keys(bucketMap).sort();

    for (const month of months) {
      for (const [source, count] of Object.entries(bucketMap[month])) {
        buckets.push({ month, source, count });
      }
    }

    const minMonth = months.length > 0 ? months[0] : '';
    const maxMonth = months.length > 0 ? months[months.length - 1] : '';

    return { buckets, minMonth, maxMonth, sourceTotals };
  }

  async getDocument(id: number): Promise<DocumentResponse | null> {
    try {
      const meili = getClient();
      const index = meili.index(INDEX_NAME);
      const doc = await index.getDocument(id);
      return doc as DocumentResponse;
    } catch {
      return null;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const meili = getClient();
      await meili.health();
      // Also check that the index exists
      const index = meili.index(INDEX_NAME);
      await index.getStats();
      return true;
    } catch {
      return false;
    }
  }

  private extractSnippet(content: string | undefined, maxLength = 150): string {
    if (!content) return '';

    // Find marked content and extract around it
    const markIndex = content.indexOf('<mark>');
    if (markIndex > 0) {
      const start = Math.max(0, markIndex - 50);
      const snippet = content.slice(start, start + maxLength);
      return (start > 0 ? '...' : '') + snippet + (content.length > start + maxLength ? '...' : '');
    }

    return content.slice(0, maxLength) + (content.length > maxLength ? '...' : '');
  }
}
