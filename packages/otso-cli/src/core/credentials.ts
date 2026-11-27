import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { displayPath, getConfigDir } from './paths.js';

/**
 * Credentials live in ~/.otso/config (never the working tree), readable only
 * by the owner. One JSON file per source: <source>-credentials.json.
 */

export type Credentials = Record<string, string>;

export function credentialsFile(sourceId: string): string {
  return join(getConfigDir(), `${sourceId}-credentials.json`);
}

export function displayCredentialsPath(fileName: string): string {
  return displayPath(join(getConfigDir(), fileName));
}

export async function saveCredentials(
  fileNameOrSource: string,
  data: Record<string, unknown>
): Promise<string> {
  const dir = getConfigDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);

  const path = fileNameOrSource.endsWith('.json')
    ? join(dir, fileNameOrSource)
    : credentialsFile(fileNameOrSource);
  await writeFile(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  // writeFile's mode only applies when creating; tighten an existing file too.
  await chmod(path, 0o600);
  return path;
}

export async function loadCredentials(sourceId: string): Promise<Credentials | null> {
  const path = credentialsFile(sourceId);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  const out: Credentials = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') out[k] = v;
  // Files written by the first TUI stored a single "token" field.
  if (out.token && !out.accessToken) out.accessToken = out.token;
  return out;
}

export async function deleteCredentials(sourceId: string): Promise<boolean> {
  const path = credentialsFile(sourceId);
  if (!existsSync(path)) return false;
  await rm(path);
  return true;
}
