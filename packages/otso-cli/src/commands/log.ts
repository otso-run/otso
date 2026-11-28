import { displayPath } from '../core/paths.js';
import { fmtMs, getRunLogPath, readRuns, SLOW_QUERY_MS, type RunEntry, type SourceRun } from '../core/runlog.js';

/**
 * `otso log`: recent sync and index runs from ~/.otso/logs/runs.jsonl, then
 * each source's recent timings, so a source that is getting slower or keeps
 * failing stands out.
 */

export interface LogOptions {
  limit?: string;
  source?: string;
  kind?: string;
  json?: boolean;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};

export function logCommand(opts: LogOptions = {}) {
  const limit = Math.max(1, Number(opts.limit ?? 10) || 10);
  let runs = readRuns();
  if (opts.kind) runs = runs.filter((r) => r.kind === opts.kind);
  if (opts.source) {
    runs = runs
      .map((r) => ({ ...r, sources: r.sources.filter((s) => s.name === opts.source) }))
      .filter((r) => r.sources.length);
  }
  if (opts.json) {
    for (const r of runs.slice(-limit)) console.log(JSON.stringify(r));
    return;
  }
  if (!runs.length) {
    console.log(`No runs logged yet${opts.source || opts.kind ? ' that match' : ''}. Each otso sync and otso index adds one to ${displayPath(getRunLogPath())}.`);
    return;
  }

  console.log(`\nRecent runs (${displayPath(getRunLogPath())})\n`);
  for (const r of runs.slice(-limit).reverse()) console.log(runLine(r));

  const bySource = new Map<string, { kind: RunEntry['kind']; at: string; s: SourceRun }[]>();
  for (const r of runs) {
    for (const s of r.sources) {
      const key = `${r.kind}:${s.name}`;
      if (!bySource.has(key)) bySource.set(key, []);
      bySource.get(key)!.push({ kind: r.kind, at: r.started_at, s });
    }
  }

  // Per source over the last `limit` runs that included it: failing, then slowest.
  const rows = [...bySource.values()].map((all) => {
    const recent = all.slice(-limit);
    const ok = recent.filter((x) => x.s.ok);
    const last = recent[recent.length - 1];
    return {
      kind: last.kind,
      name: last.s.name,
      failures: recent.length - ok.length,
      median: median(ok.map((x) => x.s.ms)),
      last: last.s,
      lastAt: last.at,
      slow: recent.reduce((n, x) => n + (x.s.slow_queries?.length ?? 0), 0),
    };
  });
  rows.sort((a, b) => b.failures - a.failures || b.median - a.median);

  const shown = opts.source ? rows : rows.filter((r) => r.failures || r.median >= 1000 || r.slow).slice(0, 15);
  if (shown.length) {
    console.log(`\n${opts.source ? opts.source : 'Slow or failing sources'} (last ${limit} runs each)\n`);
    console.log(`  ${'source'.padEnd(26)} ${'kind'.padEnd(6)} ${'median'.padStart(8)} ${'last'.padStart(8)} ${'fails'.padStart(5)}  last run`);
    for (const r of shown) {
      const lastMs = r.last.ok ? fmtMs(r.last.ms) : 'failed';
      const parts = [r.last.rows !== undefined ? `${r.last.rows.toLocaleString()} rows` : '', breakdown(r.last)].filter(Boolean);
      console.log(
        `  ${r.name.padEnd(26)} ${r.kind.padEnd(6)} ${fmtMs(r.median).padStart(8)} ${lastMs.padStart(8)} ${String(r.failures).padStart(5)}  ${when(r.lastAt)}${parts.length ? ` · ${parts.join(', ')}` : ''}`
      );
      if (!r.last.ok && r.last.error) console.log(`    ✗ ${r.last.error.split('\n')[0]}`);
      for (const q of r.last.slow_queries ?? []) {
        console.log(`    slow query: ${q.entry_type} ${fmtMs(q.ms)} (${q.rows.toLocaleString()} rows)`);
      }
    }
  } else {
    console.log(`\nNo source failed or took over a second in the last ${limit} runs.`);
  }
  console.log(`\nOptions: --source <name>, --kind sync|index, -n <runs>, --json. Slow query: over ${SLOW_QUERY_MS / 1000}s.`);
}

function breakdown(s: SourceRun): string {
  const parts: string[] = [];
  if (s.copy_ms !== undefined) parts.push(`copy ${fmtMs(s.copy_ms)}`);
  if (s.read_ms !== undefined) parts.push(`read ${fmtMs(s.read_ms)}`);
  if (s.write_ms !== undefined) parts.push(`write ${fmtMs(s.write_ms)}`);
  return parts.join(' ');
}

export function runLine(r: RunEntry): string {
  const failed = r.sources.filter((s) => !s.ok);
  const status = r.ok ? '✓' : '✗';
  const what = `${r.sources.length} source${r.sources.length === 1 ? '' : 's'}`;
  const extra = [
    r.device ? `on ${r.device}` : '',
    r.projection ? `${r.projection.added.toLocaleString()} new in search` : '',
    failed.length ? `failed: ${failed.map((s) => s.name).join(', ')}` : '',
    r.error ?? '',
  ].filter(Boolean);
  return `  ${status} ${when(r.started_at).padEnd(16)} ${r.kind.padEnd(6)} ${fmtMs(r.duration_ms).padStart(8)}  ${what}${extra.length ? ` · ${extra.join(' · ')}` : ''}`;
}
