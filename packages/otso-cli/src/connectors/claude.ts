import { stat } from 'node:fs/promises';
import { openArchive, type Archive } from '../core/archive.js';
import type { TableDef } from '../core/chronicle.js';
import type { Connector, RunContext, RunStats } from './types.js';
import { addStats, htmlToText } from './util.js';

/**
 * Claude data export (Settings > Privacy > Export data).
 *
 * Older exports arrive as one zip holding conversations.json, projects/,
 * memories.json and design_chats/. Newer ones are split by category into
 * several zips (conversations-000.zip, projects-000.zip, ...) listed in a
 * manifest. Either shape works: pass every zip, the folder they sit in, or
 * an extracted folder. Each part is recognised by its file names, so the
 * zips can be ingested in any order and any number of times.
 */

export const CLAUDE_CONVERSATIONS: TableDef = {
  name: 'conversations',
  key: 'uuid',
  columns: ['uuid', 'name', 'summary', 'created_at', 'updated_at', 'message_count', 'transcript'],
};

export const CLAUDE_PROJECTS: TableDef = {
  name: 'projects',
  key: 'uuid',
  columns: ['uuid', 'name', 'description', 'prompt_template', 'is_private', 'created_at', 'updated_at', 'doc_count'],
};

export const CLAUDE_PROJECT_DOCS: TableDef = {
  name: 'project_docs',
  key: 'uuid',
  columns: ['uuid', 'project_uuid', 'project_name', 'filename', 'content', 'created_at'],
};

/** Claude's memory: one row for chat-wide memory, one per project. */
export const CLAUDE_MEMORIES: TableDef = {
  name: 'memories',
  key: 'id',
  columns: ['id', 'scope', 'project_uuid', 'project_name', 'content', 'exported_at'],
};

export const CLAUDE_DESIGN_CHATS: TableDef = {
  name: 'design_chats',
  key: 'uuid',
  columns: ['uuid', 'title', 'project_uuid', 'project_name', 'summary', 'created_at', 'updated_at', 'message_count', 'transcript'],
};

/** Files in Claude's memory folder, chat-wide or per Claude Code project. */
export const CLAUDE_MEMORY_FILES: TableDef = {
  name: 'memory_files',
  key: 'id',
  columns: ['id', 'scope', 'project_name', 'path', 'content', 'created_at', 'updated_at'],
};

/** Published artifacts and docs ("frames" in the export). */
export const CLAUDE_ARTIFACTS: TableDef = {
  name: 'artifacts',
  key: 'id',
  columns: ['id', 'kind', 'title', 'visibility', 'version_count', 'content', 'created_at', 'updated_at'],
};

/** Periodic reflections Claude wrote about how you used it. */
export const CLAUDE_REFLECTIONS: TableDef = {
  name: 'reflections',
  key: 'id',
  columns: ['id', 'period', 'title', 'content', 'created_at', 'updated_at'],
};

/** Scheduled Claude Code routines. */
export const CLAUDE_ROUTINES: TableDef = {
  name: 'routines',
  key: 'routine_id',
  columns: ['routine_id', 'name', 'prompt', 'schedule', 'enabled', 'created_at', 'updated_at', 'ended_at'],
};

/** Claude Code project threads: one row per thread, messages joined. */
export const CLAUDE_THREADS: TableDef = {
  name: 'threads',
  key: 'thread_id',
  columns: ['thread_id', 'channel_id', 'channel_name', 'title', 'summary', 'message_count', 'transcript', 'created_at', 'updated_at'],
};

const TABLES = [
  CLAUDE_CONVERSATIONS,
  CLAUDE_PROJECTS,
  CLAUDE_PROJECT_DOCS,
  CLAUDE_MEMORIES,
  CLAUDE_MEMORY_FILES,
  CLAUDE_DESIGN_CHATS,
  CLAUDE_ARTIFACTS,
  CLAUDE_REFLECTIONS,
  CLAUDE_ROUTINES,
  CLAUDE_THREADS,
];

/** Long text is cut here so one huge item doesn't swamp search. */
const MAX_CONTENT = 20000;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function blockText(b: any): string {
  if (!b || typeof b !== 'object') return typeof b === 'string' ? b : '';
  if (b.type === 'text' && typeof b.text === 'string') return b.text;
  return '';
}

