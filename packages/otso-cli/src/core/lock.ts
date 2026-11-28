import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getDeviceName } from './device.js';

/**
 * One writer per source database. Both Macs (and a manual run alongside the
 * scheduled one) build a database in a staging copy and then replace the
 * file on the share, so two writers at once lose one run's rows, and two
 * copies landing together can leave a truncated file. A `<db>.lock` file
 * next to the database, created with O_EXCL (atomic on SMB too), keeps a
 * second writer out; it skips that source and the next run picks it up.
 */

/** A lock older than this is from a run that died without cleaning up. */
export const STALE_LOCK_MS = 6 * 3600 * 1000;

interface LockInfo {
  device: string;
  pid: number;
  at: string;
}

export class SourceBusyError extends Error {
  constructor(readonly holder: LockInfo) {
    const since = new Date(holder.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    super(`${holder.device} has been writing it since ${since}; it will sync next run`);
  }
}

const readLock = (path: string): LockInfo | null => {
  try {
    const info = JSON.parse(readFileSync(path, 'utf8'));
    return typeof info?.device === 'string' && typeof info?.at === 'string' ? info : null;
  } catch {
    return null;
  }
};

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'EPERM';
  }
}

function isStale(info: LockInfo | null, device: string): boolean {
  if (!info) return true; // unreadable or half-written: whoever made it is gone or racing us
  if (Date.now() - Date.parse(info.at) > STALE_LOCK_MS) return true;
  return info.device === device && !alive(info.pid);
}

export async function withSourceLock<T>(dbFile: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${dbFile}.lock`;
  const device = await getDeviceName();
  const mine: LockInfo = { device, pid: process.pid, at: new Date().toISOString() };
  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      writeFileSync(lockPath, JSON.stringify(mine), { flag: 'wx' });
      break;
    } catch (err: any) {
      if (err?.code !== 'EEXIST') throw err;
      const held = readLock(lockPath);
      if (attempt > 0 || !isStale(held, device)) {
        throw new SourceBusyError(held ?? { device: 'another Mac', pid: 0, at: new Date().toISOString() });
      }
      rmSync(lockPath, { force: true });
    }
  }
  try {
    return await fn();
  } finally {
    const held = readLock(lockPath);
    if (held && held.device === mine.device && held.pid === mine.pid && held.at === mine.at) rmSync(lockPath, { force: true });
  }
}
