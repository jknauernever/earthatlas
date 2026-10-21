#!/usr/bin/env node
// Run the species-of-concern lookup for one point and print a summary (localhost check).
//   node scripts/species-of-concern/try-lookup.mjs <lat> <lng> [radius_km=5] [window=1y] [--json]
import fs from 'node:fs'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
if (!process.env.EBIRD_API_KEY && process.env.VITE_EBIRD_API_KEY) process.env.EBIRD_API_KEY = process.env.VITE_EBIRD_API_KEY

const { lookupSpeciesOfConcern } = await import('../../lib/speciesOfConcern/lookup.js')
const [lat, lng, radius = '5', window = '1y'] = process.argv.slice(2).filter(a => !a.startsWith('--'))
const t0 = Date.now()
const out = await lookupSpeciesOfConcern({ lat: Number(lat), lng: Number(lng), radiusKm: Number(radius), window })
if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0) }

console.log(`${out.query.from} to ${out.query.to}, ${radius} km around ${lat}, ${lng} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
for (const s of out.sources) console.log(`  ${s.ok ? 'ok ' : 'ERR'} ${s.label}: ${s.listed_records} listed records${s.error ? ' — ' + s.error : ''}${s.latest_record ? ` (latest ${s.latest_record})` : ''}`)
for (const g of out.groups) {
  console.log(`\n${g}`)
  for (const r of out.species.filter(r => r.group === g)) {
    const st = r.statuses.map(s => `${s.list_label}: ${s.status}${s.confirmed ? '' : ' (not confirmed)'}`).join('; ')
    console.log(`  ${r.common_name} (${r.scientific_name}) — ${r.records_count} records, latest ${r.latest_date}, nearest ${r.nearest_km ?? '?'} km, ${JSON.stringify(r.sources)}, blurred ${r.locations.blurred}`)
    console.log(`      ${st}`)
    if (r.caveat) console.log(`      ⚠ ${r.caveat.text} ${r.caveat.notes.join(' ')}`)
    const rem = r.records.find(x => x.remarks)
    if (rem) console.log(`      remarks: ${rem.remarks.slice(0, 160)}`)
  }
}
