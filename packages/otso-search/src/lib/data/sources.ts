// Category definitions with colors
export const CATEGORIES: Record<string, { label: string; color: string }> = {
  listen: { label: 'listen', color: '#10B981' },
  read: { label: 'read', color: '#F59E0B' },
  browse: { label: 'browse', color: '#A78BFA' },
  bookmark: { label: 'bookmark', color: '#3B82F6' },
  code: { label: 'code', color: '#A855F7' },
  social: { label: 'social', color: '#4ECDC4' },
  message: { label: 'message', color: '#60A5FA' },
  ai: { label: 'ai', color: '#F472B6' },
  note: { label: 'note', color: '#EC4899' },
  photo: { label: 'photo', color: '#8B5CF6' },
  files: { label: 'files', color: '#94A3B8' },
  tasks: { label: 'tasks', color: '#FB923C' },
  event: { label: 'event', color: '#F97316' },
  spend: { label: 'spend', color: '#84CC16' },
  travel: { label: 'travel', color: '#06B6D4' },
  health: { label: 'health', color: '#FF6B6B' },
};

// Source definitions mapping to categories
export const SOURCES: Record<string, { label: string; cat: string; icon: string }> = {
  // Listen (Music)
  'spotify': { label: 'Spotify', cat: 'listen', icon: '●' },
  'lastfm': { label: 'Last.fm', cat: 'listen', icon: '♪' },
  'applemusic': { label: 'Apple Music', cat: 'listen', icon: '♫' },

  // Read (Podcasts/Video/Articles)
  'apple-podcasts': { label: 'Podcasts', cat: 'read', icon: '🎧' },
  'youtube': { label: 'YouTube', cat: 'read', icon: '▶' },
  'readwise': { label: 'Readwise', cat: 'read', icon: '📑' },
  'kindle': { label: 'Kindle', cat: 'read', icon: '📖' },
  'applebooks': { label: 'Apple Books', cat: 'read', icon: '📚' },
  'goodreads': { label: 'Goodreads', cat: 'read', icon: '📕' },
  'medium': { label: 'Medium', cat: 'read', icon: 'M' },

  // Browse (Web/App Usage)
  'safari': { label: 'Safari', cat: 'browse', icon: '🧭' },
  'chrome': { label: 'Chrome', cat: 'browse', icon: '◉' },
  'google-search': { label: 'Google', cat: 'browse', icon: '🔍' },
  'atlas': { label: 'Atlas', cat: 'browse', icon: '🗺' },
  'timing': { label: 'Timing', cat: 'browse', icon: '⏱' },

  // Bookmark (Saved/Starred)
  'pinboard': { label: 'Pinboard', cat: 'bookmark', icon: '📌' },
  'arena': { label: 'Are.na', cat: 'bookmark', icon: '▢' },
  'raindrop': { label: 'Raindrop', cat: 'bookmark', icon: '💧' },
  'pinterest': { label: 'Pinterest', cat: 'bookmark', icon: '📌' },

  // Code (Development)
  'github': { label: 'GitHub', cat: 'code', icon: '⌥' },
  'vercel': { label: 'Vercel', cat: 'code', icon: '▲' },
  'netlify': { label: 'Netlify', cat: 'code', icon: '◆' },
  'shell': { label: 'Shell', cat: 'code', icon: '$' },
  'cloudflare': { label: 'Cloudflare', cat: 'code', icon: '☁' },
  'gandi': { label: 'Gandi', cat: 'code', icon: '🌐' },
  'namecheap': { label: 'Namecheap', cat: 'code', icon: '🏷' },

  // Social (Public Posts)
  'twitter': { label: 'Twitter/X', cat: 'social', icon: '𝕏' },
  'twitter-caseyg': { label: 'Twitter', cat: 'social', icon: '𝕏' },
  'twitter-subtvveet': { label: 'Twitter', cat: 'social', icon: '𝕏' },
  'bluesky': { label: 'Bluesky', cat: 'social', icon: '🦋' },
  'mastodon': { label: 'Mastodon', cat: 'social', icon: '🐘' },
  'linkedin': { label: 'LinkedIn', cat: 'social', icon: '🔗' },

  // Message (Email/Chat/DMs)
  'imessage': { label: 'Messages', cat: 'message', icon: '💬' },
  'messages': { label: 'Messages', cat: 'message', icon: '💬' },
  'slack': { label: 'Slack', cat: 'message', icon: '#' },
  'google-chat': { label: 'Google Chat', cat: 'message', icon: '💬' },
  'fastmail': { label: 'Fastmail', cat: 'message', icon: '✉' },
  'email': { label: 'Email', cat: 'message', icon: '✉' },

  // AI (AI Assistants)
  'claude': { label: 'Claude', cat: 'ai', icon: '◑' },
  'chatgpt': { label: 'ChatGPT', cat: 'ai', icon: '◐' },
  'perplexity': { label: 'Perplexity', cat: 'ai', icon: '?' },

  // Note (Notes/Writing)
  'apple-notes': { label: 'Notes', cat: 'note', icon: '✏️' },
  'notion': { label: 'Notion', cat: 'note', icon: '▪' },
  'obsidian': { label: 'Obsidian', cat: 'note', icon: '◈' },
  'remarkable': { label: 'reMarkable', cat: 'note', icon: '✎' },
  'devonthink': { label: 'DEVONthink', cat: 'note', icon: '🗄' },

  // Photo (Photos)
  'apple-photos': { label: 'Photos', cat: 'photo', icon: '📸' },
  'googlephotos': { label: 'Google Photos', cat: 'photo', icon: '📷' },

  // Files (Cloud Storage)
  'gdrive': { label: 'Google Drive', cat: 'files', icon: '△' },
  'dropbox': { label: 'Dropbox', cat: 'files', icon: '📦' },
  'icloud': { label: 'iCloud', cat: 'files', icon: '☁️' },
  'google-takeout': { label: 'Google', cat: 'files', icon: '🔍' },

  // Tasks (Productivity)
  'things': { label: 'Things', cat: 'tasks', icon: '☑' },

  // Event (Calendar)
  'calendar': { label: 'Calendar', cat: 'event', icon: '📅' },
  'gcal': { label: 'Calendar', cat: 'event', icon: '📆' },

  // Spend (Financial)
  'copilot': { label: 'Copilot', cat: 'spend', icon: '💰' },
  'amazon': { label: 'Amazon', cat: 'spend', icon: '📦' },
  'lunchmoney': { label: 'Lunch Money', cat: 'spend', icon: '🥗' },

  // Travel (Location)
  'foursquare': { label: 'Foursquare', cat: 'travel', icon: '📍' },
  'googlemaps': { label: 'Google Maps', cat: 'travel', icon: '🗺' },

  // Health (Health & Fitness)
  'applehealth': { label: 'Apple Health', cat: 'health', icon: '❤️' },
  '23andme': { label: '23andMe', cat: 'health', icon: '🧬' },
};

// Get source info with fallback for unknown sources
export function getSourceInfo(sourceName: string) {
  return SOURCES[sourceName] || { label: sourceName, cat: 'files', icon: '📄' };
}

// Get category info
export function getCategoryInfo(catKey: string) {
  return CATEGORIES[catKey] || { label: catKey, color: '#525252' };
}

// Get category for a source
export function getSourceCategory(sourceName: string) {
  const source = getSourceInfo(sourceName);
  return getCategoryInfo(source.cat);
}
