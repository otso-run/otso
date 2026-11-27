import { afterEach, describe, expect, test } from 'bun:test';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { loadCredentials } from '../src/core/credentials.js';
import { authenticate, runSync } from '../src/core/runner.js';
import { mockFetch, runTomlQueries, sandbox } from './helpers.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('auth', () => {
  test('verifies before saving, and saves owner-only', async () => {
    const { root } = sandbox();
    mockFetch([{ match: /readwise\.io\/api\/v2\/auth/, respond: () => ({ status: 401 }) }]);
    await expect(authenticate('readwise', { accessToken: 'bad-token' })).rejects.toThrow(/rejected/);
    expect(await loadCredentials('readwise')).toBeNull();

    mockFetch([{ match: /readwise\.io\/api\/v2\/auth/, respond: () => ({ status: 204 }) }]);
    await authenticate('readwise', { accessToken: '  good-token \n' });
    expect((await loadCredentials('readwise'))?.accessToken).toBe('good-token');
    const mode = statSync(join(root, 'config', 'readwise-credentials.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test('sync without auth says how to connect', async () => {
    sandbox();
    await expect(runSync('arena')).rejects.toThrow(/otso auth arena/);
  });
});

describe('are.na', () => {
  test('fetches channels and blocks; skips unchanged channels next time', async () => {
    const { sources } = sandbox();
    let updatedAt = '2024-01-01T00:00:00Z';
    const page = (u: URL, items: any[]) =>
      u.searchParams.get('page') === '1' ? { data: items, meta: { has_more_pages: false } } : { data: [], meta: { has_more_pages: false } };
    const calls = mockFetch([
      { match: /\/v3\/me$/, respond: () => ({ body: { id: 7, slug: 'testuser', name: 'Test User' } }) },
      {
        match: /\/v3\/users\/7\/contents/,
        respond: (u) => ({
          body: page(u, [
            { id: 1, type: 'Channel', title: 'Refs', slug: 'refs', created_at: '2023-01-01T00:00:00Z', updated_at: updatedAt, description: { markdown: 'd' } },
          ]),
        }),
      },
      {
        match: /\/v3\/channels\/1\/contents/,
        respond: (u) => ({
          body: page(u, [
            { id: 10, base_type: 'Block', type: 'Link', title: 'A link', description: { markdown: 'about' }, created_at: '2023-02-01T00:00:00Z', source: { url: 'https://a.example' }, connection: { connected_at: '2023-02-01T00:00:00Z' } },
            { id: 11, base_type: 'Block', type: 'Text', title: 'Note', content: { markdown: 'text body' }, created_at: '2023-02-02T00:00:00Z' },
            { id: 12, type: 'Channel', title: 'Nested' },
          ]),
        }),
      },
    ]);

    expect(await authenticate('arena', { accessToken: 'x'.repeat(30) })).toBe('testuser');
    const first = await runSync('arena');
    expect(first.stats).toEqual({ channels: { inserted: 1, updated: 0 }, blocks: { inserted: 2, updated: 0 } });
    expect(calls.some((c) => c.includes('page=1&per=100'))).toBe(true);

    const rows = runTomlQueries('arena', sources);
    expect(rows.map((r: any) => r.title).sort()).toEqual(['A link', 'Note', 'Refs']);
    expect(rows.find((r: any) => r.title === 'Refs').url).toBe('https://are.na/channel/refs');

    calls.length = 0;
    await runSync('arena');
    expect(calls.some((c) => c.includes('/channels/1/contents'))).toBe(false);

    updatedAt = '2024-02-01T00:00:00Z';
    const third = await runSync('arena');
    expect(third.stats.blocks).toEqual({ inserted: 0, updated: 2 });
  });
});

