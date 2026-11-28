import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LABEL, launchdPlist } from '../src/commands/schedule.js';

describe('otso schedule', () => {
  test('writes a valid launchd plist that runs otso sync on an interval', () => {
    const plist = launchdPlist({
      bun: '/Users/me/.bun/bin/bun',
      entry: '/Users/me/GitHub/otso/packages/otso-cli/bin/otso.ts',
      workingDirectory: '/Users/me/GitHub/otso',
      sources: ['safari', 'helium'],
      everyMinutes: 30,
      index: false,
      env: { OTSO_CONFIG_DIR: '/tmp/a&b' },
    });
    expect(plist).toContain(`<string>${LABEL}</string>`);
    expect(plist).toContain('<integer>1800</integer>');
    expect(plist).toContain('<string>sync</string>\n    <string>safari</string>\n    <string>helium</string>');
    expect(plist).toContain('<string>/tmp/a&amp;b</string>');
    expect(plist).not.toContain('--index');
    // undefined follows index-after-sync at run time; true/false pin it.
    expect(launchdPlist({ bun: 'b', entry: 'e', workingDirectory: 'w', sources: [], everyMinutes: 60 })).not.toContain('index');
    expect(launchdPlist({ bun: 'b', entry: 'e', workingDirectory: 'w', sources: [], everyMinutes: 60, index: false })).toContain('<string>--no-index</string>');
    expect(launchdPlist({ bun: 'b', entry: 'e', workingDirectory: 'w', sources: [], everyMinutes: 60, index: true })).toContain('<string>--index</string>');
    if (process.platform === 'darwin') {
      const f = join(mkdtempSync(join(tmpdir(), 'otso-plist-')), 'p.plist');
      writeFileSync(f, plist);
      expect(execFileSync('plutil', ['-lint', f], { encoding: 'utf8' })).toContain('OK');
    }
  });
});
