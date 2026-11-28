import type { TableDef } from '../../core/chronicle.js';
import { iso } from '../../core/time.js';
import { shortHash } from '../util.js';

/**
 * Google Chat: Takeout/Google Chat/Groups/<DM or Space id>/messages.json,
 * with group_info.json next to it naming the space and its members.
 */

export const CHAT_TABLE: TableDef = {
  name: 'google_chat',
  key: 'source_id',
  columns: ['source_id', 'message_id', 'conversation', 'sender', 'text', 'startTime', 'attachments'],
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * "Tuesday, April 5, 2022 at 3:04:05 PM UTC" (Takeout's own wording, with
 * a narrow no-break space before PM in newer exports) -> ISO.
 */
export function chatDate(v?: string): string | null {
  if (!v) return null;
  const s = v.replace(/[  ]/g, ' ');
  const m = s.match(/(\w+) (\d{1,2}), (\d{4})(?: at|,)? (\d{1,2}):(\d{2})(?::(\d{2}))? ?([AP]M)?(?: (UTC|GMT)?([+-]\d{1,2})?(?::?(\d{2}))?)?/i);
  if (!m) return iso(s);
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return iso(s);
  let hour = Number(m[4]) % 12;
  if (!m[7]) hour = Number(m[4]);
  else if (m[7].toUpperCase() === 'PM') hour += 12;
  const offsetMin = m[9] ? Math.sign(Number(m[9]) || 1) * (Math.abs(Number(m[9])) * 60 + Number(m[10] ?? 0)) : 0;
  const t = Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5]), Number(m[6] ?? 0)) - offsetMin * 60_000;
  return iso(t);
}

/** A space's own name, or "DM with <the other people>" for direct messages. */
export function conversationName(info: any, folder: string, self?: string): string {
  if (info?.name) return info.name;
  const others = (info?.members ?? [])
    .filter((m: any) => m?.email !== self)
    .map((m: any) => m?.name || m?.email)
    .filter(Boolean);
  return others.length ? `DM with ${others.join(', ')}` : folder;
}

export function chatRows(data: any, conversation: string) {
  const items: any[] = data?.messages ?? [];
  return items
    .filter((m) => m && m.message_state !== 'DELETED' && (m.text || m.attached_files?.length))
    .map((m) => {
      const startTime = chatDate(m.created_date);
      const sender = m.creator?.name || m.creator?.email || 'Unknown';
      return {
        source_id: `gchat-${shortHash(m.message_id ?? `${conversation}|${startTime}|${sender}|${m.text}`)}`,
        message_id: m.message_id ?? null,
        conversation,
        sender,
        text: m.text ?? '',
        startTime,
        attachments: m.attached_files?.length ? m.attached_files.map((f: any) => f.original_name ?? f.export_name) : null,
      };
    });
}
