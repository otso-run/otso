import type { Database } from 'bun:sqlite';
import { gunzipSync } from 'node:zlib';
import { EVENTS_TABLE } from '../core/chronicle.js';
import { APPLE_EPOCH_OFFSET, fromAppleTime, fromUnixSeconds } from '../core/time.js';
import type { Connector, RunContext, RunStats } from './types.js';
import { addStats, columnsOf, firstColumn, NotOnThisMacError, resolveLocalPath, shortHash, withDatabaseCopy } from './util.js';

/**
 * macOS app databases. Each sync copies the app's SQLite file to a temp
 * folder, reads the copy, and upserts into the source's chronicle.db, so it
 * is safe to run while the app is open and to run as often as you like.
 * Safari, Messages, Notes and Photos need Full Disk Access for the terminal.
 */

type Rows = Record<string, unknown>[];
/**
 * What a reader returns: the rows, plus (optionally) ids this Mac used to
 * store the same items under before they were keyed on a stable iCloud id.
 * Those older rows are removed so each item is stored once, whichever Mac
 * synced it.
 */
type ReadResult = Rows | { rows: Rows; replaced: string[] };

function localSync(
  connector: Pick<Connector, 'localPaths' | 'displayName'>,
  read: (db: Database, ctx: RunContext) => ReadResult
) {
  return async (ctx: RunContext): Promise<RunStats> => {
    const path = connector.localPaths!.map(resolveLocalPath).find(Boolean);
    if (!path) throw new NotOnThisMacError(connector.displayName);
    const result = await withDatabaseCopy(path, (db) => read(db, ctx));
    const { rows, replaced } = Array.isArray(result) ? { rows: result, replaced: [] } : result;
    const stats: RunStats = {};
    addStats(stats, 'events', ctx.store.upsert(EVENTS_TABLE, rows));
    ctx.log(`${rows.length.toLocaleString()} records read from ${connector.displayName}`);
    const removed = ctx.store.deleteKeys(EVENTS_TABLE, replaced);
    if (removed) ctx.log(`Removed ${removed.toLocaleString()} older copies stored under this Mac's local ids`);
    return stats;
  };
}

// ── Safari ───────────────────────────────────────────────────────────────

/** Visit key at one-second precision, so Chronicle-era rows (which only kept seconds) line up. */
export const safariKey = (unixSeconds: number, url: string) => `visit-${Math.floor(unixSeconds)}-${shortHash(url)}`;

const safariPaths = ['~/Library/Safari/History.db'];
export const safari: Connector = {
  id: 'safari',
  displayName: 'Safari',
  description: 'Browsing history',
  kind: 'local',
  dbPath: 'safari/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],
  localPaths: safariPaths,
  permission: 'full-disk-access',
  // History doesn't sync between Macs, so each Mac gets safari-<device>.
  perDevice: true,
  sync: localSync({ localPaths: safariPaths, displayName: 'Safari' }, (db) =>
    (
      db
        .query(
          `SELECT v.visit_time, v.title, i.url FROM history_visits v
           JOIN history_items i ON i.id = v.history_item ORDER BY v.visit_time`
        )
        .all() as any[]
    ).map((r) => ({
      source_id: safariKey(r.visit_time + APPLE_EPOCH_OFFSET, r.url),
      type: 'ViewAction',
      source: 'safari',
      object: { name: r.title || r.url, url: r.url },
      end_time: fromAppleTime(r.visit_time),
    }))
  ),
};

// ── Chromium browsers (Helium, …) ─────────────────────────────────────────

/** Chromium stores times as microseconds since 1601-01-01. */
const CHROMIUM_EPOCH_OFFSET = 11644473600;

/**
 * Browsing history for any Chromium-based browser, read from each profile's
 * History file. Visits use the same key as Safari's, so the two line up.
 * Add a browser by passing the folder it keeps under ~/Library/Application Support.
 */
