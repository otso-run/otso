import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sourceStatuses } from '../src/core/runner.js';
import { sandbox } from './helpers.js';

test('a source database that cannot be read does not stop the status listing', async () => {
  const { sources } = sandbox();
  // Stands in for a file another Mac is replacing on the share mid-read.
  const db = join(sources, 'things/chronicle/chronicle.db');
  mkdirSync(join(db, '..'), { recursive: true });
  writeFileSync(db, 'not a sqlite database'.repeat(100));
  const statuses = await sourceStatuses();
  const things = statuses.find((s) => s.id === 'things')!;
  expect(things.dbExists).toBe(true);
  expect(things.lastRun).toBeUndefined();
});
