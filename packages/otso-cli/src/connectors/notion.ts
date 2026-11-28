import type { TableDef } from '../core/chronicle.js';
import { getJson } from '../core/http.js';
import { iso } from '../core/time.js';
import type { Connector, RunStats } from './types.js';
import { addStats } from './util.js';

/**
 * Notion pages through an internal integration token. The integration only
 * sees pages you share with it (a page's ••• menu > Connections), and every
 * page under them.
 *
 * Writes the same `pages` table the one-time Notion export import filled,
 * keyed on the page id without dashes as the export used, so synced pages
 * replace their exported copies instead of appearing twice.
 *
 * Search is sorted by last edit, so after the first sync each run reads only
 * pages edited since the newest one it stored, then fetches each one's blocks.
 */

const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
/** Notion allows about three requests a second. */
export const notionPacing = { minIntervalMs: 350 };
/** Nesting below this is rare and each level is another request per block. */
const MAX_DEPTH = 6;

export const NOTION_PAGES_TABLE: TableDef = {
  name: 'pages',
  key: 'id',
  columns: ['id', 'title', 'content', 'created_time', 'url', 'kind', 'path', 'last_edited_time'],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
async function call<T = any>(token: string, path: string, body?: unknown): Promise<T> {
  const wait = lastCall + notionPacing.minIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  return getJson<T>(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': VERSION, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  });
}

const plain = (rich: any[] | undefined) => (rich ?? []).map((t) => t.plain_text ?? '').join('');

export function pageTitle(page: any): string {
  for (const p of Object.values(page.properties ?? {}) as any[]) if (p?.type === 'title') return plain(p.title);
  return plain(page.title);
}

/** One block as a line of text, Markdown-ish. */
export function blockText(b: any): string {
  const v = b[b.type] ?? {};
  const text = plain(v.rich_text) || plain(v.caption);
  switch (b.type) {
    case 'heading_1': return `# ${text}`;
    case 'heading_2': return `## ${text}`;
    case 'heading_3': return `### ${text}`;
    case 'bulleted_list_item': return `- ${text}`;
    case 'numbered_list_item': return `1. ${text}`;
    case 'to_do': return `- [${v.checked ? 'x' : ' '}] ${text}`;
    case 'quote': return `> ${text}`;
    case 'code': return '```\n' + text + '\n```';
    case 'child_page': return v.title ?? '';
    case 'child_database': return v.title ?? '';
    case 'bookmark': case 'embed': case 'link_preview': return [v.url, text].filter(Boolean).join(' ');
    case 'equation': return v.expression ?? '';
    case 'table_row': return (v.cells ?? []).map(plain).join(' | ');
    default: return text;
  }
}

async function pageContent(token: string, id: string, depth = 0): Promise<string> {
  const lines: string[] = [];
  let cursor: string | undefined;
  do {
    const res: any = await call(token, `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    for (const b of res.results ?? []) {
      const line = blockText(b);
      if (line) lines.push(line);
      // Child pages are synced as pages of their own; don't inline them.
      if (b.has_children && b.type !== 'child_page' && b.type !== 'child_database' && depth < MAX_DEPTH) {
        const inner = await pageContent(token, b.id, depth + 1);
        if (inner) lines.push(inner);
      }
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return lines.join('\n');
}

export const notion: Connector = {
  id: 'notion',
  displayName: 'Notion',
  description: 'Pages shared with your integration',
  kind: 'api',
  dbPath: 'notion/chronicle/chronicle.db',
  tables: [NOTION_PAGES_TABLE],

  auth: {
    setupUrl: 'https://www.notion.so/profile/integrations',
    instructions: [
      'Open notion.so/profile/integrations and create an internal integration (read content is enough).',
      'Copy its secret, then share your top-level pages with it from each page\'s ••• menu > Connections.',
    ],
    fields: [{ name: 'accessToken', label: 'Integration secret', secret: true, placeholder: 'ntn_…' }],
    async verify(creds) {
      const me = await call<any>(creds.accessToken, '/users/me');
      if (!me?.id) throw new Error('Notion did not accept the token');
      return me.bot?.workspace_name || me.name || 'Notion';
    },
  },

  async sync({ store, credentials, full, log }) {
    const token = credentials.accessToken;
    const since = full ? null : store.getState('last_edited_time');
    let newest = since ?? '';
    let read = 0;
    const stats: RunStats = {};

    let cursor: string | undefined;
    search: do {
      const res: any = await call(token, '/search', {
        filter: { property: 'object', value: 'page' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      for (const page of res.results ?? []) {
        if (since && page.last_edited_time <= since) break search;
        if (page.last_edited_time > newest) newest = page.last_edited_time;
        if (page.archived || page.in_trash) {
          store.deleteKeys(NOTION_PAGES_TABLE, [page.id.replace(/-/g, '')]);
          continue;
        }
        const row = {
          id: page.id.replace(/-/g, ''),
          title: pageTitle(page) || 'Untitled',
          content: await pageContent(token, page.id),
          created_time: iso(page.created_time),
          last_edited_time: iso(page.last_edited_time),
          url: page.url,
          kind: page.parent?.type === 'database_id' ? 'database row' : 'page',
          path: null,
        };
        addStats(stats, 'pages', store.upsert(NOTION_PAGES_TABLE, [row]));
        read++;
        if (read % 25 === 0) log(`${read} pages so far`);
      }
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);

    if (newest) store.setState('last_edited_time', newest);
    log(`${read.toLocaleString()} pages${since ? ' edited since last sync' : ''}`);
    return stats;
  },
};
