import type { TableDef } from '../../core/chronicle.js';
import { iso } from '../../core/time.js';
import { htmlToText, shortHash } from '../util.js';

/**
 * Google Voice: Takeout/Voice/Calls/*.html, one file per text thread or call:
 *   "<name or number> - Text - 2023-03-01T15_04_05Z.html"
 *   "<name or number> - Voicemail|Received|Placed|Missed|Recorded - <time>.html"
 *   "Group Conversation - <time>.html"
 * Texts become one row per message; calls one row each, with the
 * voicemail transcript as the text.
 */

export const VOICE_TABLE: TableDef = {
  name: 'google_voice',
  key: 'source_id',
  columns: ['source_id', 'kind', 'conversation', 'name', 'number', 'text', 'startTime', 'duration'],
};

const attr = (html: string, cls: string, name = 'title') =>
  html.match(new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"[^>]*\\b${name}="([^"]*)"`))?.[1] ??
  html.match(new RegExp(`\\b${name}="([^"]*)"[^>]*class="[^"]*\\b${cls}\\b`))?.[1];

const fn = (html: string) => {
  const m = html.match(/class="fn"[^>]*>([^<]*)</);
  return m ? htmlToText(m[1]) : null;
};
const tel = (html: string) => html.match(/href="tel:([^"]*)"/)?.[1] || null;

/** PT1M23S -> 83 (seconds) */
export function isoDuration(v?: string): number | null {
  const m = v?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Math.round(Number(m[4] ?? 0));
}

/** Parse one Voice HTML file; the kind comes from its file name. */
export function voiceRows(fileName: string, html: string) {
  const base = fileName.replace(/\.html$/i, '');
  const parts = base.split(' - ');
  const group = /^Group Conversation/i.test(base);
  const kind = (group ? 'text' : parts.length >= 3 ? parts[parts.length - 2] : 'text').toLowerCase();
  const conversation = group ? 'Group conversation' : parts.slice(0, Math.max(1, parts.length - 2)).join(' - ');

  if (kind === 'text') {
    const rows = [];
    for (const m of html.matchAll(/<div class="message">([\s\S]*?)<\/div>/g)) {
      const block = m[1];
      const time = iso(attr(block, 'dt'));
      const text = htmlToText(block.match(/<q>([\s\S]*?)<\/q>/)?.[1] ?? '');
      const number = tel(block);
      const name = fn(block) || number || 'Unknown';
      rows.push({
        source_id: `voice-${shortHash('text', time, number, name, text)}`,
        kind,
        conversation,
        name,
        number,
        text,
        startTime: time,
        duration: null,
      });
    }
    return rows;
  }

  const contributor = html.match(/class="contributor vcard"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? html;
  const time = iso(attr(html, 'published'));
  const number = tel(contributor);
  const transcript = html.match(/class="full-text"[^>]*>([\s\S]*?)<\/span>/)?.[1];
  return [
    {
      source_id: `voice-${shortHash(kind, time, number)}`,
      kind,
      conversation,
      name: fn(contributor) || number || conversation,
      number,
      text: transcript ? htmlToText(transcript) : '',
      startTime: time,
      duration: isoDuration(attr(html, 'duration')),
    },
  ];
}
