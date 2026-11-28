import { createReadStream } from 'node:fs';
import { htmlToText } from '../util.js';

/**
 * Just enough MIME to make email searchable: headers (with RFC 2047
 * encoded words), the text of the message (text/plain preferred, else
 * text/html flattened), and the names of any attachments. Attachment
 * bodies are never decoded or kept.
 *
 * Raw messages are handled as "binary" (latin1) strings, one char per
 * byte, so 8-bit bodies can be decoded with their declared charset.
 */

export interface MailMessage {
  headers: Map<string, string>;
  text: string;
  attachments: string[];
}

const bytes = (s: string) => Buffer.from(s, 'latin1');

export function decodeCharset(buf: Uint8Array, charset?: string): string {
  let cs = (charset || 'utf-8').trim().toLowerCase().replace(/^["']|["']$/g, '');
  if (cs === 'us-ascii' || cs === 'ascii' || cs === 'ansi_x3.4-1968') cs = 'utf-8';
  if (cs === 'cp1252') cs = 'windows-1252';
  try {
    return new TextDecoder(cs).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

function decodeQ(s: string, header: boolean): Buffer {
  if (header) s = s.replace(/_/g, ' ');
  else s = s.replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(s.charCodeAt(i) & 0xff);
  }
  return Buffer.from(out);
}

/** =?utf-8?B?...?= and =?iso-8859-1?Q?...?= words in a header value. */
export function decodeWords(value: string): string {
  // Raw 8-bit header bytes (no encoded words) are nearly always UTF-8 these days.
  const raw = /[\x80-\xff]/.test(value) && !/[^\x00-\xff]/.test(value) ? decodeCharset(bytes(value)) : value;
  return (
    raw
      // Whitespace between two adjacent encoded words is dropped (RFC 2047 6.2).
      .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, '$1')
      .replace(/=\?([^?*]+)(?:\*[^?]+)?\?([BbQq])\?([^?]*)\?=/g, (_m, cs: string, enc: string, text: string) =>
        decodeCharset(enc.toUpperCase() === 'B' ? Buffer.from(text, 'base64') : decodeQ(text, true), cs)
      )
  );
}

export function splitHeaders(raw: string): { headers: Map<string, string>; body: string } {
  const m = raw.match(/\r?\n\r?\n/);
  const head = m ? raw.slice(0, m.index) : raw;
  const body = m ? raw.slice(m.index! + m[0].length) : '';
  const headers = new Map<string, string>();
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    if (!headers.has(key)) headers.set(key, line.slice(i + 1).trim());
  }
  return { headers, body };
}

/** text/plain; charset="utf-8"; name=x -> { value: 'text/plain', params: {...} } */
export function parseParams(v = ''): { value: string; params: Record<string, string> } {
  const [value, ...rest] = v.split(';');
  const params: Record<string, string> = {};
  let charset = 'utf-8';
  for (const p of rest) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    const rawKey = p.slice(0, i).trim().toLowerCase();
    let val = p.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
    // RFC 2231: filename*=utf-8''na%C3%AFve.pdf, and name*0= / name*1= continuations.
    const m = rawKey.match(/^([^*]+)(?:\*(\d+))?(\*)?$/);
    if (!m) continue;
    const [, key, index, extended] = m;
    if (extended) {
      const ext = (!index || index === '0') && val.match(/^([^']*)'[^']*'(.*)$/);
      if (ext) {
        charset = ext[1] || charset;
        val = ext[2];
      }
      val = decodeCharset(Buffer.from(val.replace(/%([0-9A-Fa-f]{2})/g, (_s, h) => String.fromCharCode(parseInt(h, 16))), 'latin1'), charset);
    }
    params[key] = index && index !== '0' ? (params[key] ?? '') + val : val;
  }
  return { value: value.trim().toLowerCase(), params };
}

function decodeBody(body: string, encoding = ''): Buffer {
  const enc = encoding.trim().toLowerCase();
  if (enc === 'base64') return Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  if (enc === 'quoted-printable') return decodeQ(body, false);
  return bytes(body);
}

interface Parts {
  plain: string[];
  html: string[];
  attachments: string[];
}

function walk(raw: string, out: Parts, depth: number) {
  const { headers, body } = splitHeaders(raw);
  const type = parseParams(headers.get('content-type') || 'text/plain');
  const disp = parseParams(headers.get('content-disposition'));
  const filename = disp.params.filename || type.params.name;

  if (type.value.startsWith('multipart/') && type.params.boundary && depth < 10) {
    const b = '--' + type.params.boundary;
    const chunks = body.split(new RegExp('^' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:--)?[ \\t]*\\r?$', 'm'));
    // chunks[0] is the preamble, the last is the epilogue after the closing boundary.
    for (const chunk of chunks.slice(1)) {
      const part = chunk.replace(/^\r?\n/, '');
      if (part.trim()) walk(part, out, depth + 1);
    }
    return;
  }
  if (type.value === 'message/rfc822' && depth < 10) {
    walk(body, out, depth + 1);
    return;
  }
  if (disp.value === 'attachment' || (filename && !type.value.startsWith('text/'))) {
    if (filename) out.attachments.push(decodeWords(filename));
    return;
  }
  if (type.value === 'text/plain' || type.value === 'text/html') {
    const text = decodeCharset(decodeBody(body, headers.get('content-transfer-encoding')), type.params.charset);
    (type.value === 'text/plain' ? out.plain : out.html).push(text);
  }
}

/** Parse one raw RFC 822 message (a latin1 "binary" string). */
export function parseMessage(raw: string, maxText = 32_000): MailMessage {
  const { headers } = splitHeaders(raw);
  const decoded = new Map([...headers].map(([k, v]) => [k, decodeWords(v)]));
  const parts: Parts = { plain: [], html: [], attachments: [] };
  walk(raw, parts, 0);
  const text = (parts.plain.length ? parts.plain.join('\n\n') : htmlToText(parts.html.join('\n')))
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { headers: decoded, text: text.length > maxText ? text.slice(0, maxText) : text, attachments: parts.attachments };
}

/** "Ada <ada@example.com>, bob@example.com" -> display names (or addresses), comma-joined. */
export function addressNames(v = ''): string {
  return v
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((a) => {
      const m = a.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
      return m ? (m[1].trim() ? `${m[1].trim()} <${m[2].trim()}>` : m[2].trim()) : a.trim();
    })
    .filter(Boolean)
    .join(', ');
}

/** RFC 2822 date (with optional "(PST)" comment) -> Date, or null. */
export function mailDate(v?: string): Date | null {
  if (!v) return null;
  const d = new Date(v.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Stream the messages of an mbox file one at a time, without reading the
 * whole (often many-GB) file into memory. A message starts at a "From "
 * line that follows a blank line; ">From " quoting (mboxrd) is undone.
 */
export async function* readMbox(path: string): AsyncGenerator<{ raw: string; fromLine: string }> {
  let lines: string[] = [];
  let fromLine = '';
  let prevBlank = true;
  let rest = '';
  const flush = () => {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    const raw = lines.join('\n');
    lines = [];
    return raw;
  };
  for await (const chunk of createReadStream(path, { encoding: 'latin1', highWaterMark: 1 << 20 })) {
    const text = rest + (chunk as string);
    const parts = text.split('\n');
    rest = parts.pop()!;
    for (let line of parts) {
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (prevBlank && line.startsWith('From ')) {
        if (fromLine || lines.length) {
          const raw = flush();
          if (raw.trim()) yield { raw, fromLine };
        }
        fromLine = line;
        prevBlank = false;
        continue;
      }
      lines.push(/^>+From /.test(line) ? line.slice(1) : line);
      prevBlank = line === '';
    }
  }
  if (rest) lines.push(rest.replace(/\r$/, ''));
  const raw = flush();
  if (raw.trim()) yield { raw, fromLine };
}
