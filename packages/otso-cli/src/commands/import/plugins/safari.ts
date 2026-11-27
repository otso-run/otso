import type { SourcePlugin } from './types.js';

/**
 * Safari Plugin
 *
 * Safari stores browsing history in a SQLite database.
 * Requires Full Disk Access permission on macOS.
 */
export const safariPlugin: SourcePlugin = {
  id: 'safari',
  displayName: 'Safari',
  description: 'Browser history and bookmarks',
  extractionType: 'automated',
  category: 'browse',

  localPaths: [
    {
      path: '~/Library/Safari/History.db',
      platform: 'darwin',
      description: 'Safari history database',
    },
  ],

  steps: [
    {
      id: 'detect',
      type: 'copy',
      title: 'Copy Safari History',
      description: 'Automatically detect and copy your Safari browsing history.',
      sourcePath: '~/Library/Safari/History.db',
    },
  ],
};
