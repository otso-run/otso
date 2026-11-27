import { stat } from 'node:fs/promises';
import { openArchive, type Archive } from '../core/archive.js';
import type { TableDef } from '../core/chronicle.js';
import type { Connector, RunContext, RunStats } from './types.js';
import { addStats } from './util.js';

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

const TABLES = [CLAUDE_CONVERSATIONS, CLAUDE_PROJECTS, CLAUDE_PROJECT_DOCS, CLAUDE_MEMORIES, CLAUDE_DESIGN_CHATS];

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

/** The newest file time in the archive: a stable stand-in for "exported at". */
async function exportDate(archive: Archive): Promise<string> {
  let newest = 0;
  for (const f of archive.files) newest = Math.max(newest, (await stat(archive.abs(f))).mtimeMs);
  return new Date(newest || Date.now()).toISOString();
}

async function ingestOne(ctx: RunContext, archive: Archive, stats: RunStats, projectNames: Map<string, string>) {
  const { store, log } = ctx;
  let matched = false;

  // Projects first, so memories and design chats can name their project.
  const projects = await readMany(archive, /(^|\/)projects\.json$/, /(^|\/)projects\/[^/]+\.json$/);
  if (projects.length) {
    matched = true;
    const { projects: p, docs } = projectRows(projects);
    for (const row of p) if (row.name) projectNames.set(row.uuid, row.name);
    addStats(stats, 'projects', store.upsert(CLAUDE_PROJECTS, p));
    addStats(stats, 'project_docs', store.upsert(CLAUDE_PROJECT_DOCS, docs));
    log(`${p.length} projects, ${docs.length} project docs`);
  }

  const conversations = await readMany(archive, /(^|\/)conversations\.json$/, /(^|\/)conversations\/[^/]+\.json$/);
  if (conversations.length) {
    matched = true;
    const rows = claudeRows(conversations);
    addStats(stats, 'conversations', store.upsert(CLAUDE_CONVERSATIONS, rows));
    log(`${rows.length} conversations`);
  }

  const memoryFiles = archive.find(/(^|\/)memories\.json$/);
  if (memoryFiles.length) {
    matched = true;
    const exportedAt = await exportDate(archive);
    const rows = [];
    for (const f of memoryFiles) rows.push(...memoryRows(await archive.readJson(f), exportedAt, projectNames));
    addStats(stats, 'memories', store.upsert(CLAUDE_MEMORIES, rows));
    log(`${rows.length} memories`);
  }

  const designChats = await readMany(archive, /(^|\/)design_chats\.json$/, /(^|\/)design_chats\/[^/]+\.json$/);
  if (designChats.length) {
    matched = true;
    const rows = designChatRows(designChats);
    addStats(stats, 'design_chats', store.upsert(CLAUDE_DESIGN_CHATS, rows));
    log(`${rows.length} design chats`);
  }

  return matched;
}

export const claude: Connector = {
  id: 'claude',
  displayName: 'Claude',
  description: 'Conversations, projects, memory and design chats',
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
    const projectNames = new Map<string, string>();
    for (const t of TABLES) ctx.store.ensureTable(t);
    // Names of projects ingested earlier, for memories that arrive in their own zip.
    for (const r of ctx.store.db.query('SELECT uuid, name FROM projects WHERE name IS NOT NULL').all() as any[]) {
      projectNames.set(r.uuid, r.name);
    }

    let matched = await ingestOne(ctx, archive, stats, projectNames);

    // A folder of split-export zips: open each one in turn.
    for (const zip of archive.find(/\.zip$/i)) {
      const inner = await openArchive(archive.abs(zip));
      try {
        ctx.log(`Reading ${zip}`);
        if (await ingestOne(ctx, inner, stats, projectNames)) matched = true;
        else ctx.log(`  nothing otso reads in ${zip}`);
      } finally {
        await inner.dispose();
      }
    }

    if (!matched) {
      ctx.log('No Claude conversations, projects, memories or design chats in this file');
    }
    return stats;
  },
};
