import type { TableDef } from '../../core/chronicle.js';
import { iso } from '../../core/time.js';
import { htmlToText, shortHash } from '../util.js';

/**
 * Text documents from products whose Takeout is a folder of files:
 *   NotebookLM/<notebook>/...  notes, chat history and text sources
 *   Gemini/...                 Gems and other Gemini files
 * Each text-like file (html, txt, md, json, csv) becomes one row named
 * after its folder and file. PDFs, images and audio are left on disk.
 * Files carry no dates of their own, so each is dated by its timestamp
 * in the export.
 */

export const DOCUMENTS_TABLE: TableDef = {
  name: 'google_documents',
  key: 'source_id',
  columns: ['source_id', 'product', 'collection', 'name', 'path', 'text', 'startTime'],
};

export const TEXT_FILE = /\.(html?|txt|md|json|csv)$/i;
const MAX_TEXT = 64_000;

/** Every string value in a JSON document, in order, as plain text. */
export function jsonText(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') {
    const s = /<\/?[a-z][^>]*>/i.test(v) ? htmlToText(v) : v.trim();
    // Skip ids, timestamps and urls; keep words.
    if (s && /\s|[^\x00-\x7f]/.test(s) && !/^https?:\/\/\S+$/.test(s)) out.push(s);
  } else if (Array.isArray(v)) for (const x of v) jsonText(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) jsonText(x, out);
  return out;
}

export function documentRow(product: string, relPath: string, content: string, mtime: Date | null) {
  // relPath is inside the product folder: "<collection>/<...>/<file>"
  const segs = relPath.split('/');
  const file = segs[segs.length - 1];
  const collection = segs.length > 1 ? segs[0] : product;
  const ext = file.split('.').pop()!.toLowerCase();
  let text: string;
  if (ext === 'json') {
    try {
      text = jsonText(JSON.parse(content)).join('\n');
    } catch {
      text = content;
    }
  } else text = ext === 'html' || ext === 'htm' ? htmlToText(content) : content.trim();
  if (!text) return null;
  return {
    source_id: `doc-${shortHash(product, relPath)}`,
    product,
    collection,
    name: file.replace(/\.[^.]+$/, ''),
    path: relPath,
    text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text,
    startTime: mtime ? iso(mtime) : null,
  };
}
