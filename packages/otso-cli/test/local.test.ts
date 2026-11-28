import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { decodeAttributedBody, decodeNoteBody } from '../src/connectors/local.js';
import { runSync } from '../src/core/runner.js';
import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { indexerConfigPath } from '../src/core/sources-config.js';
import { REPO_TOML, runTomlQueries, sandbox } from './helpers.js';

// Fake app databases under a throwaway $HOME, shaped like the real ones.
const realHome = process.env.HOME;
let home = '';

function appDb(rel: string, sql: string, seed?: (db: Database) => void) {
  const p = join(home, rel);
  mkdirSync(dirname(p), { recursive: true });
  const db = new Database(p, { create: true });
  db.exec(sql);
  seed?.(db);
  db.close();
}

const field = (num: number, payload: Uint8Array) => {
  const out = [(num << 3) | 2];
  let n = payload.length;
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>= 7;
  }
  out.push(n);
  return new Uint8Array([...out, ...payload]);
};

function attributedBody(text: string) {
  const t = Buffer.from(text);
  const len = t.length < 0x80 ? Buffer.from([t.length]) : Buffer.from([0x81, t.length & 0xff, t.length >> 8]);
  return Buffer.concat([
    Buffer.from('\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString', 'latin1'),
    Buffer.from([1, 0x94, 0x84, 1, 0x2b]),
    len,
    t,
    Buffer.from([0x86, 0x84]),
  ]);
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'otso-home-'));
  process.env.HOME = home;

  appDb(
    'Library/Safari/History.db',
    `CREATE TABLE history_items (id INTEGER PRIMARY KEY, url TEXT);
     CREATE TABLE history_visits (id INTEGER PRIMARY KEY, history_item INTEGER, visit_time REAL, title TEXT);
     INSERT INTO history_items VALUES (1, 'https://example.com');
     INSERT INTO history_visits VALUES (1, 1, 726000000.5, 'Example'), (2, 1, 726000100, NULL);`
  );

  appDb(
    'Library/Application Support/net.imput.helium/Default/History',
    `CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT);
     CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER);
     INSERT INTO urls VALUES (1, 'https://example.com', 'Example'), (2, 'chrome://settings', 'Settings');
     -- 2024-01-03T18:40:00Z in microseconds since 1601
     INSERT INTO visits VALUES (1, 1, 13348780800000000), (2, 1, 13348780860000000), (3, 2, 13348780800000000);`
  );

  appDb(
    'Library/Messages/chat.db',
    `CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, attributedBody BLOB, handle_id INTEGER, date INTEGER, is_from_me INTEGER);
     CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
     CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, display_name TEXT, chat_identifier TEXT);
     CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
     INSERT INTO handle VALUES (1, '+15555550123');`,
    (db) => {
      const ins = db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?, ?, ?)');
      ins.run(1, 'g1', 'plain text', null, 1, 726000000000000000, 0);
      ins.run(2, 'g2', null, attributedBody('from attributedBody'), 1, 726000001000000000, 1);
      ins.run(3, 'g3', null, null, 1, 726000002000000000, 0); // tapback etc: no text
    }
  );

  appDb(
    'Library/Group Containers/group.com.apple.notes/NoteStore.sqlite',
    `CREATE TABLE Z_METADATA (Z_VERSION INTEGER, Z_UUID TEXT);
     INSERT INTO Z_METADATA VALUES (1, 'STORE-UUID');
     CREATE TABLE ZICCLOUDSYNCINGOBJECT (Z_PK INTEGER PRIMARY KEY, ZIDENTIFIER TEXT, ZTITLE1 TEXT, ZSNIPPET TEXT, ZCREATIONDATE3 REAL, ZMODIFICATIONDATE1 REAL, ZMARKEDFORDELETION INTEGER);
     CREATE TABLE ZICNOTEDATA (Z_PK INTEGER PRIMARY KEY, ZNOTE INTEGER, ZDATA BLOB);
     INSERT INTO ZICCLOUDSYNCINGOBJECT VALUES (1, 'N1', 'Groceries', 'eggs', 726000000, 726000500, 0), (2, 'N2', 'Deleted', '', 1, 1, 1);`,
    (db) => {
      const body = field(2, field(3, field(2, new TextEncoder().encode('Groceries\neggs, milk'))));
      db.prepare('INSERT INTO ZICNOTEDATA VALUES (1, 1, ?)').run(gzipSync(body));
    }
  );

  appDb(
    'Pictures/Photos Library.photoslibrary/database/Photos.sqlite',
    `CREATE TABLE ZASSET (Z_PK INTEGER PRIMARY KEY, ZUUID TEXT, ZCLOUDASSETGUID TEXT, ZFILENAME TEXT, ZDATECREATED REAL, ZLATITUDE REAL, ZLONGITUDE REAL, ZKIND INTEGER, ZTRASHEDSTATE INTEGER);
     CREATE TABLE ZADDITIONALASSETATTRIBUTES (Z_PK INTEGER PRIMARY KEY, ZASSET INTEGER, ZTITLE TEXT, ZORIGINALFILENAME TEXT, ZASSETDESCRIPTION INTEGER);
     CREATE TABLE ZASSETDESCRIPTION (Z_PK INTEGER PRIMARY KEY, ZLONGDESCRIPTION TEXT);
     INSERT INTO ZASSET VALUES (1, 'P1', 'CLOUD-1', 'IMG_1.HEIC', 726000000, 40.7, -74.0, 0, 0), (2, 'P2', NULL, 'IMG_2.HEIC', 726000000, -180, -180, 0, 0), (3, 'P3', NULL, 'gone.jpg', 1, 0, 0, 0, 1);
     INSERT INTO ZADDITIONALASSETATTRIBUTES VALUES (1, 1, NULL, 'beach.heic', 1), (2, 2, NULL, NULL, NULL);
     INSERT INTO ZASSETDESCRIPTION VALUES (1, 'sunset at the beach');`
  );

  appDb(
    'Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Documents/MTLibrary.sqlite',
    `CREATE TABLE ZMTPODCAST (Z_PK INTEGER PRIMARY KEY, ZTITLE TEXT, ZWEBPAGEURL TEXT);
     CREATE TABLE ZMTEPISODE (Z_PK INTEGER PRIMARY KEY, ZSTORETRACKID INTEGER, ZUUID TEXT, ZTITLE TEXT, ZWEBPAGEURL TEXT, ZENCLOSUREURL TEXT, ZLASTDATEPLAYED REAL, ZPLAYSTATELASTMODIFIEDDATE REAL, ZHASBEENPLAYED INTEGER, ZDURATION REAL, ZPODCAST INTEGER);
     INSERT INTO ZMTPODCAST VALUES (1, 'The Show', 'https://show');
     INSERT INTO ZMTEPISODE VALUES (1, 1000725483371, 'E1', 'Episode 1', NULL, 'https://cdn/e1.mp3', 726000000, NULL, 1, 1800, 1), (2, 0, 'E2', 'Unplayed', NULL, NULL, NULL, NULL, 0, 1800, 1);`
  );

  appDb(
    'Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-ABCDE/Things Database.thingsdatabase/main.sqlite',
    `CREATE TABLE TMTask (uuid TEXT, type INTEGER, status INTEGER, trashed INTEGER, title TEXT, notes TEXT, creationDate REAL, stopDate REAL);
     INSERT INTO TMTask VALUES ('T1', 0, 3, 0, 'Ship otso', 'notes', 1700000000, 1700100000), ('T2', 0, 0, 0, 'Open task', '', 1700000000, NULL), ('T3', 0, 0, 1, 'Trashed', '', 1, NULL);`
  );

  appDb(
    'Library/Application Support/info.eurocomp.Timing2/SQLite.db',
    `CREATE TABLE Application (id INTEGER PRIMARY KEY, bundleIdentifier TEXT, executable TEXT, title TEXT);
     CREATE TABLE Title (id INTEGER PRIMARY KEY, stringValue TEXT);
     CREATE TABLE Path (id INTEGER PRIMARY KEY, stringValue TEXT);
     CREATE TABLE Project (id INTEGER PRIMARY KEY, title TEXT);
     CREATE TABLE AppActivity (id INTEGER PRIMARY KEY, localDeviceID INTEGER, startDate REAL, endDate REAL, applicationID INTEGER, titleID INTEGER, pathID INTEGER, projectID INTEGER, isDeleted BOOLEAN DEFAULT 0);
     INSERT INTO Application VALUES (1, 'dev.zed.Zed', 'zed', 'Zed'), (2, 'com.apple.Safari', 'Safari', 'Safari');
     INSERT INTO Title VALUES (1, 'otso'), (2, 'Example Domain');
     INSERT INTO Path VALUES (1, 'https://example.com/'), (2, 'Otso - Claude Code');
     INSERT INTO Project VALUES (1, 'Web Browsing');
     INSERT INTO AppActivity VALUES
       (101, 1, 1600000000, 1600000060, 1, 1, NULL, NULL, 0),
       (102, 1, 1700000000, 1700000030, 2, 2, 1, 1, 0),
       (103, 1, 1700000100, 1700000130, 2, 2, 1, 1, 1),
       (3856625907413930497, 1, 1700000200, 1700000230, 1, NULL, 2, NULL, 0);`
  );
});

