/**
 * The regulatory record for a point: what the agencies themselves have mapped there. These carry weight in a permit
 * comment or appeal in a way that volunteer sightings can't.
 *
 *   Federal critical habitat  NOAA Fisheries (NMFS ESA Critical Habitat, all designations: polygons + stream lines) and
 *                             USFWS (final + proposed). Exact designated polygons, each with its Federal Register rule.
 *   WDFW Priority Habitats    PHS on the Web, public layers. Non-sensitive species and habitats as mapped; sensitive
 *   and Species (PHS)         species generalized by WDFW to a section, quarter township or township.
 *
 * Each item says whether the spot itself lies inside it (polygons) or only within the circle.
 * Catalogue of these services: docs/IMPACT_SOURCES.md §4.
 */
export const NOAA = 'https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/NMFS_ESA_Critical_Habitat_gdb/FeatureServer'
export const USFWS = 'https://services.arcgis.com/QVENGdaPbd4LUkLV/ArcGIS/rest/services/USFWS_Critical_Habitat/FeatureServer'
const PHS = 'https://geodataservices.wdfw.wa.gov/arcgis/rest/services/PHSOnTheWeb/PHSOnTheWebPublic/MapServer'
export const PHS_MAP_URL = 'https://geodataservices.wdfw.wa.gov/hp/phs/'

import { boxAround, esriToGeoJSON, esriToGeoJSONExact, clipForMap, distanceToGeometry, tileKeysFor, mapShapes } from './geometry.js'
import zlib from 'node:zlib'
import fs from 'node:fs'

const UA = { 'User-Agent': 'EarthAtlas species-of-concern lookup (earthatlas.org)' }
// Areas are drawn this far past the circle, so the map shows what surrounds it.
const MAP_REACH = 1.6
export const HABITAT_DRAW_KM = 10

