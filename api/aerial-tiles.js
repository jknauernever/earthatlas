/**
 * Local aerial photo tiles that need cleaning before the map can lay them over Mapbox satellite (Josh 2026-10-10).
 *
 *   GET /api/aerial-tiles?src=sjc&z={z}&x={x}&y={y}  → 256 px WebP with transparency
 *
 * San Juan County's 2025 aerials (src/lib/localAerials.js) paint a flat blue-grey (#3f6073) wherever the photos end, and
 * the county server ignores transparent=true, so on /ships its coverage box showed as a big light-blue rectangle over the
 * water. This fetches the county's lossless PNG for the tile, turns exactly that fill colour transparent (so only the
 * photos remain, with their natural edges) and caches the result at the CDN for 30 days, so each tile is processed once.
 * Node runtime (sharp).
 */
import sharp from 'sharp'

const SOURCES = {
  sjc: {
    url: 'https://gis.sanjuancountywa.gov/arcgis/rest/services/Basemaps/Aerials_2025/MapServer/export',
    fill: [63, 96, 115],      // the county mosaic's own background colour (sampled; exact in its PNG output)
    tol: 2,                   // PNG is lossless: the fill is exact, so a near-zero tolerance never eats photo pixels
    bounds: [-123.25, 48.4, -122.7, 48.81],
  },
}

const HALF = 20037508.342789244
function tileBbox(z, x, y) {
  const size = (2 * HALF) / 2 ** z
  return [x * size - HALF, HALF - (y + 1) * size, (x + 1) * size - HALF, HALF - y * size]
}

export default async function handler(req, res) {
  const q = new URL(req.url, 'http://x').searchParams
  const src = SOURCES[q.get('src')]
  const [z, x, y] = ['z', 'x', 'y'].map((k) => Number(q.get(k)))
  if (!src || ![z, x, y].every(Number.isInteger) || z < 0 || z > 22) { res.statusCode = 400; return res.end('bad request') }
  const bbox = tileBbox(z, x, y)
  const params = new URLSearchParams({ bbox: bbox.join(','), bboxSR: '3857', imageSR: '3857', size: '256,256', format: 'png24', transparent: 'false', f: 'image' })
  let png
  try {
    const r = await fetch(`${src.url}?${params}`)
    if (!r.ok) throw new Error(`upstream ${r.status}`)
    png = Buffer.from(await r.arrayBuffer())
  } catch (e) {
    console.error('[aerial-tiles]', q.get('src'), z, x, y, e?.message)
    res.statusCode = 502; res.setHeader('Cache-Control', 'no-store'); return res.end('upstream failed')
  }
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const [fr, fg, fb] = src.fill
  let kept = 0
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - fr) <= src.tol && Math.abs(data[i + 1] - fg) <= src.tol && Math.abs(data[i + 2] - fb) <= src.tol) data[i + 3] = 0
    else kept++
  }
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800')
  if (!kept) { res.statusCode = 204; return res.end() }   // nothing but fill: no tile (Mapbox shows its own imagery)
  const out = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).webp({ quality: 82, alphaQuality: 100 }).toBuffer()
  res.statusCode = 200
  res.setHeader('Content-Type', 'image/webp')
  return res.end(out)
}
