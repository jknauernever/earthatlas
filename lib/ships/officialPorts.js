/**
 * Official port names and status for /ships ports (Josh approved docs/OFFICIAL_PORT_LISTS.md "PROPOSED plan",
 * 2026-09-27). World Port Index stays the map point and the card title; official lists add a verified line under it,
 * plus DFO small craft harbours that no map port covers. Rules: src/ships/CLAUDE.md. Schema: migrations/013.
 *
 *   evidence        source_records, exactly as received:
 *                     'dfo-sch'           kind dfo_sch_harbour   one DFO Small Craft Harbours ESRI feature (+ its layer)
 *                     'usace-port-areas'  kind usace_port_area   one USACE/BTS "Port Areas" polygon feature
 *                     'ca-official-ports' kind hand_row          one row of lib/ships/data/ca-official-ports.json
 *                                         kind web_page          one Transport Canada / Justice Laws page a row cites
 *   interpretation  port_aliases (key kinds dfo_sch_harbour / usace_port_area / ca_port_authority / tc_public_port):
 *                   which of our ports an official entry is. 'accepted' shows on the card; 'candidate' never does.
 *                   ports of origin 'dfo_sch': a DFO harbour with no map port within MATCH_KM.
 *
 * Match rules (pure, unit-tested):
 *   DFO harbour → the one Canadian map port within SAME_SPOT_KM (0.5 km), whatever its name (Josh 2026-09-27); else
 *   the map port within MATCH_KM (4 km), same country, whose name shares a main word with the harbour's
 *     → accepted. Map ports within 4 km but no shared word → candidates only. No map port within 4 km (any country)
 *     → a new 'dfo_sch' port.
 *   Hand table (Canada Port Authorities, TC public ports) → the WPI port numbers listed in the row; a row whose check
 *     text is missing from any cited page, or whose WPI number we don't have, is stored as candidate only.
 *   USACE Port Area → the US WPI port whose point lies inside exactly one Port Area polygon. Inside two → candidates
 *     (never guessed). The polygons are for matching only; they are not drawn.
 */
import { storeRawRecords, haversineKm, MATCH_KM, CLEAR_RATIO } from './ports.js'
import { upsertSource } from './store.js'
import { withTx } from './db.js'
import { MAP_NAME_METHODS } from './portCard.js'

// ── Sources (licence facts: docs/OFFICIAL_PORT_LISTS.md) ─────────────────────

