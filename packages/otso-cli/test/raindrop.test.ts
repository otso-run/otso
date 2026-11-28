import { afterEach, describe, expect, test } from 'bun:test';
import { authenticate, runSync } from '../src/core/runner.js';
import { mockFetch, runTomlQueries, sandbox } from './helpers.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const drop = (id: number, lastUpdate: string, extra: Record<string, unknown> = {}) => ({
  _id: id,
  title: `Bookmark ${id}`,
  link: `https://example.com/${id}`,
  excerpt: 'an excerpt',
  note: '',
  tags: ['design'],
  type: 'link',
  domain: 'example.com',
  created: '2024-01-03T18:40:00.000Z',
  lastUpdate,
  collection: { $id: 10 },
  highlights: [],
  ...extra,
});

describe('raindrop', () => {
  test('pages everything once, then only reads bookmarks changed since; trash is removed', async () => {
    const { sources } = sandbox();
    // 60 bookmarks, newest change first, as sort=-lastUpdate returns them.
    let all = Array.from({ length: 60 }, (_, i) => drop(60 - i, `2024-02-${String(29 - Math.floor(i / 3)).padStart(2, '0')}T00:00:00.000Z`));
    all[0] = drop(60, all[0].lastUpdate, { note: 'my note', highlights: [{ text: 'a highlighted line', note: 'why' }] });
    let trash: any[] = [];
    const calls = mockFetch([
      { match: /\/user$/, respond: () => ({ body: { result: true, user: { fullName: 'Test User' } } }) },
      { match: /\/collections$/, respond: () => ({ body: { items: [{ _id: 10, title: 'Reading' }] } }) },
      { match: /\/collections\/childrens$/, respond: () => ({ body: { items: [] } }) },
      { match: /\/raindrops\/-99/, respond: (u) => ({ body: { items: u.searchParams.get('page') === '0' ? trash : [] } }) },
      {
        match: /\/raindrops\/0/,
        respond: (u) => {
          const page = Number(u.searchParams.get('page'));
          return { body: { items: all.slice(page * 50, page * 50 + 50) } };
        },
      },
    ]);

    expect(await authenticate('raindrop', { accessToken: 'tok' })).toBe('Test User');
    const first = await runSync('raindrop');
    expect(first.stats.events.inserted).toBe(60);

    const rows = runTomlQueries('raindrop', sources);
    expect(rows).toHaveLength(60);
    const top = rows.find((r: any) => r.external_id === 'raindrop-60');
    expect(top.content).toBe('an excerpt my note a highlighted line why design Reading');
    expect(top.occurred_at).toBe('2024-01-03T18:40:00Z');
    expect(top.url).toBe('https://example.com/60');

    // One bookmark edited, one moved to the trash.
    all = [drop(5, '2024-03-01T00:00:00.000Z', { title: 'Renamed' }), ...all.filter((r) => r._id !== 5 && r._id !== 7)];
    trash = [drop(7, '2024-03-01T00:00:00.000Z')];
    calls.length = 0;
    const second = await runSync('raindrop');
    expect(second.stats.events).toEqual({ inserted: 0, updated: 1 });
    // Stopped on the first page: it reached bookmarks unchanged since the last sync.
    expect(calls.filter((c) => c.includes('/raindrops/0')).length).toBe(1);
    const after = runTomlQueries('raindrop', sources);
    expect(after).toHaveLength(59);
    expect(after.find((r: any) => r.external_id === 'raindrop-5').title).toBe('Renamed');
  });
});
