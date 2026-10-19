/**
 * Place names for ports whose name is a guess (Josh 2026-10-18): GFW clusters named after the nearest anchorage label
 * ("Deer Harbor" on both Jones Island and West Sound) or not named at all. Plain nearest, in two tiers:
 *   1. a GeoNames maritime place (marina, harbor, anchorage, port, dock, pier, wharf, ferry terminal …) within 0.5 km;
 *   2. else the nearest GeoNames island / bay / channel / point / town within 2 km;
 *   3. else, in Canada, the nearest official name in the Canadian Geographical Names Database within 2 km.
 * GFW's own names (an exact overrides label or GFW's anchorage name) are replaced only by a maritime place that is "much closer":
 * within 0.5 km, while the nearest place carrying GFW's name is more than 0.5 km away and at least 3 times farther (or not near at all).
 * WPI names are never replaced. Every name used is stored as a raw source record (evidence) and linked from the port.
 */
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { haversineKm, storeRawRecords, csvRows } from './ports.js'
import { upsertSource } from './store.js'

export const GEONAMES_PLACES_SOURCE = {
  id: 'geonames-places', name: 'GeoNames geographical database (country dumps)', publisher: 'GeoNames',
  homepage_url: 'https://www.geonames.org/', license: 'CC BY 4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/',
  commercial_use: true, attribution_text: 'GeoNames (geonames.org), CC BY 4.0.', attribution_url: 'https://www.geonames.org/',
  notes: 'Daily country dumps https://download.geonames.org/export/dump/<CC>.zip (US, CA). Used to name ports whose name was a guess; feature codes per https://www.geonames.org/export/codes.html.',
}
export const CGNDB_SOURCE = {
  id: 'nrcan-cgndb', name: 'Canadian Geographical Names Database (CGNDB)', publisher: 'Natural Resources Canada (Geographical Names Board of Canada)',
  homepage_url: 'https://natural-resources.canada.ca/earth-sciences/geography/geographical-names-board-canada/download-geographical-names-data/9245',
  license: 'Open Government Licence – Canada', license_url: 'https://open.canada.ca/en/open-government-licence-canada', commercial_use: true,
  attribution_text: 'Contains information licensed under the Open Government Licence – Canada (Canadian Geographical Names Database, Natural Resources Canada).',
  attribution_url: 'https://geogratis.gc.ca/services/geoname/en/geonames',
  notes: 'GeoNames web service on geogratis.gc.ca, radius search around a port (CSV). Fallback for Canadian ports GeoNames cannot name.',
}
export const PLACE_SOURCES = [GEONAMES_PLACES_SOURCE, CGNDB_SOURCE]
export const PLACE_KIND = { geonames: 'geonames_feature', cgndb: 'cgndb_name' }

// GeoNames feature codes (https://www.geonames.org/export/codes.html)
export const GEONAMES_MARITIME = new Set(['MAR', 'HBR', 'HBRX', 'ANCH', 'PRT', 'DCK', 'DCKB', 'DCKY', 'PIER', 'WHRF', 'QUAY', 'FY', 'LDNG', 'JTY', 'MOLE'])
export const GEONAMES_PLACE = new Set(['ISL', 'ISLS', 'ISLT', 'BAY', 'BAYS', 'COVE', 'INLT', 'CHN', 'CHNM', 'STRT', 'SD', 'CAPE', 'PT', 'PTS', 'SPIT', 'PEN',
  'PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLC', 'PPLL', 'PPLX'])
// CGNDB concise codes: bays, capes, channels, islands, marine features, populated places
export const CGNDB_PLACE = new Set(['BAY', 'CAPE', 'CHAN', 'ISL', 'MAR', 'UNP', 'CITY', 'TOWN', 'VILG', 'HAM'])
export const GEONAMES_FIELDS = ['geonameid', 'name', 'asciiname', 'alternatenames', 'latitude', 'longitude', 'feature_class', 'feature_code',
  'country_code', 'cc2', 'admin1_code', 'admin2_code', 'admin3_code', 'admin4_code', 'population', 'elevation', 'dem', 'timezone', 'modification_date']

export const MARITIME_KM = 0.5, PLACE_KM = 2, MUCH_CLOSER = 3
const GUESS_METHODS = new Set(['gfw_override_nearest', 'unnamed', 'wpi_near_approx'])
const GFW_NAME_METHODS = new Set(['gfw_override_label', 'gfw_override_label_majority', 'gfw_event_name'])

