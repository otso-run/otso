<script lang="ts">
  import { onMount } from 'svelte';
  import CategoryFilters from '$lib/components/CategoryFilters.svelte';
  import TimelineHistogram from '$lib/components/TimelineHistogram.svelte';
  import VirtualTable from '$lib/components/VirtualTable.svelte';
  import DocumentModal from '$lib/components/DocumentModal.svelte';
  import { CATEGORIES, getSourceInfo, getSourceCategory } from '$lib/data/sources';

  interface SearchResult {
    id: number;
    source: string;
    entry_type: string;
    title: string;
    snippet: string;
    ts: number;
    url: string | null;
    rank: number;
  }

  interface Facet {
    source: string;
    count: number;
  }

  interface DateRange {
    start: string;
    end: string;
  }

  interface TimelineBucket {
    month: string;
    source: string;
    count: number;
  }

  let query = $state('');
  let serverFacets = $state<Facet[]>([]);
  let searchTime = $state(0);
  let stats = $state<{ total: number; sources: { name: string; count: number }[] } | null>(null);
  let selectedSources = $state<Set<string>>(new Set());
  let selectedCategories = $state<Set<string>>(new Set());
  let excludedSources = $state<Set<string>>(new Set());
  let excludedCategories = $state<Set<string>>(new Set());
  let dateRange = $state<DateRange | null>(null);
  let pendingFilterFetch = $state(false);
  let showTimeline = $state(false);
  let selectedIdx = $state(0);
  let totalCount = $state(0);
  let results = $state<SearchResult[]>([]);
  let loading = $state(false);
  let selectedDocumentId = $state<number | null>(null);
  let searchInput: HTMLInputElement | null = $state(null);
  let timelineBuckets = $state<TimelineBucket[]>([]);
  const PAGE_SIZE = 500;

  // Load more results when scrolling
  async function handleLoadMore() {
    if (loading || results.length >= totalCount) return;
    loading = true;

    let url = `/api/search?limit=${PAGE_SIZE}&offset=${results.length}`;
    if (query.trim()) {
      url += `&q=${encodeURIComponent(query)}`;
    } else {
      url += '&q=&recent=1';
    }
    if (dateRange) {
      url += `&startMonth=${dateRange.start}&endMonth=${dateRange.end}`;
    }
    const sources = new Set<string>();
    selectedSources.forEach(s => sources.add(s));
    if (selectedCategories.size > 0) {
      displayFacets.forEach(f => {
        if (selectedCategories.has(getSourceInfo(f.source).cat)) {
          sources.add(f.source);
        }
      });
    }
    if (sources.size > 0) {
      url += `&sources=${encodeURIComponent(Array.from(sources).join(','))}`;
    }

    const res = await fetch(url);
    const data = await res.json();
    results = [...results, ...data.results];
    loading = false;
  }

  // Use stats for facets when no search, otherwise use server facets
  let displayFacets = $derived.by(() => {
    if (serverFacets.length > 0) {
      return serverFacets;
    }
    if (stats?.sources) {
      return stats.sources.map(s => ({ source: s.name, count: s.count }));
    }
    return [];
  });

  // Compute category counts from display facets
  let categoryCounts = $derived.by(() => {
    const counts: Record<string, number> = {};
    displayFacets.forEach(f => {
      const cat = getSourceInfo(f.source).cat;
      counts[cat] = (counts[cat] || 0) + f.count;
    });
    return Object.entries(counts)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);
  });

  // Clear results when search/filter changes
  function clearResults() {
    results = [];
    totalCount = 0;
  }

  // Sources to pass to timeline based on current filters (including exclusions)
  let timelineSources = $derived.by(() => {
    const sources = new Set<string>();
    selectedSources.forEach(s => sources.add(s));
    if (selectedCategories.size > 0) {
      serverFacets.forEach(f => {
        if (selectedCategories.has(getSourceInfo(f.source).cat)) {
          sources.add(f.source);
        }
      });
    }

    // Handle exclusions
    if (sources.size > 0) {
      // Filter out excluded sources from selection
      const filtered = Array.from(sources).filter(s => !excludedSources.has(s));
      return filtered.length > 0 ? filtered : undefined;
    } else if (excludedSources.size > 0) {
      // Include all sources except excluded ones
      const allExcept = displayFacets
        .map(f => f.source)
        .filter(s => !excludedSources.has(s));
      return allExcept.length > 0 ? allExcept : undefined;
    }

    return undefined;
  });

  // Check if any filters are active
  let hasActiveFilters = $derived(
    selectedSources.size > 0 ||
    selectedCategories.size > 0 ||
    excludedSources.size > 0 ||
    excludedCategories.size > 0 ||
    dateRange !== null
  );

  // Compute filtered count from facets (more accurate than estimatedTotalHits which caps at 1000)
  let filteredCount = $derived.by(() => {
    if (!hasActiveFilters) return stats?.total ?? 0;

    // Sum counts from selected sources
    if (selectedSources.size > 0) {
      return displayFacets
        .filter(f => selectedSources.has(f.source) && !excludedSources.has(f.source))
        .reduce((sum, f) => sum + f.count, 0);
    }

    // Sum counts from selected categories
    if (selectedCategories.size > 0) {
      return displayFacets
        .filter(f => selectedCategories.has(getSourceInfo(f.source).cat) && !excludedSources.has(f.source))
        .reduce((sum, f) => sum + f.count, 0);
    }

    // Exclusions only - subtract excluded from total
    if (excludedSources.size > 0) {
      const excludedCount = displayFacets
        .filter(f => excludedSources.has(f.source))
        .reduce((sum, f) => sum + f.count, 0);
      return (stats?.total ?? 0) - excludedCount;
    }

    // Date range - sum bucket counts within the selected range
    if (dateRange && timelineBuckets.length > 0) {
      const startMonth = dateRange.start.substring(0, 7); // YYYY-MM
      const endMonth = dateRange.end.substring(0, 7);
      return timelineBuckets
        .filter(b => b.month >= startMonth && b.month <= endMonth)
        .reduce((sum, b) => sum + b.count, 0);
    }

    return stats?.total ?? 0;
  });

  // Dynamic placeholder text based on active filters
  let searchPlaceholder = $derived.by(() => {
    if (hasActiveFilters && filteredCount > 0) {
      return `Search ${filteredCount.toLocaleString()} filtered results...`;
    }
    return stats ? `Search ${stats.total.toLocaleString()} records...` : 'Search...';
  });

  onMount(() => {
    // Initialize data asynchronously
    (async () => {
      const res = await fetch('/api/stats');
      stats = await res.json();
      await loadRecent();
    })();

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIdx = Math.min(selectedIdx + 1, totalCount - 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIdx = Math.max(selectedIdx - 1, 0);
      } else if (e.key === 't' && e.ctrlKey) {
        e.preventDefault();
        showTimeline = !showTimeline;
      } else if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        searchInput?.focus();
        searchInput?.select();
      } else if (e.key === 'Escape') {
        // First escape: clear filters
        if (hasActiveFilters) {
          selectedSources = new Set();
          selectedCategories = new Set();
          excludedSources = new Set();
          excludedCategories = new Set();
          dateRange = null;
          if (!query.trim()) {
            loadRecent();
          }
        } else if (query.trim()) {
          // Second escape: clear search and focus
          query = '';
          loadRecent();
          searchInput?.focus();
        } else {
          // Already clear: just focus search
          searchInput?.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  async function loadRecent() {
    clearResults();
    const res = await fetch(`/api/search?q=&recent=1&limit=${PAGE_SIZE}`);
    const data = await res.json();
    totalCount = data.total ?? data.results.length;
    results = data.results;
    serverFacets = data.facets;
    searchTime = data.time;
  }

  async function doSearch() {
    if (!query.trim()) {
      selectedSources = new Set();
      selectedCategories = new Set();
      dateRange = null;
      await loadRecent();
      return;
    }
    selectedSources = new Set();
    selectedCategories = new Set();
    dateRange = null;
    selectedIdx = 0;
    clearResults();

    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}`);
    const data = await res.json();
    totalCount = data.total ?? data.results.length;
    results = data.results;
    serverFacets = data.facets;
    searchTime = data.time;
  }

  function toggleSource(source: string, altKey = false) {
    if (altKey) {
      // Option-click: toggle exclusion
      const newExcluded = new Set(excludedSources);
      if (newExcluded.has(source)) {
        newExcluded.delete(source);
      } else {
        newExcluded.add(source);
        // Remove from selected if it was selected
        const newSelected = new Set(selectedSources);
        newSelected.delete(source);
        selectedSources = newSelected;
      }
      excludedSources = newExcluded;
    } else {
      // Normal click: toggle selection
      const newSet = new Set(selectedSources);
      if (newSet.has(source)) {
        newSet.delete(source);
      } else {
        newSet.add(source);
        // Remove from excluded if it was excluded
        const newExcluded = new Set(excludedSources);
        newExcluded.delete(source);
        excludedSources = newExcluded;
      }
      selectedSources = newSet;
    }
    selectedIdx = 0;

    // Refresh results
    if (selectedSources.size > 0 || excludedSources.size > 0) {
      if (query.trim()) {
        fetchFilteredResults();
      } else {
        browseSource();
      }
    } else if (!query.trim() && selectedCategories.size === 0 && excludedCategories.size === 0) {
      loadRecent();
    }
  }

  async function browseSource() {
    pendingFilterFetch = true;
    clearResults();

    // Determine which sources to include
    let sourcesToQuery: string[];
    if (selectedSources.size > 0) {
      // Use selected sources, minus any excluded
      sourcesToQuery = Array.from(selectedSources).filter(s => !excludedSources.has(s));
    } else if (excludedSources.size > 0) {
      // Include all sources except excluded ones
      sourcesToQuery = displayFacets
        .map(f => f.source)
        .filter(s => !excludedSources.has(s));
    } else {
      sourcesToQuery = [];
    }

    if (sourcesToQuery.length === 0 && excludedSources.size > 0) {
      // All sources excluded - show nothing
      results = [];
      totalCount = 0;
      searchTime = 0;
      pendingFilterFetch = false;
      return;
    }

    const sources = sourcesToQuery.join(',');
    const res = await fetch(`/api/search?q=&sources=${encodeURIComponent(sources)}&limit=${PAGE_SIZE}`);
    const data = await res.json();
    totalCount = data.total ?? data.results.length;
    results = data.results;
    searchTime = data.time;
    pendingFilterFetch = false;
  }

  function toggleCategory(cat: string) {
    const newSet = new Set(selectedCategories);
    if (newSet.has(cat)) {
      newSet.delete(cat);
    } else {
      newSet.add(cat);
    }
    selectedCategories = newSet;
    selectedIdx = 0;

    if (newSet.size > 0) {
      if (query.trim()) {
        fetchFilteredResults();
      } else {
        browseCategory();
      }
    } else if (!query.trim()) {
      loadRecent();
    }
  }

  async function browseCategory() {
    pendingFilterFetch = true;
    clearResults();
    // Get all sources in selected categories
    const sources = displayFacets
      .filter(f => selectedCategories.has(getSourceInfo(f.source).cat))
      .map(f => f.source)
      .join(',');

    if (!sources) {
      pendingFilterFetch = false;
      return;
    }

    const res = await fetch(`/api/search?q=&sources=${encodeURIComponent(sources)}&limit=${PAGE_SIZE}`);
    const data = await res.json();
    totalCount = data.total ?? data.results.length;
    results = data.results;
    searchTime = data.time;
    pendingFilterFetch = false;
  }

  function clearCategories() {
    selectedCategories = new Set();
    if (!query.trim()) {
      loadRecent();
    }
  }

  async function handleDateRangeChange(range: DateRange | null) {
    dateRange = range;
    selectedIdx = 0;

    if (range) {
      // Fetch results filtered by date range from server
      await fetchDateRangeResults();
    } else if (!query.trim() && selectedSources.size === 0 && selectedCategories.size === 0) {
      // No filters - show recent
      await loadRecent();
    }
  }

  async function fetchDateRangeResults() {
    if (!dateRange) return;
    pendingFilterFetch = true;
    clearResults();

    let url = `/api/search?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&startMonth=${dateRange.start}&endMonth=${dateRange.end}`;

    // Add source filters if active
    const sources = new Set<string>();
    selectedSources.forEach(s => sources.add(s));
    if (selectedCategories.size > 0) {
      displayFacets.forEach(f => {
        if (selectedCategories.has(getSourceInfo(f.source).cat)) {
          sources.add(f.source);
        }
      });
    }
    if (sources.size > 0) {
      url += `&sources=${encodeURIComponent(Array.from(sources).join(','))}`;
    }

    const res = await fetch(url);
    const data = await res.json();
    totalCount = data.total ?? data.results.length;
    results = data.results;
    serverFacets = data.facets;
    searchTime = data.time;
    pendingFilterFetch = false;
  }

  async function fetchFilteredResults() {
    if (!query.trim()) return;
    pendingFilterFetch = true;
    clearResults();

    // Build source filter from categories + explicit sources
    const sources = new Set<string>();
    selectedSources.forEach(s => sources.add(s));
    if (selectedCategories.size > 0) {
      serverFacets.forEach(f => {
        if (selectedCategories.has(getSourceInfo(f.source).cat)) {
          sources.add(f.source);
        }
      });
    }

    // If we have exclusions but no explicit selection, include all sources except excluded
    let sourcesToQuery: string[];
    if (sources.size > 0) {
      sourcesToQuery = Array.from(sources).filter(s => !excludedSources.has(s));
    } else if (excludedSources.size > 0) {
      sourcesToQuery = serverFacets
        .map(f => f.source)
        .filter(s => !excludedSources.has(s));
    } else {
      pendingFilterFetch = false;
      return;
    }

    if (sourcesToQuery.length === 0) {
      results = [];
      totalCount = 0;
      searchTime = 0;
      pendingFilterFetch = false;
      return;
    }

    const sourcesParam = sourcesToQuery.join(',');
    let url = `/api/search?q=${encodeURIComponent(query)}&sources=${encodeURIComponent(sourcesParam)}&limit=${PAGE_SIZE}`;
    if (dateRange) {
      url += `&startMonth=${dateRange.start}&endMonth=${dateRange.end}`;
    }
    const res = await fetch(url);
    const data = await res.json();

    totalCount = data.total ?? data.results.length;
    results = data.results;
    searchTime = data.time;
    pendingFilterFetch = false;
  }

</script>

<svelte:head>
  <title>Otso Search</title>
</svelte:head>

<div class="container">
  <main>
    <!-- Search header -->
    <div class="search-header">
      <div class="search-row">
        <span class="prompt">❯</span>

        <!-- Active filter pills -->
        {#each Array.from(selectedCategories) as cat}
          {@const catInfo = CATEGORIES[cat]}
          <button
            class="filter-pill"
            style:--pill-color={catInfo?.color}
            onclick={() => toggleCategory(cat)}
          >
            {cat} ×
          </button>
        {/each}

        <input
          type="search"
          bind:value={query}
          bind:this={searchInput}
          oninput={doSearch}
          placeholder={searchPlaceholder}
          autofocus
        />

        {#if totalCount > 0}
          <span class="timing">
            {results.length.toLocaleString()}/{totalCount.toLocaleString()}
            in {searchTime}ms
            {#if pendingFilterFetch || loading}<span class="loading">...</span>{/if}
          </span>
        {/if}
      </div>

      <!-- Category filters -->
      {#if categoryCounts.length > 0}
        <div class="category-row">
          <CategoryFilters
            categories={categoryCounts}
            selected={selectedCategories}
            onToggle={toggleCategory}
            onClear={clearCategories}
          />
        </div>
      {/if}
    </div>

    <!-- Results -->
    <VirtualTable
      {results}
      {selectedIdx}
      onLoadMore={handleLoadMore}
      onRowClick={(id) => selectedDocumentId = id}
    />

    <!-- Timeline histogram (sticky bottom) -->
    <div class="timeline-container">
      <TimelineHistogram
        {query}
        sources={timelineSources}
        expanded={showTimeline}
        {dateRange}
        onToggle={() => showTimeline = !showTimeline}
        onDateRangeChange={handleDateRangeChange}
        onBucketsChange={(buckets) => timelineBuckets = buckets}
      />
    </div>

    <!-- Footer shortcuts -->
    {#if totalCount > 0}
      <div class="footer">
        <span><kbd>↑↓</kbd> nav</span>
        <span><kbd>^T</kbd> timeline</span>
        <span><kbd>esc</kbd> clear</span>
      </div>
    {/if}
  </main>

  <!-- Source facets sidebar -->
  {#if displayFacets.length > 0}
    <aside>
      <div class="facets">
        {#each displayFacets as facet}
          {@const sourceInfo = getSourceInfo(facet.source)}
          {@const catInfo = CATEGORIES[sourceInfo.cat]}
          {@const isSelected = selectedSources.has(facet.source)}
          {@const isExcluded = excludedSources.has(facet.source)}
          {@const isCatSelected = selectedCategories.has(sourceInfo.cat)}
          <label
            class:selected={isSelected}
            class:excluded={isExcluded}
            class:dimmed={selectedCategories.size > 0 && !isCatSelected}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onclick={(e: MouseEvent) => {
                e.preventDefault();
                toggleSource(facet.source, e.altKey);
              }}
            />
            <span class="facet-icon" style:color={catInfo?.color}>{sourceInfo.icon}</span>
            <span class="facet-name">{sourceInfo.label}</span>
            <span class="facet-count">{facet.count}</span>
          </label>
        {/each}
      </div>
    </aside>
  {/if}
</div>

<DocumentModal
  documentId={selectedDocumentId}
  onClose={() => selectedDocumentId = null}
/>

<style>
  :global(body) {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
    font-size: 14px;
    background: #171717;
    color: #e5e5e5;
  }

  .container {
    display: flex;
    max-width: 1400px;
    margin: 0 auto;
    padding: 0;
    gap: 0;
    min-height: 100vh;
  }

  main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  aside {
    width: 180px;
    flex-shrink: 0;
    position: sticky;
    top: 0;
    align-self: flex-start;
    max-height: 100vh;
    overflow-y: auto;
    border-left: 1px solid #262626;
    padding: 8px 0;
  }

  .search-header {
    position: sticky;
    top: 0;
    background: #171717;
    border-bottom: 1px solid #262626;
    z-index: 10;
    padding: 12px;
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .prompt {
    color: #525252;
  }

  .filter-pill {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    background-color: color-mix(in srgb, var(--pill-color) 20%, transparent);
    color: var(--pill-color);
    font-family: inherit;
  }

  input[type="search"] {
    flex: 1;
    padding: 0;
    font-family: inherit;
    font-size: 14px;
    border: none;
    background: transparent;
    color: #e5e5e5;
    outline: none;
  }

  .timing {
    font-size: 11px;
    color: #525252;
    white-space: nowrap;
  }

  .loading {
    animation: pulse 0.8s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .category-row {
    margin-top: 8px;
    margin-left: 20px;
  }

  .timeline-container {
    position: sticky;
    bottom: 28px; /* Above the footer */
    z-index: 10;
    background: #171717;
  }

  .footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 180px;
    border-top: 1px solid #262626;
    background: #171717;
    padding: 8px 12px;
    font-size: 10px;
    color: #525252;
    display: flex;
    gap: 16px;
  }

  .footer kbd {
    background: #262626;
    padding: 2px 4px;
    border-radius: 2px;
  }

  .facets {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .facets label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 4px 12px;
    cursor: pointer;
    user-select: none;
    transition: opacity 0.1s;
  }

  .facets label:hover {
    background: #1a1a1a;
  }

  .facets label.selected {
    background: #1e3a5f;
  }

  .facets label.excluded {
    background: #3f1e1e;
    text-decoration: line-through;
  }

  .facets label.dimmed {
    opacity: 0.3;
  }

  .facets input[type="checkbox"] {
    display: none;
  }

  .facet-icon {
    font-size: 12px;
  }

  .facet-name {
    flex: 1;
    color: #888;
    font-size: 11px;
  }

  .facets label.selected .facet-name {
    color: #fff;
  }

  .facet-count {
    color: #525252;
    font-size: 10px;
  }
</style>