export function chromiumHistory(id: string, displayName: string, appSupportDir: string): Connector {
  const base = `~/Library/Application Support/${appSupportDir}`;
  const paths = [`${base}/Default/History`, `${base}/Profile */History`];
  return {
    id,
    displayName,
    description: 'Browsing history',
    kind: 'local',
    dbPath: `${id}/chronicle/chronicle.db`,
    tables: [EVENTS_TABLE],
    localPaths: paths,
    perDevice: true,
    sync: localSync({ localPaths: paths, displayName }, (db) =>
      (
        db
          .query(
            `SELECT v.visit_time AS t, u.url, u.title FROM visits v
             JOIN urls u ON u.id = v.url ORDER BY v.visit_time`
          )
          .all() as any[]
      )
        .filter((r) => r.t > 0 && /^https?:/.test(r.url))
        .map((r) => {
          const unix = r.t / 1e6 - CHROMIUM_EPOCH_OFFSET;
          return {
            source_id: safariKey(unix, r.url),
            type: 'ViewAction',
            source: id,
            object: { name: r.title || r.url, url: r.url },
            end_time: fromUnixSeconds(Math.floor(unix)),
          };
        })
    ),
  };
}

export const helium = chromiumHistory('helium', 'Helium', 'net.imput.helium');

// ── Messages ─────────────────────────────────────────────────────────────

/**
 * Newer macOS stores message text only in attributedBody, an NSArchiver
 * "typedstream". The string follows the NSString class marker: skip five
 * bytes, read a length (0x81 = next two bytes, 0x82 = next three), then text.
 */
export function decodeAttributedBody(blob: Uint8Array | null): string | null {
  if (!blob) return null;
  const buf = Buffer.from(blob);
  const marker = buf.indexOf('NSString');
  if (marker < 0) return null;
  let i = marker + 'NSString'.length + 5;
  let len = buf[i++];
  if (len === 0x81) {
    len = buf.readUInt16LE(i);
    i += 2;
  } else if (len === 0x82) {
    len = buf.readUIntLE(i, 3);
    i += 3;
  }
  return buf.subarray(i, i + len).toString('utf8');
}

const messagesPaths = ['~/Library/Messages/chat.db'];
export const imessage: Connector = {
  id: 'imessage',
  displayName: 'Messages',
  description: 'iMessage and SMS history',
  kind: 'local',
  dbPath: 'imessage/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],
  localPaths: messagesPaths,
  permission: 'full-disk-access',
  sync: localSync({ localPaths: messagesPaths, displayName: 'Messages' }, (db) => {
    const hasBody = columnsOf(db, 'message').has('attributedBody');
    const rows = db
      .query(
        `SELECT m.guid, m.text, ${hasBody ? 'm.attributedBody' : 'NULL'} AS body, m.date, m.is_from_me,
                h.id AS handle, c.display_name AS chat_name, c.chat_identifier
         FROM message m
         LEFT JOIN handle h ON h.ROWID = m.handle_id
         LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
         LEFT JOIN chat c ON c.ROWID = cmj.chat_id`
      )
      .all() as any[];
    return rows
      .map((r) => ({ ...r, text: r.text || decodeAttributedBody(r.body) }))
      .filter((r) => r.text)
      .map((r) => ({
        source_id: r.guid,
        type: r.is_from_me ? 'SendAction' : 'ReceiveAction',
        source: 'imessage',
        agent: { name: r.is_from_me ? 'Me' : r.handle ?? 'Unknown' },
        object: { text: r.text, chat: r.chat_name || r.chat_identifier || r.handle },
        end_time: fromAppleTime(r.date),
      }));
  }),
};

// ── Apple Notes ──────────────────────────────────────────────────────────

/** Read protobuf length-delimited fields; enough to reach a note's text. */
function protoField(buf: Uint8Array, field: number): Uint8Array | null {
  let i = 0;
  const varint = () => {
    let shift = 0;
    let out = 0;
    for (;;) {
      const b = buf[i++];
      out += (b & 0x7f) * 2 ** shift;
      if (b < 0x80 || i >= buf.length) return out;
      shift += 7;
    }
  };
  while (i < buf.length) {
    const tag = varint();
    const num = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 0) varint();
    else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else if (wire === 2) {
      const len = varint();
      if (num === field) return buf.subarray(i, i + len);
      i += len;
    } else return null;
  }
  return null;
}

/** NoteStoreProto > Document (2) > Note (3) > note_text (2) */
export function decodeNoteBody(data: Uint8Array | null): string | null {
  if (!data) return null;
  try {
    const raw = data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data) : data;
    const doc = protoField(raw, 2);
    const note = doc && protoField(doc, 3);
    const text = note && protoField(note, 2);
    return text ? Buffer.from(text).toString('utf8') : null;
  } catch {
    return null;
  }
}

