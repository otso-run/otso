<script lang="ts">
  import { safeHref } from '$lib/safe-html';
  import { getSourceInfo } from '$lib/data/sources';

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

  // Readable summary shown on phones above the raw record
  let summary = $derived.by(() => {
    if (!document) return null;
    const text = (v: unknown) => (typeof v === 'string' ? v : '');
    const ts = typeof document.ts === 'number' ? document.ts : 0;
    return {
      title: text(document.title),
      content: text(document.content),
      url: /^https?:\/\//.test(text(document.url)) ? text(document.url) : '',
      source: getSourceInfo(text(document.source)),
      date: ts
        ? new Date(ts * 1000).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
        : ''
    };
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
        <button class="close" onclick={onClose} aria-label="Close">×</button>
      </div>
      <div class="content">
        {#if loading}
          <div class="loading">Loading...</div>
        {:else if error}
          <div class="error">{error}</div>
        {:else if document}
          {#if summary}
            <div class="summary">
              <div class="summary-meta">
                {summary.source.icon} {summary.source.label}{#if summary.date}&nbsp;· {summary.date}{/if}
              </div>
              {#if summary.title}<h2>{summary.title}</h2>{/if}
              {#if summary.content && summary.content !== summary.title}
                <p>{summary.content}</p>
              {/if}
              {#if safeHref(summary.url)}
                <a class="open-link" href={safeHref(summary.url)} target="_blank" rel="noopener noreferrer">
                  Open link ↗
                </a>
              {/if}
              <div class="raw-label">Raw record</div>
            </div>
          {/if}
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

  .summary {
    display: none;
  }

  /* Phones: a bottom sheet with a readable summary and a way to open the link */
  @media (max-width: 720px), (max-width: 950px) and (pointer: coarse) {
    .backdrop {
      align-items: flex-end;
    }

    .modal {
      width: 100%;
      max-width: none;
      max-height: 88vh;
      max-height: 88dvh;
      border: none;
      border-top: 1px solid #333;
      border-radius: 16px 16px 0 0;
    }

    .header {
      padding: 4px 4px 4px 16px;
    }

    .close {
      width: 44px;
      height: 44px;
    }

    .content {
      padding: 16px max(16px, env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom))
        max(16px, env(safe-area-inset-left));
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
    }

    .summary {
      display: block;
    }

    .summary-meta {
      font-size: 12px;
      color: #8a8a8a;
    }

    .summary h2 {
      margin: 8px 0 0;
      font-size: 17px;
      font-weight: 600;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .summary p {
      margin: 10px 0 0;
      font-size: 14px;
      line-height: 1.55;
      color: #c8c8c8;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .open-link {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 44px;
      margin-top: 16px;
      border-radius: 12px;
      background: #1e3a5f;
      color: #fff;
      font-size: 14px;
      text-decoration: none;
    }

    .raw-label {
      margin: 20px 0 8px;
      padding-top: 12px;
      border-top: 1px solid #2a2a2a;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #666;
    }

    pre {
      font-size: 11px;
      color: #9a9a9a;
    }
  }
</style>
