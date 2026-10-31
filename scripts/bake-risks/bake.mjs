// /risks bake: San Juan County's ESA 2024 sea-level-rise layers (downloaded by fetch.mjs) → map-ready files.
//
//   node scripts/bake-risks/bake.mjs
//
// 1. The four flood layers (one huge multipolygon each) are rebuilt into single polygons with their holes, the 2 ft /
//    1-year one is trimmed to land, every building footprint is tagged with the first scenario that floods it, and
//    all of it is tiled into ONE PMTiles archive: one vector layer per flood band plus "buildings" (tippecanoe). Output:
//    public/dev-data/risks/<FILE> (gitignored; api/risks-tiles.js range-reads it on localhost), and upload.mjs copies
//    it to Blob for production. Bump the version in FILE (and src/risks/risksLayers.js) on every re-bake so the
//    CDN never serves old tiles under the new name.
// 2. The small layers (flood-prone roads, erosion points) are trimmed to the fields the map
//    shows and written to public/risks-data/assessment.geojson (committed; ~80 KB).

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCENARIOS, PMTILES_FILE } from '../../src/risks/risksLayers.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const RAW = resolve(HERE, 'raw')
const BUILD = resolve(HERE, 'build')
const DEV = resolve(ROOT, 'public/dev-data/risks')
const PUBLIC = resolve(ROOT, 'public/risks-data')

// Building footprints: Salish Sea Explorer's copy of the county layer (PIN, island, sq ft, source per building).
const BUILDINGS = process.env.RISKS_BUILDINGS || resolve(ROOT, '../salish-sea-propmapper/public/data/Building_Footprints.geojson')

const need = (f) => { if (!existsSync(f)) throw new Error(`missing ${f}; run fetch.mjs first`); return f }
const mb = (f) => `${(statSync(f).size / 1e6).toFixed(1)} MB`

// The county service's f=geojson output loses the holes: every ring comes back as its own polygon, so dry ground
// inside a flood ring (e.g. the whole interior of Orcas Island in the 2 ft / 1-year layer) draws as flooded. The rings
// keep ArcGIS's orientation (clockwise = outer, counter-clockwise = hole), so rebuild the polygons from that: each hole
// goes to the smallest outer that contains it.
const signedArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2 }
const bboxOf = (r) => { let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity; for (const [x, y] of r) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y } return [w, s, e, n] }
function inRing(x, y, r) {
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j]
    if ((yi > y) !== (yj > y) && x < xi + ((y - yi) * (xj - xi)) / (yj - yi)) inside = !inside
  }
  return inside
}
function assemble(rings) {
  const outers = [], holes = []
  for (const r of rings) {
    const a = signedArea(r)
    ;(a < 0 ? outers : holes).push({ r, area: Math.abs(a), bb: bboxOf(r) })
  }
  for (const o of outers) o.holes = []
  outers.sort((a, b) => a.area - b.area)   // smallest container first
  let orphans = 0
  for (const h of holes) {
    const [w, s, e, n] = h.bb
    // test a few of the hole's vertices: one may sit exactly on the outer's edge
    const probe = [0, Math.floor(h.r.length / 3), Math.floor((2 * h.r.length) / 3)].map((i) => h.r[i])
    const home = outers.find((o) => o.area > h.area && o.bb[0] <= w && o.bb[1] <= s && o.bb[2] >= e && o.bb[3] >= n &&
      probe.filter(([x, y]) => inRing(x, y, o.r)).length >= 2)
    if (home) home.holes.push(h.r); else orphans++
  }
  return { polygons: outers.map((o) => [o.r, ...o.holes]), orphans }
}