const notesPaths = ['~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite'];
export const appleNotes: Connector = {
  id: 'apple-notes',
  displayName: 'Apple Notes',
  description: 'Notes from the Notes app',
  kind: 'local',
  dbPath: 'apple-notes/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],
  localPaths: notesPaths,
  permission: 'full-disk-access',
  sync: localSync({ localPaths: notesPaths, displayName: 'Apple Notes' }, (db) => {
    const cols = columnsOf(db, 'ZICCLOUDSYNCINGOBJECT');
    const created = firstColumn(cols, ['ZCREATIONDATE3', 'ZCREATIONDATE1', 'ZCREATIONDATE']) ?? 'NULL';
    const modified = firstColumn(cols, ['ZMODIFICATIONDATE1', 'ZMODIFICATIONDATE']) ?? 'NULL';
    const deleted = cols.has('ZMARKEDFORDELETION') ? 'AND COALESCE(n.ZMARKEDFORDELETION, 0) = 0' : '';
    // Chronicle keyed notes by Core Data URI (x-coredata://<store>/ICNote/p<pk>), which differs per Mac.
    let store: string | undefined;
    try {
      store = (db.query('SELECT Z_UUID AS u FROM Z_METADATA LIMIT 1').get() as { u: string } | null)?.u;
    } catch {
      store = undefined;
    }
    const rows = db
      .query(
        `SELECT n.Z_PK AS pk, n.ZIDENTIFIER AS id, n.ZTITLE1 AS title, n.ZSNIPPET AS snippet,
                n.${created} AS created, n.${modified} AS modified, d.ZDATA AS data
         FROM ZICCLOUDSYNCINGOBJECT n
         LEFT JOIN ZICNOTEDATA d ON d.ZNOTE = n.Z_PK
         WHERE n.ZTITLE1 IS NOT NULL ${deleted}`
      )
      .all() as any[];
    // ZIDENTIFIER is the note's iCloud id, the same on every Mac. Older syncs
    // keyed notes by this Mac's Core Data URI; those rows get replaced.
    const replaced: string[] = [];
    const out = rows.map((r) => {
      const legacy = store ? `x-coredata://${store}/ICNote/p${r.pk}` : null;
      const id = r.id ?? legacy;
      if (legacy && legacy !== id) replaced.push(legacy);
      return {
      source_id: id,
      type: 'CreateAction',
      source: 'apple-notes',
      name: r.title,
      text: decodeNoteBody(r.data) ?? r.snippet ?? '',
      date_created: fromAppleTime(r.created),
      endTime: fromAppleTime(r.modified),
      };
    });
    return { rows: out, replaced };
  }),
};

// ── Apple Photos ─────────────────────────────────────────────────────────

const photosPaths = ['~/Pictures/Photos Library.photoslibrary/database/Photos.sqlite'];
export const applePhotos: Connector = {
  id: 'apple-photos',
  displayName: 'Apple Photos',
  description: 'Photo metadata, captions and locations',
  kind: 'local',
  dbPath: 'apple-photos/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],
  localPaths: photosPaths,
  permission: 'full-disk-access',
  sync: localSync({ localPaths: photosPaths, displayName: 'Apple Photos' }, (db) => {
    const aa = columnsOf(db, 'ZADDITIONALASSETATTRIBUTES');
    const hasDesc = aa.has('ZASSETDESCRIPTION');
    const rows = db
      .query(
        `SELECT a.ZUUID AS uuid, ${columnsOf(db, 'ZASSET').has('ZCLOUDASSETGUID') ? 'a.ZCLOUDASSETGUID' : 'NULL'} AS cloud,
                a.ZFILENAME AS filename, a.ZDATECREATED AS created,
                a.ZLATITUDE AS lat, a.ZLONGITUDE AS lon, a.ZKIND AS kind,
                ${aa.has('ZTITLE') ? 'aa.ZTITLE' : 'NULL'} AS title,
                ${aa.has('ZORIGINALFILENAME') ? 'aa.ZORIGINALFILENAME' : 'NULL'} AS original,
                ${hasDesc ? 'd.ZLONGDESCRIPTION' : 'NULL'} AS caption
         FROM ZASSET a
         LEFT JOIN ZADDITIONALASSETATTRIBUTES aa ON aa.ZASSET = a.Z_PK
         ${hasDesc ? 'LEFT JOIN ZASSETDESCRIPTION d ON d.Z_PK = aa.ZASSETDESCRIPTION' : ''}
         WHERE COALESCE(a.ZTRASHEDSTATE, 0) = 0`
      )
      .all() as any[];
    // ZUUID is per library: the same iCloud photo has a different one on each
    // Mac. ZCLOUDASSETGUID is shared, so key on it and replace ZUUID-keyed rows.
    const replaced: string[] = [];
    const out = rows.map((r) => {
      const hasGeo = r.lat != null && r.lat >= -90 && r.lat <= 90 && !(r.lat === 0 && r.lon === 0);
      const id = r.cloud || r.uuid;
      if (id !== r.uuid) replaced.push(r.uuid);
      return {
        source_id: id,
        type: 'PhotographAction',
        source: 'apple-photos',
        name: r.title || r.original || r.filename,
        description: r.caption ?? '',
        additionalType: r.kind === 1 ? 'Video' : 'Photo',
        contentLocation: hasGeo ? { geo: { latitude: r.lat, longitude: r.lon } } : null,
        dateCreated: fromAppleTime(r.created),
      };
    });
    return { rows: out, replaced };
  }),
};

