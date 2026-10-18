/**
 * Local aerial photo tiles that need cleaning before the map can lay them over Mapbox satellite (Josh 2026-10-10).
 *
 *   GET /api/aerial-tiles?src=sjc&z={z}&x={x}&y={y}  → 256 px WebP with transparency
 *
 * San Juan County's 2025 aerials (src/lib/localAerials.js) paint a flat blue-grey (#3f6073) wherever the photos end, and
 * the county server ignores transparent=true, so on /ships its coverage box showed as a big light-blue rectangle over the
 * water. This fetches the county's lossless PNG for the tile, turns that fill colour transparent where it forms solid areas
 * (clearSolidFill: so only the photos remain, with their natural edges, and water of the same colour inside them stays) and caches the result at the CDN for 30 days, so each tile is processed once.
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

/**
 * Clear the fill: every pixel within `tol` of `rgb` that lies in or beside a solid block of it ((2r+1)² pixels that all
 * match). The county's fill is one flat colour over large areas; real water in the photos only touches that colour in
 * scattered pixels and small patches, which stay (2026-10-17: clearing every matching pixel punched speckled holes in the
 * water, e.g. around Reef Island, through which Mapbox's darker imagery showed). The tile edge never breaks a block.
 */
function clearSolidFill(data, w, h, [fr, fg, fb], tol, r = 2) {
  const m = new Uint8Array(w * h)
  for (let p = 0; p < w * h; p++) {
    m[p] = Math.abs(data[p * 4] - fr) <= tol && Math.abs(data[p * 4 + 1] - fg) <= tol && Math.abs(data[p * 4 + 2] - fb) <= tol ? 1 : 0
  }
  const core = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x]) continue
    let all = 1
    for (let j = -r; j <= r && all; j++) for (let i = -r; i <= r; i++) {
      const xx = x + i, yy = y + j
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && !m[yy * w + xx]) { all = 0; break }
    }
    core[y * w + x] = all
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x]) continue
    let near = 0
    for (let j = -r; j <= r && !near; j++) for (let i = -r; i <= r; i++) {
      const xx = x + i, yy = y + j
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && core[yy * w + xx]) { near = 1; break }
    }
    if (near) data[(y * w + x) * 4 + 3] = 0
  }
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
  clearSolidFill(data, info.width, info.height, [fr, fg, fb], src.tol)
  let kept = 0
  for (let i = 3; i < data.length; i += 4) if (data[i]) kept++
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800')
  if (!kept) { res.statusCode = 204; return res.end() }   // nothing but fill: no tile (Mapbox shows its own imagery)
  const out = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).webp({ quality: 82, alphaQuality: 100 }).toBuffer()
  res.statusCode = 200
  res.setHeader('Content-Type', 'image/webp')
  return res.end(out)
}
