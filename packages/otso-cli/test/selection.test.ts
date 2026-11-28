import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SourceStatus } from '../src/core/runner.js';
import { choicesFor, indexAfterSync, isSelected, saveSelection, selectedSources, setChoices } from '../src/core/selection.js';
import { initialState, lastSyncLabel, panelRows, reduce, willSync } from '../src/commands/sources-panel.js';
import { readSettings } from '../src/core/paths.js';
import { sandbox } from './helpers.js';

const api = (id: string, connected: boolean): SourceStatus => ({ id, displayName: id, kind: 'api', connected, dbExists: connected, rows: 0 });
const local = (id: string, onThisMac: boolean, dbExists: boolean, extra: Partial<SourceStatus> = {}): SourceStatus => ({
  id,
  displayName: id,
  kind: 'local',
  connected: null,
  dbExists,
  rows: 0,
  onThisMac,
  ...extra,
});

// arena connected, readwise not; safari here and synced; things here, never synced; timing not on this Mac.
const statuses: SourceStatus[] = [
  api('arena', true),
  api('readwise', false),
  local('safari', true, true),
  { ...local('safari-other-mac', false, true), parent: 'safari' },
  local('things', true, false),
  local('timing', false, true),
];

describe('choosing what a bare otso sync runs', () => {
  test('without choices it is the automatic rule', () => {
    expect(selectedSources(statuses, {})).toEqual(['arena', 'safari', 'things']); // things: installed, never synced
  });

  test('explicit choices add and remove, but never a source this Mac cannot sync', () => {
    const settings = { sync: { safari: false, things: true, readwise: true, timing: true } };
    expect(selectedSources(statuses, settings)).toEqual(['arena', 'things']);
    expect(isSelected(statuses[1], settings)).toBe(false); // readwise isn't connected
  });

  test('only choices that differ from the automatic rule are stored', () => {
    const checked = new Set(['arena', 'safari']); // things off
    expect(choicesFor(statuses, checked, { timing: false, 'some-other-branch': true })).toEqual({
      things: false,
      timing: false, // kept: this Mac can't sync it, so the panel couldn't change it
      'some-other-branch': true,
    });
    expect(choicesFor(statuses, new Set(['arena', 'safari', 'things']))).toEqual({});
  });

  test('saved per Mac in settings.json; index after sync defaults on', async () => {
    const { root } = sandbox();
    expect(indexAfterSync()).toBe(true);
    await saveSelection({ timing: false }, false);
    expect(JSON.parse(readFileSync(join(root, 'config', 'settings.json'), 'utf8'))).toEqual({ sync: { timing: false }, indexAfterSync: false });
    await setChoices(['timing'], 'auto');
    await setChoices(['things'], 'on');
    await saveSelection(readSettings().sync ?? {}, true);
    expect(readSettings()).toEqual({ sync: { things: true } });
  });
});

describe('otso config sources panel', () => {
  test('lists one row per syncable connector, with other Macs folded in', () => {
    const rows = panelRows(statuses);
    expect(rows.map((r) => r.status.id)).toEqual(['arena', 'readwise', 'safari', 'things', 'timing']);
    expect(rows[2].otherMacs).toEqual(['other-mac']);
  });

  test('keys toggle, reset, archive and flip the index setting', () => {
    let s = initialState(statuses, {});
    expect([...s.checked].sort()).toEqual(['arena', 'safari', 'things']);
    s = reduce(s, 'down'); // readwise: not connected, can't be checked
    s = reduce(s, 'toggle');
    expect(s.checked.has('readwise')).toBe(false);
    s = reduce(reduce(s, 'down'), 'toggle'); // safari off
    expect(s.checked.has('safari')).toBe(false);
    s = reduce(s, 'auto'); // back on
    expect(s.checked.has('safari')).toBe(true);
    s = reduce(s, 'archive');
    expect(willSync(s, 'safari')).toBe(false);
    s = reduce(s, 'toggle'); // archived rows can't be toggled
    expect(s.archived.has('safari')).toBe(true);
    s = reduce(s, 'top');
    s = reduce(s, 'toggle');
    expect(s.index).toBe(false);
    expect(s.dirty).toBe(true);
    s = reduce(s, 'none');
    expect(s.checked.size).toBe(0);
    s = reduce(s, 'all');
    expect([...s.checked].sort()).toEqual(['arena', 'things']); // not safari (archived), not readwise/timing
  });

  test('shows which Mac synced last, and a sync holding the lock', () => {
    const row = panelRows([{ ...statuses[2], lastRun: { kind: 'sync', at: new Date().toISOString(), device: 'mac-mini' } }])[0];
    expect(lastSyncLabel(row, 'macbook')).toBe('just now from mac-mini');
    expect(lastSyncLabel(row, 'mac-mini')).toBe('just now');
    expect(lastSyncLabel({ ...row, busy: { device: 'mac-mini', at: new Date().toISOString() } }, 'macbook')).toContain('syncing now on mac-mini');
  });
});
