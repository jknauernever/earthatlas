#!/usr/bin/env node
/**
 * Copies Friends of the San Juans' habitat layers from Salish Sea Explorer (the same files that site draws) into one
 * small file for /permits: public/permits-data/friends-habitat.geojson. Run by hand when Friends' layers change:
 *
 *   node scripts/permits/import-friends-habitat.mjs [path to salish-sea-propmapper/public/data]
 *
 * Keeps each feature's geometry (coordinates rounded to ~1 m) and its own attributes, plus `h` (habitat id,
 * src/permits/habitat.js) and a short `name` built only from those attributes. No network.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'

const SRC = process.argv[2] || `${homedir()}/Projects/salish-sea-propmapper/public/data`
const OUT = 'public/permits-data/friends-habitat.geojson'

const SPECIES = { SurfSmelt: 'surf smelt', ss: 'surf smelt', SL: 'Pacific sand lance', 'Smelt/SL': 'surf smelt and Pacific sand lance' }
const year = (d) => (/(\d{4})/.exec(String(d || '')) || [])[1]
const LAYERS = [
  ['hfd', 'friends-documented-forage-spawning.json', (p) => [p.NAME, SPECIES[p.SPECIES] || p.SPECIES, year(p.DATE_) && `eggs found ${year(p.DATE_)}`].filter(Boolean).join(', ')],
  ['hfp', 'friends-potential-forage-spawning.json', () => null],
  ['hhe', 'friends-herring-spawning.json', (p) => p.Name || null],
  ['hee', 'friends-deepwater-eelgrass.geojson', (p) => [p.ISLAND, p.SITECODE && `site ${p.SITECODE}`].filter((x) => x && String(x).trim()).join(', ') || null],
  ['hkb', 'friends-bull-kelp-patches.geojson', (p) => (p.acres >= 0.01 ? `${p.acres < 1 ? p.acres.toFixed(2) : p.acres.toFixed(1)} acres` : null)],
]

const round = (c) => (typeof c[0] === 'number' ? [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5] : c.map(round))
const features = []
for (const [h, file, nameOf] of LAYERS) {
  const fc = JSON.parse(readFileSync(`${SRC}/${file}`, 'utf8'))
  let n = 0
  for (const f of fc.features) {
    if (!f.geometry) continue
    const [lon, lat] = JSON.stringify(f.geometry.coordinates).match(/-?\d+\.\d+/g).map(Number)
    if (!(lon < -122 && lon > -124 && lat > 48 && lat < 49)) throw new Error(`${file}: not lon/lat WGS84 (${lon}, ${lat})`)
    const name = nameOf(f.properties)
    // The feature's own attributes ride along for the Friends popups (src/friends/); `h` and `name` are ours.
    const own = Object.fromEntries(Object.entries(f.properties || {}).filter(([, v]) => v != null && String(v).trim() !== ''))
    features.push({ type: 'Feature', properties: { ...own, h, ...(name ? { name } : {}) }, geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) } })
    n++
  }
  console.log(`${h} ${file}: ${n}`)
}
writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', source: 'Friends of the San Juans layers, as drawn by Salish Sea Explorer', imported: new Date().toISOString().slice(0, 10), features }))
console.log(`${OUT}: ${features.length} features, ${(readFileSync(OUT).length / 1e6).toFixed(2)} MB`)