export const DFO_SCH_SOURCE = {
  id: 'dfo-sch',
  name: 'Small Craft Harbours Locations and Information (Fisheries and Oceans Canada)',
  publisher: 'Government of Canada; Fisheries and Oceans Canada; Integrated Oceans Management',
  homepage_url: 'https://open.canada.ca/data/en/dataset/262451e7-6416-47b5-8453-f31d212ea657',
  license: 'Open Government Licence – Canada',
  license_url: 'https://open.canada.ca/en/open-government-licence-canada',
  commercial_use: true,
  attribution_text: 'Contains information licensed under the Open Government Licence – Canada. Small Craft Harbours, Fisheries and Oceans Canada.',
  attribution_url: 'https://open.canada.ca/en/open-government-licence-canada',
  notes: 'OGL-Canada, quoted: "You are free to: Copy, modify, publish, translate, adapt, distribute or otherwise use the '
    + 'Information in any medium, mode or format for any lawful purpose." Read from the ESRI REST MapServer '
    + '(egisp.dfo-mpo.gc.ca …/small_craft_harbours_en/MapServer, layers 0 Core Fishing, 1 Non-Core Fishing, 2 Recreational). '
    + 'Record modified 2026-03-24, frequency as_needed. Known data errors: "Musgrave " has Province MB (it is on Salt Spring '
    + 'Island, BC); "Mcivor\'s Landing" has an empty Managed_by.',
}
export const USACE_PORT_AREAS_SOURCE = {
  id: 'usace-port-areas',
  name: 'Port Areas (Port and Port Statistical Areas), U.S. Army Corps of Engineers',
  publisher: 'U.S. Army Corps of Engineers (USACE), Waterborne Commerce Statistics Center; distributed by BTS (NTAD)',
  homepage_url: 'https://geodata.bts.gov/datasets/usdot::port-areas',
  license: 'US Government work (17 U.S.C. §105); item licence note quoted in notes',
  license_url: 'https://www.law.cornell.edu/uscode/text/17/105',
  commercial_use: true,
  attribution_text: 'Port Areas: U.S. Army Corps of Engineers (USACE) / Bureau of Transportation Statistics (BTS).',
  attribution_url: 'https://geodata.bts.gov/datasets/usdot::port-areas',
  notes: 'FeatureServer https://services7.arcgis.com/n1YM8pTrFmm7L4hs/arcgis/rest/services/Port_Statistical_Area/FeatureServer/0. '
    + 'Item licenseInfo, quoted: "Port boundaries are for statistical data collection and tabulation purposes only. Their '
    + 'depiction and designation for statistical purposes does not constitute a determination of jurisdictional authority '
    + 'or rights of ownership or entitlement and they are not legal land descriptions." PORTIDPK = USACE port code. '
    + 'Used only to match our WPI ports (point in polygon); the polygons are not drawn.',
}
export const CA_OFFICIAL_SOURCE = {
  id: 'ca-official-ports',
  name: 'Canada Port Authorities and Transport Canada public ports (EarthAtlas hand-kept table from Transport Canada and the Canada Marine Act)',
  publisher: 'Transport Canada; Department of Justice Canada (Justice Laws); table kept by EarthAtlas',
  homepage_url: 'https://tc.canada.ca/en/marine-transportation/ports-harbours-anchorages',
  license: 'Federal law text: Reproduction of Federal Law Order (SI/97-5). Transport Canada pages: Canada.ca terms (not read, UNVERIFIED)',
  license_url: 'https://laws-lois.justice.gc.ca/eng/regulations/SI-97-5/FullText.html',
  commercial_use: true,
  attribution_text: 'Canada Port Authorities and public ports: Transport Canada; Canada Marine Act and Public Ports and Public Port Facilities Regulations (Justice Laws).',
  attribution_url: 'https://tc.canada.ca/en/marine-transportation/ports-harbours-anchorages',
  notes: 'Reproduction of Federal Law Order, quoted: "Anyone may, without charge or request for permission, reproduce enactments '
    + 'and consolidations of enactments of the Government of Canada … provided due diligence is exercised in ensuring the '
    + 'accuracy of the materials reproduced and the reproduction is not represented as an official version." The names and '
    + 'status shown come from the Canada Marine Act Schedule and SOR/2001-154 Schedule 1 (federal law); the TC pages are '
    + 'cross-checks. canada.ca/en/transparency/terms.html could not be fetched on 2026-09-27, so reuse terms for the TC page '
    + 'text itself are UNVERIFIED. Which WPI ports each row covers is EarthAtlas\'s crosswalk (lib/ships/data/ca-official-ports.json).',
}
export const OFFICIAL_SOURCES = [DFO_SCH_SOURCE, USACE_PORT_AREAS_SOURCE, CA_OFFICIAL_SOURCE]
export const OFFICIAL_SOURCE_IDS = OFFICIAL_SOURCES.map((s) => s.id)
export const OFFICIAL_KINDS = ['ca_port_authority', 'tc_public_port', 'usace_port_area', 'dfo_sch_harbour'] // display order
export const SOURCE_SHORT = { [DFO_SCH_SOURCE.id]: 'DFO', [USACE_PORT_AREAS_SOURCE.id]: 'USACE', [CA_OFFICIAL_SOURCE.id]: 'TC' }
export const KIND = { dfo: 'dfo_sch_harbour', usace: 'usace_port_area', row: 'hand_row', page: 'web_page' }

export const DFO_URL = 'https://egisp.dfo-mpo.gc.ca/arcgis/rest/services/open_data_donnees_ouvertes/small_craft_harbours_en/MapServer'
export const DFO_LAYERS = [{ id: 0, name: 'Core Fishing' }, { id: 1, name: 'Non-Core Fishing' }, { id: 2, name: 'Recreational' }]
export const USACE_URL = 'https://services7.arcgis.com/n1YM8pTrFmm7L4hs/arcgis/rest/services/Port_Statistical_Area/FeatureServer/0'
export const SALISH_BBOX = [-125.5, 47, -122, 50.5] // W,S,E,N

