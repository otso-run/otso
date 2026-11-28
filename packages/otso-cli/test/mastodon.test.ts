import { afterEach, expect, test } from 'bun:test';
import { nextLink } from '../src/connectors/mastodon.js';
import { authenticate, runSync } from '../src/core/runner.js';
import { runTomlQueries, sandbox } from './helpers.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const status = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  created_at: '2024-01-03T18:40:00.000Z',
  url: `https://social.example/@me/${id}`,
  content: `<p>Post ${id} about <a href="#">#otso</a></p>`,
  spoiler_text: '',
  account: { acct: 'me' },
  tags: [{ name: 'otso' }],
  media_attachments: [],
  ...extra,
});

test('mastodon: posts, boosts, favourites and bookmarks; stops at the first page with nothing new', async () => {
  const { sources } = sandbox();
  const lists: Record<string, any[][]> = {
    statuses: [[status('3'), status('2', { reblog: status('99', { account: { acct: 'friend@else.where' }, content: '<p>Their post</p>' }) })], [status('1')]],
    favourites: [[status('50', { account: { acct: 'someone' }, content: '<p>Nice</p>', media_attachments: [{ description: 'a cat' }] })]],
    bookmarks: [[]],
  };
  const calls: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    calls.push(url.toString());
    if (url.pathname.endsWith('verify_credentials')) return Response.json({ id: '7', acct: 'me' });
    const name = url.pathname.split('/').pop()!;
    const pages = lists[name] ?? [[]];
    const page = Number(url.searchParams.get('page') ?? 0);
    const headers: Record<string, string> = {};
    if (page + 1 < pages.length) {
      const next = new URL(url);
      next.searchParams.set('page', String(page + 1));
      headers.link = `<${next}>; rel="next"`;
    }
    return Response.json(pages[page] ?? [], { headers });
  }) as typeof fetch;

  expect(await authenticate('mastodon', { instance: 'https://social.example/', accessToken: 'tok' })).toBe('@me@social.example');
  await runSync('mastodon');
  const rows = runTomlQueries('mastodon', sources);
  expect(rows.map((r: any) => r.title).sort()).toEqual(['Nice', 'Post 1 about #otso', 'Post 3 about #otso', 'Their post']);
  expect(rows.find((r: any) => r.title === 'Nice').content).toBe('Nice a cat #otso someone');
  expect(rows.find((r: any) => r.title === 'Their post').url).toBe('https://social.example/@me/99');

  // Nothing new: one request per list.
  calls.length = 0;
  await runSync('mastodon');
  expect(calls.filter((c) => c.includes('/statuses'))).toHaveLength(1);
});

test('mastodon: next links are only followed on the same https origin', () => {
  const root = 'https://social.example';
  expect(nextLink('<https://social.example/api/v1/favourites?max_id=1>; rel="next"', root)).toBe('https://social.example/api/v1/favourites?max_id=1');
  expect(nextLink('<https://evil.example/steal>; rel="next"', root)).toBeNull();
  expect(nextLink('<http://social.example/api>; rel="next"', root)).toBeNull();
});
