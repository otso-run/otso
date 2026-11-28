import { createCliRenderer } from '@opentui/core';
import { createRoot, useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useEffect, useState } from 'react';
import { archive, archivedSources, isArchived, unarchive } from '../core/archived.js';
import { getDeviceName } from '../core/device.js';
import { displayPath, getConfigDir, getDataRoot, getSourcesDir, readSettings, writeSettings, type Settings } from '../core/paths.js';
import { sourceStatuses, type SourceStatus } from '../core/runner.js';
import { readRuns } from '../core/runlog.js';
import { isSelected, isSyncable, saveSelection } from '../core/selection.js';
import { ImportApp } from './import/index.js';
import { runLine } from './log.js';
import { SourcesPanel, statusLabel, type PanelResult } from './sources-panel.js';

/**
 * `otso` with no arguments: one terminal app for everything. A home screen
 * leads to Sources (what a bare sync runs on this Mac), Import (the guided
 * setup), Status and log, and Settings. Sync now leaves the app and runs a
 * bare `otso sync` in the terminal, so its output stays readable. Every
 * command is still available on its own: otso --help.
 */

type Section = 'home' | 'sources' | 'import' | 'status' | 'settings';
export type AppExit = { action: 'quit' } | { action: 'sync' };

const C = { accent: '#00D4AA', dim: '#666666', mid: '#888888', text: '#DDDDDD', warn: '#FFB800', off: '#444444' };

const LOGO = ['╔═╗╔╦╗╔═╗╔═╗', '║ ║ ║ ╚═╗║ ║', '╚═╝ ╩ ╚═╝╚═╝'];

interface Data {
  statuses: SourceStatus[];
  settings: Settings;
  device: string;
  archived: Set<string>;
  busy: Record<string, { device: string; at: string }>;
}

export interface AppDeps {
  load: () => Promise<Data>;
  busy: (statuses: SourceStatus[]) => Promise<Data['busy']>;
}

export const MENU: { id: Exclude<Section, 'home'> | 'sync' | 'quit'; label: string; key: string; help: string }[] = [
  { id: 'sources', key: '1', label: 'Sources', help: 'What otso sync runs on this Mac' },
  { id: 'sync', key: '2', label: 'Sync now', help: 'Sync the chosen sources now' },
  { id: 'import', key: '3', label: 'Import', help: 'Connect accounts, bring in exports' },
  { id: 'status', key: '4', label: 'Status and log', help: 'What each source holds, recent runs' },
  { id: 'settings', key: '5', label: 'Settings', help: 'Index after sync, paths, Mac name' },
  { id: 'quit', key: 'q', label: 'Quit', help: '' },
];

/** "9 sources sync on this Mac · 2 archived · index after sync on" */
export function homeSummary(d: Data, selected: number): string {
  const parts = [`${selected} source${selected === 1 ? '' : 's'} sync on this Mac`];
  if (d.archived.size) parts.push(`${d.archived.size} archived`);
  parts.push(`index after sync ${(d.settings.indexAfterSync ?? true) ? 'on' : 'off'}`);
  return parts.join(' · ');
}

function Home(props: { data: Data | null; notice?: string; onPick: (id: (typeof MENU)[number]['id']) => void }) {
  const { width, height } = useTerminalDimensions();
  const [cursor, setCursor] = useState(0);
  useKeyboard((key) => {
    if (key.name === 'up' || key.name === 'k') setCursor((c) => (c + MENU.length - 1) % MENU.length);
    else if (key.name === 'down' || key.name === 'j' || key.name === 'tab') setCursor((c) => (c + 1) % MENU.length);
    else if (key.name === 'return') props.onPick(MENU[cursor].id);
    else if (key.name === 'escape') props.onPick('quit');
    else {
      const hit = MENU.find((m) => m.key === key.name);
      if (hit) props.onPick(hit.id);
    }
  });
  const d = props.data;
  return (
    <box flexDirection="column" width={width} height={height} padding={1} alignItems="center">
      <box height={Math.max(0, Math.floor(height / 2) - 12)} />
      {LOGO.map((l) => (
        <text key={l} fg={C.accent}>
          <strong>{l}</strong>
        </text>
      ))}
      <text fg={C.mid}>own your digital trails</text>
      <box height={1} />
      <text fg={C.dim}>{d ? `${d.device} · ${homeSummaryFor(d)}` : 'Reading your sources…'}</text>
      <box height={1} />
      <box flexDirection="column" border borderStyle="single" borderColor={C.off} padding={1} width={Math.min(width - 4, 72)}>
        {MENU.map((m, i) => (
          <box key={m.id} flexDirection="row">
            <text fg={i === cursor ? C.accent : C.dim}>{i === cursor ? '▸ ' : '  '}</text>
            <text fg={C.mid}>{m.key}  </text>
            <text fg={i === cursor ? '#FFFFFF' : C.text} width={16}>
              {m.label}
            </text>
            <text fg={C.dim}>{m.help.slice(0, Math.max(0, Math.min(width - 4, 72) - 25))}</text>
          </box>
        ))}
      </box>
      <box height={1} />
      {props.notice ? <text fg={C.accent}>{props.notice}</text> : <text fg={C.dim}>↑↓ or a number to choose · enter open · q quit · every command: otso --help</text>}
    </box>
  );
}

