import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox } from './helpers.js';
import { archive, archivedSources, isArchived, unarchive } from '../src/core/archived.js';
import { syncCommand } from '../src/commands/cli.js';

describe('archived sources', () => {
  test('a name covers its per-device and per-account variants, not the other way round', () => {
    expect(isArchived('safari', ['safari'])).toBe(true);
    expect(isArchived('safari-old-mac', ['safari'])).toBe(true);
    expect(isArchived('safari-new-mac', ['safari-old-mac'])).toBe(false);
    expect(isArchived('safari', ['safari-old-mac'])).toBe(false);
    expect(isArchived('safaris', ['safari'])).toBe(false);
  });

  test('archive and unarchive write <sources-dir>/archived.json', async () => {
    const { sources } = sandbox();
    expect(archivedSources()).toEqual([]);
    expect(await archive(['foursquare', 'pinboard'])).toEqual(['foursquare', 'pinboard']);
    expect(await archive(['foursquare'])).toEqual([]);
    const file = JSON.parse(readFileSync(join(sources, 'archived.json'), 'utf8'));
    expect(file.archived).toEqual(['foursquare', 'pinboard']);

    expect(await unarchive(['pinboard', 'lastfm'])).toEqual(['pinboard']);
    expect(archivedSources()).toEqual(['foursquare']);
    expect(await unarchive(['foursquare'])).toEqual(['foursquare']);
    expect(archivedSources()).toEqual([]);
  });

  test('sync skips archived sources, even when named', async () => {
    sandbox();
    await archive(['pinboard']);
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void lines.push(a.join(' '));
    try {
      await syncCommand(['pinboard'], {});
    } finally {
      console.log = orig;
    }
    expect(lines.join('\n')).toContain('Skipping archived: pinboard');
    expect(lines.join('\n')).not.toContain('Pinboard\n');
  });
});
