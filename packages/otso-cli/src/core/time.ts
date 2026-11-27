/** Seconds between the Unix epoch and Apple's Core Data epoch (2001-01-01). */
export const APPLE_EPOCH_OFFSET = 978307200;

/** ISO-8601 UTC without milliseconds, the format the fixtures use. */
export function iso(d: Date | number | string | null | undefined): string | null {
  if (d === null || d === undefined || d === '') return null;
  const date = d instanceof Date ? d : typeof d === 'number' ? new Date(d) : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function fromUnixSeconds(s: number | string | null | undefined): string | null {
  if (s === null || s === undefined || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? iso(n * 1000) : null;
}

/**
 * Apple stores dates as seconds since 2001 (Core Data), and Messages uses
 * nanoseconds since 2001 on newer macOS. Both are handled here.
 */
export function fromAppleTime(t: number | string | null | undefined): string | null {
  if (t === null || t === undefined || t === '') return null;
  let n = Number(t);
  if (!Number.isFinite(n) || n === 0) return null;
  if (Math.abs(n) > 1e14) n = n / 1e9; // nanoseconds
  return iso((n + APPLE_EPOCH_OFFSET) * 1000);
}
