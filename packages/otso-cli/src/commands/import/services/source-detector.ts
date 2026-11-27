import { access, constants, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SourceMeta, LocalPathConfig } from '../../../types/index.js';

export interface DetectionResult {
  found: boolean;
  path?: string;
  size?: number;
  lastModified?: Date;
  error?: string;
}

export interface PermissionResult {
  readable: boolean;
  error?: string;
  requiresFullDiskAccess?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  recordCount?: number;
}

/**
 * Expands path variables like ~ and $HOME
 */
function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  if (path.startsWith('$HOME/')) {
    return join(homedir(), path.slice(6));
  }
  return path;
}

/**
 * Detects if a local source exists on the system.
 * Checks all configured paths for the source's platform.
 */
export async function detectSource(source: SourceMeta): Promise<DetectionResult> {
  if (!source.localPaths || source.localPaths.length === 0) {
    return { found: false, error: 'No local paths configured' };
  }

  const platform = process.platform;
  const applicablePaths = source.localPaths.filter(
    (p) => p.platform === 'all' || p.platform === platform
  );

  if (applicablePaths.length === 0) {
    return { found: false, error: `No paths for platform: ${platform}` };
  }

  for (const pathConfig of applicablePaths) {
    const expandedPath = expandPath(pathConfig.path);

    try {
      const stats = await stat(expandedPath);
      return {
        found: true,
        path: expandedPath,
        size: stats.size,
        lastModified: stats.mtime,
      };
    } catch (err) {
      // Path doesn't exist, try next
      continue;
    }
  }

  return { found: false, error: 'Database not found at expected locations' };
}

/**
 * Checks if we have read permission for a source path.
 * On macOS, some paths require Full Disk Access.
 */
export async function checkPermissions(
  source: SourceMeta,
  path: string
): Promise<PermissionResult> {
  try {
    await access(path, constants.R_OK);
    return { readable: true };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;

    // On macOS, EPERM or EACCES for certain paths means Full Disk Access needed
    if (process.platform === 'darwin') {
      const fullDiskAccessPaths = [
        'Library/Messages',
        'Library/Safari',
        'Library/Mail',
        'Pictures/Photos Library',
      ];

      const needsFullDiskAccess = fullDiskAccessPaths.some((fdaPath) =>
        path.includes(fdaPath)
      );

      if (needsFullDiskAccess && (error.code === 'EPERM' || error.code === 'EACCES')) {
        return {
          readable: false,
          requiresFullDiskAccess: true,
          error: 'Full Disk Access required in System Settings > Privacy & Security',
        };
      }
    }

    return {
      readable: false,
      error: error.message || 'Permission denied',
    };
  }
}

/**
 * Detects all sources and returns their status.
 * Used to show detection status in the source selection screen.
 */
export async function detectAllSources(
  sources: Record<string, SourceMeta>
): Promise<Record<string, DetectionResult & PermissionResult>> {
  const results: Record<string, DetectionResult & PermissionResult> = {};

  for (const [name, source] of Object.entries(sources)) {
    // Only detect automated/local sources
    if (source.extractionType !== 'automated' || !source.localPaths) {
      results[name] = { found: false, readable: false };
      continue;
    }

    const detection = await detectSource(source);

    if (detection.found && detection.path) {
      const permissions = await checkPermissions(source, detection.path);
      results[name] = { ...detection, ...permissions };
    } else {
      results[name] = { ...detection, readable: false };
    }
  }

  return results;
}
