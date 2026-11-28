<script lang="ts">
  import { onMount } from 'svelte';
  import { getSourceInfo, getSourceCategory } from '$lib/data/sources';
  import {
    type Lane,
    type Gap,
    decodeLane,
    binLane,
    countBetween,
    axisTicks,
    formatRange,
    formatSpan,
    formatAgo,
    formatCount,
    formatDay,
    dayToDate
  } from '$lib/data/coverage';

  type SortMode = 'records' | 'recent' | 'stale' | 'first' | 'name';
  type Preset = 'all' | '10y' | '5y' | '1y' | '3m';

  const PRESETS: { key: Preset; label: string; days: number }[] = [
    { key: 'all', label: 'All', days: Infinity },
    { key: '10y', label: '10y', days: 3653 },
    { key: '5y', label: '5y', days: 1826 },
    { key: '1y', label: '1y', days: 365 },
    { key: '3m', label: '3m', days: 91 }
  ];

  const GAP_OPTIONS = [
    { days: 7, label: '1 week' },
    { days: 30, label: '1 month' },
    { days: 90, label: '3 months' },
    { days: 365, label: '1 year' }
  ];

  let lanes = $state<Lane[]>([]);
  let loadError = $state<string | null>(null);
  let loaded = $state(false);
  let today = $state(Math.floor(Date.now() / 86_400_000));
  let fullStart = $state(0);
  /** Where the default view starts: drops a thin tail of very old records */
  let typicalStart = $state(0);
  let showAll = $state(false);
  let viewStart = $state(0);
  let viewEnd = $state(0);
  let preset = $state<Preset | null>('all');
  let gapThreshold = $state(30);
  let sortMode = $state<SortMode>('records');
  let expanded = $state<Set<string>>(new Set());
  let trackWidth = $state(0);
  let trackEl: HTMLDivElement | null = $state(null);
  let lanesEl: HTMLDivElement | null = $state(null);
  let canvases = $state<Record<string, HTMLCanvasElement | undefined>>({});
  let isPhone = $state(false);

  // Cell counts for each lane as last drawn, for hover lookups
  const drawnBins = new Map<string, Float64Array>();

  let hover = $state<{
    source: string;
    start: number;
    end: number;
    count: number;
    gap: Gap | null;
    stale: boolean;
    lastDay: number;
    x: number;
    y: number;
  } | null>(null);

  onMount(() => {
    const mq = window.matchMedia('(max-width: 720px), (max-width: 950px) and (pointer: coarse)');
    const onMq = () => (isPhone = mq.matches);
    onMq();
    mq.addEventListener('change', onMq);

    try {
      const saved = JSON.parse(localStorage.getItem('otso.coverage') ?? '{}');
      if (GAP_OPTIONS.some((o) => o.days === saved.gapThreshold)) gapThreshold = saved.gapThreshold;
      if (['records', 'recent', 'stale', 'first', 'name'].includes(saved.sortMode)) sortMode = saved.sortMode;
    } catch {
      // Private mode or blocked storage: use the defaults
    }

    load();
    return () => mq.removeEventListener('change', onMq);
  });

  $effect(() => {
    const prefs = JSON.stringify({ gapThreshold, sortMode });
    try {
      localStorage.setItem('otso.coverage', prefs);
    } catch {
      // Not saved; harmless
    }
  });

  async function load() {
    try {
      const res = await fetch('/api/coverage');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      lanes = data.sources.map(decodeLane);
      today = data.today;
      fullStart = data.minDay;
      typicalStart = findTypicalStart(lanes, data.minDay);
      setPreset('all');
      loaded = true;
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  // The day by which 0.1% of dated records have happened. A handful of
  // records with bad or ancient timestamps shouldn't squash everything else
  // into the right-hand edge, so the default view starts there when the tail
  // before it is long.
  function findTypicalStart(all: Lane[], minDay: number): number {
    const total = all.reduce((n, l) => n + l.total, 0);
    if (total === 0) return minDay;
    const points: [number, number][] = [];
    for (const lane of all) {
      // Only the earliest records matter; cap the work per lane
      const n = Math.min(lane.days.length, 2000);
      for (let i = 0; i < n; i++) points.push([lane.days[i], lane.counts[i]]);
    }
    points.sort((a, b) => a[0] - b[0]);
    const target = total * 0.001;
    let seen = 0;
    for (const [day, count] of points) {
      seen += count;
      if (seen > target) return day - (dayToDate(day).getUTCDate() - 1); // start of that month
    }
    return minDay;
  }

  let axisEnd = $derived(Math.max(today, ...lanes.map((l) => l.lastDay)));
  let defaultStart = $derived(!showAll && typicalStart - fullStart > 730 ? typicalStart : fullStart);
  let hiddenEarly = $derived(
    defaultStart > fullStart ? lanes.reduce((n, l) => n + countBetween(l, fullStart, defaultStart - 1), 0) : 0
  );

  function setPreset(key: Preset) {
    const p = PRESETS.find((p) => p.key === key)!;
    preset = key;
    viewEnd = axisEnd;
    viewStart = Number.isFinite(p.days) ? Math.max(fullStart, axisEnd - p.days + 1) : defaultStart;
  }

  function zoomTo(start: number, end: number) {
    const pad = Math.max(3, Math.round((end - start) * 0.15));
    viewStart = Math.max(fullStart, start - pad);
    viewEnd = Math.min(axisEnd, end + pad);
    preset = null;
  }

  let sortedLanes = $derived.by(() => {
    const out = [...lanes];
    const label = (l: Lane) => getSourceInfo(l.source).label.toLowerCase();
    switch (sortMode) {
      case 'recent':
        return out.sort((a, b) => b.lastDay - a.lastDay);
      case 'stale':
        return out.sort((a, b) => (a.total ? a.lastDay : Infinity) - (b.total ? b.lastDay : Infinity));
      case 'first':
        return out.sort((a, b) => a.firstDay - b.firstDay);
      case 'name':
        return out.sort((a, b) => label(a).localeCompare(label(b)));
      default:
        return out.sort((a, b) => b.total - a.total);
    }
  });

  function bigGaps(lane: Lane): Gap[] {
    return lane.gaps.filter((g) => g.length >= gapThreshold);
  }

  function staleDays(lane: Lane): number {
    return lane.total ? today - lane.lastDay : 0;
  }

  let totals = $derived({
    records: lanes.reduce((n, l) => n + l.total, 0),
    undated: lanes.reduce((n, l) => n + l.undated, 0),
    withGaps: lanes.filter((l) => bigGaps(l).length > 0).length,
    stale: lanes.filter((l) => l.total && staleDays(l) >= gapThreshold).length
  });

  let ticks = $derived(trackWidth > 0 && viewEnd > viewStart ? axisTicks(viewStart, viewEnd, trackWidth, isPhone ? 44 : 56) : []);

  function xOf(day: number): number {
    return ((day - viewStart) / (viewEnd - viewStart + 1)) * trackWidth;
  }

  // Track the shared width of the time axis
  $effect(() => {
    if (!trackEl) return;
    const ro = new ResizeObserver(([entry]) => (trackWidth = Math.floor(entry.contentRect.width)));
    ro.observe(trackEl);
    return () => ro.disconnect();
  });

  const LANE_H = 16;

  // Redraw every lane when the data, view, width or gap size changes
  $effect(() => {
    const width = trackWidth;
    const start = viewStart;
    const end = viewEnd;
    const threshold = gapThreshold;
    const cellPx = isPhone ? 2 : 3;
    if (!width || end <= start) return;
    const span = end - start + 1;
    const bins = Math.max(1, Math.min(span, Math.floor(width / cellPx)));
    const dpr = window.devicePixelRatio || 1;

    for (const lane of sortedLanes) {
      const canvas = canvases[lane.source];
      if (!canvas) continue;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(LANE_H * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, LANE_H);

      const x = (day: number) => ((day - start) / span) * width;
      const color = getSourceCategory(lane.source).color;

      if (lane.total === 0) {
        drawnBins.set(lane.source, new Float64Array(bins));
        continue;
      }

      // Span the source has been collecting for
      const s0 = Math.max(start, lane.firstDay);
      const s1 = Math.min(end, lane.lastDay);
      if (s1 >= s0) {
        ctx.fillStyle = '#232323';
        ctx.fillRect(x(s0), 0, x(s1 + 1) - x(s0), LANE_H);
      }

      // Gaps inside that span
      ctx.fillStyle = 'rgba(248, 113, 113, 0.14)';
      const gapLines: [number, number][] = [];
      for (const g of lane.gaps) {
        if (g.length < threshold) break; // sorted longest first
        if (g.end < start || g.start > end) continue;
        const a = x(Math.max(g.start, start));
        const b = x(Math.min(g.end, end) + 1);
        ctx.fillRect(a, 0, b - a, LANE_H);
        gapLines.push([a, b]);
      }

      // Records, shaded by how many fell in each cell compared with this
      // source's busiest cell in view (log scale, so quiet stretches show)
      const binned = binLane(lane, start, end, bins);
      drawnBins.set(lane.source, binned);
      let max = 0;
      for (const v of binned) if (v > max) max = v;
      const logMax = Math.log1p(max);
      ctx.fillStyle = color;
      for (let b = 0; b < bins; b++) {
        const v = binned[b];
        if (!v) continue;
        ctx.globalAlpha = 0.3 + 0.7 * (logMax ? Math.log1p(v) / logMax : 1);
        const a = (b / bins) * width;
        const w = Math.max(1, ((b + 1) / bins) * width - a);
        ctx.fillRect(a, 1, w, LANE_H - 2);
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = '#f87171';
      for (const [a, b] of gapLines) ctx.fillRect(a, LANE_H - 2, Math.max(1, b - a), 2);

      // Nothing since the last record
      if (today - lane.lastDay >= threshold && lane.lastDay < end) {
        const a = x(Math.max(start, lane.lastDay + 1));
        const b = x(end + 1);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.1)';
        ctx.fillRect(a, 0, b - a, LANE_H);
        ctx.fillStyle = '#fbbf24';
        for (let px = a; px < b; px += 6) ctx.fillRect(px, LANE_H - 2, Math.min(3, b - px), 2);
      }
    }
  });

  function dayAt(clientX: number): number {
    if (!trackEl) return viewStart;
    const rect = trackEl.getBoundingClientRect();
    const f = Math.max(0, Math.min(0.9999, (clientX - rect.left) / rect.width));
    return viewStart + Math.floor(f * (viewEnd - viewStart + 1));
  }

  function showHover(lane: Lane, clientX: number, clientY: number) {
    const bins = drawnBins.get(lane.source);
    if (!bins || !trackEl) return;
    const rect = trackEl.getBoundingClientRect();
    const f = Math.max(0, Math.min(0.9999, (clientX - rect.left) / rect.width));
    const b = Math.floor(f * bins.length);
    const span = viewEnd - viewStart + 1;
    const start = viewStart + Math.ceil((b * span) / bins.length);
    const end = Math.max(start, viewStart + Math.ceil(((b + 1) * span) / bins.length) - 1);
    const day = dayAt(clientX);
    const gap = bins[b] ? null : (lane.gaps.find((g) => day >= g.start && day <= g.end) ?? null);
    hover = {
      source: lane.source,
      start,
      end,
      count: bins[b],
      gap,
      stale: lane.total > 0 && day > lane.lastDay,
      lastDay: lane.lastDay,
      x: clientX,
      y: clientY
    };
  }

  // Drag across the lanes (mouse) or the axis (any pointer) to zoom
  let drag = $state<{ from: number; to: number } | null>(null);

  function startDrag(e: PointerEvent) {
    if (e.button !== 0) return;
    if (e.pointerType !== 'mouse' && !(e.currentTarget as HTMLElement).classList.contains('axis-track')) return;
    const day = dayAt(e.clientX);
    drag = { from: day, to: day };
    hover = null;

    const move = (ev: PointerEvent) => {
      if (drag) drag = { ...drag, to: dayAt(ev.clientX) };
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!drag) return;
      const a = Math.min(drag.from, drag.to);
      const b = Math.max(drag.from, drag.to);
      drag = null;
      // A click is not a zoom; anything narrower than ~6px probably wasn't meant
      if (xOf(b) - xOf(a) >= 6 && b > a) {
        viewStart = a;
        viewEnd = b;
        preset = null;
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  let dragBox = $derived.by(() => {
    if (!drag || !trackEl || !lanesEl) return null;
    const a = Math.min(drag.from, drag.to);
    const b = Math.max(drag.from, drag.to);
    return {
      left: trackEl.offsetLeft + xOf(a),
      width: Math.max(1, xOf(b + 1) - xOf(a)),
      label: formatRange(a, b)
    };
  });

  function toggleExpanded(source: string) {
    const next = new Set(expanded);
    if (next.has(source)) next.delete(source);
    else next.add(source);
    expanded = next;
  }

  function sinceLabel(lane: Lane): string {
    const s = staleDays(lane);
    return s < 2 ? 'now' : String(dayToDate(lane.lastDay).getUTCFullYear());
  }

  let isZoomed = $derived(preset === null);

  // Svelte delegates onclick to the document, so the browser doesn't see the
  // track itself as tappable and nudges taps onto the nearby lane label.
  // A listener on the element keeps taps where the finger lands.
  function tapTarget(node: HTMLElement, handler: (e: PointerEvent) => void) {
    const listener = (e: Event) => handler(e as PointerEvent);
    node.addEventListener('click', listener);
    return {
      update(next: (e: PointerEvent) => void) {
        handler = next;
      },
      destroy() {
        node.removeEventListener('click', listener);
      }
    };
  }
</script>

<svelte:head>
  <title>Coverage · Otso Search</title>
</svelte:head>

<svelte:window onscroll={() => (hover = null)} onpointerdown={() => (hover = null)} />

<div class="page">
  <header>
    <div class="title-row">
      <a class="back" href="/" aria-label="Back to search">❯</a>
      <h1>Coverage</h1>
      {#if loaded}
        <span class="summary">
          {lanes.length} sources · {formatCount(totals.records)} records
          {#if totals.withGaps}· <span class="gap-text">{totals.withGaps} with gaps</span>{/if}
          {#if totals.stale}· <span class="stale-text">{totals.stale} quiet</span>{/if}
        </span>
      {/if}
    </div>

    <div class="controls">
      <div class="segmented" role="group" aria-label="Time range">
        {#each PRESETS as p}
          <button class:active={preset === p.key} onclick={() => setPreset(p.key)}>{p.label}</button>
        {/each}
        {#if isZoomed}
          <button class="active zoom-label" onclick={() => setPreset('all')} aria-label="Reset zoom">
            {formatRange(viewStart, viewEnd)} ×
          </button>
        {/if}
      </div>
      <label class="select">
        <span>gaps ≥</span>
        <select bind:value={gapThreshold}>
          {#each GAP_OPTIONS as o}
            <option value={o.days}>{o.label}</option>
          {/each}
        </select>
      </label>
      <label class="select">
        <span>sort</span>
        <select bind:value={sortMode}>
          <option value="records">records</option>
          <option value="recent">latest</option>
          <option value="stale">quietest</option>
          <option value="first">oldest</option>
          <option value="name">name</option>
        </select>
      </label>
    </div>

    <!-- Shared time axis -->
    <div class="lane axis-row">
      <div class="lane-label axis-spacer"></div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="axis-track" bind:this={trackEl} onpointerdown={startDrag} title="Drag to zoom">
        {#each ticks as t (t.day)}
          <span class="tick" class:major={t.major} style:left="{xOf(t.day)}px">{t.label}</span>
        {/each}
      </div>
      <div class="lane-stats axis-spacer"></div>
    </div>
  </header>

  {#if loadError}
    <p class="message">Couldn't load coverage: {loadError}</p>
  {:else if !loaded}
    <p class="message">Reading the index<span class="loading">...</span></p>
  {:else if lanes.length === 0}
    <p class="message">The index has no records yet.</p>
  {:else}
    <div class="lanes" bind:this={lanesEl}>
      {#each sortedLanes as lane (lane.source)}
        {@const info = getSourceInfo(lane.source)}
        {@const color = getSourceCategory(lane.source).color}
        {@const gaps = bigGaps(lane)}
        {@const stale = staleDays(lane)}
        {@const open = expanded.has(lane.source)}
        <div class="lane" class:open>
          <button
            class="lane-label"
            aria-expanded={open}
            onclick={() => toggleExpanded(lane.source)}
            title={lane.source}
          >
            <span class="icon" style:color>{info.icon}</span>
            <span class="name">{info.label}</span>
          </button>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="lane-track"
            onpointerdown={startDrag}
            onpointermove={(e) => !drag && e.pointerType === 'mouse' && showHover(lane, e.clientX, e.clientY)}
            onpointerleave={(e) => e.pointerType === 'mouse' && (hover = null)}
            use:tapTarget={(e) => {
              if (e.pointerType && e.pointerType !== 'mouse') showHover(lane, e.clientX, e.clientY);
            }}
          >
            <canvas
              bind:this={canvases[lane.source]}
              style:width="{trackWidth}px"
              style:height="{LANE_H}px"
              aria-label="{info.label}: {lane.total} records{gaps.length ? `, ${gaps.length} gaps` : ''}"
            ></canvas>
          </div>
          <div class="lane-stats">
            <span class="count">{formatCount(lane.total)}</span>
            {#if lane.total}
              <span class="years">
                {dayToDate(lane.firstDay).getUTCFullYear()}–<span class:stale-text={stale >= gapThreshold}
                  >{sinceLabel(lane)}</span
                >
              </span>
            {/if}
            {#if gaps.length}
              <span class="gap-text">{gaps.length} gap{gaps.length === 1 ? '' : 's'}</span>
            {/if}
          </div>

          {#if open}
            <div class="details">
              <div class="facts">
                {#if lane.total}
                  <span>First record {formatDay(lane.firstDay)}</span>
                  <span class:stale-text={stale >= gapThreshold}>
                    Latest {formatDay(lane.lastDay)} ({formatAgo(stale)})
                  </span>
                  <span>{lane.days.length.toLocaleString()} days with records</span>
                {/if}
                {#if lane.undated}
                  <span>{lane.undated.toLocaleString()} undated, not shown</span>
                {/if}
                <a href="/?source={encodeURIComponent(lane.source)}">Browse in search ❯</a>
              </div>
              {#if gaps.length}
                <ul class="gap-list">
                  {#each gaps.slice(0, 8) as g (g.start)}
                    <li>
                      <button onclick={() => zoomTo(g.start, g.end)}>
                        <span class="gap-range">{formatRange(g.start, g.end)}</span>
                        <span class="gap-len">{formatSpan(g.length)}</span>
                      </button>
                    </li>
                  {/each}
                  {#if gaps.length > 8}
                    <li class="more">and {gaps.length - 8} shorter</li>
                  {/if}
                </ul>
              {:else if lane.total}
                <p class="no-gaps">No gaps of {GAP_OPTIONS.find((o) => o.days === gapThreshold)?.label} or more.</p>
              {/if}
            </div>
          {/if}
        </div>
      {/each}

      {#if dragBox}
        <div class="drag-box" style:left="{dragBox.left}px" style:width="{dragBox.width}px">
          <span>{dragBox.label}</span>
        </div>
      {/if}
    </div>

    <footer class="legend">
      <span><i class="swatch fill"></i>records, brighter is busier</span>
      <span><i class="swatch gap"></i>gap of {GAP_OPTIONS.find((o) => o.days === gapThreshold)?.label} or more</span>
      <span><i class="swatch stale"></i>nothing since</span>
      {#if hiddenEarly > 0 && !isZoomed && preset === 'all'}
        <button class="link" onclick={() => { showAll = true; setPreset('all'); }}>
          Show {hiddenEarly.toLocaleString()} records before {dayToDate(defaultStart).getUTCFullYear()}
        </button>
      {/if}
      {#if totals.undated}
        <span>{totals.undated.toLocaleString()} undated records aren't shown</span>
      {/if}
      <span class="hint">Drag the {isPhone ? 'date axis' : 'lanes or the axis'} to zoom</span>
    </footer>
  {/if}
</div>

{#if hover}
  {@const info = getSourceInfo(hover.source)}
  <div
    class="tooltip"
    role="tooltip"
    style:left="{Math.min(hover.x + 12, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 230)}px"
    style:top="{hover.y + 16}px"
  >
    <strong>{info.label}</strong>
    <span>{formatRange(hover.start, hover.end)}</span>
    {#if hover.count}
      <span>{hover.count.toLocaleString()} record{hover.count === 1 ? '' : 's'}</span>
    {:else if hover.gap}
      <span class="gap-text">Gap of {formatSpan(hover.gap.length)}: {formatRange(hover.gap.start, hover.gap.end)}</span>
    {:else if hover.stale}
      <span class="stale-text">Nothing since {formatDay(hover.lastDay)}</span>
    {:else}
      <span class="muted">No records</span>
    {/if}
  </div>
{/if}

<style>
  :global(body) {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
    font-size: 14px;
    background: #171717;
    color: #e5e5e5;
  }

  .page {
    max-width: 1400px;
    margin: 0 auto;
    padding-bottom: env(safe-area-inset-bottom);
  }

  header {
    position: sticky;
    top: 0;
    z-index: 10;
    background: #171717;
    border-bottom: 1px solid #262626;
    padding: 12px 12px 0;
  }

  .title-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }

  .back {
    color: #525252;
    text-decoration: none;
    transform: scaleX(-1);
    display: inline-block;
  }

  .back:hover {
    color: #e5e5e5;
  }

  h1 {
    font-size: 14px;
    font-weight: normal;
    margin: 0;
  }

  .summary {
    font-size: 11px;
    color: #737373;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    margin: 10px 0 6px 20px;
  }

  .segmented {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .segmented button,
  .select select {
    font-family: inherit;
    font-size: 11px;
    color: #a3a3a3;
    background: #1f1f1f;
    border: 1px solid #2e2e2e;
    border-radius: 4px;
    padding: 3px 8px;
    cursor: pointer;
  }

  .segmented button.active {
    color: #fff;
    border-color: #3b82f6;
    background: #1e3a5f;
  }

  .select {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #737373;
  }

  /* Lane grid: label | track | stats, shared by the axis and every lane */
  .lane {
    display: grid;
    grid-template-columns: 160px minmax(0, 1fr) 190px;
    grid-template-areas: 'label track stats' 'details details details';
    align-items: center;
    column-gap: 12px;
  }

  .lane-label {
    grid-area: label;
  }

  .lane-track,
  .axis-track {
    grid-area: track;
  }

  .lane-stats {
    grid-area: stats;
  }

  /* Undo the header's side padding so the axis lines up with the lanes */
  .axis-row {
    height: 22px;
    margin: 0 -12px;
    padding: 0 12px 0 0;
  }

  .axis-track {
    position: relative;
    height: 100%;
    cursor: col-resize;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .tick {
    position: absolute;
    bottom: 3px;
    font-size: 10px;
    color: #525252;
    padding-left: 3px;
    border-left: 1px solid #333;
    line-height: 12px;
    white-space: nowrap;
    pointer-events: none;
  }

  .tick.major {
    color: #a3a3a3;
    border-left-color: #525252;
  }

  .lanes {
    position: relative;
    padding: 6px 12px 6px 0;
  }

  .lanes > .lane {
    padding: 1px 0;
  }

  .lanes > .lane:hover {
    background: #1a1a1a;
  }

  .lane-label {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    height: 22px;
    padding: 0 0 0 12px;
    border: none;
    background: none;
    color: #888;
    font-family: inherit;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }

  .lane-label:hover,
  .lane.open .lane-label {
    color: #fff;
  }

  .lane-label .icon {
    width: 16px;
    flex-shrink: 0;
    text-align: center;
    font-size: 12px;
  }

  .lane-label .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lane-track {
    height: 16px;
    cursor: crosshair;
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
  }

  canvas {
    display: block;
  }

  .lane-stats {
    display: flex;
    gap: 10px;
    font-size: 10px;
    color: #737373;
    white-space: nowrap;
  }

  .lane-stats .count {
    min-width: 34px;
    text-align: right;
    color: #a3a3a3;
  }

  .gap-text {
    color: #f87171;
  }

  .stale-text {
    color: #fbbf24;
  }

  .muted {
    color: #737373;
  }

  .details {
    grid-area: details;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 24px;
    padding: 6px 12px 10px 36px;
    font-size: 11px;
    color: #a3a3a3;
  }

  .facts {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .facts a {
    color: #4ecdc4;
    text-decoration: none;
    margin-top: 4px;
  }

  .gap-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 260px;
  }

  .gap-list button {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    border: none;
    background: none;
    padding: 1px 0;
    font-family: inherit;
    font-size: 11px;
    color: #d4d4d4;
    cursor: zoom-in;
    text-align: left;
  }

  .gap-list button:hover .gap-range {
    text-decoration: underline;
  }

  .gap-len {
    color: #f87171;
  }

  .gap-list .more,
  .no-gaps {
    color: #737373;
    margin: 0;
  }

  .drag-box {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(59, 130, 246, 0.15);
    border-left: 1px solid #3b82f6;
    border-right: 1px solid #3b82f6;
    pointer-events: none;
  }

  .drag-box span {
    position: sticky;
    top: 4px;
    display: inline-block;
    margin: 4px;
    padding: 2px 6px;
    font-size: 10px;
    background: #1e3a5f;
    color: #fff;
    border-radius: 3px;
    white-space: nowrap;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    padding: 10px 12px 16px 36px;
    border-top: 1px solid #262626;
    font-size: 10px;
    color: #737373;
  }

  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .swatch {
    display: inline-block;
    width: 14px;
    height: 8px;
  }

  .swatch.fill {
    background: linear-gradient(90deg, rgba(16, 185, 129, 0.3), #10b981);
  }

  .swatch.gap {
    background: rgba(248, 113, 113, 0.2);
    border-bottom: 2px solid #f87171;
  }

  .swatch.stale {
    background: rgba(251, 191, 36, 0.15);
    border-bottom: 2px dashed #fbbf24;
  }

  .link {
    border: none;
    background: none;
    padding: 0;
    font-family: inherit;
    font-size: 10px;
    color: #4ecdc4;
    cursor: pointer;
  }

  .message {
    padding: 24px 36px;
    color: #737373;
  }

  .loading {
    animation: pulse 0.8s infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }

  .tooltip {
    position: fixed;
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 220px;
    padding: 6px 8px;
    background: #262626;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    font-size: 11px;
    color: #e5e5e5;
    pointer-events: none;
  }

  /* ---------- Phones ---------- */
  @media (max-width: 720px), (max-width: 950px) and (pointer: coarse) {
    :global(html) {
      -webkit-text-size-adjust: 100%;
      background: #171717;
    }

    /* Only the date axis stays pinned; the controls scroll away */
    header {
      position: static;
      border-bottom: none;
      padding: calc(10px + env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) 0
        max(12px, env(safe-area-inset-left));
    }

    .axis-row {
      position: sticky;
      top: 0;
      z-index: 10;
      margin: 0 calc(-1 * max(12px, env(safe-area-inset-right))) 0 calc(-1 * max(12px, env(safe-area-inset-left)));
      padding: 0 max(12px, env(safe-area-inset-right)) 0 max(12px, env(safe-area-inset-left));
      background: #171717;
      border-bottom: 1px solid #262626;
    }

    .back {
      font-size: 18px;
      padding: 4px 8px 4px 0;
    }

    h1 {
      font-size: 16px;
    }

    .summary {
      width: 100%;
    }

    .controls {
      margin: 10px 0 8px;
      gap: 8px 12px;
    }

    .segmented button,
    .select select {
      font-size: 12px;
      min-height: 32px;
      padding: 4px 9px;
    }

    .select {
      font-size: 11px;
      gap: 4px;
    }

    /* Under 16px iOS zooms the page when a select gets focus */
    .select select {
      font-size: 16px;
      padding: 2px 6px;
    }

    /* Label and stats share a line above a full-width track */
    .lane {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: 'label stats' 'track track' 'details details';
      column-gap: 8px;
    }

    .axis-row {
      height: 24px;
    }

    .axis-spacer {
      display: none;
    }

    .lanes {
      padding: 4px max(12px, env(safe-area-inset-right)) 4px max(12px, env(safe-area-inset-left));
    }

    .lanes > .lane {
      padding: 2px 0 6px;
    }

    .lanes > .lane:hover {
      background: none;
    }

    .lane-label {
      height: 22px;
      padding: 0;
      font-size: 12px;
      color: #d4d4d4;
    }

    .lane-label .icon {
      font-size: 14px;
    }

    .lane-stats {
      font-size: 10px;
      gap: 8px;
    }

    .lane-stats .count {
      min-width: 0;
    }

    .details {
      padding: 8px 0 4px;
      font-size: 12px;
    }

    .gap-list {
      min-width: 0;
      width: 100%;
    }

    .gap-list button {
      font-size: 12px;
      min-height: 36px;
      align-items: center;
    }

    .facts a {
      display: inline-block;
      padding: 8px 0;
    }

    .legend {
      padding: 12px max(12px, env(safe-area-inset-left)) 20px;
      font-size: 11px;
    }

    .message {
      padding: 24px 16px;
    }
  }
</style>
