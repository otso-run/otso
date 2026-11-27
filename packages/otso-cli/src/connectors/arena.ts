import type { ChronicleStore, TableDef } from '../core/chronicle.js';
import { getJson } from '../core/http.js';
import type { Connector, RunStats } from './types.js';
import { addStats } from './util.js';

/**
 * Are.na (v3 API): every channel you created, plus every block in them.
 *
 * Incremental, in two passes:
 *  1. A channel's contents are re-fetched only when its updated_at has changed
 *     since the last sync. Connecting or removing a block bumps it, so this
 *     catches new blocks cheaply.
 *  2. Editing a block (title, description, text) does NOT bump its channel's
 *     updated_at, so every sync also lists the blocks you authored
 *     (/users/:id/contents, about ten pages) and stores any whose updated_at
 *     moved. This also picks up your blocks that only live in other people's
 *     channels. Edits by others to their blocks in your channels still need
 *     `--full`.
 * Blocks are keyed on their Are.na id, so a block connected to several
 * channels is stored once.
 */

const API = 'https://api.are.na/v3';

export const ARENA_CHANNELS: TableDef = {
  name: 'channels',
  key: 'id',
  columns: ['id', 'title', 'metadata', 'created_at', 'slug', 'updated_at', 'status', 'length'],
};

export const ARENA_BLOCKS: TableDef = {
  name: 'blocks',
  key: 'id',
  columns: [
    'id',
    'title',
    'content',
    'description',
    'created_at',
    'source_url',
    'class',
    'image_url',
    'channel_slug',
    'connected_at',
    'updated_at',
  ],
};

// Are.na asks API clients to identify themselves.
const auth = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'User-Agent': 'otso-cli/0.1 (+https://github.com/otso-run/otso)',
});

/** v3 lists are { data: [...], meta: { has_more_pages, ... } } with page/per. */
async function* paginate<T>(url: string, token: string): AsyncGenerator<T> {
  for (let page = 1; ; page++) {
    const sep = url.includes('?') ? '&' : '?';
    const res = await getJson<any>(`${url}${sep}page=${page}&per=100`, { headers: auth(token) });
    const items: T[] = res?.data ?? [];
    for (const item of items) yield item;
    if (!items.length || !res?.meta?.has_more_pages) return;
  }
}

const markdown = (v: any): string => (typeof v === 'string' ? v : (v?.markdown ?? v?.plain ?? ''));

export const arena: Connector = {
  id: 'arena',
  displayName: 'Are.na',
  description: 'Channels and blocks',
  kind: 'api',
  dbPath: 'arena/chronicle/chronicle.db',
  tables: [ARENA_CHANNELS, ARENA_BLOCKS],

  auth: {
    setupUrl: 'https://www.are.na/developers/personal-access-tokens',
    instructions: [
      'Create a personal access token (read access is enough; choose',
      'no expiration if you want scheduled syncs to keep working).',
    ],
    fields: [{ name: 'accessToken', label: 'Personal Access Token', secret: true }],
    async verify(creds) {
      const me = await getJson<any>(`${API}/me`, { headers: auth(creds.accessToken) });
      if (!me?.id) throw new Error('Are.na did not return an account for this token');
      creds.userId = String(me.id);
      creds.userSlug = String(me.slug ?? '');
      return me.slug ?? me.name ?? String(me.id);
    },
  },

  async sync({ store, credentials, full, log }) {
    const token = credentials.accessToken;
    if (!credentials.userId) await arena.auth!.verify(credentials);
    const stats: RunStats = {};

    const channels: any[] = [];
    // v3 has no "my channels" list; a user's contents filtered to channels is the equivalent.
    for await (const ch of paginate<any>(`${API}/users/${credentials.userId}/contents?type=Channel`, token)) {
      if (ch.type === 'Channel') channels.push(ch);
    }
    log(`${channels.length} channels`);
    addStats(
      stats,
      'channels',
      store.upsert(
        ARENA_CHANNELS,
        channels.map((ch) => ({
          id: `channel-${ch.id}`,
          title: ch.title,
          metadata: markdown(ch.description),
          created_at: ch.created_at,
          slug: ch.slug,
          updated_at: ch.updated_at,
          status: ch.visibility,
          length: ch.counts?.contents ?? null,
        }))
      )
    );

    const blocks = blockWriter(store);
    let skipped = 0;
    for (const ch of channels) {
      const cursorKey = `channel:${ch.id}:updated_at`;
      if (!full && store.getState(cursorKey) === ch.updated_at) {
        skipped++;
        continue;
      }
      const rows = [];
      for await (const b of paginate<any>(`${API}/channels/${ch.id}/contents`, token)) {
        if (isChannel(b)) continue;
        rows.push(blockRow(b, ch.slug));
      }
      blocks.write(rows);
      store.setState(cursorKey, ch.updated_at ?? '');
      log(`  ${ch.title}: ${rows.length} blocks`);
    }
    if (skipped) log(`${skipped} channels unchanged since last sync`);

    // Pass 2: block edits don't touch the channel, so check your own blocks.
    const own = [];
    for await (const b of paginate<any>(`${API}/users/${credentials.userId}/contents`, token)) {
      if (!isChannel(b)) own.push(blockRow(b, null));
    }
    const edited = blocks.write(own, { onlyChanged: true });
    log(`${own.length} of your blocks checked, ${edited} new or edited`);

    addStats(stats, 'blocks', blocks.stats);
    return stats;
  },
};

const isChannel = (b: any) => b.type === 'Channel' || b.base_type === 'Channel';

function blockRow(b: any, channelSlug: string | null) {
  return {
    id: `block-${b.id}`,
    title: b.title || b.source?.title || b.attachment?.filename || '',
    content: markdown(b.content),
    description: markdown(b.description),
    created_at: b.created_at,
    source_url: b.source?.url ?? b.attachment?.url ?? null,
    class: b.type,
    image_url: b.image?.src ?? null,
    channel_slug: channelSlug,
    connected_at: b.connection?.connected_at ?? null,
    updated_at: b.updated_at ?? null,
  };
}

type BlockRow = ReturnType<typeof blockRow>;

/**
 * Upserts blocks, keeping the channel a block was first seen in when a row
 * comes from a listing that has no channel (the user-contents pass), and
 * optionally writing only rows that are new or whose updated_at moved.
 */
function blockWriter(store: ChronicleStore) {
  store.ensureTable(ARENA_BLOCKS);
  const prev = store.db.prepare(
    'SELECT updated_at, channel_slug, connected_at FROM blocks WHERE id = ?'
  );
  const stats = { inserted: 0, updated: 0 };
  const seen = new Set<string>();
  return {
    stats,
    write(rows: BlockRow[], opts: { onlyChanged?: boolean } = {}): number {
      const out: BlockRow[] = [];
      for (const row of rows) {
        const old = prev.get(row.id) as
          | { updated_at: string | null; channel_slug: string | null; connected_at: string | null }
          | null;
        if (opts.onlyChanged && (seen.has(row.id) || (old && old.updated_at === row.updated_at))) continue;
        if (old && !row.channel_slug) {
          row.channel_slug = old.channel_slug;
          row.connected_at ??= old.connected_at;
        }
        out.push(row);
        seen.add(row.id);
      }
      const s = store.upsert(ARENA_BLOCKS, out);
      stats.inserted += s.inserted;
      stats.updated += s.updated;
      return out.length;
    },
  };
}
