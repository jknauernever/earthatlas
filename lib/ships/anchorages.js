/**
 * Official anchorage areas (/ships Phase 3 step 3; Josh, 2026-09-27): which anchorage a GFW port-visit stop
 * lies in, so the card can say "At anchor · Elliott Bay East". Source facts: docs/ANCHORAGE_AREAS_SOURCES.md.
 * Rules: src/ships/CLAUDE.md. Josh's five decisions (2026-09-27):
 *   1. non-designated Puget Sound anchorages (Vendovi, Port Angeles, Budd Inlet…) with geometry from the
 *      WITHDRAWN 2017 proposed rule (82 FR 10313), labelled non-designated with the source and the withdrawal;
 *   2. a "near <anchorage> (≤ 500 m)" state for stops just outside a polygon;
 *   3. regions amended since the MarineCadastre layer: flagged "older boundary", not rebuilt;
 *   4. no OpenStreetMap;
 *   5. Canadian DFO anchorages as circles of their swing radius, marked as built by us.
 *
 *   evidence        source_records: MarineCadastre features, DFO features, proposed-rule paragraphs and the eCFR
 *                   Part 110 version list, exactly as received
 *   claim           anchorages (one row per version of one source feature)
 *   interpretation  read time only (annotateVisits): which anchorage a stop's position lies in / near.
 *                   port_visits is never written.
 *
 * Pure mapping + geometry first (unit-tested with recorded live extracts), then persistence, then the read.
 */
import { canonicalJson, sha256, upsertSource } from './store.js'
import { withTx } from './db.js'
import { storeRawRecords } from './ports.js'

// ── Sources (licence facts: docs/ANCHORAGE_AREAS_SOURCES.md) ─────────────────

export const MC_SOURCE = {
  id: 'noaa-mc-anchorages',
  name: 'Anchorages (MarineCadastre.gov; NOAA Office for Coastal Management and U.S. Coast Guard)',
  publisher: 'NOAA Office for Coastal Management; U.S. Coast Guard',
  homepage_url: 'https://www.fisheries.noaa.gov/inport/item/48849',
  license: 'US Government work, public domain (17 U.S.C. 403 notice on the item; 17 U.S.C. §105)',
  license_url: 'https://www.law.cornell.edu/uscode/text/17/105',
  commercial_use: true,
  attribution_text: 'NOAA Office for Coastal Management and U.S. Coast Guard (MarineCadastre.gov), from 33 CFR.',
  attribution_url: 'https://marinecadastre.gov',
  notes: '33 CFR Part 110 (+ a few Part 166/165/150 and ENC rows) digitised as polygons, one row per paragraph; 679 features. '
    + 'InPort publication 2023-10-25, compiled from the eCFR of 2022-11-17 (Part 110/166). Read from the live FeatureServer '
    + 'https://coast.noaa.gov/arcgis/rest/services/Hosted/Anchorages/FeatureServer/0 as GeoJSON (outSR 4326). Hub licenseInfo: '
    + 'public domain within the US. effectiveDate is 1967-12-12 on every WA row: not a boundary date. Accuracy "Untested".',
}
export const DFO_SOURCE = {
  id: 'dfo-pacific-commercial-anchorages',
  name: 'Active Commercial Shipping Anchorages in Pacific Canada (Fisheries and Oceans Canada)',
  publisher: 'Fisheries and Oceans Canada (DFO), Pacific Region',
  homepage_url: 'https://open.canada.ca/data/en/dataset/2ccbf2d7-0b1c-4ee5-8d8f-43acc16ef1e1',
  license: 'Open Government Licence – Canada 2.0',
  license_url: 'https://open.canada.ca/en/open-government-licence-canada',
  commercial_use: true,
  attribution_text: 'Contains information licensed under the Open Government Licence – Canada (DFO, Active Commercial Shipping Anchorages in Pacific Canada).',
  attribution_url: 'https://open.canada.ca/en/open-government-licence-canada',
  notes: '117 points with swing radius, compiled by hand by DFO from the Vancouver and Prince Rupert port information guides, '
    + 'Pacific Pilotage Authority lists, MarineTraffic and MEIT; "Not suitable for navigation". EarthAtlas stores each as a circle '
    + 'of Swing_Radius__m_ around Latitude/Longitude (built by us; 8 rows say "unknown" and get no circle). Southern BC anchorages '
    + 'are managed on a temporary, voluntary basis (Interim Protocol 2018); no regulation publishing boundaries was found.',
}
export const NONDES_SOURCE = {
  id: 'uscg-vts-ps-nondesignated',
  name: 'Puget Sound non-designated anchorages: boundaries from the withdrawn proposed rule 82 FR 10313 (USCG-2016-0916)',
  publisher: 'U.S. Coast Guard (Federal Register)',
  homepage_url: 'https://www.federalregister.gov/documents/2017/02/10/2017-02683/anchorages-captain-of-the-port-puget-sound-zone-wa',
  license: 'US Government work (17 U.S.C. §105)',
  license_url: 'https://www.law.cornell.edu/uscode/text/17/105',
  commercial_use: true,
  attribution_text: 'Non-designated anchorage boundaries: U.S. Coast Guard proposed rule 82 FR 10313 (2017), withdrawn 83 FR 18491 (2018); never in force.',
  attribution_url: 'https://www.federalregister.gov/documents/2018/04/27/2018-08871/anchorages-captain-of-the-port-puget-sound-zone-wa',
  notes: 'USCG VTS Puget Sound User\'s Manual (2024) p. 3-6 lists these as NON-DESIGNATED ANCHORAGES (no coordinates). The only '
    + 'published boundaries are the proposed §110.230 paragraphs of 82 FR 10313 (2017-02-10), withdrawn 2018-04-27 (83 FR 18491) '
    + '"to better analyze potential impacts to tribal treaty rights". Not law. Text from the GPO plain-text rendering of FR doc 2017-02683.',
}
export const ECFR_SOURCE = {
  id: 'ecfr-part110-versions',
  name: 'eCFR version history of 33 CFR Part 110',
  publisher: 'Office of the Federal Register (eCFR)',
  homepage_url: 'https://www.ecfr.gov/current/title-33/chapter-I/subchapter-I/part-110',
  license: 'US Government work (17 U.S.C. §105)',
  license_url: 'https://www.law.cornell.edu/uscode/text/17/105',
  commercial_use: true,
  attribution_text: 'Amendment dates: eCFR, Office of the Federal Register.',
  attribution_url: 'https://www.ecfr.gov',
  notes: 'GET /api/versioner/v1/versions/title-33.json?part=110 (needs Accept-Encoding). Used only to flag MarineCadastre rows whose '
    + 'section was amended after 2022-11-17 (the CFR the layer was compiled from) as "older boundary".',
}
export const ANCHORAGE_SOURCES = [MC_SOURCE, DFO_SOURCE, NONDES_SOURCE, ECFR_SOURCE]
export const ANCHORAGE_SOURCE_IDS = ANCHORAGE_SOURCES.map((s) => s.id)

