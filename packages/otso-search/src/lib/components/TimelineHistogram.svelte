<script lang="ts">
  import { CATEGORIES, getSourceInfo } from '$lib/data/sources';

  interface TimelineBucket {
    month: string;
    source: string;
    count: number;
  }

  interface DateRange {
    start: string;
    end: string;
  }

  interface Props {
    query: string;
    sources?: string[];
    expanded: boolean;
    dateRange: DateRange | null;
    onToggle: () => void;
    onDateRangeChange: (range: DateRange | null) => void;
    onBucketsChange?: (buckets: TimelineBucket[]) => void;
  }

  let { query, sources, expanded, dateRange, onToggle, onDateRangeChange, onBucketsChange }: Props = $props();

  let containerRef: HTMLDivElement | null = $state(null);
  let isDragging = $state(false);
  let dragStart = $state<string | null>(null);
  let dragEnd = $state<string | null>(null);

  interface SourceTotal {
    source: string;
    count: number;
  }

  // Timeline data from API
  let buckets = $state<TimelineBucket[]>([]);
  let sourceTotals = $state<SourceTotal[]>([]);
  let loading = $state(false);

  // Global date range - fetched once on mount, never changes with filters
  let globalMinMonth = $state('');
  let globalMaxMonth = $state('');
  let globalRangeLoaded = $state(false);

  // Track last fetched params to avoid refetching
  let lastFetchParams = $state('');

  // Fetch global date range once on mount (no filters)
  $effect(() => {
    if (globalRangeLoaded) return;

    fetch('/api/timeline')
      .then(res => res.json())
      .then(data => {
        globalMinMonth = data.minMonth || '';
        globalMaxMonth = data.maxMonth || '';
        globalRangeLoaded = true;
      });
  });

  // Fetch timeline data when query or sources change
  $effect(() => {
    const params = `q=${query}&sources=${sources?.join(',') || ''}`;
    if (params === lastFetchParams) return;
    lastFetchParams = params;

    loading = true;
    const url = new URL('/api/timeline', window.location.origin);
    if (query) url.searchParams.set('q', query);
    if (sources && sources.length > 0) url.searchParams.set('sources', sources.join(','));

    fetch(url)
      .then(res => res.json())
      .then(data => {
        buckets = data.buckets || [];
        sourceTotals = data.sourceTotals || [];
        onBucketsChange?.(buckets);
      })
      .finally(() => {
        loading = false;
      });
  });

  // Compute histogram data from API buckets, using global date range
  let histogramData = $derived.by(() => {
    const byMonth: Record<string, Record<string, number>> = {};

    buckets.forEach(bucket => {
      if (!byMonth[bucket.month]) byMonth[bucket.month] = {};
      byMonth[bucket.month][bucket.source] = bucket.count;
    });

    // Use global date range (constant regardless of filters)
    if (!globalMinMonth || !globalMaxMonth) {
      return { months: [], data: byMonth, maxCount: 0 };
    }

    // Generate all months from global min to global max
    const startDate = new Date(globalMinMonth + '-01');
    const endDate = new Date(globalMaxMonth + '-01');
    const allMonths: string[] = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      allMonths.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`);
      current.setMonth(current.getMonth() + 1);
    }

    let maxCount = 0;
    allMonths.forEach(m => {
      const total = Object.values(byMonth[m] || {}).reduce((a, b) => a + b, 0);
      if (total > maxCount) maxCount = total;
    });

    return { months: allMonths, data: byMonth, maxCount };
  });

  // Source counts - filtered by date range if active, otherwise use totals
  let sourceCounts = $derived.by(() => {
    if (dateRange && buckets.length > 0) {
      // Sum bucket counts by source within the date range
      const startMonth = dateRange.start.substring(0, 7);
      const endMonth = dateRange.end.substring(0, 7);
      const counts: Record<string, number> = {};

      buckets
        .filter(b => b.month >= startMonth && b.month <= endMonth)
        .forEach(b => {
          counts[b.source] = (counts[b.source] || 0) + b.count;
        });

      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8) as [string, number][];
    }

    return sourceTotals
      .slice(0, 8)
      .map(({ source, count }) => [source, count] as [string, number]);
  });

  function getMonthFromX(x: number): string | null {
    if (!containerRef || histogramData.months.length === 0) return null;
    const rect = containerRef.getBoundingClientRect();
    const relX = x - rect.left;
    const idx = Math.floor((relX / rect.width) * histogramData.months.length);
    return histogramData.months[Math.max(0, Math.min(idx, histogramData.months.length - 1))];
  }

  function startDrag(x: number) {
    if (!expanded) return;
    const month = getMonthFromX(x);
    isDragging = true;
    dragStart = month;
    dragEnd = month;
  }

  function moveDrag(x: number) {
    if (!isDragging) return;
    dragEnd = getMonthFromX(x);
  }

  function endDrag() {
    if (isDragging && dragStart && dragEnd) {
      const start = dragStart < dragEnd ? dragStart : dragEnd;
      const end = dragStart < dragEnd ? dragEnd : dragStart;
      onDateRangeChange({ start: start + '-01', end: end + '-31' });
    }
    isDragging = false;
    dragStart = null;
    dragEnd = null;
  }

  function handleMouseDown(e: MouseEvent) {
    startDrag(e.clientX);
  }

  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length === 1) {
      startDrag(e.touches[0].clientX);
    }
  }

  $effect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => moveDrag(e.clientX);
    const onMouseUp = () => endDrag();
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        e.preventDefault();
        moveDrag(e.touches[0].clientX);
      }
    };
    const onTouchEnd = () => endDrag();

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  });

  function isMonthInSelection(month: string): boolean {
    if (dateRange) {
      const m = month + '-15';
      return m >= dateRange.start && m <= dateRange.end;
    }
    if (isDragging && dragStart && dragEnd) {
      const start = dragStart < dragEnd ? dragStart : dragEnd;
      const end = dragStart < dragEnd ? dragEnd : dragStart;
      return month >= start && month <= end;
    }
    return false;
  }

  // Build stacked bar chart data
  let chartData = $derived.by(() => {
    const catOrder = ['listen', 'read', 'browse', 'bookmark', 'code', 'social', 'message', 'ai', 'note', 'photo', 'files', 'tasks', 'event', 'spend', 'travel', 'health'];
    const allCats = new Set<string>();

    histogramData.months.forEach(m => {
      Object.keys(histogramData.data[m] || {}).forEach(source => {
        allCats.add(getSourceInfo(source).cat);
      });
    });

    const categories = catOrder.filter(c => allCats.has(c));
    const barWidth = 100 / Math.max(histogramData.months.length, 1);

    // Selection bounds
    const selStart = dateRange
      ? histogramData.months.indexOf(dateRange.start.substring(0, 7))
      : (isDragging && dragStart && dragEnd
          ? histogramData.months.indexOf(dragStart < dragEnd ? dragStart : dragEnd)
          : -1);
    const selEnd = dateRange
      ? histogramData.months.indexOf(dateRange.end.substring(0, 7))
      : (isDragging && dragStart && dragEnd
          ? histogramData.months.indexOf(dragStart < dragEnd ? dragEnd : dragStart)
          : -1);
    const hasSelection = selStart >= 0 && selEnd >= 0;

    const rects: Array<{
      key: string;
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
      opacity: number;
    }> = [];

    histogramData.months.forEach((month, monthIdx) => {
      const data = histogramData.data[month] || {};
      const catTotals: Record<string, number> = {};
      categories.forEach(cat => catTotals[cat] = 0);

      Object.entries(data).forEach(([source, count]) => {
        const cat = getSourceInfo(source).cat;
        if (cat) catTotals[cat] += count;
      });

      let cumulative = 0;
      categories.forEach(cat => {
        const val = catTotals[cat] || 0;
        if (val > 0) {
          const y = (1 - (cumulative + val) / histogramData.maxCount) * 100;
          const h = (val / histogramData.maxCount) * 100;
          const isInSelection = hasSelection && monthIdx >= selStart && monthIdx <= selEnd;

          rects.push({
            key: `${monthIdx}-${cat}`,
            x: monthIdx * barWidth,
            y,
            width: barWidth,
            height: h,
            color: CATEGORIES[cat]?.color || '#525252',
            opacity: hasSelection ? (isInSelection ? 0.85 : 0.2) : 0.75
          });
        }
        cumulative += val;
      });
    });

    return { rects, barWidth, hasSelection, selStart, selEnd };
  });

  // Compute year labels for x-axis (years only)
  let yearLabels = $derived.by(() => {
    const labels: Array<{ text: string; position: number }> = [];
    const months = histogramData.months;
    if (months.length === 0) return labels;

    const totalMonths = months.length;

    months.forEach((month, i) => {
      const [year, m] = month.split('-');
      const monthNum = parseInt(m);
      const position = (i / totalMonths) * 100;

      // Show year at January only
      if (monthNum === 1) {
        labels.push({ text: year, position });
      }
    });

    return labels;
  });

  // Tooltip state
  let hoveredMonth = $state<string | null>(null);
  let tooltipX = $state(0);

  function handleChartMouseMove(e: MouseEvent) {
    const month = getMonthFromX(e.clientX);
    if (month) {
      hoveredMonth = month;
      const rect = containerRef?.getBoundingClientRect();
      if (rect) {
        tooltipX = e.clientX - rect.left;
      }
    }
  }

  function handleChartMouseLeave() {
    hoveredMonth = null;
  }

  function formatMonthLabel(month: string): string {
    const [year, m] = month.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(m) - 1]} ${year}`;
  }
</script>

{#if sourceTotals.length > 0 || loading}
<div class="timeline-container">
  <div
    class="header"
    class:expanded
    onclick={() => !isDragging && onToggle()}
    onkeydown={(e) => e.key === 'Enter' && !isDragging && onToggle()}
    role="button"
    tabindex="0"
  >
    {#if !expanded && histogramData.months.length > 0}
      <svg class="sparkline" viewBox="0 0 100 100" preserveAspectRatio="none">
        {#each chartData.rects as { key, x, y, width, height, color } (key)}
          <rect
            {x}
            {y}
            width={width + 0.1}
            {height}
            fill={color}
            opacity="0.25"
          />
        {/each}
      </svg>
    {/if}

    <span class="toggle">{expanded ? '▼' : '▶'} timeline</span>

    <div class="source-counts">
      {#each sourceCounts as [source, count]}
        {@const info = getSourceInfo(source)}
        {@const cat = CATEGORIES[info.cat]}
        <span style:color={cat?.color}>
          {info.icon} {count}
        </span>
      {/each}
    </div>

    {#if dateRange}
      <button
        class="date-range active"
        onclick={(e) => { e.stopPropagation(); onDateRangeChange(null); }}
      >
        {dateRange.start.substring(0, 7)} → {dateRange.end.substring(0, 7)} ×
      </button>
    {:else if globalMinMonth && globalMaxMonth}
      <span class="date-range">
        {globalMinMonth} → {globalMaxMonth}
      </span>
    {/if}
  </div>

  {#if expanded && histogramData.months.length > 0}
    <div class="chart-area">
      <div class="hint">drag to select time range</div>

      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        bind:this={containerRef}
        class="chart"
        onmousedown={handleMouseDown}
        onmousemove={handleChartMouseMove}
        onmouseleave={handleChartMouseLeave}
        ontouchstart={handleTouchStart}
        role="application"
        aria-label="Timeline histogram - drag to select date range"
      >
        {#if hoveredMonth}
          <div class="tooltip" style:left="{tooltipX}px">
            {formatMonthLabel(hoveredMonth)}
          </div>
        {/if}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          {#each chartData.rects as { key, x, y, width, height, color, opacity }}
            <rect
              {x}
              {y}
              width={width + 0.1}
              {height}
              fill={color}
              {opacity}
            />
          {/each}

          {#if chartData.hasSelection}
            <rect
              x={chartData.selStart * chartData.barWidth}
              y="0"
              width={(chartData.selEnd - chartData.selStart + 1) * chartData.barWidth}
              height="100"
              fill="none"
              stroke="#4ECDC4"
              stroke-width="0.5"
            />
          {/if}
        </svg>
      </div>

      <div class="year-labels">
        {#each yearLabels as label}
          <div class="year-label" style:left="{label.position}%">
            {label.text}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
{/if}

<style>
  .timeline-container {
    border-bottom: 1px solid #262626;
  }

  .header {
    position: relative;
    width: 100%;
    padding: 8px 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 12px;
    background-color: transparent;
    border: none;
    font-family: inherit;
    font-size: inherit;
    color: inherit;
    text-align: left;
  }

  .sparkline {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .header.expanded {
    background-color: #1a1a1a;
  }

  .toggle {
    color: #525252;
    font-size: 10px;
  }

  .source-counts {
    display: flex;
    gap: 8px;
    flex: 1;
    overflow: hidden;
  }

  .source-counts span {
    font-size: 10px;
    white-space: nowrap;
  }

  .date-range {
    color: #525252;
    font-size: 10px;
    border: none;
    background: none;
    font-family: inherit;
    padding: 0;
  }

  .date-range.active {
    color: #4ECDC4;
    cursor: pointer;
    padding: 2px 6px;
    background-color: rgba(78, 205, 196, 0.13);
    border-radius: 4px;
  }

  .chart-area {
    padding: 12px;
    background-color: #1a1a1a;
    user-select: none;
  }

  .hint {
    font-size: 10px;
    color: #525252;
    margin-bottom: 8px;
  }

  .chart {
    position: relative;
    height: 80px;
    cursor: crosshair;
    touch-action: none;
  }

  .chart svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  .year-labels {
    position: relative;
    height: 16px;
    font-size: 9px;
    color: #888;
  }

  .year-label {
    position: absolute;
    transform: translateX(-50%);
  }

  .tooltip {
    position: absolute;
    top: -24px;
    transform: translateX(-50%);
    background: #262626;
    color: #e5e5e5;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 10;
  }
</style>
