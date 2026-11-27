import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { loadCredentials } from '../src/core/credentials.js';
import { authenticate, runSync } from '../src/core/runner.js';
import { readerPacing } from '../src/connectors/readwise.js';
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
    // Blocks you authored, as /users/:id/contents lists them (no channel info).
    let own: any[] = [];
    const page = (u: URL, items: any[]) =>
      u.searchParams.get('page') === '1' ? { data: items, meta: { has_more_pages: false } } : { data: [], meta: { has_more_pages: false } };
    const calls = mockFetch([
      { match: /\/v3\/me$/, respond: () => ({ body: { id: 7, slug: 'testuser', name: 'Test User' } }) },
      {
        match: /\/v3\/users\/7\/contents/,
        respond: (u) => ({
          body: page(
            u,
            u.searchParams.get('type') === 'Channel'
              ? [{ id: 1, type: 'Channel', title: 'Refs', slug: 'refs', created_at: '2023-01-01T00:00:00Z', updated_at: updatedAt, description: { markdown: 'd' } }]
              : own
          ),
        }),
      },
      {
        match: /\/v3\/channels\/1\/contents/,
        respond: (u) => ({
          body: page(u, [
            { id: 10, base_type: 'Block', type: 'Link', title: 'A link', description: { markdown: 'about' }, created_at: '2023-02-01T00:00:00Z', updated_at: '2023-02-01T00:00:00Z', source: { url: 'https://a.example' }, connection: { connected_at: '2023-02-01T00:00:00Z' } },
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

    // Editing a block leaves the channel's updated_at alone; the own-blocks
    // pass still picks the edit up, and keeps the block's channel.
    own = [
      { id: 10, base_type: 'Block', type: 'Link', title: 'Renamed link', description: { markdown: 'about' }, created_at: '2023-02-01T00:00:00Z', updated_at: '2024-03-01T00:00:00Z', source: { url: 'https://a.example' } },
      { id: 20, base_type: 'Block', type: 'Text', title: 'In a friend\'s channel', content: { markdown: 'elsewhere' }, created_at: '2024-03-02T00:00:00Z', updated_at: '2024-03-02T00:00:00Z' },
    ];
    calls.length = 0;
    const fourth = await runSync('arena');
    expect(calls.some((c) => c.includes('/channels/1/contents'))).toBe(false);
    expect(fourth.stats.blocks).toEqual({ inserted: 1, updated: 1 });
    const db = new Database(join(sources, 'arena/chronicle/chronicle.db'), { readonly: true });
    expect(db.query("SELECT title, channel_slug FROM blocks WHERE id = 'block-10'").get()).toEqual({ title: 'Renamed link', channel_slug: 'refs' });
    db.close();

    // Nothing moved: nothing rewritten.
    const fifth = await runSync('arena');
    expect(fifth.stats.blocks).toEqual({ inserted: 0, updated: 0 });
  });
});

describe('readwise', () => {
  test('pages through the export and only asks for updates afterwards', async () => {
    readerPacing.minIntervalMs = 0;
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
        respond: (u) => ({
          body: {
            results:
              u.searchParams.get('location') === 'later'
                ? [
                    { id: '01docA', title: 'An article', source_url: 'https://article', summary: 'about it', location: 'later', saved_at: '2024-02-01T00:00:00Z', tags: {} },
                    { id: '01hl', parent_id: '01docA', title: 'a highlight', location: 'later', saved_at: '2024-02-01T00:00:00Z' },
                  ]
                : [],
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
    // One request per location, never the RSS feed, always with article HTML.
    const reader = calls.filter((c) => c.includes('/api/v3/list/')).map((c) => new URL(c).searchParams);
    expect(reader.map((p) => p.get('location'))).toEqual(['new', 'later', 'shortlist', 'archive']);
    expect(reader.every((p) => p.get('withHtmlContent') === 'true')).toBe(true);
    calls.length = 0;
    await runSync('readwise');
    expect(calls[0]).toContain('updatedAfter=');
    expect(calls.filter((c) => c.includes('/api/v3/list/')).every((c) => c.includes('updatedAfter='))).toBe(true);
  });

  test('stores article text and metadata, and backfills older databases once', async () => {
    readerPacing.minIntervalMs = 0;
    const { sources } = sandbox();
    const doc = {
      id: '01docB',
      title: 'Slow software',
      url: 'https://read.readwise.io/read/01docB',
      source_url: 'https://example.com/slow',
      author: 'Ada Example',
      site_name: 'Example Blog',
      category: 'article',
      location: 'archive',
      tags: { essays: { name: 'essays' } },
      word_count: 1200,
      reading_time: '5 mins',
      published_date: '2024-03-01',
      summary: 'Why tools should wait.',
      image_url: 'https://example.com/cover.png',
      notes: 'reread',
      reading_progress: 0.5,
      saved_at: '2024-03-02T00:00:00Z',
      last_opened_at: '2024-03-03T00:00:00Z',
      updated_at: '2024-03-03T00:00:00Z',
      html_content:
        '<div><h1>Slow software</h1><p>Caching &amp; patience&#8217;s <b>virtues</b>.</p><script>track()</script><p>Second&nbsp;paragraph.</p></div>',
    };
    const calls = mockFetch([
      { match: /\/auth\//, respond: () => ({ status: 204 }) },
      { match: /\/export\//, respond: () => ({ body: { results: [], nextPageCursor: null } }) },
      {
        match: /\/api\/v3\/list\//,
        respond: (u) => ({
          body: { results: u.searchParams.get('location') === 'archive' ? [doc] : [], nextPageCursor: null },
        }),
      },
    ]);
    await authenticate('readwise', { accessToken: 'tok' });

    // A database from before article text: saved cursor, no schema version.
    await runSync('readwise');
    const dbPath = join(sources, 'readwise/chronicle/chronicle.db');
    const pre = new Database(dbPath);
    pre.query("DELETE FROM _otso_sync WHERE key = 'readerSchemaVersion'").run();
    pre.query('DELETE FROM reader_content').run();
    pre.close();

    calls.length = 0;
    const r = await runSync('readwise');
    expect(calls.filter((c) => c.includes('/api/v3/list/')).some((c) => c.includes('updatedAfter='))).toBe(false);
    expect(r.stats.reader_content).toEqual({ inserted: 1, updated: 0 });

    const [article] = runTomlQueries('readwise', sources);
    expect(article.title).toBe('Slow software');
    expect(article.content).toBe(
      "Ada Example\nWhy tools should wait.\nSlow software\nCaching & patience\u2019s virtues .\nSecond paragraph."
    );
    expect(JSON.parse(article.metadata)).toMatchObject({
      author: 'Ada Example',
      site_name: 'Example Blog',
      published_date: '2024-03-01',
      word_count: 1200,
      tags: ['essays'],
      location: 'archive',
      reading_progress: 0.5,
      reader_url: 'https://read.readwise.io/read/01docB',
      notes: 'reread',
    });

    // Running again with nothing new changes nothing (and is incremental).
    calls.length = 0;
    const again = await runSync('readwise');
    expect(calls.filter((c) => c.includes('/api/v3/list/')).every((c) => c.includes('updatedAfter='))).toBe(true);
    expect(again.stats.reader_content).toEqual({ inserted: 0, updated: 1 });
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

describe('http', () => {
  test('waits as long as a 429 body says when there is no Retry-After header', async () => {
    const { getJson } = await import('../src/core/http.js');
    let n = 0;
    mockFetch([
      {
        match: /throttled/,
        respond: () =>
          n++ === 0
            ? { status: 429, body: { detail: 'Request was throttled. Expected available in 0 seconds.' } }
            : { body: { ok: true } },
      },
    ]);
    const started = Date.now();
    expect(await getJson('https://example.test/throttled')).toEqual({ ok: true });
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });
});
