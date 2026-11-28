import { EVENTS_TABLE, type TableDef } from '../core/chronicle.js';
import { getJson, HttpError } from '../core/http.js';
import { iso } from '../core/time.js';
import type { Connector, RunStats } from './types.js';
import { addStats } from './util.js';

/**
 * Granola meeting notes through its public API (personal API key).
 *
 * One events row per note: title, the AI summary and your own notes,
 * attendees, folders and the calendar event it belongs to. Transcripts go in
 * their own table, like Reader article bodies, so the events rows stay small.
 *
 * The list endpoint only returns notes that already have a summary. After the
 * first sync, each run asks only for notes updated since the newest one it
 * stored, so a note summarised later still comes in.
 */

const API = 'https://public-api.granola.ai/v1';
const CURSOR = 'updated_after';

/** Granola allows 5 requests a second; stay a little under. */
export const granolaPacing = { minIntervalMs: 250 };

export const GRANOLA_TRANSCRIPTS_TABLE: TableDef = {
  name: 'granola_transcripts',
  key: 'source_id',
  columns: ['source_id', 'text', 'items', 'updated_at'],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
async function get<T = any>(path: string, token: string): Promise<T> {
  const wait = lastCall + granolaPacing.minIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  return getJson<T>(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

/** "Me:" for your microphone, the diarised speaker if there is one, else "Them:". */
function speakerLabel(s: any): string {
  if (s?.attribution === 'me' || (s?.source === 'microphone' && !s?.diarization_label)) return 'Me';
  return s?.diarization_label || 'Them';
}

export function transcriptText(items: any[]): string {
  const lines: string[] = [];
  for (const t of items) {
    const who = speakerLabel(t.speaker);
    const prev = lines.length ? lines[lines.length - 1] : '';
    // Fold consecutive items from the same speaker into one line.
    if (prev.startsWith(`${who}: `)) lines[lines.length - 1] = `${prev} ${t.text}`;
    else lines.push(`${who}: ${t.text}`);
  }
  return lines.join('\n');
}

async function fullTranscript(id: string, token: string): Promise<any[]> {
  const items: any[] = [];
  let cursor: string | null = null;
  do {
    const p = new URLSearchParams(cursor ? { cursor } : {});
    const res: any = await get(`/notes/${id}/transcript${cursor ? `?${p}` : ''}`, token);
    items.push(...(res?.transcript ?? []));
    cursor = res?.hasMore ? res.cursor : null;
  } while (cursor);
  return items;
}

/** A note with its transcript, falling back to the paged endpoint for long meetings. */
async function fetchNote(id: string, token: string): Promise<{ note: any; transcript: any[] | null }> {
  try {
    const note = await get(`/notes/${id}?include=transcript`, token);
    return { note, transcript: note?.transcript ?? null };
  } catch (err) {
    if (!(err instanceof HttpError) || !/TRANSCRIPT_TOO_LARGE/.test(err.body)) throw err;
    const note = await get(`/notes/${id}`, token);
    return { note, transcript: await fullTranscript(id, token) };
  }
}

export function granolaRow(n: any) {
  const cal = n.calendar_event ?? null;
  const people = (n.attendees ?? []).map((a: any) => ({ name: a.name ?? undefined, email: a.email }));
  const own = n.private_notes_markdown || n.private_notes_text || '';
  return {
    source_id: n.id,
    type: 'CreateAction',
    source: 'granola',
    additionalType: 'Meeting',
    name: n.title || cal?.event_title || 'Untitled meeting',
    description: n.summary_markdown || n.summary_text || '',
    text: own,
    startTime: iso(cal?.scheduled_start_time) ?? iso(n.created_at),
    endTime: iso(cal?.scheduled_end_time),
    date_created: iso(n.created_at),
    object: {
      url: n.web_url,
      attendees: people,
      folders: (n.folder_membership ?? []).map((f: any) => f.name),
      calendarEventId: cal?.calendar_event_id ?? undefined,
      organiser: cal?.organiser ?? undefined,
      updated: n.updated_at,
    },
  };
}

export const granola: Connector = {
  id: 'granola',
  displayName: 'Granola',
  description: 'Meeting notes, summaries and transcripts',
  kind: 'api',
  dbPath: 'granola/chronicle/chronicle.db',
  tables: [EVENTS_TABLE, GRANOLA_TRANSCRIPTS_TABLE],

  auth: {
    setupUrl: 'https://docs.granola.ai/help-center/sharing/integrations/granola-api',
    instructions: [
      'In the Granola app, open Settings > API (or Connectors > API keys) and create a personal key.',
      'Give it access to your personal notes, then copy the key.',
    ],
    fields: [{ name: 'accessToken', label: 'API key', secret: true }],
    async verify(creds) {
      const res = await get<any>('/notes?page_size=1', creds.accessToken);
      if (!res || !Array.isArray(res.notes)) throw new Error('Granola did not accept the key');
      return res.notes[0]?.owner?.name || 'Granola';
    },
  },

  async sync({ store, credentials, full, log }) {
    const token = credentials.accessToken;
    const since = full ? null : store.getState(CURSOR);
    const stats: RunStats = {};
    let newest = since ?? '';
    let read = 0;
    const deleted: string[] = [];

    let cursor: string | null = null;
    do {
      const p = new URLSearchParams({ page_size: '30' });
      if (since) p.set('updated_after', since);
      if (cursor) p.set('cursor', cursor);
      const page: any = await get(`/notes?${p}`, token);
      for (const summary of page?.notes ?? []) {
        if (summary.updated_at > newest) newest = summary.updated_at;
        if (summary.deleted_at) {
          deleted.push(summary.id);
          continue;
        }
        const { note, transcript } = await fetchNote(summary.id, token);
        addStats(stats, 'events', store.upsert(EVENTS_TABLE, [granolaRow(note)]));
        if (transcript?.length) {
          addStats(
            stats,
            'granola_transcripts',
            store.upsert(GRANOLA_TRANSCRIPTS_TABLE, [
              { source_id: note.id, text: transcriptText(transcript), items: transcript, updated_at: note.updated_at },
            ])
          );
        }
        read++;
        if (read % 50 === 0) log(`${read.toLocaleString()} notes so far`);
      }
      cursor = page?.hasMore ? page.cursor : null;
    } while (cursor);

    const removed = store.deleteKeys(EVENTS_TABLE, deleted) + store.deleteKeys(GRANOLA_TRANSCRIPTS_TABLE, deleted);
    // Only advance once every page is stored.
    if (newest) store.setState(CURSOR, newest);
    log(`${read.toLocaleString()} notes${since ? ' updated since last sync' : ''}${removed ? `, deleted ones removed` : ''}`);
    return stats;
  },
};