/** A GeoNames dump line → its raw record (named fields, as published). */
export function parseGeonamesLine(line) {
  const f = line.split('\t')
  if (f.length < 19) return null
  return Object.fromEntries(GEONAMES_FIELDS.map((k, i) => [k, f[i]]))
}
/** Is a GeoNames record one we name ports with? */
export const isUsefulGeonames = (r) => r && (GEONAMES_MARITIME.has(r.feature_code) || GEONAMES_PLACE.has(r.feature_code))

/** A stored place record (either source) → { name, lat, lon, tier, code, source_id, key }. */
export function mapPlace(sourceId, payload) {
  const lat = Number(payload.latitude), lon = Number(payload.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !payload.name) return null
  if (sourceId === GEONAMES_PLACES_SOURCE.id) {
    const code = payload.feature_code
    const tier = GEONAMES_MARITIME.has(code) ? 'maritime' : GEONAMES_PLACE.has(code) ? 'place' : null
    return tier ? { name: payload.name, lat, lon, tier, code: `${payload.feature_class}.${code}`, source_id: sourceId, key: payload.geonameid, country: payload.country_code } : null
  }
  if (sourceId === CGNDB_SOURCE.id) {
    const code = payload['concise.code']
    return CGNDB_PLACE.has(code) ? { name: payload.name, lat, lon, tier: 'official_ca', code, source_id: sourceId, key: payload.id, country: 'CA' } : null
  }
  return null
}

// Harbour = Harbor (Canadian / US spelling of the same place name).
const nameKey = (s) => String(s || '').toUpperCase().replace(/HARBOUR/g, 'HARBOR').replace(/[^A-Z0-9]/g, '')

/** The nearest place of a tier within maxKm of a point (plain nearest). */
function nearestOf(places, pt, tier, maxKm) {
  let best = null
  for (const p of places) {
    if (p.tier !== tier) continue
    const d = haversineKm(pt.lat, pt.lon, p.lat, p.lon)
    if (d <= maxKm && (!best || d < best.d)) best = { ...p, d }
  }
  return best
}

/** The place name for a port at `pt` by the tiers above (null when none qualifies). */
export function pickPlaceName(places, pt, { canada = false } = {}) {
  return nearestOf(places, pt, 'maritime', MARITIME_KM) || nearestOf(places, pt, 'place', PLACE_KM)
    || (canada ? nearestOf(places, pt, 'official_ca', PLACE_KM) : null)
}

/**
 * A matchLabel decision → the same decision, renamed after a place when the rules say so. `pt` is the port's main
 * anchorage point (most visits). The decision keeps its WPI match and notes; the previous name goes into candidates.
 */
export function applyPlaceName(decision, places, pt, { canada = false } = {}) {
  if (!pt || !places?.length) return decision
  const base = decision.method.replace(/_over_wpi_facility$/, '')
  const guess = GUESS_METHODS.has(base), gfwName = GFW_NAME_METHODS.has(base)
  if (!guess && !gfwName) return decision                                  // WPI names stay
  const place = pickPlaceName(places, pt, { canada })
  if (!place || (decision.name && nameKey(place.name) === nameKey(decision.name))) return decision
  if (gfwName) {
    // Only a marina / harbor / terminal outranks GFW's own name; a nearby bay, island or town does not (Shaw Island ≠ "Blind Bay").
    if (place.tier !== 'maritime' || place.d > MARITIME_KM) return decision
    // GFW's name is kept unless the place is much closer than any place that carries GFW's name.
    let named = Infinity
    for (const p of places) if (nameKey(p.name) === nameKey(decision.name)) named = Math.min(named, haversineKm(pt.lat, pt.lon, p.lat, p.lon))
    // …and kept when GFW's name IS the place: one carrying that name within 0.5 km (Deer Harbor: the village 380 m away; two marinas inside it).
    if (named <= MARITIME_KM || named < MUCH_CLOSER * place.d) return decision
  }
  const method = place.source_id === CGNDB_SOURCE.id ? 'cgndb_nearest' : place.tier === 'maritime' ? 'geonames_maritime_nearest' : 'geonames_place_nearest'
  return {
    ...decision,
    method: gfwName ? `${method}_over_gfw_name` : method,
    name: place.name,
    name_source_id: place.source_id,
    name_record_id: place.record_id ?? null,
    place: { key: place.key, code: place.code, distance_km: Math.round(place.d * 1000) / 1000 },
    candidates: [...(decision.candidates || []), ...(decision.name ? [{ kind: 'previous_name', name: decision.name, method: decision.method }] : [])],
    notes: [...(decision.notes || []), `named after ${place.code} "${place.name}" ${Math.round(place.d * 1000)} m away (${place.source_id})`],
  }
}