/** The ESRI query URL for one layer, bbox [W,S,E,N] or null (all), paged. */
export function esriQueryUrl(base, { bbox = null, offset = 0, count = 1000, orderBy = 'OBJECTID' } = {}) {
  const qs = new URLSearchParams({ where: '1=1', outFields: '*', outSR: '4326', orderByFields: orderBy, f: 'json',
    resultOffset: String(offset), resultRecordCount: String(count) })
  if (bbox) { qs.set('geometry', bbox.join(',')); qs.set('geometryType', 'esriGeometryEnvelope'); qs.set('inSR', '4326'); qs.set('spatialRel', 'esriSpatialRelIntersects') }
  return `${base}/query?${qs}`
}

// ── Pure: names ──────────────────────────────────────────────────────────────

const tidy = (s) => (s == null ? null : String(s).replace(/\s+/g, ' ').trim() || null)
// Words that say what kind of place it is, not which one (so "Cowichan Bay" ↔ "Cowichan Bay" matches on COWICHAN only).
const GENERIC = new Set(['PORT', 'HARBOUR', 'HARBOR', 'HBR', 'THE', 'OF', 'AND', 'INNER', 'OUTER', 'BREAKWATER', 'LANDING', 'WHARF',
  'FISHING', 'BAY', 'COVE', 'INLET', 'ISLAND', 'RIVER', 'CREEK', 'SLOUGH', 'CITY', 'NORTH', 'SOUTH', 'EAST', 'WEST', 'HEAD', 'POINT',
  'MARINA', 'DOCK', 'TERMINAL', 'FERRY', 'GULF', 'DE', 'LA', 'LE', 'DU', 'DES'])
/** The main words of a name (upper-case, accents dropped, generic words removed). Pure. */
export function nameWords(s) {
  const t = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/'S\b/g, '')
  return [...new Set(t.split(/[^A-Z]+/).filter((w) => w.length >= 3 && !GENERIC.has(w)))]
}
export const shareWord = (a, b) => { const B = new Set(nameWords(b)); return nameWords(a).some((w) => B.has(w)) }

// ── Pure: DFO ────────────────────────────────────────────────────────────────

/** One DFO ESRI feature (+ its layer) → { key, payload, harbour } or { error }. payload = the feature exactly as received. */
export function mapDfoFeature(feature, layer) {
  const a = feature?.attributes || {}
  const n = Number(a.Harbour_number)
  if (!Number.isFinite(n)) return { error: `DFO feature without Harbour_number (OBJECTID ${a.OBJECTID})` }
  const lat = Number(feature?.geometry?.y ?? a.Latitude), lon = Number(feature?.geometry?.x ?? a.Longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { key: String(n), error: 'DFO feature without coordinates' }
  const managed = tidy(a.Managed_by)
  return {
    key: String(n),
    payload: { layer: layer ? { id: layer.id, name: layer.name } : null, feature },
    harbour: { number: n, name: tidy(a.Harbour_Name), name_raw: a.Harbour_Name ?? null, type: tidy(a.Harbour_Type) || layer?.name || null,
      managed_by: managed && !/^no harbour authority$/i.test(managed) ? managed : null, managed_by_raw: a.Managed_by ?? null,
      managed_by_url: tidy(a.Managed_by_URL), province: tidy(a.Province), lat, lon },
  }
}

/** What the card says for a DFO harbour. Pure. */
export function dfoOfficial(h) {
  const type = h.type ? `DFO ${h.type.toLowerCase()} harbour` : 'DFO small craft harbour'
  return { name: h.name, status: type, authority: h.managed_by ?? null, url: h.managed_by_url ?? null }
}

const isCanada = (p) => p?.iso2 === 'CA' || p?.iso3 === 'CAN'
const round3 = (x) => Math.round(x * 1000) / 1000

/**
 * Decide one DFO harbour against our map ports (pure). ports: [{ id, name, lat, lon, iso2, iso3, origin }].
 * → { decision: 'accepted' | 'candidate' | 'new_port', port_id, distance_km, method, candidates: [...] }
 */
/** A harbour this close to one of our (Canadian) map ports is that port, whatever the names say. */
export const SAME_SPOT_KM = 0.5

export function matchDfoHarbour(h, ports) {
  const near = []
  for (const p of ports || []) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) continue
    const km = haversineKm(h.lat, h.lon, p.lat, p.lon)
    if (km <= MATCH_KM) near.push({ port_id: p.id, name: p.name, origin: p.origin, km: round3(km), canada: isCanada(p), word: shareWord(h.name, p.name) })
  }
  near.sort((a, b) => a.km - b.km || Number(a.port_id) - Number(b.port_id))
  if (!near.length) return { decision: 'new_port', port_id: null, distance_km: null, method: 'dfo_no_map_port_within_4km', candidates: [] }
  const reason = (n) => (!n.canada ? 'other country' : n.word ? 'farther' : 'no shared name word')
  // Very close wins (Josh 2026-09-27): a Canadian map port within SAME_SPOT_KM is this harbour, whatever the name
  // (Powell River South sits 0.19 km from WPI Westview, 3.55 km from WPI Powell River) — if it is the only one that close.
  const onTop = near.filter((n) => n.canada && n.km <= SAME_SPOT_KM)
  if (onTop.length === 1) {
    return { decision: 'accepted', port_id: onTop[0].port_id, distance_km: onTop[0].km, method: 'dfo_within_0_5km',
      candidates: near.filter((n) => n !== onTop[0]).map((n) => ({ ...n, reason: 'farther' })) }
  }
  const named = near.filter((n) => n.canada && n.word)
  if (named.length === 1 || (named.length > 1 && named[0].km < CLEAR_RATIO * named[1].km)) {
    const pick = named[0]
    return { decision: 'accepted', port_id: pick.port_id, distance_km: pick.km, method: 'dfo_within_4km_name',
      candidates: near.filter((n) => n !== pick).map((n) => ({ ...n, reason: reason(n) })) }
  }
  // Distance only (or several same-named ports, none clearly nearest): candidates, never shown.
  return { decision: 'candidate', port_id: null, distance_km: null, method: named.length > 1 ? 'dfo_several_named_not_clear' : 'dfo_within_4km_no_name',
    candidates: near.map((n) => ({ ...n, reason: named.length > 1 && n.word && n.canada ? 'not clearly nearest' : reason(n) })) }
}

