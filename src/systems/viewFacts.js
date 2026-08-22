/**
 * /systems facts engine — deterministic analysis of the current view.
 *
 * Given the map camera and the active layers' already-loaded data, computes a
 * compact structured facts object: per-layer statistics over what's actually
 * visible (screen-sampled with the globe-horizon check), global shares for
 * event layers, and provenance stamps. NO AI here — this is pure arithmetic
 * on data in memory, so every number is real. The "Explain this view"
 * feature sends these facts to a small model that ONLY narrates them; it is
 * never asked to produce a number itself.
 *
 * Values are rounded to a few significant figures and the camera to coarse
 * steps — deliberately, so nearby views produce byte-identical facts and hit
 * the same CDN cache entry.
 */

import { getGlobeGeometry } from './globeGeom.js'

const SAMPLE_COLS = 22
const SAMPLE_ROWS = 14
const PROJ_TOLERANCE = 3

const round = (v, digits = 2) => {
  if (!Number.isFinite(v)) return null
  const m = 10 ** digits
  return Math.round(v * m) / m
}
const sig = (v, n = 3) => (Number.isFinite(v) ? Number(v.toPrecision(n)) : null)

// Visible lng/lat sample points via the screen grid (globe-safe).
function visibleSamples(map, w, h) {
  const geo = getGlobeGeometry(map, w, h)
  const pts = []
  for (let j = 0; j <= SAMPLE_ROWS; j++) {
    for (let i = 0; i <= SAMPLE_COLS; i++) {
      const x = (i / SAMPLE_COLS) * w
      const y = (j / SAMPLE_ROWS) * h
      if (geo) {
        const ll = geo.unproject(x, y)
        if (ll) pts.push(ll)
        continue
      }
      let ll, rt
      try { ll = map.unproject([x, y]) } catch { continue }
      if (!ll || !Number.isFinite(ll.lng) || !Number.isFinite(ll.lat)) continue
      try { rt = map.project(ll) } catch { continue }
      if (!rt || Math.abs(rt.x - x) + Math.abs(rt.y - y) > PROJ_TOLERANCE) continue
      pts.push(ll)
    }
  }
  return pts
}

// Is an event lng/lat on the visible face and on screen? (same test the ping
// renderer uses)
function eventVisible(map, e, w, h, tolDeg) {
  let pt, rt
  try { pt = map.project([e.lng, e.lat]) } catch { return false }
  if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return false
  if (pt.x < 0 || pt.y < 0 || pt.x > w || pt.y > h) return false
  try { rt = map.unproject([pt.x, pt.y]) } catch { return false }
  if (!rt || !Number.isFinite(rt.lng) || !Number.isFinite(rt.lat)) return false
  const dLng = Math.abs(((rt.lng - e.lng + 540) % 360) - 180)
  const cosLat = Math.max(0.05, Math.cos((e.lat * Math.PI) / 180))
  return dLng * cosLat + Math.abs(rt.lat - e.lat) <= tolDeg
}

const COMPASS_8 = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']

function vectorFacts(def, field, samples) {
  let n = 0
  let sumU = 0
  let sumV = 0
  let sumSpd = 0
  let max = 0
  for (const ll of samples) {
    const s = field.sample(ll.lng, ll.lat)
    if (!s) continue
    n++
    sumU += s.u
    sumV += s.v
    sumSpd += s.speed
    if (s.speed > max) max = s.speed
  }
  if (!n) return null
  const toward = (Math.atan2(sumU / n, sumV / n) * 180) / Math.PI
  const meanDir = COMPASS_8[Math.round((((toward + 360) % 360) / 45)) % 8]
  return {
    id: def.id,
    name: def.name,
    unit: 'm/s',
    mean: sig(sumSpd / n),
    max: sig(max),
    // Wind is reported by its FROM direction, currents by TOWARD — hand the
    // narrator the correctly-conventioned word.
    dominant_direction: def.id === 'wind'
      ? `from the ${COMPASS_8[Math.round(((toward + 180 + 360) % 360) / 45) % 8]}`
      : `toward the ${meanDir}`,
    sampled_points: n,
  }
}

function scalarFacts(def, field, samples) {
  let n = 0
  let sum = 0
  let min = Infinity
  let max = -Infinity
  const catCounts = def.words ? new Array(def.words.length).fill(0) : null
  for (const ll of samples) {
    const s = field.sampleScalar(ll.lng, ll.lat)
    if (!s) continue
    n++
    sum += s.value
    if (s.value < min) min = s.value
    if (s.value > max) max = s.value
    if (catCounts) {
      const idx = def.words.findIndex((w) => s.value < w.max)
      catCounts[idx === -1 ? def.words.length - 1 : idx]++
    }
  }
  if (!n) return null
  const out = {
    id: def.id,
    name: def.name,
    unit: def.id === 'waves' ? 'm' : ['aerosol', 'smoke', 'dust'].includes(def.id) ? ' AOD' : '°C',
    mean: sig(sum / n),
    min: sig(min),
    max: sig(max),
    sampled_points: n,
  }
  if (catCounts) {
    const top = catCounts
      .map((c, i) => ({ label: def.words[i].label, pct: Math.round((c / n) * 100) }))
      .filter((x) => x.pct >= 10)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 3)
    out.area_breakdown = top
  }
  return out
}

