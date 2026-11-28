import { execa } from 'execa';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { displayPath, findRepoRoot, homeDir } from '../core/paths.js';

/**
 * `otso schedule`: run `otso sync` on a timer with a launchd agent, so a Mac
 * keeps feeding the shared archive without anyone remembering to.
 *
 *   ~/Library/LaunchAgents/run.otso.sync.plist   the agent
 *   ~/Library/Logs/otso/sync.log                 what each run printed
 */

export const LABEL = 'run.otso.sync';
export const plistPath = () => join(homeDir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
export const logPath = () => join(homeDir(), 'Library', 'Logs', 'otso', 'sync.log');

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface ScheduleOptions {
  /** The bun binary and the otso.ts entry point to run. */
  bun: string;
  entry: string;
  workingDirectory: string;
  sources: string[];
  everyMinutes: number;
  index: boolean;
  env?: Record<string, string>;
}

export function launchdPlist(o: ScheduleOptions): string {
  const args = [o.bun, o.entry, 'sync', ...o.sources, ...(o.index ? ['--index'] : [])];
  const env = {
    HOME: homeDir(),
    PATH: [dirname(o.bun), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    ...o.env,
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(o.workingDirectory)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env)
  .map(([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>`)
  .join('\n')}
  </dict>
  <key>StartInterval</key>
  <integer>${Math.round(o.everyMinutes * 60)}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>LowPriorityIO</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xml(logPath())}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logPath())}</string>
</dict>
</plist>
`;
}

/** Folders macOS keeps launchd agents out of unless they're granted access. */
const PROTECTED = ['Documents', 'Desktop', 'Downloads'];

function launchctl(...args: string[]) {
  return execa('launchctl', args, { reject: false });
}

export async function scheduleCommand(
  action: string | undefined,
  sources: string[],
  opts: { every?: string; index?: boolean; dryRun?: boolean }
) {
  const domain = `gui/${process.getuid?.() ?? 501}`;
  if (action === 'install') {
    const every = Number(opts.every ?? 60);
    if (!Number.isFinite(every) || every < 5) throw new Error('--every is in minutes, at least 5');
    const root = findRepoRoot(resolve(import.meta.dir, '..', '..'));
    if (!root) throw new Error("Can't find the otso checkout this command runs from");
    const entry = join(root, 'packages', 'otso-cli', 'bin', 'otso.ts');
    const bun = process.execPath;
    const env: Record<string, string> = {};
    for (const k of ['OTSO_CONFIG_DIR', 'OTSO_DATA_DIR', 'OTSO_SOURCES_DIR']) if (process.env[k]) env[k] = process.env[k]!;
    const plist = launchdPlist({ bun, entry, workingDirectory: root, sources, everyMinutes: every, index: !!opts.index, env });

    if (opts.dryRun) {
      console.log(plist);
      return;
    }
    mkdirSync(dirname(plistPath()), { recursive: true });
    mkdirSync(dirname(logPath()), { recursive: true });
    writeFileSync(plistPath(), plist);
    await launchctl('bootout', `${domain}/${LABEL}`);
    const r = await launchctl('bootstrap', domain, plistPath());
    if (r.exitCode !== 0) throw new Error(`launchctl bootstrap failed: ${r.stderr || r.stdout}`);

    console.log(`✓ Syncing ${sources.length ? sources.join(', ') : 'every connected source'} every ${every} minutes${opts.index ? ', then indexing' : ''}`);
    console.log(`  Agent: ${displayPath(plistPath())}`);
    console.log(`  Log:   ${displayPath(logPath())}`);
    const home = homeDir();
    const inProtected = PROTECTED.find((d) => root === join(home, d) || root.startsWith(join(home, d) + '/'));
    if (inProtected) {
      console.log(
        `\n⚠ This checkout is in ~/${inProtected}, which launchd agents can't read. Move it (e.g. to ~/GitHub/otso) and install again from there.`
      );
    }
    console.log(
      `\nSafari, Messages, Notes and Photos need Full Disk Access for the scheduled runs:\n` +
        `  System Settings > Privacy & Security > Full Disk Access > + > ${bun}\n` +
        `  (press ⌘⇧G in the file picker to paste the path). Helium, Timing and the API sources don't need it.`
    );
    return;
  }

  if (action === 'uninstall') {
    await launchctl('bootout', `${domain}/${LABEL}`);
    if (existsSync(plistPath())) rmSync(plistPath());
    console.log('✓ Scheduled sync removed');
    return;
  }

  // status
  if (!existsSync(plistPath())) {
    console.log('No scheduled sync. Set one up with: otso schedule install [sources...] --every 60');
    return;
  }
  const plist = readFileSync(plistPath(), 'utf8');
  const array = plist.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ?? '';
  const args = [...array.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
  const interval = plist.match(/<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/)?.[1];
  const loaded = (await launchctl('print', `${domain}/${LABEL}`)).exitCode === 0;
  console.log(`Scheduled sync ${loaded ? 'is loaded' : 'is installed but not loaded (run otso schedule install again)'}`);
  console.log(`  Runs:  otso ${args.slice(2).join(' ')}  (from ${displayPath(args[1] ?? '?')})`);
  if (interval) console.log(`  Every: ${Number(interval) / 60} minutes`);
  console.log(`  Log:   ${displayPath(logPath())}`);
}