// ── Pure: USACE port areas ───────────────────────────────────────────────────

/** Even-odd point-in-polygon over every ring of an ESRI polygon (holes and multi-part both work). Pure. */
export function pointInRings(lon, lat, rings) {
  let inside = false
  for (const ring of rings || []) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j]
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

/** One USACE Port Areas feature → { key, payload, area } or { error }. payload = the feature exactly as received. */
export function mapUsaceFeature(feature) {
  const a = feature?.attributes || {}
  const code = tidy(a.PORTIDPK)
  if (!code) return { error: `Port Area without PORTIDPK (OBJECTID ${a.OBJECTID})` }
  if (!Array.isArray(feature?.geometry?.rings)) return { key: code, error: 'Port Area without polygon rings' }
  return { key: code, payload: feature, area: { code, name: tidy(a.FEATURENAME), description: tidy(a.FEATUREDESCRIPTION), year: a.DATA_YEAR ?? null } }
}

export function usaceOfficial(area) {
  return { name: area.name, status: `USACE port area ${area.code}`, authority: null, url: USACE_PORT_AREAS_SOURCE.homepage_url }
}

/** The Port Areas a point lies in (pure). areas: [{ code, rings, ... }] → matching areas. */
export function areasContaining(lat, lon, areas) {
  return (areas || []).filter((a) => pointInRings(lon, lat, a.rings))
}

// ── Pure: the hand table ─────────────────────────────────────────────────────

/** HTML / XML → plain text with collapsed whitespace (for the check-text test only; the page itself is stored raw). */
export const pageText = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ')

/**
 * Check the hand table (pure). pages: Map url → body text as fetched. wpi: Set of WPI numbers we have.
 * → [{ row, ok, problems: [...] }]. A row is ok only when its check text is in every cited page and we have every WPI port.
 */
export function checkHandRows(table, pages, wpi) {
  const out = []
  for (const row of table?.rows || []) {
    const problems = []
    for (const k of ['id', 'kind', 'name', 'status', 'check']) if (!row[k]) problems.push(`missing ${k}`)
    if (!['ca_port_authority', 'tc_public_port'].includes(row.kind)) problems.push(`bad kind ${row.kind}`)
    if (!Array.isArray(row.sources) || !row.sources.length) problems.push('no sources')
    for (const u of row.sources || []) {
      const body = pages.get(u)
      if (body == null) problems.push(`page not fetched: ${u}`)
      else if (!pageText(body).includes(row.check)) problems.push(`"${row.check}" not found in ${u}`)
    }
    for (const n of row.wpi || []) if (!wpi.has(Number(n))) problems.push(`no WPI port ${n}`)
    out.push({ row, ok: problems.length === 0, problems })
  }
  return out
}

