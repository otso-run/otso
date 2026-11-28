import { afterEach, expect, test } from 'bun:test';
import { loadCredentials } from '../src/core/credentials.js';
import { authenticate, runSync } from '../src/core/runner.js';
import { mockFetch, runTomlQueries, sandbox } from './helpers.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const play = (id: string, playedAt: string) => ({
  played_at: playedAt,
  context: { type: 'playlist' },
  track: { type: 'track', name: `Song ${id}`, uri: `spotify:track:${id}`, duration_ms: 200_000, artists: [{ name: 'Band' }], album: { name: 'LP' }, external_urls: { spotify: `https://open.spotify.com/track/${id}` } },
});

test('spotify: recently played after the newest stored play; rotated refresh tokens are saved', async () => {
  const { sources } = sandbox();
  let refresh = 'r1';
  let items = [play('a', '2024-01-03T18:40:00.123Z'), play('b', '2024-01-03T18:36:00.000Z')];
  const calls = mockFetch([
    { match: /accounts\.spotify\.com\/api\/token/, respond: () => ({ body: { access_token: 'acc', refresh_token: refresh } }) },
    { match: /\/v1\/me$/, respond: () => ({ body: { display_name: 'Test User' } }) },
    { match: /recently-played/, respond: () => ({ body: { items } }) },
  ]);

  expect(await authenticate('spotify', { clientId: 'id', clientSecret: 'secret', refreshToken: 'r0' })).toBe('Test User');
  await runSync('spotify');
  const rows = runTomlQueries('spotify', sources);
  expect(rows).toHaveLength(2);
  const raw = rows.find((r: any) => JSON.stringify(r).includes('Song a'));
  expect(raw).toBeDefined();

  refresh = 'r2';
  items = [play('c', '2024-01-03T18:45:00.000Z')];
  calls.length = 0;
  await runSync('spotify');
  expect(calls.find((c) => c.includes('recently-played'))).toContain(`after=${Date.parse('2024-01-03T18:40:00.123Z')}`);
  expect((await loadCredentials('spotify'))?.refreshToken).toBe('r2');
  expect(runTomlQueries('spotify', sources)).toHaveLength(3);
});

test('spotify: a Premium-only 403 explains itself', async () => {
  sandbox();
  mockFetch([
    { match: /accounts\.spotify\.com\/api\/token/, respond: () => ({ body: { access_token: 'acc' } }) },
    { match: /\/v1\/me$/, respond: () => ({ body: { display_name: 'Test User' } }) },
    { match: /recently-played/, respond: () => ({ status: 403, body: { error: { message: 'Active premium subscription required for the owner of the app.' } } }) },
  ]);
  await authenticate('spotify', { clientId: 'id', clientSecret: 'secret', refreshToken: 'r0' });
  await expect(runSync('spotify')).rejects.toThrow(/Premium/);
});
