import type { TableDef } from '../../core/chronicle.js';
import { iso } from '../../core/time.js';
import { shortHash } from '../util.js';

/**
 * Google Contacts: Takeout/Contacts/<group>/<group>.vcf (vCard 3.0). The
 * same person shows up in "All Contacts" and in each of their groups, so
 * rows are keyed on the person, and their groups are merged.
 */

export const CONTACTS_TABLE: TableDef = {
  name: 'google_contacts',
  key: 'source_id',
  columns: ['source_id', 'name', 'emails', 'phones', 'org', 'title', 'note', 'birthday', 'groups', 'urls', 'addresses', 'updated'],
};

export interface VCard {
  [prop: string]: string[];
}

const unescape = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

/** Unfold and split a .vcf into cards: property name -> values. */
export function parseVcf(text: string): VCard[] {
  const cards: VCard[] = [];
  let cur: VCard | null = null;
  for (const line of text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/)) {
    if (/^BEGIN:VCARD$/i.test(line)) cur = {};
    else if (/^END:VCARD$/i.test(line)) {
      if (cur) cards.push(cur);
      cur = null;
    } else if (cur) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      // "item1.EMAIL;TYPE=INTERNET" -> EMAIL
      const prop = line.slice(0, i).split(';')[0].replace(/^[^.]+\./, '').toUpperCase();
      (cur[prop] ??= []).push(line.slice(i + 1));
    }
  }
  return cards;
}

export function contactRow(card: VCard, group: string, exportedAt: string | null) {
  const first = (p: string) => (card[p]?.[0] !== undefined ? unescape(card[p][0]) : null);
  const all = (p: string) => (card[p] ?? []).map(unescape).filter(Boolean);
  const n = first('N')?.split(';');
  const name = first('FN') || (n ? [n[3], n[1], n[0], n[4]].filter(Boolean).join(' ') : '') || all('EMAIL')[0] || all('TEL')[0];
  if (!name) return null;
  const emails = all('EMAIL').map((e) => e.toLowerCase());
  const phones = all('TEL');
  return {
    source_id: `contact-${shortHash(first('UID') ?? `${name}|${emails[0] ?? ''}|${phones[0] ?? ''}`)}`,
    name,
    emails,
    phones,
    org: first('ORG')?.split(';').filter(Boolean).join(', ') || null,
    title: first('TITLE'),
    note: first('NOTE'),
    birthday: first('BDAY'),
    groups: group && !/^all contacts$/i.test(group) ? [group] : [],
    urls: all('URL'),
    addresses: all('ADR').map((a) => a.split(';').filter(Boolean).join(', ')),
    updated: iso(first('REV')) ?? exportedAt,
  };
}