export function handOfficial(row) {
  return { name: row.name, status: row.status, authority: row.authority ?? null, url: row.sources?.[0] ?? null, legal_basis: row.legal_basis ?? null }
}

// ── Persistence ──────────────────────────────────────────────────────────────

export async function ensureOfficialSources(pool, S) {
  await withTx(pool, async (c) => { for (const s of OFFICIAL_SOURCES) await upsertSource(c, S, s) })
}

/** Our map ports (the portsLayer rule) except DFO-made ones, optionally in a box. q(text, params) → rows. */
async function mapPorts(c, S, bbox = null) {
  const box = bbox ? `AND p.lon BETWEEN ${Number(bbox[0]) - 0.1} AND ${Number(bbox[2]) + 0.1} AND p.lat BETWEEN ${Number(bbox[1]) - 0.1} AND ${Number(bbox[3]) + 0.1}` : ''
  const { rows } = await c.query(
    `SELECT p.id, p.origin, p.name, p.lat, p.lon, p.iso2, p.iso3 FROM ${S}.ports p
      WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL AND p.name IS NOT NULL ${box}
        AND (p.origin IN ('wpi', 'climate_trace') OR (p.name_method = ANY($1) AND EXISTS (SELECT 1 FROM ${S}.port_aliases a
              WHERE a.port_id = p.id AND a.key_kind = 'gfw_port_label' AND a.status = 'accepted')))`, [MAP_NAME_METHODS])
  return rows.map((r) => ({ ...r, lat: Number(r.lat), lon: Number(r.lon) }))
}

/**
 * Write one official decision for a key: earlier accepted/candidate rows of this key on OTHER ports (or with another
 * status) become 'superseded' (kept), then this one is upserted. rows: [{ port_id, status, method, distance_km, name_raw,
 * lat, lon, rid, detail }] — the complete current decision for (kind, key, source), or, with `scope` (port ids), the
 * complete decision for those ports only (rows on ports outside the scope are left as they are).
 */
async function writeDecision(c, S, sourceId, kind, key, rows, { scope = null } = {}) {
  const keep = rows.map((r) => `${r.port_id}`)
  await c.query(
    `UPDATE ${S}.port_aliases SET status = 'superseded', last_seen_at = now()
      WHERE source_id = $1 AND key_kind = $2 AND key = $3 AND status <> 'superseded' AND NOT (port_id::text = ANY($4))
        ${scope ? 'AND port_id::text = ANY($5)' : ''}`,
    scope ? [sourceId, kind, key, keep, scope.map(String)] : [sourceId, kind, key, keep])
  for (const r of rows) {
    await c.query(
      `INSERT INTO ${S}.port_aliases AS t (port_id, source_id, key_kind, key, name_raw, lat, lon, source_record_id, status, method, distance_km, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (port_id, key_kind, key, source_id) DO UPDATE SET name_raw = EXCLUDED.name_raw, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
         source_record_id = EXCLUDED.source_record_id, status = EXCLUDED.status, method = EXCLUDED.method,
         distance_km = EXCLUDED.distance_km, detail = EXCLUDED.detail, last_seen_at = now()`,
      [r.port_id, sourceId, kind, key, r.name_raw ?? null, r.lat ?? null, r.lon ?? null, r.rid ?? null, r.status, r.method, r.distance_km ?? null, r.detail || {}])
  }
}

/**
 * DFO features ([{ feature, layer }]) → evidence, then each harbour is matched to our map ports; harbours with no map
 * port within 4 km become 'dfo_sch' ports. Idempotent. Returns counts + the decisions.
 */
