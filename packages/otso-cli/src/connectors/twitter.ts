import type { TableDef } from '../core/chronicle.js';
import { parseYtdJs } from '../core/archive.js';
import type { Archive } from '../core/archive.js';
import type { Connector, RunStats } from './types.js';
import { addStats } from './util.js';

/**
 * Twitter/X archive. Each account gets its own source, twitter-<username>,
 * matching the existing sources.toml layout; ingesting an archive for a new
 * account adds that source's block to sources.toml.
 */

export const TWEETS: TableDef = {
  name: 'tweets',
  key: 'id',
  columns: [
    'id',
    'created_at',
    'full_text',
    'in_reply_to_status_id',
    'in_reply_to_user_id',
    'in_reply_to_screen_name',
    'retweet_count',
    'favorite_count',
    'lang',
    'source',
    'urls',
    'media',
    'hashtags',
    'user_mentions',
  ],
};

export const LIKES: TableDef = {
  name: 'likes',
  key: 'tweet_id',
  columns: ['tweet_id', 'full_text', 'expanded_url'],
};

async function readPart(archive: Archive, pattern: RegExp): Promise<any[]> {
  const out: any[] = [];
  for (const file of archive.find(pattern)) out.push(...parseYtdJs<any[]>(await archive.readText(file)));
  return out;
}

async function username(archive: Archive): Promise<string> {
  const [acct] = await readPart(archive, /(^|\/)data\/account\.js$/);
  const name = acct?.account?.username;
  if (!name) throw new Error('data/account.js not found; is this a Twitter/X archive?');
  // The username becomes a folder name and is written into sources.toml and
  // SQL, so accept only what X allows in a handle.
  if (!/^[A-Za-z0-9_]{1,15}$/.test(String(name))) throw new Error('Invalid username in data/account.js');
  return String(name).toLowerCase();
}

export function tomlBlock(user: string): string {
  const name = `twitter-${user}`;
  return `
[[sources]]
name = "${name}"
enabled = true
db_path = "${name}/chronicle/chronicle.db"
category = "social"

[[sources.queries]]
table = "tweets"
entry_type = "tweet"
action_type = "CreateAction"
object_type = "SocialMediaPosting"
sql = """
SELECT
    id as external_id,
    substr(full_text, 1, 100) as title,
    full_text as content,
    created_at as occurred_at,
    'https://twitter.com/${user}/status/' || id as url
FROM tweets
"""

[[sources.queries]]
table = "likes"
entry_type = "like"
action_type = "LikeAction"
object_type = "SocialMediaPosting"
sql = """
SELECT
    tweet_id as external_id,
    substr(full_text, 1, 100) as title,
    full_text as content,
    CAST(((CAST(tweet_id AS INTEGER) >> 22) + 1288834974657) / 1000 AS TEXT) as occurred_at,
    expanded_url as url
FROM likes
"""
`;
}

export const twitter: Connector = {
  id: 'twitter',
  displayName: 'Twitter/X',
  description: 'Tweets and likes',
  kind: 'export',
  dbPath: 'twitter/chronicle/chronicle.db',
  tables: [TWEETS, LIKES],

  exportGuide: {
    url: 'https://x.com/settings/download_your_data',
    steps: [
      'Open Settings > Your account > Download an archive of your data',
      'Verify with your password and the code X sends',
      'Click "Request archive", then download it when the notification arrives',
    ],
    filePatterns: ['twitter-*.zip', 'twitter-archive*.zip'],
    wait: '24 hours or more',
  },

  async resolveTarget(archive) {
    const user = await username(archive);
    return { dbPath: `twitter-${user}/chronicle/chronicle.db`, sourceName: `twitter-${user}`, tomlBlock: tomlBlock(user) };
  },

  async ingest({ store, log }, archive) {
    const stats: RunStats = {};
    const tweets = await readPart(archive, /(^|\/)data\/(tweets|tweet)(-part\d+)?\.js$/);
    const rows = tweets.map(({ tweet: t }) => ({
      id: t.id_str ?? t.id,
      created_at: t.created_at,
      full_text: t.full_text ?? t.text,
      in_reply_to_status_id: t.in_reply_to_status_id_str ?? null,
      in_reply_to_user_id: t.in_reply_to_user_id_str ?? null,
      in_reply_to_screen_name: t.in_reply_to_screen_name ?? null,
      retweet_count: t.retweet_count,
      favorite_count: t.favorite_count,
      lang: t.lang,
      source: t.source,
      urls: (t.entities?.urls ?? []).map((u: any) => u.expanded_url),
      media: (t.extended_entities?.media ?? t.entities?.media ?? []).map((m: any) => m.media_url_https),
      hashtags: (t.entities?.hashtags ?? []).map((h: any) => h.text),
      user_mentions: (t.entities?.user_mentions ?? []).map((m: any) => m.screen_name),
    }));
    addStats(stats, 'tweets', store.upsert(TWEETS, rows));

    const likes = (await readPart(archive, /(^|\/)data\/like(-part\d+)?\.js$/)).map(({ like: l }) => ({
      tweet_id: l.tweetId,
      full_text: l.fullText ?? '',
      expanded_url: l.expandedUrl ?? null,
    }));
    addStats(stats, 'likes', store.upsert(LIKES, likes));
    log(`${rows.length} tweets, ${likes.length} likes`);
    return stats;
  },
};
