/**
 * Climate TRACE ports → /ships port cards (Josh, 2026-09-27: "use the Ports that we already have and add an
 * Emissions tab"). Climate TRACE estimates ship emissions per port (docs/CLIMATETRACE_FACTS.md):
 *   - a port is ONE approximate point for a whole port complex, and can appear inland;
 *   - its figure = voyage emissions assigned half to the departure port and half to the arrival port,
 *     NOT emissions from port operations ("onsite emissions from port operations are not included");
 *   - each port has up to two sources: domestic-shipping and international-shipping.
 *
 * Evidence: each Climate TRACE port source is stored as a raw record (source 'climate-trace', kind 'ct_port'),
 * from the facility bake EarthAtlas already runs for /inmotion (scripts/bake-climatetrace). The monthly numbers
 * are NOT copied here: the card reads them live from the same Climate TRACE detail /inmotion serves
 * (/api/trace-detail), so they follow each new release. The join to our ports is computed at read time.
 */
import { storeRawRecords, haversineKm } from './ports.js'
import { MAP_NAME_METHODS } from './portCard.js'

export const CLIMATE_TRACE_SOURCE = {
  id: 'climate-trace',
  name: 'Climate TRACE Emissions Inventory (ports: domestic and international shipping)',
  publisher: 'Climate TRACE coalition',
  homepage_url: 'https://climatetrace.org',
  license: 'CC BY 4.0',
  license_url: 'https://creativecommons.org/licenses/by/4.0/',
  commercial_use: true,
  attribution_text: 'Climate TRACE Emissions Inventory (climatetrace.org), CC BY 4.0',
  attribution_url: 'https://climatetrace.org',
  notes: 'Modelled estimates. A port is one approximate point for a whole port complex (can appear inland). Shipping '
    + 'emissions are voyage emissions assigned half to the departure and half to the arrival port, not port operations. '
    + 'Air pollutants for shipping use Climate TRACE\'s own shipping method. See docs/CLIMATETRACE_FACTS.md.',
}
export const CT_KIND = 'ct_port'
export const CT_SHIPPING_SUBS = ['domestic-shipping', 'international-shipping']
/** A Climate TRACE port joins one of our ports within this distance, or within CT_NAME_KM when the names agree. */
export const CT_JOIN_KM = 10
export const CT_NAME_KM = 30

/** One bake feature (scripts/bake-climatetrace build/features.geojsonl) → { key, payload } or { error }. */
export function mapCtPort(feature, release = null) {
  const p = feature?.properties || {}
  const [lon, lat] = feature?.geometry?.coordinates || []
  if (!CT_SHIPPING_SUBS.includes(p.sub)) return { error: `not a shipping source: ${p.sub}` }
  if (!Number.isFinite(p.id) || !Number.isFinite(lat) || !Number.isFinite(lon)) return { error: `bad feature ${p.id}` }
  // The monthly series (m) stays out: the card reads it live from the release's detail.
  return { key: String(p.id), payload: { id: p.id, name: p.n ?? null, sub: p.sub, country: p.c ?? null, lat, lon,
    owner: p.o ?? null, confidence: p.q ?? null, release } }
}

export async function ingestCtPorts(c, S, features, { release = null, ...opts } = {}) {
  const items = [], errors = []
  for (const f of features || []) { const m = mapCtPort(f, release); if (m.error) errors.push(m.error); else items.push(m) }
  const r = await storeRawRecords(c, S, CLIMATE_TRACE_SOURCE.id, CT_KIND, items, { datasetVersion: release, ...opts })
  return { rows: (features || []).length, stored: items.length, recordsCreated: r.created, errors }
}

const nameKey = (s) => String(s || '').toUpperCase().replace(/\b(PORT|OF|HARBOU?R|THE)\b/g, ' ').replace(/[^A-Z]/g, '')

/**
 * Which Climate TRACE port sources belong to this port. A source joins the port when it is within CT_JOIN_KM (or
 * CT_NAME_KM with the same name) AND no other of our ports (`peers`) is nearer to it, so each Climate TRACE port
 * lands on exactly one of ours. Pure. Returns [{ ...ct, km, by: 'distance' | 'name' }], nearest first.
 */
export function pickClimateTrace(port, cts, peers = []) {
  if (!Number.isFinite(port?.lat)) return []
  const out = []
  for (const ct of cts || []) {
    const km = haversineKm(port.lat, port.lon, ct.lat, ct.lon)
    const sameName = nameKey(ct.name) && nameKey(ct.name) === nameKey(port.name)
    if (km > CT_NAME_KM || (km > CT_JOIN_KM && !sameName)) continue
    // Another port of ours nearer to this Climate TRACE point takes it, unless only ours shares its name.
    const nearer = (peers || []).some((o) => o.id !== port.id && Number.isFinite(o.lat)
      && haversineKm(o.lat, o.lon, ct.lat, ct.lon) < km && !(sameName && nameKey(o.name) !== nameKey(ct.name)))
    if (nearer) continue
    out.push({ ...ct, km: Math.round(km * 10) / 10, by: km <= CT_JOIN_KM ? 'distance' : 'name' })
  }
  return out.sort((a, b) => a.km - b.km)
}

/** Stored Climate TRACE ports within `km` of a point (latest record each). q(text, params) → rows. */
export async function ctPortsNear(q, S, lat, lon, km = CT_NAME_KM) {
  const dLat = km / 111, dLon = km / (111 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)))
  const rows = await q(
    `SELECT DISTINCT ON (se.entity_key) sr.id AS record_id, sr.payload
       FROM ${S}.source_entities se JOIN ${S}.source_records sr ON sr.source_entity_id = se.id
      WHERE se.source_id = $1 AND se.entity_kind = $2
        AND (sr.payload->>'lat')::float8 BETWEEN $3 AND $4 AND (sr.payload->>'lon')::float8 BETWEEN $5 AND $6
      ORDER BY se.entity_key, sr.last_retrieved_at DESC, sr.id DESC`,
    [CLIMATE_TRACE_SOURCE.id, CT_KIND, lat - dLat, lat + dLat, lon - dLon, lon + dLon])
  return rows.map((r) => ({ ...r.payload, record_id: r.record_id }))
}

/** Our map ports near a point (the portsLayer rule), the peers a Climate TRACE port could belong to instead. */
export async function ourPortsNear(q, S, lat, lon, km = CT_NAME_KM * 2) {
  const dLat = km / 111, dLon = km / (111 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)))
  return q(`SELECT p.id, p.name, p.lat, p.lon FROM ${S}.ports p
             WHERE p.lat BETWEEN $1 AND $2 AND p.lon BETWEEN $3 AND $4 AND p.name IS NOT NULL
               AND (p.origin = 'wpi' OR (p.name_method = ANY($5) AND EXISTS (SELECT 1 FROM ${S}.port_aliases a
                     WHERE a.port_id = p.id AND a.key_kind = 'gfw_port_label' AND a.status = 'accepted')))`,
  [lat - dLat, lat + dLat, lon - dLon, lon + dLon, MAP_NAME_METHODS])
}

/** A port's Climate TRACE sources (the Emissions tab's join). */
export async function portClimateTrace(q, S, portId) {
  const [port] = await q(`SELECT id, name, lat, lon FROM ${S}.ports WHERE id = $1`, [portId])
  if (!port) return null
  const cts = await ctPortsNear(q, S, port.lat, port.lon)
  const peers = cts.length ? await ourPortsNear(q, S, port.lat, port.lon) : []
  return { port, joined: pickClimateTrace(port, cts, peers), nearby: cts.length }
}
