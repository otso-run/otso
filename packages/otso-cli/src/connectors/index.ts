import type { Connector } from './types.js';
import { arena } from './arena.js';
import { readwise } from './readwise.js';
import { pinboard } from './pinboard.js';
import { lastfm } from './lastfm.js';
import { github } from './github.js';
import { mastodon } from './mastodon.js';
import { spotify } from './spotify.js';
import { claude } from './claude.js';
import { linkedin } from './linkedin.js';
import { twitter } from './twitter.js';
import { googleTakeout } from './google-takeout.js';
import { gmail } from './gmail.js';
import { safari, helium, imessage, appleNotes, applePhotos, applePodcasts, things, timing } from './local.js';

export type { Connector } from './types.js';

export const CONNECTORS: Connector[] = [
  // API: authenticate once, then sync incrementally
  arena,
  readwise,
  pinboard,
  lastfm,
  github,
  mastodon,
  // Archive exports
  spotify,
  claude,
  linkedin,
  twitter,
  googleTakeout,
  gmail,
  // Local macOS databases
  safari,
  helium,
  imessage,
  appleNotes,
  applePhotos,
  applePodcasts,
  things,
  timing,
];

export function getConnector(id: string): Connector | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

export function requireConnector(id: string): Connector {
  const c = getConnector(id);
  if (!c) throw new Error(`Unknown source "${id}". Known sources: ${CONNECTORS.map((c) => c.id).join(', ')}`);
  return c;
}
