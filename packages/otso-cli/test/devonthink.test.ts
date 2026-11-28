import { afterEach, expect, test } from 'bun:test';
import { devonthinkRunner, type DtRecord } from '../src/connectors/devonthink.js';
import { runSync } from '../src/core/runner.js';
import { runTomlQueries, sandbox } from './helpers.js';

const real = { ...devonthinkRunner };
afterEach(() => Object.assign(devonthinkRunner, real));

const rec = (uuid: string, extra: Partial<DtRecord> = {}): DtRecord => ({
  uuid,
  name: `Doc ${uuid}`,
  kind: 'markdown',
  created: '2024-01-03T18:40:00.000Z',
  modified: '2024-01-04T00:00:00.000Z',
  tags: ['research'],
  comment: 'a comment',
  url: '',
  location: '/Inbox/',
  text: 'body text',
  ...extra,
});

test('devonthink: records from open databases; groups skipped; removed records dropped', async () => {
  const { sources } = sandbox();
  let records = [rec('A'), rec('B', { kind: 'bookmark', url: 'https://example.com', text: '' }), rec('G', { kind: 'group' })];
  devonthinkRunner.appName = () => 'DEVONthink 3';
  devonthinkRunner.run = async () => ({ databases: [{ name: 'Research', uuid: 'db1', records }] });

  expect((await runSync('devonthink')).stats.events.inserted).toBe(2);
  expect((await runSync('devonthink')).stats.events.inserted).toBe(0);
  const rows = runTomlQueries('devonthink', sources);
  expect(rows.find((r: any) => r.external_id === 'A')).toEqual({
    external_id: 'A',
    title: 'Doc A',
    content: 'a comment\nbody text\nresearch /Inbox/',
    occurred_at: '2024-01-03T18:40:00Z',
    url: 'x-devonthink-item://A',
  });
  expect(rows.find((r: any) => r.external_id === 'B').url).toBe('https://example.com');

  records = [rec('A')];
  await runSync('devonthink');
  expect(runTomlQueries('devonthink', sources).map((r: any) => r.external_id)).toEqual(['A']);
});

test('devonthink: a database that is not open now is left alone', async () => {
  const { sources } = sandbox();
  devonthinkRunner.appName = () => 'DEVONthink 3';
  devonthinkRunner.run = async () => ({ databases: [{ name: 'Research', uuid: 'db1', records: [rec('A')] }] });
  await runSync('devonthink');
  devonthinkRunner.run = async () => ({ databases: [] });
  await runSync('devonthink');
  expect(runTomlQueries('devonthink', sources)).toHaveLength(1);
});
