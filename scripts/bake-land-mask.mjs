/**
 * Bake a global land mask from Natural Earth 10 m land polygons
 * (public domain) → public/systems/land-mask-0p1.bin
 *
 * 0.1° grid, north-first, lng from -180: 3600 × 1800 cells, one bit per cell
 * (1 = land), row-major, packed MSB-first → 810 KB (gzips to ~150 KB as a
 * static asset). Used by /systems overlays at globe zooms, where clipping
 * ocean rasters to the basemap's vector tiles proved fragile near the limb
 * (tile culling, query exclusion) and too coarse to respect skinny peninsulas.
 *
 *   node scripts/bake-land-mask.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const URL_NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson'
const RES = 0.1
const COLS = Math.round(360 / RES)
const ROWS = Math.round(180 / RES)

const r = await fetch(URL_NE)
if (!r.ok) throw new Error(`natural earth ${r.status}`)
const fc = await r.json()

// Scanline even-odd fill. Edge table bucketed by row for speed.
const rowXs = Array.from({ length: ROWS }, () => [])
let edges = 0
for (const f of fc.features) {
  const g = f.geometry
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
  for (const rings of polys) {
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [x0, y0] = ring[i]
        const [x1, y1] = ring[i + 1]
        if (y0 === y1) continue
        edges++
        const yTop = Math.max(y0, y1)
        const yBot = Math.min(y0, y1)
        // Rows whose center latitude lies in [yBot, yTop)
        const rStart = Math.max(0, Math.ceil((90 - yTop) / RES - 0.5))
        const rEnd = Math.min(ROWS - 1, Math.floor((90 - yBot) / RES - 0.5))
        for (let row = rStart; row <= rEnd; row++) {
          const lat = 90 - (row + 0.5) * RES
          if (lat >= yTop || lat < yBot) continue
          const t = (lat - y0) / (y1 - y0)
          rowXs[row].push(x0 + t * (x1 - x0))
        }
      }
    }
  }
}

const bits = new Uint8Array((COLS * ROWS) / 8)
let landCells = 0
for (let row = 0; row < ROWS; row++) {
  const xs = rowXs[row].sort((a, b) => a - b)
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const c0 = Math.max(0, Math.ceil((xs[i] + 180) / RES - 0.5))
    const c1 = Math.min(COLS - 1, Math.floor((xs[i + 1] + 180) / RES - 0.5))
    for (let c = c0; c <= c1; c++) {
      const idx = row * COLS + c
      bits[idx >> 3] |= 0x80 >> (idx & 7)
      landCells++
    }
  }
}

const outDir = join(__dirname, '..', 'public', 'systems')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'land-mask-0p1.bin'), bits)
console.log(`land mask: ${COLS}×${ROWS}, ${edges} edges, land fraction ${(landCells / (COLS * ROWS) * 100).toFixed(1)}% → ${bits.length} bytes`)
