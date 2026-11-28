import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { EVENTS_TABLE } from '../core/chronicle.js';
import { iso } from '../core/time.js';
import type { Connector, RunStats } from './types.js';
import { addStats, htmlToText, NotOnThisMacError, PermissionError, resolveLocalPath } from './util.js';

/**
 * OmniFocus tasks and projects, read straight from the OmniFocus.ofocus
 * package: one zip holding the full database as contents.xml, plus a zip per
 * sync transaction holding only what changed. Applying them in order gives
 * the current state, the same way OmniFocus itself does. Nothing is written
 * back, and OmniFocus doesn't need to be running.
 *
 * Encrypted databases (OmniFocus Sync with a passphrase) can't be read this
 * way and are reported as such.
 */

const ofocusPaths = [
  '~/Library/Containers/com.omnigroup.OmniFocus4/Data/Library/Application Support/OmniFocus/OmniFocus.ofocus',
  '~/Library/Containers/com.omnigroup.OmniFocus3/Data/Library/Application Support/OmniFocus/OmniFocus.ofocus',
];

type Fields = Record<string, string>;
interface Obj {
  kind: string;
  fields: Fields;
}

const ELEMENT = /<(task|context|folder|task-to-tag)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
const attr = (attrs: string, name: string) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

/** Direct children we use: plain values, and idref links to a parent task, context or folder. */
function readFields(body: string): Fields {
  const f: Fields = {};
  // Drop the nested <project> block first, keeping what we need from it.
  const project = body.match(/<project>([\s\S]*?)<\/project>/);
  if (project) {
    f.isProject = '1';
    const folder = project[1].match(/<folder idref="([^"]+)"/)?.[1];
    if (folder) f.folder = folder;
    const status = project[1].match(/<status>([^<]*)<\/status>/)?.[1];
    if (status) f.status = status;
    body = body.replace(project[0], '');
  } else if (/<project\s*\/>/.test(body)) {
    f.isProject = '';
  }
  for (const m of body.matchAll(/<(task|context|folder)\s+idref="([^"]+)"\s*\/>/g)) f[`${m[1]}Ref`] = m[2];
  for (const m of body.matchAll(/<(task|context|folder)\s*\/>/g)) f[`${m[1]}Ref`] = '';
  for (const key of ['name', 'note', 'added', 'modified', 'completed', 'due', 'start', 'flagged', 'hidden']) {
    const m = body.match(new RegExp(`<${key}(?:\\s[^>]*)?>([\\s\\S]*?)</${key}>|<${key}(?:\\s[^>]*)?/>`));
    if (m) f[key] = m[1] ?? '';
  }
  return f;
}

/** Apply one contents.xml (the base or a delta) to the object map. */
export function applyTransaction(objects: Map<string, Obj>, xml: string): void {
  for (const m of xml.matchAll(ELEMENT)) {
    const [, kind, attrs, body] = m;
    const id = attr(attrs, 'id');
    if (!id) continue;
    const op = attr(attrs, 'op');
    if (op === 'delete') {
      objects.delete(id);
      continue;
    }
    const fields = readFields(body ?? '');
    const prev = op === 'update' ? objects.get(id) : undefined;
    objects.set(id, { kind, fields: prev ? { ...prev.fields, ...fields } : fields });
  }
}

export function omnifocusRows(objects: Map<string, Obj>) {
  const name = (id?: string) => (id ? htmlToText(objects.get(id)?.fields.name ?? '') || undefined : undefined);
  const tags = new Map<string, string[]>();
  for (const o of objects.values()) {
    if (o.kind !== 'task-to-tag' || !o.fields.taskRef || !o.fields.contextRef) continue;
    const t = name(o.fields.contextRef);
    if (t) tags.set(o.fields.taskRef, [...(tags.get(o.fields.taskRef) ?? []), t]);
  }
  /** The project a task belongs to: the nearest ancestor that is a project. */
  const projectOf = (id: string) => {
    let cur = objects.get(id)?.fields.taskRef;
    for (let hops = 0; cur && hops < 50; hops++) {
      const o = objects.get(cur);
      if (!o) return undefined;
      if (o.fields.isProject) return name(cur);
      cur = o.fields.taskRef;
    }
    return undefined;
  };

  const rows = [];
  for (const [id, o] of objects) {
    if (o.kind !== 'task') continue;
    const f = o.fields;
    const title = htmlToText(f.name ?? '');
    if (!title) continue;
    const isProject = !!f.isProject;
    const legacyContext = name(f.contextRef);
    const taskTags = [...new Set([...(tags.get(id) ?? []), ...(legacyContext ? [legacyContext] : [])])];
    rows.push({
      source_id: id,
      type: 'CreateAction',
      source: 'omnifocus',
      additionalType: isProject ? 'Project' : 'ToDo',
      name: title,
      description: htmlToText(f.note ?? ''),
      startTime: iso(f.added),
      endTime: iso(f.completed || null),
      actionStatus: f.completed ? 'completed' : f.status === 'dropped' ? 'canceled' : 'open',
      result: { name: isProject ? name(f.folder) ?? null : projectOf(id) ?? null },
      object: { keywords: taskTags, due: iso(f.due || null) ?? undefined, flagged: f.flagged === 'true' },
    });
  }
  return rows;
}

export const omnifocus: Connector = {
  id: 'omnifocus',
  displayName: 'OmniFocus',
  description: 'Tasks and projects',
  kind: 'local',
  dbPath: 'omnifocus/chronicle/chronicle.db',
  tables: [EVENTS_TABLE],
  localPaths: ofocusPaths,

  async sync({ store, log }) {
    const dir = ofocusPaths.map(resolveLocalPath).find(Boolean);
    if (!dir) throw new NotOnThisMacError('OmniFocus');
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.zip')).sort();
    } catch (err: any) {
      if (err?.code === 'EPERM' || err?.code === 'EACCES') throw new PermissionError(dir);
      throw err;
    }
    if (readdirSync(dir).includes('encrypted')) throw new Error('This OmniFocus database is encrypted, so otso can\'t read it');

    const objects = new Map<string, Obj>();
    for (const f of files) {
      const { stdout } = await execa('unzip', ['-p', join(dir, f), 'contents.xml'], { maxBuffer: 512 * 1024 * 1024 });
      applyTransaction(objects, stdout);
    }
    const rows = omnifocusRows(objects);

    // Tasks deleted in OmniFocus are no longer in the replayed state.
    const keep = new Set(rows.map((r) => r.source_id));
    const gone = (store.db.query('SELECT source_id FROM events').all() as { source_id: string }[])
      .map((r) => r.source_id)
      .filter((k) => !keep.has(k));
    const stats: RunStats = {};
    addStats(stats, 'events', store.upsert(EVENTS_TABLE, rows));
    const removed = store.deleteKeys(EVENTS_TABLE, gone);
    log(`${rows.length.toLocaleString()} tasks and projects from ${files.length} OmniFocus transactions${removed ? `, ${removed} deleted removed` : ''}`);
    return stats;
  },
};