async function query(layerUrl, { lat, lng, km, outFields, idsOnly = false, box = null }) {
  const u = new URL(`${layerUrl}/query`)
  const p = {
    where: '1=1', outFields: outFields || 'OBJECTID', returnGeometry: 'false', f: 'json',
    geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    ...(km ? { distance: String(km), units: 'esriSRUnit_Kilometer' } : {}),
    ...(idsOnly ? { returnIdsOnly: 'true' } : { resultRecordCount: '2000' }),
    // geometry for the map: WGS84, simplified to ~20 m
    ...(box ? { returnGeometry: 'true', outSR: '4326', maxAllowableOffset: '0.0002', geometryPrecision: '5' } : {}),
  }
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v)
  // ArcGIS Online (USFWS) and the WDFW server both fail now and then: time out slow requests, retry with backoff.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) })
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${u.host}`)
      const d = await res.json()
      if (d.error) throw new Error(`${u.host}: ${d.error.message || 'query error'}${d.error.details?.length ? ` (${d.error.details.join('; ')})` : ''}`)
      return idsOnly ? new Set(d.objectIds || []) : (d.features || []).map(f => ({ ...f.attributes, __geom: box ? (f.geometry?.rings ? esriToGeoJSONExact(f.geometry, box) : esriToGeoJSON(f.geometry, box)) : null }))   // polygons stay exact until mapShapes
    } catch (e) {
      if (attempt >= 4) { console.warn(`[species-of-concern] ${layerUrl.split('/services/')[1]} failed after ${attempt} tries: ${e.message}`); throw e }
      await new Promise(r => setTimeout(r, 1500 * attempt))
    }
  }
}

const day = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : null)
const mdy = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || ''); return m ? `${m[3]}-${m[1]}-${m[2]}` : (s || null) }
const hrefOf = (html) => /href='([^']+)'/.exec(html || '')?.[1] || null
const textOf = (html) => (html || '').replace(/<[^>]+>/g, '').trim() || null
const blank = (v) => (v == null || v === '' || v === 'NA' || v === 'N/A' || v === 'N\\A' || v === 'Not Given' ? null : v)
// "Whale, killer [Southern Resident DPS]" -> "killer whale (Southern Resident DPS)"
function entityWords(entity, comname) {
  const m = /^([^,[]+)(?:,\s*([^[]+))?\s*(?:\[([^\]]+)\])?/.exec(entity || comname || '')
  if (!m) return entity || comname
  const name = m[2] ? `${m[2].trim()} ${m[1].trim().toLowerCase()}` : m[1].trim()
  return m[3] ? `${name} (${m[3]})` : name
}

// ─── Federal critical habitat ───────────────────────────────────────────────
// Read from the stored Washington bake (scripts/species-of-concern/bake-critical-habitat.mjs → Blob), so a lookup never
// asks the agencies' services, which cap shape requests at 60 a minute. The live services are only the fallback.
export const NOAA_FIELDS = 'OBJECTID,SCIENAME,COMNAME,LISTENTITY,LISTSTATUS,CHSTATUS,UNIT,HABTYPE,FR,ECFR,EFFECTDATE,INPORTURL'
export const USFWS_FIELDS = 'OBJECTID,comname,sciname,unitname,subunitname,status,fedreg,effectdate,listing_status'

export const normalizeNoaa = (a, line) => ({
  agency: 'NOAA Fisheries', name: entityWords(a.LISTENTITY, a.COMNAME), scientific_name: a.SCIENAME,
  listed_entity: a.LISTENTITY, listing_status: a.LISTSTATUS, designation: a.CHSTATUS, unit: blank(a.UNIT),
  habitat: blank(a.HABTYPE) || (line ? 'streams' : null),
  rule: textOf(a.FR), rule_url: hrefOf(a.FR), ecfr_url: blank(a.ECFR), effective: mdy(a.EFFECTDATE), metadata_url: blank(a.INPORTURL),
})
export const normalizeUsfws = (a, designation) => ({
  agency: 'U.S. Fish and Wildlife Service', name: a.comname, scientific_name: a.sciname, listed_entity: a.comname,
  listing_status: blank(a.listing_status), designation, unit: [blank(a.unitname), blank(a.subunitname)].filter(Boolean).join(', ') || null,
  habitat: null,
  rule: blank(a.fedreg), rule_url: blank(a.fedreg) ? `https://www.federalregister.gov/citation/${encodeURIComponent(a.fedreg)}` : null,
  ecfr_url: null, effective: day(a.effectdate), metadata_url: 'https://ecos.fws.gov/ecp/report/table/critical-habitat.html',
})

const STORE_POINTER = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com/species-of-concern/critical-habitat/wa-latest.json'
const STORE_REFRESH = 6 * 3600000   // re-read the pointer every 6 h, so a monthly re-bake shows up without a deploy
let store = null                    // { at, base, local, index }
const tileCache = new Map()         // "<base>/<key>" -> pieces (kept small: a lookup needs 1–30 tiles)

async function loadIndex() {
  if (store && Date.now() - store.at < STORE_REFRESH) return store
  // localhost can point at a local bake while proving changes: SOC_CRITHAB_DIR=<bake output directory>
  const local = process.env.SOC_CRITHAB_DIR
  if (local) { store = { at: Date.now(), local, index: JSON.parse(fs.readFileSync(`${local}/index.json`, 'utf8')) }; return store }
  const ptr = await fetch(STORE_POINTER, { signal: AbortSignal.timeout(10000) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`pointer HTTP ${r.status}`))))
  if (store && store.base === ptr.base) { store.at = Date.now(); return store }
  const index = await fetch(`${ptr.base}/index.json`, { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`index HTTP ${r.status}`))))
  store = { at: Date.now(), base: ptr.base, index }
  return store
}

