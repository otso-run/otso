import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { APPLE_EPOCH_OFFSET } from '../src/core/time.js';
import { runSync } from '../src/core/runner.js';
import { runTomlQueries, sandbox } from './helpers.js';

const realHome = process.env.HOME;
let home = '';
let dbPath = '';

/** Seconds since 2001 for an ISO time. */
const apple = (isoTime: string) => Date.parse(isoTime) / 1000 - APPLE_EPOCH_OFFSET;
const now = Date.now() / 1000 - APPLE_EPOCH_OFFSET;
const DAY = 86400;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'otso-home-'));
  process.env.HOME = home;
  dbPath = join(home, 'Library/Group Containers/group.com.apple.calendar/Calendar.sqlitedb');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { create: true });
  db.exec(`
    CREATE TABLE Calendar (ROWID INTEGER PRIMARY KEY, title TEXT);
    CREATE TABLE Location (ROWID INTEGER PRIMARY KEY, title TEXT, address TEXT, latitude INTEGER, longitude INTEGER);
    CREATE TABLE CalendarItem (ROWID INTEGER PRIMARY KEY, summary TEXT, location_id INTEGER, description TEXT,
      start_date REAL, end_date REAL, all_day INTEGER, calendar_id INTEGER, status INTEGER, url TEXT,
      unique_identifier TEXT, hidden INTEGER, has_recurrences INTEGER, entity_type INTEGER);
    CREATE TABLE OccurrenceCache (day REAL, event_id INTEGER, calendar_id INTEGER, occurrence_date REAL,
      occurrence_start_date REAL, occurrence_end_date REAL, next_reminder_date REAL);
    INSERT INTO Calendar VALUES (1, 'Work'), (2, 'Home');
    INSERT INTO Location VALUES (1, 'Café', '1 Main St', 40.7, -74.0);
  `);
  const item = db.prepare('INSERT INTO CalendarItem VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const t = apple('2024-01-03T18:40:00Z');
  item.run(1, 'Coffee', 1, 'catch up', t, t + 3600, 0, 2, 1, null, 'UID-1', 0, 0, 2);
  item.run(2, 'Standup', null, null, now - 30 * DAY, now - 30 * DAY + 900, 0, 1, 0, 'https://meet', 'UID-2', 0, 1, 2);
  item.run(3, 'Hidden', null, null, t, t, 0, 1, 0, null, 'UID-3', 1, 0, 2);
  item.run(4, 'A reminder', null, null, t, t, 0, 1, 0, null, 'UID-4', 0, 0, 3);
  item.run(5, 'Cancelled', null, null, t, t, 0, 1, 3, null, 'UID-5', 0, 0, 2);
  item.run(6, 'Birthday', null, null, apple('1604-01-09T00:00:00Z'), null, 1, 1, 0, null, 'UID-6', 0, 0, 2);
  const occ = db.prepare('INSERT INTO OccurrenceCache VALUES (0, ?, 1, ?, ?, ?, NULL)');
  // Standup repeats daily: the master's own start, two more past days, one future day.
  for (const d of [30, 29, 28, -1]) {
    const s = now - d * DAY;
    occ.run(2, s, s, s + 900);
  }
  db.close();
});

afterAll(() => {
  process.env.HOME = realHome;
});

describe('apple calendar', () => {
  test('events and past repeats, idempotent, readable by the indexer', async () => {
    const { sources } = sandbox();
    const first = await runSync('apple-calendar');
    // Coffee, Standup (+2 past repeats), Cancelled. Not hidden, reminders, year-less birthdays or future repeats.
    expect(first.stats.events.inserted).toBe(5);
    const second = await runSync('apple-calendar');
    expect(second.stats.events.inserted).toBe(0);

    const rows = runTomlQueries('apple-calendar', sources);
    expect(rows.map((r: any) => r.title).sort()).toEqual(['Coffee', 'Standup', 'Standup', 'Standup']);
    const coffee = rows.find((r: any) => r.title === 'Coffee');
    expect(coffee.occurred_at).toBe('2024-01-03T18:40:00Z');
    expect(coffee.content).toBe('catch up Café 1 Main St Home');
    expect(rows.find((r: any) => r.title === 'Standup').url).toBe('https://meet');
  });

  test('an event deleted in Calendar is removed; repeats older than the cache are kept', async () => {
    const { sources } = sandbox();
    await runSync('apple-calendar');
    const db = new Database(dbPath);
    db.exec(`DELETE FROM CalendarItem WHERE ROWID = 1; DELETE FROM OccurrenceCache WHERE occurrence_date < ${now - 28.5 * DAY}`);
    db.close();
    try {
      await runSync('apple-calendar');
      const titles = runTomlQueries('apple-calendar', sources).map((r: any) => r.title).sort();
      // Coffee is gone; the oldest Standup repeat fell out of the cache but stays.
      expect(titles).toEqual(['Standup', 'Standup', 'Standup']);
    } finally {
      const restore = new Database(dbPath);
      const t = apple('2024-01-03T18:40:00Z');
      restore.prepare('INSERT INTO CalendarItem VALUES (1, ?, 1, ?, ?, ?, 0, 2, 1, NULL, ?, 0, 0, 2)').run('Coffee', 'catch up', t, t + 3600, 'UID-1');
      for (const d of [30, 29]) {
        const s = now - d * DAY;
        restore.prepare('INSERT INTO OccurrenceCache VALUES (0, 2, 1, ?, ?, ?, NULL)').run(s, s, s + 900);
      }
      restore.close();
    }
  });
});