// ── Storage ──────────────────────────────────────────────────────────────────

export const NEAR_LOAD_KM = 6   // records kept / loaded around each port point (rules use ≤ 2 km; the margin finds "places named like GFW's name")

export async function ensurePlaceSources(c, S) { for (const s of PLACE_SOURCES) await upsertSource(c, S, s) }

const box = (pts, km) => pts.map((p) => ({ s: p.lat - km / 111, n: p.lat + km / 111, w: p.lon - km / (111 * Math.max(Math.cos(p.lat * Math.PI / 180), 0.01)),
  e: p.lon + km / (111 * Math.max(Math.cos(p.lat * Math.PI / 180), 0.01)) }))

/** GeoNames dump files (US.txt, CA.txt …) → the useful records near any of `pts`, stored as raw records. */
export async function ingestGeonamesNear(c, S, files, pts, { runId = null, datasetVersion = null } = {}) {
  const boxes = box(pts, NEAR_LOAD_KM)
  const items = []
  for (const file of files) {
    const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })
    for await (const line of rl) {
      const r = parseGeonamesLine(line)
      if (!isUsefulGeonames(r)) continue
      const la = Number(r.latitude), lo = Number(r.longitude)
      if (boxes.some((b) => la >= b.s && la <= b.n && lo >= b.w && lo <= b.e)) items.push({ key: r.geonameid, payload: r })
    }
  }
  const { created } = await storeRawRecords(c, S, GEONAMES_PLACES_SOURCE.id, PLACE_KIND.geonames, items,
    { runId, retrievalUrl: 'https://download.geonames.org/export/dump/', datasetVersion })
  return { kept: items.length, created }
}

/** Canadian official names (CGNDB radius search, one request per Canadian point) → stored as raw records. */
export async function ingestCgndbNear(c, S, pts, { fetchText, runId = null } = {}) {
  const items = []
  let requests = 0
  // One request per ~8 km grid cell, at its center: a 6 km radius (NEAR_LOAD_KM) reaches the cell's corners (5.7 km).
  const cells = new Map()
  for (const p of pts) {
    const i = Math.floor(p.lat / 0.072), j = Math.floor(p.lon / 0.108)
    cells.set(`${i},${j}`, { lat: (i + 0.5) * 0.072, lon: (j + 0.5) * 0.108 })
  }
  for (const p of cells.values()) {
    const url = `https://geogratis.gc.ca/services/geoname/en/geonames.csv?lat=${p.lat.toFixed(5)}&lon=${p.lon.toFixed(5)}&radius=${NEAR_LOAD_KM}`
    requests++
    const rows = csvRows(await fetchText(url))
    if (!rows.length) continue
    const head = rows[0].map((h) => h.replace(/^﻿/, ''))
    for (const r of rows.slice(1)) {
      const o = Object.fromEntries(head.map((h, i) => [h, r[i]]))
      if (o.id && CGNDB_PLACE.has(o['concise.code'])) items.push({ key: o.id, payload: o })
    }
  }
  const { created } = await storeRawRecords(c, S, CGNDB_SOURCE.id, PLACE_KIND.cgndb, items,
    { runId, retrievalUrl: 'https://geogratis.gc.ca/services/geoname/en/geonames', datasetVersion: null })
  return { requests, kept: items.length, created }
}

