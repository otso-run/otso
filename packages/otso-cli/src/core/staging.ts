import { copyFile, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ChronicleStore } from './chronicle.js';
import { withSourceLock } from './lock.js';
import { isNetworkPath } from './storage.js';

/**
 * SQLite over SMB is latency-bound (every small write is a locked round trip),
 * so when sources-dir is a network share, build each database in a local
 * staging folder and copy the finished file over in one sequential transfer.
 */
export async function withLocalStaging<T>(dest: string, fn: (path: string) => Promise<T>): Promise<T> {
  return withSourceLock(dest, () => (isNetworkPath(dest) ? viaStaging(dest, fn) : fn(dest)));
}

async function viaStaging<T>(dest: string, fn: (path: string) => Promise<T>): Promise<T> {
  const stageDir = await mkdtemp(join(tmpdir(), 'otso-stage-'));
  const staged = join(stageDir, 'chronicle.db');
  try {
    if (existsSync(dest)) {
      // Opening first lets SQLite roll back any interrupted write before we copy.
      ChronicleStore.open(dest).close();
      await copyFile(dest, staged);
    }
    // Build the staged file with a rollback journal, as it will be used on the share.
    const previous = process.env.OTSO_SQLITE_JOURNAL;
    process.env.OTSO_SQLITE_JOURNAL = 'delete';
    let result: T;
    try {
      result = await fn(staged);
    } finally {
      if (previous === undefined) delete process.env.OTSO_SQLITE_JOURNAL;
      else process.env.OTSO_SQLITE_JOURNAL = previous;
    }
    await mkdir(dirname(dest), { recursive: true });
    // A name of our own, so no other writer's copy can land in the same file,
    // and a size check before it replaces the real one.
    const incoming = `${dest}.incoming-${process.pid}-${Date.now()}`;
    try {
      await copyFile(staged, incoming);
      const [want, got] = await Promise.all([stat(staged), stat(incoming)]);
      if (!want.size || got.size !== want.size) {
        throw new Error(`Copy to ${dest} came out ${got.size} bytes instead of ${want.size}; left the existing file alone`);
      }
      await rename(incoming, dest);
    } finally {
      await rm(incoming, { force: true });
    }
    return result;
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
}