export const MC_URL = 'https://coast.noaa.gov/arcgis/rest/services/Hosted/Anchorages/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&orderByFields=objectid&f=geojson'
export const MC_LAYER_URL = 'https://coast.noaa.gov/arcgis/rest/services/Hosted/Anchorages/FeatureServer/0?f=json'
export const DFO_URL = 'https://egisp.dfo-mpo.gc.ca/arcgis/rest/services/open_data_donnees_ouvertes/active_commercial_shipping_anchorages_in_pacific_canada/MapServer/0/query?where=1%3D1&outFields=*&outSR=4326&orderByFields=OBJECTID&f=geojson'
export const FR_TEXT_URL = 'https://www.federalregister.gov/documents/full_text/text/2017/02/10/2017-02683.txt'
export const ECFR_VERSIONS_URL = 'https://www.ecfr.gov/api/versioner/v1/versions/title-33.json?part=110'

export const KIND = { mc: 'mc_anchorage_feature', dfo: 'dfo_anchorage_point', fr: 'proposed_rule_paragraph', ecfr: 'ecfr_versions' }
/** The CFR snapshot the MarineCadastre layer was compiled from (InPort 48849 source citation, Part 110 and 166). */
export const MC_CFR_DATE = '2022-11-17'
export const MC_LAYER_DATE = '2023-10'
export const NEAR_M = 500

// ── Pure helpers ─────────────────────────────────────────────────────────────

const str = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v))
const tidy = (s) => (str(s) ? String(s).replace(/\s+/g, ' ').trim() : null)
const R_M = 6371008.8
const rad = (d) => (d * Math.PI) / 180
const deg = (r) => (r * 180) / Math.PI

