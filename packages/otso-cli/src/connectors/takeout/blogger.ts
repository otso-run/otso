import type { TableDef } from '../../core/chronicle.js';
import { iso } from '../../core/time.js';
import { htmlToText, shortHash } from '../util.js';

/**
 * Blogger: Takeout/Blogger/Blogs/<blog>/feed.atom. Newer exports mark each
 * entry with <blogger:type> POST / COMMENT / PAGE and <blogger:status>;
 * older ones use an Atom category ending in kind#post / #comment / #page.
 * Drafts are kept, deleted entries and template/settings entries are not.
 */

export const BLOGGER_TABLE: TableDef = {
  name: 'blogger',
  key: 'source_id',
  columns: ['source_id', 'blog', 'kind', 'status', 'title', 'text', 'url', 'author', 'published', 'updated'],
};

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const xmlDecode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : XML_ENTITIES[e.toLowerCase()]
    );

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? xmlDecode(m[1]).trim() : null;
};

export function bloggerRows(atom: string, blog: string) {
  const rows = [];
  for (const m of atom.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const kind =
      tag(e, 'blogger:type')?.toLowerCase() ??
      e.match(/<category[^>]*term=['"][^'"]*kind#(\w+)['"]/)?.[1]?.toLowerCase() ??
      'post';
    if (!['post', 'comment', 'page'].includes(kind)) continue;
    const status = tag(e, 'blogger:status')?.toLowerCase() ?? (/<app:draft>\s*yes/i.test(e) ? 'draft' : 'live');
    if (status === 'deleted') continue;
    const html = tag(e, 'content') ?? '';
    const href =
      e.match(/<link[^>]*rel=['"]alternate['"][^>]*href=['"]([^'"]+)['"]/)?.[1] ??
      e.match(/<link[^>]*href=['"]([^'"]+)['"][^>]*rel=['"]alternate['"]/)?.[1] ??
      null;
    const id = tag(e, 'id') ?? `${blog}|${tag(e, 'published')}|${tag(e, 'title')}`;
    rows.push({
      source_id: `blogger-${shortHash(id)}`,
      blog,
      kind,
      status,
      title: tag(e, 'title') ?? '',
      text: htmlToText(html),
      url: href ? xmlDecode(href) : null,
      author: tag(tag(e, 'author') ?? '', 'name'),
      published: iso(tag(e, 'published')),
      updated: iso(tag(e, 'updated')),
    });
  }
  return rows;
}