export async function importDfo(c, S, items, { bbox = null, ...opts } = {}) {
  await c.query(`SELECT pg_advisory_xact_lock(hashtext('ships.ports.official.dfo'))`)
  const mapped = [], errors = []
  for (const it of items) { const m = mapDfoFeature(it.feature, it.layer); if (m.error) errors.push(m.error); else mapped.push(m) }
  const recs = await storeRawRecords(c, S, DFO_SCH_SOURCE.id, KIND.dfo, mapped.map((m) => ({ key: m.key, payload: m.payload })), opts)
  const ports = await mapPorts(c, S, bbox)
  const counts = { harbours: mapped.length, accepted: 0, candidate: 0, new_port: 0, recordsCreated: recs.created }
  const decisions = []
  for (const m of mapped) {
    const h = m.harbour
    const rid = recs.byKey.get(m.key).at(-1)
    const d = matchDfoHarbour(h, ports)
    counts[d.decision]++
    const official = dfoOfficial(h)
    const base = { name_raw: h.name_raw, lat: h.lat, lon: h.lon, rid }
    let rows
    if (d.decision === 'new_port') {
      const { rows: [p] } = await c.query(
        `INSERT INTO ${S}.ports (origin, origin_key, name, name_source_id, name_field, name_method, name_source_record_id, iso2, iso3, lat, lon, detail)
         VALUES ('dfo_sch', $1, $2, $3, 'Harbour_Name', 'dfo_sch_Harbour_Name', $4, 'CA', 'CAN', $5, $6, $7)
         ON CONFLICT (origin, origin_key) DO UPDATE SET name = EXCLUDED.name, name_source_record_id = EXCLUDED.name_source_record_id,
           lat = EXCLUDED.lat, lon = EXCLUDED.lon, detail = EXCLUDED.detail, updated_at = now()
         RETURNING id`,
        [m.key, h.name, DFO_SCH_SOURCE.id, rid, h.lat, h.lon, { harbour_type: h.type, managed_by: h.managed_by, province_raw: h.province }])
      rows = [{ ...base, port_id: p.id, status: 'accepted', method: 'dfo_sch_origin', distance_km: 0, detail: { official } }]
      d.port_id = p.id
    } else if (d.decision === 'accepted') {
      rows = [{ ...base, port_id: d.port_id, status: 'accepted', method: d.method, distance_km: d.distance_km, detail: { official, candidates: d.candidates } }]
    } else {
      rows = d.candidates.map((n) => ({ ...base, port_id: n.port_id, status: 'candidate', method: d.method, distance_km: n.km, detail: { official, reason: n.reason } }))
    }
    await writeDecision(c, S, DFO_SCH_SOURCE.id, KIND.dfo, m.key, rows)
    decisions.push({ number: h.number, name: h.name, type: h.type, ...d })
  }
  return { ...counts, errors, decisions }
}

/** USACE Port Areas features → evidence, then each US WPI port (in the bbox, if given) is placed in its Port Area. */
export async function importUsace(c, S, features, { bbox = null, ...opts } = {}) {
  await c.query(`SELECT pg_advisory_xact_lock(hashtext('ships.ports.official.usace'))`)
  const mapped = [], errors = []
  for (const f of features) { const m = mapUsaceFeature(f); if (m.error) errors.push(m.error); else mapped.push(m) }
  const recs = await storeRawRecords(c, S, USACE_PORT_AREAS_SOURCE.id, KIND.usace, mapped.map((m) => ({ key: m.key, payload: m.payload })), opts)
  const areas = mapped.map((m) => ({ ...m.area, rings: m.payload.geometry.rings, rid: recs.byKey.get(m.key).at(-1) }))
  const box = bbox ? `AND lon BETWEEN ${Number(bbox[0])} AND ${Number(bbox[2])} AND lat BETWEEN ${Number(bbox[1])} AND ${Number(bbox[3])}` : ''
  const { rows: wpi } = await c.query(`SELECT id, wpi_number, name, lat, lon FROM ${S}.ports WHERE origin = 'wpi' AND iso2 = 'US' ${box} ORDER BY id`)
  const byArea = new Map(areas.map((a) => [a.code, []]))
  const counts = { areas: areas.length, recordsCreated: recs.created, portsChecked: wpi.length, accepted: 0, ambiguous: 0, outside: 0 }
  const decisions = []
  for (const p of wpi) {
    const hit = areasContaining(Number(p.lat), Number(p.lon), areas)
    if (!hit.length) { counts.outside++; decisions.push({ port_id: p.id, name: p.name, areas: [] }); continue }
    const status = hit.length === 1 ? 'accepted' : 'candidate'
    counts[hit.length === 1 ? 'accepted' : 'ambiguous']++
    for (const a of hit) byArea.get(a.code).push({ port_id: p.id, status, method: hit.length === 1 ? 'usace_point_in_area' : 'usace_point_in_several_areas',
      name_raw: a.name, rid: a.rid, detail: { official: usaceOfficial(a), description: a.description, data_year: a.year, ...(hit.length > 1 ? { also: hit.map((x) => x.code) } : {}) } })
    decisions.push({ port_id: p.id, name: p.name, areas: hit.map((a) => a.code), status })
  }
  // Each area's decision covers the WPI ports checked in this run (a port outside the box keeps its earlier row).
  const checked = wpi.map((p) => String(p.id))
  for (const [code, rows] of byArea) await writeDecision(c, S, USACE_PORT_AREAS_SOURCE.id, KIND.usace, code, rows, { scope: checked })
  return { ...counts, errors, decisions }
}