describe('readwise', () => {
  test('pages through the export and only asks for updates afterwards', async () => {
    const { sources } = sandbox();
    const calls = mockFetch([
      { match: /\/auth\//, respond: () => ({ status: 204 }) },
      {
        match: /\/export\//,
        respond: (u) => ({
          body: u.searchParams.get('pageCursor')
            ? { results: [{ title: 'Book B', highlights: [{ id: 2, text: 'second', highlighted_at: '2024-01-02T00:00:00Z' }] }], nextPageCursor: null }
            : { results: [{ title: 'Book A', source_url: 'https://a', highlights: [{ id: 1, text: 'first', created_at: '2024-01-01T00:00:00Z' }] }], nextPageCursor: 'p2' },
        }),
      },
      {
        match: /\/api\/v3\/list\//,
        respond: () => ({
          body: {
            results: [
              { id: '01docA', title: 'An article', source_url: 'https://article', summary: 'about it', location: 'later', saved_at: '2024-02-01T00:00:00Z', tags: {} },
              { id: '01feed', title: 'RSS item', location: 'feed', saved_at: '2024-02-01T00:00:00Z' },
              { id: '01hl', parent_id: '01docA', title: 'a highlight', location: 'later', saved_at: '2024-02-01T00:00:00Z' },
            ],
            nextPageCursor: null,
          },
        }),
      },
    ]);
    await authenticate('readwise', { accessToken: 'tok' });
    const r = await runSync('readwise');
    expect(r.stats.events.inserted).toBe(3);
    expect(runTomlQueries('readwise', sources).map((x: any) => [x.title, x.content])).toEqual([
      ['Book A', 'first'],
      ['Book B', 'second'],
      ['An article', 'about it'],
    ]);
    calls.length = 0;
    await runSync('readwise');
    expect(calls[0]).toContain('updatedAfter=');
  });
});

describe('pinboard', () => {
  test('skips posts/all when posts/update is unchanged', async () => {
    const { sources } = sandbox();
    const calls = mockFetch([
      { match: /api_token/, respond: () => ({ body: { result: 'ABC' } }) },
      { match: /posts\/update/, respond: () => ({ body: { update_time: '2024-01-01T00:00:00Z' } }) },
      {
        match: /posts\/all/,
        respond: () => ({ body: [{ href: 'https://e.com', description: 'E', extended: '', hash: 'h', time: '2023-01-01T00:00:00Z', tags: 'x' }] }),
      },
    ]);
    expect(await authenticate('pinboard', { accessToken: 'testuser:ABC' })).toBe('testuser');
    await runSync('pinboard');
    expect(runTomlQueries('pinboard', sources)).toHaveLength(1);
    calls.length = 0;
    await runSync('pinboard');
    expect(calls.some((c) => c.includes('posts/all'))).toBe(false);
  });
});

describe('last.fm', () => {
  test('walks pages, ignores now-playing, resumes from the newest scrobble', async () => {
    const { sources } = sandbox();
    const calls = mockFetch([
      { match: /user\.getinfo/, respond: () => ({ body: { user: { name: 'testuser' } } }) },
      {
        match: /user\.getrecenttracks/,
        respond: (u) => ({
          body: {
            recenttracks: {
              '@attr': { totalPages: '2' },
              track:
                u.searchParams.get('page') === '1'
                  ? [
                      { name: 'Now', artist: { '#text': 'A' }, album: { '#text': '' }, '@attr': { nowplaying: 'true' } },
                      { name: 'T2', artist: { '#text': 'A' }, album: { '#text': 'L' }, date: { uts: '1700000200' } },
                    ]
                  : { name: 'T1', artist: { '#text': 'A' }, album: { '#text': 'L' }, date: { uts: '1700000100' } },
            },
          },
        }),
      },
    ]);
    await authenticate('lastfm', { username: 'testuser', apiKey: 'k' });
    const r = await runSync('lastfm');
    expect(r.stats.events.inserted).toBe(2);
    expect(runTomlQueries('lastfm', sources).map((x: any) => x.title).sort()).toEqual(['A - T1', 'A - T2']);
    calls.length = 0;
    await runSync('lastfm');
    expect(new URL(calls[0]).searchParams.get('from')).toBe('1700000201');
  });
});

describe('github', () => {
  test('repos, stars and events', async () => {
    const { sources } = sandbox();
    mockFetch([
      { match: /api\.github\.com\/user$/, respond: () => ({ body: { login: 'testuser' } }) },
      {
        match: /\/user\/repos/,
        respond: () => ({ body: [{ id: 1, full_name: 'testuser/otso', html_url: 'https://github.com/testuser/otso', created_at: '2020-01-01T00:00:00Z' }] }),
      },
      {
        match: /\/user\/starred/,
        respond: () => ({ body: [{ starred_at: '2021-01-01T00:00:00Z', repo: { id: 2, full_name: 'x/y', html_url: 'https://github.com/x/y' } }] }),
      },
      {
        match: /\/users\/testuser\/events/,
        respond: (u) => ({
          status: u.searchParams.get('page') === '1' ? 200 : 422,
          body: u.searchParams.get('page') === '1' ? [{ id: '9', type: 'PushEvent', repo: { name: 'testuser/otso' }, payload: { commits: [{ message: 'fix' }] }, created_at: '2024-01-01T00:00:00Z' }] : { message: 'window' },
        }),
      },
    ]);
    await authenticate('github', { accessToken: 'ghp_x' });
    await runSync('github');
    const rows = runTomlQueries('github', sources);
    expect(rows.map((r: any) => r.title).sort()).toEqual(['PushEvent: testuser/otso', 'Repository: testuser/otso', 'Star: x/y']);
    expect(rows.find((r: any) => r.title.startsWith('Push')).content).toBe('fix');
  });
});
