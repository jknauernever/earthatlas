/**
 * Terminals and facilities ships service, Salish Sea (/ships; plan approved by Josh 2026-09-27,
 * docs/OIL_GAS_INFRASTRUCTURE_SOURCES.md §10 and "Built (dev)"). Rules: src/ships/CLAUDE.md.
 *
 *   evidence        source_records: each raw row the curated list refers to (USACE dock, WA Ecology facility, OSM element,
 *                   GEM coal-terminal row, Climate TRACE refinery) plus the curated entry itself, exactly as read
 *   claim           terminals, terminal_berths, terminal_links (migration 012): the hand-reviewed list in
 *                   lib/ships/data/salish-terminals.json (+ salish-terminals-osm.json, the ODbL slice)
 *   interpretation  which GFW port-visit stop belongs to which terminal: decided at read time here (matchStop /
 *                   matchVisit / terminalVisits), never stored, so the rule can change without touching evidence
 *
 * Matching rule (Josh 2026-09-27, §10 B): every stop GFW gives for a visit (start, intermediate, end anchorage) is
 * compared with every terminal's berths. Nearest terminal within MATCH_KM → match. The stop is "berthed" only when GFW
 * marks that anchorage atDock; otherwise it is "nearby / at anchor". If the second-nearest terminal is within
 * AMBIGUITY_RATIO × the nearest distance, the stop is "one of A / B" and no single terminal is chosen.
 *
 * Pure functions first (unit-tested offline with recorded real responses), then persistence, then the read.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { canonicalJson, sha256, upsertSource } from './store.js'
import { storeRawRecords, haversineKm } from './ports.js'
import { CLIMATE_TRACE_SOURCE, CT_KIND } from './climateTrace.js'

export const MATCH_KM = 1.0
export const AMBIGUITY_RATIO = 1.5
/** A stop farther than this from every berth of a terminal can neither match it nor be ambiguous with it. */
export const REACH_KM = MATCH_KM * AMBIGUITY_RATIO

export const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')
export const DATA_FILE = 'salish-terminals.json'
export const OSM_FILE = 'salish-terminals-osm.json'

export const KINDS = ['refinery_dock', 'crude_terminal', 'product_terminal', 'bunkering_terminal', 'fuel_dock',
  'military_fuel_pier', 'lng_terminal', 'coal_terminal', 'chemical_terminal', 'grain_terminal', 'dry_bulk_terminal',
  'cement_terminal', 'scrap_metal_terminal', 'forest_products_terminal', 'other_bulk_terminal', 'lpg_terminal']
export const STATUSES = ['operating', 'idle', 'closed', 'construction', 'unknown']
export const BASES = { usace_dock: 'usace-docks', ecology_dock: 'wa-ecology-facilities', bc_ports_terminals: 'bc-ports-terminals', osm_seamark_berth: 'osm', osm_pier_centers: 'osm', osm_site_center: 'osm',
  // An IMO GISIS ISPS declared port facility's own point (migration 015), for terminals no USACE / Ecology / BC / OSM row
  // covers. The facility rows are imported by lib/ships/gisis.js (scripts/ships/import-gisis.mjs) and read back here.
  gisis_facility: 'imo-gisis-port-facilities' }
export const GISIS_FACILITIES_SOURCE_ID = 'imo-gisis-port-facilities'
export const GISIS_FACILITY_KIND = 'isps_port_facility'
/** Salish Sea + Puget Sound box the list must stay inside [W, S, E, N]. */
export const SALISH_BBOX = [-125.5, 47.0, -121.9, 50.2]

// ── Sources (licence as data) ────────────────────────────────────────────────

export const USACE_DOCKS_SOURCE = {
  id: 'usace-docks',
  name: 'USACE Navigation Facilities (Dock), "Master Docks Plus"',
  publisher: 'U.S. Army Corps of Engineers, Navigation and Civil Works Decision Support Center (WCSC)',
  homepage_url: 'https://geospatial-usace.opendata.arcgis.com/datasets/23d91bd988ac4fc9943128965bddfa37_0',
  license: 'Public, no use restrictions (item licenseInfo)',
  license_url: 'https://geospatial-usace.opendata.arcgis.com/datasets/23d91bd988ac4fc9943128965bddfa37_0',
  commercial_use: true,
  attribution_text: 'U.S. Army Corps of Engineers, Navigation Facilities (Docks)',
  attribution_url: 'https://geospatial-usace.opendata.arcgis.com/datasets/23d91bd988ac4fc9943128965bddfa37_0',
  notes: 'licenseInfo (read 2026-09-27): "This data set is publicly available without any use restrictions; however, this data set '
    + 'was developed for use at a national scale and may not be appropriate for use in local scale mapping." OPERATORS/OWNERS are free '
    + 'text and often decades old: never shown as the current operator. US only.',
}
export const USACE_DOCKS_URL = 'https://services7.arcgis.com/n1YM8pTrFmm7L4hs/arcgis/rest/services/Docks/FeatureServer/0/query'

export const ECOLOGY_FACILITIES_SOURCE = {
  id: 'wa-ecology-facilities',
  name: 'Washington State Department of Ecology: Facilities - Class 1, 3, and 4 (oil handling facilities)',
  publisher: 'Washington State Department of Ecology, Spill Prevention, Preparedness & Response',
  homepage_url: 'https://gis.ecology.wa.gov/serverext/rest/services/SPPR/Spills_map_series/MapServer/132',
  license: 'Ecology data: use allowed with credit to the Washington State Department of Ecology and a link; commercial and political use prohibited',
  license_url: 'https://ecology.wa.gov/About-us/Accountability-transparency/Our-website/Copyright-information',
  commercial_use: false,
  attribution_text: 'Washington State Department of Ecology (oil handling facilities, Class 1/3/4)',
  attribution_url: 'https://gis.ecology.wa.gov/serverext/rest/services/SPPR/Spills_map_series/MapServer/132',
  notes: 'Layer 132 of the Spills_map_series MapServer. The point is the facility DOCK (DockLatNumber/DockLongNumber). No operator field. '
    + 'Terms (read 2026-09-27) also prohibit "political use", including use in a political campaign or lobbying effort; Josh accepted '
    + 'the licence incl. that clause on 2026-09-27. OBJECTID is the only id: the import re-checks FacilityName for each one.',
}
export const ECOLOGY_FACILITIES_URL = 'https://gis.ecology.wa.gov/serverext/rest/services/SPPR/Spills_map_series/MapServer/132/query'

export const BC_PORTS_TERMINALS_SOURCE = {
  id: 'bc-ports-terminals',
  name: 'BC Ports and Terminals (Government of British Columbia, GeoBC)',
  publisher: 'Government of British Columbia (GeoBC)',
  homepage_url: 'https://catalogue.data.gov.bc.ca/dataset/bc-ports-and-terminals',
  license: 'Open Government Licence - British Columbia',
  license_url: 'https://www2.gov.bc.ca/gov/content?id=A519A56BC2BF44E4A008B33FCF527F61',
  commercial_use: true,
  attribution_text: 'Contains information licensed under the Open Government Licence - British Columbia.',
  attribution_url: 'https://catalogue.data.gov.bc.ca/dataset/bc-ports-and-terminals',
  notes: 'WFS layer pub:WHSE_IMAGERY_AND_BASE_MAPS.GSR_PORTS_TERMINALS_SVW (docs/OFFICIAL_PORT_LISTS.md C3). Primary BC berth source for '
    + 'the terminal list (coordinator, 2026-09-27); OpenStreetMap only fills gaps. AUTHORITY / BUSINESS_OPERATOR names are often stale '
    + '("Port Metro Vancouver", "Kinder Morgan"): never shown as the current operator. Every DATE_UPDATED is 2025-03-06 (bulk re-stamp). '
    + 'The WFS feature id is not stable; SOURCE_DATA_ID is the key and FACILITY_NAME is re-checked on import.',
}
export const BC_PORTS_TERMINALS_URL = 'https://openmaps.gov.bc.ca/geo/pub/wfs'
export const BC_PORTS_TERMINALS_LAYER = 'pub:WHSE_IMAGERY_AND_BASE_MAPS.GSR_PORTS_TERMINALS_SVW'