function quakeFacts(def, payload, map, w, h, tolDeg) {
  const inView = payload.events.filter((e) => eventVisible(map, e, w, h, tolDeg))
  if (!inView.length) return { id: def.id, name: def.name, in_view: 0, global_count: payload.events.length }
  const biggest = inView.reduce((a, b) => (b.mag > a.mag ? b : a))
  return {
    id: def.id,
    name: def.name,
    in_view: inView.length,
    global_count: payload.events.length,
    max_magnitude: round(biggest.mag, 1),
    biggest_quake: {
      magnitude: round(biggest.mag, 1),
      place: biggest.place,
      days_ago: round((Date.now() - biggest.time) / 8.64e7, 1),
      depth_km: Math.round(biggest.depth),
    },
    window: 'past 30 days, M3.0+',
  }
}

function hotspotFacts(def, payload, map, w, h, tolDeg) {
  const meta = payload.meta
  const inView = payload.events.filter((e) => eventVisible(map, e, w, h, tolDeg))
  const detections = inView.reduce((s, e) => s + e.n, 0)
  const maxFrp = inView.reduce((m, e) => Math.max(m, e.frp), 0)
  const out = {
    id: def.id,
    name: def.name,
    clusters_in_view: inView.length,
    detections_in_view: detections,
    global_detections: meta.detections,
    pct_of_global: meta.detections ? Math.round((detections / meta.detections) * 100) : null,
    max_fire_power_mw: sig(maxFrp),
    window: 'last 24 h, VIIRS satellite, ≥nominal confidence',
  }
  // GFAS-style emission estimate from summed fire radiative power (Wooster
  // 2005: ~0.368 kg dry biomass per MJ; savanna-typical ~1.65 kg CO₂ per kg
  // biomass; ÷2 approximates sustained power from ~2 daily overpasses).
  // Deliberately rough (±~50%) but the same physics GFAS/Copernicus uses —
  // it turns "lots of fires" into "this much carbon".
  const frpSum = inView.reduce((s, e) => s + (e.frps || 0), 0)
  if (frpSum > 0 && meta.frp_sum_mw) {
    const sustainedMW = frpSum / 2
    const co2PerDay = (sustainedMW * 86400 * 0.368 * 1.65) / 1000 // tonnes
    out.observed_fire_power_in_view_mw = sig(frpSum)
    out.est_co2_tonnes_per_day = sig(co2PerDay, 2)
    out.pct_of_global_fire_power = Math.round((frpSum / meta.frp_sum_mw) * 100)
    out.emission_estimate_method =
      'FRP-based, GFAS-style (Wooster 2005 coefficients), rough ±50%; assumes ~2 satellite overpasses/day'
  }
  return out
}

/**
 * Build the facts object for the current view.
 * activeLayers: [{ def, payload, meta }] for layers that are ON with data OK.
 */
export function buildViewFacts(map, activeLayers) {
  // The canvas is the surface unproject/project operate in — measure it, not
  // the container (they can disagree, e.g. before a resize settles).
  const w = map.getCanvas().clientWidth || map.getContainer().clientWidth
  const h = map.getCanvas().clientHeight || map.getContainer().clientHeight
  const c = map.getCenter()
  const zoom = map.getZoom()
  const samples = visibleSamples(map, w, h)
  const degPerPx = 360 / (512 * Math.pow(2, zoom))
  const tolDeg = degPerPx * 12 + 0.05

  const layers = []
  for (const { def, payload, meta } of activeLayers) {
    let f = null
    if (def.kind === 'vector') f = vectorFacts(def, payload, samples)
    else if (def.kind === 'scalar') f = scalarFacts(def, payload, samples)
    else if (def.id === 'quakes') f = quakeFacts(def, payload, map, w, h, tolDeg)
    else if (def.id === 'hotspots') f = hotspotFacts(def, payload, map, w, h, tolDeg)
    else if (def.kind === 'raster') f = { id: def.id, name: def.name, note: 'satellite vegetation-loss alerts from the past 30 days are overlaid; no aggregate statistics available client-side' }
    if (!f) continue
    f.source = def.sourceName
    if (meta && def.stamp) f.data_stamp = def.stamp(meta)
    if (meta?.tape) {
      f.frame_time_utc = new Date(meta.valid_ms).toISOString().slice(0, 16) + 'Z'
      f.frame_note = meta.live
        ? 'forecast valid now'
        : 'REPLAY: this layer shows an archived analysis frame from frame_time_utc, not current conditions — describe it as what was happening then'
    }
    layers.push(f)
  }

  return {
    v: 1,
    // Hour-rounded UTC time — enough for seasonal/diurnal context, stable
    // for caching.
    time_utc: new Date(Math.floor(Date.now() / 3.6e6) * 3.6e6).toISOString().slice(0, 13) + ':00Z',
    view: {
      // Hemisphere-lettered label so the narrator can't misread E/W signs.
      center_label: `${Math.abs(round(c.lat, 0))}°${c.lat < 0 ? 'S' : 'N'}, ${Math.abs(round(c.lng, 0))}°${c.lng < 0 ? 'W' : 'E'}`,
      center_lat: round(c.lat, 0),
      center_lng: round(c.lng, 0),
      zoom: Math.round(zoom * 2) / 2,
      approx_view_span_deg: sig(Math.min(360, degPerPx * Math.max(w, h)), 2),
    },
    layers,
  }
}
