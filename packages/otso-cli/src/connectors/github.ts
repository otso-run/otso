import { EVENTS_TABLE } from '../core/chronicle.js';
import { getJson } from '../core/http.js';
import type { Connector, RunStats } from './types.js';
import { addStats } from './util.js';

/**
 * GitHub: your repositories, your stars (with the date you starred), and your
 * public activity feed. The feed only reaches back 90 days / 300 events, so
 * syncing regularly is what turns it into a lasting archive: each run adds
 * whatever is new and leaves older events in place.
 */

const API = 'https://api.github.com';

function headers(token: string, accept = 'application/vnd.github+json') {
  return { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
}

async function* pages(url: string, token: string, accept?: string, maxPages = 50): AsyncGenerator<any[]> {
  for (let page = 1; page <= maxPages; page++) {
    const sep = url.includes('?') ? '&' : '?';
    const items = await getJson<any[]>(`${url}${sep}per_page=100&page=${page}`, {
      headers: headers(token, accept),
      emptyOk: [422], // events API past its 300-item window
    });
    if (!items || items.length === 0) return;
    yield items;
    if (items.length < 100) return;
  }
}

export function describeEvent(e: any): string {
  const p = e.payload ?? {};
  switch (e.type) {
    case 'PushEvent':
      return (p.commits ?? []).map((c: any) => c.message).join('\n');
    case 'PullRequestEvent':
      return `${p.action} PR #${p.number}: ${p.pull_request?.title ?? ''}`;
    case 'IssuesEvent':
      return `${p.action} issue #${p.issue?.number}: ${p.issue?.title ?? ''}`;
    case 'IssueCommentEvent':
      return `Comment on #${p.issue?.number}: ${p.comment?.body ?? ''}`;
    case 'PullRequestReviewEvent':
      return `Reviewed PR #${p.pull_request?.number}: ${p.review?.body ?? ''}`;
    case 'CreateEvent':
      return `Created ${p.ref_type}${p.ref ? ` ${p.ref}` : ''}`;
    case 'ReleaseEvent':
      return `${p.action} release ${p.release?.tag_name ?? ''}`;
    case 'ForkEvent':
      return `Forked to ${p.forkee?.full_name ?? ''}`;
    default:
      return '';
  }
}

export const github: Connector = {
  id: 'github',
  displayName: 'GitHub',
  description: 'Repositories, stars and activity',
  kind: 'api',
  dbPath: 'github/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],

  auth: {
    setupUrl: 'https://github.com/settings/personal-access-tokens/new',
    instructions: [
      'Create a fine-grained personal access token (read-only is enough;',
      'no repository permissions are needed for public activity and stars).',
    ],
    fields: [{ name: 'accessToken', label: 'Personal access token', secret: true }],
    async verify(creds) {
      const me = await getJson<any>(`${API}/user`, { headers: headers(creds.accessToken) });
      creds.login = me.login;
      return me.login;
    },
  },

  async sync({ store, credentials, log }) {
    const token = credentials.accessToken;
    if (!credentials.login) await github.auth!.verify(credentials);
    const stats: RunStats = {};

    let repos = 0;
    for await (const batch of pages(`${API}/user/repos?affiliation=owner&sort=created`, token)) {
      repos += batch.length;
      addStats(
        stats,
        'events',
        store.upsert(
          EVENTS_TABLE,
          batch.map((r) => ({
            source_id: `repo-${r.id}`,
            type: 'CreateAction',
            source: 'github',
            additionalType: 'Repository',
            object: { name: r.full_name, url: r.html_url },
            description: r.description ?? '',
            startTime: r.created_at,
            endTime: r.pushed_at,
          }))
        )
      );
    }

    let stars = 0;
    for await (const batch of pages(`${API}/user/starred`, token, 'application/vnd.github.star+json')) {
      stars += batch.length;
      addStats(
        stats,
        'events',
        store.upsert(
          EVENTS_TABLE,
          batch.map((s) => ({
            source_id: `star-${s.repo.id}`,
            type: 'LikeAction',
            source: 'github',
            additionalType: 'Star',
            object: { name: s.repo.full_name, url: s.repo.html_url },
            description: s.repo.description ?? '',
            startTime: s.starred_at,
          }))
        )
      );
    }

    let events = 0;
    for await (const batch of pages(`${API}/users/${credentials.login}/events`, token, undefined, 3)) {
      events += batch.length;
      addStats(
        stats,
        'events',
        store.upsert(
          EVENTS_TABLE,
          batch.map((e) => ({
            source_id: `event-${e.id}`,
            type: 'OrganizeAction',
            source: 'github',
            additionalType: e.type,
            object: { name: e.repo?.name, url: `https://github.com/${e.repo?.name}` },
            description: describeEvent(e),
            startTime: e.created_at,
          }))
        )
      );
    }

    log(`${repos} repositories, ${stars} stars, ${events} recent events`);
    return stats;
  },
};
