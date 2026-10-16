// Registered offshore facilities → one PMTiles file (the /ships "Offshore facilities" layer) and one compact GeoJSON
// (the oil slick card's "nearest registered facility" lookup, api/cerulean.js op=facility). Josh 2026-10-15: authoritative
// government / EU registers only (no satellite-guessed structures). Catalogs: docs/OFFSHORE_SOURCES_{EUROPE,WIND,BOEM}.md.
//
//   node scripts/ships/bake-offshore/bake.mjs            download (if not cached) + bake
//   node scripts/ships/bake-offshore/bake.mjs --refresh  re-download first
//   … --version 2026-10-15b                              file name (default: today's date)
//
// Sources (each feature keeps its source id + the source's own record id; raw replies kept in raw/ exactly as received):
//   emodnet-platforms  EMODnet Human Activities, Oil and Gas, Offshore Installations (WFS emodnet:platforms), CC BY 4.0
//   emodnet-windfarms  EMODnet Human Activities, Energy, Wind Farms (WFS emodnet:windfarmspoly + emodnet:windfarms), CC BY 4.0
//   uswtdb             US Wind Turbine Database, offshore turbines (t_offshore = 1), public domain
//   boem               BOEM / BSEE platform structures (US Outer Continental Shelf), public domain   [see boem.mjs]
// Output: build/offshore-<date>.pmtiles (layer "offshore"), build/offshore-<date>.geojson, build/manifest.json.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const RAW = join(HERE, 'raw'), BUILD = join(HERE, 'build')
const refresh = process.argv.includes('--refresh')
mkdirSync(RAW, { recursive: true }); mkdirSync(BUILD, { recursive: true })
const UA = { 'User-Agent': 'EarthAtlas offshore bake (earthatlas.org)' }

async function cached(name, url) {
  const f = join(RAW, name)
  if (!refresh && existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'))
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: { ...UA, Accept: 'application/json' } })
    const text = await r.text()
    if (r.ok) { writeFileSync(f, text); writeFileSync(`${f}.meta.json`, JSON.stringify({ url, fetchedAt: new Date().toISOString(), status: r.status }, null, 1)); return JSON.parse(text) }
    if (attempt >= 3) throw new Error(`${url}: HTTP ${r.status} ${text.slice(0, 200)}`)
    await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt))
  }
}
const WFS = (type) => `https://ows.emodnet-humanactivities.eu/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=${type}&outputFormat=application/json&srsName=EPSG:4326`

const clean = (v) => (typeof v === 'string' ? (v.trim() || null) : v ?? null)
const yearOf = (v) => { const m = /^(\d{4})/.exec(String(v || '')); return m ? Number(m[1]) : null }
const feats = []
const add = (geometry, props) => { if (geometry) feats.push({ type: 'Feature', geometry, properties: Object.fromEntries(Object.entries(props).filter(([, v]) => v != null && v !== '')) }) }

// Status words → one lifecycle: operating | construction | planned | removed (gone or no longer producing) | other.
const PLATFORM_STATUS = { Operational: 'operating', 'Under construction': 'construction', Decommissioned: 'removed', 'Closed down': 'removed', Removed: 'removed' }
const WIND_STATUS = { Production: 'operating', Construction: 'construction', Approved: 'planned', Planned: 'planned', Dismantled: 'removed', 'Test site': 'operating' }

// ── EMODnet platforms ──
const pf = await cached('emodnet-platforms.json', WFS('emodnet:platforms'))
for (const f of pf.features || []) {
  const p = f.properties
  add(f.geometry, { k: 'platform', src: 'emodnet-platforms', sid: clean(p.platformid), name: clean(p.name), operator: clean(p.operator), country: clean(p.country),
    status: PLATFORM_STATUS[p.current_status] || 'other', statusRaw: clean(p.current_status), what: [clean(p.category), clean(p.function)].filter(Boolean).join(' · ') || null,
    product: clean(p.primary_production), since: yearOf(p.valid_from) || yearOf(p.production_start), depth: p.water_depth || null, note: clean(p.remarks) })
}
// ── EMODnet wind farms: polygons first (most operating farms), then points not already drawn as a polygon ──
const wp = await cached('emodnet-windfarmspoly.json', WFS('emodnet:windfarmspoly'))
const wpt = await cached('emodnet-windfarms.json', WFS('emodnet:windfarms'))
const seen = new Set()
const windProps = (p) => ({ k: 'windfarm', src: 'emodnet-windfarms', name: clean(p.name), country: clean(p.country), status: WIND_STATUS[p.status] || 'other', statusRaw: clean(p.status),
  turbines: p.n_turbines || null, mw: p.power_mw || null, since: yearOf(p.year), what: clean(p.type_inst), note: clean(p.notes) })
for (const f of wp.features || []) { seen.add(`${f.properties.name}|${f.properties.country}`); add(f.geometry, windProps(f.properties)) }
for (const f of wpt.features || []) if (!seen.has(`${f.properties.name}|${f.properties.country}`)) add(f.geometry, windProps(f.properties))
// ── USWTDB offshore turbines ──
const tw = await cached('uswtdb-offshore.json', 'https://energy.usgs.gov/api/uswtdb/v1/turbines?t_offshore=eq.1')
for (const t of Array.isArray(tw) ? tw : []) {
  add({ type: 'Point', coordinates: [t.xlong, t.ylat] }, { k: 'turbine', src: 'uswtdb', sid: t.case_id != null ? String(t.case_id) : null, name: clean(t.p_name), country: 'United States',
    status: 'operating', since: t.p_year || null, mw: t.t_cap ? t.t_cap / 1000 : null, what: [clean(t.t_manu), clean(t.t_model)].filter(Boolean).join(' ') || null })
}
// ── BOEM / BSEE (US OCS platforms): produced by boem.mjs into raw/boem-platforms.geojson when present ──
const boemFile = join(RAW, 'boem-platforms.geojson')
if (existsSync(boemFile)) for (const f of JSON.parse(readFileSync(boemFile, 'utf8')).features || []) feats.push(f)

// --version v: name the files offshore-<v> (a new name per re-bake: tiles are edge-cached for 30 days under the old one).
const vi = process.argv.indexOf('--version')
const stamp = vi >= 0 ? process.argv[vi + 1] : new Date().toISOString().slice(0, 10)
const tally = {}
for (const f of feats) { const k = `${f.properties.src}:${f.properties.status}`; tally[k] = (tally[k] || 0) + 1 }
const gj = join(BUILD, `offshore-${stamp}.geojson`)
writeFileSync(gj, JSON.stringify({ type: 'FeatureCollection', features: feats }))
const out = join(BUILD, `offshore-${stamp}.pmtiles`)
// Points are never dropped (a platform must not vanish when zoomed out); farm polygons keep their shape from z5.
execFileSync('tippecanoe', ['-q', '-o', out, '--force', '-l', 'offshore', '-Z0', '-z12', '-r1', '--no-feature-limit', '--no-tile-size-limit', gj], { stdio: 'inherit' })
writeFileSync(join(BUILD, 'manifest.json'), JSON.stringify({ version: stamp, features: feats.length, tally, pmtiles: `offshore-${stamp}.pmtiles`, geojson: `offshore-${stamp}.geojson` }, null, 1))
console.log(feats.length, 'features', tally, '→', out)
