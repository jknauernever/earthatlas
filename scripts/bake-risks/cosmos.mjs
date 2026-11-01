#!/usr/bin/env node
// /risks beyond San Juan County: USGS CoSMoS (Coastal Storm Modeling System) flood projections for one county, with the
// buildings they reach (FEMA / ORNL USA Structures), tiled into one PMTiles archive the /risks map draws alongside the
// San Juan layers. Same layer names and meaning as bake.mjs: the four SCENARIOS (mildest first) as bands that don't
// overlap ("slr2_1" … "slr5_100": each the ground that scenario adds to the milder ones), "buildings" (footprints with
// "first" = the rank of the first scenario that floods them) and "hits" (one point per flooded building).
//
//   node scripts/bake-risks/cosmos.mjs king            (--reuse: keep steps 1–2's GeoPackage and bands from the last run)
//
// Inputs (scripts/bake-risks/raw/cosmos-<county>/, gitignored):
//   extent.zip   the county's "Flood_extent_and_uncertainty_projections" zip from its USGS data release (REGIONS.zip)
//   structures.geojsonl   fetched here once: every USA Structures footprint touching any of the four flood extents
// Output: public/dev-data/risks/<REGIONS file> (localhost), uploaded to Blob `risks/` for production.
//
// CoSMoS maps sea-level rise in metres; the County's scenarios are 2 ft and 5 ft. Each SCENARIOS slot takes CoSMoS's
// nearest level (REGIONS[].scenarios), and the map says which one it shows.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REGIONS, SCENARIOS } from '../../src/risks/risksLayers.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const DEV = resolve(ROOT, 'public/dev-data/risks')
const STRUCTURES = 'https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0/query'
// Washington State Parcels Project (WaTech / Washington State Geoportal; county assessors' values, normalized)
const PARCELS = 'https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer/0/query'
const PARCEL_FIELDS = ['PARCEL_ID_NR', 'ORIG_PARCEL_ID', 'SITUS_ADDRESS', 'SITUS_CITY_NM', 'LANDUSE_CD', 'VALUE_LAND', 'VALUE_BLDG', 'DATA_LINK']
const FIELDS = ['BUILD_ID', 'OCC_CLS', 'PRIM_OCC', 'PROP_ADDR', 'PROP_CITY', 'SQFEET', 'POP_MEDIAN']

const region = REGIONS.find((r) => r.id === process.argv[2])
if (!region) throw new Error(`usage: cosmos.mjs <${REGIONS.map((r) => r.id).join('|')}>`)
const RAW = resolve(HERE, `raw/cosmos-${region.id}`)
const BUILD = resolve(HERE, `build/cosmos-${region.id}`)
mkdirSync(RAW, { recursive: true }); mkdirSync(BUILD, { recursive: true }); mkdirSync(DEV, { recursive: true })
const mb = (f) => `${(statSync(f).size / 1e6).toFixed(1)} MB`
const gpkg = resolve(BUILD, 'work.gpkg')
const ogr = (args) => execFileSync('ogr2ogr', args, { stdio: ['ignore', 'inherit', 'inherit'] })
const sql = (q) => execFileSync('ogrinfo', ['-q', '-ro', gpkg, '-dialect', 'SQLite', '-sql', q], { encoding: 'utf8', maxBuffer: 1 << 28 })