export const OSM_SOURCE = {
  id: 'osm',
  name: 'OpenStreetMap (Overpass API)',
  publisher: 'OpenStreetMap contributors',
  homepage_url: 'https://www.openstreetmap.org',
  license: 'ODbL 1.0 (share-alike)',
  license_url: 'https://www.openstreetmap.org/copyright',
  commercial_use: true,
  attribution_text: '© OpenStreetMap contributors',
  attribution_url: 'https://www.openstreetmap.org/copyright',
  notes: 'ODbL: a stored table built from OSM is a Derivative Database; if published as data (API/download) it must be offered under '
    + 'ODbL. OSM-derived berth positions are kept separable (terminal_berths.odbl, source osm). Josh OK\'d the separate slice 2026-09-27.',
}
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

export const GEM_GCTT_SOURCE = {
  id: 'gem-gctt',
  name: 'Global Energy Monitor: Global Coal Terminals Tracker (public map file)',
  publisher: 'Global Energy Monitor',
  homepage_url: 'https://globalenergymonitor.org/projects/global-coal-terminals-tracker/',
  license: 'CC BY 4.0',
  license_url: 'https://globalenergymonitor.org/creative-commons-license',
  commercial_use: true,
  attribution_text: 'Global Coal Terminals Tracker, Global Energy Monitor, December 2024 release',
  attribution_url: 'https://globalenergymonitor.org/projects/global-coal-terminals-tracker/',
  notes: 'Rows read from GEM\'s public map repository (no licence file in that repo); the CC BY 4.0 statement for tracker data was seen '
    + 'in a search snippet only (docs/OIL_GAS_INFRASTRUCTURE_SOURCES.md §4). GEM.wiki text is CC BY-NC-SA and is not copied.',
}
export const GEM_GCTT_URL = 'https://raw.githubusercontent.com/GlobalEnergyMonitor/maps/main/trackers/coal-terminals/compilation_output/Coal%20Terminals-map-file-2025-01-15.csv'

export const GEM_GGIT_SOURCE = {
  id: 'gem-ggit',
  name: 'Global Energy Monitor: Global Gas Infrastructure Tracker, LNG terminals (public map file ggit_2024-12-20.geojson)',
  publisher: 'Global Energy Monitor',
  homepage_url: 'https://globalenergymonitor.org/projects/global-gas-infrastructure-tracker/',
  license: 'CC BY 4.0',
  license_url: 'https://globalenergymonitor.org/creative-commons-license',
  commercial_use: true,
  attribution_text: 'Global Gas Infrastructure Tracker, Global Energy Monitor (map file of 2024-12-20)',
  attribution_url: 'https://globalenergymonitor.org/projects/global-gas-infrastructure-tracker/',
  notes: 'Downloaded ONCE (Josh decision 4, 2026-09-28) from GEM\'s public map repository into the gitignored scripts/ships/gem/raw/ '
    + '(7,846,479 bytes, sha256 03916a08c6370f4fae315ebbfd9b1a314597c40558ca08159d31c778971fe4a7, 4,358 features). The repo has no licence '
    + 'file; the CC BY 4.0 statement for tracker data is GEM\'s (docs/OIL_GAS_INFRASTRUCTURE_SOURCES.md §4). GGIT does not track '
    + 'terminals used solely for storage or bunkering (GGIT FAQ), so Puget LNG (Tacoma) is absent. Used to confirm and credit Tilbury '
    + 'and Woodfibre; positions are not used (berths come from the listed sources). GEM.wiki text (CC BY-NC-SA) is not copied.',
}
export const GEM_GGIT_URL = 'https://raw.githubusercontent.com/GlobalEnergyMonitor/maps/main/trackers/ggit/data/ggit_2024-12-20.geojson'

export const TERMINALS_LIST_SOURCE = {
  id: 'earthatlas-terminals',
  name: 'EarthAtlas curated Salish Sea terminal list (lib/ships/data/salish-terminals.json)',
  publisher: 'EarthAtlas',
  homepage_url: 'https://earthatlas.org/ships',
  license: 'EarthAtlas curation; each value cites its own source',
  license_url: null,
  commercial_use: false,
  attribution_text: 'EarthAtlas (curated from the cited sources)',
  attribution_url: 'https://earthatlas.org/ships',
  notes: 'Hand-reviewed list. Current operator names are hand-maintained, each with the URL of the page that states it and the '
    + 'date checked. OSM-derived berth positions live in the separate ODbL file salish-terminals-osm.json.',
}

export const TERMINAL_SOURCES = [USACE_DOCKS_SOURCE, ECOLOGY_FACILITIES_SOURCE, BC_PORTS_TERMINALS_SOURCE, OSM_SOURCE, GEM_GCTT_SOURCE, GEM_GGIT_SOURCE, TERMINALS_LIST_SOURCE, CLIMATE_TRACE_SOURCE]
export const RAW_KIND = { usace: 'usace_dock', ecology: 'ecology_facility', bcpt: 'bc_port_terminal', osm: 'osm_element', gem: 'gem_coal_terminal', gemLng: 'gem_lng_terminal', ctRefinery: 'ct_refinery', entry: 'terminal_entry' }

// ── The data files ───────────────────────────────────────────────────────────

export async function loadTerminalData(dir = DATA_DIR) {
  const main = JSON.parse(await readFile(path.join(dir, DATA_FILE), 'utf8'))
  const osm = JSON.parse(await readFile(path.join(dir, OSM_FILE), 'utf8'))
  return { main, osm }
}

const inBox = (lat, lon, [w, s, e, n] = SALISH_BBOX) => Number.isFinite(lat) && Number.isFinite(lon) && lon >= w && lon <= e && lat >= s && lat <= n
const isUrl = (s) => typeof s === 'string' && /^https?:\/\/\S+$/.test(s)

