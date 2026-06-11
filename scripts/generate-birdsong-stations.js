/**
 * Generate the BirdWeather station-registry snapshot for the /birdsong tool.
 *
 * Writes public/birdsong-stations.json — the full global list of public
 * BirdWeather stations (~22k), so the map can plot and cluster the ENTIRE
 * network client-side without hitting BirdWeather per pan. Only slowly-changing
 * identity/location fields are captured (NO per-window counts — those need
 * server-side aggregation and stay live in the app), so this weekly pull is
 * cheap on BirdWeather: ~45 paginated reads of plain node fields.
 *
 * Runs as part of `npm run build` (before `vite build`, so Vite copies it into
 * dist/). Resilient by design: if BirdWeather is unreachable, it logs and exits
 * 0 WITHOUT touching any existing snapshot, so a build never fails and the app
 * keeps serving the last good list (or falls back to live queries).
 *
 * Run standalone to refresh locally:  node scripts/generate-birdsong-stations.js
 */

import { writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'public', 'birdsong-stations.json')
const GRAPHQL_URL = 'https://app.birdweather.com/graphql'
const PAGE_SIZE = 500

const QUERY = `query($first:Int!,$after:String){
  stations(first:$first, after:$after){
    pageInfo { hasNextPage endCursor }
    nodes { id name type coords { lat lon } country state latestDetectionAt }
  }
}`

async function fetchPage(after) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'EarthAtlas/1.0 (+https://earthatlas.org; birdsong station snapshot)',
    },
    body: JSON.stringify({ query: QUERY, variables: { first: PAGE_SIZE, after } }),
  })
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`)
  const json = await res.json()
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors).slice(0, 300)}`)
  return json.data.stations
}

async function main() {
  const stations = []
  let after = null
  let page = 0
  const started = Date.now()

  while (true) {
    const conn = await fetchPage(after)
    page++
    for (const n of conn.nodes || []) {
      if (!n?.coords) continue
      stations.push({
        id: n.id,
        name: n.name || `Station ${n.id}`,
        type: n.type || 'unknown',
        lat: n.coords.lat,
        lng: n.coords.lon,
        country: n.country || null,
        state: n.state || null,
        last: n.latestDetectionAt || null,
      })
    }
    if (page % 10 === 0) console.log(`[birdsong-stations] page ${page} … ${stations.length} stations`)
    if (!conn.pageInfo?.hasNextPage) break
    after = conn.pageInfo.endCursor
    if (page > 200) { console.warn('[birdsong-stations] pagination guard hit at 200 pages'); break }
  }

  // generatedAt lets the client show snapshot freshness; coords already rounded
  // by upstream. The flat {generatedAt, stations:[...]} shape keeps parsing trivial.
  const payload = { generatedAt: new Date().toISOString(), count: stations.length, stations }
  writeFileSync(OUT, JSON.stringify(payload))
  const kb = (Buffer.byteLength(JSON.stringify(payload)) / 1024).toFixed(0)
  console.log(`[birdsong-stations] wrote ${stations.length} stations to public/birdsong-stations.json (${kb} KB, ${page} pages, ${((Date.now() - started) / 1000).toFixed(1)}s)`)
}

main().catch((err) => {
  console.warn(`[birdsong-stations] SKIPPED — could not refresh snapshot: ${err.message}`)
  if (existsSync(OUT)) console.warn('[birdsong-stations] keeping existing snapshot.')
  else console.warn('[birdsong-stations] no existing snapshot; app will fall back to live station queries.')
  process.exit(0) // never fail the build
})