// ─── 1. The release's flood extents → one GeoPackage (WGS84) ─────────────────
const zip = resolve(RAW, 'extent.zip')
if (!existsSync(zip)) {
  // The USGS media host is behind Cloudflare and refuses requests without a browser User-Agent
  console.log(`downloading ${region.zip}`)
  execFileSync('curl', ['-sSfL', '-A', 'Mozilla/5.0', '-o', zip, region.zip], { stdio: 'inherit' })
}
const shpDir = resolve(RAW, 'shp')
if (!existsSync(shpDir)) execFileSync('unzip', ['-oq', zip, '-d', shpDir])
const reuse = process.argv.includes('--reuse') && existsSync(gpkg) && SCENARIOS.every((s) => existsSync(resolve(BUILD, `${s.id}.geojsonl`)))
const shps = execFileSync('find', [shpDir, '-name', '*_fldPoly_*.shp'], { encoding: 'utf8' }).trim().split('\n')
if (!reuse) rmSync(gpkg, { force: true })
if (!reuse) SCENARIOS.forEach((s, i) => {
  const name = `${region.prefix}_fldPoly_${region.scenarios[s.id]}`
  const shp = shps.find((f) => f.endsWith(`/${name}.shp`))
  if (!shp) throw new Error(`missing ${name}.shp in ${zip}`)
  ogr(['-f', 'GPKG', '-append', gpkg, shp, '-nln', 'ext_raw', '-t_srs', 'EPSG:4326', '-makevalid', '-nlt', 'PROMOTE_TO_MULTI',
    '-lco', 'GEOMETRY_NAME=geom', '-dialect', 'SQLite', '-sql', `SELECT ${i + 1} AS rank, geometry FROM "${name}"`])
})
// Land only: CoSMoS's extents also cover the open water they flood from (the Duwamish Waterway, Elliott Bay's edge), so
// subtract the region's open-water layer (REGIONS[].water: for King County, King County GIS's Open Water, which holds
// Puget Sound, double-banked rivers and lakes; its bridges are "Non water" and stay out). Cut into small pieces first
// (testing a footprint against a whole county shoreline is slow; see bake.mjs), then each piece minus the water it
// touches. "pieces" feeds the building and lot joins; "ext" (the same pieces) the bands.
if (!reuse) {
  const water = resolve(RAW, 'water.geojsonl')
  if (!existsSync(water)) {
    await fetchTouching('open water', region.water.url, { fields: ['OBJECTID'], id: 'OBJECTID', where: region.water.where }, queryShapes('SELECT geom FROM ext_raw'), water)
  }
  ogr(['-f', 'GPKG', '-update', '-overwrite', gpkg, water, '-nln', 'water', '-nlt', 'PROMOTE_TO_MULTI', '-makevalid', '-lco', 'GEOMETRY_NAME=geom'])
  ogr(['-f', 'GPKG', '-update', '-overwrite', gpkg, gpkg, '-nln', 'wpieces', '-nlt', 'POLYGON', '-explodecollections', '-lco', 'GEOMETRY_NAME=geom',
    '-dialect', 'SQLite', '-sql', 'SELECT ST_Subdivide(geom, 256) AS geom FROM water'])
  ogr(['-f', 'GPKG', '-update', '-overwrite', gpkg, gpkg, '-nln', 'rawpieces', '-nlt', 'POLYGON', '-explodecollections', '-lco', 'GEOMETRY_NAME=geom',
    '-dialect', 'SQLite', '-sql', 'SELECT rank, ST_Subdivide(geom, 256) AS geom FROM ext_raw'])
  const wet = `(SELECT ST_Union(w.geom) FROM wpieces w WHERE w.fid IN (SELECT id FROM rtree_wpieces_geom r WHERE r.minx <= ST_MaxX(e.geom)
    AND r.maxx >= ST_MinX(e.geom) AND r.miny <= ST_MaxY(e.geom) AND r.maxy >= ST_MinY(e.geom)) AND ST_Intersects(w.geom, e.geom))`
  for (const t of ['pieces', 'ext']) {
    ogr(['-f', 'GPKG', '-update', '-overwrite', gpkg, gpkg, '-nln', t, '-nlt', 'POLYGON', '-explodecollections', '-lco', 'GEOMETRY_NAME=geom',
      '-dialect', 'SQLite', '-sql', `SELECT rank, geom FROM (SELECT e.rank, CollectionExtract(ST_MakeValid(COALESCE(ST_Difference(e.geom, ${wet}), e.geom)), 3) AS geom
        FROM rawpieces e) WHERE geom IS NOT NULL AND ST_Area(geom) > 0`])
  }
  console.log(`land only: ${sql('SELECT ROUND(SUM(ST_Area(ST_Transform(geom, 32610))) / 1e6, 1) FROM ext').match(/= ([\d.]+)/)?.[1]} of ${
    sql('SELECT ROUND(SUM(ST_Area(ST_Transform(geom, 32610))) / 1e6, 1) FROM ext_raw').match(/= ([\d.]+)/)?.[1]} km² (all four extents)`)
}

