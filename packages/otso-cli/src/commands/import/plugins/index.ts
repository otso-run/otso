import type { SourcePlugin, PluginRegistry } from './types.js';
import { arenaPlugin } from './arena.js';
import { safariPlugin } from './safari.js';
import { spotifyPlugin } from './spotify.js';

export * from './types.js';

// All registered plugins
const plugins: SourcePlugin[] = [
  arenaPlugin,
  safariPlugin,
  spotifyPlugin,
];

// Build registry by ID
export const PLUGIN_REGISTRY: PluginRegistry = Object.fromEntries(
  plugins.map((p) => [p.id, p])
);

// Get a plugin by source name
export function getPlugin(sourceId: string): SourcePlugin | undefined {
  return PLUGIN_REGISTRY[sourceId];
}

// Get all plugins
export function getAllPlugins(): SourcePlugin[] {
  return plugins;
}

// Get plugins by extraction type
export function getPluginsByType(type: SourcePlugin['extractionType']): SourcePlugin[] {
  return plugins.filter((p) => p.extractionType === type);
}

// Check if a source has a plugin
export function hasPlugin(sourceId: string): boolean {
  return sourceId in PLUGIN_REGISTRY;
}
