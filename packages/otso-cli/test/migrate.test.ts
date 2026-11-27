import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCredentials } from '../src/core/credentials.js';
import { mapChronicleCredentials, migrateChronicle, parseSimpleYaml, unsupportedChronicleServices } from '../src/core/migrate.js';
import { sandbox, writeFiles } from './helpers.js';

function chronicleDir() {
  return writeFiles(mkdtempSync(join(tmpdir(), 'chronicle-')), {
    'secrets/arena.yml': 'secrets:\n  access_token: "arena-tok"\nchronicle_etl_version: 0.6.1\n',
    'secrets/pinboard.yml': 'secrets:\n  api_token: testuser:ABC123\n  access_token: other\n',
    'secrets/spotify.yml': 'secrets:\n  client_id: x\n  access_token: y\n',
    'jobs/lastfm-api.yml': 'extractor:\n  name: lastfm:api\n  options:\n    api_key: lfkey\n    username: testuser\nloader:\n  name: json\n',
    'jobs/arena-api.yml': 'extractor:\n  options:\n    access_token: $ARENA_TOKEN\n',
    'jobs/mastodon-x.yml': 'extractor:\n  options:\n    access_token: m\n',
  });
}

describe('chronicle-etl migration', () => {
  test('yaml subset', () => {
    expect(parseSimpleYaml('a:\n  b: "1"\n  c:\n    d: x # note\ne: 2\n')).toEqual({ a: { b: '1', c: { d: 'x' } }, e: '2' });
  });

  test('maps secrets and job options to otso fields', () => {
    const dir = chronicleDir();
    expect(mapChronicleCredentials(dir)).toEqual({
      arena: { accessToken: 'arena-tok' },
      pinboard: { accessToken: 'testuser:ABC123' },
      lastfm: { apiKey: 'lfkey', username: 'testuser' },
    });
    expect(unsupportedChronicleServices(dir)).toEqual(['mastodon', 'spotify']);
  });

  test('saves without verify and keeps existing credentials', async () => {
    sandbox();
    const dir = chronicleDir();
    const first = await migrateChronicle({ dir, verify: false });
    expect(first.results.map((r) => r.status)).toEqual(['saved', 'saved', 'saved']);
    expect((await loadCredentials('pinboard'))?.accessToken).toBe('testuser:ABC123');
    const second = await migrateChronicle({ dir, verify: false });
    expect(second.results.every((r) => r.status === 'kept-existing')).toBe(true);
  });
});