async function loadTile(st, key) {
  const id = `${st.base || st.local}/${key}`
  if (tileCache.has(id)) return tileCache.get(id)
  const gz = st.local ? fs.readFileSync(`${st.local}/t/${key}.json.gz`)
    : Buffer.from(await fetch(`${st.base}/t/${key}.json.gz`, { signal: AbortSignal.timeout(20000) }).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`tile ${key} HTTP ${r.status}`)))))
  const pieces = JSON.parse(zlib.gunzipSync(gz).toString())
  if (tileCache.size > 300) tileCache.delete(tileCache.keys().next().value)
  tileCache.set(id, pieces)
  return pieces
}

// Every tile the circle touches is read, so the nearest part of each designation is always among the pieces (each piece
// lies inside its designation): the distance and "inside" answers are the same as with the whole shapes.
async function storedCriticalHabitat({ lat, lng, radiusKm, box }) {
  const st = await loadIndex()
  const dLat = radiusKm / 110.574, dLng = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180))
  const have = new Set(st.index.tiles)
  const keys = tileKeysFor([lng - dLng, lat - dLat, lng + dLng, lat + dLat]).filter((k) => have.has(k))
  const mapKeys = tileKeysFor(box).filter((k) => have.has(k))   // a little wider, for drawing
  const byD = new Map()   // designation index -> { km, inside, geoms }
  for (const key of keys) {
    for (const p of await loadTile(st, key)) {
      const [w, s, e, n] = p.bbox
      if (lng < w - dLng || lng > e + dLng || lat < s - dLat || lat > n + dLat) continue
      const { km, inside } = distanceToGeometry(lat, lng, p.g)
      const cur = byD.get(p.d) || { km: Infinity, inside: false, geoms: [] }
      cur.km = Math.min(cur.km, km); cur.inside ||= inside
      byD.set(p.d, cur)
    }
  }
  const hits = [...byD].filter(([, v]) => v.km <= radiusKm)
  const wanted = new Set(hits.map(([d]) => d))
  for (const key of mapKeys) {
    for (const p of await loadTile(st, key)) {
      if (!wanted.has(p.d)) continue
      // polygons go to mapShapes exact (it clips, simplifies and outlines); lines are clipped and simplified here
      const g = p.g.type === 'MultiPolygon' ? p.g : clipForMap(p.g, box)
      if (g) byD.get(p.d).geoms.push(g)
    }
  }
  const m = st.index.meta
  const asOf = { downloaded: m.baked?.slice(0, 10), agency_edited: m.source_edited }
  return { items: hits.map(([d, v]) => ({ ...st.index.designations[d], contains_point: v.inside, geoms: v.geoms, data_as_of: asOf })), meta: m }
}

async function liveCriticalHabitat(q) {
  const [noaa, usfws] = await Promise.all([noaaCriticalHabitat(q), usfwsCriticalHabitat(q)])
  return [...noaa, ...usfws]
}

async function noaaCriticalHabitat({ lat, lng, radiusKm, box }) {
  const [polys, lines, inside] = await Promise.all([
    query(`${NOAA}/1`, { lat, lng, km: radiusKm, outFields: NOAA_FIELDS, box }),
    query(`${NOAA}/0`, { lat, lng, km: radiusKm, outFields: NOAA_FIELDS, box }),
    query(`${NOAA}/1`, { lat, lng, idsOnly: true }),
  ])
  return [...polys.map(a => ({ a, line: false })), ...lines.map(a => ({ a, line: true }))].map(({ a, line }) => ({
    ...normalizeNoaa(a, line), contains_point: !line && inside.has(a.OBJECTID), geoms: a.__geom ? [a.__geom] : [],
  }))
}

async function usfwsCriticalHabitat({ lat, lng, radiusKm, box }) {
  const layers = [[0, 'Final'], [2, 'Proposed']]
  const out = []
  await Promise.all(layers.map(async ([id, designation]) => {
    const [rows, inside] = await Promise.all([
      query(`${USFWS}/${id}`, { lat, lng, km: radiusKm, outFields: USFWS_FIELDS, box }),
      query(`${USFWS}/${id}`, { lat, lng, idsOnly: true }),
    ])
    for (const a of rows) out.push({ ...normalizeUsfws(a, designation), contains_point: inside.has(a.OBJECTID), geoms: a.__geom ? [a.__geom] : [] })
  }))
  return out
}

