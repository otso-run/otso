import type { SourcePlugin } from './types.js';

/**
 * Are.na Plugin
 *
 * Are.na uses OAuth2 for API access. Users need to:
 * 1. Create an application at https://dev.are.na/oauth/applications
 * 2. Get a personal access token
 * 3. We use the token to fetch their channels and blocks
 */
export const arenaPlugin: SourcePlugin = {
  id: 'arena',
  displayName: 'Are.na',
  description: 'Visual bookmarking and idea organization',
  extractionType: 'api',
  category: 'curation',

  urls: {
    settings: 'https://dev.are.na/oauth/applications',
    docs: 'https://dev.are.na/documentation',
    apiDocs: 'https://dev.are.na/documentation/channels',
  },

  credentialsFile: 'arena-credentials.json',

  steps: [
    {
      id: 'intro',
      type: 'instruction',
      title: 'Are.na API Setup',
      description: 'To export your Are.na data, you need to create an API application.',
      content: [
        'Are.na requires you to register an application to access your data.',
        'This is a one-time setup that takes about 2 minutes.',
        '',
        'You will need to:',
        '  1. Create a new application on Are.na',
        '  2. Copy your Personal Access Token',
        '  3. Paste it here for Otso to use',
      ],
      tip: 'Your token is stored locally and never sent anywhere except Are.na\'s API.',
    },
    {
      id: 'create-app',
      type: 'open_url',
      title: 'Create Application',
      description: 'Open Are.na developer portal to create a new application.',
      url: 'https://dev.are.na/oauth/applications/new',
      buttonText: 'Open Are.na Developer Portal',
    },
    {
      id: 'fill-form',
      type: 'instruction',
      title: 'Fill Application Form',
      description: 'Complete the application registration form.',
      content: [
        'Fill in the following details:',
        '',
        '  Name:         Otso',
        '  Redirect URI: http://localhost:9999/callback',
        '  Website:      https://github.com/yourusername/otso',
        '  Description:  Personal data archive tool',
        '',
        'Then click "Create" to register your application.',
      ],
      note: 'The Redirect URI must be exactly: http://localhost:9999/callback',
    },
    {
      id: 'get-token',
      type: 'instruction',
      title: 'Get Access Token',
      description: 'Find your Personal Access Token.',
      content: [
        'After creating your application, you will see:',
        '',
        '  • Application ID',
        '  • Application Secret',
        '  • Personal Access Token  ← This is what you need!',
        '',
        'Copy the Personal Access Token (it starts with a long string of letters and numbers).',
      ],
      tip: 'The Personal Access Token gives read access to your own channels and blocks.',
    },
    {
      id: 'enter-token',
      type: 'form',
      title: 'Enter Your Token',
      description: 'Paste your Are.na Personal Access Token.',
      fields: [
        {
          name: 'accessToken',
          label: 'Personal Access Token',
          type: 'secret',
          required: true,
          placeholder: 'Paste your token here...',
          helpText: 'Found on your application page after "Personal Access Token"',
        },
      ],
      submitText: 'Save & Test Connection',
    },
  ],

  validateCredentials: (data) => {
    const token = data.accessToken;
    if (!token) {
      return { valid: false, error: 'Access token is required' };
    }
    if (token.length < 20) {
      return { valid: false, error: 'Token appears too short. Please check and try again.' };
    }
    return { valid: true };
  },
};
