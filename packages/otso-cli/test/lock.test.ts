import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceBusyError, STALE_LOCK_MS, withSourceLock } from '../src/core/lock.js';
import { runSync } from '../src/core/runner.js';
import { sandbox } from './helpers.js';

const dir = () => mkdtempSync(join(tmpdir(), 'otso-lock-'));

test('a second writer is turned away while the first holds the lock, then can go', async () => {
  process.env.OTSO_DEVICE = 'test-mac';
  const db = join(dir(), 'chronicle.db');
  let release!: () => void;
  const first = withSourceLock(db, () => new Promise<void>((r) => (release = r)));
  await Bun.sleep(5);
  await expect(withSourceLock(db, async () => 'second')).rejects.toBeInstanceOf(SourceBusyError);
  release();
  await first;
  expect(existsSync(`${db}.lock`)).toBe(false);
  expect(await withSourceLock(db, async () => 'second')).toBe('second');
});

test('another Mac holding the lock is respected, unless the lock is stale', async () => {
  process.env.OTSO_DEVICE = 'test-mac';
  const db = join(dir(), 'chronicle.db');
  writeFileSync(`${db}.lock`, JSON.stringify({ device: 'other-mac', pid: 1, at: new Date().toISOString() }));
  await expect(withSourceLock(db, async () => 1)).rejects.toThrow(/other-mac has been writing it/);
  writeFileSync(`${db}.lock`, JSON.stringify({ device: 'other-mac', pid: 1, at: new Date(Date.now() - STALE_LOCK_MS - 1000).toISOString() }));
  expect(await withSourceLock(db, async () => 1)).toBe(1);
});

test('a lock this Mac left behind from a process that died is cleared', async () => {
  process.env.OTSO_DEVICE = 'test-mac';
  const db = join(dir(), 'chronicle.db');
  writeFileSync(`${db}.lock`, JSON.stringify({ device: 'test-mac', pid: 2 ** 22 + 12345, at: new Date().toISOString() }));
  expect(await withSourceLock(db, async () => 'ok')).toBe('ok');
});

test('runSync skips a source another Mac is writing, without touching its database', async () => {
  const { sources } = sandbox();
  const db = join(sources, 'things/chronicle/chronicle.db');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(db, '..'), { recursive: true });
  writeFileSync(`${db}.lock`, JSON.stringify({ device: 'other-mac', pid: 1, at: new Date().toISOString() }));
  await expect(runSync('things')).rejects.toBeInstanceOf(SourceBusyError);
  expect(existsSync(db)).toBe(false);
});
