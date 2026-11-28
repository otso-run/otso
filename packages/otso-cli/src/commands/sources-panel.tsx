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
}

export interface PanelState {
  rows: PanelRow[];
  checked: Set<string>;
  index: boolean;
  /** 0 is the "index after sync" line, then one per row. */
  cursor: number;
  dirty: boolean;
}

export type PanelKey = 'up' | 'down' | 'top' | 'bottom' | 'toggle' | 'auto' | 'all' | 'none';

export function panelRows(statuses: SourceStatus[]): PanelRow[] {
  return statuses.filter(isSyncable).map((status) => ({
    status,
    otherMacs: statuses
      .filter((o) => o.parent === status.id && o.id !== `${status.id} (shared)`)
      .map((o) => o.id.slice(status.id.length + 1)),
  }));
}

export function initialState(statuses: SourceStatus[], settings: Settings): PanelState {
  const rows = panelRows(statuses);
  return {
    rows,
    checked: new Set(rows.filter((r) => isSelected(r.status, settings)).map((r) => r.status.id)),
    index: settings.indexAfterSync ?? true,
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
      if (!row || !canSync(row.status)) return state;
      return set([row.status.id], !state.checked.has(row.status.id));
    case 'auto':
      if (state.cursor === 0) return { ...state, index: true, dirty: true };
      if (!row || !canSync(row.status)) return state;
      return set([row.status.id], autoSelected(row.status));
    case 'all':
      return set(state.rows.filter((r) => canSync(r.status)).map((r) => r.status.id), true);
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

/** "connected as casey", "not connected: otso auth arena", "app not on this Mac" */
export function statusLabel(s: SourceStatus): { text: string; ok: boolean } {
  if (s.kind === 'api') return s.connected ? { text: `connected${s.account ? ` as ${s.account}` : ''}`, ok: true } : { text: `not connected: otso auth ${s.id}`, ok: false };
  if (!s.onThisMac) return { text: 'app not on this Mac', ok: false };
  if (!s.dbExists && !s.syncedAnywhere) return { text: 'on this Mac, never synced', ok: true };
  return { text: 'on this Mac', ok: true };
}

export function lastSyncLabel(row: PanelRow, device: string): string {
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
  onSave: (sync: Record<string, boolean>, index: boolean) => Promise<void>;
  onExit: (message?: string) => void;
}) {
  const { width, height } = useTerminalDimensions();
  const [state, setState] = useState(() => initialState(props.statuses, props.settings));
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [scroll, setScroll] = useState(0);
  const listHeight = Math.max(3, height - 12);

  useEffect(() => {
    const i = state.cursor - 1;
    if (i < scroll) setScroll(Math.max(0, i));
    else if (i >= scroll + listHeight) setScroll(i - listHeight + 1);
  }, [state.cursor, listHeight, scroll]);

  const save = async () => {
    const sync = choicesFor(props.statuses, state.checked, props.settings.sync);
    await props.onSave(sync, state.index);
    props.onExit(`✓ Saved. A bare otso sync on this Mac now runs ${state.checked.size} source${state.checked.size === 1 ? '' : 's'}${state.index ? ', then indexes' : ''}.`);
  };

  useKeyboard((key) => {
    if (confirmQuit) {
      if (key.name === 'y') props.onExit('Not saved.');
      else if (key.name === 's' || key.name === 'return') void save();
      else setConfirmQuit(false);
      return;
    }
    const map: Record<string, PanelKey> = { up: 'up', k: 'up', down: 'down', j: 'down', g: 'top', home: 'top', end: 'bottom', space: 'toggle', x: 'toggle', a: 'auto', A: 'all', N: 'none' };
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
  const count = state.checked.size;

  return (
    <box flexDirection="column" width={width} height={height} padding={1}>
      <box flexDirection="row" justifyContent="space-between" width={width - 2}>
        <text>
          <strong>SOURCES FOR otso sync</strong>
        </text>
        <text fg={C.dim}>on {props.device}</text>
      </box>
      <text fg={C.dim}>What a bare `otso sync` and the hourly schedule run on this Mac. Other Macs keep their own choices.</text>
      <box height={1} />

      <box flexDirection="row">
        <text fg={state.cursor === 0 ? C.accent : C.dim}>{state.cursor === 0 ? '▸ ' : '  '}</text>
        <text fg={state.index ? C.accent : C.dim}>[{state.index ? '✓' : ' '}]</text>
        <text fg={state.cursor === 0 ? '#FFFFFF' : C.text}> Index after sync</text>
        <text fg={C.dim}>  rebuild the search index when a sync brings in something</text>
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
          const can = canSync(s);
          const on = state.checked.has(s.id);
          const st = statusLabel(s);
          const changed = can && on !== isSelected(s, props.settings);
          const mark = !can ? '–' : on ? '✓' : ' ';
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

      <box flexDirection="row" justifyContent="space-between" width={width - 2}>
        {confirmQuit ? (
          <text fg={C.warn}>Discard your changes? y: discard · s: save · any other key: keep editing</text>
        ) : (
          <text fg={C.dim}>↑↓ move · space toggle · a automatic · A all · N none · enter save · esc quit</text>
        )}
        <text fg={C.dim}>{count} selected{state.dirty ? ' · unsaved' : ''}</text>
      </box>
    </box>
  );
}

export async function runSourcesPanel(opts: {
  statuses: SourceStatus[];
  settings: Settings;
  device: string;
  onSave: (sync: Record<string, boolean>, index: boolean) => Promise<void>;
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

