<script lang="ts">
  interface Props {
    documentId: number | null;
    onClose: () => void;
  }

  let { documentId, onClose }: Props = $props();

  let document = $state<Record<string, unknown> | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    if (documentId === null) {
      document = null;
      error = null;
      return;
    }

    loading = true;
    error = null;

    fetch(`/api/document/${documentId}`)
      .then(res => {
        if (!res.ok) throw new Error(`Document not found`);
        return res.json();
      })
      .then(data => {
        document = data;
      })
      .catch(err => {
        error = err.message;
      })
      .finally(() => {
        loading = false;
      });
  });

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if documentId !== null}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="backdrop"
    onclick={handleBackdropClick}
    onkeydown={handleKeyDown}
    role="dialog"
    aria-modal="true"
    aria-label="Document details"
  >
    <div class="modal">
      <div class="header">
        <span class="title">Document #{documentId}</span>
        <button class="close" onclick={onClose}>×</button>
      </div>
      <div class="content">
        {#if loading}
          <div class="loading">Loading...</div>
        {:else if error}
          <div class="error">{error}</div>
        {:else if document}
          <pre>{JSON.stringify(document, null, 2)}</pre>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 8px;
    max-width: 800px;
    max-height: 80vh;
    width: 90%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #333;
  }

  .title {
    font-size: 14px;
    color: #888;
  }

  .close {
    background: none;
    border: none;
    color: #888;
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .close:hover {
    color: #fff;
  }

  .content {
    padding: 16px;
    overflow: auto;
    flex: 1;
  }

  .loading, .error {
    color: #888;
    font-size: 14px;
  }

  .error {
    color: #f87171;
  }

  pre {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-wrap: break-word;
    color: #e5e5e5;
  }
</style>