/** Stored place records near any of `pts`, mapped for the rules (with their source record id). */
export async function loadPlacesNear(c, S, pts) {
  if (!pts.length) return []
  const { rows } = await c.query(
    `SELECT DISTINCT ON (sr.id) se.source_id, sr.id AS record_id, sr.payload
       FROM ${S}.source_entities se JOIN ${S}.source_records sr ON sr.source_entity_id = se.id
       JOIN jsonb_to_recordset($2::jsonb) AS q(s double precision, n double precision, w double precision, e double precision)
         ON (sr.payload->>'latitude') ~ '^-?[0-9.]+$' AND (sr.payload->>'longitude') ~ '^-?[0-9.]+$'
        AND (sr.payload->>'latitude')::float8 BETWEEN q.s AND q.n AND (sr.payload->>'longitude')::float8 BETWEEN q.w AND q.e
      WHERE se.source_id = ANY($1)`,
    [PLACE_SOURCES.map((s) => s.id), JSON.stringify(box(pts, NEAR_LOAD_KM))])
  return rows.map((r) => { const m = mapPlace(r.source_id, r.payload); return m && { ...m, record_id: Number(r.record_id) } }).filter(Boolean)
}

// ── Positions for World Port Index ports (Josh 2026-10-18) ───────────────────
// WPI gives positions to the nearest minute of latitude/longitude (Orcas: 48°36′N 122°56′W, inland; Friday Harbor in town),
// so a WPI port is drawn at better evidence of where it is, kept beside the WPI coordinates (never replacing them):
//   1. a GeoNames harbor / port / marina / ferry landing whose name contains the port's name, within 3 km (harbor/port first);
//   2. else the busiest anchorage point of a GFW port of the same name matched to it (where boats actually stop);
//   3. else the GeoNames town / bay of the same name within 3 km;
//   4. else the WPI position.
export const POSITION_KM = 3
export const TOWN_BAY_KM = 1
const TOWN_WATER = new Set(['BAY', 'COVE', 'HBR', 'INLT', 'SD'])
const HARBOR_FIRST = { HBR: 0, PRT: 0, HBRX: 0, MAR: 1, FY: 1, LDNG: 1, PIER: 2, WHRF: 2, DCK: 2, QUAY: 2 }

/** port: { name, lat, lon }; places: loadPlacesNear() output; gfwPoints: [{ label, lat, lon, visits }] of same-name GFW ports. */
export function pickPortPosition(port, places, gfwPoints = []) {
  const key = nameKey(port.name)
  if (!key) return null
  const dist = (p) => haversineKm(port.lat, port.lon, p.lat, p.lon)
  const named = places.filter((p) => p.source_id === GEONAMES_PLACES_SOURCE.id && nameKey(p.name).includes(key) && dist(p) <= POSITION_KM)
  const maritime = named.filter((p) => p.tier === 'maritime' && p.code.split('.').pop() in HARBOR_FIRST)
    .sort((a, b) => HARBOR_FIRST[a.code.split('.').pop()] - HARBOR_FIRST[b.code.split('.').pop()] || dist(a) - dist(b))[0]
  if (maritime) return { lat: maritime.lat, lon: maritime.lon, method: 'geonames_named_harbor', source_id: maritime.source_id, record_id: maritime.record_id ?? null,
    name: maritime.name, code: maritime.code, distance_km: Math.round(dist(maritime) * 1000) / 1000 }
  const g = [...gfwPoints].sort((a, b) => b.visits - a.visits)[0]
  if (g && dist(g) <= POSITION_KM) return { lat: g.lat, lon: g.lon, method: 'gfw_busiest_anchorage', source_id: 'gfw-port-visits', record_id: null,
    name: g.label, visits: g.visits, distance_km: Math.round(dist(g) * 1000) / 1000 }
  const place = named.filter((p) => p.tier === 'place' && nameKey(p.name) === key).sort((a, b) => dist(a) - dist(b))[0]
  if (!place) return null
  // A town's point is usually inland (Richardson, Lopez Island: 190 m up the road). Its harbor is the bay or cove nearest the
  // town, within TOWN_BAY_KM (Josh 2026-10-19): Jones Bay, 480 m away.
  if (place.code.startsWith('P.')) {
    const bay = places.filter((p) => p.source_id === GEONAMES_PLACES_SOURCE.id && TOWN_WATER.has(p.code.split('.').pop()))
      .map((p) => ({ p, d: haversineKm(place.lat, place.lon, p.lat, p.lon) })).filter((x) => x.d <= TOWN_BAY_KM).sort((a, b) => a.d - b.d)[0]?.p
    if (bay) return { lat: bay.lat, lon: bay.lon, method: 'geonames_bay_by_same_name_place', source_id: bay.source_id, record_id: bay.record_id ?? null,
      name: bay.name, code: bay.code, distance_km: Math.round(dist(bay) * 1000) / 1000,
      town: { name: place.name, code: place.code, record_id: place.record_id ?? null, distance_km: Math.round(haversineKm(place.lat, place.lon, bay.lat, bay.lon) * 1000) / 1000 } }
  }
  return { lat: place.lat, lon: place.lon, method: 'geonames_same_name_place', source_id: place.source_id, record_id: place.record_id ?? null,
    name: place.name, code: place.code, distance_km: Math.round(dist(place) * 1000) / 1000 }
}

