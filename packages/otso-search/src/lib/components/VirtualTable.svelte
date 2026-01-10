<script lang="ts">
  import { getSourceInfo } from '$lib/data/sources';
  import { getActionVerb } from '$lib/data/actions';

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

  interface Props {
    results: SearchResult[];
    selectedIdx?: number;
    onLoadMore?: () => void;
    onRowClick?: (id: number) => void;
  }

  let {
    results = [],
    selectedIdx = 0,
    onLoadMore,
    onRowClick,
  }: Props = $props();

  function formatDate(ts: number): string {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  }

  function handleScroll(e: Event) {
    const el = e.target as HTMLDivElement;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Load more when near bottom (within 500px)
    if (distanceFromBottom < 500) {
      console.log('[scroll] near bottom, loading more...', distanceFromBottom);
      onLoadMore?.();
    }
  }
</script>

<div class="container" onscroll={handleScroll}>
  {#each results as result, index}
    {@const info = getSourceInfo(result.source)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="row"
      class:selected={index === selectedIdx}
      onclick={() => onRowClick?.(result.id)}
    >
      <span class="col-source">{info.icon} {info.label}</span>
      <span class="col-action">{getActionVerb(result.entry_type, result.source)}</span>
      <span class="col-title">{@html result.title}</span>
      <span class="col-snippet">{@html result.snippet}</span>
      <span class="col-date">
        {formatDate(result.ts)}
        {#if result.url}
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            class="external-link"
            title={result.url}
            onclick={(e) => e.stopPropagation()}
          >↗</a>
        {/if}
      </span>
    </div>
  {/each}
</div>

<style>
  .container {
    flex: 1;
    overflow-y: auto;
    background: #171717;
  }

  .row {
    height: 32px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    font-size: 13px;
    border-bottom: 1px solid #262626;
    cursor: pointer;
  }

  .row:hover {
    background: #1a1a1a;
  }

  .row.selected {
    background: #1e3a5f;
  }

  .col-source {
    width: 100px;
    flex-shrink: 0;
    color: #888;
  }

  .col-action {
    width: 80px;
    flex-shrink: 0;
    color: #666;
    font-style: italic;
  }

  .col-title {
    width: 300px;
    flex-shrink: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .col-snippet {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #888;
  }

  .col-date {
    position: relative;
    width: 100px;
    flex-shrink: 0;
    text-align: right;
    color: #666;
  }

  .external-link {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    opacity: 0;
    padding: 0 4px 0 24px;
    background: linear-gradient(to right, transparent, #171717 40%);
    color: #888;
    text-decoration: none;
    transition: opacity 0.15s;
  }

  .row:hover .external-link {
    background: linear-gradient(to right, transparent, #1a1a1a 40%);
  }

  .row.selected .external-link {
    background: linear-gradient(to right, transparent, #1e3a5f 40%);
  }

  .external-link:hover {
    color: #fff;
  }

  .row:hover .external-link {
    opacity: 1;
  }

  :global(.row mark) {
    background: transparent;
    color: #fbbf24;
  }
</style>
