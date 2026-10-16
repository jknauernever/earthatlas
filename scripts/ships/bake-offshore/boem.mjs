// BOEM / BSEE offshore platform structures (US Outer Continental Shelf) → raw/boem-platforms.geojson, read by bake.mjs.
// Catalog and field layouts: docs/OFFSHORE_SOURCES_BOEM.md (fetched 2026-10-14).
//
//   node scripts/ships/bake-offshore/boem.mjs            download (if not cached) + build
//   node scripts/ships/bake-offshore/boem.mjs --refresh  re-download first (BOEM updates the files monthly)
//
// Gulf: every structure ever registered (7k, installed and removed) from the monthly fixed-width files, joined on
// complex + structure number: platstru (name, type, install/removal dates), platloc (lat/lon), platmast (water depth,
// operator number), compall (operator names). Gulf lat/lon are NAD27 as BOEM publishes them (BOEM Mapping page); against
// NAD83 that is ~20 m in the Gulf, shown as published (no datum shift is invented here).
// Pacific: the 24 structures (platlocpacfixed + platstrupacdelimit; platlocpacdelimit.zip is mislabelled Gulf data).
// Alaska: the one installed structure, from the AK_Layers REST service (position + complex only; no name field).
// Licence: developed within the US Government, no proprietary rights. Credit: BOEM / BSEE Data Center.
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const RAW = join(HERE, 'raw', 'boem')
const refresh = process.argv.includes('--refresh')
mkdirSync(RAW, { recursive: true })
const UA = { 'User-Agent': 'EarthAtlas offshore bake (earthatlas.org)' }

async function zip(name) {
  const dir = join(RAW, name.replace(/\.zip$/, ''))
  if (refresh || !existsSync(dir)) {
    // curl, not fetch: www.data.boem.gov sends an incomplete certificate chain that Node rejects (2026-10-15); curl
    // verifies it against the system trust store. Certificate checking stays on either way.
    const url = name.startsWith('compall') ? `https://www.data.boem.gov/Company/Files/${name}` : `https://www.data.boem.gov/Platform/Files/${name}`
    const f = join(RAW, name)
    execFileSync('curl', ['-fsSL', '--retry', '3', '-A', UA['User-Agent'], '-o', f, url])
    writeFileSync(`${f}.meta.json`, JSON.stringify({ url, fetchedAt: new Date().toISOString() }, null, 1))
    mkdirSync(dir, { recursive: true })
    execFileSync('unzip', ['-o', '-q', f, '-d', dir])
  }
  const file = readdirSync(dir).find((x) => !x.startsWith('.'))
  return readFileSync(join(dir, file), 'latin1').split(/\r?\n/).filter((l) => l.trim())
}
async function rest(url) {
  const f = join(RAW, 'ak-rest.geojson')
  if (!refresh && existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'))
  for (let attempt = 0; ; attempt++) {
    let j = null
    try { j = JSON.parse(execFileSync('curl', ['-fsSL', '-A', UA['User-Agent'], url]).toString()) } catch { j = null } // curl: see zip()
    if (j?.features?.length) { writeFileSync(f, JSON.stringify(j)); return j }
    if (attempt >= 4) throw new Error(`${url}: ${j?.features?.length ?? 'no'} features`) // BOEM sometimes answers empty; retry
    await new Promise((res) => setTimeout(res, 1500))
  }
}
const col = (line, start, len) => line.substr(start - 1, len).trim()
// Quoted CSV row → fields.
const csv = (line) => { const out = []; let cur = '', q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = '' } else cur += ch } out.push(cur); return out.map((v) => v.trim()) }
const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' }
const dmy = (s) => { const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(s); return m ? `${m[3]}-${MON[m[2]]}-${m[1]}` : null }
const ymd = (s) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null)
const TYPE = { FIXED: 'Fixed platform', CAIS: 'Caisson', WP: 'Well protector', SEMI: 'Semisubmersible', SPAR: 'Spar', TLP: 'Tension leg platform',
  MTLP: 'Mini tension leg platform', MOPU: 'Mobile offshore production unit', CT: 'Compliant tower', FPSO: 'Floating production, storage and offloading' }

// Gulf area names from BOEM's own field reference (the Area Code value list on platformStructuresFields), saved in raw/.
// A Gulf structure name is only a label within its block ("A", "B", "1"); the platform is known by area + block + label,
// e.g. "Vermilion 356 A" (Josh 2026-10-15: bare letters repeated all over the map).
async function gulfAreas() {
  const f = join(RAW, 'platformStructuresFields.html')
  if (refresh || !existsSync(f)) execFileSync('curl', ['-fsSL', '--retry', '3', '-A', UA['User-Agent'], '-o', f, 'https://www.data.boem.gov/Main/HtmlPage.aspx?page=platformStructuresFields'])
  const t = readFileSync(f, 'utf8').replace(/<[^>]+>/g, '\n').replace(/&amp;/g, '&')
  const i = t.indexOf('The Value-Description Pairs are listed below:', t.indexOf('Area Code')), j = t.indexOf('Block Number', i)
  const out = {}
  for (const line of t.slice(i, j).split('\n')) {
    const m = /^\s*([A-Z]{2})-\s*(.+?)\s*(?:\s{2,}\d+\.?|\.)?\s*$/.exec(line)
    if (!m) continue
    const name = m[2].replace(/\(THIS IS A FIELD\)/, '').replace(/\*/g, '').replace(/\bAREA\b/, '').trim()
    out[m[1]] = /^NG \d/.test(name) ? name : name.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bSt\b/, 'St.')
  }
  // BOEM's list reads "MINOS CANYON" for AC: the area is Alaminos Canyon (e.g. Hoover, AC 25, in BOEM's deepwater table).
  if (out.AC === 'Minos Canyon') out.AC = 'Alaminos Canyon'
  if (Object.keys(out).length < 50) throw new Error(`only ${Object.keys(out).length} BOEM area codes parsed`)
  return out
}
const AREA = await gulfAreas()

