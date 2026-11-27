import type { SourcePlugin, PluginRegistry } from './types.js';
import { safariPlugin } from './safari.js';
import { CONNECTORS } from '../../../connectors/index.js';
import type { Connector } from '../../../connectors/types.js';

export * from './types.js';

/**
 * Guided TUI flows. Safari has a hand-written walkthrough; every
 * other connector with an API login gets one generated from its auth spec
 * (instructions → open the token page → form → verify and first sync).
 * Export sources use the generic export flow, which watches ~/Downloads.
 */
function pluginFromAuth(c: Connector): SourcePlugin {
  const auth = c.auth!;
  return {
    id: c.id,
    displayName: c.displayName,
    description: c.description,
    extractionType: 'api',
    category: 'api',
    urls: { settings: auth.setupUrl },
    steps: [
      {
        id: 'intro',
        type: 'instruction',
        title: `Connect ${c.displayName}`,
        description: `Otso reads your ${c.displayName} data with your own token.`,
        content: auth.instructions,
        tip: 'The token is saved in ~/.otso/config, readable only by you.',
      },
      { id: 'open', type: 'open_url', title: 'Open the token page', description: auth.setupUrl, url: auth.setupUrl },
      {
        id: 'enter',
        type: 'form',
        title: 'Enter credentials',
        description: 'Paste the values from the page you just opened.',
        fields: auth.fields.map((f) => ({
          name: f.name,
          label: f.label,
          type: f.secret ? ('secret' as const) : ('text' as const),
          required: true,
          placeholder: f.placeholder,
          helpText: f.help,
        })),
        submitText: 'Verify & sync',
      },
    ],
  };
}

const handwritten: SourcePlugin[] = [safariPlugin];
const plugins: SourcePlugin[] = [
  ...handwritten,
  ...CONNECTORS.filter((c) => c.auth && !handwritten.some((p) => p.id === c.id)).map(pluginFromAuth),
];

export const PLUGIN_REGISTRY: PluginRegistry = Object.fromEntries(plugins.map((p) => [p.id, p]));

export function getPlugin(sourceId: string): SourcePlugin | undefined {
  return PLUGIN_REGISTRY[sourceId];
}

export function getAllPlugins(): SourcePlugin[] {
  return plugins;
}

export function getPluginsByType(type: SourcePlugin['extractionType']): SourcePlugin[] {
  return plugins.filter((p) => p.extractionType === type);
}

export function hasPlugin(sourceId: string): boolean {
  return sourceId in PLUGIN_REGISTRY;
}
