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
    expect(rows[0]).toMatchObject({ title: 'Planning', content: 'Help me plan a trip' });
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
