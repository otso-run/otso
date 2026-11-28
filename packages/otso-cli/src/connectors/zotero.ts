import { EVENTS_TABLE } from '../core/chronicle.js';
import { iso } from '../core/time.js';
import type { Connector, RunStats } from './types.js';
import { addStats, htmlToText, NotOnThisMacError, resolveLocalPath, withDatabaseCopy } from './util.js';

/**
 * Zotero library items (articles, books, web pages, videos, …) from the
 * local zotero.sqlite, read from a copy so Zotero can stay open. Each item
 * keeps its creators, date, abstract, tags, collections and the text of its
 * child notes and annotations. Attachments themselves aren't indexed.
 *
 * Items are keyed on Zotero's own 8-character item key, which Zotero sync
 * keeps the same on every computer. Items in the trash are removed.
 */

const zoteroPaths = ['~/Zotero/zotero.sqlite'];
const SKIP_TYPES = new Set(['attachment', 'note', 'annotation']);

/** Zotero writes "2024-01-03 18:40:00" in UTC. */
const zoteroTime = (s: string | null) => (s ? iso(s.replace(' ', 'T') + 'Z') : null);

export const zotero: Connector = {
  id: 'zotero',
  displayName: 'Zotero',
  description: 'Library items, notes and annotations',
  kind: 'local',
  dbPath: 'zotero/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],
  localPaths: zoteroPaths,

  async sync({ store, log }) {
    const path = zoteroPaths.map(resolveLocalPath).find(Boolean);
    if (!path) throw new NotOnThisMacError('Zotero');

    return withDatabaseCopy(path, (db) => {
      const items = db
        .query(
          `SELECT i.itemID AS id, i.key, t.typeName AS type, i.dateAdded, i.dateModified,
                  (SELECT 1 FROM deletedItems d WHERE d.itemID = i.itemID) AS trashed
           FROM items i JOIN itemTypes t ON t.itemTypeID = i.itemTypeID`
        )
        .all() as any[];

      const fields = new Map<number, Record<string, string>>();
      for (const r of db
        .query(
          `SELECT d.itemID AS id, f.fieldName AS field, v.value FROM itemData d
           JOIN fields f ON f.fieldID = d.fieldID JOIN itemDataValues v ON v.valueID = d.valueID`
        )
        .iterate() as Iterable<any>) {
        const m = fields.get(r.id) ?? {};
        m[r.field] = String(r.value);
        fields.set(r.id, m);
      }

      const group = (sql: string) => {
        const out = new Map<number, string[]>();
        for (const r of db.query(sql).iterate() as Iterable<any>) {
          if (r.v == null || r.v === '') continue;
          const list = out.get(r.id) ?? [];
          list.push(String(r.v));
          out.set(r.id, list);
        }
        return out;
      };
      const creators = group(
        `SELECT ic.itemID AS id, TRIM(COALESCE(c.firstName, '') || ' ' || COALESCE(c.lastName, '')) AS v
         FROM itemCreators ic JOIN creators c ON c.creatorID = ic.creatorID ORDER BY ic.itemID, ic.orderIndex`
      );
      const tags = group(`SELECT it.itemID AS id, t.name AS v FROM itemTags it JOIN tags t ON t.tagID = it.tagID`);
      const collections = group(
        `SELECT ci.itemID AS id, c.collectionName AS v FROM collectionItems ci JOIN collections c ON c.collectionID = ci.collectionID`
      );
      const tables = new Set((db.query(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as any[]).map((t) => t.name));
      // Child notes hang off their parent item; annotations hang off an attachment, whose parent is the item.
      const notes = group(`SELECT parentItemID AS id, note AS v FROM itemNotes WHERE parentItemID IS NOT NULL`);
      const annotations = tables.has('itemAnnotations')
        ? group(
            `SELECT a.parentItemID AS id, TRIM(COALESCE(n.text, '') || ' ' || COALESCE(n.comment, '')) AS v
             FROM itemAnnotations n JOIN itemAttachments a ON a.itemID = n.parentItemID WHERE a.parentItemID IS NOT NULL`
          )
        : new Map<number, string[]>();

      const rows: Record<string, unknown>[] = [];
      const trashed: string[] = [];
      for (const it of items) {
        if (SKIP_TYPES.has(it.type)) continue;
        const key = `zotero-${it.key}`;
        if (it.trashed) {
          trashed.push(key);
          continue;
        }
        const f = fields.get(it.id) ?? {};
        const noteText = [...(notes.get(it.id) ?? []).map(htmlToText), ...(annotations.get(it.id) ?? [])].filter(Boolean).join('\n\n');
        rows.push({
          source_id: key,
          type: 'BookmarkAction',
          source: 'zotero',
          additionalType: it.type,
          name: f.title || f.caseName || f.nameOfAct || f.subject || f.url || '(untitled)',
          description: f.abstractNote ?? '',
          text: noteText,
          date_created: zoteroTime(it.dateAdded),
          endTime: zoteroTime(it.dateModified),
          object: {
            url: f.url || (f.DOI ? `https://doi.org/${f.DOI}` : undefined),
            creators: creators.get(it.id) ?? [],
            date: f.date || undefined,
            publication: f.publicationTitle || f.websiteTitle || f.bookTitle || f.blogTitle || undefined,
            publisher: f.publisher || undefined,
            keywords: tags.get(it.id) ?? [],
            collections: collections.get(it.id) ?? [],
          },
        });
      }

      const stats: RunStats = {};
      addStats(stats, 'events', store.upsert(EVENTS_TABLE, rows));
      const removed = store.deleteKeys(EVENTS_TABLE, trashed);
      log(`${rows.length.toLocaleString()} items read from Zotero${removed ? `, ${removed} in the trash removed` : ''}`);
      return stats;
    });
  },
};