/**
 * The hand table + the pages it cites → evidence, then each row's WPI ports get an alias (accepted when the row checks
 * out, candidate otherwise). pages: Map url → body as fetched. Idempotent.
 */
export async function importHandTable(c, S, table, pages, opts = {}) {
  const pageRecs = await storeRawRecords(c, S, CA_OFFICIAL_SOURCE.id, KIND.page,
    [...pages].map(([url, body]) => ({ key: url, payload: { url, body } })), opts)
  const rowRecs = await storeRawRecords(c, S, CA_OFFICIAL_SOURCE.id, KIND.row,
    (table.rows || []).map((r) => ({ key: r.id, payload: { ...r, table_checked: table.checked ?? null } })), opts)
  const { rows: wpiRows } = await c.query(`SELECT id, wpi_number, name FROM ${S}.ports WHERE origin = 'wpi' AND wpi_number = ANY($1)`,
    [(table.rows || []).flatMap((r) => r.wpi || []).map(Number)])
  const wpi = new Map(wpiRows.map((r) => [Number(r.wpi_number), r]))
  const checks = checkHandRows(table, pages, new Set(wpi.keys()))
  const out = { rows: checks.length, ok: 0, problems: [], aliases: 0, recordsCreated: pageRecs.created + rowRecs.created }
  for (const { row, ok, problems } of checks) {
    if (ok) out.ok++; else out.problems.push({ id: row.id, problems })
    const rid = rowRecs.byKey.get(row.id)?.at(-1) ?? null
    const pageIds = (row.sources || []).map((u) => pageRecs.byKey.get(u)?.at(-1) ?? null)
    const rows = (row.wpi || []).filter((n) => wpi.has(Number(n))).map((n) => ({
      port_id: wpi.get(Number(n)).id, status: ok ? 'accepted' : 'candidate', method: 'hand_crosswalk_wpi', name_raw: row.name, rid,
      detail: { official: handOfficial(row), wpi_number: Number(n), page_record_ids: pageIds, ...(ok ? {} : { problems }) } }))
    await writeDecision(c, S, CA_OFFICIAL_SOURCE.id, row.kind, row.id, rows)
    out.aliases += rows.length
  }
  return out
}

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * The port card's official block (accepted matches only). null when there is none. q(text, params) → rows.
 * { name, status, authority, url, kind, recordId, sourceId, sourceName, sourceShort, also: [same shape] }
 */
export async function portOfficial(q, S, portId) {
  const rows = await q(
    `SELECT a.key_kind, a.key, a.source_id, a.source_record_id, a.method, a.distance_km, a.detail->'official' AS official, s.name AS source_name
       FROM ${S}.port_aliases a LEFT JOIN ${S}.sources s ON s.id = a.source_id
      WHERE a.port_id = $1 AND a.status = 'accepted' AND a.key_kind = ANY($2)`, [portId, OFFICIAL_KINDS])
  if (!rows.length) return null
  const list = rows.filter((r) => r.official?.name)
    .sort((a, b) => OFFICIAL_KINDS.indexOf(a.key_kind) - OFFICIAL_KINDS.indexOf(b.key_kind) || (a.distance_km ?? 0) - (b.distance_km ?? 0) || String(a.key).localeCompare(String(b.key)))
    .map((r) => ({ name: r.official.name, status: r.official.status ?? null, authority: r.official.authority ?? null, url: r.official.url ?? null,
      kind: r.key_kind, key: r.key, method: r.method, distanceKm: r.distance_km == null ? null : Number(r.distance_km),
      recordId: r.source_record_id == null ? null : Number(r.source_record_id), sourceId: r.source_id, sourceName: r.source_name, sourceShort: SOURCE_SHORT[r.source_id] || r.source_id }))
  if (!list.length) return null
  const [first, ...also] = list
  return { ...first, also }
}