function messageText(m: any): string {
  if (typeof m.text === 'string' && m.text) return m.text;
  const content = m.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(blockText).filter(Boolean).join('\n');
  // Design chats nest the message: { role, content: "...", contentBlocks: [...] }
  if (content && typeof content === 'object') {
    if (typeof content.content === 'string' && content.content) return content.content;
    if (Array.isArray(content.content)) return content.content.map(blockText).filter(Boolean).join('\n');
    if (Array.isArray(content.contentBlocks)) return content.contentBlocks.map(blockText).filter(Boolean).join('\n');
  }
  return '';
}

function isHuman(m: any): boolean {
  const who = m.sender ?? m.role ?? m.content?.role;
  return who === 'human' || who === 'user';
}

function transcriptOf(messages: any[]) {
  return messages
    .map((m) => `${isHuman(m) ? 'Me' : 'Claude'}: ${messageText(m)}`)
    .join('\n\n');
}

function openingOf(messages: any[]): string {
  const first = messages.find(isHuman);
  return first ? messageText(first).slice(0, 2000) : '';
}

// ---------------------------------------------------------------------------
// Row builders (exported for tests)
// ---------------------------------------------------------------------------

export function claudeRows(conversations: any[]) {
  return conversations.map((c) => {
    const messages: any[] = c.chat_messages ?? [];
    return {
      uuid: c.uuid,
      name: c.name || null,
      summary: c.summary || openingOf(messages),
      created_at: c.created_at,
      updated_at: c.updated_at,
      message_count: messages.length,
      transcript: transcriptOf(messages),
    };
  });
}

export function projectRows(projects: any[]) {
  const projectsOut = [];
  const docs = [];
  for (const p of projects) {
    if (!p?.uuid) continue;
    const pdocs: any[] = p.docs ?? [];
    projectsOut.push({
      uuid: p.uuid,
      name: p.name || null,
      description: p.description || '',
      prompt_template: p.prompt_template || '',
      is_private: p.is_private,
      created_at: p.created_at,
      updated_at: p.updated_at,
      doc_count: pdocs.length,
    });
    for (const d of pdocs) {
      if (!d?.uuid) continue;
      docs.push({
        uuid: d.uuid,
        project_uuid: p.uuid,
        project_name: p.name || null,
        filename: d.filename || null,
        content: d.content || '',
        created_at: d.created_at || p.created_at,
      });
    }
  }
  return { projects: projectsOut, docs };
}

/**
 * memories.json is a list (one per account) of
 * { conversations_memory, project_memories: { <project uuid>: text } }.
 * It carries no dates, so rows take the export's own date.
 */
export function memoryRows(entries: any[], exportedAt: string, projectNames: Map<string, string>) {
  const rows = [];
  for (const e of Array.isArray(entries) ? entries : [entries]) {
    if (!e) continue;
    const account = e.account_uuid ?? 'me';
    if (typeof e.conversations_memory === 'string' && e.conversations_memory.trim()) {
      rows.push({
        id: `${account}:conversations`,
        scope: 'conversations',
        project_uuid: null,
        project_name: null,
        content: e.conversations_memory,
        exported_at: exportedAt,
      });
    }
    for (const [uuid, text] of Object.entries(e.project_memories ?? {})) {
      if (typeof text !== 'string' || !text.trim()) continue;
      rows.push({
        id: `${account}:project:${uuid}`,
        scope: 'project',
        project_uuid: uuid,
        project_name: projectNames.get(uuid) ?? null,
        content: text,
        exported_at: exportedAt,
      });
    }
  }
  return rows;
}

/** The dated files inside memories/<account>.json (newer exports). */
export function memoryFileRows(entries: any[]) {
  const rows = [];
  for (const e of Array.isArray(entries) ? entries : [entries]) {
    const account = e?.account_uuid ?? 'me';
    for (const f of e?.memory_files ?? []) {
      if (!f?.path || typeof f.content !== 'string') continue;
      rows.push({
        id: `${account}:memory:${f.path}`,
        scope: 'conversations',
        project_name: null,
        path: f.path,
        content: f.content,
        created_at: f.created_at ?? f.updated_at,
        updated_at: f.updated_at,
      });
    }
  }
  return rows;
}

/** claude_code_cloud/channel_memory_files.json: memory kept per project. */
export function channelMemoryFileRows(files: any[]) {
  return files
    .filter((f) => f?.path && typeof f.content === 'string')
    .map((f) => ({
      id: `${f.account_uuid ?? 'me'}:channel:${f.channel}:${f.memory ?? ''}:${f.path}`,
      scope: 'project',
      project_name: f.channel ?? null,
      path: f.path,
      content: f.content,
      created_at: f.created_at ?? f.updated_at,
      updated_at: f.updated_at,
    }));
}

