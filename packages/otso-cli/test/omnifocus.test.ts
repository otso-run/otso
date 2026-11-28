import { afterAll, beforeAll, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSync } from '../src/core/runner.js';
import { runTomlQueries, sandbox } from './helpers.js';

const realHome = process.env.HOME;
let dir = '';

const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<omnifocus xmlns="http://www.omnigroup.com/namespace/OmniFocus/v2">${body}</omnifocus>`;
function addZip(name: string, xml: string) {
  const tmp = mkdtempSync(join(tmpdir(), 'of-'));
  writeFileSync(join(tmp, 'contents.xml'), xml);
  execFileSync('zip', ['-q', '-j', join(dir, name), join(tmp, 'contents.xml')]);
}

const BASE = doc(`
  <context id="ctx1"><context/><added>2020-01-01T00:00:00.000Z</added><name>Errands</name><note/></context>
  <folder id="fol1"><folder/><added>2020-01-01T00:00:00.000Z</added><name>Home</name></folder>
  <task id="proj1"><project><folder idref="fol1"/><status>active</status></project><inbox>false</inbox><task/>
    <added>2024-01-01T00:00:00.000Z</added><name>Move house</name><note/><completed/></task>
  <task id="t1"><project/><task idref="proj1"/><added>2024-01-03T18:40:00.000Z</added><name>Book movers &amp; van</name>
    <note><text><p><run><lit>Call two companies</lit></run></p></text></note><completed/><flagged>true</flagged></task>
  <task id="t2"><project/><task idref="proj1"/><added>2024-01-04T00:00:00.000Z</added><name>Pack books</name><note/><completed/></task>
  <task-to-tag id="tt1"><task idref="t1"/><context idref="ctx1"/></task-to-tag>
`);

beforeAll(() => {
  process.env.HOME = mkdtempSync(join(tmpdir(), 'otso-home-'));
  dir = join(process.env.HOME, 'Library/Containers/com.omnigroup.OmniFocus4/Data/Library/Application Support/OmniFocus/OmniFocus.ofocus');
  mkdirSync(dir, { recursive: true });
  addZip('00000000000000=aaa+bbb.zip', BASE);
  // A later transaction: t1 completed, t2 deleted.
  addZip('20240105000000=bbb+ccc.zip', doc(`<task id="t1" op="update"><modified>2024-01-05T00:00:00.000Z</modified><completed>2024-01-05T12:00:00.000Z</completed></task><task id="t2" op="delete"/>`));
});

afterAll(() => {
  process.env.HOME = realHome;
});

test('omnifocus: replays the base and every transaction', async () => {
  const { sources } = sandbox();
  expect((await runSync('omnifocus')).stats.events.inserted).toBe(2);
  expect((await runSync('omnifocus')).stats.events.inserted).toBe(0);
  const rows = runTomlQueries('omnifocus', sources);
  expect(rows.map((r: any) => r.title).sort()).toEqual(['Book movers & van', 'Move house', '✓ Book movers & van']);
  expect(rows.find((r: any) => r.title === 'Book movers & van')).toMatchObject({
    content: 'Call two companies Move house Errands',
    occurred_at: '2024-01-03T18:40:00Z',
  });
  expect(rows.find((r: any) => r.title === '✓ Book movers & van').occurred_at).toBe('2024-01-05T12:00:00Z');
  expect(rows.find((r: any) => r.title === 'Move house').content).toBe('Home');
});