function bakeScenarios() {
  mkdirSync(BUILD, { recursive: true })
  mkdirSync(DEV, { recursive: true })
  const layers = []
  for (const s of SCENARIOS) {
    const src = need(resolve(RAW, `${s.raw}.geojson`))
    const out = resolve(BUILD, `${s.id}.geojsonl`)
    // Each layer is one multipolygon of up to ~125k parts; exploding lets tippecanoe drop the smallest pieces at low
    // zooms instead of simplifying one giant feature. Keep no attributes: the layer name says which scenario it is.
    // (Split here, not with ogr2ogr -explodecollections: GDAL takes >10 min per layer on these.)
    const rings = JSON.parse(readFileSync(src, 'utf8')).features.flatMap((f) =>
      (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]).flat())
    const { polygons, orphans } = assemble(rings)
    const full = s.clipToLand ? resolve(BUILD, `${s.id}.full.geojsonl`) : out
    writeFileSync(full, polygons.map((c) => JSON.stringify({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: c } })).join('\n') + '\n')
    console.log(`${s.id}: ${polygons.length} polygons, ${rings.length - polygons.length - orphans} holes${orphans ? `, ${orphans} holes with no outer (dropped)` : ''} → ${mb(full)}`)
    // The 2 ft / 1-year layer also covers ~52 km² of open water (the other three are land only); trim it to the
    // county's island outlines so every scenario shows the same thing: land that floods.
    // Not ogr2ogr -clipsrc: county-wide it silently dropped most of the land (Cattle Point kept 3,489 of 1.73M m²)
    // and wrote malformed rings, so the map lost the beaches and the building join disagreed with the tiles. Here:
    // each flood polygon against the island outlines it touches, after MakeValid on both.
    if (s.clipToLand) {
      const g = resolve(BUILD, `${s.id}.trim.gpkg`)
      rmSync(g, { force: true })
      rmSync(out, { force: true })   // GDAL's GeoJSONSeq writer appends to an existing file even with -overwrite
      const ogr = (args) => execFileSync('ogr2ogr', args, { stdio: 'inherit' })
      ogr(['-f', 'GPKG', g, full, '-nln', 'flood', '-makevalid', '-nlt', 'PROMOTE_TO_MULTI', '-lco', 'GEOMETRY_NAME=geom'])
      ogr(['-f', 'GPKG', '-update', g, need(resolve(RAW, 'shoreline.geojson')), '-nln', 'land', '-makevalid', '-nlt', 'PROMOTE_TO_MULTI',
        '-lco', 'GEOMETRY_NAME=geom'])
      ogr(['-f', 'GeoJSONSeq', out, g, '-dialect', 'SQLite', '-explodecollections', '-nlt', 'POLYGON', '-sql',
        `SELECT CollectionExtract(ST_MakeValid(CASE WHEN ST_Within(f.geom, l.geom) THEN f.geom ELSE ST_Intersection(f.geom, l.geom) END), 3) AS geom
         FROM flood f JOIN land l ON l.fid IN (SELECT id FROM rtree_land_geom r WHERE r.minx <= ST_MaxX(f.geom)
           AND r.maxx >= ST_MinX(f.geom) AND r.miny <= ST_MaxY(f.geom) AND r.maxy >= ST_MinY(f.geom))
         WHERE ST_Intersects(f.geom, l.geom)`])
      console.log(`${s.id}: trimmed to land → ${mb(out)}`)
    }
    layers.push('-L', `${s.id}:${out}`)
  }
  layers.push(...bakeErosionZones())
  const { buildings, hits } = bakeBuildings()
  layers.push('-L', `buildings:${buildings}`, '-L', `hits:${hits}`)
  const pm = resolve(BUILD, PMTILES_FILE)
  // z6 shows the whole county; z14 keeps the ESA modelling detail (overzoomed past that).
  // -r1: never thin the "hits" points at low zoom (there are ~1,400; every one is the point of the map)
  execFileSync('tippecanoe', ['-o', pm, '--force', '-Z6', '-z14', '-r1', '--drop-smallest-as-needed', '--simplification=2',
    '--detect-shared-borders', '-q', ...layers], { stdio: 'inherit' })
  execFileSync('cp', [pm, resolve(DEV, PMTILES_FILE)])
  console.log(`${PMTILES_FILE}: ${mb(pm)} (copied to public/dev-data/risks for localhost)`)
}