/** feedback zip: reflections/<account>.json */
export function reflectionRows(entries: any[]) {
  const rows = [];
  for (const e of entries) {
    for (const r of e?.reflections ?? []) {
      const c = r.content ?? {};
      const parts: string[] = [];
      if (c.hero_body) parts.push(c.hero_body);
      for (const [key, items] of Object.entries(c)) {
        if (!Array.isArray(items) || key === 'stats') continue;
        for (const it of items as any[]) {
          const line = [it?.title, it?.body ?? it?.description].filter(Boolean).join(': ');
          if (line) parts.push(line);
        }
      }
      rows.push({
        id: `${e.account_uuid ?? 'me'}:${r.period}`,
        period: r.period,
        title: c.hero_title || `Reflection ${r.period}`,
        content: parts.join('\n\n').slice(0, MAX_CONTENT),
        created_at: r.created_at,
        updated_at: r.updated_at,
      });
    }
  }
  return rows;
}

export function routineRows(routines: any[]) {
  return routines
    .filter((r) => r?.routine_id)
    .map((r) => ({
      routine_id: r.routine_id,
      name: r.name || null,
      prompt: r.prompt_withheld ? '' : r.prompt || '',
      schedule: r.schedule ?? null,
      enabled: r.enabled,
      created_at: r.created_at,
      updated_at: r.updated_at,
      ended_at: r.ended_at ?? null,
    }));
}

/**
 * claude_code_cloud/channels/messages.json grouped into threads. Notices
 * (status cards) are left out; only messages with text count.
 */
export function threadRows(messages: any[], channels: any[]) {
  const channelNames = new Map<string, string>();
  for (const c of channels) if (c?.channel_id) channelNames.set(c.channel_id, c.content?.name ?? null);

  const byThread = new Map<string, any[]>();
  for (const m of messages) {
    if (typeof m?.text !== 'string' || !m.text.trim()) continue;
    const root = m.thread_root_message_id ?? m.message_id;
    if (!byThread.has(root)) byThread.set(root, []);
    byThread.get(root)!.push(m);
  }

  const rows = [];
  for (const [threadId, list] of byThread) {
    list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const first = list.find((m) => m.message_id === threadId) ?? list[0];
    const opener = list.find((m) => m.author_account_uuid) ?? first;
    const title = String(first.text).trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 120);
    rows.push({
      thread_id: threadId,
      channel_id: first.channel_id,
      channel_name: channelNames.get(first.channel_id) ?? null,
      title,
      summary: String(opener.text).slice(0, 2000),
      message_count: list.length,
      transcript: list
        .map((m) => `${m.author_account_uuid ? 'Me' : 'Claude'}: ${m.text}`)
        .join('\n\n')
        .slice(0, MAX_CONTENT),
      created_at: first.created_at,
      updated_at: list[list.length - 1].created_at,
    });
  }
  return rows;
}

function commentTexts(data: any): string[] {
  const threads = Array.isArray(data) ? data : data?.threads ?? [];
  const out: string[] = [];
  for (const t of threads) {
    if (t?.quoted_text) out.push(`> ${t.quoted_text}`);
    for (const c of t?.comments ?? []) if (typeof c?.text === 'string' && c.text.trim()) out.push(c.text);
  }
  return out;
}

/**
 * One row per artifact. The text is the doc's page.md, or else the active
 * version's own pages (slides, index.html, markdown), skipping the files
 * every artifact type ships with (artifact-type/, SKILL.md).
 */