/** What a bare sync would run, for the home line. */
function homeSummaryFor(d: Data): string {
  const n = d.statuses.filter((s) => isSyncable(s) && isSelected(s, d.settings) && !d.archived.has(s.id)).length;
  return homeSummary(d, n);
}

function StatusView(props: { data: Data; onBack: () => void }) {
  const { width, height } = useTerminalDimensions();
  const [scroll, setScroll] = useState(0);
  const runs = readRuns().slice(-8).reverse();
  const rows = props.data.statuses;
  const listHeight = Math.max(3, height - Math.max(1, runs.length) - 13);
  useKeyboard((key) => {
    if (key.name === 'escape' || key.name === 'q' || key.name === 'backspace') props.onBack();
    else if (key.name === 'down' || key.name === 'j') setScroll((s) => Math.min(Math.max(0, rows.length - listHeight), s + 1));
    else if (key.name === 'up' || key.name === 'k') setScroll((s) => Math.max(0, s - 1));
  });
  const kind = { api: 'API', export: 'export', local: 'local' } as const;
  return (
    <box flexDirection="column" width={width} height={height} padding={1}>
      <text>
        <strong>STATUS AND LOG</strong>
      </text>
      <text fg={C.dim}>{`Data ${displayPath(getDataRoot())} · sources ${displayPath(getSourcesDir())}`}</text>
      <box height={1} />
      <text fg={C.mid}>{`${'SOURCE'.padEnd(26)}${'TYPE'.padEnd(8)}${'STATUS'.padEnd(26)}${'ROWS'.padStart(10)}  LAST RUN`}</text>
      {rows.slice(scroll, scroll + listHeight).map((s) => {
        const st = props.data.archived.has(s.id) || isArchived(s.id, [...props.data.archived]) ? { text: 'archived', ok: false } : s.kind === 'export' ? { text: s.dbExists ? 'imported' : '', ok: true } : statusLabel(s);
        const last = s.lastRun ? `${s.lastRun.kind} ${new Date(s.lastRun.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${s.lastRun.device ? ` on ${s.lastRun.device}` : ''}` : '';
        return (
          <text key={s.id} fg={st.ok ? C.text : C.dim}>
            {`${s.displayName.slice(0, 25).padEnd(26)}${kind[s.kind].padEnd(8)}${st.text.slice(0, 25).padEnd(26)}${(s.dbExists ? s.rows.toLocaleString() : '').padStart(10)}  ${last}`.slice(0, width - 2)}
          </text>
        );
      })}
      {scroll + listHeight < rows.length && <text fg={C.dim}>  ↓ {rows.length - scroll - listHeight} more</text>}
      <box height={1} />
      <text fg={C.mid}>RECENT RUNS</text>
      {runs.length ? runs.map((r, i) => <text key={i} fg={r.ok ? C.text : C.warn}>{runLine(r).slice(0, width - 2)}</text>) : <text fg={C.dim}>  No runs logged yet.</text>}
      <box flexGrow={1} />
      <text fg={C.dim}>↑↓ scroll · esc back · details: otso log</text>
    </box>
  );
}

