// SkyTruth Cerulean (oil slicks + their likely sources) for /ships, proxied so the CDN keeps one copy of each answer
// and SkyTruth's API isn't asked again for every visitor. Public collections only; no key. Facts: lib/ships/cerulean.js.
//
//   /api/cerulean?op=tile&from=YYYY-MM-DD&to=YYYY-MM-DD&z=&x=&y=[&g=c]   credible slicks (SkyTruth's rule), MVT layer "default";
//                                                                   g=c: one centroid point per slick instead of its outline
//   /api/cerulean?op=slick&id=N                                     one slick + its ranked candidate sources (JSON)
//   /api/cerulean?op=vessel&mmsi=M[,M…]                             every slick linked to these MMSIs (≤ 5) (JSON)
//   /api/cerulean?op=radar&id=N&z=&x=&y=                            the slick's Sentinel-1 radar image (JPEG tiles, z 6–16)
//   /api/cerulean?op=near&id=N                                      the slick's candidate ships, each with its closest approach
//                                                                   in the 6 h before the image and that stretch of its AIS track
//
// Only these three shapes, z 2–14, whole-day ranges and numeric ids, so the route can't be used as an open relay.
// Tiles below z2 take SkyTruth 20–30 s each, so the map never asks for them.

import zlib from 'node:zlib'
import { DAY, TILE_PROPS, credibleFilter, idList } from '../lib/ships/cerulean.js'
import { C, UA, ceruleanSlick, ceruleanVessel, shipsNearSlick, radarTile } from '../lib/ships/ceruleanClient.js'


export default async function handler(req, res) {
  const p = new URL(req.url, 'http://localhost').searchParams
  const op = p.get('op')
  const fail = (code, msg) => { res.statusCode = code; res.setHeader('Cache-Control', 'no-store'); res.end(msg) }
  const json = (body, cache) => {
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', cache)
    res.end(JSON.stringify(body))
  }
  // New slicks and new source matches (AIS matching runs ~72 h after a pass) arrive all day: answers keep 6 h at the
  // edge and are served stale for a day while one refresh runs.
  const FRESH = 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400'

  try {
    if (op === 'slick') {
      const id = p.get('id') || ''
      if (!/^\d{1,10}$/.test(id)) return fail(400, 'bad id')
      const d = await ceruleanSlick(id)
      return d ? json(d, FRESH) : fail(404, 'no such slick')
    }
    if (op === 'radar') {
      const id = p.get('id') || ''
      const z = Number(p.get('z')), x = Number(p.get('x')), y = Number(p.get('y'))
      if (!/^\d{1,10}$/.test(id) || ![z, x, y].every(Number.isInteger) || z < 6 || z > 16 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return fail(400, 'bad radar tile')
      const t = await radarTile(id, z, x, y)
      const IMMUTABLE = 'public, max-age=604800, s-maxage=2592000, immutable'
      if (!t || t.empty) { res.statusCode = 204; res.setHeader('Cache-Control', t ? IMMUTABLE : 'no-store'); return res.end() }
      res.statusCode = 200; res.setHeader('Content-Type', t.type); res.setHeader('Cache-Control', IMMUTABLE)
      return res.end(t.body)
    }
    if (op === 'near') {
      const id = p.get('id') || ''
      if (!/^\d{1,10}$/.test(id)) return fail(400, 'bad id')
      const d = await shipsNearSlick(id, 6)
      return d ? json(d, FRESH) : fail(404, 'no such slick')
    }
    if (op === 'vessel') {
      const mmsis = [...new Set(idList(p.get('mmsi') || ''))].filter((m) => /^\d{9}$/.test(m)).slice(0, 5)
      if (!mmsis.length) return fail(400, 'mmsi must be 9 digits')
      return json(await ceruleanVessel(mmsis), FRESH)
    }
    if (op !== 'tile') return fail(400, 'unknown op')
  } catch (e) {
    return fail(e.status === 429 ? 429 : 502, e.message)
  }

  const from = p.get('from') || '', to = p.get('to') || ''
  const z = Number(p.get('z')), x = Number(p.get('x')), y = Number(p.get('y'))
  if (!DAY.test(from) || !DAY.test(to) || !(Date.parse(to) > Date.parse(from))) return fail(400, 'bad date range')
  if (![z, x, y].every(Number.isInteger) || z < 2 || z > 14 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return fail(400, 'bad tile')
  const qs = new URLSearchParams({ filter: credibleFilter(to), datetime: `${from}T00:00:00Z/${to}T00:00:00Z`, properties: TILE_PROPS.join(',') })
  if (p.get('g') === 'c') qs.set('geom-column', 'centroid')
  let upstream
  try {
    upstream = await fetch(`${C}/public.slick_plus/tiles/WebMercatorQuad/${z}/${x}/${y}?${qs}`, { headers: UA })
  } catch {
    return fail(502, 'Cerulean unreachable')
  }
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Vary', 'Accept-Encoding') // see api/vessel-tiles.js: keeps gzip/identity CDN variants apart
  // A range that ended over a week ago only changes when SkyTruth reviews or re-scores old slicks.
  const settled = Date.parse(to) < Date.now() - 7 * 864e5
  const cache = settled ? 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800' : FRESH
  if (upstream.status === 204 || upstream.status === 404) { res.statusCode = 204; res.setHeader('Cache-Control', cache); return res.end() }
  if (!upstream.ok) return fail(upstream.status === 429 ? 429 : 502, `Cerulean ${upstream.status}`)
  const body = Buffer.from(await upstream.arrayBuffer())
  if (!body.length) { res.statusCode = 204; res.setHeader('Cache-Control', cache); return res.end() }
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-protobuf')
  res.setHeader('Content-Encoding', 'gzip')
  res.setHeader('Cache-Control', cache)
  res.end(zlib.gzipSync(body))
}
