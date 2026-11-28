import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { notionPacing } from '../src/connectors/notion.js';
import { authenticate, runSync } from '../src/core/runner.js';
import { mockFetch, runTomlQueries, sandbox } from './helpers.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ID = '2ba24e05-0000-4000-8000-000000000001';
const page = (id: string, edited: string, extra: Record<string, unknown> = {}) => ({
  object: 'page',
  id,
  created_time: '2024-01-03T18:40:00.000Z',
  last_edited_time: edited,
  url: `https://www.notion.so/${id.replace(/-/g, '')}`,
  parent: { type: 'workspace' },
  properties: { title: { type: 'title', title: [{ plain_text: 'Reading list' }] } },
  ...extra,
});
const para = (text: string, extra: Record<string, unknown> = {}) => ({ id: `b-${text}`, type: 'paragraph', has_children: false, paragraph: { rich_text: [{ plain_text: text }] }, ...extra });

test('notion: pages with nested blocks; replaces the exported copy; only edited pages next time', async () => {
  notionPacing.minIntervalMs = 0;
  const { sources } = sandbox();
  // A row from the one-time export, keyed on the dashless id.
  const db = join(sources, 'notion/chronicle/chronicle.db');
  mkdirSync(dirname(db), { recursive: true });
  const old = new Database(db, { create: true });
  old.exec(`CREATE TABLE pages (id TEXT, title TEXT, content TEXT, created_time TEXT, url TEXT, kind TEXT, path TEXT);
            INSERT INTO pages VALUES ('${ID.replace(/-/g, '')}', 'Reading list', 'old', '2024-01-03T18:40:00Z', NULL, 'page', 'Reading list.md');`);
  old.close();

  let results = [page(ID, '2024-02-01T00:00:00.000Z')];
  const calls = mockFetch([
    { match: /\/users\/me$/, respond: () => ({ body: { id: 'bot', bot: { workspace_name: 'Test Space' } } }) },
    { match: /\/search$/, respond: () => ({ body: { results, has_more: false, next_cursor: null } }) },
    {
      match: new RegExp(`/blocks/${ID}/children`),
      respond: () => ({
        body: {
          results: [
            { id: 'h', type: 'heading_2', has_children: false, heading_2: { rich_text: [{ plain_text: 'Books' }] } },
            { id: 'todo', type: 'to_do', has_children: true, to_do: { checked: true, rich_text: [{ plain_text: 'Dune' }] } },
          ],
          has_more: false,
        },
      }),
    },
    { match: /\/blocks\/todo\/children/, respond: () => ({ body: { results: [para('re-read')], has_more: false } }) },
  ]);

  expect(await authenticate('notion', { accessToken: 'ntn_x' })).toBe('Test Space');
  const first = await runSync('notion');
  expect(first.stats.pages).toEqual({ inserted: 0, updated: 1 });
  expect(runTomlQueries('notion', sources)).toEqual([
    { external_id: ID.replace(/-/g, ''), title: 'Reading list', content: '## Books\n- [x] Dune\nre-read', occurred_at: '2024-01-03T18:40:00Z', url: `https://www.notion.so/${ID.replace(/-/g, '')}` },
  ]);

  calls.length = 0;
  await runSync('notion');
  expect(calls.some((c) => c.includes('/blocks/'))).toBe(false);

  results = [page(ID, '2024-03-01T00:00:00.000Z', { in_trash: true })];
  await runSync('notion');
  expect(runTomlQueries('notion', sources)).toEqual([]);
});
