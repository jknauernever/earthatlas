#!/usr/bin/env node
/**
 * San Juan County SEPA reviews from Ecology's SEPA Register (apps.ecology.wa.gov/separ), for /permits (Josh 2026-10-15:
 * county notices as levers). Lists the county's determinations newest first, keeps the water-related ones (docks,
 * shoreline, wetlands, streams…), and reads each record page: lead agency and file number, determination, issued and
 * comments-due dates, position, parcels, applicant and documents. Writes data/permits/county-sepa.json (merged by SEPA
 * number); add-habitat.mjs joins them to /permits records. Plain GETs; record pages cached in scripts/permits/cache/sepa.
 *
 *   node scripts/permits/sepa-fetch.mjs [--since 2025-01-01] [--only <SEPA number,…>] [--refresh]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { parseSepaSearch, parseSepaRecord, sepaRecordUrl, SEPA_BASE } from '../../lib/ships/facilities.js'

const OUT = 'data/permits/county-sepa.json'
const CACHE = 'scripts/permits/cache/sepa'
const UA = { 'User-Agent': 'EarthAtlas PermitTracker (https://earthatlas.org/permits)' }
const args = process.argv.slice(2)
const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const SINCE = flag('--since') || '2025-01-01', ONLY = flag('--only')?.split(','), REFRESH = args.includes('--refresh')
// Water-related proposals: the words /permits cares about, in the name or description.
export const WATER = /\b(dock|pier|float|buoy|moorage|marina|bulkhead|armou?r|rip ?rap|seawall|shoreline|beach|tideland|nearshore|wetland|marsh|stream|creek|culvert|pond|lake|dam|dredg|jetty|breakwater|boat ?ramp|launch|outfall|stormwater|eelgrass|kelp|salmon|estuar|lagoon|restoration)\w*/i

const get = async (url) => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`); return r.text() }
const listUrl = (page) => `${SEPA_BASE}/Search.aspx?SearchFields=County&SearchText=San%20Juan&PageSize=50&Page=${page}`

async function main() {
  mkdirSync(CACHE, { recursive: true })
  const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
  let requests = 0, rows = []
  for (let page = 1; page <= 20; page++) {
    // Newest first: page back until a page reaches past SINCE (the page links can't be trusted for the count).
    const { rows: r } = parseSepaSearch(await get(listUrl(page))); requests++
    rows.push(...r)
    if (!r.length || r.some((x) => x.issued && x.issued < SINCE)) break
  }
  rows = rows.filter((r) => /SAN JUAN/i.test(r.county || '') && (!r.issued || r.issued >= SINCE) && (!ONLY || ONLY.includes(r.sepa)))
  const water = rows.filter((r) => WATER.test(r.proposalName || ''))
  console.log(`San Juan SEPA since ${SINCE}: ${rows.length}; water-related by name: ${water.length}`)
  // Names can hide water work ("Single Family Residence"): every record's description is read too, from cache when known.
  const today = new Date().toISOString().slice(0, 10)
  for (const r of rows) {
    const file = `${CACHE}/${r.sepa}.html`
    let html
    if (!REFRESH && existsSync(file)) html = readFileSync(file, 'utf8')
    else { html = await get(sepaRecordUrl(r.sepa)); requests++; writeFileSync(file, html) }
    const rec = parseSepaRecord(html)
    if (rec.error || !WATER.test(`${rec.proposalName} ${rec.description}`)) { delete out[r.sepa]; continue }
    // A position outside the county is a typo in the record; add-habitat.mjs places by name match instead.
    const pos = /Longitude:\s*(-?\d+\.\d+)\s*Latitude:\s*(-?\d+\.\d+)/.exec(rec.location || '')
    out[r.sepa] = { ...rec, url: sepaRecordUrl(r.sepa), lat: pos ? +pos[2] : null, lon: pos ? +pos[1] : null, read: today }
  }
  writeFileSync(OUT, JSON.stringify(out, null, 1))
  console.log(`requests: ${requests}; ${OUT}: ${Object.keys(out).length} water-related reviews`)
}

if (process.argv[1]?.endsWith('sepa-fetch.mjs')) main().catch((e) => { console.error(e); process.exit(1) })
