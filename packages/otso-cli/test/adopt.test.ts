import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { adoptChronicle, normalizeTime } from '../src/core/adopt.js';
import { runIngest } from '../src/core/runner.js';
import { runTomlQueries, sandbox, writeFiles } from './helpers.js';

const EVENTS = `CREATE TABLE events (agent TEXT, end_time TEXT, object TEXT, source TEXT, source_id TEXT, type TEXT, result TEXT, startTime TEXT, "@type" TEXT, additionalType TEXT, description TEXT)`;

function archiveDb(root: string, rel: string, sql: string, rows: [string, unknown[]][] = []) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  const db = new Database(p, { create: true });
  db.exec(sql);
  for (const [stmt, args] of rows) db.prepare(stmt).run(...(args as any[]));
  db.close();
}

function makeArchive() {
  const root = mkdtempSync(join(tmpdir(), 'chronicle-archive-'));
  const ins = 'INSERT INTO events (source_id, type, object, end_time, startTime, additionalType) VALUES (?, ?, ?, ?, ?, ?)';
  archiveDb(root, 'pinboard/chronicle/chronicle.db', EVENTS, [
    [ins, ['h1', 'BookmarkAction', JSON.stringify({ name: 'E', url: 'https://e.com' }), '2025-01-04 18:56:09 UTC', null, null]],
    [ins, ['h1', 'BookmarkAction', JSON.stringify({ name: 'E', url: 'https://e.com' }), '2025-01-04 18:56:09 UTC', null, null]],
  ]);
  archiveDb(root, 'lastfm/chronicle/chronicle.db', EVENTS, [
    [ins, ['uuid-1', 'ListenAction', JSON.stringify({ name: 'Song', byArtist: [{ name: 'Band' }] }), null, '2024-01-05T18:22:00Z', null]],
    [ins, ['uuid-2', 'ListenAction', JSON.stringify({ name: 'Song', byArtist: [{ name: 'Band' }] }), null, '2024-01-05T18:22:00Z', null]],
  ]);
  archiveDb(root, 'github/chronicle/chronicle.db', EVENTS, [
    [ins, ['4986080546', 'CreateAction', JSON.stringify({ name: 'x' }), null, '2025-11-29 19:29:28 UTC', 'IssuesEvent']],
  ]);
  archiveDb(root, 'linkedin/chronicle/chronicle.db', 'CREATE TABLE messages ("CONVERSATION ID" TEXT, "FROM" TEXT, "DATE" TEXT, "CONTENT" TEXT, "ATTACHMENTS" TEXT)', [
    ['INSERT INTO messages VALUES (?, ?, ?, ?, ?)', ['conv1', 'Ada', '2024-01-15 10:30:00 UTC', 'Hello, there', '']],
  ]);
  archiveDb(root, 'google-takeout/chronicle/chronicle.db', 'CREATE TABLE google_search (source_id TEXT, query TEXT, startTime TEXT, target TEXT)', [
    ['INSERT INTO google_search VALUES (?, ?, ?, ?)', ['https://www.google.com/search?q=otso', 'otso', '2024-02-01T10:00:00', 'g']],
  ]);
  archiveDb(root, 'arena/chronicle/chronicle.db', 'CREATE TABLE records (record_type TEXT, id INTEGER, title TEXT, slug TEXT, status TEXT, created_at TEXT, updated_at TEXT, contents_count INTEGER, class TEXT, description TEXT, content TEXT, source_url TEXT, source_title TEXT, image_original TEXT, connected_at TEXT, channel_slug TEXT, generated_title TEXT, attachment_url TEXT, image_display TEXT)', [
    ["INSERT INTO records (record_type, id, title, slug, created_at, updated_at) VALUES ('channel', 1, 'Refs', 'refs', '2018-01-16T00:29:53Z', '2025-01-01T00:00:00Z')", []],
    ["INSERT INTO records (record_type, id, title, class, created_at, source_url, channel_slug) VALUES ('block', 10, 'A link', 'Link', '2018-01-16T00:30:11Z', 'https://a', 'refs')", []],
  ]);
  archiveDb(root, 'timing/chronicle/chronicle.db', EVENTS);
  return root;
}

describe('adopting a Chronicle archive', () => {
  test('time normalization', () => {
    expect(normalizeTime('2025-01-04 18:56:09 UTC')).toBe('2025-01-04T18:56:09Z');
    expect(normalizeTime('2025-11-23 23:51:44 -0500')).toBe('2025-11-24T04:51:44Z');
    expect(normalizeTime('2024-12-07T21:34:44')).toBe('2024-12-07T21:34:44Z');
    expect(normalizeTime('2024-12-07T23:51:58.476146')).toBe('2024-12-07T23:51:58Z');
  });

  test('rewrites keys to otso ids, collapses repeats, and later imports add nothing new', async () => {
    const { sources } = sandbox();
    const archive = makeArchive();
    const results = await adoptChronicle({ archive });
    expect(results.find((r) => r.name === 'timing')?.status).toBe('copied');
    expect(results.filter((r) => r.status === 'failed')).toEqual([]);

    expect(runTomlQueries('pinboard', sources).map((r: any) => r.external_id)).toEqual(['bookmark-h1']);
    expect(runTomlQueries('lastfm', sources)).toHaveLength(1);
    expect(runTomlQueries('github', sources)[0].external_id).toBe('event-4986080546');
    expect(runTomlQueries('arena', sources).map((r: any) => r.title).sort()).toEqual(['A link', 'Refs']);

    // The same items arriving through otso's own importers match the adopted rows.
    const tmp = mkdtempSync(join(tmpdir(), 'otso-adopt-'));
    writeFiles(tmp, {
      'p/pinboard_export.json': JSON.stringify([{ href: 'https://e.com', description: 'E', hash: 'h1', time: '2025-01-04T18:56:09Z', tags: '' }]),
      'l/scrobbles.csv': 'Band,LP,Song,05 Jan 2024 18:22\n',
      'li/messages.csv': 'CONVERSATION ID,FROM,DATE,CONTENT\nconv1,Ada,2024-01-15 10:30:00 UTC,"Hello, there"\n',
      'g/Takeout/My Activity/Search/MyActivity.json': JSON.stringify([{ title: 'Searched for otso', time: '2024-02-01T10:00:00.456Z' }]),
    });
    for (const [id, dir] of [['pinboard', 'p'], ['lastfm', 'l'], ['linkedin', 'li'], ['google-takeout', 'g']] as const) {
      const [r] = await runIngest(id, [join(tmp, dir)]);
      for (const s of Object.values(r.stats)) expect(s.inserted).toBe(0);
    }

    // Adopting again is a no-op.
    const again = await adoptChronicle({ archive, only: ['pinboard'] });
    expect(again[0].detail).toContain('0 stored');
  });
});
