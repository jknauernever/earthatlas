/**
 * SkyTruth Cerulean: oil slicks seen in Sentinel-1 radar, and the ships / infrastructure SkyTruth's model links to them.
 * Shared by the proxy (api/cerulean.js), the /ships slick layer (src/ships/ShipsApp.jsx) and the ship card's
 * "Oil slicks" tab (src/ships/VesselCard.jsx). Pure functions only: no fetches, no database.
 *
 * API facts (catalogued 2026-10-14 from the API docs notebook, /api (OpenAPI 3.1) and every collection):
 * - tipg OGC API at api.cerulean.skytruth.org; CQL2 filters; CORS open; no key for the public collections.
 * - public.slick_plus: one slick (polygon, centroid, timestamp, area, model scores, the source IDs near it, slick_url).
 * - public.source_plus: one row per slick × candidate source: mmsi_or_structure_id, source_type (VESSEL / INFRA /
 *   DARK / NATURAL), source_collated_score (−5…+5), source_rank (1 = most likely), source_url.
 * - Vector tiles: /collections/{id}/tiles/WebMercatorQuad/{z}/{x}/{y}, same filter / datetime / properties params.
 *   Arrays arrive in tiles as Postgres literals ("{a,b}"); NULL properties are left out.
 * - Speed (2026-10-14): one slick or one MMSI ≈ 0.3–0.7 s; tiles 0.3–5 s from z2 up (z0–1 up to ~30 s, so never
 *   asked for); any whole-world /items query ≈ 37 s, so the map never uses /items.
 * - Locked (HTTP 403 "Access to public.<table> is restricted."): source, source_vessel, source_infra, source_dark,
 *   source_type, repeat_source, slick_to_source, tag, source_to_tag, hitl_slick. Not used.
 * SkyTruth's own guidance (API docs): treat max_source_collated_score > 0 as credible oil; for slicks under 72 h
 * old, before AIS matching runs, use slick_confidence ≥ 0.8 instead.
 */

export const CERULEAN_API = 'https://api.cerulean.skytruth.org'
export const CERULEAN_APP = 'https://cerulean.skytruth.org'

export const CERULEAN_SOURCE = {
  id: 'skytruth-cerulean',
  name: 'SkyTruth Cerulean: oil slicks detected in Sentinel-1 radar imagery, with likely sources',
  publisher: 'SkyTruth',
  homepage_url: 'https://cerulean.skytruth.org',
  license: 'Used with SkyTruth\'s permission (SkyTruth to Josh Knauer, 2026-10-14: all data except vessel photos). '
    + 'No licence is published on the Cerulean site or API.',
  license_url: 'https://skytruth.org/cerulean/',
  commercial_use: false,
  attribution_text: 'Oil slicks: SkyTruth Cerulean (cerulean.skytruth.org). Contains modified Copernicus Sentinel data.',
  attribution_url: 'https://cerulean.skytruth.org',
  notes: 'Read live through api/cerulean.js (public collections only; nothing stored). Vessel photos are licensed '
    + 'to SkyTruth by a commercial provider and are never used. Every slick and source deep-links to Cerulean. '
    + '"Contains modified Copernicus Sentinel data" is Cerulean\'s own data attribution.',
}

/** The fields the map tiles carry (keeps tiles ~4× smaller than the full row). */
export const TILE_PROPS = ['id', 'slick_timestamp', 'max_source_collated_score', 'slick_confidence', 'hitl_cls', 'area',
  'source_type_1_ids', 'source_type_2_ids', 'source_type_3_ids']

export const DAY = /^\d{4}-\d{2}-\d{2}$/
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)

/**
 * SkyTruth's "credible" rule as CQL2 for slicks seen before `to` (YYYY-MM-DD, exclusive): matched to a likely
 * source (score > 0), or, in the last 3 days before `to` where AIS matching hasn't run yet, slick_confidence ≥ 0.8.
 * slick_timestamp is stored without a zone (UTC), so the bound is written without one too (with one, the API 500s).
 */
// The 3 days count back from `to` or from tomorrow, whichever is earlier: the map's months can end in the future.
export function credibleFilter(to, today = new Date().toISOString().slice(0, 10)) {
  if (!DAY.test(to) || !DAY.test(today)) throw new Error('bad day')
  const end = [to, addDays(today, 1)].sort()[0]
  return `max_source_collated_score > 0 OR (slick_confidence >= 0.8 AND slick_timestamp > TIMESTAMP('${addDays(end, -3)}T00:00:00'))`
}

/** "{1,2}" (tile) or ['1','2'] (JSON) → ['1','2']. */
export function idList(v) {
  if (v == null) return []
  if (Array.isArray(v)) return v.map(String)
  return String(v).replace(/^\{|\}$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '').trim()).filter(Boolean)
}

/**
 * How strongly SkyTruth's model ties a source to a slick, in words. source_collated_score runs −5…+5; SkyTruth
 * recommends > 0 for "likely", 0.5+ or 1.0+ when you want fewer, surer matches (API docs, example 11).
 * It's a model score, not a probability, so we never turn it into a percentage.
 */
export function matchWords(score) {
  if (score == null || Number.isNaN(Number(score))) return null
  const s = Number(score)
  if (s >= 1) return 'Strong match'
  if (s >= 0.5) return 'Good match'
  if (s > 0) return 'Possible match'
  return 'Weak match'
}

export const SOURCE_KIND = {
  VESSEL: 'Ship (AIS)',
  INFRA: 'Offshore infrastructure',
  DARK: 'Unidentified vessel (no AIS)',
  NATURAL: 'Natural seep',
}

export const slickUrl = (id) => `${CERULEAN_APP}/slicks/${encodeURIComponent(id)}?ref=earthatlas&slick_id=${encodeURIComponent(id)}`
export const sourceUrl = (id) => `${CERULEAN_APP}/sources/${encodeURIComponent(id)}?ref=earthatlas`

/**
 * Keep only the slicks this ship could have caused: Cerulean links slicks to an MMSI, and an MMSI can belong to
 * different ships over time, so a slick counts for this ship only when its time falls inside a period this ship
 * held that MMSI (src/ships/CLAUDE.md: a historical observation resolves against the identity valid at its time).
 * periods: [{ mmsi, from, to }] (ISO or null = unknown on that side, which is never treated as a limit).
 */
export function slicksForPeriods(rows, periods) {
  return rows.filter((r) => {
    const t = Date.parse(`${r.slick_timestamp}Z`)
    return periods.some((p) => String(p.mmsi) === String(r.mmsi)
      && (!p.from || t >= Date.parse(p.from)) && (!p.to || t <= Date.parse(p.to) + 864e5))
  })
}
