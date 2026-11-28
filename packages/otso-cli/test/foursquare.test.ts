import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { waitForAuthorizationCode } from '../src/core/oauth.js';
import { loadCredentials } from '../src/core/credentials.js';
import { authenticate, runSync } from '../src/core/runner.js';
import { mockFetch, runTomlQueries, sandbox } from './helpers.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('oauth: serves the callback and returns the code; rejects a wrong state', async () => {
  const port = 18765;
  const code = await waitForAuthorizationCode({
    authorizeUrl: 'https://example.com/authorize?client_id=x',
    port,
    openBrowser: async (url) => {
      const state = new URL(url).searchParams.get('state');
      const bad = await realFetch(`http://127.0.0.1:${port}/callback?code=evil&state=nope`);
      expect(await bad.text()).toContain('out of date');
      await realFetch(`http://127.0.0.1:${port}/callback?code=abc&state=${state}`);
    },
  });
  expect(code).toBe('abc');
});

const checkin = (id: string, createdAt: number) => ({
  id,
  createdAt,
  shout: id === 'c2' ? 'great coffee' : undefined,
  venue: { id: `v${id}`, name: `Venue ${id}`, location: { address: '1 Main St', city: 'Brooklyn', lat: 40.7, lng: -73.9 }, categories: [{ name: 'Café', primary: true }] },
});

test('foursquare: all check-ins once, then only newer; replaces Chronicle-era copies', async () => {
  const { sources } = sandbox();
  const db = join(sources, 'foursquare/chronicle/chronicle.db');
  mkdirSync(dirname(db), { recursive: true });
  const old = new Database(db, { create: true });
  // 1704307200 = 2024-01-03T18:40:00Z, the same moment as c1 below.
  old.exec(`CREATE TABLE events (agent TEXT, end_time TEXT, object TEXT, source TEXT, type TEXT);
            INSERT INTO events VALUES (NULL, '2024-01-03 13:40:00 -0500', '{"name":"Venue c1"}', 'foursquare', 'CheckInAction'),
                                      (NULL, '2010-05-01 12:00:00 -0400', '{"name":"Old place"}', 'foursquare', 'CheckInAction');`);
  old.close();

  let items = [checkin('c2', 1704400000), checkin('c1', 1704307200)];
  const calls = mockFetch([
    { match: /\/users\/self\?/, respond: () => ({ body: { response: { user: { firstName: 'Test', lastName: 'User' } } } }) },
    { match: /\/users\/self\/checkins/, respond: (u) => ({ body: { response: { checkins: { items: u.searchParams.get('offset') === '0' ? items : [] } } } }) },
  ]);

  // A saved token skips the browser step.
  expect(await authenticate('foursquare', { clientId: 'id', clientSecret: 'secret', accessToken: 'tok' })).toBe('Test User');
  expect((await loadCredentials('foursquare'))?.accessToken).toBe('tok');

  await runSync('foursquare');
  const rows = runTomlQueries('foursquare', sources);
  expect(rows.map((r: any) => r.title).sort()).toEqual(['Old place', 'Venue c1', 'Venue c2']);
  expect(rows.find((r: any) => r.title === 'Venue c2')).toMatchObject({
    content: '1 Main St Brooklyn Café great coffee',
    occurred_at: '2024-01-04T20:26:40Z',
    url: 'https://foursquare.com/v/vc2',
  });

  items = [checkin('c3', 1704500000)];
  calls.length = 0;
  await runSync('foursquare');
  expect(calls.find((c) => c.includes('/checkins'))).toContain('afterTimestamp=1704400000');
  expect(runTomlQueries('foursquare', sources)).toHaveLength(4);
});
