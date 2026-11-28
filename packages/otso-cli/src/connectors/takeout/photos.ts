import type { TableDef } from '../../core/chronicle.js';
import { fromUnixSeconds } from '../../core/time.js';
import { shortHash } from '../util.js';

/**
 * Google Photos, metadata only: the JSON sidecar next to each photo
 * (<file>.json, or <file>.supplemental-metadata.json and its truncated
 * forms in newer exports). Titles, descriptions, people, places and
 * albums are indexed; the photos and videos themselves are never read.
 * A photo shows up once per album it's in, so rows merge their albums.
 */

export const PHOTOS_TABLE: TableDef = {
  name: 'google_photos',
  key: 'source_id',
  columns: ['source_id', 'title', 'description', 'people', 'albums', 'url', 'lat', 'lng', 'takenTime', 'createdTime'],
};

/** Album folders that are just Google's date buckets. */
const DATE_BUCKET = /^Photos from \d{4}$/i;

/** Sidecar for a media file, not an album's own metadata.json. */
export const PHOTO_SIDECAR = /(^|\/)Google Photos\/[^/]+\/[^/]+\.[^/]+\.json$/i;

export interface PhotoRow {
  source_id: string;
  title: string;
  description: string | null;
  people: string[];
  albums: string[];
  url: string | null;
  lat: number | null;
  lng: number | null;
  takenTime: string | null;
  createdTime: string | null;
}

export function photoRow(meta: any, album: string): PhotoRow | null {
  if (!meta || typeof meta.title !== 'string' || !meta.photoTakenTime && !meta.creationTime) return null;
  const takenTime = fromUnixSeconds(meta.photoTakenTime?.timestamp);
  const geo = meta.geoData?.latitude || meta.geoData?.longitude ? meta.geoData : meta.geoDataExif;
  const hasGeo = geo && (geo.latitude || geo.longitude);
  return {
    source_id: `gphoto-${shortHash(meta.url ?? `${meta.title}|${meta.photoTakenTime?.timestamp}`)}`,
    title: meta.title,
    description: meta.description || null,
    people: (meta.people ?? []).map((p: any) => p?.name).filter(Boolean),
    albums: DATE_BUCKET.test(album) ? [] : [album],
    url: meta.url ?? null,
    lat: hasGeo ? geo.latitude : null,
    lng: hasGeo ? geo.longitude : null,
    takenTime,
    createdTime: fromUnixSeconds(meta.creationTime?.timestamp),
  };
}

/** Merge rows for the same photo found in several album folders. */
export function mergePhoto(into: Map<string, PhotoRow>, row: PhotoRow) {
  const prev = into.get(row.source_id);
  if (!prev) into.set(row.source_id, row);
  else {
    for (const a of row.albums) if (!prev.albums.includes(a)) prev.albums.push(a);
    prev.description ??= row.description;
  }
}
