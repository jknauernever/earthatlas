// Global Fishing Watch 4Wings tiles for /ships, proxied server-side.
//
//   /api/gfw-tiles?l=presence|dark&from=YYYY-MM-DD&to=YYYY-MM-DD&z=&x=&y=
//   /api/gfw-tiles?op=cell&from=&to=&z=&x=&y=&cell=N   one dark-vessel cell's detail (JSON)
//
// presence = AIS vessel presence, all vessel types (hours per grid cell)
// dark     = Sentinel-1 radar vessel detections NOT matched to any AIS
//            broadcast (detections per grid cell), i.e. "dark" vessels
//
// Why a proxy (full reference: docs/GFW_ACTIVITY_API.md):
//  - Every tile needs our GFW token, and GFW's terms (§2.G) forbid exposing it
//    in a public web page. The token stays here.
//  - GFW generates tiles on demand and slowly (a world tile took ~13 s), so the
//    CDN caches every tile: 30 days for ranges that ended over a week ago
//    (GFW data runs ~4 days behind for presence, ~5–6 for radar), 1 day otherwise.
//  - Only these two datasets, whole-day ranges ≤ 366 days, and z ≤ 12 (GFW's
//    maximum), so the route can't be used as an open GFW relay.
// Tiles are MVT, one layer "main": square grid cells with `count` (+ `cell`, `id`).
// License: CC BY-NC 4.0, "Powered by Global Fishing Watch." (credited in the /ships panel).

import zlib from 'node:zlib'

const GFW = 'https://gateway.api.globalfishingwatch.org/v3/4wings/tile/heatmap'
const LAYERS = {
  presence: { dataset: 'public-global-presence:latest' },
  dark: { dataset: 'public-global-sar-presence:latest', filter: "matched='false'" },
}
const DAY = /^\d{4}-\d{2}-\d{2}$/

// One dark cell for the map popup (Josh, 2026-09-26): 4Wings interaction, split by GFW's
// radar-image classifier (neural_vessel_type: "Likely Fishing" ≥0.9, "Likely non-fishing" ≤0.1,
// else "Unknown"; docs/GFW_ACTIVITY_API.md). Verified live: the three parts sum to the total.
// Detections in the same satellite scene share a timestamp to the minute, so distinct minutes
// = radar passes that saw something here.
const INTERACTION = 'https://gateway.api.globalfishingwatch.org/v3/4wings/interaction'
const KINDS = { fishing: 'Likely Fishing', nonFishing: 'Likely non-fishing' }
async function cellDetail({ z, x, y, cell, from, to, token }) {
  const one = async (extra) => {
    const qs = new URLSearchParams({ 'datasets[0]': LAYERS.dark.dataset, 'date-range': `${from},${to}`,
      'filters[0]': extra ? `${LAYERS.dark.filter} AND neural_vessel_type='${extra}'` : LAYERS.dark.filter })
    const r = await fetch(`${INTERACTION}/${z}/${x}/${y}/${cell}?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) throw new Error(`GFW ${r.status}`)
    const e = (await r.json()).entries?.[0]?.[0]
    return { n: e?.detections || 0, ts: e?.timestamps ? e.timestamps.split(',') : [] }
  }
  const [all, fishing, nonFishing] = await Promise.all([one(null), one(KINDS.fishing), one(KINDS.nonFishing)])
  const perPass = new Map()
  for (const t of all.ts) { const k = t.slice(0, 16); perPass.set(k, (perPass.get(k) || 0) + 1) }
  const sorted = [...all.ts].sort()
  return { detections: all.n, fishing: fishing.n, nonFishing: nonFishing.n, unknown: Math.max(0, all.n - fishing.n - nonFishing.n),
    passes: perPass.size, maxInPass: Math.max(0, ...perPass.values()), first: sorted[0] || null, last: sorted[sorted.length - 1] || null }
}

export default async function handler(req, res) {
  const p = new URL(req.url, 'http://localhost').searchParams
  const op = p.get('op')
  const layer = op === 'cell' ? LAYERS.dark : LAYERS[p.get('l')]
  const from = p.get('from') || '', to = p.get('to') || ''
  const z = Number(p.get('z')), x = Number(p.get('x')), y = Number(p.get('y'))
  const fail = (code, msg) => { res.statusCode = code; res.setHeader('Cache-Control', 'no-store'); res.end(msg) }
  if (!layer) return fail(400, 'unknown layer')
  if (!DAY.test(from) || !DAY.test(to)) return fail(400, 'bad date range')
  const span = (Date.parse(to) - Date.parse(from)) / 864e5
  if (!(span > 0 && span <= 366)) return fail(400, 'date range must be 1–366 days')
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 12 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return fail(400, 'bad tile')
  const token = process.env.GFW_API_TOKEN
  if (!token) return fail(503, 'GFW not configured')

  const settledRange = Date.parse(to) < Date.now() - 7 * 864e5
  if (op === 'cell') {
    const cell = Number(p.get('cell'))
    if (!Number.isInteger(cell) || cell < 0 || cell > 1e6) return fail(400, 'bad cell')
    try {
      const d = await cellDetail({ z, x, y, cell, from, to, token })
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', settledRange ? 'public, max-age=86400, s-maxage=2592000' : 'public, max-age=3600, s-maxage=86400')
      return res.end(JSON.stringify(d))
    } catch (e) { return fail(502, e.message) }
  }

  const qs = new URLSearchParams({ 'datasets[0]': layer.dataset, 'date-range': `${from},${to}`,
    'temporal-aggregation': 'true', format: 'MVT' })
  if (layer.filter) qs.set('filters[0]', layer.filter)
  let upstream
  try {
    upstream = await fetch(`${GFW}/${z}/${x}/${y}?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
  } catch {
    return fail(502, 'GFW unreachable')
  }
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Vary', 'Accept-Encoding') // see api/vessel-tiles.js: keeps gzip/identity CDN variants apart
  const settled = Date.parse(to) < Date.now() - 7 * 864e5
  const cache = settled ? 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800'
    : 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400'
  if (upstream.status === 204 || upstream.status === 404) {
    res.statusCode = 204
    res.setHeader('Cache-Control', cache)
    return res.end()
  }
  if (!upstream.ok) return fail(upstream.status === 429 ? 429 : 502, `GFW ${upstream.status}`)
  const body = Buffer.from(await upstream.arrayBuffer()) // fetch has already un-gzipped it
  if (!body.length) { res.statusCode = 204; res.setHeader('Cache-Control', cache); return res.end() }
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-protobuf')
  res.setHeader('Content-Encoding', 'gzip')
  res.setHeader('Cache-Control', cache)
  res.end(zlib.gzipSync(body))
}
