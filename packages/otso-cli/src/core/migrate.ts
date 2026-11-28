import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConnector } from '../connectors/index.js';
import { loadCredentials, saveCredentials, type Credentials } from './credentials.js';
import { expandHome } from './paths.js';
import { authenticate } from './runner.js';

/**
 * Import credentials from a chronicle-etl setup (~/.config/chronicle/etl):
 *   secrets/<service>.yml   secrets: { access_token, api_token, ... }
 *   jobs/*.yml              extractor options with inline api_key / username
 * Values are never printed. Each one is verified with the service before it
 * is saved, unless verify is false.
 */

export const DEFAULT_CHRONICLE_DIR = '~/.config/chronicle/etl';

/** Enough YAML for chronicle-etl's flat files: nested "key: value" maps. */
export function parseSimpleYaml(text: string): Record<string, any> {
  const root: Record<string, any> = {};
  const stack: { indent: number; obj: Record<string, any> }[] = [{ indent: -1, obj: root }];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#') || raw.trim() === '---') continue;
    const m = raw.match(/^(\s*)([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    let value = m[3].replace(/\s+#.*$/, '').trim();
    if (value === '') {
      parent[m[2]] = {};
      stack.push({ indent, obj: parent[m[2]] });
    } else {
      if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
      parent[m[2]] = value;
    }
  }
  return root;
}

const usable = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && !v.startsWith('$');

/** Map chronicle-etl names onto otso credential fields, per source. */
export function mapChronicleCredentials(dir: string): Record<string, Credentials> {
  const out: Record<string, Credentials> = {};
  const secret = (name: string) => {
    const p = join(dir, 'secrets', `${name}.yml`);
    return existsSync(p) ? (parseSimpleYaml(readFileSync(p, 'utf8')).secrets ?? {}) : {};
  };
  const jobOptions = (pattern: RegExp) => {
    const jobsDir = join(dir, 'jobs');
    if (!existsSync(jobsDir)) return [];
    return readdirSync(jobsDir)
      .filter((f) => pattern.test(f))
      .map((f) => parseSimpleYaml(readFileSync(join(jobsDir, f), 'utf8')).extractor?.options ?? {});
  };

  const tokenFor = (name: string, jobs: RegExp) => {
    const s = secret(name);
    const fromJob = jobOptions(jobs).find((o) => usable(o.access_token));
    return usable(s.access_token) ? s.access_token : fromJob?.access_token;
  };

  const arena = tokenFor('arena', /^arena-/);
  if (usable(arena)) out.arena = { accessToken: arena };

  const github = tokenFor('github', /^github-/);
  if (usable(github)) out.github = { accessToken: github };

  // Pinboard's API token is "user:HEX"; chronicle kept it as api_token.
  const pin = secret('pinboard');
  const pinToken = [pin.api_token, pin.access_token].find((v) => usable(v) && v.includes(':'));
  if (pinToken) out.pinboard = { accessToken: pinToken };

  const lastfm = jobOptions(/^lastfm-/).find((o) => usable(o.api_key) && usable(o.username));
  const lastfmSecret = secret('lastfm');
  const apiKey = usable(lastfmSecret.api_key) ? lastfmSecret.api_key : lastfm?.api_key;
  const username = usable(lastfmSecret.username) ? lastfmSecret.username : lastfm?.username;
  if (usable(apiKey) && usable(username)) out.lastfm = { apiKey, username };

  const readwise = tokenFor('readwise', /^readwise-/);
  if (usable(readwise)) out.readwise = { accessToken: readwise };

  // Chronicle's Spotify plugin kept its own app's id, secret and refresh token.
  const sp = secret('spotify');
  if (usable(sp.client_id) && usable(sp.client_secret) && usable(sp.refresh_token)) {
    out.spotify = { clientId: sp.client_id, clientSecret: sp.client_secret, refreshToken: sp.refresh_token };
  }

  // Chronicle's Foursquare plugin kept its own app's id and secret with the user token.
  const fsq = secret('foursquare');
  if (usable(fsq.client_id) && usable(fsq.client_secret) && usable(fsq.access_token)) {
    out.foursquare = { clientId: fsq.client_id, clientSecret: fsq.client_secret, accessToken: fsq.access_token };
  }

  return out;
}

/** Services chronicle had credentials for that otso has no API login for. */
export function unsupportedChronicleServices(dir: string): string[] {
  const names = new Set<string>();
  const secrets = join(dir, 'secrets');
  if (existsSync(secrets)) for (const f of readdirSync(secrets)) names.add(f.replace(/\.yml$/, ''));
  const jobs = join(dir, 'jobs');
  if (existsSync(jobs)) {
    for (const f of readdirSync(jobs)) {
      const o = parseSimpleYaml(readFileSync(join(jobs, f), 'utf8')).extractor?.options ?? {};
      if (usable(o.access_token) || usable(o.api_key)) names.add(f.split('-')[0]);
    }
  }
  return [...names].filter((n) => !getConnector(n)?.auth).sort();
}

export interface MigrateResult {
  source: string;
  status: 'saved' | 'kept-existing' | 'failed';
  detail: string;
}

export async function migrateChronicle(
  opts: { dir?: string; verify?: boolean; overwrite?: boolean } = {}
): Promise<{ results: MigrateResult[]; unsupported: string[] }> {
  const dir = expandHome(opts.dir ?? DEFAULT_CHRONICLE_DIR);
  if (!existsSync(dir)) throw new Error(`No chronicle-etl config at ${dir}`);
  const results: MigrateResult[] = [];

  for (const [source, creds] of Object.entries(mapChronicleCredentials(dir))) {
    if (!opts.overwrite && (await loadCredentials(source))) {
      results.push({ source, status: 'kept-existing', detail: 'already connected (use --overwrite to replace)' });
      continue;
    }
    try {
      if (opts.verify === false) {
        await saveCredentials(source, { ...creds, source, migratedFrom: 'chronicle-etl', savedAt: new Date().toISOString() });
        results.push({ source, status: 'saved', detail: 'saved without checking' });
      } else {
        const account = await authenticate(source, { ...creds });
        results.push({ source, status: 'saved', detail: `verified as ${account}` });
      }
    } catch (err) {
      results.push({ source, status: 'failed', detail: err instanceof Error ? err.message : String(err) });
    }
  }
  return { results, unsupported: unsupportedChronicleServices(dir) };
}
