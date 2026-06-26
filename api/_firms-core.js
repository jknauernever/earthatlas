/**
 * Shared NASA FIRMS active-fire core — used by BOTH the production Edge function
 * (api/firms.js) and the vite dev middleware (firmsProxyPlugin in vite.config.js)
 * so localhost and prod behave identically. Mirrors the api/_ebird-core.js split.
 *
 * FIRMS publishes satellite hotspot *points* (VIIRS/MODIS), not perimeters. The
 * Area API returns CSV for a bbox + day range:
 *   {base}/api/area/csv/{MAP_KEY}/{SOURCE}/{west,south,east,north}/{DAY_RANGE}[/{DATE}]
 *
 * Two instances: the US/Canada one ("/usfs/api/area/") carries the RT/URT tiers
 * (~30 min / <60 s latency over North America); the default one ("/api/area/")
 * is global at NRT (~3 hr). We pick the US instance when the requested bbox is
 * fully within North America and fall back to global otherwise — freshest data
 * domestically, still worldwide everywhere else.
 *
 * This module is fetch-agnostic: it builds the upstream URLs and parses the CSV
 * into GeoJSON. The caller does the actual fetching (Edge `fetch` vs Node).
 */

export const FIRMS_HOST = 'https://firms.modaps.eosdis.nasa.gov'

// VIIRS near-real-time sources, merged for best detection coverage (375 m).
// NOAA-20 + S-NPP + NOAA-21 each fly a separate VIIRS; together they fill each
// other's swath gaps and overpass times. MODIS is coarser (1 km) and we leave
// it out of the default to keep the layer crisp — it can be requested via ?src.
export const DEFAULT_SOURCES = ['VIIRS_NOAA20_NRT', 'VIIRS_SNPP_NRT', 'VIIRS_NOAA21_NRT']

const VALID_SOURCES = new Set([
  'VIIRS_NOAA20_NRT', 'VIIRS_SNPP_NRT', 'VIIRS_NOAA21_NRT',
  'MODIS_NRT', 'LANDSAT_NRT',
])

// North America envelope — within this we use the US/Canada (RT/URT) instance.
const NA = { w: -170, s: 5, e: -50, n: 75 }

const clampDays = (d) => Math.max(1, Math.min(7, Math.floor(Number(d) || 1)))

// Parse "w,s,e,n" → validated [w,s,e,n] or null. Order-corrects swapped pairs and
// clamps to valid lon/lat so a malformed viewport can't ask FIRMS for nonsense.
export function parseBbox(str) {
  if (!str) return null
  const p = String(str).split(',').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return null
  let [w, s, e, n] = p
  if (w > e) [w, e] = [e, w]
  if (s > n) [s, n] = [n, s]
  w = Math.max(-180, Math.min(180, w)); e = Math.max(-180, Math.min(180, e))
  s = Math.max(-90, Math.min(90, s)); n = Math.max(-90, Math.min(90, n))
  if (e - w < 1e-4 || n - s < 1e-4) return null
  return [w, s, e, n]
}

const bboxInNA = ([w, s, e, n]) => w >= NA.w && e <= NA.e && s >= NA.s && n <= NA.n

/**
 * Resolve a request's searchParams into everything the caller needs to fetch.
 * Returns { error, status } on bad input, else { urls, sources, na, bbox, days,
 * cacheControl }.
 */
export function resolveFirmsRequest(searchParams, mapKey) {
  if (!mapKey) return { error: 'FIRMS key not configured', status: 500 }
  const bbox = parseBbox(searchParams.get('bbox'))
  if (!bbox) return { error: 'invalid or missing bbox (expect west,south,east,north)', status: 400 }
  const days = clampDays(searchParams.get('days'))

  const req = (searchParams.get('src') || '').split(',').map((s) => s.trim()).filter(Boolean)
  const sources = (req.length ? req.filter((s) => VALID_SOURCES.has(s)) : DEFAULT_SOURCES)
  if (!sources.length) return { error: 'no valid src', status: 400 }

  const na = bboxInNA(bbox)
  const base = `${FIRMS_HOST}/${na ? 'usfs/' : ''}api/area/csv`
  const coords = bbox.join(',')
  const urls = sources.map((src) => ({
    src,
    url: `${base}/${mapKey}/${src}/${coords}/${days}`,
  }))

  // Detections refresh on satellite overpass cadence; a few minutes of edge
  // staleness is invisible and keeps us well under the 5000-per-10-min cap.
  const cacheControl = 'public, s-maxage=300, stale-while-revalidate=600'
  return { urls, sources, na, bbox, days, cacheControl }
}

