/**
 * Read side of the whale database: parse a /api/whales request and run it.
 * Pure parsing (parseWhaleQuery) is separate from the SQL (queryWhales) so it
 * can be tested without a database.
 *
 * Area: bbox=w,s,e,n (w > e crosses the antimeridian) or lat,lng,radius_km (≤ 500).
 * Omitting both means worldwide — allowed only together with a taxon, like the
 * main site's species-only search.
 */
import { schemaIdent } from './db.js'
import { WHALE_SOURCES, ORIGINS } from './sources.js'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const MAX_SPAN_DAYS = 3660
const MAX_LIMIT = 2000
export const GROUPS = ['cetacean', 'pinniped', 'sirenian', 'otter', 'shark', 'ray', 'sea_turtle', 'other', 'unknown']

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function list(v, allowed) {
  if (!v) return null
  const out = String(v).split(',').map((s) => s.trim()).filter((s) => allowed.includes(s))
  return out.length ? out : null
}

/** URLSearchParams → { ok: true, q } | { ok: false, error } */
export function parseWhaleQuery(sp, today = new Date().toISOString().slice(0, 10)) {
  const q = {}
  const bbox = sp.get('bbox')
  if (bbox) {
    const b = bbox.split(',').map(num)
    if (b.length !== 4 || b.some((x) => x === null)) return { ok: false, error: 'bbox must be w,s,e,n' }
    const [w, s, e, n] = b
    if (s < -90 || n > 90 || s >= n || w < -180 || e > 180) return { ok: false, error: 'bbox out of range' }
    q.bbox = [w, s, e, n]
  } else if (sp.get('lat') !== null || sp.get('lng') !== null) {
    const lat = num(sp.get('lat'))
    const lng = num(sp.get('lng'))
    const r = num(sp.get('radius_km')) ?? 50
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { ok: false, error: 'bad lat/lng' }
    if (r <= 0 || r > 500) return { ok: false, error: 'radius_km must be 0–500' }
    q.point = { lat, lng, r }
  }

  const taxon = num(sp.get('taxon'))
  if (taxon !== null) q.taxon = Math.trunc(taxon)
  if (!q.bbox && !q.point && q.taxon === undefined) return { ok: false, error: 'give an area (bbox or lat,lng) or a taxon' }

  const to = sp.get('to') || today
  const from = sp.get('from') || new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10)
  if (!DAY.test(from) || !DAY.test(to) || from > to) return { ok: false, error: 'from/to must be YYYY-MM-DD, from ≤ to' }
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > MAX_SPAN_DAYS) return { ok: false, error: 'date range too long (10 years max)' }
  q.from = from
  q.to = to

  // Default: whales/dolphins/porpoises — unless a taxon was named (it decides) or group=all.
  q.groups = sp.get('group') === 'all' ? null : (list(sp.get('group'), GROUPS) || (q.taxon !== undefined ? null : ['cetacean']))
  q.sources = list(sp.get('sources'), ORIGINS)
  q.exclude = list(sp.get('exclude'), ORIGINS)
  q.kind = ['sighting', 'acoustic'].includes(sp.get('kind')) ? sp.get('kind') : null
  q.limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(num(sp.get('limit')) ?? 500)))
  return { ok: true, q }
}

/** Build the WHERE clause + params (exported for tests). */
export function whereFor(q, S) {
  const p = []
  const add = (v) => { p.push(v); return `$${p.length}` }
  const w = ['s.removed_at IS NULL', `s.quality = 'ok'`, `s.observed_date BETWEEN ${add(q.from)}::date AND ${add(q.to)}::date`]
  if (q.bbox) {
    const [west, south, east, north] = q.bbox
    w.push(`s.lat BETWEEN ${add(south)} AND ${add(north)}`)
    if (west <= east) w.push(`s.lon BETWEEN ${add(west)} AND ${add(east)}`)
    else w.push(`(s.lon >= ${add(west)} OR s.lon <= ${add(east)})`)
  }
  if (q.point) {
    w.push(`ST_DWithin(s.geom, ST_SetSRID(ST_MakePoint(${add(q.point.lng)}, ${add(q.point.lat)}), 4326)::geography, ${add(q.point.r * 1000)})`)
  }
  if (q.taxon !== undefined) {
    const t = add(q.taxon)
    w.push(`s.inat_id IN (SELECT inat_id FROM ${S}.taxa WHERE inat_id = ${t} OR ${t} = ANY(ancestor_ids))`)
  }
  if (q.groups) w.push(`s.animal_group = ANY(${add(q.groups)}::text[])`)
  if (q.sources) w.push(`s.origin = ANY(${add(q.sources)}::text[])`)
  if (q.exclude) w.push(`NOT (s.origin = ANY(${add(q.exclude)}::text[]))`)
  if (q.kind) w.push(`s.kind = ${add(q.kind)}`)
  return { where: w.join(' AND '), params: p }
}