// ─── 2. Bands: each scenario's extent minus every milder one's ───────────────
// CoSMoS publishes each scenario's whole extent, and they don't nest (0.5 m with the 100-year storm floods more than
// 1.5 m with the yearly one), so "scenario k" on the map = its extent ∪ every milder extent, drawn as disjoint bands.
const bands = []
SCENARIOS.forEach((s, i) => {
  const out = resolve(BUILD, `${s.id}.geojsonl`)
  bands.push('-L', `${s.id}:${out}`)
  if (reuse) return
  rmSync(out, { force: true })
  const mine = `(SELECT ST_Union(geom) FROM ext WHERE rank = ${i + 1})`
  const milder = `(SELECT ST_Union(geom) FROM ext WHERE rank < ${i + 1})`
  ogr(['-f', 'GeoJSONSeq', out, gpkg, '-explodecollections', '-nlt', 'POLYGON', '-dialect', 'SQLite', '-sql',
    `SELECT CollectionExtract(${i ? `ST_Difference(${mine}, ${milder})` : mine}, 3) AS geom`])
  console.log(`${s.id} (${region.scenarios[s.id]}): band → ${mb(out)}`)
})

// ─── 3. Tax parcels, then building footprints, touching the flood ────────────
// Both queried with the area itself (unioned, padded ~10 m, simplified, cut into ≤1,500-vertex pieces: ~15 for King
// County's flood extents), not the county's box: the box around King's shoreline holds ~375,000 buildings, the flood
// area a few thousand. Parcels: every lot any flood extent touches. Footprints: every one on those lots or in the flood
// (a lot's "share of its building footprint flooded" needs its dry buildings too). Each fetched once; delete the
// .geojsonl to refetch.
function queryShapes(from) {
  return JSON.parse(execFileSync('ogr2ogr', ['-f', 'GeoJSON', '/vsistdout/', gpkg, '-explodecollections', '-dialect', 'SQLite',
    '-sql', `SELECT ST_Subdivide(ST_Simplify(ST_Buffer(ST_Union(geom), 0.0001), 0.00005), 1500) AS geom FROM (${from})`],
  { encoding: 'utf8', maxBuffer: 1 << 28 })).features
}
async function fetchTouching(label, url, { fields, id, where = '1=1' }, shapes, out) {
  const seen = new Set(), lines = []
  let calls = 0
  for (const [n, f] of shapes.entries()) {
    for (let offset = 0; ; offset += 2000) {
      const body = new URLSearchParams({
        where, geometry: JSON.stringify({ rings: f.geometry.coordinates, spatialReference: { wkid: 4326 } }),
        geometryType: 'esriGeometryPolygon', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outSR: '4326',
        outFields: fields.join(','), returnGeometry: 'true', resultOffset: String(offset), resultRecordCount: '2000',
        orderByFields: 'OBJECTID', f: 'geojson',
      })
      const r = await fetch(url, { method: 'POST', body })
      calls++
      if (!r.ok) throw new Error(`${label} ${r.status}`)
      const j = await r.json()
      if (j.error) throw new Error(`${label}: ${JSON.stringify(j.error)}`)
      for (const b of j.features) if (!seen.has(b.properties[id])) { seen.add(b.properties[id]); lines.push(JSON.stringify(b)) }
      if (!j.properties?.exceededTransferLimit && j.features.length < 2000) break
    }
    process.stdout.write(`\r${label}: shape ${n + 1}/${shapes.length}, ${lines.length} features, ${calls} calls`)
  }
  writeFileSync(out, lines.join('\n') + '\n')
  console.log(` → ${mb(out)}`)
}
const parcels = resolve(RAW, 'parcels.geojsonl')
if (!existsSync(parcels)) {
  await fetchTouching('parcels', PARCELS, { fields: PARCEL_FIELDS, id: 'PARCEL_ID_NR', where: `FIPS_NR = '${region.fips}'` }, queryShapes('SELECT geom FROM ext'), parcels)
}
ogr(['-f', 'GPKG', '-update', '-overwrite', gpkg, parcels, '-nln', 'parcels', '-nlt', 'PROMOTE_TO_MULTI', '-makevalid', '-lco', 'GEOMETRY_NAME=geom'])
const structures = resolve(RAW, 'structures.geojsonl')
if (!existsSync(structures)) {
  await fetchTouching('structures', STRUCTURES, { fields: FIELDS, id: 'BUILD_ID' },
    queryShapes('SELECT geom FROM ext UNION ALL SELECT geom FROM parcels'), structures)
}