/** Rings of a GeoJSON Polygon / MultiPolygon (every ring, outer and holes). */
function rings(g) {
  if (!g) return []
  if (g.type === 'Polygon') return g.coordinates || []
  if (g.type === 'MultiPolygon') return (g.coordinates || []).flat()
  return []
}

/** [minLat, maxLat, minLon, maxLon] of a geometry, or null. */
export function bbox(g) {
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity
  for (const r of rings(g)) for (const [lon, lat] of r) { if (lat < a) a = lat; if (lat > b) b = lat; if (lon < c) c = lon; if (lon > d) d = lon }
  return Number.isFinite(a) ? [a, b, c, d] : null
}

/** A geodesic circle (spherical Earth) as a closed GeoJSON Polygon: `n` vertices around (lat, lon), radius in metres. */
export function circlePolygon(lat, lon, radiusM, n = 64) {
  const d = radiusM / R_M, p1 = rad(lat), l1 = rad(lon)
  const ring = []
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t))
    const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2))
    ring.push([Math.round(deg(l2) * 1e7) / 1e7, Math.round(deg(p2) * 1e7) / 1e7])
  }
  ring.push(ring[0])
  return { type: 'Polygon', coordinates: [ring] }
}

/** Even-odd point-in-polygon over every ring (holes work). */
export function pointInGeometry(g, lat, lon) {
  let inside = false
  for (const r of rings(g)) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j]
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

/** Shortest distance in metres from a point to the geometry's boundary (local equirectangular; fine at ≤ a few km). */
export function distanceToGeometryM(g, lat, lon) {
  const kx = R_M * rad(1) * Math.cos(rad(lat)), ky = R_M * rad(1)
  let best = Infinity
  for (const r of rings(g)) {
    for (let i = 1; i < r.length; i++) {
      const ax = (r[i - 1][0] - lon) * kx, ay = (r[i - 1][1] - lat) * ky
      const bx = (r[i][0] - lon) * kx, by = (r[i][1] - lat) * ky
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
      const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0
      const d = Math.hypot(ax + t * dx, ay + t * dy)
      if (d < best) best = d
    }
  }
  return best
}

const withBbox = (row) => {
  const b = row.geometry ? bbox(row.geometry) : null
  return { ...row, min_lat: b?.[0] ?? null, max_lat: b?.[1] ?? null, min_lon: b?.[2] ?? null, max_lon: b?.[3] ?? null }
}

// ── eCFR amendments (for the "older boundary" flag) ──────────────────────────

/** eCFR versions JSON → Map section → sorted substantive amendment dates after `since` (default: the layer's CFR date). */
export function amendedSince(versions, since = MC_CFR_DATE) {
  const m = new Map()
  for (const v of versions?.content_versions || []) {
    // eCFR's own `substantive: false` marks editorial changes; those are not boundary changes.
    if (v.type !== 'section' || !v.identifier || !(v.amendment_date > since) || v.substantive === false) continue
    const l = m.get(v.identifier) || []
    if (!l.includes(v.amendment_date)) l.push(v.amendment_date)
    m.set(v.identifier, l.sort())
  }
  return m
}

// ── MarineCadastre "Anchorages" (US, designated) ─────────────────────────────

// Territories carry their own ISO 3166 codes (the location text ends in the place).
const MC_ISO3 = { PR: 'PRI', GU: 'GUM', USVI: 'VIR', CNMI: 'MNP' }
// 33 CFR 110.230(a)(14) is the Port Angeles Harbor NON-anchorage area (typed 'restricted' in the layer; study §1.1).
export const NON_ANCHORAGE_CFR = ['110.230(a)(14)']
const NO_ANCHOR_KINDS = ['safety zone', 'security zone']

/**
 * One MarineCadastre GeoJSON feature → anchorage row. `amended` = amendedSince(eCFR versions), `amendRid` = the
 * source record of that list. Returns { key, row } or { key, error }.
 */
