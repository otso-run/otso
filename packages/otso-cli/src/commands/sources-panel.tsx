import { createCliRenderer } from '@opentui/core';
import { createRoot, useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useEffect, useState } from 'react';
import type { SourceStatus } from '../core/runner.js';
import { autoSelected, canSync, choicesFor, isSelected, isSyncable } from '../core/selection.js';
import type { Settings } from '../core/paths.js';

/**
 * `otso config sources`: a checkbox per source that decides what a bare
 * `otso sync` (and the scheduled sync) runs on this Mac, plus whether it
 * indexes afterwards. Nothing is written until you save.
 */

export interface PanelRow {
  status: SourceStatus;
  /** Other Macs that hold their own copy of this per-device source. */
  otherMacs: string[];
  /** A sync holding this source's lock right now (from <db>.lock). */
  busy?: { device: string; at: string };
}

export interface PanelState {
  rows: PanelRow[];
  checked: Set<string>;
  index: boolean;
  /** Connector ids archived (shared across Macs, in <sources-dir>/archived.json). */
  archived: Set<string>;
  /** 0 is the "index after sync" line, then one per row. */
  cursor: number;
  dirty: boolean;
}

export type PanelKey = 'up' | 'down' | 'top' | 'bottom' | 'toggle' | 'auto' | 'all' | 'none' | 'archive';

export function panelRows(statuses: SourceStatus[], busy: Record<string, { device: string; at: string }> = {}): PanelRow[] {
  return statuses.filter(isSyncable).map((status) => ({
    status,
    busy: busy[status.id],
    otherMacs: statuses
      .filter((o) => o.parent === status.id && o.id !== `${status.id} (shared)`)
      .map((o) => o.id.slice(status.id.length + 1)),
  }));
}

export function initialState(
  statuses: SourceStatus[],
  settings: Settings,
  archived: Set<string> = new Set(),
  busy: Record<string, { device: string; at: string }> = {}
): PanelState {
  const rows = panelRows(statuses, busy);
  return {
    rows,
    checked: new Set(rows.filter((r) => isSelected(r.status, settings)).map((r) => r.status.id)),
    index: settings.indexAfterSync ?? true,
    archived: new Set(archived),
    cursor: 1,
    dirty: false,
  };
}

/** The panel's key handling, kept pure so it can be tested without a terminal. */
export function reduce(state: PanelState, key: PanelKey): PanelState {
  const last = state.rows.length;
  const row = state.rows[state.cursor - 1];
  const set = (ids: string[], on: boolean) => {
    const checked = new Set(state.checked);
    for (const id of ids) on ? checked.add(id) : checked.delete(id);
    return { ...state, checked, dirty: true };
  };
  switch (key) {
    case 'up':
      return { ...state, cursor: Math.max(0, state.cursor - 1) };
    case 'down':
      return { ...state, cursor: Math.min(last, state.cursor + 1) };
    case 'top':
      return { ...state, cursor: 0 };
    case 'bottom':
      return { ...state, cursor: last };
    case 'toggle':
      if (state.cursor === 0) return { ...state, index: !state.index, dirty: true };
      if (!row || !canSync(row.status) || state.archived.has(row.status.id)) return state;
      return set([row.status.id], !state.checked.has(row.status.id));
    case 'auto':
      if (state.cursor === 0) return { ...state, index: true, dirty: true };
      if (!row || !canSync(row.status)) return state;
      return set([row.status.id], autoSelected(row.status));
    case 'all':
      return set(state.rows.filter((r) => canSync(r.status) && !state.archived.has(r.status.id)).map((r) => r.status.id), true);
    case 'archive': {
      if (!row) return state;
      const archived = new Set(state.archived);
      archived.has(row.status.id) ? archived.delete(row.status.id) : archived.add(row.status.id);
      return { ...state, archived, dirty: true };
    }
    case 'none':
      return set(state.rows.map((r) => r.status.id), false);
  }
}

const fmtWhen = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};

/** Checked and not archived: what a bare sync will actually run. */
export function willSync(state: PanelState, id: string): boolean {
  return state.checked.has(id) && !state.archived.has(id);
}

/** "connected as casey", "not connected: otso auth arena", "app not on this Mac" */
export function statusLabel(s: SourceStatus, archived = false): { text: string; ok: boolean } {
  if (archived) return { text: 'archived (every Mac)', ok: false };
  if (s.kind === 'api') return s.connected ? { text: `connected${s.account ? ` as ${s.account}` : ''}`, ok: true } : { text: 'not connected', ok: false };
  if (!s.onThisMac) return { text: 'app not on this Mac', ok: false };
  if (!s.dbExists && !s.syncedAnywhere) return { text: 'on this Mac, new', ok: true };
  return { text: 'on this Mac', ok: true };
}

