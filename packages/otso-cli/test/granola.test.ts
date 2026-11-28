import { afterEach, describe, expect, test } from 'bun:test';
import { granolaPacing } from '../src/connectors/granola.js';
import { authenticate, runSync } from '../src/core/runner.js';
import { mockFetch, runTomlQueries, sandbox } from './helpers.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const summary = (id: string, updated: string, deleted: string | null = null) => ({
  id,
  object: 'note',
  title: `Meeting ${id}`,
  owner: { name: 'Test User', email: 'me@example.com' },
  created_at: '2024-01-03T18:00:00Z',
  updated_at: updated,
  deleted_at: deleted,
});

const note = (id: string, updated: string) => ({
  ...summary(id, updated),
  web_url: `https://notes.granola.ai/d/${id}`,
  calendar_event: { event_title: 'Weekly sync', scheduled_start_time: '2024-01-03T18:40:00Z', scheduled_end_time: '2024-01-03T19:10:00Z' },
  attendees: [{ name: 'Alex Example', email: 'alex@example.com' }],
  folder_membership: [{ id: 'fol_1', name: 'Work' }],
  summary_markdown: '## Decisions\n- ship it',
  private_notes_markdown: 'my own note',
  transcript:
    id === 'not_long'
      ? undefined
      : [
          { speaker: { source: 'microphone', attribution: 'me' }, text: 'Hello.' },
          { speaker: { source: 'microphone', attribution: 'me' }, text: 'Shall we start?' },
          { speaker: { source: 'speaker', attribution: 'them' }, text: 'Yes, the budget.' },
        ],
});

describe('granola', () => {
  test('notes with summary, own notes and transcript; then only updated ones; deleted removed', async () => {
    granolaPacing.minIntervalMs = 0;
    const { sources } = sandbox();
    let list = [summary('not_a', '2024-01-04T00:00:00Z'), summary('not_long', '2024-01-05T00:00:00Z')];
    const calls = mockFetch([
      {
        match: /\/v1\/notes\?/,
        respond: (u) => {
          const after = u.searchParams.get('updated_after');
          const notes = list.filter((n) => !after || n.updated_at > after);
          // Two pages of one note each on the first sync.
          if (!after && !u.searchParams.get('cursor')) return { body: { notes: notes.slice(0, 1), hasMore: true, cursor: 'c2' } };
          if (!after) return { body: { notes: notes.slice(1), hasMore: false, cursor: null } };
          return { body: { notes, hasMore: false, cursor: null } };
        },
      },
      { match: /not_long\/transcript$/, respond: () => ({ body: { transcript: [{ speaker: { source: 'speaker' }, text: 'Part one.' }], hasMore: true, cursor: 'p2' } }) },
      { match: /not_long\/transcript\?cursor=p2/, respond: () => ({ body: { transcript: [{ speaker: { source: 'speaker' }, text: 'Part two.' }], hasMore: false, cursor: null } }) },
      { match: /not_long\?include=transcript/, respond: () => ({ status: 400, body: { code: 'TRANSCRIPT_TOO_LARGE' } }) },
      { match: /\/v1\/notes\/(not_\w+)/, respond: (u) => ({ body: note(u.pathname.split('/').pop()!, list.find((n) => u.pathname.endsWith(n.id))!.updated_at) }) },
    ]);

    expect(await authenticate('granola', { accessToken: 'grn_test' })).toBe('Test User');
    const first = await runSync('granola');
    expect(first.stats.events.inserted).toBe(2);
    expect(first.stats.granola_transcripts.inserted).toBe(2);

    const rows = runTomlQueries('granola', sources);
    const a = rows.find((r: any) => r.external_id === 'not_a');
    expect(a.title).toBe('Meeting not_a');
    expect(a.occurred_at).toBe('2024-01-03T18:40:00Z');
    expect(a.url).toBe('https://notes.granola.ai/d/not_a');
    expect(a.content).toBe('## Decisions\n- ship it\nmy own note\nAlex Example\nMe: Hello. Shall we start?\nThem: Yes, the budget.');
    expect(rows.find((r: any) => r.external_id === 'not_long').content).toEndWith('Them: Part one. Part two.');

    // Nothing changed: one list call, no note fetches.
    calls.length = 0;
    await runSync('granola');
    expect(calls.filter((c) => /\/notes\/not_/.test(c))).toHaveLength(0);
    expect(calls[0]).toContain('updated_after=2024-01-05T00%3A00%3A00Z');

    // not_a deleted in Granola.
    list = [summary('not_a', '2024-01-06T00:00:00Z', '2024-01-06T00:00:00Z'), list[1]];
    await runSync('granola');
    expect(runTomlQueries('granola', sources).map((r: any) => r.external_id)).toEqual(['not_long']);
  });
});
