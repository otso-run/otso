<script lang="ts">
  import { CATEGORIES } from '$lib/data/sources';

  interface CategoryCount {
    key: string;
    count: number;
  }

  interface Props {
    categories: CategoryCount[];
    selected: Set<string>;
    onToggle: (key: string) => void;
    onClear: () => void;
  }

  let { categories, selected, onToggle, onClear }: Props = $props();

  let hasSelection = $derived(selected.size > 0);
</script>

<div class="filters">
  {#if hasSelection}
    <button class="clear" onclick={onClear}>clear</button>
  {/if}
  {#each categories as { key, count }}
    {@const cat = CATEGORIES[key]}
    {@const isSelected = selected.has(key)}
    <button
      class="cat"
      class:selected={isSelected}
      class:dimmed={hasSelection && !isSelected}
      style:--cat-color={cat?.color || '#525252'}
      onclick={() => onToggle(key)}
    >
      {key}
    </button>
  {/each}
</div>

<style>
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .clear {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    color: #999;
    background-color: #333;
    font-family: inherit;
    margin-right: 4px;
  }

  .cat {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px 6px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    color: var(--cat-color);
    background-color: transparent;
    font-family: inherit;
    transition: opacity 0.1s, background-color 0.1s, color 0.1s;
  }

  .cat.selected {
    color: #171717;
    background-color: var(--cat-color);
  }

  .cat.dimmed {
    opacity: 0.3;
  }

  .cat:hover:not(.selected) {
    background-color: color-mix(in srgb, var(--cat-color) 20%, transparent);
  }
</style>
