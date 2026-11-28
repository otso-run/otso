import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSync } from '../src/core/runner.js';
import { runTomlQueries, sandbox } from './helpers.js';

const realHome = process.env.HOME;

beforeAll(() => {
  process.env.HOME = mkdtempSync(join(tmpdir(), 'otso-home-'));
  mkdirSync(join(process.env.HOME, 'Zotero'));
  const db = new Database(join(process.env.HOME, 'Zotero/zotero.sqlite'), { create: true });
  db.exec(`
    CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
    CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INT, dateAdded TEXT, dateModified TEXT, key TEXT);
    CREATE TABLE fields (fieldID INTEGER PRIMARY KEY, fieldName TEXT);
    CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value);
    CREATE TABLE itemData (itemID INT, fieldID INT, valueID INT);
    CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
    CREATE TABLE itemCreators (itemID INT, creatorID INT, orderIndex INT);
    CREATE TABLE tags (tagID INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE itemTags (itemID INT, tagID INT);
    CREATE TABLE collections (collectionID INTEGER PRIMARY KEY, collectionName TEXT);
    CREATE TABLE collectionItems (collectionID INT, itemID INT);
    CREATE TABLE itemNotes (itemID INTEGER PRIMARY KEY, parentItemID INT, note TEXT);
    CREATE TABLE itemAttachments (itemID INTEGER PRIMARY KEY, parentItemID INT);
    CREATE TABLE itemAnnotations (itemID INTEGER PRIMARY KEY, parentItemID INT, text TEXT, comment TEXT);
    CREATE TABLE deletedItems (itemID INTEGER PRIMARY KEY);
    INSERT INTO itemTypes VALUES (1, 'journalArticle'), (2, 'attachment'), (3, 'note'), (4, 'book');
    INSERT INTO items VALUES (1, 1, '2024-01-03 18:40:00', '2024-01-04 00:00:00', 'ABCD1234'),
      (2, 2, '2024-01-03 18:41:00', '2024-01-03 18:41:00', 'ATTACH01'),
      (3, 3, '2024-01-03 18:42:00', '2024-01-03 18:42:00', 'NOTE0001'),
      (4, 4, '2024-01-05 00:00:00', '2024-01-05 00:00:00', 'TRASHED1');
    INSERT INTO fields VALUES (1, 'title'), (2, 'abstractNote'), (3, 'url'), (4, 'date'), (5, 'publicationTitle');
    INSERT INTO itemDataValues VALUES (1, 'On Paths'), (2, 'An abstract.'), (3, 'https://example.com/paper'), (4, '2020'), (5, 'Journal of Things'), (6, 'Gone');
    INSERT INTO itemData VALUES (1, 1, 1), (1, 2, 2), (1, 3, 3), (1, 4, 4), (1, 5, 5), (4, 1, 6);
    INSERT INTO creators VALUES (1, 'Ada', 'Lovelace'), (2, 'Alan', 'Turing');
    INSERT INTO itemCreators VALUES (1, 2, 1), (1, 1, 0);
    INSERT INTO tags VALUES (1, 'theory');
    INSERT INTO itemTags VALUES (1, 1);
    INSERT INTO collections VALUES (1, 'Thesis');
    INSERT INTO collectionItems VALUES (1, 1);
    INSERT INTO itemNotes VALUES (3, 1, '<p>My <b>note</b></p>');
    INSERT INTO itemAttachments VALUES (2, 1);
    INSERT INTO itemAnnotations VALUES (5, 2, 'highlighted text', 'a comment');
    INSERT INTO deletedItems VALUES (4);
  `);
  db.close();
});

afterAll(() => {
  process.env.HOME = realHome;
});

test('zotero items with creators, notes and annotations; attachments, notes and trash skipped', async () => {
  const { sources } = sandbox();
  expect((await runSync('zotero')).stats.events.inserted).toBe(1);
  expect((await runSync('zotero')).stats.events.inserted).toBe(0);
  expect(runTomlQueries('zotero', sources)).toEqual([
    {
      external_id: 'zotero-ABCD1234',
      title: 'On Paths',
      content: 'Ada Lovelace, Alan Turing\nJournal of Things 2020\nAn abstract.\nMy note\n\nhighlighted text a comment\ntheory Thesis',
      occurred_at: '2024-01-03T18:40:00Z',
      url: 'https://example.com/paper',
    },
  ]);
});
