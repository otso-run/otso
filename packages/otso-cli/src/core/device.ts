import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { readSettings, writeSettings } from './paths.js';

/**
 * Which Mac this is, for sources that differ per device (browser history).
 *
 * The name comes from `device` in ~/.otso/config/settings.json, and the first
 * time it's needed it is derived from the Mac's local hostname and saved
 * there, so renaming the Mac later doesn't split its history. It never goes
 * in the repo: it only appears in that settings file and in folder names
 * under sources-dir (e.g. safari-<device>/).
 */

export function slugDevice(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.local$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function localHostName(): string {
  if (process.env.OTSO_DEVICE) return process.env.OTSO_DEVICE;
  if (process.platform === 'darwin') {
    try {
      return execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' }).trim();
    } catch {
      // fall through
    }
  }
  return hostname();
}

export async function getDeviceName(): Promise<string> {
  if (process.env.OTSO_DEVICE) return slugDevice(process.env.OTSO_DEVICE);
  const settings = readSettings();
  if (settings.device) return settings.device;
  const device = slugDevice(localHostName()) || 'mac';
  await writeSettings({ ...settings, device });
  return device;
}

/**
 * A sources-dir under /Volumes/<share> whose share isn't mounted would
 * silently create a local folder with that name. Refuse instead, so a
 * scheduled sync on a laptop away from home just skips.
 */
export function assertSourcesDirMounted(sourcesDir: string): void {
  const m = sourcesDir.match(/^\/Volumes\/([^/]+)/);
  if (!m) return;
  const mount = `/Volumes/${m[1]}`;
  const mounted = existsSync(mount) && statSync(mount).dev !== statSync('/Volumes').dev;
  if (!mounted) throw new ShareNotMountedError(mount);
}

export class ShareNotMountedError extends Error {
  constructor(readonly mount: string) {
    super(`${mount} isn't mounted, so there's nowhere to write. Connect to the share and run sync again.`);
  }
}