/** Structural checks on the two files (pure). Returns a list of problems; empty = OK. */
export function validateTerminalData({ main, osm }) {
  const errs = []
  const terms = main?.terminals
  if (!Array.isArray(terms) || !terms.length) return ['main file has no terminals[]']
  const osmBerths = new Map((osm?.berths || []).map((b) => [`${b.terminal}\u0001${b.key}`, b]))
  const ids = new Set()
  for (const t of terms) {
    const at = `terminal ${t.id}`
    if (!/^(wa|bc)-[a-z0-9-]+$/.test(t.id || '')) errs.push(`${at}: bad id`)
    if (ids.has(t.id)) errs.push(`${at}: duplicate id`)
    ids.add(t.id)
    if (!t.name) errs.push(`${at}: no name`)
    if (!KINDS.includes(t.kind)) errs.push(`${at}: kind ${t.kind} not in KINDS`)
    if (!/^[A-Z]{2}$/.test(t.country || '')) errs.push(`${at}: bad country`)
    if (t.operator && !isUrl(t.operator_source_url)) errs.push(`${at}: operator without a source URL`)
    if (t.operator && !/^\d{4}-\d{2}-\d{2}$/.test(t.operator_checked || '')) errs.push(`${at}: operator without a checked date`)
    if (t.status && !STATUSES.includes(t.status)) errs.push(`${at}: bad status ${t.status}`)
    if (t.status && t.status !== 'unknown' && !isUrl(t.status_source_url)) errs.push(`${at}: status without a source URL`)
    const berths = [...(t.berths || [])]
    for (const k of t.osm_berths || []) {
      const b = osmBerths.get(`${t.id}\u0001${k}`)
      if (!b) errs.push(`${at}: OSM berth ${k} missing from ${OSM_FILE}`)
      else berths.push(b)
    }
    if (!berths.length) errs.push(`${at}: no berths`)
    const keys = new Set()
    for (const b of berths) {
      if (keys.has(b.key)) errs.push(`${at}: duplicate berth ${b.key}`)
      keys.add(b.key)
      if (!BASES[b.basis]) errs.push(`${at}: berth ${b.key} has unknown basis ${b.basis}`)
      if (!inBox(b.lat, b.lon)) errs.push(`${at}: berth ${b.key} outside the Salish box`)
      if (BASES[b.basis] === 'osm' && !(Array.isArray(b.osm) && b.osm.length)) errs.push(`${at}: OSM berth ${b.key} lists no elements`)
      if (BASES[b.basis] && BASES[b.basis] !== 'osm' && !b.ref) errs.push(`${at}: berth ${b.key} has no source ref`)
      if (b.basis === 'gisis_facility' && !/^[A-Z]{2}[A-Z0-9]{3}-\d{4}$/.test(b.ref || '')) errs.push(`${at}: GISIS berth ${b.key} needs an IMO Port Facility Number as ref`)
      if (BASES[b.basis] === 'osm' && (t.berths || []).includes(b)) errs.push(`${at}: OSM-derived berth ${b.key} must live in ${OSM_FILE} (ODbL slice)`)
    }
    const ct = t.climate_trace || {}
    for (const k of ['refinery_facility_ids', 'ship_port_ids']) if (!Array.isArray(ct[k])) errs.push(`${at}: climate_trace.${k} must be an array`)
    for (const h of t.commodities_history || []) {
      if (!h.commodity || !h.source || !h.ref || !h.note) errs.push(`${at}: commodities_history entries need commodity, source, ref and note`)
    }
    if (t.ship_fit && !(Array.isArray(t.ship_fit.classes) || Array.isArray(t.ship_fit.groups))) errs.push(`${at}: ship_fit needs classes[] and/or groups[]`)
  }
  for (const b of osm?.berths || []) if (!ids.has(b.terminal)) errs.push(`${OSM_FILE}: berth ${b.key} for unknown terminal ${b.terminal}`)
  return errs
}

/** Every raw key the list refers to, per source (what the import has to fetch). */
export function requiredKeys({ main, osm }) {
  const usace = new Set(), ecology = new Map(), bcpt = new Map(), osmIds = new Set(), gem = new Set(), gemLng = new Set(), gisis = new Set(), ctRef = new Set(), ctPort = new Set()
  for (const t of main.terminals) {
    for (const k of t.sources?.['usace-docks'] || []) usace.add(k)
    for (const e of t.sources?.['wa-ecology-facilities'] || []) ecology.set(Number(e.objectid), e.name)
    for (const e of t.sources?.['bc-ports-terminals'] || []) bcpt.set(Number(e.source_data_id), e.name)
    for (const k of t.sources?.osm || []) osmIds.add(k)
    for (const k of t.sources?.['gem-gctt'] || []) gem.add(k)
    for (const k of t.sources?.['gem-ggit'] || []) gemLng.add(k)
    for (const b of t.berths || []) if (b.basis === 'gisis_facility') gisis.add(b.ref)
    for (const id of t.climate_trace?.refinery_facility_ids || []) ctRef.add(Number(id))
    for (const id of t.climate_trace?.ship_port_ids || []) ctPort.add(Number(id))
  }
  for (const b of osm.berths || []) for (const k of b.osm) osmIds.add(k)
  const sort = (s) => [...s].sort()
  return { usace: sort(usace), ecology, bcpt, osm: sort(osmIds), gem: sort(gem), gemLng: sort(gemLng), gisis: sort(gisis), ctRefinery: [...ctRef].sort((a, b) => a - b), ctPort: [...ctPort].sort((a, b) => a - b) }
}

// ── Raw rows → keyed payloads (pure) ─────────────────────────────────────────

/** One USACE Docks feature (attributes as returned, returnGeometry=false) → { key: NAV_UNIT_ID, payload }. */
export function mapUsaceDock(feature) {
  const a = feature?.attributes || feature
  if (!a?.NAV_UNIT_ID) return { error: 'USACE row without NAV_UNIT_ID' }
  return { key: String(a.NAV_UNIT_ID), payload: a }
}

/** One Ecology layer-132 feature → { key: 'OBJECTID <n>', payload }. The expected name guards against a renumbered layer. */
export function mapEcologyFacility(feature, expectedName = null) {
  const a = feature?.attributes || feature
  if (!Number.isFinite(a?.OBJECTID)) return { error: 'Ecology row without OBJECTID' }
  const key = `OBJECTID ${a.OBJECTID}`
  if (expectedName != null && String(a.FacilityName || '').trim() !== String(expectedName).trim()) {
    return { key, error: `Ecology ${key} is now "${a.FacilityName}", expected "${expectedName}": the layer may have been renumbered` }
  }
  return { key, payload: feature?.attributes ? { attributes: a, geometry: feature.geometry ?? null } : { attributes: a, geometry: null } }
}

/** One BC Ports and Terminals WFS feature → { key: 'SOURCE_DATA_ID <n>', payload } (FACILITY_NAME re-checked like Ecology's). */
export function mapBcPortTerminal(feature, expectedName = null) {
  const p = feature?.properties || {}
  const id = /^\d+$/.test(String(p.SOURCE_DATA_ID ?? '').trim()) ? Number(p.SOURCE_DATA_ID) : null // the WFS sends it as a string
  if (id === null) return { error: 'BC Ports and Terminals row without SOURCE_DATA_ID' }
  const key = `SOURCE_DATA_ID ${id}`
  if (expectedName != null && String(p.FACILITY_NAME || '').trim() !== String(expectedName).trim()) {
    return { key, error: `BC Ports and Terminals ${key} is now "${p.FACILITY_NAME}", expected "${expectedName}"` }
  }
  // The WFS feature id ("…fid-<session hash>…") changes between requests, so it is left out of the stored payload:
  // otherwise every re-import would look like a changed record.
  return { key, payload: { type: feature.type ?? 'Feature', geometry: feature.geometry ?? null, properties: p } }
}

/** One Overpass element (out center tags) → { key: 'way/123', payload } exactly as received (the OSM base time is the record's dataset_version). */
export function mapOsmElement(e) {
  if (!e?.type || !Number.isFinite(e?.id)) return { error: 'OSM element without type/id' }
  return { key: `${e.type}/${e.id}`, payload: e }
}

/** Minimal RFC 4180 CSV parser for GEM's map file (quoted fields, commas and quotes inside quotes). */
export function parseCsv(text) {
  const rows = []
  let row = [], f = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { f += '"'; i++ } else if (ch === '"') q = false; else f += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(f); f = '' } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(f); rows.push(row); row = []; f = ''
    } else f += ch
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row) }
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0] !== '')
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

/** One GEM GCTT map-file row → { key: '<terminal id>/<unit id>', terminalId, payload }. */
export function mapGemRow(row) {
  const t = row?.['gem-terminal-id'], u = row?.['gem-unit/phase-id']
  if (!t || !u) return { error: 'GEM row without terminal/unit id' }
  return { key: `${t}/${u}`, terminalId: t, payload: row }
}

/** One GEM GGIT map-file feature (an LNG terminal unit) → { key: unit id, payload } exactly as in the file. */
export function mapGemLngFeature(f) {
  const id = f?.properties?.id
  if (!id || !/^T\d+$/.test(String(id))) return { error: 'GEM GGIT feature without a T… unit id' }
  if (!/^GGIT-lng/.test(String(f.properties['tracker-acro'] || ''))) return { error: `GEM ${id} is not an LNG terminal row` }
  return { key: String(id), payload: f }
}