/** The line under the list for the focused source: what to do next. */
export function detailLine(row: PanelRow | undefined, state: PanelState): string {
  if (!row) return 'Index after sync: run otso index after each sync, by hand or on the schedule. Turn it off on a Mac that does not hold the index.';
  const s = row.status;
  if (state.archived.has(s.id)) return `${s.displayName} is archived: kept and searchable, never synced, on every Mac. a to unarchive.`;
  if (s.kind === 'api' && !s.connected) return `Connect it first: otso auth ${s.id}`;
  if (s.kind === 'local' && !s.onThisMac) return `${s.displayName} isn't installed on this Mac, so another Mac has to sync it.`;
  const auto = autoSelected(s);
  const on = state.checked.has(s.id);
  if (on === auto) return on ? 'Synced by default. Space to skip it on this Mac.' : 'Not synced by default. Space to include it.';
  return on ? 'Always synced on this Mac. r for the automatic choice.' : 'Skipped on this Mac. r for the automatic choice.';
}

export function lastSyncLabel(row: PanelRow, device: string): string {
  if (row.busy) return `syncing now on ${row.busy.device === device ? 'this Mac' : row.busy.device} (since ${fmtWhen(row.busy.at)})`;
  const run = row.status.lastRun;
  if (!run) return row.otherMacs.length ? `other Macs: ${row.otherMacs.join(', ')}` : 'never';
  const who = run.device && run.device !== device ? ` from ${run.device}` : '';
  const others = row.otherMacs.length ? ` · also ${row.otherMacs.join(', ')}` : '';
  return `${fmtWhen(run.at)}${who}${others}`;
}

const C = { accent: '#00D4AA', dim: '#666666', mid: '#888888', text: '#DDDDDD', warn: '#FFB800', off: '#444444' };

