import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSync } from '../src/core/runner.js';
import { runTomlQueries, sandbox } from './helpers.js';

const realHome = process.env.HOME;
let stores = '';

function store(name: string, seed: string) {
  const db = new Database(join(stores, name), { create: true });
  db.exec(`CREATE TABLE ZREMCDBASELIST (Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, ZMARKEDFORDELETION INTEGER, ZCKIDENTIFIER TEXT, ZNAME TEXT);
           CREATE TABLE ZREMCDREMINDER (Z_PK INTEGER PRIMARY KEY, ZCOMPLETED INTEGER, ZFLAGGED INTEGER, ZMARKEDFORDELETION INTEGER, ZPRIORITY INTEGER,
             ZLIST INTEGER, ZCOMPLETIONDATE TIMESTAMP, ZCREATIONDATE TIMESTAMP, ZDUEDATE TIMESTAMP, ZCKIDENTIFIER TEXT, ZNOTES TEXT, ZTITLE TEXT);
           ${seed}`);
  db.close();
}

beforeAll(() => {
  process.env.HOME = mkdtempSync(join(tmpdir(), 'otso-home-'));
  stores = join(process.env.HOME, 'Library/Group Containers/group.com.apple.reminders/Container_v1/Stores');
  mkdirSync(stores, { recursive: true });
  store(
    'Data-AAA.sqlite',
    `INSERT INTO ZREMCDBASELIST VALUES (1, 1, 0, 'L1', 'Groceries');
     INSERT INTO ZREMCDREMINDER VALUES (1, 1, 0, 0, 0, 1, 726000500, 726000000, NULL, 'R1', 'oat', 'Buy milk'),
                                       (2, 0, 1, 0, 1, 1, NULL, 726000000, 726100000, 'R2', NULL, 'Call back'),
                                       (3, 0, 0, 1, 0, 1, NULL, 726000000, NULL, 'R3', NULL, 'Deleted one');`
  );
  store('Data-local.sqlite', `INSERT INTO ZREMCDREMINDER VALUES (1, 0, 0, 0, 0, NULL, NULL, 726000000, NULL, NULL, NULL, 'On this Mac only');`);
});

afterAll(() => {
  process.env.HOME = realHome;
});

test('reminders from every store, completed ones get a second entry, deleted skipped', async () => {
  const { sources } = sandbox();
  const first = await runSync('apple-reminders');
  expect(first.stats.events.inserted).toBe(3);
  expect((await runSync('apple-reminders')).stats.events.inserted).toBe(0);
  const rows = runTomlQueries('apple-reminders', sources);
  expect(rows.map((r: any) => r.title).sort()).toEqual(['Buy milk', 'Call back', 'On this Mac only', '✓ Buy milk']);
  expect(rows.find((r: any) => r.title === 'Buy milk')).toMatchObject({ external_id: 'R1', content: 'oat Groceries', occurred_at: '2024-01-03T18:40:00Z' });
  expect(rows.find((r: any) => r.title === 'On this Mac only').external_id).toBe('local-1');
});
