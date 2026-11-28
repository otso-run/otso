import { EVENTS_TABLE } from '../core/chronicle.js';
import { HttpError, request } from '../core/http.js';
import { iso } from '../core/time.js';
import type { Connector, RunStats } from './types.js';
import { addStats, htmlToText } from './util.js';

/**
 * Mastodon (any instance) with a personal access token: your own posts and
 * boosts, plus the posts you favourited and bookmarked.
 *
 * The first sync pages back through everything the API will give. Later
 * syncs read newest first and stop at the first page with nothing new, so a
 * normal run is a few requests per list.
 */

const PAGE = 40;

type Kind = 'post' | 'favourite' | 'bookmark';

export function statusRow(s: any, kind: Kind, me: string) {
  const original = s.reblog ?? s;
  const text = htmlToText(original.content ?? '');
  const cw = original.spoiler_text ? `${original.spoiler_text}\n` : '';
  const boost = kind === 'post' && !!s.reblog;
  return {
    source_id: `${kind}-${s.id}`,
    type: kind === 'favourite' ? 'LikeAction' : kind === 'bookmark' ? 'BookmarkAction' : boost ? 'ShareAction' : 'CreateAction',
    source: 'mastodon',
    agent: { name: kind === 'post' && !boost ? me : original.account?.acct },
    object: {
      name: (cw + text).slice(0, 120) || original.url,
      text: cw + text,
      url: original.url ?? original.uri,
      author: original.account?.acct,
      media: (original.media_attachments ?? []).map((m: any) => m.description).filter(Boolean),
      tags: (original.tags ?? []).map((t: any) => t.name),
      inReplyTo: original.in_reply_to_id ? true : undefined,
    },
    end_time: iso(s.created_at),
  };
}

/** The Link header's next page, only if it stays on the instance (the token goes with it). */
export function nextLink(link: string | null, root: string): string | null {
  const raw = link?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
  if (!raw) return null;
  try {
    const next = new URL(raw, root);
    return next.protocol === 'https:' && next.origin === new URL(root).origin ? next.toString() : null;
  } catch {
    return null;
  }
}

async function getPage(url: string, token: string, root: string): Promise<{ items: any[]; next: string | null }> {
  const res = await request(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ''));
  return { items: (await res.json()) as any[], next: nextLink(res.headers.get('link'), root) };
}

const base = (instance: string) => `https://${instance.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;

export const mastodon: Connector = {
  id: 'mastodon',
  displayName: 'Mastodon',
  description: 'Your posts, favourites and bookmarks',
  kind: 'api',
  dbPath: 'mastodon/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],

  auth: {
    setupUrl: 'https://joinmastodon.org/',
    instructions: [
      'On your instance, open Preferences > Development > New application.',
      'Give it the "read" scope, save, and copy "Your access token".',
    ],
    fields: [
      { name: 'instance', label: 'Instance', placeholder: 'mastodon.social' },
      { name: 'accessToken', label: 'Access token', secret: true },
    ],
    async verify(creds) {
      const res = await request(`${base(creds.instance)}/api/v1/accounts/verify_credentials`, {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
      });
      if (!res.ok) throw new Error(`${creds.instance} did not accept the token (HTTP ${res.status})`);
      const me = (await res.json()) as any;
      creds.accountId = String(me.id);
      return `@${me.acct}@${base(creds.instance).slice(8)}`;
    },
  },

  async sync({ store, credentials, full, log }) {
    const root = base(credentials.instance);
    const token = credentials.accessToken;
    const me = credentials.account ?? 'me';
    let accountId = credentials.accountId;
    if (!accountId) {
      const res = await request(`${root}/api/v1/accounts/verify_credentials`, { headers: { Authorization: `Bearer ${token}` } });
      accountId = String(((await res.json()) as any).id);
    }
    const known = store.db.prepare('SELECT 1 FROM events WHERE source_id = ?');
    const stats: RunStats = {};
    const counts: Record<Kind, number> = { post: 0, favourite: 0, bookmark: 0 };

    const lists: [Kind, string][] = [
      ['post', `${root}/api/v1/accounts/${accountId}/statuses?limit=${PAGE}`],
      ['favourite', `${root}/api/v1/favourites?limit=${PAGE}`],
      ['bookmark', `${root}/api/v1/bookmarks?limit=${PAGE}`],
    ];
    for (const [kind, first] of lists) {
      let url: string | null = first;
      while (url) {
        const { items, next } = await getPage(url, token, root);
        const rows = items.map((s) => statusRow(s, kind, me));
        const fresh = rows.filter((r) => !known.get(r.source_id)).length;
        addStats(stats, 'events', store.upsert(EVENTS_TABLE, rows));
        counts[kind] += fresh;
        // Newest first: a page with nothing new means the rest is already stored.
        if (!full && rows.length && fresh === 0) break;
        url = items.length ? next : null;
      }
    }
    log(`${counts.post} posts, ${counts.favourite} favourites and ${counts.bookmark} bookmarks new`);
    return stats;
  },
};
