#!/usr/bin/env node
// /risks economic exposure: how much of every San Juan County tax parcel each flood band and erosion ring covers.
// Inputs: build/join.gpkg's "pieces" (the four flood bands, cut small; bake.mjs makes them), build/erosion2060|2100.geojsonl
// (bake.mjs), and the Assessor's parcels as Salish Sea Explorer holds them (RISKS_PARCELS overrides).
// Output: build/parcel-exposure.csv, one row per parcel with its Assessor values and the square metres in each band
// (fl1..fl4: flood bands mildest first, as SCENARIOS; er2060, er2100: the erosion rings, which don't overlap).
//
//   node scripts/bake-risks/parcel-exposure.mjs

import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUILD = resolve(HERE, 'build')
const PARCELS = process.env.RISKS_PARCELS || resolve(HERE, '../../../salish-sea-propmapper/public/data/Tax_Parcels.geojson')
const need = (f) => { if (!existsSync(f)) throw new Error(`missing ${f}`); return f }
const ogr = (args) => execFileSync('ogr2ogr', args, { stdio: 'inherit' })

const g = resolve(BUILD, 'parcels.gpkg')
rmSync(g, { force: true })
ogr(['-f', 'GPKG', g, need(PARCELS), '-nln', 'parcels', '-makevalid', '-nlt', 'PROMOTE_TO_MULTI', '-lco', 'GEOMETRY_NAME=geom'])
// Hazard pieces: the flood bands' subdivided pieces (rank 1-4) plus the erosion rings (rank 2060 / 2100), cut the same way
ogr(['-f', 'GPKG', '-update', g, need(resolve(BUILD, 'join.gpkg')), 'pieces', '-nln', 'hz', '-nlt', 'POLYGON', '-lco', 'GEOMETRY_NAME=geom'])
for (const y of [2060, 2100]) {
  ogr(['-f', 'GPKG', '-update', '-append', g, need(resolve(BUILD, `erosion${y}.geojsonl`)), '-nln', 'hz', '-nlt', 'POLYGON', '-makevalid',
    '-explodecollections', '-dialect', 'SQLite', '-sql', `SELECT ${y} AS rank, ST_Subdivide(geometry, 256) AS geometry FROM "erosion${y}"`])
}
const out = resolve(BUILD, 'parcel-exposure.csv')
rmSync(out, { force: true })
const area = (x) => `ST_Area(ST_Transform(${x}, 32610))`
const band = (r) => `ROUND(COALESCE(SUM(CASE WHEN h.rank = ${r} THEN ${area('ST_Intersection(p.geom, h.geom)')} END), 0), 1) AS ${r > 100 ? `er${r}` : `fl${r}`}`
const sql = `SELECT p.PIN AS pin, p.Tax_Area AS area, p.District_N AS district, p.Use_Code AS use_code, p.Descriptio AS use_desc,
    p.Tax_Status AS tax_status, p.taxpurpose AS taxpurpose, p.Acres AS acres, p.WF_LGTH AS waterfront_ft,
    CAST(TRIM(p.Land_Value) AS INTEGER) AS land_value, CAST(TRIM(p.Bldg_Value) AS INTEGER) AS bldg_value,
    CAST(TRIM(p.Appraised_) AS INTEGER) AS appraised, ROUND(${area('p.geom')}, 1) AS parcel_m2,
    ${[1, 2, 3, 4, 2060, 2100].map(band).join(', ')}
  FROM parcels p JOIN hz h ON h.fid IN (SELECT id FROM rtree_hz_geom r
    WHERE r.minx <= ST_MaxX(p.geom) AND r.maxx >= ST_MinX(p.geom) AND r.miny <= ST_MaxY(p.geom) AND r.maxy >= ST_MinY(p.geom))
    AND ST_Intersects(p.geom, h.geom)
  GROUP BY p.fid`
execFileSync('ogr2ogr', ['-f', 'CSV', out, g, '-dialect', 'SQLite', '-sql', sql], { stdio: 'inherit' })
console.log(`wrote ${out}`)
