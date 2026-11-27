import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIngest } from '../src/core/runner.js';
import { runTomlQueries, sandbox, writeFiles } from './helpers.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'otso-export-'));

/** Ingest twice: the second run must add nothing new. */
async function ingestTwice(id: string, input: string) {
  const [first] = await runIngest(id, [input]);
  const [second] = await runIngest(id, [input]);
  for (const s of Object.values(second.stats)) expect(s.inserted).toBe(0);
  return { first, second };
}

function expectIndexable(rows: any[]) {
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) {
    expect(r.external_id).toBeTruthy();
    expect(r.occurred_at).toBeTruthy();
  }
}

describe('export connectors produce rows the sources.toml queries can read', () => {
  test('spotify extended history (zip), short plays dropped', async () => {
    const { sources } = sandbox();
    const dir = writeFiles(tmp(), {
      'Spotify Extended Streaming History/Streaming_History_Audio_2023_0.json': JSON.stringify([
        {
          ts: '2023-05-01T10:03:00Z',
          ms_played: 180000,
          master_metadata_track_name: 'Song',
          master_metadata_album_artist_name: 'Band',
          master_metadata_album_album_name: 'LP',
          spotify_track_uri: 'spotify:track:abc',
        },
        { ts: '2023-05-01T10:04:00Z', ms_played: 4000, master_metadata_track_name: 'Skipped', spotify_track_uri: 'spotify:track:def' },
        { ts: '2023-05-02T08:00:00Z', ms_played: 600000, episode_name: 'Ep 1', episode_show_name: 'Show', spotify_episode_uri: 'spotify:episode:xyz' },
      ]),
    });
    const zip = join(tmp(), 'my_spotify_data.zip');
    execFileSync('zip', ['-qr', zip, '.'], { cwd: dir });

    const { first } = await ingestTwice('spotify', zip);
    expect(first.stats.events.inserted).toBe(2);
    const rows = runTomlQueries('spotify', sources);
    expectIndexable(rows);
    expect(rows.map((r: any) => r.title).sort()).toEqual(['Band - Song', 'Show - Ep 1']);
    expect(rows.find((r: any) => r.title === 'Band - Song').occurred_at).toBe('2023-05-01T10:00:00Z');
    expect(existsSync(join(sources, 'spotify', 'exports', 'my_spotify_data.zip'))).toBe(true);
  });

  test('claude conversations.json', async () => {
    const { sources } = sandbox();
    const dir = writeFiles(tmp(), {
      'conversations.json': JSON.stringify([
        {
          uuid: 'c1',
          name: 'Planning',
          summary: '',
          created_at: '2024-03-01T12:00:00Z',
          chat_messages: [
            { sender: 'human', text: 'Help me plan a trip', created_at: '2024-03-01T12:00:00Z' },
            { sender: 'assistant', content: [{ type: 'text', text: 'Sure' }] },
          ],
        },
      ]),
    });
    await ingestTwice('claude', dir);
    const rows = runTomlQueries('claude', sources);
    expectIndexable(rows);
    expect(rows[0]).toMatchObject({ title: 'Planning', content: 'Help me plan a trip', url: 'https://claude.ai/chat/c1' });
  });

  test('claude split export: one zip per category, in any order', async () => {
    const { sources } = sandbox();
    const folder = tmp();
    const cloud = (rows: unknown[]) => JSON.stringify({ claude_code_cloud: rows });
    const parts: Record<string, Record<string, string>> = {
      'memories-000.zip': {
        'memories/a1.json': JSON.stringify({
          conversations_memory: 'Likes long walks.',
          project_memories: { p1: 'Garden is zone 6b.' },
          memory_files: [{ path: 'habits.md', content: 'Waters plants on Sundays', updated_at: '2024-06-01T00:00:00Z' }],
          account_uuid: 'a1',
        }),
      },
      'projects-000.zip': {
        'projects/p1.json': JSON.stringify({
          uuid: 'p1',
          name: 'Garden',
          description: 'Planting notes',
          prompt_template: '',
          is_private: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-02-01T00:00:00Z',
          docs: [{ uuid: 'd1', filename: 'beds.md', content: 'Tomatoes by the fence', created_at: '2024-01-02T00:00:00Z' }],
        }),
      },
      'design_chats-000.zip': {
        'design_chats/x1.json': JSON.stringify({
          uuid: 'x1',
          title: 'Logo',
          project: { uuid: 'dp1', name: 'Brand' },
          created_at: '2024-04-01T00:00:00Z',
          updated_at: '2024-04-01T00:00:00Z',
          messages: [
            { uuid: 'm1', role: 'user', content: { role: 'user', content: 'Draw a bear' }, created_at: '2024-04-01T00:00:00Z' },
            { uuid: 'm2', role: 'assistant', content: { role: 'assistant', content: 'Here it is' }, created_at: '2024-04-01T00:00:01Z' },
          ],
        }),
      },
      'conversations-000.zip': {
        'conversations.json': JSON.stringify([
          { uuid: 'c9', name: 'Hello', summary: 'A greeting', created_at: '2024-05-01T00:00:00Z', chat_messages: [] },
        ]),
      },
      'frames-000.zip': {
        'artifacts/f1/artifact.json': JSON.stringify({
          id: 'f1', kind: 'page', visibility: 'private', active_version: 'v1', updated_at: '2024-07-02T00:00:00Z',
          versions: [{ id: 'v1', title: 'Trip notes', created_at: '2024-07-01T00:00:00Z' }],
        }),
        'artifacts/f1/page.md': '# Trip notes\n\nPack the tent.',
        'artifacts/f1/comments.json': JSON.stringify([{ resolved: false, tab: 't', quoted_text: 'tent', comments: [{ text: 'Which tent?' }] }]),
        'artifacts/f2/artifact.json': JSON.stringify({
          id: 'f2', kind: 'artifact', visibility: 'private', active_version: 'v2', updated_at: '2024-08-02T00:00:00Z',
          versions: [
            { id: 'v1', title: 'Deck draft', created_at: '2024-08-01T00:00:00Z' },
            { id: 'v2', title: 'Deck', created_at: '2024-08-02T00:00:00Z' },
          ],
        }),
        'artifacts/f2/versions/v2/project/slides/cover.html': '<section><h1>Hello &amp; welcome</h1><script>x()</script></section>',
        'artifacts/f2/versions/v2/SKILL.md': 'template instructions',
        'artifacts/f2/versions/v2/artifact-type/reference/format.md': 'template reference',
      },
      'feedback-000.zip': {
        'reflections/a1.json': JSON.stringify({
          account_uuid: 'a1',
          reflections: [
            {
              period: '2024-09',
              content: { hero_title: 'A month of gardening', hero_body: 'You planned beds.', topics: [{ title: 'Garden', description: 'Lots', percent: 50 }] },
              created_at: '2024-10-01T00:00:00Z',
              updated_at: '2024-10-01T00:00:00Z',
            },
          ],
          feedback: [],
        }),
      },
      'claude_code_cloud-000.zip': {
        'claude_code_cloud/routines.json': cloud([
          { routine_id: 'r1', name: 'Daily digest', prompt: 'Summarise my day', prompt_withheld: false, enabled: true, schedule: { cron: '0 8 * * *' }, created_at: '2024-11-01T00:00:00Z', updated_at: '2024-11-01T00:00:00Z' },
        ]),
        'claude_code_cloud/channels/channels.json': cloud([{ channel_id: 'chan_1', content: { name: 'Otso' } }]),
        'claude_code_cloud/channels/messages.json': cloud([
          { message_id: 'm1', channel_id: 'chan_1', thread_root_message_id: 'm1', author_account_uuid: 'a1', text: 'Fix the search bug', created_at: '2024-11-02T00:00:00Z' },
          { message_id: 'm2', channel_id: 'chan_1', thread_root_message_id: 'm1', author_agent_id: 'ag', text: 'Done, PR is up', created_at: '2024-11-02T01:00:00Z' },
          { message_id: 'm3', channel_id: 'chan_1', thread_root_message_id: 'm1', notice: { text: 'status' }, text: null, created_at: '2024-11-02T02:00:00Z' },
        ]),
        'claude_code_cloud/channel_memory_files.json': cloud([
          { account_uuid: 'a1', channel: 'Otso', memory: 'channel', path: 'setup.md', content: 'Runs on the Mac mini', created_at: '2024-11-03T00:00:00Z', updated_at: '2024-11-03T00:00:00Z' },
        ]),
      },
      'light_metadata-000.zip': { 'users.json': '[]', 'login_history.json': '{"login_events":[]}' },
    };
    for (const [name, files] of Object.entries(parts)) {
      execFileSync('zip', ['-qr', join(folder, name), '.'], { cwd: writeFiles(tmp(), files) });
    }
    writeFiles(folder, {
      'manifest.json': JSON.stringify({ created_at: '2024-12-01T00:00:00+00:00', data_files: [] }),
    });

    const { first } = await ingestTwice('claude', folder);
    expect(first.stats.projects.inserted).toBe(1);
    expect(first.stats.project_docs.inserted).toBe(1);
    expect(first.stats.memories.inserted).toBe(2);
    expect(first.stats.memory_files.inserted).toBe(2);
    expect(first.stats.design_chats.inserted).toBe(1);
    expect(first.stats.conversations.inserted).toBe(1);
    expect(first.stats.artifacts.inserted).toBe(2);
    expect(first.stats.reflections.inserted).toBe(1);
    expect(first.stats.routines.inserted).toBe(1);
    expect(first.stats.threads.inserted).toBe(1);

    const rows = runTomlQueries('claude', sources);
    expectIndexable(rows);
    const byId = Object.fromEntries(rows.map((r: any) => [r.external_id, r]));
    expect(byId['c9'].title).toBe('Hello');
    expect(byId['project:p1']).toMatchObject({ title: 'Garden', content: 'Planting notes' });
    expect(byId['project-doc:d1']).toMatchObject({ title: 'beds.md (Garden)', content: 'Tomatoes by the fence' });
    expect(byId['memory:a1:project:p1'].title).toBe('Claude memory: Garden');
    expect(byId['memory:a1:conversations']).toMatchObject({ content: 'Likes long walks.', occurred_at: '2024-12-01T00:00:00+00:00' });
    expect(byId['memory-file:a1:memory:habits.md']).toMatchObject({ title: 'Claude memory: habits.md', occurred_at: '2024-06-01T00:00:00Z' });
    expect(byId['memory-file:a1:channel:Otso:channel:setup.md'].title).toBe('Claude memory: Otso/setup.md');
    expect(byId['design:x1']).toMatchObject({ title: 'Logo', content: 'Draw a bear' });
    expect(byId['artifact:f1']).toMatchObject({ title: 'Trip notes', url: 'https://claude.ai/artifact/f1' });
    expect(byId['artifact:f1'].content).toContain('Pack the tent.');
    expect(byId['artifact:f1'].content).toContain('Which tent?');
    expect(byId['artifact:f2']).toMatchObject({ title: 'Deck', content: 'Hello & welcome', occurred_at: '2024-08-01T00:00:00Z' });
    expect(byId['reflection:a1:2024-09']).toMatchObject({ title: 'A month of gardening' });
    expect(byId['routine:r1']).toMatchObject({ title: 'Routine: Daily digest', content: 'Summarise my day' });
    expect(byId['thread:m1']).toMatchObject({
      title: 'Fix the search bug (Otso)',
      content: 'Me: Fix the search bug\n\nClaude: Done, PR is up',
      url: 'https://claude.ai/code/project/chan_1?thread=m1',
    });
  });

  test('pinboard JSON export', async () => {
    const { sources } = sandbox();
    const file = join(
      writeFiles(tmp(), {
        'pinboard_export.json': JSON.stringify([
        { href: 'https://example.com', description: 'Example', extended: 'notes', meta: 'm', hash: 'h1', time: '2022-02-02T02:02:02Z', shared: 'yes', toread: 'no', tags: 'web dev' },
        ]),
      }),
      'pinboard_export.json'
    );
    await ingestTwice('pinboard', file);
    const rows = runTomlQueries('pinboard', sources);
    expectIndexable(rows);
    expect(rows[0]).toMatchObject({ title: 'Example', url: 'https://example.com', occurred_at: '2022-02-02T02:02:02Z' });
    expect(rows[0].content).toContain('web dev');
  });

  test('last.fm CSV from lastfm-to-csv (no header)', async () => {
    const { sources } = sandbox();
    const dir = writeFiles(tmp(), { 'scrobbles.csv': 'Band,LP,Song,05 Jan 2024 18:22\n"Other, The",,Tune,06 Jan 2024 09:00\n' });
    await ingestTwice('lastfm', dir);
    const rows = runTomlQueries('lastfm', sources);
    expectIndexable(rows);
    expect(rows.map((r: any) => r.occurred_at).sort()).toEqual(['2024-01-05T18:22:00Z', '2024-01-06T09:00:00Z']);
  });

  test('linkedin messages.csv', async () => {
    const { sources } = sandbox();
    const dir = writeFiles(tmp(), {
      'messages.csv':
        'CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,DATE,SUBJECT,CONTENT,FOLDER\n' +
        'conv1,,Ada,https://x,Me,2024-01-15 10:30:00 UTC,,"Hello, there",INBOX\n',
    });
    await ingestTwice('linkedin', dir);
    const rows = runTomlQueries('linkedin', sources);
    expectIndexable(rows);
    expect(rows[0]).toMatchObject({ title: 'Ada', content: 'Hello, there', occurred_at: '2024-01-15T10:30:00Z' });
  });

  test('twitter archive adds a per-account source to the local overlay, never the repo toml', async () => {
    const { sources, data, root } = sandbox();
    const dir = writeFiles(tmp(), {
      'data/account.js': 'window.YTD.account.part0 = [{"account":{"username":"Test_User"}}]',
      'data/tweets.js':
        'window.YTD.tweets.part0 = [{"tweet":{"id_str":"1750000000000000000","created_at":"Fri Oct 11 03:24:39 +0000 2024","full_text":"hello world","entities":{"hashtags":[],"urls":[],"user_mentions":[]}}}]',
      'data/like.js': 'window.YTD.like.part0 = [{"like":{"tweetId":"1740000000000000000","fullText":"liked","expandedUrl":"https://x.com/a/status/1"}}]',
    });
    const [result] = await runIngest('twitter', [dir]);
    expect(result.source).toBe('twitter-test_user');
    expect(result.notes.join()).toContain('Added "twitter-test_user"');
    const repoToml = join(data, 'config', 'sources.toml');
    expect(readFileSync(repoToml, 'utf8')).not.toContain('twitter-test_user');
    const toml = join(root, 'config', 'sources.local.toml');
    expect(readFileSync(toml, 'utf8')).toContain('name = "twitter-test_user"');
    // Second run neither duplicates rows nor appends the block again.
    const [again] = await runIngest('twitter', [dir]);
    expect(again.notes.join()).not.toContain('Added');
    expect(readFileSync(toml, 'utf8').match(/name = "twitter-test_user"/g)?.length).toBe(1);
    const rows = runTomlQueries('twitter-test_user', sources, toml);
    expect(rows.length).toBe(2);
  });

  test('google takeout: search, chrome, youtube, calendar in one db', async () => {
    const { sources } = sandbox();
    const dir = writeFiles(tmp(), {
      'Takeout/My Activity/Search/MyActivity.json': JSON.stringify([
        { header: 'Search', title: 'Searched for otso', time: '2024-02-01T10:00:00.123Z' },
        { header: 'Search', title: 'Visited example.com', time: '2024-02-01T10:01:00Z' },
      ]),
      'Takeout/Chrome/History.json': JSON.stringify({
        'Browser History': [{ title: 'Example', url: 'https://example.com', time_usec: 1706781600000000 }],
      }),
      'Takeout/YouTube and YouTube Music/history/watch-history.json': JSON.stringify([
        { header: 'YouTube', title: 'Watched A video', titleUrl: 'https://youtube.com/watch?v=1', subtitles: [{ name: 'Chan' }], time: '2024-02-03T00:00:00Z' },
      ]),
      'Takeout/Calendar/Personal.ics':
        'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:e1\r\nSUMMARY:Dinner\r\nDESCRIPTION:with\\, friends\r\nLOCATION:Home\r\nDTSTART:20240204T190000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n',
    });
    await ingestTwice('google-takeout', dir);
    for (const name of ['google-search', 'chrome', 'youtube', 'gcal']) expectIndexable(runTomlQueries(name, sources));
    expect(runTomlQueries('google-search', sources)).toHaveLength(1);
    expect(runTomlQueries('gcal', sources)[0]).toMatchObject({ title: 'Dinner', occurred_at: '2024-02-04T19:00:00Z' });
    expect(runTomlQueries('youtube', sources)[0].title).toBe('A video');
  });

  test('google takeout with HTML My Activity explains how to re-export', async () => {
    sandbox();
    const dir = writeFiles(tmp(), { 'Takeout/My Activity/Search/MyActivity.html': '<html></html>' });
    await expect(runIngest('google-takeout', [dir])).rejects.toThrow(/JSON/);
  });
});