// ESA's projected erosion zones (ESA_SLR_Road_Erosion_Boundaries): one multipolygon per year, 2060 and 2100, the band
// inland of the shoreline that erosion is projected to take. Same lost-holes repair as the flood layers. One vector
// layer per year ("erosion2060", "erosion2100").
function bakeErosionZones() {
  const out = []
  for (const f of JSON.parse(readFileSync(need(resolve(RAW, 'erosion-zones.geojson')), 'utf8')).features) {
    const year = f.properties.Scenario_y
    const rings = (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]).flat()
    const { polygons, orphans } = assemble(rings)
    const file = resolve(BUILD, `erosion${year}.geojsonl`)
    writeFileSync(file, polygons.map((c) => JSON.stringify({ type: 'Feature', properties: { year }, geometry: { type: 'Polygon', coordinates: c } })).join('\n') + '\n')
    console.log(`erosion${year}: ${polygons.length} polygons, ${rings.length - polygons.length - orphans} holes${orphans ? `, ${orphans} holes with no outer (dropped)` : ''}`)
    out.push('-L', `erosion${year}:${file}`)
  }
  return out
}

// Each footprint gets "first": the rank (1–4, mildest first, SCENARIOS order) of the first flood band it touches, 0 if
// none. The bands don't overlap (each holds only the ground a worse scenario adds), so the buildings flooded in a
// scenario are those with 0 < first <= its rank. Exact polygon intersection (SpatiaLite, via a GeoPackage + R-tree);
// the bands are cut into pieces of <= 256 vertices first (ST_Subdivide): testing a footprint against a whole
// 180,000-vertex shoreline band ran for 10+ minutes.
function bakeBuildings() {
  const gpkg = resolve(BUILD, 'join.gpkg')
  rmSync(gpkg, { force: true })
  const ogr = (args) => execFileSync('ogr2ogr', ['-f', 'GPKG', ...args], { stdio: 'inherit' })
  ogr([gpkg, need(BUILDINGS), '-nln', 'buildings', '-nlt', 'PROMOTE_TO_MULTI', '-lco', 'GEOMETRY_NAME=geom'])
  // -makevalid: ST_Subdivide silently returns nothing for an invalid polygon, and the big island-wide 1-year bands
  // are invalid (self-touching rings); without it 95% of that band vanished from the join.
  SCENARIOS.forEach((s, i) => ogr(['-append', gpkg, resolve(BUILD, `${s.id}.geojsonl`), '-nln', 'bands', '-nlt', 'PROMOTE_TO_MULTI', '-makevalid',
    '-lco', 'GEOMETRY_NAME=geom', '-dialect', 'SQLite', '-sql', `SELECT ${i + 1} AS rank, geometry FROM "${s.id}"`]))
  ogr(['-update', gpkg, gpkg, '-nln', 'pieces', '-nlt', 'POLYGON', '-explodecollections', '-lco', 'GEOMETRY_NAME=geom',
    '-dialect', 'SQLite', '-sql', 'SELECT rank, ST_Subdivide(geom, 256) AS geom FROM bands'])
  const out = resolve(BUILD, 'buildings.geojsonl')
  rmSync(out, { force: true })
  const sql = `SELECT b.geom, b.PIN AS pin, b.Island AS island, CAST(ROUND(b.Sq_Ft) AS INTEGER) AS sqft,
      COALESCE((SELECT MIN(f.rank) FROM pieces f WHERE f.fid IN (SELECT id FROM rtree_pieces_geom r
        WHERE r.minx <= ST_MaxX(b.geom) AND r.maxx >= ST_MinX(b.geom) AND r.miny <= ST_MaxY(b.geom) AND r.maxy >= ST_MinY(b.geom))
        AND ST_Intersects(b.geom, f.geom)), 0) AS first
    FROM buildings b`
  execFileSync('ogr2ogr', ['-f', 'GeoJSONSeq', '-overwrite', out, gpkg, '-dialect', 'SQLite', '-sql', sql], { stdio: 'inherit' })
  // Flooded buildings show from z10 (they are the point); the other ~29,000 only from z13
  const lines = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  writeFileSync(out, lines.map((f) => JSON.stringify({ ...f, tippecanoe: { minzoom: f.properties.first ? 10 : 13 } })).join('\n') + '\n')
  const by = SCENARIOS.map((s, i) => lines.filter((f) => f.properties.first && f.properties.first <= i + 1).length)
  console.log(`buildings: ${lines.length}; flooded by scenario (cumulative) ${SCENARIOS.map((s, i) => `${s.id} ${by[i]}`).join(', ')}`)
  // "hits": one point per flooded building, so the map can show where the losses are from the county view (a footprint
  // is a few pixels wide there). Point = mean of the footprint's outer-ring vertices; same properties as the footprint.
  const hits = resolve(BUILD, 'hits.geojsonl')
  writeFileSync(hits, lines.filter((f) => f.properties.first).map((f) => JSON.stringify({ type: 'Feature', properties: f.properties,
    geometry: { type: 'Point', coordinates: ringMean(outerRing(f.geometry)) } })).join('\n') + '\n')
  return { buildings: out, hits }
}
const outerRing = (g) => (g.type === 'MultiPolygon' ? g.coordinates[0][0] : g.coordinates[0])
const ringMean = (r) => { const p = r.slice(0, -1); return [p.reduce((a, c) => a + c[0], 0) / p.length, p.reduce((a, c) => a + c[1], 0) / p.length].map((v) => Math.round(v * 1e6) / 1e6) }