async function artifactRows(archive: Archive) {
  const rows = [];
  for (const meta of archive.find(/(^|\/)artifacts\/[^/]+\/artifact\.json$/)) {
    const a = await archive.readJson(meta);
    const dir = meta.slice(0, -'artifact.json'.length);
    const versions: any[] = (a.versions ?? []).slice().sort((x: any, y: any) => String(x.created_at).localeCompare(String(y.created_at)));
    const active = versions.find((v) => v.id === a.active_version) ?? versions[versions.length - 1];

    let text = '';
    const page = `${dir}page.md`;
    if (archive.files.includes(page)) {
      text = await archive.readText(page);
    } else {
      // The active version's folder, or the newest one the export kept.
      const kept = versions.map((v) => v.id).reverse().filter((id) => archive.files.some((f) => f.startsWith(`${dir}versions/${id}/`)));
      const vid = kept.includes(a.active_version) ? a.active_version : kept[0];
      if (vid) {
        const base = `${dir}versions/${vid}/`;
        const own = archive.files
          .filter((f) => f.startsWith(base))
          .map((f) => f.slice(base.length))
          .filter((f) => !f.startsWith('artifact-type/') && f !== 'SKILL.md' && /\.(html?|md|txt)$/i.test(f))
          .sort();
        const parts: string[] = [];
        for (const f of own) {
          const raw = await archive.readText(base + f);
          parts.push(/\.html?$/i.test(f) ? htmlToText(raw) : raw);
          if (parts.join('\n').length > MAX_CONTENT) break;
        }
        text = parts.filter(Boolean).join('\n\n');
      }
    }

    const comments: string[] = [];
    for (const name of ['comments.json', 'artifact_comments.json']) {
      if (archive.files.includes(dir + name)) comments.push(...commentTexts(await archive.readJson(dir + name)));
    }
    if (comments.length) text += `\n\nComments:\n${comments.join('\n')}`;

    rows.push({
      id: a.id,
      kind: a.kind ?? null,
      title: active?.title || null,
      visibility: a.visibility ?? null,
      version_count: versions.length,
      content: text.trim().slice(0, MAX_CONTENT),
      created_at: versions[0]?.created_at ?? a.updated_at,
      updated_at: a.updated_at,
    });
  }
  return rows;
}

