export interface SearchResult {
  id: number;
  source: string;
  entry_type: string;
  title: string;
  snippet: string;
  ts: number;
  rank: number;
}

export interface DocumentResponse {
  id: number;
  source: string;
  entry_type: string;
  title: string;
  content: string;
  ts: number;
  external_id?: string;
  url?: string;
  [key: string]: unknown;
}

export interface SearchResponse {
  results: SearchResult[];
  facets: { source: string; count: number }[];
  total?: number;
}

export interface StatsResponse {
  total: number;
  sources: { name: string; count: number }[];
}

export interface TimelineBucket {
  month: string;  // YYYY-MM format
  source: string;
  count: number;
}

export interface TimelineResponse {
  buckets: TimelineBucket[];
  minMonth: string;
  maxMonth: string;
  sourceTotals: { source: string; count: number }[];  // All entries per source (including ts=0)
}

export interface DateRange {
  start: string;  // YYYY-MM format
  end: string;    // YYYY-MM format
}

export interface SearchBackend {
  readonly name: string;
  search(query: string, limit: number, sources?: string[], offset?: number, dateRange?: DateRange): Promise<SearchResponse>;
  getDocument(id: number): Promise<DocumentResponse | null>;
  getStats(): Promise<StatsResponse>;
  getTimeline(query?: string, sources?: string[]): Promise<TimelineResponse>;
  isAvailable(): Promise<boolean>;
}