/** Store pickPortPosition() for WPI ports (detail.position; WPI lat/lon untouched). ids: port ids. Returns the decisions. */
export async function positionWpiPorts(c, S, ids) {
  const { rows: ports } = await c.query(`SELECT id, name, lat::float8 AS lat, lon::float8 AS lon, detail FROM ${S}.ports WHERE origin = 'wpi' AND id = ANY($1::bigint[])`, [ids])
  const out = []
  for (const port of ports) {
    const places = await loadPlacesNear(c, S, [port])
    // Same-name GFW ports matched to this WPI port, with their busiest anchorage point.
    const { rows: gfw } = await c.query(
      `SELECT a.key AS label, x.anchorage_id, count(*)::int AS visits, avg(x.lat)::float8 AS lat, avg(x.lon)::float8 AS lon
         FROM ${S}.port_aliases a JOIN ${S}.port_visits pv ON pv.int_port_label = a.key AND pv.status = 'active'
         CROSS JOIN LATERAL (VALUES (pv.int_anchorage_id, pv.int_lat, pv.int_lon)) AS x(anchorage_id, lat, lon)
        WHERE a.port_id = $1 AND a.key_kind = 'gfw_port_label' AND a.status = 'accepted' AND x.lat IS NOT NULL
        GROUP BY a.key, x.anchorage_id`, [port.id])
    const same = gfw.filter((g) => nameKey(g.label.replace(/^[a-z]{3}-/, '')) === nameKey(port.name))
    const pos = pickPortPosition(port, places, same)
    await c.query(`UPDATE ${S}.ports SET detail = CASE WHEN $2::jsonb IS NULL THEN detail - 'position' ELSE detail || jsonb_build_object('position', $2::jsonb) END,
                   updated_at = now() WHERE id = $1`, [port.id, pos ? JSON.stringify(pos) : null])
    out.push({ id: port.id, name: port.name, wpi: [port.lat, port.lon], position: pos })
  }
  return out
}

// ── GeoNames marinas and harbors as ports (Josh 2026-10-18) ─────────────────
export const LISTED_CODES = new Set(['MAR', 'HBR', 'LDNG', 'FY', 'ANCH', 'PRT'])
export const LISTED_SKIP_KM = 0.5, LISTED_SAME_NAME_KM = 2

/**
 * GeoNames marinas / harbors / landings / ferry terminals / anchorages / ports inside box [w, s, e, n] that no port of ours
 * already covers → ports of origin 'geonames'. drawn: the ports already on the map ([{ id, name, lat, lon }], e.g. from
 * portsLayer) — a GeoNames place within 0.5 km of one, or within 2 km of a same-named one, is skipped. Idempotent.
 */
