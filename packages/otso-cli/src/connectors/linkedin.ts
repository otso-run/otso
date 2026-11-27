import type { TableDef } from '../core/chronicle.js';
import { parseCsv } from '../core/archive.js';
import { iso } from '../core/time.js';
import type { Connector, RunStats } from './types.js';
import { addStats, shortHash } from './util.js';

/**
 * LinkedIn messages from the "Get a copy of your data" archive. The table
 * mirrors messages.csv (FROM, CONTENT, DATE, ...) plus a stable otso_key.
 */

export const LINKEDIN_MESSAGES: TableDef = {
  name: 'messages',
  key: 'otso_key',
  columns: ['otso_key', 'CONVERSATION ID', 'CONVERSATION TITLE', 'FROM', 'TO', 'DATE', 'SUBJECT', 'CONTENT', 'FOLDER'],
};

/** "2024-01-15 10:30:00 UTC" -> ISO */
export function linkedinDate(s: string): string | null {
  return iso(s.replace(' UTC', 'Z').replace(' ', 'T'));
}

export const linkedin: Connector = {
  id: 'linkedin',
  displayName: 'LinkedIn',
  description: 'Messages',
  kind: 'export',
  dbPath: 'linkedin/chronicle/chronicle.db',
  tables: [LINKEDIN_MESSAGES],

  exportGuide: {
    url: 'https://www.linkedin.com/mypreferences/d/download-my-data',
    steps: [
      'Choose "Download larger data archive" (or tick Messages only)',
      'Click "Request archive" and confirm your password',
      'Download the zip from the email LinkedIn sends',
    ],
    filePatterns: ['Basic_LinkedInDataExport*.zip', 'Complete_LinkedInDataExport*.zip'],
    wait: '10 minutes to 24 hours',
  },

  async ingest({ store, log }, archive) {
    const file = archive.find(/(^|\/)messages\.csv$/i)[0];
    if (!file) throw new Error('messages.csv not found in the LinkedIn export');
    const rows = parseCsv(await archive.readText(file)).map((r) => ({
      ...r,
      otso_key: shortHash(r['CONVERSATION ID'], r['DATE'], r['FROM'], r['CONTENT']),
      DATE: linkedinDate(r['DATE'] ?? '') ?? r['DATE'],
    }));
    const stats: RunStats = {};
    addStats(stats, 'messages', store.upsert(LINKEDIN_MESSAGES, rows));
    log(`${rows.length} messages`);
    return stats;
  },
};