// One entry per designation (entity + unit + habitat type); a designation can be several polygons.
function mergeDesignations(items) {
  const m = new Map()
  for (const it of items) {
    const k = [it.agency, it.listed_entity, it.unit, it.designation].join('|')
    const prev = m.get(k)
    if (!prev) m.set(k, { ...it, habitats: it.habitat ? [it.habitat] : [] })
    else {
      prev.contains_point ||= it.contains_point
      prev.geoms.push(...it.geoms)
      if (it.habitat && !prev.habitats.includes(it.habitat)) prev.habitats.push(it.habitat)
    }
  }
  // "marine (nearshore)" + "marine (deepwater)" -> "marine (nearshore, deepwater)"
  for (const d of m.values()) {
    const parts = d.habitats.map(h => /^(.*?)\s*\((.*)\)$/.exec(h) || [h, h, null])
    d.habitat = parts.length && parts.every(p => p[1] === parts[0][1] && p[2]) ? `${parts[0][1]} (${parts.map(p => p[2]).join(', ')})` : d.habitats.join(', ') || null
    delete d.habitats
  }
  return [...m.values()].sort((a, b) => (b.contains_point - a.contains_point) || a.name.localeCompare(b.name))
}

// ─── WDFW Priority Habitats and Species (public) ────────────────────────────
const PHS_FIELDS = 'OBJECTID,Occurrence_Name,Scientific_Name,PriorityArea_Desc,Site_Name,Accuracy_Desc,Source_Date,Source_Entity,SourceDatasetNames_Desc,Federal_Listing_Status,State_Listing_Status,PHS_Listing_Desc,Sensitive_Data_Ind,Display_Resolution_Desc,More_Info_URL,Mgmt_Recs_URL,OccurTypeCrit,Source_Geometry'
const RESOLUTION_WORDS = {
  'AS MAPPED': 'as mapped', TOWNSHIP: 'shown only to the township (36 sq mi)', 'QUARTER TOWNSHIP': 'shown only to the quarter township (9 sq mi)',
  SECTION: 'shown only to the section (1 sq mi)',
}

// A PHS entry is a habitat only when its priority area is a habitat type and it names no species. Species groups
// without a scientific name (Pandalid shrimp, hardshell clams, waterfowl concentrations) and sensitive species whose
// name WDFW withholds (golden eagle) are species entries.
// WDFW's public layer stacks several agencies' datasets (so their shapes overlap): each code in plain words.
const PHS_DATASETS = {
  NWIWetlands: { label: 'National Wetlands Inventory (U.S. Fish and Wildlife Service)', url: 'https://www.fws.gov/program/national-wetlands-inventory' },
  PHSREGION: { label: 'WDFW regional priority habitat mapping' },
  PHSPTS: { label: 'WDFW priority habitat point records' },
  WS_OccurPoint: { label: 'WDFW wildlife survey records' }, WS_OccurPolygon: { label: 'WDFW wildlife survey records' }, WS_MMDetSect: { label: 'WDFW wildlife survey records' },
  Shellfish_Summary: { label: 'WDFW shellfish surveys' },
  Forage_Fish_Survey: { label: 'Forage fish spawning surveys', url: 'https://wdfw.wa.gov/species-habitats/species/forage-fish' },
  HerrSpwn: { label: 'WDFW herring spawning areas' }, HerrHold: { label: 'WDFW herring holding areas' },
  SASI: { label: 'WDFW Salmonid Stock Inventory (SaSI)' },
  SWIFD: { label: 'Statewide Washington Integrated Fish Distribution (SWIFD)' },
  KlicOak: { label: 'WDFW Klickitat oak woodland mapping' },
}
// Who surveyed, where the source names a partner (forage fish surveys): the codes WDFW uses.
const PHS_ENTITIES = {
  FOSJ: 'Friends of the San Juans', WDNR: 'Washington Department of Natural Resources',
  'CLL MRC': 'Clallam County Marine Resources Committee', 'ISL MRC': 'Island County Marine Resources Committee',
  'JEF MRC': 'Jefferson County Marine Resources Committee', 'SKA MRC': 'Skagit County Marine Resources Committee',
  'SNO MRC': 'Snohomish County Marine Resources Committee', 'WHA MRC': 'Whatcom County Marine Resources Committee',
}
const datasetOf = (a) => {
  const code = blank(a.SourceDatasetNames_Desc)
  const d = code ? (PHS_DATASETS[code] || { label: code }) : null
  return d ? { code, ...d } : null
}