// Operators: current business name per company number (the row with no MMS term date).
const operators = new Map()
for (const r of (await zip('compalldelimit.zip')).map(csv)) if (r[0] && r[2] && !operators.has(r[0]) && !r[4]) operators.set(r[0], r[2])

const feats = []
const add = (lon, lat, props) => {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || (lon === 0 && lat === 0)) return
  feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: Object.fromEntries(Object.entries(props).filter(([, v]) => v != null && v !== '')) })
}

// ── Gulf ──
const loc = new Map()
for (const l of await zip('platlocfixed.zip')) loc.set(`${col(l, 4, 8)}|${col(l, 12, 3)}`, [Number(col(l, 86, 14)), Number(col(l, 100, 13))])
const mast = new Map()
for (const l of await zip('platmastfixed.zip')) mast.set(col(l, 1, 8), { op: col(l, 21, 5), depthFt: Number(col(l, 51, 5)) || null })
let gulf = 0
for (const l of await zip('platstrufixed.zip')) {
  const cx = col(l, 9, 8), sn = col(l, 82, 3), xy = loc.get(`${cx}|${sn}`)
  if (!xy) continue
  const m = mast.get(cx) || {}, removed = dmy(col(l, 44, 11)), type = col(l, 85, 5)
  const area = col(l, 1, 2), block = col(l, 3, 6).replace(/^0+/, ''), label = col(l, 67, 15)
  const name = [AREA[area] || area, block, label].filter(Boolean).join(' ')
  add(xy[0], xy[1], { k: 'platform', src: 'boem', sid: `${cx}-${sn}`, name, operator: operators.get(m.op) || null, country: 'United States',
    status: removed ? 'removed' : 'operating', statusRaw: removed ? `Removed ${removed}` : 'Installed', what: TYPE[type] || type || null,
    since: Number((dmy(col(l, 20, 11)) || '').slice(0, 4)) || null, removed: removed || null, depth: m.depthFt ? Math.round(m.depthFt * 0.3048) : null,
    note: `${area} ${block} ${label}, complex ${cx}` })
  gulf++
}
// ── Pacific ──
const pLoc = new Map()
// Complex at 5 (9), structure at 14 (3) as the file actually lays them out; lon/lat are the line's last two numbers.
for (const l of await zip('platlocpacfixed.zip')) { const t = l.trim().split(/\s+/); pLoc.set(`${col(l, 5, 9)}|${col(l, 14, 3)}`, [Number(t[t.length - 2]), Number(t[t.length - 1])]) }
let pac = 0
for (const r of (await zip('platstrupacdelimit.zip')).map(csv)) {
  const cx = r[3].trim(), sn = r[15].trim(), xy = pLoc.get(`${cx}|${sn}`) || [...pLoc.entries()].find(([k]) => k.startsWith(`${cx}|`))?.[1]
  if (!xy) continue
  const removed = ymd(r[10])
  add(xy[0], xy[1], { k: 'platform', src: 'boem', sid: `${cx}-${sn}`, name: r[14] ? `Platform ${r[14].length > 2 ? r[14].toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()) : r[14]}` : null, country: 'United States',
    status: removed ? 'removed' : 'operating', statusRaw: removed ? `Removed ${removed}` : 'Installed', since: Number((ymd(r[6]) || '').slice(0, 4)) || null,
    removed: removed || null, note: `${r[0]} ${r[1]}, complex ${cx} (Pacific OCS)` })
  pac++
}
// ── Alaska ──
const ak = await rest('https://gis.boem.gov/arcgis/rest/services/BOEM_BSEE/AK_Layers/FeatureServer/0/query?where=1=1&outFields=*&outSR=4326&f=geojson')
for (const f of ak.features) add(f.geometry.coordinates[0], f.geometry.coordinates[1], { k: 'platform', src: 'boem', sid: String(f.properties.COMPLEX_ID_NUM), country: 'United States',
  status: 'operating', statusRaw: 'Installed', since: f.properties.INSTALL_DATE ? new Date(f.properties.INSTALL_DATE).getUTCFullYear() : null, note: `Complex ${f.properties.COMPLEX_ID_NUM} (Alaska OCS)` })

writeFileSync(join(HERE, 'raw', 'boem-platforms.geojson'), JSON.stringify({ type: 'FeatureCollection', features: feats }))
const by = (st) => feats.filter((f) => f.properties.status === st).length
console.log(`BOEM: ${feats.length} structures (gulf ${gulf}, pacific ${pac}, alaska ${ak.features.length}); operating ${by('operating')}, removed ${by('removed')}`)