export async function importGeonamesPorts(c, S, files, [w, s, e, n], drawn, { runId = null } = {}) {
  const rows = []
  for (const file of files) {
    const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })
    for await (const line of rl) {
      const r = parseGeonamesLine(line)
      if (!r || !LISTED_CODES.has(r.feature_code)) continue
      const la = Number(r.latitude), lo = Number(r.longitude)
      if (la >= s && la <= n && lo >= w && lo <= e) rows.push(r)
    }
  }
  const { byKey } = await storeRawRecords(c, S, GEONAMES_PLACES_SOURCE.id, PLACE_KIND.geonames, rows.map((r) => ({ key: r.geonameid, payload: r })),
    { runId, retrievalUrl: 'https://download.geonames.org/export/dump/' })
  const { rows: cty } = await c.query(`SELECT iso2, iso3 FROM ${S}.countries`)
  const iso3of = new Map(cty.map((x) => [x.iso2, x.iso3]))
  const others = drawn.filter((d) => d.origin !== 'geonames')
  const decisions = []
  for (const r of rows) {
    const la = Number(r.latitude), lo = Number(r.longitude)
    const near = others.map((d) => ({ ...d, km: haversineKm(la, lo, d.lat, d.lon) })).sort((a, b) => a.km - b.km)
    const close = near.find((d) => d.km <= LISTED_SKIP_KM)
    const same = near.find((d) => d.km <= LISTED_SAME_NAME_KM && nameKey(d.name) === nameKey(r.name))
    if (close || same) { decisions.push({ geonameid: r.geonameid, name: r.name, skipped: (close || same).name, km: Math.round((close || same).km * 1000) / 1000 }); continue }
    const recId = (byKey.get(r.geonameid) || []).at(-1) ?? null
    const { rows: [p] } = await c.query(
      `INSERT INTO ${S}.ports AS t (origin, origin_key, name, name_source_id, name_field, name_method, name_source_record_id, iso2, iso3, lat, lon, detail)
       VALUES ('geonames', $1, $2, $3, 'name', 'geonames_listed', $4, $5, $6, $7, $8, $9)
       ON CONFLICT (origin, origin_key) DO UPDATE SET name = EXCLUDED.name, name_source_record_id = EXCLUDED.name_source_record_id,
         iso2 = EXCLUDED.iso2, iso3 = EXCLUDED.iso3, lat = EXCLUDED.lat, lon = EXCLUDED.lon, detail = EXCLUDED.detail, updated_at = now()
       RETURNING id`,
      [r.geonameid, r.name, GEONAMES_PLACES_SOURCE.id, recId, r.country_code, iso3of.get(r.country_code) ?? null, la, lo,
        { code: `${r.feature_class}.${r.feature_code}` }])
    decisions.push({ geonameid: r.geonameid, name: r.name, port_id: Number(p.id), code: r.feature_code })
  }
  return { listed: rows.length, added: decisions.filter((d) => d.port_id).length, skipped: decisions.filter((d) => d.skipped).length, decisions }
}

// ── "Blind Bay (Shaw Island)": the water body first when a port's name is an island or town (Josh 2026-10-19) ──
// GFW named the Blind Bay anchorage "Shaw Island", which reads as the island itself. When a port's name is a GeoNames
// island / town and a GeoNames bay / cove / harbor / inlet / sound lies within BAY_KM of where boats stop, the port is
// shown as "<bay> (<island or town>)". Names that are already specific (Deer Harbor, a marina) are left alone.
export const BAY_KM = 0.3
const BROAD = new Set(['ISL', 'ISLS', 'ISLT', 'PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLC', 'PPLL', 'PPLX'])
const WATER = new Set(['BAY', 'BAYS', 'COVE', 'HBR', 'INLT', 'SD'])
const WATER_WORD = /\b(harbou?r|bay|cove|inlet|sound|pass|passage|narrows|lagoon|marina|anchorage|basin|channel)\b/i

export function qualifyWithBay(decision, places, pt) {
  if (!decision?.name || !pt || !places?.length || /^wpi_/.test(decision.method)) return decision
  // A name that already names water (Deer Harbor, Pender Harbour, Bedwell Harbour: towns named after their harbor) stays.
  if (WATER_WORD.test(decision.name)) return decision
  const key = nameKey(decision.name)
  const broad = places.find((p) => p.source_id === GEONAMES_PLACES_SOURCE.id && nameKey(p.name) === key && BROAD.has(p.code.split('.').pop()))
  if (!broad) return decision
  const bay = places.filter((p) => p.source_id === GEONAMES_PLACES_SOURCE.id && WATER.has(p.code.split('.').pop()) && nameKey(p.name) !== key)
    .map((p) => ({ ...p, d: haversineKm(pt.lat, pt.lon, p.lat, p.lon) })).filter((p) => p.d <= BAY_KM).sort((a, b) => a.d - b.d)[0]
  if (!bay) return decision
  return {
    ...decision,
    method: `${decision.method}_with_bay`,
    name: `${bay.name} (${broad.name})`,
    name_source_id: bay.source_id,
    name_record_id: bay.record_id ?? null,
    place: { key: bay.key, code: bay.code, distance_km: Math.round(bay.d * 1000) / 1000, context: broad.name },
    candidates: [...(decision.candidates || []), { kind: 'previous_name', name: decision.name, method: decision.method }],
    notes: [...(decision.notes || []), `"${broad.name}" is an island / town: shown as the ${bay.code} "${bay.name}" ${Math.round(bay.d * 1000)} m away, with it in brackets`],
  }
}
