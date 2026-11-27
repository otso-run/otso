import type { TableDef } from '../core/chronicle.js';
import type { Connector, RunStats } from './types.js';
import { addStats } from './util.js';

/**
 * Claude conversations from the data export (Settings > Privacy > Export
 * data). The zip holds conversations.json; each conversation becomes one
 * row. `summary` falls back to the opening of the conversation so search has
 * something to match, and the full text is kept in `transcript`.
 */

export const CLAUDE_CONVERSATIONS: TableDef = {
  name: 'conversations',
  key: 'uuid',
  columns: ['uuid', 'name', 'summary', 'created_at', 'updated_at', 'message_count', 'transcript'],
};

function messageText(m: any): string {
  if (typeof m.text === 'string' && m.text) return m.text;
  return (m.content ?? [])
    .map((c: any) => (c.type === 'text' ? c.text : ''))
    .filter(Boolean)
    .join('\n');
}

export function claudeRows(conversations: any[]) {
  return conversations.map((c) => {
    const messages: any[] = c.chat_messages ?? [];
    const transcript = messages
      .map((m) => `${m.sender === 'human' ? 'Me' : 'Claude'}: ${messageText(m)}`)
      .join('\n\n');
    const opening = messages.find((m) => m.sender === 'human');
    return {
      uuid: c.uuid,
      name: c.name || null,
      summary: c.summary || (opening ? messageText(opening).slice(0, 2000) : ''),
      created_at: c.created_at,
      updated_at: c.updated_at,
      message_count: messages.length,
      transcript,
    };
  });
}

export const claude: Connector = {
  id: 'claude',
  displayName: 'Claude',
  description: 'Conversation history',
  kind: 'export',
  dbPath: 'claude/chronicle/chronicle.db',
  tables: [CLAUDE_CONVERSATIONS],

  exportGuide: {
    url: 'https://claude.ai/settings/data-privacy-controls',
    steps: ['Open Settings > Privacy', 'Click "Export data"', 'Download the zip from the email link'],
    filePatterns: ['data-*.zip', 'claude*.zip', 'conversations.json'],
    wait: 'a few minutes',
  },

  async ingest({ store, log }, archive) {
    const file = archive.find(/(^|\/)conversations\.json$/)[0];
    if (!file) throw new Error('conversations.json not found in the export');
    const rows = claudeRows(await archive.readJson(file));
    const stats: RunStats = {};
    addStats(stats, 'conversations', store.upsert(CLAUDE_CONVERSATIONS, rows));
    log(`${rows.length} conversations`);
    return stats;
  },
};