// ── Apple Podcasts ───────────────────────────────────────────────────────

const podcastsPaths = ['~/Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Documents/MTLibrary.sqlite'];
export const applePodcasts: Connector = {
  id: 'apple-podcasts',
  displayName: 'Apple Podcasts',
  description: 'Episodes you have played',
  kind: 'local',
  dbPath: 'apple-podcasts/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],
  localPaths: podcastsPaths,
  sync: localSync({ localPaths: podcastsPaths, displayName: 'Apple Podcasts' }, (db) =>
    (
      db
        .query(
          `SELECT ${columnsOf(db, 'ZMTEPISODE').has('ZSTORETRACKID') ? 'COALESCE(NULLIF(e.ZSTORETRACKID, 0), e.ZUUID)' : 'e.ZUUID'} AS uuid, e.ZTITLE AS title, e.ZWEBPAGEURL AS web, e.ZENCLOSUREURL AS enclosure,
                  COALESCE(e.ZLASTDATEPLAYED, e.ZPLAYSTATELASTMODIFIEDDATE) AS played,
                  e.ZDURATION AS duration, p.ZTITLE AS show, p.ZWEBPAGEURL AS show_web
           FROM ZMTEPISODE e LEFT JOIN ZMTPODCAST p ON p.Z_PK = e.ZPODCAST
           WHERE e.ZLASTDATEPLAYED IS NOT NULL OR (e.ZHASBEENPLAYED = 1 AND e.ZPLAYSTATELASTMODIFIEDDATE IS NOT NULL)`
        )
        .all() as any[]
    ).map((r) => ({
      source_id: r.uuid,
      type: 'ListenAction',
      source: 'apple-podcasts',
      object: {
        name: r.title,
        partOfSeries: { name: r.show, url: r.show_web },
        url: r.web || r.enclosure || null,
        duration: r.duration,
      },
      end_time: fromAppleTime(r.played),
    }))
  ),
};

// ── Things 3 ─────────────────────────────────────────────────────────────

const thingsPaths = [
  '~/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-*/Things Database.thingsdatabase/main.sqlite',
  '~/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/Things Database.thingsdatabase/main.sqlite',
];
const THINGS_STATUS: Record<number, string> = { 0: 'open', 2: 'canceled', 3: 'completed' };
export const things: Connector = {
  id: 'things',
  displayName: 'Things 3',
  description: 'To-dos and projects',
  kind: 'local',
  dbPath: 'things/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],
  localPaths: thingsPaths,
  sync: localSync({ localPaths: thingsPaths, displayName: 'Things' }, (db) =>
    (
      db
        .query(
          `SELECT uuid, type, status, title, notes, creationDate, stopDate
           FROM TMTask WHERE trashed = 0 AND type IN (0, 1) AND title <> ''`
        )
        .all() as any[]
    ).map((r) => ({
      source_id: r.uuid,
      type: 'CreateAction',
      source: 'things',
      additionalType: r.type === 1 ? 'Project' : 'ToDo',
      name: r.title,
      description: r.notes ?? '',
      startTime: fromUnixSeconds(r.creationDate),
      endTime: fromUnixSeconds(r.stopDate),
      actionStatus: THINGS_STATUS[r.status] ?? String(r.status),
    }))
  ),
};