afterAll(() => {
  process.env.HOME = realHome;
});

describe('decoders', () => {
  test('attributedBody typedstream', () => {
    expect(decodeAttributedBody(attributedBody('hello'))).toBe('hello');
    expect(decodeAttributedBody(attributedBody('x'.repeat(300)))).toBe('x'.repeat(300));
    expect(decodeAttributedBody(attributedBody('café ☕'))).toBe('café ☕');
  });
  test('gzipped note protobuf', () => {
    const body = field(2, field(3, field(2, new TextEncoder().encode('hi'))));
    expect(decodeNoteBody(gzipSync(body))).toBe('hi');
    expect(decodeNoteBody(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('local macOS sources sync idempotently into sources.toml-readable rows', () => {
  async function syncTwice(id: string) {
    const first = await runSync(id);
    const second = await runSync(id);
    for (const s of Object.values(second.stats)) expect(s.inserted).toBe(0);
    return first;
  }

  test('safari goes to this Mac\'s own source', async () => {
    const { sources } = sandbox();
    const r = await syncTwice('safari');
    expect(r.source).toBe('safari-test-mac');
    expect(r.stats.events.inserted).toBe(2);
    const rows = runTomlQueries('safari', sources, REPO_TOML, 'safari-test-mac/chronicle/chronicle.db');
    expect(rows.map((r: any) => r.title).sort()).toEqual(['Example', 'https://example.com']);
    expect(rows.every((r: any) => r.occurred_at.startsWith('2024-01-03'))).toBe(true);
  });

  test('safari: rows this Mac stored in the shared pre-split source move to its own', async () => {
    const { sources } = sandbox();
    await runSync('safari');
    // Pretend an older otso wrote those visits, plus another Mac's, into safari/.
    const shared = join(sources, 'safari/chronicle/chronicle.db');
    mkdirSync(dirname(shared), { recursive: true });
    const own = new Database(join(sources, 'safari-test-mac/chronicle/chronicle.db'));
    const keys = (own.query('SELECT source_id FROM events').all() as any[]).map((r) => r.source_id);
    own.close();
    const db = new Database(shared, { create: true });
    db.exec('CREATE TABLE events (source_id TEXT PRIMARY KEY, object TEXT, end_time TEXT)');
    for (const k of [...keys, 'visit-1-other-mac']) db.prepare('INSERT INTO events (source_id) VALUES (?)').run(k);
    db.close();

    await runSync('safari');
    const left = new Database(shared, { readonly: true });
    expect(left.query('SELECT source_id FROM events').all()).toEqual([{ source_id: 'visit-1-other-mac' }]);
    left.close();
  });

  test('helium (Chromium history) is per device too', async () => {
    const { sources } = sandbox();
    const r = await syncTwice('helium');
    expect(r.source).toBe('helium-test-mac');
    const rows = runTomlQueries('helium', sources, REPO_TOML, 'helium-test-mac/chronicle/chronicle.db');
    expect(rows.map((x: any) => [x.title, x.occurred_at])).toEqual([
      ['Example', '2024-01-03T18:40:00Z'],
      ['Example', '2024-01-03T18:41:00Z'],
    ]);
  });

  test('per-device sources are added to the indexer config under their own names', async () => {
    const { sources } = sandbox();
    await runSync('safari');
    await runSync('helium');
    const path = await indexerConfigPath(sources);
    const cfg = parse(readFileSync(path, 'utf8')) as any;
    const dev = cfg.sources.filter((s: any) => s.name.endsWith('-test-mac'));
    expect(dev.map((s: any) => [s.name, s.enabled, s.db_path])).toEqual([
      ['safari-test-mac', true, 'safari-test-mac/chronicle/chronicle.db'],
      ['helium-test-mac', true, 'helium-test-mac/chronicle/chronicle.db'],
    ]);
    expect(dev[0].queries.length).toBeGreaterThan(0);
  });

  test('imessage, including attributedBody-only messages', async () => {
    const { sources } = sandbox();
    await syncTwice('imessage');
    const rows = runTomlQueries('imessage', sources);
    expect(rows.map((r: any) => [r.title, r.content])).toEqual([
      ['+15555550123', 'plain text'],
      ['Me', 'from attributedBody'],
    ]);
  });

  test('apple notes with decoded body, deleted notes skipped', async () => {
    const { sources } = sandbox();
    // A row an older sync stored under this Mac's Core Data URI.
    const legacy = join(sources, 'apple-notes/chronicle/chronicle.db');
    mkdirSync(dirname(legacy), { recursive: true });
    const db = new Database(legacy, { create: true });
    db.exec("CREATE TABLE events (source_id TEXT PRIMARY KEY, name TEXT); INSERT INTO events VALUES ('x-coredata://STORE-UUID/ICNote/p1', 'Groceries'), ('x-coredata://OTHER-MAC/ICNote/p9', 'Kept')");
    db.close();
    await syncTwice('apple-notes');
    // Keyed on the iCloud id now, so every Mac stores the same note once.
    expect(runTomlQueries('apple-notes', sources).filter((r: any) => r.title === 'Groceries')).toEqual([
      { external_id: 'N1', title: 'Groceries', content: 'Groceries\neggs, milk', occurred_at: '2024-01-03T18:40:00Z', url: null },
    ]);
    // Another Mac's old rows are left for that Mac to replace.
    expect(runTomlQueries('apple-notes', sources).map((r: any) => r.external_id).sort()).toEqual(['N1', 'x-coredata://OTHER-MAC/ICNote/p9']);
  });

  test('apple photos: captions, real coordinates only, trash skipped', async () => {
    const { sources } = sandbox();
    await syncTwice('apple-photos');
    const rows = runTomlQueries('apple-photos', sources);
    // The iCloud asset id when there is one, else the library's own uuid.
    expect(rows.map((r: any) => r.external_id).sort()).toEqual(['CLOUD-1', 'P2']);
    expect(rows.map((r: any) => r.title).sort()).toEqual(['IMG_2.HEIC', 'beach.heic']);
    expect(rows.find((r: any) => r.title === 'beach.heic').content.trim()).toBe('sunset at the beach');
  });

  test('apple podcasts: played episodes only', async () => {
    const { sources } = sandbox();
    await syncTwice('apple-podcasts');
    expect(runTomlQueries('apple-podcasts', sources)).toEqual([
      { external_id: '1000725483371', title: 'Episode 1', content: 'The Show', occurred_at: '2024-01-03T18:40:00Z', url: 'https://cdn/e1.mp3' },
    ]);
  });

  test('things: finds the ThingsData-* folder; completed tasks get a second entry', async () => {
    const { sources } = sandbox();
    await syncTwice('things');
    const rows = runTomlQueries('things', sources);
    expect(rows.map((r: any) => r.title).sort()).toEqual(['Open task', 'Ship otso', '✓ Ship otso']);
  });

  test('timing: app activity in the Chronicle shape the sources.toml query reads', async () => {
    const { sources } = sandbox();
    const r = await syncTwice('timing');
    expect(r.stats.events.inserted).toBe(3);
    const rows = runTomlQueries('timing', sources).sort((a: any, b: any) => a.occurred_at.localeCompare(b.occurred_at));
    expect(rows.map((r: any) => [r.external_id, r.title, r.content.trim(), r.url])).toEqual([
      ['101', 'Zed', 'otso', null],
      ['102', 'Safari', 'Example Domain Web Browsing', 'https://example.com/'],
      ['3856625907413930497', 'Zed', 'Otso - Claude Code', null],
    ]);
  });

  test('timing: continues a Chronicle-era database instead of re-reading history', async () => {
    const { sources } = sandbox();
    const dbFile = join(sources, 'timing/chronicle/chronicle.db');
    mkdirSync(dirname(dbFile), { recursive: true });
    const old = new Database(dbFile, { create: true });
    old.exec(`CREATE TABLE events (agent TEXT, end_time TEXT, object TEXT, source TEXT, source_id TEXT, type TEXT, result TEXT, startTime TEXT);
              INSERT INTO events VALUES ('{"name":"Zed"}', NULL, '{"name":"old"}', 'timing', '1', 'Action', NULL, '2023-11-01T00:00:00Z');`);
    old.close();
    const r = await syncTwice('timing');
    // 101 (2020) is older than the stored history, so it isn't read again.
    expect(r.stats.events.inserted).toBe(2);
    const ids = runTomlQueries('timing', sources).map((r: any) => r.external_id).sort();
    expect(ids).toEqual(['1', '102', '3856625907413930497']);
  });

  test('missing database fails cleanly without leaving an empty db behind', async () => {
    const { sources } = sandbox();
    process.env.HOME = join(home, 'nowhere');
    try {
      await expect(runSync('things')).rejects.toThrow(/isn't on this Mac/);
    } finally {
      process.env.HOME = home;
    }
    expect(existsSync(join(sources, 'things/chronicle/chronicle.db'))).toBe(false);
  });
});