function toApi(r) {
  return {
    id: r.key,
    source: r.origin,
    via: r.via,
    kind: r.kind,
    // reported_as: the name the source itself used (e.g. HappyWhale's species key, Maplify's free text).
    taxon: { id: r.inat_id || null, scientific: r.scientific_name || null, common: r.common_name || null, rank: r.rank || null, group: r.animal_group, reported_as: r.raw_name },
    observed_at: r.observed_at ? new Date(r.observed_at).toISOString() : null,
    observed_date: r.observed_date,
    time_precision: r.time_precision,
    lat: r.lat,
    lng: r.lon,
    accuracy_m: r.accuracy_m,
    location_obscured: r.location_obscured,
    count: r.count_min === null && r.count_max === null ? null : { min: r.count_min, max: r.count_max },
    channel: r.channel,
    organization: r.organization ? { name: r.organization, url: r.organization_url } : null,
    observer: r.observer,
    attribution: r.attribution,
    url: r.url,
    license: r.license,
    photo: r.photo_url ? { url: r.photo_url, thumb: r.photo_thumb_url, license: r.photo_license, attribution: r.photo_attribution } : null,
    individual: r.individual_id || r.individual_label ? { id: r.individual_id, label: r.individual_label } : null,
    remarks: r.remarks ? String(r.remarks).slice(0, 600) : null,
    trusted: r.trusted,
    occurrence_id: r.occurrence_id || null,
  }
}

/** Run a parsed query. sql = a neon() tagged-template function (or anything with .query(text, params)). */
export async function queryWhales(sql, q, schema = 'whales') {
  const S = schemaIdent(schema)
  const { where, params } = whereFor(q, S)
  const run = (text, ps) => (typeof sql.query === 'function' ? sql.query(text, ps) : sql(text, ps))
  const rowsOf = (r) => (Array.isArray(r) ? r : r.rows)
  const rows = rowsOf(await run(
    `SELECT s.key, s.origin, s.via, s.kind, s.inat_id, s.raw_name, s.animal_group, s.observed_at, s.observed_date::text AS observed_date,
            s.time_precision, s.lat, s.lon, s.accuracy_m, s.location_obscured, s.count_min, s.count_max, s.channel,
            s.organization, s.organization_url, s.observer, s.attribution, s.url, s.license, s.photo_url, s.photo_thumb_url,
            s.photo_license, s.photo_attribution, s.individual_id, s.individual_label, s.remarks, s.trusted, s.occurrence_id,
            t.scientific_name, t.common_name, t.rank
     FROM ${S}.sightings s LEFT JOIN ${S}.taxa t ON t.inat_id = s.inat_id
     WHERE ${where}
     ORDER BY s.observed_date DESC, s.observed_at DESC NULLS LAST, s.key
     LIMIT ${q.limit + 1}`,
    params,
  ))
  const truncated = rows.length > q.limit
  const sightings = rows.slice(0, q.limit).map(toApi)

  const counts = rowsOf(await run(
    `SELECT s.origin, count(*)::int AS n FROM ${S}.sightings s WHERE ${where} GROUP BY 1`,
    params,
  ))
  const fresh = rowsOf(await run(
    `SELECT feed, max(finished_at) AS at FROM ${S}.ingest_runs WHERE ok GROUP BY 1`,
    [],
  ))
  const total = counts.reduce((a, c) => a + c.n, 0)
  return {
    query: q,
    count: sightings.length,
    total,
    truncated,
    sources: counts.sort((a, b) => b.n - a.n).map((c) => ({ id: c.origin, count: c.n, ...WHALE_SOURCES[c.origin] })),
    updated: Object.fromEntries(fresh.map((f) => [f.feed, f.at ? new Date(f.at).toISOString() : null])),
    sightings,
  }
}
