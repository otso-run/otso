import { getConnector } from '../../../connectors/index.js';
import { runIndexer } from '../../../core/indexer.js';
import { displayPath, getSourcesDir } from '../../../core/paths.js';
import { authenticate, formatStats, runIngest, runSync } from '../../../core/runner.js';

/**
 * The TUI's bridge to the connector engine. Each call returns a one-line
 * summary for the "done" screen, or throws with a message to show.
 * Sources without a connector yet (e.g. Notion) return null so the flow can
 * fall back to just copying the file.
 */

export function hasConnector(sourceId: string): boolean {
  return !!getConnector(sourceId);
}

export async function connectAndSync(sourceId: string, input: Record<string, string>): Promise<string | null> {
  const connector = getConnector(sourceId);
  if (!connector?.auth) return null;
  const account = await authenticate(sourceId, { ...input });
  const result = await runSync(sourceId);
  return `Connected as ${account}. ${formatStats(result.stats)}`;
}

export async function syncLocal(sourceId: string): Promise<string | null> {
  const connector = getConnector(sourceId);
  if (!connector?.sync || connector.kind !== 'local') return null;
  const result = await runSync(sourceId);
  return `${formatStats(result.stats)} → ${displayPath(getSourcesDir())}/${result.dbPath}`;
}

export async function ingestFile(sourceId: string, path: string): Promise<string | null> {
  const connector = getConnector(sourceId);
  if (!connector?.ingest) return null;
  const [result] = await runIngest(sourceId, [path]);
  return `${formatStats(result.stats)} → ${displayPath(getSourcesDir())}/${result.dbPath}`;
}

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

export async function buildIndex(): Promise<string> {
  const build = await runIndexer(['build'], { stdio: 'pipe' });
  if (build.exitCode !== 0) throw new Error(plain(build.output).split('\n').filter(Boolean).slice(-3).join('\n'));
  const rebuild = await runIndexer(['rebuild', '--fts5-only'], { stdio: 'pipe' });
  if (rebuild.exitCode !== 0) throw new Error(plain(rebuild.output).split('\n').filter(Boolean).slice(-3).join('\n'));
  const line = plain(rebuild.output).split('\n').find((l) => l.includes('FTS5:')) ?? '';
  return line.replace(/^.*FTS5:/, 'Search index rebuilt:').trim() || 'Search index rebuilt';
}
