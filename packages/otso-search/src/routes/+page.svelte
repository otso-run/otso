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
  let showSources = $state(false);
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

  // Number of source filters in effect, shown on the phone "Sources" button
  let sourceFilterCount = $derived(selectedSources.size + excludedSources.size);

  function clearAllFilters() {
    selectedSources = new Set();
    selectedCategories = new Set();
    excludedSources = new Set();
    excludedCategories = new Set();
    dateRange = null;
    selectedIdx = 0;
    if (query.trim()) {
      doSearch();
    } else {
      loadRecent();
    }
  }

  function clearSources() {
    selectedSources = new Set();
    excludedSources = new Set();
    selectedIdx = 0;
    if (dateRange) {
      fetchDateRangeResults();
    } else if (query.trim()) {
      if (selectedCategories.size > 0) fetchFilteredResults();
      else doSearch();
    } else if (selectedCategories.size > 0) {
      browseCategory();
    } else {
      loadRecent();
    }
  }

  function clearQuery() {
    query = '';
    doSearch();
    searchInput?.focus();
  }

  // The sources sheet (phones only) should not scroll the page behind it
  $effect(() => {
    document.documentElement.classList.toggle('sheet-open', showSources);
    return () => document.documentElement.classList.remove('sheet-open');
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
      // /?source=<name> opens search filtered to one source (the coverage view links here)
      const source = new URLSearchParams(window.location.search).get('source');
      if (source) {
        selectedSources = new Set([source]);
        await browseSource();
      } else {
        await loadRecent();
      }
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
        if (showSources) {
          showSources = false;
        } else if (hasActiveFilters) {
          // First escape: clear filters
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
            class="filter-pill desktop-only"
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
          enterkeyhint="search"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          onkeydown={(e) => {
            // Dismiss the on-screen keyboard once the search is submitted
            if (e.key === 'Enter' && window.matchMedia('(pointer: coarse)').matches) {
              searchInput?.blur();
            }
          }}
          autofocus
        />

        {#if query}
          <button class="clear-query mobile-only" aria-label="Clear search" onclick={clearQuery}>×</button>
        {/if}

        {#if totalCount > 0}
          <span class="timing desktop-only">
            {results.length.toLocaleString()}/{totalCount.toLocaleString()}
            in {searchTime}ms
            {#if pendingFilterFetch || loading}<span class="loading">...</span>{/if}
          </span>
        {/if}
      </div>

      <!-- Category filters -->
      {#if categoryCounts.length > 0}
        <div class="category-row">
          {#if displayFacets.length > 0}
            <button
              class="sources-button mobile-only"
              class:active={sourceFilterCount > 0}
              aria-haspopup="dialog"
              aria-expanded={showSources}
              onclick={() => showSources = true}
            >
              Sources{#if sourceFilterCount > 0}<span class="badge">{sourceFilterCount}</span>{/if}
            </button>
          {/if}
          <CategoryFilters
            categories={categoryCounts}
            selected={selectedCategories}
            onToggle={toggleCategory}
            onClear={clearCategories}
          />
        </div>
      {/if}

      <!-- Result count and filter reset (phones) -->
      <div class="status-row mobile-only">
        <span>
          {#if totalCount > 0}
            {results.length.toLocaleString()} of {totalCount.toLocaleString()} · {Math.round(searchTime)}ms
            {#if pendingFilterFetch || loading}<span class="loading">...</span>{/if}
          {:else if pendingFilterFetch}
            Searching<span class="loading">...</span>
          {:else if stats}
            No results
          {/if}
        </span>
        {#if hasActiveFilters}
          <button class="clear-filters" onclick={clearAllFilters}>Clear filters</button>
        {:else}
          <a class="coverage-link" href="/coverage">Coverage</a>
        {/if}
      </div>
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
        <a class="footer-link" href="/coverage">coverage</a>
      </div>
    {/if}
  </main>

  <!-- Source facets sidebar -->
  {#if displayFacets.length > 0}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="sheet-backdrop" class:open={showSources} onclick={() => showSources = false}></div>
    <aside class:open={showSources} aria-label="Sources">
      <div class="sheet-header">
        <span class="sheet-title">Sources</span>
        {#if sourceFilterCount > 0}
          <button class="sheet-action" onclick={clearSources}>Reset</button>
        {/if}
        <button class="sheet-action primary" onclick={() => showSources = false}>Done</button>
      </div>
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
            <button
              class="facet-exclude"
              aria-pressed={isExcluded}
              aria-label={isExcluded ? `Show ${sourceInfo.label}` : `Hide ${sourceInfo.label}`}
              onclick={(e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                toggleSource(facet.source, true);
              }}
            >{isExcluded ? 'hidden' : 'hide'}</button>
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

  .footer-link {
    margin-left: auto;
    color: #737373;
    text-decoration: none;
  }

  .footer-link:hover {
    color: #e5e5e5;
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

  /* Phone-only pieces are hidden on desktop */
  .mobile-only,
  .sheet-header,
  .sheet-backdrop,
  .facet-exclude {
    display: none;
  }

  /* Keyboard hints make no sense without a keyboard */
  @media (max-width: 720px), (hover: none) and (pointer: coarse) {
    .footer {
      display: none;
    }

    .timeline-container {
      bottom: 0;
      padding-bottom: env(safe-area-inset-bottom);
    }
  }

  /* ---------- Phones ---------- */
  @media (max-width: 720px), (max-width: 950px) and (pointer: coarse) {
    :global(html) {
      -webkit-text-size-adjust: 100%;
      background: #171717;
    }

    :global(body) {
      -webkit-tap-highlight-color: transparent;
      overscroll-behavior-y: none;
    }

    :global(html.sheet-open),
    :global(html.sheet-open body) {
      overflow: hidden;
    }

    .desktop-only {
      display: none;
    }

    .mobile-only {
      display: revert;
    }

    .container {
      display: block;
      min-height: 100vh;
      min-height: 100dvh;
    }

    main {
      min-height: 100vh;
      min-height: 100dvh;
    }

    .search-header {
      padding: calc(8px + env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) 0
        max(12px, env(safe-area-inset-left));
    }

    .search-row {
      height: 44px;
      padding: 0 4px 0 12px;
      border-radius: 12px;
      background: #232323;
      border: 1px solid #2e2e2e;
    }

    .search-row:focus-within {
      border-color: #4a4a4a;
    }

    input[type="search"] {
      /* 16px stops iOS Safari zooming the page on focus */
      font-size: 16px;
      min-width: 0;
      height: 100%;
      appearance: none;
      -webkit-appearance: none;
      border-radius: 0;
    }

    input[type="search"]::-webkit-search-cancel-button {
      display: none;
    }

    input[type="search"]::placeholder {
      color: #6b6b6b;
    }

    .clear-query {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      flex-shrink: 0;
      border: none;
      background: none;
      color: #888;
      font-size: 22px;
      font-family: inherit;
      line-height: 1;
    }

    .category-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 8px 0 0;
      /* Let the chips scroll out to the screen edge */
      margin-right: calc(-1 * max(12px, env(safe-area-inset-right)));
      min-width: 0;
    }

    .sources-button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
      height: 36px;
      padding: 0 12px;
      border-radius: 18px;
      border: 1px solid #3a3a3a;
      background: #232323;
      color: #d4d4d4;
      font-family: inherit;
      font-size: 12px;
    }

    .sources-button.active {
      border-color: #3b82f6;
      color: #fff;
      background: #1e3a5f;
    }

    .badge {
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      box-sizing: border-box;
      border-radius: 9px;
      background: #3b82f6;
      color: #fff;
      font-size: 11px;
      line-height: 18px;
      text-align: center;
    }

    .status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 32px;
      font-size: 11px;
      color: #737373;
      white-space: nowrap;
    }

    .coverage-link {
      display: inline-flex;
      align-items: center;
      height: 32px;
      padding-left: 12px;
      color: #a3a3a3;
      font-size: 12px;
      text-decoration: none;
    }

    .clear-filters {
      height: 32px;
      padding: 0 0 0 12px;
      border: none;
      background: none;
      color: #4ECDC4;
      font-family: inherit;
      font-size: 12px;
    }

    /* Sources become a bottom sheet */
    .sheet-backdrop {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 40;
      background: rgba(0, 0, 0, 0.6);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s;
    }

    .sheet-backdrop.open {
      opacity: 1;
      pointer-events: auto;
    }

    aside {
      position: fixed;
      top: auto;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 50;
      width: auto;
      max-height: 80vh;
      max-height: 80dvh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      padding: 0;
      border-left: none;
      border-top: 1px solid #333;
      border-radius: 16px 16px 0 0;
      background: #1c1c1c;
      transform: translateY(100%);
      visibility: hidden;
      transition: transform 0.25s ease, visibility 0s linear 0.25s;
    }

    aside.open {
      transform: none;
      visibility: visible;
      transition: transform 0.25s ease;
    }

    .sheet-header {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      padding: 6px 8px 6px 16px;
      border-bottom: 1px solid #2a2a2a;
    }

    .sheet-title {
      flex: 1;
      font-size: 14px;
      color: #e5e5e5;
    }

    .sheet-action {
      height: 44px;
      padding: 0 12px;
      border: none;
      background: none;
      color: #a3a3a3;
      font-family: inherit;
      font-size: 14px;
    }

    .sheet-action.primary {
      color: #4ECDC4;
    }

    .facets {
      overflow-y: auto;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
      gap: 0;
      padding-bottom: env(safe-area-inset-bottom);
    }

    .facets label {
      min-height: 48px;
      box-sizing: border-box;
      gap: 12px;
      padding: 0 8px 0 max(16px, env(safe-area-inset-left));
      border-bottom: 1px solid #262626;
    }

    .facets label:hover {
      background: none;
    }

    .facets label.selected {
      background: #1e3a5f;
    }

    .facets label.excluded {
      background: #3f1e1e;
      text-decoration: none;
    }

    .facets label.excluded .facet-name {
      text-decoration: line-through;
    }

    .facet-icon {
      width: 20px;
      text-align: center;
      font-size: 15px;
    }

    .facet-name {
      font-size: 14px;
      color: #d4d4d4;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .facet-count {
      font-size: 12px;
      color: #737373;
    }

    .facet-exclude {
      display: block;
      height: 44px;
      min-width: 60px;
      padding: 0 8px;
      border: none;
      background: none;
      color: #737373;
      font-family: inherit;
      font-size: 11px;
      text-align: right;
    }

    .facet-exclude[aria-pressed="true"] {
      color: #f87171;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    aside,
    .sheet-backdrop {
      transition: none;
    }
  }
</style>
