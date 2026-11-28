import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox } from './helpers.js';
import { appendRun, getRunLogPath, indexRunFromReport, readRuns, summarizeRun, type IndexerReport } from '../src/core/runlog.js';
import { indexerArgs } from '../src/core/indexer.js';

const report: IndexerReport = {
  started_at: '2026-11-27T12:00:00Z',
  duration_ms: 16_000,
  sources: [
    { name: 'lastfm', events: 10, inserted: 2, skipped: 8, total_ms: 11_700, write_ms: 3_500, rows: 10, missing: false, copy_ms: 6_600, read_ms: 1_600, queries: [{ entry_type: 'listen', rows: 10, ms: 1_600 }] },
    { name: 'notion', events: 1, inserted: 0, skipped: 1, total_ms: 40, write_ms: 4, rows: 1, missing: false, copy_reused: true, read_ms: 5, queries: [{ entry_type: 'page', rows: 1, ms: 5 }] },
    { name: 'not-imported', events: 0, inserted: 0, skipped: 0, total_ms: 0, write_ms: 0, rows: 0, missing: true, read_ms: 0, queries: [] },
    { name: 'broken', events: 0, inserted: 0, skipped: 0, total_ms: 10, write_ms: 0, rows: 0, missing: false, read_ms: 0, queries: [], error: 'no such table: x\nmore' },
  ],
  projection: { added: 2, ms: 2_500 },
};

describe('run log', () => {
  test('an indexer report becomes a log entry: missing sources dropped, slow queries kept', () => {
    const run = indexRunFromReport(report, 'test-mac');
    expect(run.sources.map((s) => s.name)).toEqual(['lastfm', 'notion', 'broken']);
    expect(run.ok).toBe(false);
    expect(run.sources[0].slow_queries).toEqual([{ entry_type: 'listen', rows: 10, ms: 1_600 }]);
    expect(run.sources[1].slow_queries).toBeUndefined();
  });

  test('the terminal summary is a few lines, not one per statement', () => {
    expect(summarizeRun(indexRunFromReport(report))).toEqual([
      'Indexed 2 sources in 16.0s',
      'Slowest: lastfm 11.7s',
      'Search index: 2 new entries in 2.5s',
      '1 slow query (over 1s)',
      '✗ broken: no such table: x',
    ]);
  });

  test('runs are appended to <config>/../logs/runs.jsonl and read back', async () => {
    const { root } = sandbox();
    delete process.env.OTSO_LOG_DIR;
    expect(getRunLogPath()).toBe(join(root, 'logs', 'runs.jsonl'));
    await appendRun(indexRunFromReport(report));
    await appendRun({ kind: 'sync', started_at: '2026-11-27T13:00:00Z', duration_ms: 5, ok: true, sources: [{ name: 'arena', ms: 5, ok: true }] });
    expect(readFileSync(getRunLogPath(), 'utf8').trim().split('\n')).toHaveLength(2);
    expect(readRuns().map((r) => r.kind)).toEqual(['index', 'sync']);
  });
});

describe('indexer args', () => {
  test('fixture sources are built only for --fixtures', () => {
    sandbox();
    expect(indexerArgs(['build'], { fixtures: true })).toContain('--include-fixtures');
    expect(indexerArgs(['build'])).not.toContain('--include-fixtures');
    expect(indexerArgs(['build'], { fixtures: true, legacy: true })).not.toContain('--include-fixtures');
    expect(indexerArgs(['build'], { report: '/tmp/r.json' }).slice(-3)).toEqual(['--report', '/tmp/r.json', 'build']);
  });
});
