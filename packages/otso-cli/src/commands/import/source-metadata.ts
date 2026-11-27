import type { SourceMeta } from '../../types/index.js';
import { CONNECTORS } from '../../connectors/index.js';

/**
 * Complete metadata for all supported data sources.
 * Organized by extraction complexity.
 */
export const SOURCE_METADATA: Record<string, SourceMeta> = {
  // ═══════════════════════════════════════════════════════════════
  // EASY - Automated Local Extraction (macOS)
  // ═══════════════════════════════════════════════════════════════

  safari: {
    name: 'safari',
    displayName: 'Safari',
    description: 'Browser history and bookmarks',
    category: 'browse',
    complexity: 'easy',
    extractionType: 'automated',
    localPaths: [
      {
        path: '~/Library/Safari/History.db',
        platform: 'darwin',
        description: 'Safari history database',
      },
    ],
  },

  'apple-notes': {
    name: 'apple-notes',
    displayName: 'Apple Notes',
    description: 'Notes from the Notes app',
    category: 'notes',
    complexity: 'easy',
    extractionType: 'automated',
    localPaths: [
      {
        path: '~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite',
        platform: 'darwin',
        description: 'Apple Notes database',
      },
    ],
  },

  'apple-photos': {
    name: 'apple-photos',
    displayName: 'Apple Photos',
    description: 'Photo library metadata and locations',
    category: 'photos',
    complexity: 'easy',
    extractionType: 'automated',
    localPaths: [
      {
        path: '~/Pictures/Photos Library.photoslibrary/database/Photos.sqlite',
        platform: 'darwin',
        description: 'Photos library database',
      },
    ],
  },

  imessage: {
    name: 'imessage',
    displayName: 'iMessage',
    description: 'Message history from Messages app',
    category: 'comms',
    complexity: 'easy',
    extractionType: 'automated',
    localPaths: [
      {
        path: '~/Library/Messages/chat.db',
        platform: 'darwin',
        description: 'iMessage database',
      },
    ],
  },

  things: {
    name: 'things',
    displayName: 'Things 3',
    description: 'Tasks and projects',
    category: 'productivity',
    complexity: 'easy',
    extractionType: 'automated',
    localPaths: [
      {
        path: '~/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/Things Database.thingsdatabase/main.sqlite',
        platform: 'darwin',
        description: 'Things database',
      },
    ],
  },

  timing: {
    name: 'timing',
    displayName: 'Timing',
    description: 'Time tracking data',
    category: 'productivity',
    complexity: 'easy',
    extractionType: 'automated',
    localPaths: [
      {
        path: '~/Library/Application Support/info.eurocomp.Timing2/Timing.sqlite',
        platform: 'darwin',
        description: 'Timing database',
      },
    ],
  },

  'apple-podcasts': {
    name: 'apple-podcasts',
    displayName: 'Apple Podcasts',
    description: 'Podcast listening history',
    category: 'music',
    complexity: 'easy',
    extractionType: 'automated',
    localPaths: [
      {
        path: '~/Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Documents/MTLibrary.sqlite',
        platform: 'darwin',
        description: 'Podcasts database',
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // MEDIUM - Export Required
  // ═══════════════════════════════════════════════════════════════

  spotify: {
    name: 'spotify',
    displayName: 'Spotify',
    description: 'Extended streaming history',
    category: 'music',
    complexity: 'medium',
    extractionType: 'export',
    settingsUrl: 'https://www.spotify.com/account/privacy/',
    expectedFilePatterns: ['spotify_extended_*.zip', 'my_spotify_data*.zip'],
    exportInstructions: [
      {
        step: 1,
        title: 'Open Privacy Settings',
        description: 'Navigate to your Spotify account privacy settings',
        action: { type: 'open_url', url: 'https://www.spotify.com/account/privacy/' },
      },
      {
        step: 2,
        title: 'Request Extended History',
        description: 'Scroll to "Download your data" and select "Extended streaming history"',
      },
      {
        step: 3,
        title: 'Wait for Email',
        description: 'Spotify will email you when your data is ready (5-30 days)',
        action: { type: 'wait_for_file', patterns: ['spotify_extended_*.zip'] },
      },
      {
        step: 4,
        title: 'Download & Extract',
        description: 'Download the ZIP file - we will process it automatically',
      },
    ],
  },

  pinboard: {
    name: 'pinboard',
    displayName: 'Pinboard',
    description: 'Bookmarks from Pinboard',
    category: 'reading',
    complexity: 'medium',
    extractionType: 'api',
    settingsUrl: 'https://pinboard.in/export/',
    expectedFilePatterns: ['pinboard_export*.json', 'pinboard*.json'],
    exportInstructions: [
      {
        step: 1,
        title: 'Open Export Page',
        description: 'Go to Pinboard export page',
        action: { type: 'open_url', url: 'https://pinboard.in/export/' },
      },
      {
        step: 2,
        title: 'Download JSON',
        description: 'Click "JSON" to download your bookmarks',
      },
    ],
  },

  readwise: {
    name: 'readwise',
    displayName: 'Readwise',
    description: 'Highlights and annotations',
    category: 'reading',
    complexity: 'medium',
    extractionType: 'api',
    settingsUrl: 'https://readwise.io/export',
    expectedFilePatterns: ['readwise-data*.csv', 'readwise*.json'],
    exportInstructions: [
      {
        step: 1,
        title: 'Open Export Page',
        description: 'Navigate to Readwise export settings',
        action: { type: 'open_url', url: 'https://readwise.io/export' },
      },
      {
        step: 2,
        title: 'Export All Data',
        description: 'Click "Export all data" and select CSV or JSON format',
      },
    ],
  },

  lastfm: {
    name: 'lastfm',
    displayName: 'Last.fm',
    description: 'Scrobble history',
    category: 'music',
    complexity: 'medium',
    extractionType: 'api',
    settingsUrl: 'https://benjaminbenben.com/lastfm-to-csv/',
    expectedFilePatterns: ['lastfm*.csv', 'scrobbles*.csv'],
    exportInstructions: [
      {
        step: 1,
        title: 'Use Third-Party Exporter',
        description: 'Last.fm does not provide native export. Use the lastfm-to-csv tool.',
        action: { type: 'open_url', url: 'https://benjaminbenben.com/lastfm-to-csv/' },
      },
      {
        step: 2,
        title: 'Enter Username',
        description: 'Enter your Last.fm username and click Export',
      },
      {
        step: 3,
        title: 'Download CSV',
        description: 'Download the generated CSV file',
      },
    ],
  },

  github: {
    name: 'github',
    displayName: 'GitHub',
    description: 'Activity, stars, and repositories',
    category: 'code',
    complexity: 'medium',
    extractionType: 'api',
    settingsUrl: 'https://github.com/settings/admin',
    expectedFilePatterns: ['github-*.tar.gz', 'github-*.zip'],
    exportInstructions: [
      {
        step: 1,
        title: 'Request Archive',
        description: 'Go to GitHub Settings > Account > Export account data',
        action: { type: 'open_url', url: 'https://github.com/settings/admin' },
      },
      {
        step: 2,
        title: 'Start Export',
        description: 'Click "Start export" and wait for email notification',
      },
    ],
  },

  notion: {
    name: 'notion',
    displayName: 'Notion',
    description: 'Pages and databases',
    category: 'notes',
    complexity: 'medium',
    extractionType: 'export',
    settingsUrl: 'https://www.notion.so/',
    expectedFilePatterns: ['Export-*.zip', 'notion-*.zip'],
    exportInstructions: [
      {
        step: 1,
        title: 'Open Settings',
        description: 'Go to Settings & Members > Settings',
        action: { type: 'open_url', url: 'https://www.notion.so/' },
      },
      {
        step: 2,
        title: 'Export All Content',
        description: 'Scroll to "Export all workspace content" and click Export',
      },
    ],
  },

  arena: {
    name: 'arena',
    displayName: 'Are.na',
    description: 'Channels and blocks',
    category: 'curation',
    complexity: 'medium',
    extractionType: 'api',
    settingsUrl: 'https://www.are.na/developers/personal-access-tokens',
    exportInstructions: [
      {
        step: 1,
        title: 'Get API Token',
        description: 'Create a personal access token on are.na',
        action: { type: 'open_url', url: 'https://www.are.na/developers/personal-access-tokens' },
      },
      {
        step: 2,
        title: 'Enter Token',
        description: 'Paste your access token when prompted',
      },
    ],
  },

  claude: {
    name: 'claude',
    displayName: 'Claude',
    description: 'Conversation history',
    category: 'ai',
    complexity: 'medium',
    extractionType: 'export',
    settingsUrl: 'https://claude.ai/settings',
    expectedFilePatterns: ['claude_conversations*.json', 'claude*.json'],
    exportInstructions: [
      {
        step: 1,
        title: 'Open Settings',
        description: 'Go to Claude settings',
        action: { type: 'open_url', url: 'https://claude.ai/settings' },
      },
      {
        step: 2,
        title: 'Export Data',
        description: 'Click "Export data" and download your conversations',
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // COMPLEX - Takeout / Archive Required
  // ═══════════════════════════════════════════════════════════════

  'google-takeout': {
    name: 'google-takeout',
    displayName: 'Google Takeout',
    description: 'Chrome, YouTube, Search, Calendar',
    category: 'browse',
    complexity: 'complex',
    extractionType: 'takeout',
    settingsUrl: 'https://takeout.google.com/',
    expectedFilePatterns: ['takeout-*.zip', 'takeout-*.tgz'],
    exportInstructions: [
      {
        step: 1,
        title: 'Open Google Takeout',
        description: 'Go to Google Takeout to export your data',
        action: { type: 'open_url', url: 'https://takeout.google.com/' },
      },
      {
        step: 2,
        title: 'Deselect All',
        description: 'Click "Deselect all" to start fresh',
      },
      {
        step: 3,
        title: 'Select Services',
        description: 'Select: Chrome, YouTube, My Activity (for Search), Calendar',
      },
      {
        step: 4,
        title: 'Choose Format',
        description: 'Select JSON format where available, then click "Next step"',
      },
      {
        step: 5,
        title: 'Create Export',
        description: 'Choose "Export once" and your preferred delivery method',
      },
      {
        step: 6,
        title: 'Wait & Download',
        description: 'Google will email you when the export is ready (hours to days)',
      },
    ],
  },

  twitter: {
    name: 'twitter',
    displayName: 'Twitter/X Archive',
    description: 'Tweets, likes, and DMs',
    category: 'social',
    complexity: 'complex',
    extractionType: 'takeout',
    settingsUrl: 'https://twitter.com/settings/download_your_data',
    expectedFilePatterns: ['twitter-*.zip', 'archive*.zip'],
    exportInstructions: [
      {
        step: 1,
        title: 'Open Settings',
        description: 'Go to Twitter/X data download settings',
        action: { type: 'open_url', url: 'https://twitter.com/settings/download_your_data' },
      },
      {
        step: 2,
        title: 'Request Archive',
        description: 'Click "Request archive" and verify your identity',
      },
      {
        step: 3,
        title: 'Wait for Email',
        description: 'Twitter will email you when ready (24-48 hours typically)',
      },
    ],
  },

  linkedin: {
    name: 'linkedin',
    displayName: 'LinkedIn',
    description: 'Connections, messages, and activity',
    category: 'comms',
    complexity: 'complex',
    extractionType: 'takeout',
    settingsUrl: 'https://www.linkedin.com/mypreferences/d/download-my-data',
    expectedFilePatterns: ['Basic_LinkedInDataExport*.zip', 'Complete_LinkedInDataExport*.zip'],
    exportInstructions: [
      {
        step: 1,
        title: 'Open Data Export',
        description: 'Go to LinkedIn data export settings',
        action: { type: 'open_url', url: 'https://www.linkedin.com/mypreferences/d/download-my-data' },
      },
      {
        step: 2,
        title: 'Request Archive',
        description: 'Select data to include and click "Request archive"',
      },
      {
        step: 3,
        title: 'Wait for Email',
        description: 'LinkedIn will email you when ready (up to 24 hours)',
      },
    ],
  },

  foursquare: {
    name: 'foursquare',
    displayName: 'Foursquare/Swarm',
    description: 'Check-in history',
    category: 'location',
    complexity: 'complex',
    extractionType: 'takeout',
    settingsUrl: 'https://foursquare.com/settings',
    expectedFilePatterns: ['foursquare*.json', 'checkins*.json'],
    exportInstructions: [
      {
        step: 1,
        title: 'Open Settings',
        description: 'Go to Foursquare privacy settings',
        action: { type: 'open_url', url: 'https://foursquare.com/settings' },
      },
      {
        step: 2,
        title: 'Request Data',
        description: 'Look for "Export your data" option',
      },
    ],
  },
};

// Connectors are the source of truth for export file names and pages, so
// the Downloads watcher looks for what the service actually sends.
for (const c of CONNECTORS) {
  const meta = SOURCE_METADATA[c.id];
  if (!meta) continue;
  if (c.exportGuide && meta.extractionType !== 'api') {
    meta.expectedFilePatterns = c.exportGuide.filePatterns;
    meta.settingsUrl = c.exportGuide.url;
  }
  if (c.auth) meta.settingsUrl = c.auth.setupUrl;
  if (c.localPaths) {
    meta.localPaths = c.localPaths.map((path) => ({ path, platform: 'darwin' as const, description: `${c.displayName} database` }));
  }
}

/**
 * Get sources grouped by complexity
 */
export function getSourcesByComplexity(): {
  easy: SourceMeta[];
  medium: SourceMeta[];
  complex: SourceMeta[];
} {
  const sources = Object.values(SOURCE_METADATA);
  return {
    easy: sources.filter((s) => s.complexity === 'easy'),
    medium: sources.filter((s) => s.complexity === 'medium'),
    complex: sources.filter((s) => s.complexity === 'complex'),
  };
}

/**
 * Get sources grouped by category
 */
export function getSourcesByCategory(): Record<string, SourceMeta[]> {
  const result: Record<string, SourceMeta[]> = {};
  for (const source of Object.values(SOURCE_METADATA)) {
    if (!result[source.category]) {
      result[source.category] = [];
    }
    result[source.category].push(source);
  }
  return result;
}

/**
 * Get a single source by name
 */
export function getSourceMeta(name: string): SourceMeta | undefined {
  return SOURCE_METADATA[name];
}