const HABITAT_AREAS = /^(aquatic habitat|terrestrial habitat|habitat feature)$/i
// "Caves Or Cave-rich Areas" carries no priority-area type, so it is named here.
const HABITAT_NAMES = /^caves?\b/i
const kindOf = (a, sci) => (!sci && (HABITAT_AREAS.test(a.PriorityArea_Desc || '') || HABITAT_NAMES.test(a.Occurrence_Name || '')) ? 'habitat' : 'species')

async function phsRecords({ lat, lng, radiusKm, box }) {
  const [points, lines, polys, inside] = await Promise.all([
    query(`${PHS}/0`, { lat, lng, km: radiusKm, outFields: PHS_FIELDS, box }),
    query(`${PHS}/1`, { lat, lng, km: radiusKm, outFields: PHS_FIELDS, box }),
    query(`${PHS}/2`, { lat, lng, km: radiusKm, outFields: PHS_FIELDS, box }),
    query(`${PHS}/2`, { lat, lng, idsOnly: true }),
  ])
  const groups = new Map()
  for (const [rows, geom] of [[points, 'point'], [lines, 'line'], [polys, 'area']]) {
    for (const a of rows) {
      const sci = blank(a.Scientific_Name)
      const resolution = blank(a.Display_Resolution_Desc) || 'AS MAPPED'
      const ds = datasetOf(a)
      // one entry per source dataset too, so overlapping shapes from different agencies are told apart
      const k = [a.Occurrence_Name, blank(a.PriorityArea_Desc), resolution, ds?.code || ''].join('|')
      if (!groups.has(k)) groups.set(k, {
        name: a.Occurrence_Name, scientific_name: sci, kind: kindOf(a, sci),
        priority_area: blank(a.PriorityArea_Desc) || blank(a.OccurTypeCrit),
        state_status: blank(a.State_Listing_Status), federal_status: blank(a.Federal_Listing_Status),
        sensitive: a.Sensitive_Data_Ind === 'Y', resolution: RESOLUTION_WORDS[resolution] || resolution.toLowerCase(),
        count: 0, contains_point: false, sites: new Set(), datasets: new Set(), latest_source_date: null,
        more_info_url: blank(a.More_Info_URL), management_url: blank(a.Mgmt_Recs_URL), geometry: geom, geoms: [],
        source_dataset: ds, surveyed_by: new Set(),
      })
      const g = groups.get(k)
      g.count++
      if (geom === 'area' && inside.has(a.OBJECTID)) g.contains_point = true
      // habitat outlines (wetlands etc.) are drawn up to HABITAT_DRAW_KM; past that they swamp the map and the payload
      if (a.__geom && (g.kind === 'species' || radiusKm <= HABITAT_DRAW_KM)) g.geoms.push(a.__geom)
      if (blank(a.Site_Name)) g.sites.add(a.Site_Name)
      const ent = blank((a.Source_Entity || '').trim())
      if (ent && !/^(WDFW|WA Dept\. of Fish and Wildlife|WDFW (Fish|Wildlife) Program|US Fish and Wildlife Service)$/.test(ent)) g.surveyed_by.add(PHS_ENTITIES[ent] || ent)
      if (blank(a.SourceDatasetNames_Desc)) g.datasets.add(a.SourceDatasetNames_Desc)
      const d = day(a.Source_Date)
      if (d && (!g.latest_source_date || d > g.latest_source_date)) g.latest_source_date = d
    }
  }
  return [...groups.values()].map(g => ({ ...g, sites: [...g.sites].slice(0, 6), datasets: [...g.datasets], surveyed_by: [...g.surveyed_by] }))
    .sort((a, b) => (a.kind === 'species' ? 0 : 1) - (b.kind === 'species' ? 0 : 1) || (b.contains_point - a.contains_point) || a.name.localeCompare(b.name))
}