/** One Climate TRACE refinery feature from the bake → { key, payload } (monthly series left out, like ct_port). */
export function mapCtRefinery(feature, release = null) {
  const p = feature?.properties || {}
  const [lon, lat] = feature?.geometry?.coordinates || []
  if (p.sub !== 'oil-and-gas-refining') return { error: `not a refinery source: ${p.sub}` }
  if (!Number.isFinite(p.id) || !Number.isFinite(lat)) return { error: `bad feature ${p.id}` }
  return { key: String(p.id), payload: { id: p.id, name: p.n ?? null, sub: p.sub, country: p.c ?? null, lat, lon,
    owner: p.o ?? null, capacity: p.k ?? null, confidence: p.q ?? null, release } }
}

/** A position from OSM elements (Overpass `center` for ways/relations, lat/lon for nodes): the mean of their points. */
export function osmPosition(elements) {
  const pts = (elements || []).map((e) => e?.center || (Number.isFinite(e?.lat) ? { lat: e.lat, lon: e.lon } : null))
  if (!pts.length || pts.some((p) => !p)) return null
  return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length }
}

/**
 * Berth positions of one terminal from the stored raw rows (pure). raw = { usace: Map(key→payload), ecology: Map, osm: Map }.
 * USACE / Ecology berths take the source's own coordinates; OSM berths are recomputed from the OSM elements and compared
 * with the reviewed value in the ODbL file (drift reported, the live evidence wins).
 * Returns { berths: [{ key, name, lat, lon, basis, source, refs, odbl, detail }], problems: [] }.
 */
export function resolveBerths(t, osmBerths, raw, { driftKm = 0.05 } = {}) {
  const out = [], problems = []
  for (const b of t.berths || []) {
    if (b.basis === 'usace_dock') {
      const a = raw.usace.get(b.ref)
      if (!a) { problems.push(`${t.id}/${b.key}: USACE ${b.ref} not in the fetched rows`); continue }
      out.push({ key: b.key, name: b.name ?? a.NAV_UNIT_NAME ?? null, lat: a.LATITUDE, lon: a.LONGITUDE, basis: b.basis, source: 'usace-docks', refs: [b.ref], odbl: false,
        detail: { ...(b.crosscheck ? { crosscheck: b.crosscheck } : {}) } })
    } else if (b.basis === 'ecology_dock') {
      const a = raw.ecology.get(b.ref)?.attributes
      if (!a) { problems.push(`${t.id}/${b.key}: Ecology ${b.ref} not in the fetched rows`); continue }
      out.push({ key: b.key, name: b.name ?? a.FacilityName ?? null, lat: a.DockLatNumber, lon: a.DockLongNumber, basis: b.basis, source: 'wa-ecology-facilities', refs: [b.ref], odbl: false, detail: {} })
    } else if (b.basis === 'bc_ports_terminals') {
      const p = raw.bcpt?.get(b.ref)?.properties
      if (!p) { problems.push(`${t.id}/${b.key}: BC Ports and Terminals ${b.ref} not in the fetched rows`); continue }
      out.push({ key: b.key, name: b.name ?? p.FACILITY_NAME ?? null, lat: p.LATITUDE, lon: p.LONGITUDE, basis: b.basis, source: 'bc-ports-terminals', refs: [b.ref], odbl: false,
        detail: { ...(p.TERMINAL_BERTHS_DESC ? { berths_desc: p.TERMINAL_BERTHS_DESC } : {}) } })
    } else if (b.basis === 'gisis_facility') {
      // raw.gisis: Map(IMO Port Facility Number → lib/ships/gisis.js mapFacilityRow(..).facility).
      const f = raw.gisis?.get(b.ref)
      if (!f) { problems.push(`${t.id}/${b.key}: IMO GISIS facility ${b.ref} is not stored (run ships:import-gisis facilities)`); continue }
      if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon)) { problems.push(`${t.id}/${b.key}: IMO GISIS facility ${b.ref} has no position`); continue }
      out.push({ key: b.key, name: b.name ?? f.name ?? null, lat: f.lat, lon: f.lon, basis: b.basis, source: GISIS_FACILITIES_SOURCE_ID, refs: [b.ref], odbl: false,
        detail: { facility_name: f.name, port: f.port, precision: 'GISIS point: degrees + decimal minutes (about 20 m); the facility, not a surveyed berth' } })
    }
  }
  for (const k of t.osm_berths || []) {
    const b = (osmBerths || []).find((x) => x.terminal === t.id && x.key === k)
    if (!b) { problems.push(`${t.id}/${k}: not in the OSM file`); continue }
    const els = b.osm.map((id) => raw.osm.get(id))
    if (els.some((e) => !e)) { problems.push(`${t.id}/${k}: OSM element(s) missing: ${b.osm.filter((id) => !raw.osm.get(id)).join(', ')}`); continue }
    const p = osmPosition(els)
    if (!p) { problems.push(`${t.id}/${k}: OSM element(s) without a position`); continue }
    const drift = haversineKm(p.lat, p.lon, b.lat, b.lon)
    if (drift > driftKm) problems.push(`${t.id}/${k}: OSM position moved ${drift.toFixed(3)} km from the reviewed value (review ${OSM_FILE})`)
    out.push({ key: k, name: b.label ?? null, lat: p.lat, lon: p.lon, basis: b.basis, source: 'osm', refs: b.osm, odbl: true,
      detail: { osm: b.osm, reviewed: { lat: b.lat, lon: b.lon }, drift_km: Math.round(drift * 1000) / 1000, ...(b.basis === 'osm_site_center' ? { precision: 'low: site bounding-box centre' } : {}),
        ...(b.official_berth ? { official_berth: b.official_berth } : {}) } })
  }
  return { berths: out, problems }
}

// ── Matching (pure) ──────────────────────────────────────────────────────────

/**
 * Terminals nearest to a point: [{ key, km, berth }] sorted by distance, one entry per terminal (its nearest berth).
 * berths: [{ terminal, key, lat, lon }] (terminal = the terminal's key).
 */
export function nearestTerminals(lat, lon, berths) {
  const best = new Map()
  for (const b of berths || []) {
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lon)) continue
    const d = haversineKm(lat, lon, b.lat, b.lon)
    const cur = best.get(b.terminal)
    if (!cur || d < cur.km || (d === cur.km && String(b.key) < String(cur.berth))) best.set(b.terminal, { key: b.terminal, km: d, berth: b.key })
  }
  return [...best.values()].sort((a, b) => a.km - b.km || String(a.key).localeCompare(String(b.key)))
}

/**
 * One GFW stop (an anchorage position + GFW's atDock flag) → terminal match (pure).
 *   { status: 'none' }                                   nearest terminal farther than MATCH_KM
 *   { status: 'match', terminal, km, berth, dock }       one terminal
 *   { status: 'ambiguous', oneOf: [...], km, dock }      the next terminal(s) lie within AMBIGUITY_RATIO × nearest
 * dock = 'berthed' only when atDock === true; otherwise 'nearby' (at anchor or close by; GFW's flag absent or false).
 */
export function matchStop({ lat, lon, atDock }, berths) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { status: 'none', reason: 'no position' }
  const near = nearestTerminals(lat, lon, berths)
  const first = near[0]
  if (!first || first.km > MATCH_KM) return { status: 'none', nearest: first ? { key: first.key, km: round3(first.km) } : null }
  const dock = atDock === true ? 'berthed' : 'nearby'
  const close = near.filter((n) => n.km <= first.km * AMBIGUITY_RATIO)
  if (close.length > 1) {
    return { status: 'ambiguous', oneOf: close.map((n) => ({ terminal: n.key, km: round3(n.km), berth: n.berth })), km: round3(first.km), dock }
  }
  return { status: 'match', terminal: first.key, km: round3(first.km), berth: first.berth, dock }
}
const round3 = (x) => Math.round(x * 1000) / 1000

