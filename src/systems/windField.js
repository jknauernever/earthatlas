/**
 * Grid field loader/sampler for /systems.
 *
 * Loads a baked dataset pair (meta JSON + Int16 binary grid — format in
 * SYSTEMS-NOTES.md §1) and answers point queries via bilinear interpolation.
 * One object serves both the on-map rendering and the click-to-inspect
 * popup, so every number on screen traces to the same model run.
 *
 * Handles any grid geometry the bakes produce: north-first (GFS, dLat<0) or
 * south-first (HYCOM, dLat>0), lon origin at 0 (GFS) or -180 (CoralTemp),
 * one plane (scalars) or two (vector u,v).
 *
 * Fetch order: Vercel Blob (written by the crons) first, then the local dev
 * bake (`node scripts/bake-systems.mjs` → public/dev-data/).
 */

const BLOB_PUBLIC_BASE =
  import.meta.env.VITE_BLOB_PUBLIC_BASE || 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com'

export const SOURCE_BASES = [`${BLOB_PUBLIC_BASE}/systems`, '/dev-data/systems']

export class GridField {
  constructor(meta, buffer, planes) {
    this.meta = meta
    this.planes = planes
    this._view = new DataView(buffer)
    this._n = meta.nLat * meta.nLon
  }

  _raw(plane, row, col) {
    return this._view.getInt16((plane * this._n + row * this.meta.nLon + col) * 2, true)
  }

  // Fractional row/col for a point, or null when outside the grid's latitude
  // span (clamping there would silently report edge values for polar clicks).
  _locate(lng, lat) {
    const m = this.meta
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !(Math.abs(lat) <= 90)) return null
    const rf = (lat - m.lat0) / m.dLat
    if (rf < -0.5 || rf > m.nLat - 0.5) return null
    let cf = ((((lng - m.lon0) % 360) + 360) % 360) / m.dLon
    // Regional grids (narrower than the full globe) must NOT wrap: without
    // this cut, `% nLon` in the bilinear repeats an 8°-wide field (LiveOcean)
    // around the entire planet. Half a cell of slack keeps the true edges.
    if (m.nLon * m.dLon < 359 && cf > m.nLon - 0.5) {
      cf -= 360 / m.dLon // just west of lon0 lands near the wrap point
      if (cf < -0.5) return null
      cf = Math.max(0, cf)
    }
    return { rf: Math.min(m.nLat - 1, Math.max(0, rf)), cf }
  }

  // Bilinear over whichever corners are valid, weights renormalized — null
  // only when ALL four are missing. Requiring all four valid discarded every
  // sample within one cell of a coastline, which (stacked on the bake's own
  // land mask) left dark unpainted stair-steps wherever water meets land.
  _bilinear(plane, rf, cf) {
    const m = this.meta
    const r0 = Math.min(m.nLat - 2, Math.max(0, Math.floor(rf)))
    const c0 = Math.floor(cf) % m.nLon
    const c1 = (c0 + 1) % m.nLon
    const fr = Math.min(1, Math.max(0, rf - r0))
    const fc = cf - Math.floor(cf)
    const vals = [
      this._raw(plane, r0, c0),
      this._raw(plane, r0, c1),
      this._raw(plane, r0 + 1, c0),
      this._raw(plane, r0 + 1, c1),
    ]
    const wts = [(1 - fc) * (1 - fr), fc * (1 - fr), (1 - fc) * fr, fc * fr]
    let sum = 0
    let wsum = 0
    for (let i = 0; i < 4; i++) {
      if (vals[i] === m.missing) continue
      sum += vals[i] * wts[i]
      wsum += wts[i]
    }
    if (wsum < 0.05) return null
    return sum / wsum / m.scale
  }

  /** Vector field → { u, v, speed } (grids with 2 planes), else null. */
  sample(lng, lat) {
    if (this.planes < 2) return null
    const loc = this._locate(lng, lat)
    if (!loc) return null
    const u = this._bilinear(0, loc.rf, loc.cf)
    const v = this._bilinear(1, loc.rf, loc.cf)
    if (u == null || v == null) return null
    return { u, v, speed: Math.hypot(u, v) }
  }

  /** Scalar field → { value } (single-plane grids), else null. */
  sampleScalar(lng, lat) {
    const loc = this._locate(lng, lat)
    if (!loc) return null
    const value = this._bilinear(0, loc.rf, loc.cf)
    return value == null ? null : { value }
  }
}

// Dev QA: a locally-baked file in public/dev-data/systems beats the prod blob
// so new bake output is testable on localhost before it ships — but only
// while FRESH (24 h), so a forgotten local file can't quietly serve stale
// data in a later session. Prod never reads dev-data (it isn't deployed).
const DEV_DATA_MAX_AGE_MS = 24 * 60 * 60 * 1000
const jsonBases = () =>
  import.meta.env.DEV ? ['/dev-data/systems', `${BLOB_PUBLIC_BASE}/systems`] : SOURCE_BASES

/** Load a baked JSON dataset (e.g. 'firms-hotspots') with the same fallback. */
export async function loadSystemsJson(name, expectKind) {
  let lastErr = null
  for (const base of jsonBases()) {
    try {
      const r = await fetch(`${base}/${name}.json`)
      if (!r.ok) throw new Error(`json ${r.status}`)
      const j = await r.json()
      if (j?.version !== 1 || (expectKind && j?.kind !== expectKind)) throw new Error('unexpected json')
      if (base.startsWith('/dev-data') && j?.fetched_ms && Date.now() - j.fetched_ms > DEV_DATA_MAX_AGE_MS) {
        throw new Error('dev-data file older than 24 h — falling back to blob')
      }
      return j
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr || new Error('no data source reachable')
}

/** Load a dataset by its baked name (e.g. 'gfs-wind', 'hycom-currents'). */
export async function loadGridField(dataset, expectKind) {
  let lastErr = null
  for (const base of SOURCE_BASES) {
    try {
      const metaRes = await fetch(`${base}/${dataset}-meta.json`)
      if (!metaRes.ok) throw new Error(`meta ${metaRes.status}`)
      const meta = await metaRes.json()
      if (meta?.version !== 1 || (expectKind && meta?.kind !== expectKind)) throw new Error('unexpected meta')
      const gridRes = await fetch(`${base}/${dataset}-grid.bin`)
      if (!gridRes.ok) throw new Error(`grid ${gridRes.status}`)
      const buffer = await gridRes.arrayBuffer()
      const planeBytes = meta.nLat * meta.nLon * 2
      if (buffer.byteLength % planeBytes !== 0) throw new Error(`grid size ${buffer.byteLength}`)
      const planes = buffer.byteLength / planeBytes
      if (planes < 1 || planes > 2) throw new Error(`unexpected plane count ${planes}`)
      return new GridField(meta, buffer, planes)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr || new Error('no data source reachable')
}