export function mapMcFeature(f, { amended = new Map(), amendRid = null } = {}) {
  const p = f?.properties || {}
  const key = str(p.objectid ?? f?.id)
  if (!key) return { key: null, error: 'feature without objectid' }
  const g = f.geometry
  if (!g || !['Polygon', 'MultiPolygon'].includes(g.type)) return { key, error: `unexpected geometry ${g?.type}` }
  const cfr = tidy(p.codefederalregulations)
  const kind = tidy(p.anchoragetype)
  const name = tidy(p.anchoragename) || (cfr ? `33 CFR ${cfr}` : null)
  if (!name) return { key, error: 'feature without name or CFR citation' }
  const section = cfr ? /^(\d+\.\d+[a-z]?)/.exec(cfr)?.[1] ?? null : null
  const dates = section && section.startsWith('110.') ? amended.get(section) : null
  const loc = tidy(p.location)
  const tail = loc ? loc.split(',').pop().trim() : null
  return {
    key,
    row: withBbox({
      name, kind, legal_status: 'designated',
      no_anchoring: /non-?anchorage/i.test(name) || NO_ANCHOR_KINDS.includes(kind) || NON_ANCHORAGE_CFR.includes(cfr),
      citation: cfr ? `33 CFR ${cfr}` : null, location: loc, iso3: MC_ISO3[tail] || 'USA',
      geometry: g, built_from: 'polygon',
      boundary_note: dates?.length
        ? `older boundary: this layer is dated ${MC_LAYER_DATE} and was compiled from the CFR of ${MC_CFR_DATE}; 33 CFR ${section} has been amended since (${dates.join(', ')})`
        : null,
      detail: { objectid: Number(key), cfr_section: section, ...(dates?.length ? { amended_since: dates, amendment_record_id: amendRid } : {}),
        ...(cfr ? {} : { note: 'no CFR citation in the layer (an ENC-derived row)' }) },
    }),
  }
}

// ── DFO "Active Commercial Shipping Anchorages in Pacific Canada" ────────────

/** One DFO GeoJSON feature → anchorage row: a circle of the listed swing radius, built by us. */
export function mapDfoFeature(f) {
  const p = f?.properties || {}
  const key = str(p.OBJECTID ?? f?.id)
  if (!key) return { key: null, error: 'feature without OBJECTID' }
  const name = tidy(p.Anchorage_name)
  if (!name) return { key, error: 'feature without Anchorage_name' }
  const lat = Number(p.Latitude), lon = Number(p.Longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { key, error: 'no valid Latitude/Longitude' }
  const rRaw = str(p.Swing_Radius__m_)
  const r = rRaw !== null && /^\d+(\.\d+)?$/.test(rRaw.trim()) ? Number(rRaw) : null
  const ok = r !== null && r > 0 && r <= 5000
  return {
    key,
    row: withBbox({
      name, kind: null, legal_status: 'active_listed', no_anchoring: false, citation: null, location: tidy(p.Port_Authority), iso3: 'CAN',
      geometry: ok ? circlePolygon(lat, lon, r) : null,
      built_from: ok ? 'circle_from_centre_radius' : 'not_built',
      boundary_note: ok
        ? `circle of the listed swing radius (${r} m) around the listed position, built by EarthAtlas; not a charted boundary`
        : `swing radius "${rRaw ?? ''}" in the DFO list: no circle built (named reference only)`,
      detail: { objectid: Number(key), centre: [lat, lon], radius_m: ok ? r : null, radius_raw: rRaw, vertices: ok ? 64 : 0,
        alternate_name: tidy(p.Alternate_Anchorage_Name), port_authority: tidy(p.Port_Authority), list_source: tidy(p.Source) },
    }),
  }
}

// ── The withdrawn 2017 proposed rule (82 FR 10313), Puget Sound non-designated ─

export const FR_DOC = { number: '2017-02683', citation: '82 FR 10313', published: '2017-02-10', withdrawn: '2018-04-27', withdrawal: '83 FR 18491' }
/**
 * The proposed paragraphs that describe anchorages NOT in today's §110.230 (study §1.1 lists the 14 current
 * paragraphs: (a)(13) is Commencement Bay General, (a)(14) the Port Angeles non-anchorage area; the proposal only
 * revised those two). Everything else the proposal added is a VTS "non-designated" anchorage.
 */
export const NEW_IN_PROPOSAL = ['(a)(3)(iii)', '(a)(13)(ii)', '(a)(14)(ii)', '(a)(14)(iii)', '(a)(14)(iv)', '(a)(14)(v)',
  '(a)(15)(i)', '(a)(15)(ii)', '(a)(15)(iii)', '(a)(15)(iv)', '(a)(15)(v)', '(a)(16)', '(a)(17)(i)', '(a)(17)(ii)']
// (a)(3)(iii) is named only "General Anchorage" in the proposal; its parent (a)(3) is Port Townsend in §110.230.
const PARENT_PLACE = { '(a)(3)': 'Port Townsend' }
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x']
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

/** "six hundred" / "1,000" → number (null if not understood). */
export function parseNumberWords(s) {
  const t = String(s || '').toLowerCase().replace(/,/g, '').trim()
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t)
  let total = 0, cur = 0
  for (const w of t.split(/[\s-]+/).filter(Boolean)) {
    if (w in NUM_WORDS) cur += NUM_WORDS[w]
    else if (w === 'hundred') cur = (cur || 1) * 100
    else if (w === 'thousand') { total += (cur || 1) * 1000; cur = 0 } else if (w !== 'and') return null
  }
  return total + cur || null
}