/** The stops of one port_visits row (start, intermediate, end anchorages; event position if the intermediate has none). */
export function visitStops(v) {
  const s = [
    { slot: 'start', lat: v.start_lat, lon: v.start_lon, atDock: v.start_at_dock, anchorage: v.start_anchorage_id },
    { slot: 'intermediate', lat: v.int_lat ?? v.lat, lon: v.int_lon ?? v.lon, atDock: v.int_at_dock, anchorage: v.int_anchorage_id },
    { slot: 'end', lat: v.end_lat, lon: v.end_lon, atDock: v.end_at_dock, anchorage: v.end_anchorage_id },
  ]
  return s.filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon))
}

/**
 * One visit → what it says about each terminal (pure). Uses every stop.
 * Returns { stops: [{ slot, ...matchStop }], terminals: Map(key → { relation, dock, km, slots, oneOf }) } where
 *   relation 'match'     at least one stop matched this terminal alone; dock 'berthed' if any of those stops is atDock
 *   relation 'ambiguous' only "one of" stops involve it; oneOf = every terminal those stops could be; dock likewise
 */
export function matchVisit(v, berths) {
  const stops = visitStops(v).map((s) => ({ slot: s.slot, anchorage: s.anchorage ?? null, atDock: s.atDock ?? null, ...matchStop(s, berths) }))
  const terms = new Map()
  const get = (k) => terms.get(k) || { relation: null, dock: 'nearby', km: Infinity, slots: [], oneOf: [] }
  for (const s of stops) {
    if (s.status === 'match') {
      const t = get(s.terminal)
      if (t.relation !== 'match') { t.relation = 'match'; t.dock = 'nearby'; t.km = Infinity; t.slots = []; t.oneOf = [] }
      if (s.dock === 'berthed') t.dock = 'berthed'
      t.km = Math.min(t.km, s.km); t.slots.push(s.slot)
      terms.set(s.terminal, t)
    }
  }
  for (const s of stops) {
    if (s.status !== 'ambiguous') continue
    for (const o of s.oneOf) {
      const t = get(o.terminal)
      if (t.relation === 'match') continue
      t.relation = 'ambiguous'
      if (s.dock === 'berthed') t.dock = 'berthed'
      t.km = Math.min(t.km, o.km); t.slots.push(s.slot)
      t.oneOf = [...new Set([...t.oneOf, ...s.oneOf.map((x) => x.terminal)])].sort()
      terms.set(o.terminal, t)
    }
  }
  return { stops, terminals: terms }
}

