/**
 * Search results come from personal archives, but much of that text was
 * written by other people (calendar invites, messages, emails, saved pages).
 * Escape it all, then put back only the <mark> tags the search engine adds
 * around matches.
 */
export function highlighted(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/&lt;mark&gt;/g, '<mark>')
    .replace(/&lt;\/mark&gt;/g, '</mark>');
}

/** Only web, mail and file links are opened; anything else (javascript:, data:) is dropped. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return ['http:', 'https:', 'mailto:', 'file:'].includes(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}
