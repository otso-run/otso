import type { TableDef } from '../core/chronicle.js';
import { iso } from '../core/time.js';
import type { Connector, RunStats } from './types.js';
import { addStats, shortHash } from './util.js';
import { addressNames, mailDate, parseMessage, readMbox } from './takeout/mime.js';

/**
 * Gmail from Google Takeout: Takeout/Mail/*.mbox (one big "All mail
 * Including Spam and Trash.mbox"). It gets its own source and db because
 * a mailbox is often tens of GB, far bigger than everything else in a
 * Takeout. The mbox is streamed, so memory use stays flat; only the
 * message text (capped at 32 KB) and attachment names are kept.
 */

export const MAIL_TABLE: TableDef = {
  name: 'messages',
  key: 'source_id',
  columns: [
    'source_id',
    'message_id',
    'thread_id',
    'subject',
    'sender',
    'recipients',
    'cc',
    'date',
    'labels',
    'body',
    'attachments',
    'mailbox',
  ],
};

export const mailKey = (messageId: string | undefined, date: string | null, from: string, subject: string) =>
  `mail-${messageId ? shortHash(messageId.replace(/^<|>$/g, '')) : shortHash(date, from, subject)}`;

/** "From 1786...@xxx Wed Jan 10 19:40:01 +0000 2024" -> the date part. */
const fromLineDate = (line: string) => {
  const m = line.match(/^From \S+\s+(.+)$/);
  return m ? mailDate(m[1]) : null;
};

export function mailRow(raw: string, fromLine: string, mailbox: string) {
  const msg = parseMessage(raw);
  const h = msg.headers;
  const date = iso(mailDate(h.get('date')) ?? fromLineDate(fromLine));
  const sender = addressNames(h.get('from'));
  const subject = h.get('subject') ?? '';
  const messageId = h.get('message-id')?.trim();
  return {
    source_id: mailKey(messageId, date, sender, subject),
    message_id: messageId?.replace(/^<|>$/g, '') ?? null,
    thread_id: h.get('x-gm-thrid') ?? null,
    subject,
    sender,
    recipients: addressNames(h.get('to')),
    cc: addressNames(h.get('cc')),
    date,
    labels: (h.get('x-gmail-labels') ?? '')
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean)
      .join(','),
    body: msg.text,
    attachments: msg.attachments.length ? msg.attachments : null,
    mailbox,
  };
}

/** Stream an mbox into `table`, upserting in batches. Returns rows seen. */
export async function ingestMbox(
  store: { upsert: (def: TableDef, rows: Iterable<Record<string, unknown>>) => { inserted: number; updated: number } },
  stats: RunStats,
  table: TableDef,
  path: string,
  toRow: (raw: string, fromLine: string) => Record<string, unknown>,
  log: (m: string) => void
): Promise<number> {
  let batch: Record<string, unknown>[] = [];
  let seen = 0;
  const flush = () => {
    addStats(stats, table.name, store.upsert(table, batch));
    batch = [];
  };
  for await (const { raw, fromLine } of readMbox(path)) {
    try {
      batch.push(toRow(raw, fromLine));
    } catch (err: any) {
      log(`Skipped an unreadable message: ${err?.message ?? err}`);
    }
    seen++;
    if (batch.length >= 500) flush();
    if (seen % 10_000 === 0) log(`  ${seen.toLocaleString()} messages so far`);
  }
  if (batch.length) flush();
  return seen;
}

export const gmail: Connector = {
  id: 'gmail',
  displayName: 'Gmail',
  description: 'Mail from a Google Takeout (mbox)',
  kind: 'export',
  dbPath: 'gmail/chronicle/chronicle.db',
  tables: [MAIL_TABLE],

  exportGuide: {
    url: 'https://takeout.google.com/',
    steps: [
      'Click "Deselect all", then tick Mail',
      'Next step: export once, .zip, 50 GB, then "Create export"',
      'Download every part from the email Google sends',
      'Give otso the zip, or the folder you unzipped it into',
    ],
    filePatterns: ['takeout-*.zip', 'takeout-*.tgz'],
    wait: 'hours to a couple of days',
  },

  async ingest({ store, log }, archive) {
    const stats: RunStats = {};
    const files = archive.find(/(^|\/)Mail\/[^/]+\.mbox$/i);
    if (!files.length) throw new Error('No Takeout/Mail/*.mbox found. Include Mail in the Takeout, or pass the folder that holds it.');
    for (const file of files) {
      const mailbox = file.split('/').pop()!.replace(/\.mbox$/i, '');
      log(`Mail ${mailbox}`);
      const n = await ingestMbox(store, stats, MAIL_TABLE, archive.abs(file), (raw, fromLine) => mailRow(raw, fromLine, mailbox), log);
      log(`Mail ${mailbox}: ${n.toLocaleString()}`);
    }
    return stats;
  },
};