// ─── 4. First scenario that floods each building ─────────────────────────────
ogr(['-f', 'GPKG', '-update', '-overwrite', gpkg, structures, '-nln', 'buildings', '-nlt', 'PROMOTE_TO_MULTI', '-lco', 'GEOMETRY_NAME=geom'])
const buildings = resolve(BUILD, 'buildings.geojsonl')
// Every footprint with its first flooding scenario (null = dry), back into the GeoPackage as "bld" for the lot shares
ogr(['-f', 'GPKG', '-update', '-overwrite', gpkg, gpkg, '-nln', 'bld', '-nlt', 'PROMOTE_TO_MULTI', '-lco', 'GEOMETRY_NAME=geom', '-dialect', 'SQLite', '-sql',
  `SELECT b.geom, b.OCC_CLS AS occ, b.PRIM_OCC AS use, b.PROP_ADDR AS addr, b.PROP_CITY AS city,
     CAST(ROUND(b.SQFEET) AS INTEGER) AS sqft, b.POP_MEDIAN AS pop,
     CAST((SELECT MIN(f.rank) FROM pieces f WHERE f.fid IN (SELECT id FROM rtree_pieces_geom r WHERE r.minx <= ST_MaxX(b.geom)
       AND r.maxx >= ST_MinX(b.geom) AND r.miny <= ST_MaxY(b.geom) AND r.maxy >= ST_MinY(b.geom)) AND ST_Intersects(b.geom, f.geom)) AS INTEGER) AS first
   FROM buildings b`])
