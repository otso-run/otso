import type { TableDef } from '../../core/chronicle.js';
import { iso } from '../../core/time.js';

/** Google Keep: Takeout/Keep/<note>.json, one file per note. Trashed notes are skipped. */

export const KEEP_TABLE: TableDef = {
  name: 'google_keep',
  key: 'source_id',
  columns: ['source_id', 'title', 'text', 'labels', 'links', 'pinned', 'archived', 'created', 'edited'],
};

const usec = (v: unknown) => (v === undefined || v === null || v === '' ? null : iso(Math.floor(Number(v) / 1000)));

export function keepRow(note: any, fileName: string) {
  if (!note || note.isTrashed) return null;
  const list = (note.listContent ?? []).map((i: any) => `${i.isChecked ? '[x]' : '[ ]'} ${i.text ?? ''}`).join('\n');
  const text = [note.textContent, list].filter(Boolean).join('\n');
  const links = (note.annotations ?? []).filter((a: any) => a?.url).map((a: any) => ({ url: a.url, title: a.title ?? null }));
  if (!note.title && !text && !links.length) return null;
  return {
    // The file name is Keep's own stable name for the note.
    source_id: `keep-${fileName.replace(/\.json$/i, '')}`,
    title: note.title ?? '',
    text,
    labels: (note.labels ?? []).map((l: any) => l.name).filter(Boolean),
    links: links.length ? links : null,
    pinned: note.isPinned ? 1 : 0,
    archived: note.isArchived ? 1 : 0,
    created: usec(note.createdTimestampUsec) ?? usec(note.userEditedTimestampUsec),
    edited: usec(note.userEditedTimestampUsec),
  };
}
