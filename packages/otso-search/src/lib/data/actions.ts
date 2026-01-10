/**
 * Maps entry_type to human-readable action verbs for display.
 *
 * Example: entry_type "listen" → "listened"
 */

const actionVerbs: Record<string, string> = {
  listen: 'listened',
  stream: 'listened',
  watch: 'watched',
  visit: 'visited',
  browse: 'visited',
  bookmark: 'bookmarked',
  like: 'starred',
  message: 'messaged',
  note: 'created',
  photo: 'took',
  task: 'completed',
  command: 'ran',
  activity: 'used',
  search: 'searched',
  checkin: 'checked in',
  highlight: 'highlighted',
  event: 'did',
  conversation: 'chatted about',
  connection: 'connected',
  transaction: 'made',
  tweet: 'tweeted',
  post: 'posted',
  status: 'posted',
  channel: 'created',
  block: 'added',
  page: 'created',
};

// Source-specific overrides (e.g., Last.fm uses "loved" instead of "starred")
const sourceOverrides: Record<string, Record<string, string>> = {
  lastfm: {
    like: 'loved',
  },
  github: {
    like: 'starred',
  },
  twitter: {
    like: 'liked',
  },
  bluesky: {
    like: 'liked',
  },
  mastodon: {
    like: 'favourited',
  },
};

/**
 * Get the action verb for an entry type, with optional source-specific override.
 */
export function getActionVerb(entryType: string, source?: string): string {
  // Check for source-specific override
  if (source && sourceOverrides[source]?.[entryType]) {
    return sourceOverrides[source][entryType];
  }

  // Fall back to default mapping
  return actionVerbs[entryType] || entryType;
}

/**
 * Get action info including verb and whether it's a known type.
 */
export function getActionInfo(entryType: string, source?: string): { verb: string; known: boolean } {
  const verb = getActionVerb(entryType, source);
  const known = entryType in actionVerbs;
  return { verb, known };
}