export function designChatRows(chats: any[]) {
  return chats
    .filter((c) => c?.uuid)
    .map((c) => {
      const messages: any[] = c.messages ?? [];
      return {
        uuid: c.uuid,
        title: c.title || null,
        project_uuid: c.project?.uuid ?? null,
        project_name: c.project?.name ?? null,
        summary: openingOf(messages),
        created_at: c.created_at,
        updated_at: c.updated_at,
        message_count: messages.length,
        transcript: transcriptOf(messages),
      };
    });
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

/** Read a top-level JSON array file, or every per-item JSON file in a folder. */
async function readMany(archive: Archive, single: RegExp, perItem: RegExp): Promise<any[]> {
  const out: any[] = [];
  for (const f of archive.find(single)) {
    const data = await archive.readJson(f);
    out.push(...(Array.isArray(data) ? data : [data]));
  }
  for (const f of archive.find(perItem)) out.push(await archive.readJson(f));
  return out;
}

/**
 * When the export was made. Memory has no dates of its own, so it takes this.
 * Order: a manifest.json beside the zips, the newest dated memory file, the
 * archive's file times (newer zips stamp everything 1980, so those are
 * ignored), and finally now.
 */
async function exportDate(archive: Archive, hint: string | null, entries: any[]): Promise<string> {
  if (hint) return hint;
  let newest = '';
  for (const e of entries) for (const f of e?.memory_files ?? []) if (f?.updated_at > newest) newest = f.updated_at;
  if (newest) return newest;
  let mtime = 0;
  for (const f of archive.files) mtime = Math.max(mtime, (await stat(archive.abs(f))).mtimeMs);
  return new Date(mtime > Date.UTC(2000, 0, 1) ? mtime : Date.now()).toISOString();
}

/** Newer exports wrap each list as { "claude_code_cloud": [...] }. */
async function cloudList(archive: Archive, name: RegExp): Promise<any[]> {
  const out: any[] = [];
  for (const f of archive.find(name)) {
    const data = await archive.readJson(f);
    out.push(...(Array.isArray(data) ? data : data?.claude_code_cloud ?? []));
  }
  return out;
}

interface IngestState {
  projectNames: Map<string, string>;
  exportedAt: string | null;
}

async function ingestOne(ctx: RunContext, archive: Archive, stats: RunStats, state: IngestState) {
  const { store, log } = ctx;
  let matched = false;
  const upsert = (def: TableDef, rows: any[], label: string) => {
    matched = true;
    addStats(stats, def.name, store.upsert(def, rows));
    log(`${rows.length} ${label}`);
  };

  // Projects first, so memories can name their project.
  const projects = await readMany(archive, /(^|\/)projects\.json$/, /(^|\/)projects\/[^/]+\.json$/);
  if (projects.length) {
    const { projects: p, docs } = projectRows(projects);
    for (const row of p) if (row.name) state.projectNames.set(row.uuid, row.name);
    upsert(CLAUDE_PROJECTS, p, 'projects');
    upsert(CLAUDE_PROJECT_DOCS, docs, 'project docs');
  }

  const conversations = await readMany(archive, /(^|\/)conversations\.json$/, /(^|\/)conversations\/[^/]+\.json$/);
  if (conversations.length) upsert(CLAUDE_CONVERSATIONS, claudeRows(conversations), 'conversations');

  // memories.json (older) or memories/<account>.json (newer).
  const memories = await readMany(archive, /(^|\/)memories\.json$/, /(^|\/)memories\/[^/]+\.json$/);
  if (memories.length) {
    const exportedAt = await exportDate(archive, state.exportedAt, memories);
    upsert(CLAUDE_MEMORIES, memoryRows(memories, exportedAt, state.projectNames), 'memories');
    const files = memoryFileRows(memories);
    if (files.length) upsert(CLAUDE_MEMORY_FILES, files, 'memory files');
  }

  const designChats = await readMany(archive, /(^|\/)design_chats\.json$/, /(^|\/)design_chats\/[^/]+\.json$/);
  if (designChats.length) upsert(CLAUDE_DESIGN_CHATS, designChatRows(designChats), 'design chats');

  const artifacts = await artifactRows(archive);
  if (artifacts.length) upsert(CLAUDE_ARTIFACTS, artifacts, 'artifacts');

  const reflections = await readMany(archive, /(^|\/)reflections\.json$/, /(^|\/)reflections\/[^/]+\.json$/);
  if (reflections.length) upsert(CLAUDE_REFLECTIONS, reflectionRows(reflections), 'reflections');

  // Claude Code in the cloud: routines, project threads, project memory.
  const routines = await cloudList(archive, /(^|\/)claude_code_cloud\/routines\.json$/);
  if (routines.length) upsert(CLAUDE_ROUTINES, routineRows(routines), 'routines');

  const messages = await cloudList(archive, /(^|\/)claude_code_cloud\/channels\/messages\.json$/);
  if (messages.length) {
    const channels = await cloudList(archive, /(^|\/)claude_code_cloud\/channels\/channels\.json$/);
    upsert(CLAUDE_THREADS, threadRows(messages, channels), 'project threads');
  }

  const channelMemory = await cloudList(archive, /(^|\/)claude_code_cloud\/channel_memory_files\.json$/);
  if (channelMemory.length) upsert(CLAUDE_MEMORY_FILES, channelMemoryFileRows(channelMemory), 'project memory files');

  return matched;
}

/** Split exports come with a manifest naming the export's creation time. */
async function manifestDate(archive: Archive): Promise<string | null> {
  for (const f of archive.find(/(^|\/)manifest[^/]*\.json$/)) {
    try {
      const m = await archive.readJson(f);
      if (typeof m?.created_at === 'string' && Array.isArray(m.data_files)) return m.created_at;
    } catch {
      // not a manifest
    }
  }
  return null;
}

export const claude: Connector = {
  id: 'claude',
  displayName: 'Claude',
  description: 'Conversations, projects, memory, artifacts and Claude Code threads',
  kind: 'export',
  dbPath: 'claude/chronicle/chronicle.db',
  tables: TABLES,

  exportGuide: {
    url: 'https://claude.ai/settings/data-privacy-controls',
    steps: [
      'Open Settings > Privacy',
      'Click "Export data"',
      'Download every file the email links to (newer exports come as several zips)',
      'Pass them all, or the folder holding them, to otso ingest claude',
    ],
    filePatterns: ['data-*.zip', 'claude*.zip', 'conversations*.zip', 'conversations.json'],
    wait: 'a few minutes',
  },

  async ingest(ctx, archive) {
    const stats: RunStats = {};
    const state: IngestState = { projectNames: new Map(), exportedAt: await manifestDate(archive) };
    for (const t of TABLES) ctx.store.ensureTable(t);
    // Names of projects ingested earlier, for memories that arrive in their own zip.
    for (const r of ctx.store.db.query('SELECT uuid, name FROM projects WHERE name IS NOT NULL').all() as any[]) {
      state.projectNames.set(r.uuid, r.name);
    }

    let matched = await ingestOne(ctx, archive, stats, state);

    // A folder of split-export zips: open each one in turn, projects first.
    const zips = archive.find(/\.zip$/i).sort((a, b) => Number(!/projects/.test(a)) - Number(!/projects/.test(b)));
    for (const zip of zips) {
      const inner = await openArchive(archive.abs(zip));
      try {
        ctx.log(`Reading ${zip}`);
        if (await ingestOne(ctx, inner, stats, state)) matched = true;
        else ctx.log(`  nothing otso reads in ${zip}`);
      } finally {
        await inner.dispose();
      }
    }

    if (!matched) ctx.log('Nothing otso reads in this file');
    return stats;
  },
};