function Panel(props: {
  statuses: SourceStatus[];
  settings: Settings;
  device: string;
  archived: Set<string>;
  busy: Record<string, { device: string; at: string }>;
  onSave: (result: PanelResult) => Promise<void>;
  onExit: (message?: string) => void;
}) {
  const { width, height } = useTerminalDimensions();
  const [state, setState] = useState(() => initialState(props.statuses, props.settings, props.archived, props.busy));
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [scroll, setScroll] = useState(0);
  const listHeight = Math.max(3, height - 13);

  useEffect(() => {
    const i = state.cursor - 1;
    if (i < scroll) setScroll(Math.max(0, i));
    else if (i >= scroll + listHeight) setScroll(i - listHeight + 1);
  }, [state.cursor, listHeight, scroll]);

  const save = async () => {
    const sync = choicesFor(props.statuses, state.checked, props.settings.sync);
    const archive = [...state.archived].filter((id) => !props.archived.has(id));
    const unarchive = [...props.archived].filter((id) => !state.archived.has(id));
    await props.onSave({ sync, index: state.index, archive, unarchive });
    const n = state.rows.filter((r) => willSync(state, r.status.id)).length;
    const lines = [`✓ Saved. A bare otso sync on this Mac now runs ${n} source${n === 1 ? '' : 's'}${state.index ? ', then indexes' : ''}.`];
    if (archive.length) lines.push(`  Archived on every Mac: ${archive.join(', ')}`);
    if (unarchive.length) lines.push(`  Unarchived: ${unarchive.join(', ')}`);
    props.onExit(lines.join('\n'));
  };

  useKeyboard((key) => {
    if (confirmQuit) {
      if (key.name === 'y') props.onExit('Not saved.');
      else if (key.name === 's' || key.name === 'return') void save();
      else setConfirmQuit(false);
      return;
    }
    const map: Record<string, PanelKey> = { up: 'up', k: 'up', down: 'down', j: 'down', g: 'top', home: 'top', end: 'bottom', space: 'toggle', x: 'toggle', r: 'auto', a: 'archive', A: 'all', N: 'none' };
    const name = key.shift && key.name?.length === 1 ? key.name.toUpperCase() : key.name;
    if (name === 'G') return setState((s) => reduce(s, 'bottom'));
    if (name && map[name]) return setState((s) => reduce(s, map[name]));
    if (key.name === 'return' || key.name === 's') return void save();
    if (key.name === 'escape' || key.name === 'q') {
      if (state.dirty) setConfirmQuit(true);
      else props.onExit();
    }
  });

  const nameW = 18;
  const statusW = 30;
  const rowsW = 10;
  const visible = state.rows.slice(scroll, scroll + listHeight);
  const count = state.rows.filter((r) => willSync(state, r.status.id)).length;

  return (
    <box flexDirection="column" width={width} height={height} padding={1}>
      <box flexDirection="row" justifyContent="space-between" width={width - 2}>
        <text>
          <strong>SOURCES FOR otso sync</strong>
        </text>
        <text fg={C.dim}>
          on {props.device} · {count} selected{state.dirty ? ' · unsaved' : ''}
        </text>
      </box>
      <text fg={C.dim}>What a bare `otso sync` and the hourly schedule run on this Mac. Other Macs keep their own choices.</text>
      <box height={1} />

      <box flexDirection="row">
        <text fg={state.cursor === 0 ? C.accent : C.dim}>{state.cursor === 0 ? '▸ ' : '  '}</text>
        <text fg={state.index ? C.accent : C.dim}>[{state.index ? '✓' : ' '}]</text>
        <text fg={state.cursor === 0 ? '#FFFFFF' : C.text}> Index after sync</text>
        <text fg={C.dim}>  run otso index after each sync</text>
      </box>
      <box height={1} />

      <box flexDirection="row">
        <text fg={C.mid}>{'      '}</text>
        <text fg={C.mid} width={nameW}>SOURCE</text>
        <text fg={C.mid} width={statusW}>STATUS</text>
        <text fg={C.mid} width={rowsW}>{'ROWS'.padStart(rowsW - 2)}</text>
        <text fg={C.mid}>LAST SYNC</text>
      </box>
      <box flexDirection="column" flexGrow={1} border borderStyle="single" borderColor={C.off} paddingLeft={1} paddingRight={1}>
        {scroll > 0 && <text fg={C.dim}>  ↑ {scroll} more</text>}
        {visible.map((row, i) => {
          const idx = scroll + i + 1;
          const focused = idx === state.cursor;
          const s = row.status;
          const arch = state.archived.has(s.id);
          const can = canSync(s) && !arch;
          const on = state.checked.has(s.id);
          const st = statusLabel(s, arch);
          const changed = arch !== props.archived.has(s.id) || (can && on !== isSelected(s, props.settings));
          const mark = arch ? 'a' : !can ? '–' : on ? '✓' : ' ';
          // Mark choices that differ from the automatic rule, and unsaved edits.
          const tag = changed ? ' *' : can && on !== autoSelected(s) ? (on ? ' · always' : ' · skipped') : '';
          return (
            <box key={s.id} flexDirection="row">
              <text fg={focused ? C.accent : C.dim}>{focused ? '▸ ' : '  '}</text>
              <text fg={!can ? C.off : on ? C.accent : C.dim}>[{mark}]</text>
              <text fg={focused ? '#FFFFFF' : can ? C.text : C.dim} width={nameW}>
                {` ${s.displayName}`.slice(0, nameW - 1)}
              </text>
              <text fg={st.ok ? C.mid : C.warn} width={statusW}>
                {(st.text + tag).slice(0, statusW - 1)}
              </text>
              <text fg={C.dim} width={rowsW}>
                {(s.dbExists ? s.rows.toLocaleString() : '').padStart(rowsW - 2)}
              </text>
              <text fg={C.dim}>{lastSyncLabel(row, props.device).slice(0, Math.max(10, width - nameW - statusW - rowsW - 14))}</text>
            </box>
          );
        })}
        {scroll + listHeight < state.rows.length && <text fg={C.dim}>  ↓ {state.rows.length - scroll - listHeight} more</text>}
      </box>

      <text fg={C.mid}>{detailLine(state.rows[state.cursor - 1], state).slice(0, width - 2)}</text>
      <box flexDirection="row">
        {confirmQuit ? (
          <text fg={C.warn}>Discard your changes? y: discard · s: save · any other key: keep editing</text>
        ) : (
          <text fg={C.dim}>↑↓ move · space toggle · r automatic · a archive · A all · N none · enter save · esc quit</text>
        )}
      </box>
    </box>
  );
}

export interface PanelResult {
  sync: Record<string, boolean>;
  index: boolean;
  archive: string[];
  unarchive: string[];
}

export async function runSourcesPanel(opts: {
  statuses: SourceStatus[];
  settings: Settings;
  device: string;
  archived: Set<string>;
  busy: Record<string, { device: string; at: string }>;
  onSave: (result: PanelResult) => Promise<void>;
}): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  await new Promise<void>((resolve) => {
    const onExit = (message?: string) => {
      renderer.destroy();
      if (message) console.log(message);
      resolve();
    };
    createRoot(renderer).render(<Panel {...opts} onExit={onExit} />);
  });
}

