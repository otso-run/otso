import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * SQLite's WAL mode relies on shared memory and byte-range locks that SMB,
 * NFS and AFP don't provide reliably, so databases on a network share use
 * the classic rollback journal instead. OTSO_SQLITE_JOURNAL=wal|delete
 * overrides the detection; the same value is passed to otso-indexer.
 */

const NETWORK_FS = /^(smbfs|cifs|smb3?|nfs4?|afpfs|webdav|fuse\.sshfs|sshfs|9p)$/i;
let mounts: { point: string; type: string }[] | null = null;

function readMounts(): { point: string; type: string }[] {
  if (mounts) return mounts;
  mounts = [];
  try {
    const out = execFileSync('mount', [], { encoding: 'utf8' });
    for (const line of out.split('\n')) {
      // macOS: "//user@host/share on /Volumes/share (smbfs, nodev, …)"
      // Linux: "//host/share on /mnt/share type cifs (rw,…)"
      const mac = line.match(/ on (.+) \(([^,)]+)/);
      const linux = line.match(/ on (.+) type (\S+)/);
      const m = linux ?? mac;
      if (m) mounts.push({ point: m[1], type: m[2] });
    }
  } catch {
    // no mount binary: assume local
  }
  return mounts;
}

export function isNetworkPath(path: string): boolean {
  let p = resolve(path);
  while (!existsSync(p) && dirname(p) !== p) p = dirname(p);
  const match = readMounts()
    .filter((m) => p === m.point || p.startsWith(m.point.endsWith('/') ? m.point : m.point + '/'))
    .sort((a, b) => b.point.length - a.point.length)[0];
  return !!match && NETWORK_FS.test(match.type);
}

export function journalModeFor(path: string): 'wal' | 'delete' {
  const forced = process.env.OTSO_SQLITE_JOURNAL?.toLowerCase();
  if (forced === 'wal' || forced === 'delete') return forced;
  return isNetworkPath(path) ? 'delete' : 'wal';
}
