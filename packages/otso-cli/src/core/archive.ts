import { execa } from 'execa';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';

/**
 * Read-only view over an export: a .zip, .tar.gz/.tgz, a single file, or an
 * already-extracted folder. Archives are unpacked with the system unzip/tar
 * into a temp folder that dispose() removes.
 */
export interface Archive {
  root: string;
  /** All file paths relative to root, using "/" separators. */
  files: string[];
  find(pattern: RegExp): string[];
  readText(relPath: string): Promise<string>;
  readJson<T = any>(relPath: string): Promise<T>;
  abs(relPath: string): string;
  dispose(): Promise<void>;
}

async function walk(dir: string, root: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__MACOSX') continue;
      await walk(p, root, out);
    } else if (entry.isFile()) {
      out.push(relative(root, p).split('\\').join('/'));
    }
  }
}

export async function openArchive(input: string): Promise<Archive> {
  if (!existsSync(input)) throw new Error(`Not found: ${input}`);
  const info = await stat(input);
  let root: string;
  let temp: string | null = null;

  if (info.isDirectory()) {
    root = input;
  } else {
    temp = await mkdtemp(join(tmpdir(), 'otso-import-'));
    const lower = input.toLowerCase();
    if (lower.endsWith('.zip')) {
      await execa('unzip', ['-q', '-o', input, '-d', temp]);
    } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.tar')) {
      await execa('tar', ['-xf', input, '-C', temp]);
    } else {
      await copyFile(input, join(temp, basename(input)));
    }
    root = temp;
  }

  const files: string[] = [];
  await walk(root, root, files);
  files.sort();

  return {
    root,
    files,
    find: (pattern) => files.filter((f) => pattern.test(f)),
    abs: (rel) => join(root, rel),
    readText: (rel) => readFile(join(root, rel), 'utf8'),
    readJson: async (rel) => JSON.parse(await readFile(join(root, rel), 'utf8')),
    dispose: async () => {
      if (temp) await rm(temp, { recursive: true, force: true });
    },
  };
}

/**
 * Keep a copy of the original export next to the source's chronicle.db so
 * the archive can be re-processed later (data/sources/<source>/exports/).
 * Skips the copy when an identical-size file with the same name is there.
 */
export async function keepExportCopy(input: string, sourceDir: string): Promise<string | null> {
  const info = await stat(input);
  if (info.isDirectory()) return null;
  const dest = join(sourceDir, 'exports', basename(input));
  if (existsSync(dest) && (await stat(dest)).size === info.size) return dest;
  await mkdir(join(sourceDir, 'exports'), { recursive: true });
  await copyFile(input, dest);
  return dest;
}

/**
 * Twitter/X archives wrap JSON in `window.YTD.tweets.part0 = [...]`.
 */
export function parseYtdJs<T = any>(text: string): T {
  const start = text.indexOf('=');
  return JSON.parse(text.slice(start + 1).trim().replace(/;$/, '')) as T;
}

/** Minimal RFC 4180 CSV parser (quoted fields, embedded commas/newlines). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}