// ─── Hotspots ────────────────────────────────────────────────────────────────
// The places with the most flooded buildings, for the panel's jump list: public/risks-data/hotspots.json. Greedy
// clustering of the "hits" points (at the worst scenario): take the point with the most hits within HOT_RADIUS, claim
// them, repeat. Each place is named the way the map labels it (Mapbox Streets labels via the Tilequery API): a
// settlement within 1.5 km, else a bay or harbor within 1 km, else the reverse geocoder's place (the geocoder alone
// names most clusters by their mailing town, e.g. a Stuart Island cove as "Friday Harbor"). Needs VITE_MAPBOX_TOKEN:
// node --env-file=.env.local scripts/bake-risks/bake.mjs --only=hotspots).
const HOT_RADIUS = 700   // metres
const HOT_COUNT = 6
async function bakeHotspots() {
  const token = process.env.VITE_MAPBOX_TOKEN
  if (!token) throw new Error('hotspots: VITE_MAPBOX_TOKEN not set (run with --env-file=.env.local)')
  const pts = readFileSync(need(resolve(BUILD, 'hits.geojsonl')), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    .map((f) => ({ x: f.geometry.coordinates[0], y: f.geometry.coordinates[1], first: f.properties.first, island: f.properties.island }))
  const kx = 111320 * Math.cos((48.55 * Math.PI) / 180), ky = 110540
  const near = (a, b) => Math.hypot((a.x - b.x) * kx, (a.y - b.y) * ky) <= HOT_RADIUS
  let left = pts
  const spots = []
  while (spots.length < HOT_COUNT && left.length) {
    let best = null, bestN = -1
    for (const p of left) { const n = left.filter((q) => near(p, q)).length; if (n > bestN) { best = p; bestN = n } }
    const members = left.filter((q) => near(best, q))
    left = left.filter((q) => !near(best, q))
    const isl = {}
    for (const m of members) isl[m.island] = (isl[m.island] || 0) + 1
    const center = [members.reduce((a, m) => a + m.x, 0) / members.length, members.reduce((a, m) => a + m.y, 0) / members.length]
    const labels = (await (await fetch(`https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${center[0]},${center[1]}.json?radius=1500&limit=30&layers=place_label,natural_label&access_token=${token}`)).json()).features || []
    const label = (cls, within) => labels.find((f) => (f.properties.class || f.properties.type) === cls && f.properties.tilequery.distance <= within)
    let pick = label('settlement', 1500) || label('bay', 1000)
    let nameType = pick ? (pick.properties.class || pick.properties.type) : null
    if (!pick) {
      const g = await (await fetch(`https://api.mapbox.com/search/geocode/v6/reverse?longitude=${center[0]}&latitude=${center[1]}&types=locality,place&access_token=${token}`)).json()
      pick = ['locality', 'place'].map((t) => g.features?.find((f) => f.properties.feature_type === t)).find(Boolean)
      nameType = pick?.properties.feature_type || null
    }
    spots.push({
      name: pick?.properties.name || null, nameType,
      island: Object.entries(isl).sort((a, b) => b[1] - a[1])[0][0],
      center: center.map((v) => Math.round(v * 1e5) / 1e5),
      bbox: [Math.min(...members.map((m) => m.x)), Math.min(...members.map((m) => m.y)), Math.max(...members.map((m) => m.x)), Math.max(...members.map((m) => m.y))].map((v) => Math.round(v * 1e5) / 1e5),
      // cumulative: buildings flooded in each scenario, SCENARIOS order
      counts: SCENARIOS.map((s, i) => members.filter((m) => m.first <= i + 1).length),
    })
  }
  mkdirSync(PUBLIC, { recursive: true })
  writeFileSync(resolve(PUBLIC, 'hotspots.json'), JSON.stringify({ radius: HOT_RADIUS, nameSource: 'Mapbox Streets labels / reverse geocoding', spots }, null, 1))
  for (const h of spots) console.log(`hotspot: ${h.name} (${h.nameType}), ${h.island}: ${h.counts.join(' / ')}`)
}

// ─── Small layers ────────────────────────────────────────────────────────────
const read = (name) => JSON.parse(readFileSync(need(resolve(RAW, `${name}.geojson`)), 'utf8')).features
const round = (c) => (typeof c[0] === 'number' ? [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6] : c.map(round))
const geom = (g) => ({ type: g.type, coordinates: round(g.coordinates) })
const clean = (v) => (typeof v === 'string' ? v.trim() : v) || null

function bakeAssessment() {
  const features = []
  // Roads: the island "coastal roads flooding" layers (214–219) and "other roads flooding" (220) list some of the
  // same segments; keep one copy of each segment and record which county lists carry it.
  const roads = new Map()
  for (const [name, list, lid] of [['roads-sji', 'coastal', 214], ['roads-lopez', 'coastal', 215], ['roads-decatur', 'coastal', 216],
    ['roads-blakely', 'coastal', 217], ['roads-shaw', 'coastal', 218], ['roads-orcas', 'coastal', 219], ['roads-other', 'other', 220]]) {
    for (const f of read(name)) {
      const p = f.properties
      const key = p.GlobalID || JSON.stringify(f.geometry.coordinates).slice(0, 200)
      const have = roads.get(key)
      if (have) { if (!have.properties.lists.includes(list)) { have.properties.lists.push(list); have.properties.lids.push(lid) } continue }
      roads.set(key, { type: 'Feature', geometry: geom(f.geometry), properties: {
        kind: 'road', name: clean(p.Road_Name), island: clean(p.Island), miles: p.Rd_Miles ?? null, lists: [list], lids: [lid] } })
    }
  }
  // lists/lids: which county layers carry the segment (Vulnerability_Assessment_Map layer ids, for the source links)
  for (const f of roads.values()) features.push({ ...f, properties: { ...f.properties, lists: f.properties.lists.join(','), lids: f.properties.lids.join(',') } })

  for (const f of read('erosion-points')) {
    features.push({ type: 'Feature', geometry: geom(f.geometry), properties: { kind: 'erosion', name: clean(f.properties.Name) } })
  }
  mkdirSync(PUBLIC, { recursive: true })
  const out = resolve(PUBLIC, 'assessment.geojson')
  writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }))
  const n = (k) => features.filter((f) => f.properties.kind === k).length
  console.log(`assessment.geojson: ${n('road')} road segments, ${n('erosion')} erosion points, ${(statSync(out).size / 1e3).toFixed(0)} KB`)
}

const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7)
if (!only || only === 'scenarios') bakeScenarios()
if (!only || only === 'assessment') bakeAssessment()
if (!only || only === 'scenarios' || only === 'hotspots') await bakeHotspots()