function SettingsView(props: { data: Data; onBack: () => void; onChanged: () => void }) {
  const { width, height } = useTerminalDimensions();
  const [index, setIndex] = useState(props.data.settings.indexAfterSync ?? true);
  const [saved, setSaved] = useState(false);
  useKeyboard((key) => {
    if (key.name === 'escape' || key.name === 'q' || key.name === 'backspace') props.onBack();
    else if (key.name === 'space' || key.name === 'return') {
      const next = !index;
      setIndex(next);
      const settings = readSettings();
      if (next) delete settings.indexAfterSync;
      else settings.indexAfterSync = false;
      void writeSettings(settings).then(() => {
        setSaved(true);
        props.onChanged();
      });
    }
  });
  const s = props.data.settings;
  const line = (k: string, v: string, note = '') => (
    <box key={k} flexDirection="row">
      <text fg={C.mid} width={20}>
        {`    ${k}`}
      </text>
      <text fg={C.text}>{v}</text>
      <text fg={C.dim}>{note ? `  ${note}` : ''}</text>
    </box>
  );
  return (
    <box flexDirection="column" width={width} height={height} padding={1}>
      <text>
        <strong>SETTINGS</strong>
      </text>
      <text fg={C.dim}>{`Saved per Mac in ${displayPath(getConfigDir())}/settings.json`}</text>
      <box height={1} />
      <box flexDirection="row">
        <text fg={C.accent}>▸ </text>
        <text fg={index ? C.accent : C.dim}>[{index ? '✓' : ' '}]</text>
        <text fg="#FFFFFF"> Index after sync</text>
        <text fg={C.dim}>  run otso index after each sync, by hand or on the schedule{saved ? ' · saved' : ''}</text>
      </box>
      <box height={1} />
      {line('device', props.data.device, s.device ? '' : '(from hostname)')}
      {line('data-dir', displayPath(getDataRoot()), s.dataDir ? '' : '(default)')}
      {line('sources-dir', displayPath(getSourcesDir()), s.sourcesDir ? '' : '(<data-dir>/sources)')}
      {line('credentials', displayPath(getConfigDir()))}
      {line('indexer', s.indexerPath ?? process.env.OTSO_INDEXER ?? '(repo build, or cargo run)')}
      <box height={1} />
      <text fg={C.dim}>{'    Change these with otso config set data-dir|sources-dir|indexer|device <value>'}</text>
      <box flexGrow={1} />
      <text fg={C.dim}>space toggle · esc back</text>
    </box>
  );
}

function App(props: { deps: AppDeps; initial: Data | null; onExit: (e: AppExit) => void }) {
  const [section, setSection] = useState<Section>('home');
  const [data, setData] = useState<Data | null>(props.initial);
  const [notice, setNotice] = useState<string | undefined>();
  const reload = () => void props.deps.load().then(setData);
  useEffect(() => {
    if (!data) reload();
  }, []);
  const home = (message?: string) => {
    setNotice(message);
    setSection('home');
  };

  if (section === 'sources' && data) {
    return (
      <SourcesPanel
        statuses={data.statuses}
        settings={data.settings}
        device={data.device}
        archived={data.archived}
        busy={data.busy}
        onSave={async (r: PanelResult) => {
          await saveSelection(r.sync, r.index);
          if (r.archive.length) await archive(r.archive);
          if (r.unarchive.length) await unarchive(r.unarchive.flatMap((id) => [id, `${id}-${data.device}`]));
        }}
        onExit={(message) => {
          reload();
          home(message?.split('\n')[0]);
        }}
      />
    );
  }
  if (section === 'import') {
    return (
      <ImportApp
        options={{}}
        onQuit={() => {
          reload();
          home();
        }}
      />
    );
  }
  if (section === 'status' && data) return <StatusView data={data} onBack={() => home()} />;
  if (section === 'settings' && data) return <SettingsView data={data} onBack={() => home()} onChanged={reload} />;

  return (
    <Home
      data={data}
      notice={notice}
      onPick={(id) => {
        if (id === 'quit') return props.onExit({ action: 'quit' });
        if (id === 'sync') return props.onExit({ action: 'sync' });
        if (!data && id !== 'import') return setNotice('Still reading your sources…');
        setNotice(undefined);
        setSection(id);
      }}
    />
  );
}

/** Everything the app shows, read once per visit to home. */
export async function loadAppData(busy: AppDeps['busy']): Promise<Data> {
  const statuses = await sourceStatuses();
  const device = await getDeviceName();
  const list = archivedSources();
  const archived = new Set(statuses.map((s) => s.id).filter((id) => isArchived(id, list) || isArchived(`${id}-${device}`, list)));
  return { statuses, settings: readSettings(), device, archived, busy: await busy(statuses) };
}

export async function runApp(deps: AppDeps): Promise<AppExit> {
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  return new Promise<AppExit>((resolve) => {
    createRoot(renderer).render(
      <App
        deps={deps}
        initial={null}
        onExit={(e) => {
          renderer.destroy();
          resolve(e);
        }}
      />
    );
  });
}