const DMS = String.raw`(\d+)\[deg\](\d+)'([\d.]+)''`
const PAIR = new RegExp(String.raw`latitude\s+${DMS}\s*N\.?,?\s+longitude\s+${DMS}\s*W`, 'g')
const dms = (d, m, s) => Number(d) + Number(m) / 60 + Number(s) / 3600

/** Lat/lon pairs in a paragraph (GPO "[deg]" notation; all N / W here), in order. */
export function coordPairs(text) {
  return [...String(text).matchAll(PAIR)].map((m) => [dms(m[1], m[2], m[3]), -dms(m[4], m[5], m[6])])
}

/**
 * The regulatory text of the proposal (GPO plain text) → its §110.230(a) paragraphs:
 * [{ para: '(a)(15)(ii)', heading, name, text (exact lines, incl. sub-items), body (whitespace-normalised) }].
 */
export function parseProposedParagraphs(doc) {
  const src = String(doc).replace(/\r/g, '')
  const start = src.search(/Sec\.\s+110\.230\s+Anchorages, Captain of the Port Puget Sound Zone, WA\.\s*\n/)
  if (start < 0) throw new Error('proposed §110.230 text not found')
  const endRel = src.slice(start).search(/\n\s{4}\(b\) General regulations\./)
  const block = src.slice(start, endRel < 0 ? undefined : start + endRel)
  const chunks = []
  for (const line of block.split('\n')) {
    if (/^\s{4}\(/.test(line)) chunks.push([line])
    else if (chunks.length) chunks[chunks.length - 1].push(line)
  }
  const out = []
  let num = null, heading = null, last = null
  for (const lines of chunks) {
    const raw = lines.join('\n').replace(/\n+$/, '')
    const body = raw.replace(/\[\[Page \d+\]\]/g, ' ').replace(/\s+/g, ' ').trim()
    const m = /^\((\w+)\)\s*(.*)$/.exec(body)
    if (!m) continue
    const [, mk, rest] = m
    if (mk === 'a') continue
    if (/^\d+$/.test(mk)) {
      num = mk; heading = null; last = null
      if (rest.startsWith('* * *')) continue
      const nm = /^([^.]+)\.\s*(.*)$/.exec(rest)
      if (nm && !nm[2]) { heading = nm[1]; continue } // "(15) Vendovi Anchorages." = a heading
      last = { para: `(a)(${num})`, heading: null, name: nm ? nm[1] : rest, text: raw, body: nm ? nm[2] : rest }
      out.push(last)
    } else if (ROMAN.includes(mk) && num) {
      const nm = /^([^.]+)\.\s*(.*)$/.exec(rest)
      last = { para: `(a)(${num})(${mk})`, heading, name: nm ? nm[1] : rest, text: raw, body: nm ? nm[2] : rest }
      out.push(last)
    } else if (/^[A-Z]$/.test(mk) && last) {
      last.text += `\n${raw}` // (A), (B)… belong to the paragraph above
      last.body += ` ${body}`
    }
  }
  return out
}

/**
 * Geometry from one proposed paragraph (pure):
 *  - "circular area centered at …, with a radius of six hundred yards" → circle (64 vertices);
 *  - "within/inside an area beginning at … (thence back to the point of origin)" → the polygon as written;
 *  - "… of a line" whose ends are on the shore (every latitude in the text has a longitude) → the line closed by a
 *    straight chord between its ends. The rule closes it along the shoreline, so this covers LESS water than
 *    described (and may cross land); said so in boundary_note;
 *  - anything else (bounded by shore + a lone latitude/longitude, no coordinates) → no geometry.
 */
export function proposedGeometry(body) {
  const t = String(body)
  const circ = new RegExp(String.raw`circular area centered at latitude\s+${DMS}\s*N\.?,?\s+longitude\s+${DMS}\s*W\.?,?\s+with a radius of ([\w\s,-]+?) yards`).exec(t)
  if (circ) {
    const yd = parseNumberWords(circ[7])
    if (!yd) return { geometry: null, method: 'not_built', why: `radius "${circ[7]}" not understood` }
    const lat = dms(circ[1], circ[2], circ[3]), lon = -dms(circ[4], circ[5], circ[6])
    return { geometry: circlePolygon(lat, lon, yd * 0.9144), method: 'circle', radius_yd: yd, radius_m: Math.round(yd * 0.9144 * 10) / 10, centre: [lat, lon] }
  }
  const pts = coordPairs(t)
  const lats = (t.match(/latitude/g) || []).length
  const longs = (t.match(/longitude/g) || []).length
  const ring = (p) => { const r = p.map(([la, lo]) => [lo, la]); const [f, l] = [r[0], r[r.length - 1]]; if (f[0] !== l[0] || f[1] !== l[1]) r.push(f); return r }
  if (/(within|inside) (an|the) area beginning|point of origin/i.test(t) && pts.length >= 3 && lats === pts.length) {
    return { geometry: { type: 'Polygon', coordinates: [ring(pts)] }, method: 'polygon_as_written' }
  }
  if (/\bof a line\b/i.test(t) && pts.length >= 3 && lats === pts.length && longs === pts.length) {
    return { geometry: { type: 'Polygon', coordinates: [ring(pts)] }, method: 'open_line_closed_by_chord' }
  }
  return { geometry: null, method: 'not_built',
    why: pts.length ? 'bounded by the shoreline and/or a lone latitude or longitude line: no closed boundary in the text'
      : 'no coordinate pairs in the text (bounded by the shoreline and latitude/longitude lines)' }
}

/** One proposed paragraph → anchorage row (only NEW_IN_PROPOSAL paragraphs are anchorages). */
export function mapProposedParagraph(p) {
  const key = p.para
  if (!NEW_IN_PROPOSAL.includes(key)) return { key, skip: 'revises a paragraph of the current §110.230 (the designated one is in the MarineCadastre layer)' }
  const parent = /^\(a\)\(\d+\)/.exec(key)[0]
  const name = tidy(PARENT_PLACE[parent] && !p.name.includes(PARENT_PLACE[parent]) ? `${PARENT_PLACE[parent]} ${p.name}` : p.name)
  const g = proposedGeometry(p.body)
  const kind = (/(Articulated Tug and Barge Anchorage|Tug and Barge Holding Area|General Anchorage)$/i.exec(name)?.[1] || '').toLowerCase() || null
  const base = `boundary from the WITHDRAWN 2017 proposed rule (${FR_DOC.citation}, withdrawn ${FR_DOC.withdrawn}); never in force`
  const note = {
    circle: `${base}; circle of ${g.radius_yd} yards (${g.radius_m} m) built by EarthAtlas from the text`,
    polygon_as_written: base,
    open_line_closed_by_chord: `${base}; the text closes this area along the shoreline, EarthAtlas closed it with a straight line between the two shore points, so it covers less water than described`,
    not_built: `${base}; ${g.why}: named reference only, not matched to stops`,
  }[g.method]
  return {
    key,
    row: withBbox({
      name, kind, legal_status: 'non_designated', no_anchoring: false,
      citation: `33 CFR 110.230${key} as proposed in ${FR_DOC.citation} (${FR_DOC.published}); proposal withdrawn ${FR_DOC.withdrawn} (${FR_DOC.withdrawal})`,
      location: 'Puget Sound, WA', iso3: 'USA',
      geometry: g.geometry, built_from: g.geometry ? 'proposed_rule_text' : 'not_built', boundary_note: note,
      detail: { paragraph: key, heading: p.heading, name_in_text: p.name, geometry_method: g.method,
        ...(g.radius_m ? { radius_m: g.radius_m, radius_yd: g.radius_yd, centre: g.centre } : {}),
        fr_document: FR_DOC.number },
    }),
  }
}

// ── Matching (pure) ──────────────────────────────────────────────────────────

const RANK = { designated: 0, active_listed: 1, non_designated: 2 }
const bboxArea = (a) => (a.max_lat - a.min_lat) * (a.max_lon - a.min_lon)

/**
 * Anchorages (rows with geometry + bbox) → which one (lat, lon) lies in, else the nearest within nearM.
 * Inside wins over near; designated over DFO-listed over non-designated; then the smaller area. No-anchoring areas
 * never match. Returns { inside, alsoInside: [names], near: { a, distance_m } | null }.
 */
export function matchPoint(cands, lat, lon, nearM = NEAR_M) {
  const dLat = nearM / (R_M * rad(1)), dLon = dLat / Math.max(0.01, Math.cos(rad(lat)))
  const inside = [], near = []
  for (const a of cands) {
    if (!a.geometry || a.no_anchoring) continue
    if (lat < a.min_lat - dLat || lat > a.max_lat + dLat || lon < a.min_lon - dLon || lon > a.max_lon + dLon) continue
    if (pointInGeometry(a.geometry, lat, lon)) inside.push(a)
    else { const d = distanceToGeometryM(a.geometry, lat, lon); if (d <= nearM) near.push({ a, distance_m: Math.round(d) }) }
  }
  inside.sort((x, y) => RANK[x.legal_status] - RANK[y.legal_status] || bboxArea(x) - bboxArea(y))
  near.sort((x, y) => x.distance_m - y.distance_m || RANK[x.a.legal_status] - RANK[y.a.legal_status])
  return { inside: inside[0] ?? null, alsoInside: inside.slice(1).map((a) => a.name), near: inside.length ? null : near[0] ?? null }
}

// ── Persistence ──────────────────────────────────────────────────────────────

export async function ensureAnchorageSources(pool, S) {
  await withTx(pool, async (c) => { for (const s of ANCHORAGE_SOURCES) await upsertSource(c, S, s) })
}

const COLS = ['name', 'kind', 'legal_status', 'no_anchoring', 'citation', 'location', 'iso3', 'geometry', 'built_from',
  'min_lat', 'max_lat', 'min_lon', 'max_lon', 'boundary_note', 'detail']
const TYPES = { no_anchoring: 'boolean', geometry: 'jsonb', detail: 'jsonb', min_lat: 'double precision', max_lat: 'double precision',
  min_lon: 'double precision', max_lon: 'double precision' }

/**
 * Store one batch (one transaction): raw payloads → source_records; mapped rows → anchorages. Idempotent: the same
 * content only touches last_seen / source_record_id; changed content inserts a new version and supersedes the old;
 * a superseded/withdrawn version that comes back is re-activated. items: [{ key, payload, row }].
 */
export async function ingestAnchorages(c, S, sourceId, kind, items, opts = {}) {
  if (!items.length) return { rows: 0, recordsCreated: 0, created: 0, seenAgain: 0, superseded: 0 }
  const recs = await storeRawRecords(c, S, sourceId, kind, items.map((i) => ({ key: i.key, payload: i.payload })), opts)
  const withRow = items.filter((i) => i.row)
  if (!withRow.length) return { rows: items.length, recordsCreated: recs.created, created: 0, seenAgain: 0, superseded: 0 }
  await c.query(`SELECT pg_advisory_xact_lock(hashtext('ships.anchorages'))`)
  const payload = JSON.stringify(withRow.map((i) => ({ key: i.key, sha: sha256(canonicalJson(i.row)), rid: recs.byKey.get(i.key).at(-1), ...i.row })))
  const rs = `jsonb_to_recordset($1::jsonb) AS r(key text, sha text, rid bigint, ${COLS.map((k) => `${k} ${TYPES[k] || 'text'}`).join(', ')})`
  const superseded = (await c.query(
    `UPDATE ${S}.anchorages a SET status = 'superseded' FROM ${rs}
      WHERE a.source_id = $2 AND a.source_key = r.key AND a.status = 'active' AND a.content_sha256 <> r.sha`, [payload, sourceId])).rowCount
  const { rows } = await c.query(
    `INSERT INTO ${S}.anchorages AS t (source_id, source_key, content_sha256, ${COLS.join(', ')}, source_record_id)
     SELECT $2, r.key, r.sha, ${COLS.map((k) => `r.${k}`).join(', ')}, r.rid FROM ${rs}
     ON CONFLICT (source_id, source_key, content_sha256) DO UPDATE
       SET last_seen_at = now(), source_record_id = EXCLUDED.source_record_id, status = 'active'
     RETURNING (xmax = 0) AS created`, [payload, sourceId])
  const created = rows.filter((r) => r.created).length
  return { rows: items.length, recordsCreated: recs.created, created, seenAgain: rows.length - created, superseded }
}

/** After a COMPLETE import of a source: its active rows whose key was not in the file are marked 'withdrawn' (kept). */
export async function withdrawMissingAnchorages(c, S, sourceId, seenKeys) {
  const { rowCount } = await c.query(
    `UPDATE ${S}.anchorages SET status = 'withdrawn' WHERE source_id = $1 AND status = 'active' AND NOT (source_key = ANY($2))`, [sourceId, seenKeys])
  return rowCount
}

// ── Read (for vesselPortVisits) ──────────────────────────────────────────────

/** Active anchorages whose bbox (grown by nearM) contains any of the points. q(text, params) → rows. */
export async function anchorageCandidates(q, S, points, nearM = NEAR_M) {
  if (!points.length) return []
  const d = nearM / (R_M * rad(1))
  return q(
    `SELECT a.id, a.source_id, a.source_key, a.name, a.kind, a.legal_status, a.no_anchoring, a.citation, a.location, a.iso3,
            a.geometry, a.built_from, a.min_lat, a.max_lat, a.min_lon, a.max_lon, a.boundary_note, a.detail, a.source_record_id
       FROM ${S}.anchorages a
      WHERE a.status = 'active' AND a.geometry IS NOT NULL AND NOT a.no_anchoring
        AND EXISTS (SELECT 1 FROM unnest($1::float8[], $2::float8[]) AS v(lat, lon)
                     WHERE v.lat BETWEEN a.min_lat - $3 AND a.max_lat + $3
                       AND v.lon BETWEEN a.min_lon - $3 / greatest(0.01, cos(radians(v.lat))) AND a.max_lon + $3 / greatest(0.01, cos(radians(v.lat))))`,
    [points.map((p) => p.lat), points.map((p) => p.lon), d])
}

/** What the card needs about one anchorage (never the geometry). */
export function publicAnchorage(a) {
  if (!a) return null
  const dt = a.detail || {}
  return { id: Number(a.id), name: a.name, kind: a.kind, legal_status: a.legal_status, citation: a.citation, location: a.location,
    built_from: a.built_from, boundary_note: a.boundary_note, source_id: a.source_id, source_record_id: Number(a.source_record_id),
    radius_m: dt.radius_m ?? null, paragraph: dt.paragraph ?? null, alternate_name: dt.alternate_name ?? null,
    amended_since: dt.amended_since ?? null, amendment_record_id: dt.amendment_record_id ?? null }
}

/**
 * Read-time interpretation: sets v.anchorage (the anchorage the stop's position lies in, + v.anchorage_also) or
 * v.anchorage_near ({ …, distance_m } within NEAR_M) on each visit of the page, and returns a summary over the
 * whole window (`windowPoints` = [{ lat, lon, n }]): stops in anchorages by legal status, and near ones.
 * Before migration 009 (a database not migrated yet) it returns null and leaves the visits alone.
 */
export async function annotateVisits(q, S, visits, windowPoints = []) {
  const ok = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon)
  const uniq = new Map()
  for (const p of [...visits, ...windowPoints]) if (ok(p)) uniq.set(`${p.lat},${p.lon}`, { lat: p.lat, lon: p.lon })
  let cands
  try { cands = await anchorageCandidates(q, S, [...uniq.values()]) } catch (e) {
    if (e?.code === '42P01' || /relation .*anchorages.* does not exist/.test(String(e?.message))) return null
    throw e
  }
  const memo = new Map()
  const match = (lat, lon) => { const k = `${lat},${lon}`; if (!memo.has(k)) memo.set(k, matchPoint(cands, lat, lon)); return memo.get(k) }
  for (const v of visits) {
    if (!ok(v)) continue
    const m = match(v.lat, v.lon)
    if (m.inside) { v.anchorage = publicAnchorage(m.inside); if (m.alsoInside.length) v.anchorage_also = m.alsoInside }
    else if (m.near) v.anchorage_near = { ...publicAnchorage(m.near.a), distance_m: m.near.distance_m }
  }
  const summary = { inside: { designated: 0, active_listed: 0, non_designated: 0 }, near: 0, near_m: NEAR_M }
  for (const p of windowPoints) {
    if (!ok(p)) continue
    const m = match(p.lat, p.lon), n = Number(p.n) || 1
    if (m.inside) summary.inside[m.inside.legal_status] += n
    else if (m.near) summary.near += n
  }
  return summary
}
