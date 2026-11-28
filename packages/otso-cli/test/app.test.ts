import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homeSummary, MENU } from '../src/commands/app.js';

describe('otso app', () => {
  test('home menu has a key per section', () => {
    expect(MENU.map((m) => m.key)).toEqual(['1', '2', '3', '4', '5', 'q']);
    expect(MENU.map((m) => m.id)).toContain('sources');
  });

  test('home line summarises the selection', () => {
    const d = { statuses: [], settings: { indexAfterSync: false }, device: 'm', archived: new Set(['x', 'y']), busy: {} };
    expect(homeSummary(d, 1)).toBe('1 source sync on this Mac · 2 archived · index after sync off');
  });

  test('a bare otso without a terminal prints the command list instead of opening the app', () => {
    let out = '';
    try {
      out = execFileSync('bun', [join(import.meta.dir, '..', 'bin', 'otso.ts')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err: any) {
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    expect(out).toContain('Usage: otso');
    expect(out).toContain('config');
  });
});
