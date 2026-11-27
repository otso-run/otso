import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Credentials live in the user's home directory (never the working tree),
 * readable only by the owner. Override with OTSO_CONFIG_DIR.
 */
export function getCredentialsDir(): string {
  return process.env.OTSO_CONFIG_DIR || join(homedir(), '.otso', 'config');
}

export function displayCredentialsPath(fileName: string): string {
  return join(getCredentialsDir(), fileName).replace(homedir(), '~');
}

export async function saveCredentials(
  fileName: string,
  data: Record<string, unknown>
): Promise<string> {
  const dir = getCredentialsDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);

  const path = join(dir, fileName);
  await writeFile(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  // writeFile's mode only applies when creating; tighten an existing file too.
  await chmod(path, 0o600);
  return path;
}
