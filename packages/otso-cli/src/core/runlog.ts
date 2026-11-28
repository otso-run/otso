import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getConfigDir } from './paths.js';

/**
 * A log of every sync and index run: one JSON object per line in
 * ~/.otso/logs/runs.jsonl, so `otso log` can show how long each source took
 * over time and which ones fail. It holds source names, counts, timings and
 * error messages, never data from the sources.
 */

export interface SourceRun {
  name: string;
  ms: number;
  ok: boolean;
  error?: string;
  /** sync: rows new / already stored. index: events new / skipped. */
  inserted?: number;
  skipped?: number;
  /** index: rows the source's queries returned, and the time spent on each part. */
  rows?: number;
  read_ms?: number;
  write_ms?: number;
  copy_ms?: number;
  /** index: queries slower than SLOW_QUERY_MS. */
  slow_queries?: { entry_type: string; rows: number; ms: number }[];
}

export interface RunEntry {
  kind: 'sync' | 'ingest' | 'index';
  started_at: string;
  duration_ms: number;
  device?: string;
  ok: boolean;
  sources: SourceRun[];
  /** index: the search projection step. */
  projection?: { added: number; ms: number; error?: string };
  error?: string;
}

export const SLOW_QUERY_MS = 1000;

/** ~/.otso/logs, beside the config dir (OTSO_LOG_DIR overrides). */
export function getLogDir(): string {
  return process.env.OTSO_LOG_DIR || join(dirname(getConfigDir()), 'logs');
}

export function getRunLogPath(): string {
  return join(getLogDir(), 'runs.jsonl');
}

export async function appendRun(entry: RunEntry): Promise<void> {
  try {
    const path = getRunLogPath();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await appendFile(path, JSON.stringify(entry) + '\n', { mode: 0o600 });
  } catch {
    // Logging must never fail a sync or an index run.
  }
}

/** Runs from the log, oldest first; unreadable lines are skipped. */
export function readRuns(path = getRunLogPath()): RunEntry[] {
  if (!existsSync(path)) return [];
  const out: RunEntry[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as RunEntry);
    } catch {
      // a partly written line
    }
  }
  return out;
}

/** The shape otso-indexer writes with --report (see packages/otso-indexer/src/report.rs). */
export interface IndexerReport {
  started_at: string;
  duration_ms: number;
  sources: {
    name: string;
    events: number;
    inserted: number;
    skipped: number;
    total_ms: number;
    write_ms: number;
    rows: number;
    missing: boolean;
    copy_ms?: number;
    copy_reused?: boolean;
    read_ms: number;
    queries: { entry_type: string; rows: number; ms: number }[];
    error?: string;
  }[];
  projection?: { added: number; ms: number; error?: string };
}

export function indexRunFromReport(report: IndexerReport, device?: string): RunEntry {
  const sources: SourceRun[] = report.sources
    .filter((s) => !s.missing || s.error)
    .map((s) => {
      const slow = s.queries.filter((q) => q.ms >= SLOW_QUERY_MS);
      return {
        name: s.name,
        ms: s.total_ms,
        ok: !s.error,
        ...(s.error ? { error: s.error } : {}),
        inserted: s.inserted,
        skipped: s.skipped,
        rows: s.rows,
        read_ms: s.read_ms,
        write_ms: s.write_ms,
        ...(s.copy_ms !== undefined ? { copy_ms: s.copy_ms } : {}),
        ...(slow.length ? { slow_queries: slow } : {}),
      };
    });
  return {
    kind: 'index',
    started_at: report.started_at,
    duration_ms: report.duration_ms,
    device,
    ok: sources.every((s) => s.ok) && !report.projection?.error,
    sources,
    projection: report.projection,
  };
}

export const fmtMs = (ms: number) => (ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

/** The few lines printed after a run instead of every slow statement. */
export function summarizeRun(run: RunEntry): string[] {
  const lines: string[] = [];
  const done = run.sources.filter((s) => s.ok);
  const failed = run.sources.filter((s) => !s.ok);
  lines.push(`${run.kind === 'index' ? 'Indexed' : 'Synced'} ${done.length} source${done.length === 1 ? '' : 's'} in ${fmtMs(run.duration_ms)}`);
  const slowest = [...done].sort((a, b) => b.ms - a.ms).slice(0, 3).filter((s) => s.ms >= 1000);
  if (slowest.length) lines.push(`Slowest: ${slowest.map((s) => `${s.name} ${fmtMs(s.ms)}`).join(', ')}`);
  if (run.projection) lines.push(`Search index: ${run.projection.added.toLocaleString()} new entries in ${fmtMs(run.projection.ms)}`);
  const slowQueries = run.sources.reduce((n, s) => n + (s.slow_queries?.length ?? 0), 0);
  if (slowQueries) lines.push(`${slowQueries} slow quer${slowQueries === 1 ? 'y' : 'ies'} (over ${SLOW_QUERY_MS / 1000}s)`);
  for (const s of failed) lines.push(`✗ ${s.name}: ${s.error?.split('\n')[0]}`);
  if (run.projection?.error) lines.push(`✗ search index: ${run.projection.error.split('\n')[0]}`);
  return lines;
}
