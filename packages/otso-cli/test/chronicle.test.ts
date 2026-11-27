import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ChronicleStore, EVENTS_TABLE } from '../src/core/chronicle.js';
import { parseCsv, parseYtdJs } from '../src/core/archive.js';
import { fromAppleTime } from '../src/core/time.js';
import { sandbox } from './helpers.js';

describe('ChronicleStore', () => {
  test('upserts are idempotent and keep rowids', () => {
    const { root } = sandbox();
    const store = ChronicleStore.open(join(root, 'x', 'chronicle.db'));
    const rows = [
      { source_id: 'a', type: 'ViewAction', object: { name: 'A' } },
      { source_id: 'b', type: 'ViewAction', object: { name: 'B' } },
    ];
    expect(store.upsert(EVENTS_TABLE, rows)).toEqual({ inserted: 2, updated: 0 });
    const before = store.db.query('SELECT rowid, source_id FROM events ORDER BY rowid').all();
    expect(store.upsert(EVENTS_TABLE, [{ ...rows[0], object: { name: 'A2' } }, rows[1]])).toEqual({
      inserted: 0,
      updated: 2,
    });
    expect(store.db.query('SELECT rowid, source_id FROM events ORDER BY rowid').all()).toEqual(before);
    expect(store.db.query("SELECT json_extract(object, '$.name') AS n FROM events WHERE source_id = 'a'").get()).toEqual({
      n: 'A2',
    });
    expect(store.count('events')).toBe(2);
    store.close();
  });

  test('adopts an older table: adds columns and backs up before de-duplicating', () => {
    const { root } = sandbox();
    const path = join(root, 'legacy', 'chronicle.db');
    ChronicleStore.open(path).close();
    const raw = new Database(path);
    raw.exec('DROP TABLE IF EXISTS events; CREATE TABLE events (source_id TEXT, type TEXT)');
    raw.exec("INSERT INTO events VALUES ('dup', 'x'), ('dup', 'y'), ('one', 'z')");
    raw.close();

    const store = ChronicleStore.open(path);
    store.upsert(EVENTS_TABLE, [{ source_id: 'new', type: 'ViewAction', end_time: '2024-01-01T00:00:00Z' }]);
    expect(store.count('events')).toBe(3);
    store.close();
    expect(readdirSync(join(root, 'legacy')).some((f) => f.includes('.bak-'))).toBe(true);
  });

  test('sync state round-trips', () => {
    const { root } = sandbox();
    const store = ChronicleStore.open(join(root, 's', 'chronicle.db'));
    expect(store.getState('cursor')).toBeNull();
    store.setState('cursor', '42');
    store.setState('cursor', '43');
    expect(store.getState('cursor')).toBe('43');
    store.close();
    expect(existsSync(join(root, 's', 'chronicle.db'))).toBe(true);
  });
});

describe('parsers', () => {
  test('csv handles quotes, commas, newlines and BOM', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","line1\nline2"\n"say ""hi""",2\n');
    expect(rows).toEqual([
      { a: 'x, y', b: 'line1\nline2' },
      { a: 'say "hi"', b: '2' },
    ]);
  });

  test('twitter window.YTD wrapper', () => {
    expect(parseYtdJs('window.YTD.tweets.part0 = [{"a":1}]')).toEqual([{ a: 1 }]);
  });

  test('apple timestamps in seconds and nanoseconds', () => {
    expect(fromAppleTime(0)).toBeNull();
    expect(fromAppleTime(726_000_000)).toBe('2024-01-03T18:40:00Z');
    expect(fromAppleTime(726_000_000_000_000_000)).toBe('2024-01-03T18:40:00Z');
  });
});
