import { EVENTS_TABLE } from '../core/chronicle.js';
import { getJson } from '../core/http.js';
import { iso } from '../core/time.js';
import type { Connector, RunStats } from './types.js';
import { addStats } from './util.js';

/**
 * Todoist tasks through the v1 API with a personal API token.
 *
 * Open tasks and projects come from the Sync endpoint: the first call
 * (sync_token "*") returns everything, later calls only what changed,
 * including deletions. Completed tasks come from the completed-tasks
 * endpoint, which only allows three months per request, so the first sync
 * walks back in three-month windows to when the account was created, and
 * later syncs ask only for the days since the last run.
 *
 * Each completion of a repeating task is its own row; other tasks are one
 * row that turns completed when you check it off.
 */

const API = 'https://api.todoist.com/api/v1';
const WINDOW_DAYS = 90;
/** Todoist launched in 2007; the floor when the account has no join date. */
const EARLIEST = Date.UTC(2007, 0, 1);
const DAY = 86_400_000;

const headers = (token: string) => ({ Authorization: `Bearer ${token}` });

function taskRow(t: any, projects: Record<string, string>, completedAt: string | null) {
  const recurring = !!t.due?.is_recurring;
  const done = completedAt ?? (t.checked ? t.completed_at : null);
  return {
    source_id: recurring && completedAt ? `${t.id}@${completedAt}` : String(t.id),
    type: 'CreateAction',
    source: 'todoist',
    additionalType: 'ToDo',
    name: t.content,
    description: t.description ?? '',
    startTime: iso(t.added_at),
    endTime: iso(done),
    actionStatus: done ? 'completed' : 'open',
    result: { name: projects[t.project_id] ?? null },
    object: {
      url: `https://app.todoist.com/app/task/${t.id}`,
      keywords: t.labels ?? [],
      due: t.due?.date ?? undefined,
      recurring: recurring || undefined,
      priority: t.priority && t.priority > 1 ? t.priority : undefined,
    },
  };
}

export const todoist: Connector = {
  id: 'todoist',
  displayName: 'Todoist',
  description: 'Tasks, open and completed',
  kind: 'api',
  dbPath: 'todoist/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],

  auth: {
    setupUrl: 'https://app.todoist.com/app/settings/integrations/developer',
    instructions: ['Open Todoist Settings > Integrations > Developer and copy your API token.'],
    fields: [{ name: 'accessToken', label: 'API token', secret: true }],
    async verify(creds) {
      const res = await getJson<any>(`${API}/user`, { headers: headers(creds.accessToken) });
      if (!res?.id) throw new Error('Todoist did not accept the token');
      return res.full_name || res.email || 'Todoist';
    },
  },

  async sync({ store, credentials, full, log }) {
    const token = credentials.accessToken;
    const stats: RunStats = {};
    const projects: Record<string, string> = full ? {} : JSON.parse(store.getState('projects') ?? '{}');

    // Open tasks and projects, incrementally.
    const syncToken = (!full && store.getState('sync_token')) || '*';
    const res = await getJson<any>(`${API}/sync`, {
      method: 'POST',
      headers: { ...headers(token), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ sync_token: syncToken, resource_types: JSON.stringify(['items', 'projects']) }).toString(),
    });
    for (const p of res.projects ?? []) projects[p.id] = p.name;
    const items: any[] = res.items ?? [];
    const deleted = items.filter((t) => t.is_deleted).map((t) => String(t.id));
    addStats(stats, 'events', store.upsert(EVENTS_TABLE, items.filter((t) => !t.is_deleted).map((t) => taskRow(t, projects, null))));
    const removed = store.deleteKeys(EVENTS_TABLE, deleted);

    // Completed tasks, three months at a time.
    const last = full ? null : store.getState('completed_until');
    const now = Date.now();
    let completed = 0;
    let until = now;
    let since = last ? Date.parse(last) - DAY : NaN;
    if (!Number.isFinite(since)) {
      const user = await getJson<any>(`${API}/user`, { headers: headers(token) });
      since = Date.parse(user?.joined_at ?? '') || EARLIEST;
    }
    while (until > since) {
      const from = Math.max(since, until - WINDOW_DAYS * DAY);
      let n = 0;
      let cursor: string | null = null;
      do {
        const p = new URLSearchParams({ since: new Date(from).toISOString(), until: new Date(until).toISOString(), limit: '200' });
        if (cursor) p.set('cursor', cursor);
        const page: any = await getJson(`${API}/tasks/completed/by_completion_date?${p}`, { headers: headers(token) });
        const done: any[] = page?.items ?? [];
        addStats(stats, 'events', store.upsert(EVENTS_TABLE, done.map((t) => taskRow(t, projects, t.completed_at))));
        n += done.length;
        cursor = page?.next_cursor ?? null;
      } while (cursor);
      completed += n;
      until = from;
    }

    // Save cursors only after everything is stored.
    if (res.sync_token) store.setState('sync_token', res.sync_token);
    store.setState('projects', JSON.stringify(projects));
    store.setState('completed_until', new Date(now).toISOString());
    log(
      `${items.length.toLocaleString()} open tasks ${syncToken === '*' ? 'read' : 'changed'}, ${completed.toLocaleString()} completed` +
        (removed ? `, ${removed} deleted removed` : '')
    );
    return stats;
  },
};
