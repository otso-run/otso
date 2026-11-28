import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runSync } from '../src/core/runner.js';
import { REPO_TOML, runTomlQueries, sandbox } from './helpers.js';

const realHome = process.env.HOME;
const BROWSERS: [string, string][] = [
  ['google-chrome', 'Google/Chrome'],
  ['arc', 'Arc/User Data'],
  ['dia', 'Dia/User Data'],
];

beforeAll(() => {
  process.env.HOME = mkdtempSync(join(tmpdir(), 'otso-home-'));
  for (const [, dir] of BROWSERS) {
    const p = join(process.env.HOME, 'Library/Application Support', dir, 'Default/History');
    mkdirSync(dirname(p), { recursive: true });
    const db = new Database(p, { create: true });
    db.exec(`CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT);
             CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER);
             INSERT INTO urls VALUES (1, 'https://example.com', 'Example');
             INSERT INTO visits VALUES (1, 1, 13348780800000000);`);
    db.close();
  }
});

afterAll(() => {
  process.env.HOME = realHome;
});

test.each(BROWSERS)('%s history syncs into its own per-Mac source', async (id) => {
  const { sources } = sandbox();
  const r = await runSync(id);
  expect(r.source).toBe(`${id}-test-mac`);
  expect((await runSync(id)).stats.events.inserted).toBe(0);
  expect(runTomlQueries(id, sources, REPO_TOML, `${id}-test-mac/chronicle/chronicle.db`)).toEqual([
    { external_id: expect.any(String), title: 'Example', content: 'https://example.com', occurred_at: '2024-01-03T18:40:00Z', url: 'https://example.com' },
  ]);
});
