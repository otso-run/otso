import type { TableDef } from '../../core/chronicle.js';
import { iso } from '../../core/time.js';
import { htmlToText, shortHash } from '../util.js';

/**
 * My Activity: Takeout/My Activity/<Product>/MyActivity.json.
 *   Gemini Apps   -> gemini (prompt as the title, Gemini's reply as text)
 *   Search        -> google_search (searches only; see google-takeout.ts)
 *   everything else -> google_activity, one row per item with its product
 * Products that another table already covers in full are skipped, so the
 * same thing isn't indexed twice: Chrome (Chrome/History.json), YouTube
 * (watch-history.json) and Ads (ads shown to you, not your activity).
 */

export const GEMINI_TABLE: TableDef = {
  name: 'gemini',
  key: 'source_id',
  columns: ['source_id', 'prompt', 'response', 'attachments', 'startTime'],
};

export const ACTIVITY_TABLE: TableDef = {
  name: 'google_activity',
  key: 'source_id',
  columns: ['source_id', 'product', 'title', 'url', 'details', 'startTime'],
};

export const SKIPPED_ACTIVITY = /^(search|chrome|youtube|ads|gemini apps)$/i;

export function geminiRows(items: any[]) {
  return (items ?? [])
    .filter((i) => typeof i?.title === 'string' && i.time)
    .map((i) => {
      const prompt = i.title.replace(/^Prompted /, '');
      const startTime = iso(i.time);
      return {
        source_id: `gemini-${shortHash(startTime, prompt)}`,
        prompt,
        response: htmlToText((i.safeHtmlItem ?? []).map((h: any) => h?.html ?? '').join('\n')),
        attachments: i.attachedFiles?.length ? i.attachedFiles : null,
        startTime,
      };
    });
}

export function activityRows(items: any[], folder: string) {
  return (items ?? [])
    .filter((i) => typeof i?.title === 'string' && i.time)
    .map((i) => {
      const startTime = iso(i.time);
      const product = i.header || folder;
      const details = [
        ...(i.subtitles ?? []).map((s: any) => s?.name),
        ...(i.details ?? []).map((d: any) => d?.name),
        i.description,
      ].filter(Boolean);
      return {
        source_id: `act-${shortHash(product, startTime, i.title, i.titleUrl)}`,
        product,
        title: i.title,
        url: i.titleUrl ?? null,
        details: details.join('\n'),
        startTime,
      };
    });
}
