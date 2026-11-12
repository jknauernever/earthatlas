// Node reader for the national `deep-inland` dataset (scripts/national/deep-inland/build.py, docs/NATIONAL_DATA.md):
// is a point land more than 2 km from any sizeable sea, river or lake? Same files and rules as inland.py.
//
//   const g = await loadDeepInland()          // the published version, via the national catalog
//   const g = await loadDeepInland({ dir })   // a local build folder (data/national/deep-inland/build/<version>)
//   g.at(lon, lat)                            // → true when deep inland; outside the grid's boxes → false
//
// The whole grid is ~tens of MB in memory: load it once per process (bake scripts, long-lived workers), not per request.
import { gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { join, basename } from 'node:path'

const CATALOG = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com/national/catalog.json'

export async function loadDeepInland({ dir = null, catalogUrl = CATALOG, fetchImpl = fetch } = {}) {
  let entry, get
  if (dir) {
    entry = { version: basename(dir) }
    get = async (f) => readFileSync(join(dir, f))
  } else {
    const cat = await (await fetchImpl(catalogUrl)).json()
    entry = cat.datasets?.['deep-inland']
    if (!entry) throw new Error('deep-inland is not in the national catalog')
    get = async (f) => { const r = await fetchImpl(entry.files[f]); if (!r.ok) throw new Error(`${f}: ${r.status}`); return Buffer.from(await r.arrayBuffer()) }
  }
  const meta = JSON.parse((await get('deep-inland.json')).toString())
  const boxes = []
  for (const b of Object.values(meta.boxes)) boxes.push({ ...b, bits: gunzipSync(await get(b.file)), stride: (b.nx + 7) >> 3 })
  const cell = meta.cell_deg
  return {
    version: entry.version, meta,
    at(lon, lat) {
      for (const b of boxes) {
        if (lon < b.w || lon >= b.e || lat <= b.s || lat > b.n) continue
        const col = Math.min(Math.floor((lon - b.w) / cell), b.nx - 1)
        const row = Math.min(Math.floor((b.n - lat) / cell), b.ny - 1)
        return ((b.bits[row * b.stride + (col >> 3)] >> (7 - (col & 7))) & 1) === 1
      }
      return false
    },
  }
}