// One CSV row → a parsed object keyed by FIRMS column name. FIRMS area CSV always
// leads with a header row; columns vary slightly by product (bright_ti4 vs
// brightness, bright_ti5 vs bright_t31), so we key by header name, not index.
function parseCsv(text) {
  const lines = String(text || '').trim().split('\n')
  if (lines.length < 2) return []
  const cols = lines[0].split(',')
  const out = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',')
    if (cells.length < cols.length) continue
    const row = {}
    for (let c = 0; c < cols.length; c++) row[cols[c]] = cells[c]
    out.push(row)
  }
  return out
}

// FIRMS confidence is either VIIRS text (l/n/h) or MODIS numeric (0–100).
// Normalize to {low,nominal,high} and a 0–1 sort weight.
function normConfidence(raw) {
  const v = String(raw ?? '').trim().toLowerCase()
  if (v === 'l' || v === 'low') return { label: 'low', w: 0.2 }
  if (v === 'n' || v === 'nominal') return { label: 'nominal', w: 0.6 }
  if (v === 'h' || v === 'high') return { label: 'high', w: 1 }
  const num = Number(v)
  if (Number.isFinite(num)) {
    if (num < 30) return { label: 'low', w: num / 100 }
    if (num < 80) return { label: 'nominal', w: num / 100 }
    return { label: 'high', w: num / 100 }
  }
  return { label: 'nominal', w: 0.6 }
}

// acq_date "YYYY-MM-DD" + acq_time "HHMM" (UTC, may be unpadded e.g. 818) → ms.
function acqMs(date, time) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''))
  if (!m) return null
  const t = String(time || '0').padStart(4, '0')
  const hh = Number(t.slice(0, 2)), mm = Number(t.slice(2, 4))
  return Date.UTC(+m[1], +m[2] - 1, +m[3], hh, mm)
}

/**
 * Turn the fetched per-source CSV texts into a GeoJSON FeatureCollection of
 * detection points. Computes `hours_ago` server-side (so the client needs no
 * clock/timezone math and the value rides the edge cache), drops low-confidence
 * detections, dedups identical pixels seen by multiple satellites, sorts newest
 * first, and caps the count so a continental view can't ship a giant payload.
 *
 * @param {{src:string,text:string}[]} fetched
 * @param {number} nowMs
 * @param {{cap?:number, keepLow?:boolean}} [opts]
 */
export function firmsCsvToGeoJSON(fetched, nowMs, opts = {}) {
  const cap = opts.cap ?? 6000
  const keepLow = !!opts.keepLow
  const seen = new Set()
  const feats = []
  for (const { src, text } of fetched) {
    for (const row of parseCsv(text)) {
      const lat = Number(row.latitude), lng = Number(row.longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      const conf = normConfidence(row.confidence)
      if (!keepLow && conf.label === 'low') continue
      const ms = acqMs(row.acq_date, row.acq_time)
      const hoursAgo = ms == null ? null : Math.max(0, Math.round(((nowMs - ms) / 3.6e6) * 10) / 10)
      // Dedup the same ground pixel detected by multiple platforms in the same
      // pass: round to ~1 km and the hour.
      const key = `${lat.toFixed(2)},${lng.toFixed(2)},${row.acq_date},${String(row.acq_time).slice(0, 2)}`
      if (seen.has(key)) continue
      seen.add(key)
      const frp = Number(row.frp)
      const bright = Number(row.bright_ti4 ?? row.brightness)
      feats.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {
          src,
          sat: row.satellite || '',
          conf: conf.label,
          frp: Number.isFinite(frp) ? frp : null,
          bright: Number.isFinite(bright) ? bright : null,
          dn: row.daynight === 'N' ? 'night' : row.daynight === 'D' ? 'day' : '',
          acq_ms: ms,
          hours_ago: hoursAgo,
          _w: conf.w, // internal sort weight, stripped below
        },
      })
    }
  }
  // Newest first, then by confidence — so when we cap, we keep the freshest,
  // most reliable detections.
  feats.sort((a, b) => (b.properties.acq_ms || 0) - (a.properties.acq_ms || 0) || b.properties._w - a.properties._w)
  const truncated = feats.length > cap
  const kept = truncated ? feats.slice(0, cap) : feats
  for (const f of kept) delete f.properties._w
  return {
    type: 'FeatureCollection',
    features: kept,
    _count: kept.length,
    _truncated: truncated,
    _generated_ms: nowMs,
  }
}
