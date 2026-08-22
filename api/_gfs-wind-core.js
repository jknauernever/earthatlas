/**
 * GFS wind bake — shared core for the /systems live wind pipeline.
 *
 * Pulls the freshest NOAA GFS 10 m wind analysis/forecast step from Unidata's
 * THREDDS NetCDF Subset Service (the canonical public GFS redistributor;
 * NOMADS retired its OpenDAP subsetting service in 2025, see SCN 25-81) and
 * bakes it into a compact binary grid the client uses for BOTH the particle
 * animation and click-to-inspect popups — one model run, one source of truth.
 *
 * Output pair (written by the cron / local runner, not here):
 *   systems/gfs-wind-meta.json  — provenance + grid geometry (below)
 *   systems/gfs-wind-grid.bin   — Int16LE, u then v, row-major north-first,
 *                                 m/s × 100, missing = -32768
 *
 * Grid: global 0.5° (720 × 361), ~1 MB — plenty for a planet-scale animation
 * (the GFS model itself is the resolution floor) and small enough to ship to
 * every visitor as a single cached file.
 */

import { NetCDFReader } from 'netcdfjs'

const NCSS_URL =
  'https://thredds.ucar.edu/thredds/ncss/grid/grib/NCEP/GFS/Global_0p25deg/Best' +
  '?var=u-component_of_wind_height_above_ground' +
  '&var=v-component_of_wind_height_above_ground' +
  '&vertCoord=10&time=present&horizStride=2&accept=netcdf3'

const N_LAT = 361
const N_LON = 720
const SCALE = 100          // m/s → Int16 hundredths
const MISSING = -32768

const U_VAR = 'u-component_of_wind_height_above_ground'
const V_VAR = 'v-component_of_wind_height_above_ground'

// "Hour since 2026-08-13T00:00:00Z" + an offset in hours → epoch ms.
function timeFromUnits(unitsAttr, hours) {
  const m = /since\s+(.+)$/.exec(unitsAttr || '')
  if (!m) return null
  const base = Date.parse(m[1].trim())
  if (!Number.isFinite(base) || !Number.isFinite(hours)) return null
  return base + hours * 3.6e6
}

function encodeInt16(values, out, offset) {
  let bad = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isFinite(v) && Math.abs(v) < 300) {
      out.writeInt16LE(Math.round(v * SCALE), offset + i * 2)
    } else {
      out.writeInt16LE(MISSING, offset + i * 2)
      bad++
    }
  }
  return bad
}

/**
 * Fetch + parse + encode. Throws on any upstream or sanity failure — callers
 * treat a throw as "keep the previous snapshot" (never publish a bad grid).
 * Returns { meta, gridBuffer }.
 */
export async function fetchWindGrid() {
  const r = await fetch(NCSS_URL, { headers: { accept: 'application/x-netcdf' } })
  if (!r.ok) throw new Error(`thredds ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length < 100000) throw new Error(`thredds response too small (${buf.length} bytes)`)

  const nc = new NetCDFReader(buf)
  const lat = nc.getDataVariable('latitude')
  const lon = nc.getDataVariable('longitude')
  if (lat.length !== N_LAT || lon.length !== N_LON) {
    throw new Error(`unexpected grid ${lat.length}x${lon.length}`)
  }
  if (lat[0] !== 90 || lon[0] !== 0) throw new Error(`unexpected grid origin ${lat[0]},${lon[0]}`)

  const u = nc.getDataVariable(U_VAR)
  const v = nc.getDataVariable(V_VAR)
  if (u.length !== N_LAT * N_LON || v.length !== N_LAT * N_LON) {
    throw new Error(`unexpected field length ${u.length}/${v.length}`)
  }

  const timeVar = nc.variables.find((x) => x.name === 'time')
  const refVar = nc.variables.find((x) => x.name === 'reftime')
  const units = (vr) => vr?.attributes?.find((a) => a.name === 'units')?.value
  const valid_ms = timeFromUnits(units(timeVar), nc.getDataVariable('time')?.[0])
  const run_ms = timeFromUnits(units(refVar), nc.getDataVariable('reftime')?.[0])
  if (!valid_ms || !run_ms) throw new Error('could not parse model run/valid time')

  const gridBuffer = Buffer.alloc(N_LAT * N_LON * 2 * 2)
  const badU = encodeInt16(u, gridBuffer, 0)
  const badV = encodeInt16(v, gridBuffer, N_LAT * N_LON * 2)
  // A global wind field is never mostly-missing; treat that as a broken pull.
  if (badU + badV > N_LAT * N_LON * 0.02) throw new Error(`too many missing values (${badU + badV})`)

  const meta = {
    version: 1,
    kind: 'gfs-wind-10m',
    run_ms,
    valid_ms,
    fetched_ms: Date.now(),
    nLat: N_LAT,
    nLon: N_LON,
    lat0: 90,
    dLat: -0.5,
    lon0: 0,
    dLon: 0.5,
    scale: SCALE,
    missing: MISSING,
    source: 'NOAA NCEP GFS (10 m wind) via Unidata THREDDS NCSS',
  }
  return { meta, gridBuffer }
}

export const BLOB_META_PATH = 'systems/gfs-wind-meta.json'
export const BLOB_GRID_PATH = 'systems/gfs-wind-grid.bin'
