import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseNote } from '../src/connectors/markdown.js';
import { runSync } from '../src/core/runner.js';
import { runTomlQueries, sandbox, writeFiles } from './helpers.js';

const realHome = process.env.HOME;
let vault = '';

beforeAll(() => {
  process.env.HOME = mkdtempSync(join(tmpdir(), 'otso-home-'));
  vault = join(process.env.HOME, 'Notes/My Vault');
  writeFiles(vault, {
    'Daily/2024-01-03.md': '---\ntitle: Wednesday\ncreated: 2024-01-03T18:40:00Z\ntags: [journal, work]\n---\nWrote some #ideas down.',
    'Plain.md': 'Just text',
    '.obsidian/workspace.json': '{}',
    '.trash/Old.md': 'deleted',
    'image.png': 'x',
  });
  writeFiles(join(process.env.HOME, 'Library/Application Support/obsidian'), {
    'obsidian.json': JSON.stringify({ vaults: { a: { path: vault, open: true }, b: { path: join(process.env.HOME, 'Other') } } }),
  });
});

afterAll(() => {
  process.env.HOME = realHome;
});

describe('markdown folders', () => {
  test('front matter', () => {
    expect(parseNote('---\ntags:\n  - a\n  - b\n---\nbody #c')).toEqual({ body: 'body #c', title: undefined, created: undefined, tags: ['a', 'b', 'c'] });
    expect(parseNote('no front matter, issue #42 and #tag').tags).toEqual(['tag']);
  });

  test('obsidian: open vault only, unchanged files skipped, deleted files removed', async () => {
    const { sources } = sandbox();
    expect((await runSync('obsidian')).stats.events.inserted).toBe(2);
    const second = await runSync('obsidian');
    expect(second.stats.events ?? { inserted: 0, updated: 0 }).toEqual({ inserted: 0, updated: 0 });

    const rows = runTomlQueries('obsidian', sources);
    expect(rows.find((r: any) => r.title === 'Wednesday')).toMatchObject({
      content: 'Wrote some #ideas down. journal work ideas',
      occurred_at: '2024-01-03T18:40:00Z',
    });

    writeFileSync(join(vault, 'Plain.md'), 'Edited text');
    utimesSync(join(vault, 'Plain.md'), new Date(), new Date(Date.now() + 5000));
    rmSync(join(vault, 'Daily/2024-01-03.md'));
    const third = await runSync('obsidian');
    expect(third.stats.events).toEqual({ inserted: 0, updated: 1 });
    expect(runTomlQueries('obsidian', sources).map((r: any) => [r.title, r.content])).toEqual([['Plain', 'Edited text']]);
  });
});
