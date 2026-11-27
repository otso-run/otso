import { watch, type FSWatcher } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

export interface WatchedFile {
  path: string;
  name: string;
  size: number;
  createdAt: Date;
}

export interface WatchHandle {
  stop: () => void;
}

/**
 * Matches a filename against glob-like patterns.
 * Supports * wildcard only (not full glob).
 */
function matchesPattern(filename: string, pattern: string): boolean {
  // Convert pattern to regex
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except *
    .replace(/\*/g, '.*'); // Convert * to .*

  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(filename);
}

/**
 * Watches a directory for files matching specified patterns.
 * Commonly used to watch ~/Downloads for export files.
 */
export function watchForFiles(
  directory: string,
  patterns: string[],
  callback: (file: WatchedFile) => void
): WatchHandle {
  const expandedDir = directory.startsWith('~/')
    ? join(homedir(), directory.slice(2))
    : directory;

  let watcher: FSWatcher | null = null;

  try {
    watcher = watch(expandedDir, async (eventType, filename) => {
      if (!filename || eventType !== 'rename') return;

      // Check if filename matches any pattern
      const matches = patterns.some((pattern) => matchesPattern(filename, pattern));
      if (!matches) return;

      const filePath = join(expandedDir, filename);

      try {
        const stats = await stat(filePath);
        if (stats.isFile()) {
          callback({
            path: filePath,
            name: filename,
            size: stats.size,
            createdAt: stats.birthtime,
          });
        }
      } catch {
        // File might have been deleted or moved
      }
    });
  } catch (err) {
    console.error(`Failed to watch directory: ${expandedDir}`, err);
  }

  return {
    stop: () => {
      if (watcher) {
        watcher.close();
        watcher = null;
      }
    },
  };
}

/**
 * Scans a directory for existing files matching patterns.
 * Used to check if expected export files already exist.
 */
export async function findExistingFiles(
  directory: string,
  patterns: string[]
): Promise<WatchedFile[]> {
  const expandedDir = directory.startsWith('~/')
    ? join(homedir(), directory.slice(2))
    : directory;

  const files: WatchedFile[] = [];

  try {
    const entries = await readdir(expandedDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const matches = patterns.some((pattern) =>
        matchesPattern(entry.name, pattern)
      );
      if (!matches) continue;

      const filePath = join(expandedDir, entry.name);
      const stats = await stat(filePath);

      files.push({
        path: filePath,
        name: entry.name,
        size: stats.size,
        createdAt: stats.birthtime,
      });
    }
  } catch {
    // Directory might not exist
  }

  return files;
}

/**
 * Gets the default Downloads directory for the current platform.
 */
export function getDownloadsDir(): string {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    return join(homedir(), 'Downloads');
  }
  // Windows
  return join(homedir(), 'Downloads');
}
