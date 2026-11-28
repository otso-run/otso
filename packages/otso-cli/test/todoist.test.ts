import { afterEach, expect, test } from 'bun:test';
import { authenticate, runSync } from '../src/core/runner.js';
import { mockFetch, runTomlQueries, sandbox } from './helpers.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  content: `Task ${id}`,
  description: '',
  project_id: 'p1',
  labels: ['home'],
  added_at: '2024-01-03T18:40:00Z',
  checked: false,
  completed_at: null,
  is_deleted: false,
  priority: 1,
  ...extra,
});

test('todoist: open tasks via sync, completed tasks by window, recurring completions kept apart', async () => {
  const { sources } = sandbox();
  let syncItems: any[] = [task('1'), task('2', { due: { date: '2024-02-01', is_recurring: true } })];
  const completed = [
    task('3', { checked: true, completed_at: '2024-01-05T00:00:00Z' }),
    task('2', { due: { date: '2024-01-10', is_recurring: true }, completed_at: '2024-01-09T00:00:00Z' }),
  ];
  const calls = mockFetch([
    { match: /\/user$/, respond: () => ({ body: { id: '9', full_name: 'Test User', joined_at: '2023-06-01T00:00:00Z' } }) },
    { match: /\/sync$/, respond: () => ({ body: { sync_token: 'tok2', full_sync: true, projects: [{ id: 'p1', name: 'Chores' }], items: syncItems } }) },
    {
      match: /tasks\/completed\/by_completion_date/,
      respond: (u) => {
        const since = Date.parse(u.searchParams.get('since')!);
        const until = Date.parse(u.searchParams.get('until')!);
        return { body: { items: completed.filter((t) => Date.parse(t.completed_at as string) >= since && Date.parse(t.completed_at as string) < until), next_cursor: null } };
      },
    },
  ]);

  expect(await authenticate('todoist', { accessToken: 'tok' })).toBe('Test User');
  await runSync('todoist');
  const rows = runTomlQueries('todoist', sources);
  expect(rows.map((r: any) => r.title).sort()).toEqual(['Task 1', 'Task 2', 'Task 3', '✓ Task 2', '✓ Task 3']);
  expect(rows.find((r: any) => r.title === 'Task 1')).toMatchObject({ content: 'Chores home', url: 'https://app.todoist.com/app/task/1' });

  // Next sync: incremental token, a deleted task, and only recent completion windows.
  syncItems = [task('1', { is_deleted: true })];
  calls.length = 0;
  await runSync('todoist');
  expect(calls.find((c) => c.endsWith('/sync'))).toBeDefined();
  expect(calls.filter((c) => c.includes('by_completion_date'))).toHaveLength(1);
  expect(runTomlQueries('todoist', sources).map((r: any) => r.title)).not.toContain('Task 1');
});