rmSync(buildings, { force: true })
ogr(['-f', 'GeoJSONSeq', buildings, gpkg, '-sql', 'SELECT * FROM bld WHERE first > 0'])
// Keep only flooded footprints (the query's ~10 m padding brings in neighbours); clean the source's placeholder text
const blank = (v) => (v == null || /^(|unknown|unclassified|null)$/i.test(String(v).trim()) ? undefined : String(v).trim())
const feats = readFileSync(buildings, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
for (const f of feats) {
  const p = f.properties
  f.properties = Object.fromEntries(Object.entries({ first: Number(p.first), occ: blank(p.occ), use: blank(p.use), addr: blank(p.addr),
    city: blank(p.city), sqft: p.sqft || undefined, pop: p.pop > 0 ? Math.round(p.pop * 10) / 10 : undefined }).filter(([, v]) => v !== undefined))
  f.tippecanoe = { minzoom: 10 }
}
writeFileSync(buildings, feats.map((f) => JSON.stringify(f)).join('\n') + '\n')
const by = SCENARIOS.map((s, i) => feats.filter((f) => f.properties.first <= i + 1).length)
console.log(`flooded buildings (cumulative): ${SCENARIOS.map((s, i) => `${s.id} ${by[i]}`).join(', ')}`)
const ring = (g) => (g.type === 'MultiPolygon' ? g.coordinates[0][0] : g.coordinates[0]).slice(0, -1)
const centre = (g) => { const r = ring(g); return [r.reduce((a, c) => a + c[0], 0) / r.length, r.reduce((a, c) => a + c[1], 0) / r.length].map((v) => Math.round(v * 1e6) / 1e6) }
const hits = resolve(BUILD, 'hits.geojsonl')
writeFileSync(hits, feats.map((f) => JSON.stringify({ type: 'Feature', properties: f.properties, geometry: { type: 'Point', coordinates: centre(f.geometry) } })).join('\n') + '\n')

// ─── 4b. Lots: how much of each the flood covers, and their Assessor values ──
// As San Juan's inview.json (economics.mjs): lot area, flooded area per band (bands don't overlap; scenario k = bands
// 1..k), and the % of the lot's building footprint area flooded in each scenario (cumulative). A footprint belongs to
// the lot that holds its centre. Areas in UTM 10N.
ogr(['-f', 'GPKG', '-update', '-overwrite', gpkg, resolve(BUILD, `${SCENARIOS[0].id}.geojsonl`), '-nln', 'bands', '-nlt', 'PROMOTE_TO_MULTI',
  '-makevalid', '-lco', 'GEOMETRY_NAME=geom', '-dialect', 'SQLite', '-sql', `SELECT 1 AS rank, geometry FROM "${SCENARIOS[0].id}"`])
SCENARIOS.slice(1).forEach((s, i) => ogr(['-f', 'GPKG', '-update', '-append', gpkg, resolve(BUILD, `${s.id}.geojsonl`), '-nln', 'bands', '-nlt', 'PROMOTE_TO_MULTI',
  '-makevalid', '-dialect', 'SQLite', '-sql', `SELECT ${i + 2} AS rank, geometry FROM "${s.id}"`]))
ogr(['-f', 'GPKG', '-update', '-overwrite', gpkg, gpkg, '-nln', 'bpieces', '-nlt', 'POLYGON', '-explodecollections', '-lco', 'GEOMETRY_NAME=geom',
  '-dialect', 'SQLite', '-sql', 'SELECT rank, ST_Subdivide(ST_MakeValid(geom), 256) AS geom FROM bands'])
const box = (t, g) => `${t}.fid IN (SELECT id FROM rtree_${t === 'b' ? 'bpieces' : 'bld'}_geom r WHERE r.minx <= ST_MaxX(${g}) AND r.maxx >= ST_MinX(${g}) AND r.miny <= ST_MaxY(${g}) AND r.maxy >= ST_MinY(${g}))`
const utm = (g) => `ST_Area(ST_Transform(${g}, 32610))`
const lotsOut = resolve(BUILD, 'lots.geojsonl')
rmSync(lotsOut, { force: true })
ogr(['-f', 'GeoJSONSeq', lotsOut, gpkg, '-dialect', 'SQLite', '-sql',
  `SELECT p.geom, p.PARCEL_ID_NR AS id, p.ORIG_PARCEL_ID AS pin, p.SITUS_ADDRESS AS addr, p.VALUE_LAND AS land, p.VALUE_BLDG AS bldg,
     ${utm('p.geom')} AS m2,
     ${SCENARIOS.map((s, i) => `(SELECT COALESCE(SUM(${utm('ST_Intersection(p.geom, b.geom)')}), 0) FROM bpieces b WHERE b.rank = ${i + 1} AND ${box('b', 'p.geom')}
       AND ST_Intersects(p.geom, b.geom)) AS fl${i + 1}`).join(',\n')},
     (SELECT COALESCE(SUM(x.sqft), 0) FROM bld x WHERE ${box('x', 'p.geom')} AND ST_Within(ST_PointOnSurface(x.geom), p.geom)) AS bsq,
     ${SCENARIOS.map((s, i) => `(SELECT COALESCE(SUM(x.sqft), 0) FROM bld x WHERE x.first BETWEEN 1 AND ${i + 1} AND ${box('x', 'p.geom')}
       AND ST_Within(ST_PointOnSurface(x.geom), p.geom)) AS bf${i + 1}`).join(',\n')}
   FROM parcels p`])
const num = (v) => (Number.isFinite(+v) ? Math.round(+v) : 0)
const lots = readFileSync(lotsOut, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
// [lng, lat, land $, building $, lot m², flood band m² ×4, % of the lot's building footprint flooded ×4]: inview.json's layout
const lotRows = lots.map((f) => { const p = f.properties
  return [...centre(f.geometry), num(p.land), num(p.bldg), num(p.m2), ...[1, 2, 3, 4].map((k) => num(p[`fl${k}`])),
    ...[1, 2, 3, 4].map((k) => (p.bsq ? Math.round((p[`bf${k}`] / p.bsq) * 100) : 0))] })
const lotTiles = resolve(BUILD, 'parcels.geojsonl')
writeFileSync(lotTiles, lots.map((f) => JSON.stringify({ type: 'Feature', properties: {}, geometry: f.geometry })).join('\n') + '\n')
console.log(`lots touched: ${lots.length}; land $${(lotRows.reduce((a, r) => a + r[2], 0) / 1e6).toFixed(0)}M on them`)

// ─── 5. Tiles ────────────────────────────────────────────────────────────────
const pm = resolve(BUILD, region.file)
execFileSync('tippecanoe', ['-o', pm, '--force', '-Z6', '-z14', '-r1', '--drop-smallest-as-needed', '--simplification=2',
  '--detect-shared-borders', '-q', ...bands, '-L', `buildings:${buildings}`, '-L', `hits:${hits}`, '-L', `parcels:${lotTiles}`], { stdio: 'inherit' })
execFileSync('cp', [pm, resolve(DEV, region.file)])
// The map's "in this view" totals for the region, laid out as inview.json: parcels (above) and buildings [lng, lat, first]
writeFileSync(resolve(ROOT, `public/risks-data/cosmos-${region.id}.json`), JSON.stringify({ built: new Date().toISOString().slice(0, 10), totals: by,
  parcels: lotRows, buildings: feats.map((f) => [...centre(f.geometry), f.properties.first]) }))
console.log(`${region.file}: ${mb(pm)} (copied to public/dev-data/risks for localhost)`)