// ── Timing ───────────────────────────────────────────────────────────────

const timingPaths = ['~/Library/Application Support/info.eurocomp.Timing2/SQLite.db'];
/** Timing reassigns projects and merges entries after the fact, so each sync re-reads this far back. */
const TIMING_LOOKBACK_SECONDS = 7 * 24 * 3600;
const TIMING_CURSOR = 'appactivity:startDate';

/**
 * Where to start reading. The cursor is the newest startDate already stored.
 * A database carried over from Chronicle has rows but no cursor, so it starts
 * after its newest row instead of reading Timing's whole history again.
 */
function timingStart(store: RunContext['store'], full?: boolean): number {
  if (full) return 0;
  const saved = Number(store.getState(TIMING_CURSOR));
  if (saved > 0) return saved - TIMING_LOOKBACK_SECONDS;
  try {
    const r = store.db.query(`SELECT MAX(startTime) AS t FROM events WHERE source = 'timing'`).get() as { t: string | null };
    const t = r?.t ? Date.parse(r.t) / 1000 : NaN;
    return Number.isFinite(t) ? t - TIMING_LOOKBACK_SECONDS : 0;
  } catch {
    return 0; // no events table yet: a first sync reads everything
  }
}

/**
 * One row per app activity, in the shape Chronicle used, so the rows it
 * imported and the ones synced here read the same: agent is the app, object
 * the window title and path, result the project.
 */
export const timing: Connector = {
  id: 'timing',
  displayName: 'Timing',
  description: 'App and document usage',
  kind: 'local',
  dbPath: 'timing/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],
  localPaths: timingPaths,
  async sync({ store, full, log }) {
    const path = timingPaths.map(resolveLocalPath).find(Boolean);
    if (!path) throw new NotOnThisMacError('Timing');
    const since = timingStart(store, full);
    if (since > 0) log(`Reading activity since ${fromUnixSeconds(since)}`);

    return withDatabaseCopy(path, (db) => {
      let newest = 0;
      let read = 0;
      const deleted: string[] = [];
      const rows = function* () {
        for (const r of db
          .query(
            `SELECT CAST(a.id AS TEXT) AS id, a.startDate, a.endDate, a.isDeleted, app.title AS app, app.executable, app.bundleIdentifier,
                    t.stringValue AS title, p.stringValue AS path, pr.title AS project
             FROM AppActivity a
             LEFT JOIN Application app ON app.id = a.applicationID
             LEFT JOIN Title t ON t.id = a.titleID
             LEFT JOIN Path p ON p.id = a.pathID
             LEFT JOIN Project pr ON pr.id = a.projectID
             WHERE a.startDate > ?
             ORDER BY a.startDate`
          )
          .iterate(since) as Iterable<any>) {
          newest = Math.max(newest, r.startDate);
          if (r.isDeleted) {
            deleted.push(r.id);
            continue;
          }
          read++;
          // Some apps put a window title in Path rather than Title.
          const located = r.path && /^(\/|~\/|[a-z][a-z0-9+.-]*:\/\/)/i.test(r.path);
          yield {
            source_id: r.id, // TEXT: the ids are past 2^53
            type: 'Action',
            source: 'timing',
            agent: { '@type': 'SoftwareApplication', name: r.app ?? r.executable, identifier: r.bundleIdentifier ?? undefined },
            object: { '@type': 'CreativeWork', name: r.title ?? (located ? undefined : r.path) ?? undefined, url: located ? `file://${r.path}` : undefined },
            result: r.project ? { '@type': 'Project', name: r.project } : null,
            startTime: fromUnixSeconds(r.startDate),
            end_time: fromUnixSeconds(r.endDate),
          };
        }
      };
      const stats: RunStats = {};
      addStats(stats, 'events', store.upsert(EVENTS_TABLE, rows()));
      const removed = store.deleteKeys(EVENTS_TABLE, deleted);
      if (newest > 0) store.setState(TIMING_CURSOR, String(newest));
      log(`${read.toLocaleString()} activities read from Timing${removed ? `, ${removed.toLocaleString()} deleted in Timing removed` : ''}`);
      return stats;
    });
  },
};
