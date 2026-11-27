import type { SourcePlugin } from './types.js';

/**
 * Spotify Plugin
 *
 * Spotify requires requesting a data export through their privacy settings.
 * The extended streaming history can take 5-30 days to prepare.
 */
export const spotifyPlugin: SourcePlugin = {
  id: 'spotify',
  displayName: 'Spotify',
  description: 'Extended streaming history',
  extractionType: 'export',
  category: 'music',

  urls: {
    settings: 'https://www.spotify.com/account/privacy/',
  },

  expectedFiles: [
    'my_spotify_data.zip',
    'spotify_extended_*.zip',
    'Spotify Extended Streaming History*.zip',
  ],

  steps: [
    {
      id: 'intro',
      type: 'instruction',
      title: 'Spotify Data Export',
      description: 'Request your extended streaming history from Spotify.',
      content: [
        'Spotify offers two types of data exports:',
        '',
        '  • Account Data (instant) - Basic account info only',
        '  • Extended Streaming History - Full listening history',
        '',
        'We recommend the Extended Streaming History for complete data.',
      ],
      note: 'Extended history can take 5-30 days for Spotify to prepare.',
    },
    {
      id: 'open-privacy',
      type: 'open_url',
      title: 'Open Privacy Settings',
      description: 'Go to Spotify\'s privacy settings page.',
      url: 'https://www.spotify.com/account/privacy/',
      buttonText: 'Open Spotify Privacy Settings',
    },
    {
      id: 'request-data',
      type: 'instruction',
      title: 'Request Your Data',
      description: 'Scroll down and request your extended streaming history.',
      content: [
        '1. Log in to your Spotify account if needed',
        '2. Scroll down to "Download your data"',
        '3. Check "Extended streaming history"',
        '4. Click "Request data"',
        '5. Confirm via the email Spotify sends you',
      ],
      tip: 'You\'ll receive an email when your data is ready to download.',
    },
    {
      id: 'wait-or-upload',
      type: 'instruction',
      title: 'Already Have the File?',
      description: 'If you\'ve already downloaded your Spotify data, you can import it now.',
      content: [
        'If you already have your Spotify export:',
        '  Press B to browse and select the ZIP file',
        '',
        'If you just requested it:',
        '  Press S to skip for now. Come back when you receive',
        '  the download email from Spotify.',
      ],
    },
    {
      id: 'watch',
      type: 'watch',
      title: 'Watching for Download',
      description: 'Waiting for Spotify export file in Downloads folder.',
      patterns: [
        'my_spotify_data.zip',
        'spotify_extended_*.zip',
        'Spotify Extended Streaming History*.zip',
      ],
    },
  ],
};
