import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse } from 'smol-toml';

export const REPO_TOML = join(import.meta.dir, '..', '..', '..', 'data', 'config', 'sources.toml');

/** A throwaway data root + config dir, wired up through the env vars. */
export function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'otso-test-'));
  const data = join(root, 'data');
  mkdirSync(join(data, 'config'), { recursive: true });
  writeFileSync(join(data, 'config', 'sources.toml'), readFileSync(REPO_TOML, 'utf8'));
  process.env.OTSO_DATA_DIR = data;
  process.env.OTSO_CONFIG_DIR = join(root, 'config');
  // Never let a test append to the repo's tracked sources.toml.
  process.env.OTSO_SOURCES_TOML = join(data, 'config', 'sources.toml');
  // Per-device sources are named after this; never the real hostname in tests.
  process.env.OTSO_DEVICE = 'test-mac';
  return { root, data, sources: join(data, 'sources') };
}

export function writeFiles(dir: string, files: Record<string, string | Uint8Array>) {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

/**
 * Run the sources.toml queries for `sourceName` against the db the CLI wrote,
 * exactly as otso-indexer would, and return the rows.
 */
export function runTomlQueries(sourceName: string, sourcesDir: string, tomlPath = REPO_TOML, dbPath?: string) {
  const cfg = parse(readFileSync(tomlPath, 'utf8')) as any;
  const src = cfg.sources.find((s: any) => s.name === sourceName);
  if (!src) throw new Error(`no ${sourceName} in sources.toml`);
  const db = new Database(join(sourcesDir, dbPath ?? src.db_path), { readonly: true });
  try {
    return src.queries.flatMap((q: any) => db.query(q.sql).all() as any[]);
  } finally {
    db.close();
  }
}

export interface MockRoute {
  match: RegExp;
  respond: (url: URL) => { status?: number; body?: unknown };
}

/** Replace global fetch with a router; returns the list of requested URLs. */
export function mockFetch(routes: MockRoute[]) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    calls.push(url.toString());
    const route = routes.find((r) => r.match.test(url.toString()));
    if (!route) return new Response('not mocked', { status: 404 });
    const { status = 200, body } = route.respond(url);
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}
