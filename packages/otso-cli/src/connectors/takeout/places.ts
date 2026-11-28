import type { TableDef } from '../../core/chronicle.js';
import { iso } from '../../core/time.js';
import { parseCsv } from '../../core/archive.js';
import { shortHash } from '../util.js';

/**
 * Places from Maps, Maps (your places), Saved and Timeline, all in one
 * table with a `kind`:
 *   starred   Maps (your places)/Saved Places.json (GeoJSON, dated)
 *   review    Maps (your places)/Reviews.json (GeoJSON, dated)
 *   labeled   Maps/My labeled places/Labeled places.json (no dates)
 *   saved     Saved/<list>.csv (Title, Note, URL; no dates)
 *   visit     Timeline: Semantic Location History/<year>/<month>.json
 *             placeVisits, or the newer on-device Timeline.json visits
 * Lists without dates are dated by the export they came from.
 */

export const PLACES_TABLE: TableDef = {
  name: 'google_places',
  key: 'source_id',
  columns: ['source_id', 'kind', 'list', 'name', 'address', 'note', 'url', 'lat', 'lng', 'startTime', 'endTime'],
};

const key = (...parts: unknown[]) => `place-${shortHash(...parts)}`;

/** Saved Places / Reviews / Labeled places GeoJSON. */
export function geoJsonPlaces(data: any, kind: string, list: string, exportedAt: string | null) {
  const features: any[] = data?.features ?? [];
  return features.map((f) => {
    const p = f?.properties ?? {};
    const loc = p.location ?? {};
    const [lng, lat] = f?.geometry?.coordinates ?? [];
    const name = loc.name ?? p.name ?? p.Title ?? loc.address ?? p.address ?? 'Unnamed place';
    const url = p.google_maps_url ?? p['Google Maps URL'] ?? null;
    const note = p.review_text_published ?? p.Comment ?? p.comment ?? null;
    const rating = p.five_star_rating_published ?? p.star_rating;
    return {
      source_id: key(kind, url ?? `${name}|${lat}|${lng}`),
      kind,
      list,
      name,
      address: loc.address ?? p.address ?? null,
      note: rating ? `${'★'.repeat(Number(rating))}${note ? ` ${note}` : ''}` : note,
      url,
      lat: lat ?? null,
      lng: lng ?? null,
      startTime: iso(p.date ?? p.Published ?? p.Updated) ?? exportedAt,
      endTime: null,
    };
  });
}

/** Saved/<list>.csv: Title, Note, URL (and sometimes Comment, Tags). */
export function savedListPlaces(csv: string, list: string, exportedAt: string | null) {
  return parseCsv(csv)
    .filter((r) => r.Title || r.URL)
    .map((r) => ({
      source_id: key('saved', list, r.URL || r.Title),
      kind: 'saved',
      list,
      name: r.Title || r.URL,
      address: null,
      note: [r.Note, r.Comment].filter(Boolean).join('\n') || null,
      url: r.URL || null,
      lat: null,
      lng: null,
      startTime: exportedAt,
      endTime: null,
    }));
}

const e7 = (v: unknown) => (typeof v === 'number' ? v / 1e7 : null);
const latLng = (s?: string) => {
  const m = s?.replace(/°/g, '').match(/(-?[\d.]+),\s*(-?[\d.]+)/);
  return m ? [Number(m[1]), Number(m[2])] : [null, null];
};

/** Timeline visits, old (Semantic Location History) or new (semanticSegments). */
export function timelinePlaces(data: any) {
  const rows = [];
  for (const o of data?.timelineObjects ?? []) {
    const v = o?.placeVisit;
    if (!v) continue;
    const loc = v.location ?? {};
    const start = iso(v.duration?.startTimestamp ?? (v.duration?.startTimestampMs && Number(v.duration.startTimestampMs)));
    rows.push({
      source_id: key('visit', loc.placeId, start),
      kind: 'visit',
      list: 'Timeline',
      name: loc.name ?? loc.address ?? 'Visit',
      address: loc.address ?? null,
      note: null,
      url: loc.placeId ? `https://www.google.com/maps/place/?q=place_id:${loc.placeId}` : null,
      lat: e7(loc.latitudeE7),
      lng: e7(loc.longitudeE7),
      startTime: start,
      endTime: iso(v.duration?.endTimestamp ?? (v.duration?.endTimestampMs && Number(v.duration.endTimestampMs))),
    });
  }
  for (const s of data?.semanticSegments ?? []) {
    const c = s?.visit?.topCandidate;
    if (!c) continue;
    const [lat, lng] = latLng(c.placeLocation?.latLng);
    const start = iso(s.startTime);
    const type = c.semanticType && c.semanticType !== 'UNKNOWN' ? c.semanticType.toLowerCase().replace(/_/g, ' ') : null;
    rows.push({
      source_id: key('visit', c.placeId, start),
      kind: 'visit',
      list: 'Timeline',
      name: type ? `Visit (${type})` : 'Visit',
      address: null,
      note: null,
      url: c.placeId ? `https://www.google.com/maps/place/?q=place_id:${c.placeId}` : null,
      lat,
      lng,
      startTime: start,
      endTime: iso(s.endTime),
    });
  }
  return rows;
}
