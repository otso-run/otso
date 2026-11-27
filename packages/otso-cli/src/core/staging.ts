import { copyFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ChronicleStore } from './chronicle.js';
import { isNetworkPath } from './storage.js';

/**
 * SQLite over SMB is latency-bound (every small write is a locked round trip),
 * so when sources-dir is a network share, build each database in a local
 * staging folder and copy the finished file over in one sequential transfer.
 */
export async function withLocalStaging<T>(dest: string, fn: (path: string) => Promise<T>): Promise<T> {
  if (!isNetworkPath(dest)) return fn(dest);
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
    await copyFile(staged, `${dest}.incoming`);
    await rename(`${dest}.incoming`, dest);
    return result;
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
}