/** 'YYYY-MM' .. 'YYYY-MM' (inclusive) → { from, to } dates, to exclusive. Also accepts YYYY-MM-DD bounds. */
export function monthWindow(fromRaw, toRaw) {
  const ym = /^\d{4}-\d{2}$/, day = /^\d{4}-\d{2}-\d{2}$/
  const nextMonth = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}` }
  const from = ym.test(fromRaw || '') ? `${fromRaw}-01` : fromRaw
  const to = ym.test(toRaw || '') ? `${nextMonth(toRaw)}-01` : toRaw
  if (!day.test(from || '') || !day.test(to || '') || Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) {
    return { error: 'from/to must be YYYY-MM or YYYY-MM-DD' }
  }
  if (to <= from) return { error: 'to must be after from' }
  return { from, to }
}

// ── Persistence ──────────────────────────────────────────────────────────────

export async function ensureTerminalSources(c, S) {
  for (const src of TERMINAL_SOURCES) await upsertSource(c, S, src)
}

/**
 * Store the raw rows (evidence) and upsert the curated list (claims). One transaction; idempotent.
 * raw = { usace: [features], ecology: [features], bcpt: [WFS features], osm: { elements, osmBase }, gem: [rows], ctRefinery: [features], release,
 *         urls: { usace, ecology, bcpt, osm, gem, ct } }.
 * Terminals missing from the file become list_status 'withdrawn'; berths/links no longer listed become 'retired'.
 * Returns counts + problems (e.g. OSM drift). Throws on a validation error or a missing raw row, before writing claims.
 */
export async function importTerminals(c, S, data, raw, { runId = null } = {}) {
  const errs = validateTerminalData(data)
  if (errs.length) throw new Error(`terminal data invalid:\n  ${errs.join('\n  ')}`)
  const need = requiredKeys(data)
  const stats = { terminals: 0, berths: 0, links: 0, recordsCreated: 0, withdrawn: 0, retired: 0 }
  const problems = []

  // Evidence.
  const usace = (raw.usace || []).map(mapUsaceDock).filter((m) => !m.error && need.usace.includes(m.key))
  const eco = []
  for (const f of raw.ecology || []) {
    const id = f?.attributes?.OBJECTID
    if (!need.ecology.has(id)) continue
    const m = mapEcologyFacility(f, need.ecology.get(id))
    if (m.error) throw new Error(m.error)
    eco.push(m)
  }
  const bcpt = []
  for (const f of raw.bcpt || []) {
    const id = Number(f?.properties?.SOURCE_DATA_ID)
    if (!need.bcpt.has(id)) continue
    const m = mapBcPortTerminal(f, need.bcpt.get(id))
    if (m.error) throw new Error(m.error)
    bcpt.push(m)
  }
  const osm = (raw.osm?.elements || []).map((e) => mapOsmElement(e)).filter((m) => !m.error && need.osm.includes(m.key))
  const gem = (raw.gem || []).map(mapGemRow).filter((m) => !m.error && need.gem.includes(m.terminalId))
  const gemLng = (raw.gemLng || []).map(mapGemLngFeature).filter((m) => !m.error && need.gemLng.includes(m.key))
  // IMO GISIS facility rows are stored by lib/ships/gisis.js; the berths read them back (no new fetch). Imported lazily:
  // gisis.js imports this module.
  let gisisFac = new Map()
  if (need.gisis.length) {
    const { storedFacilities } = await import('./gisis.js')
    gisisFac = await storedFacilities(c, S, need.gisis)
  }
  const ctRef = (raw.ctRefinery || []).map((f) => mapCtRefinery(f, raw.release ?? null)).filter((m) => !m.error && need.ctRefinery.includes(Number(m.key)))
  const missing = [
    ...need.usace.filter((k) => !usace.some((m) => m.key === k)).map((k) => `USACE ${k}`),
    ...[...need.ecology.keys()].filter((k) => !eco.some((m) => m.key === `OBJECTID ${k}`)).map((k) => `Ecology OBJECTID ${k}`),
    ...[...need.bcpt.keys()].filter((k) => !bcpt.some((m) => m.key === `SOURCE_DATA_ID ${k}`)).map((k) => `BC Ports and Terminals SOURCE_DATA_ID ${k}`),
    ...need.osm.filter((k) => !osm.some((m) => m.key === k)).map((k) => `OSM ${k}`),
    ...need.gem.filter((k) => !gem.some((m) => m.terminalId === k)).map((k) => `GEM ${k}`),
    ...need.gemLng.filter((k) => !gemLng.some((m) => m.key === k)).map((k) => `GEM GGIT ${k}`),
    ...need.gisis.filter((k) => !gisisFac.has(k)).map((k) => `IMO GISIS facility ${k} (run ships:import-gisis facilities first)`),
    ...need.ctRefinery.filter((k) => !ctRef.some((m) => m.key === String(k))).map((k) => `Climate TRACE refinery ${k}`),
  ]
  if (missing.length) throw new Error(`raw rows missing for: ${missing.join(', ')}`)
  const opts = (url) => ({ runId, retrievalUrl: url ?? null })
  const rec = {}
  for (const [name, src, kind, items, url, ver] of [
    ['usace', 'usace-docks', RAW_KIND.usace, usace, raw.urls?.usace],
    ['ecology', 'wa-ecology-facilities', RAW_KIND.ecology, eco, raw.urls?.ecology],
    ['bcpt', 'bc-ports-terminals', RAW_KIND.bcpt, bcpt, raw.urls?.bcpt],
    ['osm', 'osm', RAW_KIND.osm, osm, raw.urls?.osm, raw.osm?.osmBase],
    ['gem', 'gem-gctt', RAW_KIND.gem, gem, raw.urls?.gem, 'map file 2025-01-15'],
    ['gemLng', 'gem-ggit', RAW_KIND.gemLng, gemLng, raw.urls?.gemLng ?? GEM_GGIT_URL, 'map file ggit_2024-12-20'],
    ['ctRefinery', CLIMATE_TRACE_SOURCE.id, RAW_KIND.ctRefinery, ctRef, raw.urls?.ct, raw.release],
  ]) {
    const r = await storeRawRecords(c, S, src, kind, items, { ...opts(url), datasetVersion: ver ?? null })
    stats.recordsCreated += r.created
    rec[name] = r.byKey
  }
  const last = (m, k) => { const l = m.get(k); return l ? l[l.length - 1] : null }
  const entries = data.main.terminals.map((t) => ({ key: t.id, payload: t }))
  const re = await storeRawRecords(c, S, TERMINALS_LIST_SOURCE.id, RAW_KIND.entry, entries, { runId, retrievalUrl: `lib/ships/data/${DATA_FILE}`, datasetVersion: data.main.version ?? null })
  stats.recordsCreated += re.created

  // Climate TRACE ship ports are stored by scripts/ships/import-climatetrace-ports.mjs (kind ct_port); link to them when present.
  const { rows: ctPorts } = need.ctPort.length ? await c.query(
    `SELECT DISTINCT ON (se.entity_key) se.entity_key, sr.id FROM ${S}.source_entities se JOIN ${S}.source_records sr ON sr.source_entity_id = se.id
      WHERE se.source_id = $1 AND se.entity_kind = $2 AND se.entity_key = ANY($3) ORDER BY se.entity_key, sr.last_retrieved_at DESC, sr.id DESC`,
    [CLIMATE_TRACE_SOURCE.id, CT_KIND, need.ctPort.map(String)]) : { rows: [] }
  const ctPortRec = new Map(ctPorts.map((r) => [r.entity_key, r.id]))
  for (const id of need.ctPort) if (!ctPortRec.has(String(id))) problems.push(`Climate TRACE ship port ${id} is not stored yet (run ships:import-climatetrace-ports); linked without a record`)

  const rawMaps = {
    usace: new Map(usace.map((m) => [m.key, m.payload])),
    ecology: new Map(eco.map((m) => [m.key, m.payload])),
    bcpt: new Map(bcpt.map((m) => [m.key, m.payload])),
    osm: new Map(osm.map((m) => [m.key, m.payload])),
    gisis: new Map([...gisisFac].map(([k, v]) => [k, v.facility])),
  }
  rec.gisis = new Map([...gisisFac].map(([k, v]) => [k, [v.recordId]]))

  // Claims.
  const seen = []
  for (const t of data.main.terminals) {
    const { berths, problems: bp } = resolveBerths(t, data.osm.berths, rawMaps)
    problems.push(...bp)
    if (!berths.length) throw new Error(`${t.id}: no berth position could be resolved`)
    const lat = berths.reduce((s, b) => s + b.lat, 0) / berths.length, lon = berths.reduce((s, b) => s + b.lon, 0) / berths.length
    const cf = t.commodities_from
    const { rows: [tr] } = await c.query(
      `INSERT INTO ${S}.terminals (key, name, kind, country, commodities, commodities_source_id, commodities_ref, operator, operator_source_url,
         operator_checked, status, status_source_url, lat, lon, list_status, entry_source_record_id, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'listed',$15,$16)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, country = EXCLUDED.country, commodities = EXCLUDED.commodities,
         commodities_source_id = EXCLUDED.commodities_source_id, commodities_ref = EXCLUDED.commodities_ref, operator = EXCLUDED.operator,
         operator_source_url = EXCLUDED.operator_source_url, operator_checked = EXCLUDED.operator_checked, status = EXCLUDED.status,
         status_source_url = EXCLUDED.status_source_url, lat = EXCLUDED.lat, lon = EXCLUDED.lon, list_status = 'listed',
         entry_source_record_id = EXCLUDED.entry_source_record_id, detail = EXCLUDED.detail,
         updated_at = CASE WHEN ${S}.terminals.entry_source_record_id = EXCLUDED.entry_source_record_id AND ${S}.terminals.lat = EXCLUDED.lat
                             AND ${S}.terminals.lon = EXCLUDED.lon THEN ${S}.terminals.updated_at ELSE now() END
       RETURNING id`,
      [t.id, t.name, t.kind, t.country, t.commodities || [], cf?.source ?? null, cf ? `${cf.ref}${cf.field ? ` (${cf.field})` : ''}` : null,
        t.operator ?? null, t.operator_source_url ?? null, t.operator_checked ?? null, t.status ?? null, t.status_source_url ?? null,
        lat, lon, last(re.byKey, t.id), { notes: t.notes || [], climate_trace: t.climate_trace, sources: t.sources,
          ...(t.commodities_history ? { commodities_history: t.commodities_history } : {}), ...(t.ship_fit ? { ship_fit: t.ship_fit } : {}),
          ...(t.status_note ? { status_note: t.status_note } : {}), ...(t.status_date ? { status_date: t.status_date } : {}),
          ...(t.operator_note ? { operator_note: t.operator_note } : {}) }])
    seen.push(t.id)
    stats.terminals++
    // Berths.
    for (const b of berths) {
      const recMap = { 'usace-docks': rec.usace, 'wa-ecology-facilities': rec.ecology, 'bc-ports-terminals': rec.bcpt, osm: rec.osm, [GISIS_FACILITIES_SOURCE_ID]: rec.gisis }[b.source]
      const ids = b.refs.map((k) => last(recMap, k)).filter(Boolean)
      await c.query(
        `INSERT INTO ${S}.terminal_berths (terminal_id, berth_key, name, lat, lon, basis, source_id, source_record_ids, odbl, status, detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10)
         ON CONFLICT (terminal_id, berth_key) DO UPDATE SET name = EXCLUDED.name, lat = EXCLUDED.lat, lon = EXCLUDED.lon, basis = EXCLUDED.basis,
           source_id = EXCLUDED.source_id, source_record_ids = EXCLUDED.source_record_ids, odbl = EXCLUDED.odbl, status = 'active',
           detail = EXCLUDED.detail, last_seen_at = now()`,
        [tr.id, b.key, b.name, b.lat, b.lon, b.basis, b.source, ids, b.odbl, b.detail])
      stats.berths++
    }
    stats.retired += (await c.query(`UPDATE ${S}.terminal_berths SET status = 'retired' WHERE terminal_id = $1 AND status = 'active' AND NOT (berth_key = ANY($2))`,
      [tr.id, berths.map((b) => b.key)])).rowCount
    // Links.
    const links = []
    const berthRefs = new Set(berths.filter((b) => b.source !== 'osm').flatMap((b) => b.refs))
    for (const b of t.berths || []) if (b.crosscheck) berthRefs.add(b.crosscheck.ref)
    for (const k of t.sources?.['usace-docks'] || []) links.push({ role: berthRefs.has(k) ? 'dock_record' : 'reference', src: 'usace-docks', key: k, rid: last(rec.usace, k) })
    for (const e of t.sources?.['wa-ecology-facilities'] || []) {
      const k = `OBJECTID ${e.objectid}`
      links.push({ role: berthRefs.has(k) ? 'dock_record' : 'reference', src: 'wa-ecology-facilities', key: k, rid: last(rec.ecology, k), detail: { name: e.name } })
    }
    for (const e of t.sources?.['bc-ports-terminals'] || []) {
      const k = `SOURCE_DATA_ID ${e.source_data_id}`
      links.push({ role: berthRefs.has(k) ? 'dock_record' : 'reference', src: 'bc-ports-terminals', key: k, rid: last(rec.bcpt, k), detail: { name: e.name } })
    }
    const berthOsm = new Set(berths.filter((b) => b.source === 'osm').flatMap((b) => b.refs))
    for (const k of t.sources?.osm || []) links.push({ role: berthOsm.has(k) ? 'osm_berth_element' : 'osm_site', src: 'osm', key: k, rid: last(rec.osm, k) })
    for (const k of berthOsm) if (!(t.sources?.osm || []).includes(k)) links.push({ role: 'osm_berth_element', src: 'osm', key: k, rid: last(rec.osm, k) })
    for (const b of berths.filter((x) => x.source === GISIS_FACILITIES_SOURCE_ID)) {
      links.push({ role: 'dock_record', src: GISIS_FACILITIES_SOURCE_ID, key: b.refs[0], rid: last(rec.gisis, b.refs[0]), detail: { name: b.detail?.facility_name ?? null } })
    }
    for (const k of t.sources?.['gem-ggit'] || []) links.push({ role: 'gem_lng_terminal', src: 'gem-ggit', key: k, rid: last(rec.gemLng, k) })
    for (const g of t.sources?.['gem-gctt'] || []) {
      for (const m of gem.filter((x) => x.terminalId === g)) links.push({ role: 'gem_coal_terminal', src: 'gem-gctt', key: m.key, rid: last(rec.gem, m.key) })
    }
    for (const id of t.climate_trace?.refinery_facility_ids || []) links.push({ role: 'ct_refinery', src: CLIMATE_TRACE_SOURCE.id, key: String(id), rid: last(rec.ctRefinery, String(id)) })
    for (const id of t.climate_trace?.ship_port_ids || []) links.push({ role: 'ct_ship_port', src: CLIMATE_TRACE_SOURCE.id, key: String(id), rid: ctPortRec.get(String(id)) ?? null })
    for (const l of links) {
      await c.query(
        `INSERT INTO ${S}.terminal_links (terminal_id, role, source_id, entity_key, source_record_id, status, detail)
         VALUES ($1,$2,$3,$4,$5,'active',$6)
         ON CONFLICT (terminal_id, role, source_id, entity_key) DO UPDATE SET source_record_id = coalesce(EXCLUDED.source_record_id, ${S}.terminal_links.source_record_id),
           status = 'active', detail = EXCLUDED.detail, last_seen_at = now()`,
        [tr.id, l.role, l.src, l.key, l.rid ?? null, l.detail ?? {}])
      stats.links++
    }
    stats.retired += (await c.query(
      // IMO GISIS facility links are written and retired by lib/ships/gisis.js (its own crosswalk), never here.
      `UPDATE ${S}.terminal_links SET status = 'retired' WHERE terminal_id = $1 AND status = 'active' AND role <> 'imo_port_facility'
          AND NOT ((role || chr(1) || source_id || chr(1) || entity_key) = ANY($2))`,
      [tr.id, links.map((l) => `${l.role}\u0001${l.src}\u0001${l.key}`)])).rowCount
  }
  stats.withdrawn = (await c.query(`UPDATE ${S}.terminals SET list_status = 'withdrawn', updated_at = now() WHERE list_status = 'listed' AND NOT (key = ANY($1))`, [seen])).rowCount
  return { ...stats, problems }
}

// ── Read ─────────────────────────────────────────────────────────────────────

/** All listed terminals with their active berths and links (map layer / list). q(text, params) → rows. */
export async function listTerminals(q, S) {
  const terms = await q(`SELECT id, key, name, kind, country, commodities, commodities_source_id, commodities_ref, operator, operator_source_url,
                                operator_checked, status, status_source_url, lat, lon, entry_source_record_id, detail
                           FROM ${S}.terminals WHERE list_status = 'listed' ORDER BY key`)
  const berths = await q(`SELECT b.terminal_id, b.berth_key AS key, b.name, b.lat, b.lon, b.basis, b.source_id, b.source_record_ids, b.odbl, b.detail
                            FROM ${S}.terminal_berths b JOIN ${S}.terminals t ON t.id = b.terminal_id
                           WHERE b.status = 'active' AND t.list_status = 'listed' ORDER BY b.terminal_id, b.berth_key`)
  const links = await q(`SELECT l.terminal_id, l.role, l.source_id, l.entity_key, l.source_record_id, l.detail
                           FROM ${S}.terminal_links l WHERE l.status = 'active' ORDER BY l.terminal_id, l.role, l.entity_key`)
  const by = (rows) => rows.reduce((m, r) => m.set(r.terminal_id, [...(m.get(r.terminal_id) || []), r]), new Map())
  const bb = by(berths), ll = by(links)
  return terms.map((t) => ({ ...t, berths: (bb.get(t.id) || []).map(({ terminal_id, ...b }) => b), links: (ll.get(t.id) || []).map(({ terminal_id, ...l }) => l) }))
}

/** Active berths of every listed terminal, in the shape matchStop wants. */
export async function allBerths(q, S) {
  return q(`SELECT t.key AS terminal, b.berth_key AS key, b.lat, b.lon FROM ${S}.terminal_berths b JOIN ${S}.terminals t ON t.id = b.terminal_id
             WHERE b.status = 'active' AND t.list_status = 'listed'`)
}

const iso = (d) => (d == null ? null : d instanceof Date ? d.toISOString() : String(d))

/**
 * Ship visits for one terminal in [from, to) by visit start (API-ready). from/to: 'YYYY-MM' (inclusive months) or YYYY-MM-DD
 * (to exclusive). Reads stored GFW port visits only (no GFW calls). Each visit: vessel (GFW identity, name, MMSI, flag,
 * type, and the EarthAtlas vessel when it resolves), dates, relation ('match' | 'ambiguous' with oneOf), dock ('berthed' |
 * 'nearby'), and the per-stop evidence (slot, anchorage, atDock, km, berth). q(text, params) → rows.
 */
export async function terminalVisits(q, S, terminalKey, { from, to, limit = 500, offset = 0, all = false } = {}) {
  const win = monthWindow(from, to)
  if (win.error) return { error: win.error }
  const [term] = await q(`SELECT id, key, name, kind, operator, operator_source_url, lat, lon FROM ${S}.terminals WHERE key = $1 AND list_status = 'listed'`, [terminalKey])
  if (!term) return null
  const berths = await allBerths(q, S)
  const own = berths.filter((b) => b.terminal === terminalKey)
  if (!own.length) return { terminal: term, window: win, error: 'terminal has no active berths' }
  // Pre-filter: any stop within REACH_KM of one of this terminal's berths (a box first; exact distances in JS).
  const pad = REACH_KM + 0.05
  const boxes = own.map((b) => { const dLat = pad / 111.2, dLon = pad / (111.2 * Math.cos((b.lat * Math.PI) / 180)); return [b.lat - dLat, b.lat + dLat, b.lon - dLon, b.lon + dLon] })
  const minLat = Math.min(...boxes.map((x) => x[0])), maxLat = Math.max(...boxes.map((x) => x[1]))
  const minLon = Math.min(...boxes.map((x) => x[2])), maxLon = Math.max(...boxes.map((x) => x[3]))
  const inb = (la, lo) => `(${la} BETWEEN $3 AND $4 AND ${lo} BETWEEN $5 AND $6)`
  const rows = await q(
    `SELECT pv.id, pv.event_id, pv.gfw_vessel_id, pv.ssvid, pv.vessel_name_raw, pv.start_at, pv.end_at, pv.duration_hrs, pv.confidence,
            pv.lat, pv.lon, pv.start_lat, pv.start_lon, pv.start_at_dock, pv.start_anchorage_id, pv.int_lat, pv.int_lon, pv.int_at_dock,
            pv.int_anchorage_id, pv.end_lat, pv.end_lon, pv.end_at_dock, pv.end_anchorage_id, pv.int_port_label,
            pv.detail->>'vessel_type' AS gfw_type, pv.detail->>'vessel_flag' AS flag, pv.last_source_record_id, pv.dataset_version
       FROM ${S}.port_visits pv
      WHERE pv.status = 'active' AND pv.source_id = 'gfw-port-visits' AND pv.start_at >= $1::date AND pv.start_at < $2::date
        AND (${inb('pv.start_lat', 'pv.start_lon')} OR ${inb('pv.int_lat', 'pv.int_lon')} OR ${inb('pv.end_lat', 'pv.end_lon')} OR ${inb('pv.lat', 'pv.lon')})
      ORDER BY pv.start_at DESC, pv.id DESC`,
    [win.from, win.to, minLat, maxLat, minLon, maxLon])
  const hits = []
  for (const r of rows) {
    const m = matchVisit(r, berths)
    const t = m.terminals.get(terminalKey)
    if (!t) continue
    hits.push({ r, t, stops: m.stops })
  }
  // Which EarthAtlas ship: the exact GFW identity first (as the port card does), else the MMSI valid at the visit.
  const gfwIds = [...new Set(hits.map((h) => h.r.gfw_vessel_id))]
  const byGfw = gfwIds.length ? await q(
    `SELECT sub_record_ref AS gfw_id, array_agg(DISTINCT vessel_id) AS vessel_ids FROM ${S}.vessel_assertions
      WHERE source_id = 'gfw-vessel-identity' AND sub_record_ref = ANY($1) GROUP BY 1`, [gfwIds]) : []
  const g = new Map(byGfw.map((x) => [x.gfw_id, x.vessel_ids]))
  // Else the ship that held the MMSI at the time of the visit (as the port card does), one lookup per GFW identity.
  const needMmsi = [...new Map(hits.filter((h) => (g.get(h.r.gfw_vessel_id) || []).length !== 1 && /^\d{9}$/.test(String(h.r.ssvid || '')))
    .map((h) => [h.r.gfw_vessel_id, h.r])).values()]
  const byMmsi = needMmsi.length ? await q(
    `SELECT x.gfw_id, array_agg(DISTINCT v.vessel_id) AS vessel_ids
       FROM unnest($1::text[], $2::text[], $3::timestamptz[]) AS x(gfw_id, mmsi, at)
       CROSS JOIN LATERAL ${S}.vessels_for_mmsi_at(x.mmsi, x.at) v GROUP BY 1`,
    [needMmsi.map((r) => r.gfw_vessel_id), needMmsi.map((r) => String(r.ssvid)), needMmsi.map((r) => iso(r.start_at))]) : []
  const mm = new Map(byMmsi.map((x) => [x.gfw_id, x.vessel_ids]))
  const summary = { visits: hits.length, vessels: gfwIds.length, berthed: 0, nearby: 0, match: 0, ambiguous: 0, ambiguousWith: {} }
  for (const h of hits) {
    summary[h.t.dock]++; summary[h.t.relation]++
    if (h.t.relation === 'ambiguous') for (const o of h.t.oneOf) if (o !== terminalKey) summary.ambiguousWith[o] = (summary.ambiguousWith[o] || 0) + 1
  }
  // all = every matching visit (the terminal card aggregates them server-side; the API itself never sends that many).
  const lim = all ? Math.max(1, hits.length) : Math.max(1, Math.min(2000, Number(limit) || 500)), off = all ? 0 : Math.max(0, Number(offset) || 0)
  const visits = hits.slice(off, off + lim).map(({ r, t, stops }) => {
    const ids = g.get(r.gfw_vessel_id) || []
    const ms = mm.get(r.gfw_vessel_id) || []
    const vesselId = ids.length === 1 ? ids[0] : ms.length === 1 ? ms[0] : null
    return {
      eventId: r.event_id, recordId: r.last_source_record_id, datasetVersion: r.dataset_version,
      vessel: { gfwId: r.gfw_vessel_id, name: r.vessel_name_raw, mmsi: r.ssvid, flag: r.flag, gfwType: r.gfw_type,
        vesselId, resolvedBy: vesselId ? (ids.length === 1 ? 'gfw_identity' : 'mmsi_at_time') : ids.length > 1 || ms.length > 1 ? 'ambiguous' : null },
      startAt: iso(r.start_at), endAt: iso(r.end_at), hours: r.duration_hrs == null ? null : Number(r.duration_hrs), confidence: r.confidence,
      gfwPortLabel: r.int_port_label,
      relation: t.relation, dock: t.dock, km: round3(t.km), oneOf: t.relation === 'ambiguous' ? t.oneOf : null, slots: t.slots,
      stops: stops.map((s) => ({ slot: s.slot, anchorage: s.anchorage, atDock: s.atDock, status: s.status, km: s.km ?? null,
        terminal: s.terminal ?? null, oneOf: s.oneOf ? s.oneOf.map((o) => o.terminal) : null, dock: s.dock ?? null })),
    }
  })
  return { terminal: term, berths: own, window: win, rule: { matchKm: MATCH_KM, ambiguityRatio: AMBIGUITY_RATIO, berthed: 'GFW atDock on the matching stop' },
    summary, visits, limit: lim, offset: off, sources: ['gfw-port-visits', 'earthatlas-terminals'] }
}

/**
 * The GFW port labels whose stored anchorages (any slot of any stored visit) lie within REACH_KM of a terminal's berths,
 * with how many stops each has there. For whoever fetches GFW events for a terminal (the port card fetches by label):
 * it only knows labels already seen in stored visits, so a terminal with no stored visit nearby returns []. Read-only.
 */
export async function terminalGfwLabels(q, S, terminalKey) {
  const own = (await allBerths(q, S)).filter((b) => b.terminal === terminalKey)
  if (!own.length) return []
  const rows = await q(
    `SELECT x.label, x.anchorage, x.lat, x.lon, count(*)::int AS stops
       FROM ${S}.port_visits pv
       CROSS JOIN LATERAL (VALUES (pv.start_port_label, pv.start_anchorage_id, pv.start_lat, pv.start_lon),
                                  (pv.int_port_label, pv.int_anchorage_id, pv.int_lat, pv.int_lon),
                                  (pv.end_port_label, pv.end_anchorage_id, pv.end_lat, pv.end_lon)) AS x(label, anchorage, lat, lon)
      WHERE pv.status = 'active' AND x.label IS NOT NULL AND x.lat BETWEEN $1 AND $2 AND x.lon BETWEEN $3 AND $4
      GROUP BY 1, 2, 3, 4`,
    (() => {
      const pad = REACH_KM + 0.05
      const lats = own.map((b) => b.lat), lons = own.map((b) => b.lon)
      const dLat = pad / 111.2, dLon = pad / (111.2 * Math.cos((Math.max(...lats.map(Math.abs)) * Math.PI) / 180))
      return [Math.min(...lats) - dLat, Math.max(...lats) + dLat, Math.min(...lons) - dLon, Math.max(...lons) + dLon]
    })())
  const by = new Map()
  for (const r of rows) {
    const km = Math.min(...own.map((b) => haversineKm(r.lat, r.lon, b.lat, b.lon)))
    if (km > REACH_KM) continue
    const cur = by.get(r.label) || { label: r.label, stops: 0, anchorages: 0, nearestKm: Infinity }
    cur.stops += r.stops; cur.anchorages++; cur.nearestKm = Math.min(cur.nearestKm, round3(km))
    by.set(r.label, cur)
  }
  return [...by.values()].sort((a, b) => b.stops - a.stops || a.label.localeCompare(b.label))
}

export const payloadSha = (p) => sha256(canonicalJson(p))