/** The regulatory record within radiusKm of a point. Never throws: a failed source comes back with ok:false. */
export async function fetchRegulatory({ lat, lng, radiusKm }) {
  const q = { lat, lng, radiusKm, box: boxAround(lat, lng, radiusKm * MAP_REACH) }
  const run = async (p) => { try { return { ok: true, items: await p } } catch (e) { return { ok: false, error: String(e.message || e), items: [] } } }
  // Critical habitat from the stored bake; the agencies' live services only if the store can't be read.
  const chRun = async () => {
    try { const r = await storedCriticalHabitat(q); return { ok: true, items: r.items, stored: r.meta } }
    catch (e) {
      console.warn(`[species-of-concern] stored critical habitat unavailable (${e.message}); asking the agencies live`)
      return run(liveCriticalHabitat(q))
    }
  }
  const [ch, phs] = await Promise.all([chRun(), run(phsRecords(q))])
  const critical_habitat = mergeDesignations(ch.items)
  // Map shapes: one GeoJSON feature per item geometry, keyed back to its list item by `id`.
  const features = []
  // An item's pieces become one feature per geometry kind; coordinates are rounded to ~10 m past 10 km.
  const digits = radiusKm > 10 ? 1e4 : 1e5
  const round = (c) => (typeof c[0] === 'number' ? [Math.round(c[0] * digits) / digits, Math.round(c[1] * digits) / digits] : c.map(round))
  const withIds = (items, prefix, layerOf) => items.map((it, i) => {
    const id = `${prefix}${i}`
    const byKind = { MultiPolygon: [], MultiLineString: [], Point: [] }
    for (const g of it.geoms) g.type === 'Point' ? byKind.Point.push(g.coordinates) : g.type === 'MultiPolygon' ? byKind.MultiPolygon.push(g) : byKind[g.type].push(...g.coordinates)
    const props = { id, layer: layerOf(it), name: it.name, source: it.source_dataset?.label || it.agency || '' }
    if (byKind.MultiPolygon.length) {
      // fill + the real boundary only (no mapping-unit seams, tile seams or view-box cuts)
      const { fill, outline } = mapShapes(byKind.MultiPolygon, q.box)
      if (fill) features.push({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: round(fill.coordinates) }, properties: props })
      if (outline) features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: round(outline.coordinates) }, properties: { ...props, outline: true } })
    }
    if (byKind.MultiLineString.length) features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: round(byKind.MultiLineString) }, properties: props })
    if (byKind.Point.length) features.push({ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: round(byKind.Point) }, properties: props })
    const { geoms, ...rest } = it
    return { ...rest, id, on_map: geoms.length > 0 }
  })
  return {
    critical_habitat: withIds(critical_habitat, 'ch', () => 'critical-habitat'),
    phs: withIds(phs.items, 'phs', (it) => (it.kind === 'species' ? 'phs-species' : 'phs-habitat')),
    features,
    sources: [
      { id: 'critical-habitat', label: 'Federal critical habitat (NOAA Fisheries, USFWS)', url: 'https://www.fisheries.noaa.gov/national/endangered-species-conservation/critical-habitat', ok: ch.ok, error: ch.error,
        ...(ch.stored ? { stored: { baked: ch.stored.baked?.slice(0, 10), source_edited: ch.stored.source_edited } } : { live: true }) },
      { id: 'wdfw-phs', label: 'WDFW Priority Habitats and Species (public)', url: PHS_MAP_URL, ok: phs.ok, error: phs.error },
    ],
  }
}
