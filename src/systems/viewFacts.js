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

function scalarFacts(def, field, samples, center) {
  let n = 0
  let sumLat = 0
  let sumLng = 0
  let sum = 0
  let min = Infinity
  let max = -Infinity
  const catCounts = def.words ? new Array(def.words.length).fill(0) : null
  for (const ll of samples) {
    const s = field.sampleScalar(ll.lng, ll.lat)
    if (!s) continue
    n++
    sumLat += ll.lat
    sumLng += ll.lng
    // Some grids store a transformed value (bird traffic rides as √) — facts
    // are always stated in the layer's display units.
    const value = def.toValue ? def.toValue(s.value) : s.value
    sum += value
    if (value < min) min = value
    if (value > max) max = value
    if (catCounts) {
      const idx = def.words.findIndex((w) => value < w.max)
      catCounts[idx === -1 ? def.words.length - 1 : idx]++
    }
  }
  // Layers whose data covers only part of the planet (def.coverage) must tell
  // the narrator WHERE their numbers apply. Without this it spread U.S.-only
  // radar statistics across whatever the view was centred on — it described
  // "radar-detected birds crossing the Atlantic" (Josh, 2026-09-21). No data is
  // "not measured", never "zero", and never licence to describe the layer there.
  if (!n) {
    if (!def.coverage) return null
    return {
      id: def.id,
      name: def.name,
      no_data_in_view: true,
      coverage_area: def.coverage,
      coverage_note: `This layer has NO data anywhere in the current view. It only exists over: ${def.coverage}. Say that plainly and say nothing else about this layer — do not describe its phenomenon in the visible region.`,
      ...(def.factsNote ? { what_it_measures: def.factsNote } : {}),
    }
  }
  const out = {
    id: def.id,
    name: def.name,
    unit: def.unit ? def.unit : def.id === 'waves' ? 'm' : ['aerosol', 'smoke', 'dust'].includes(def.id) ? ' AOD' : '°C',
    mean: sig(sum / n),
    min: sig(min),
    max: sig(max),
    sampled_points: n,
  }
  if (def.factsNote) out.what_it_measures = def.factsNote
  if (def.coverage) {
    const share = samples.length ? n / samples.length : 0
    const centerHasData = !!(center && field.sampleScalar(center.lng, center.lat))
    const lat = sumLat / n, lng = sumLng / n
    out.coverage_area = def.coverage
    out.covered_share_of_view_pct = Math.max(1, Math.round(share * 100))
    out.view_center_has_data = centerHasData
    out.data_centroid_lng = Math.round(lng)
    out.data_located_around = `${Math.abs(Math.round(lat))}°${lat < 0 ? 'S' : 'N'}, ${Math.abs(Math.round(lng))}°${lng < 0 ? 'W' : 'E'}`
    out.coverage_note = `Every statistic for this layer describes ONLY the part of the view inside coverage_area (about ${out.covered_share_of_view_pct}% of the visible area, around ${out.data_located_around}). The rest of the view has NO measurements — not zero, unmeasured.${centerHasData ? '' : ' The view is centred OUTSIDE the data: do not describe this layer at the view centre.'} Never describe this layer's phenomenon, routes, or corridors anywhere outside coverage_area.`
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

// Climate TRACE facilities: summarized by the overlay from exactly what it
// drew (see TraceFacilitiesOverlay.summarize) — the facilities visible at this
// zoom, valued in the month on the time bar.
const SECTOR_WORDS = {
  power: 'power plants', 'fossil-fuel-operations': 'oil, gas & coal operations', manufacturing: 'heavy industry',
  'mineral-extraction': 'mines', transportation: 'airports & ports', waste: 'landfills & wastewater plants',
  agriculture: 'cattle operations', 'forestry-and-land-use': 'reservoirs',
}
function emissionsFacts(def, payload) {
  const s = payload?.overlay?.summarize?.()
  if (!s) return null
  const base = {
    id: def.id,
    name: def.name,
    what_it_measures: 'Monthly greenhouse-gas emissions of individual facilities, tonnes CO2-equivalent (100-year), ESTIMATED by Climate TRACE models from satellite and activity data — not direct measurements.',
    month_shown: s.month,
    month_note: s.clamped
      ? `The time bar is past the newest data; ${s.month} is the latest month Climate TRACE has published (it runs ~2 months behind). Say so.`
      : s.latest ? `${s.month} is the latest month published (data runs ~2 months behind real time).` : `REPLAY: values are for ${s.month}, not today.`,
  }
  if (!s.count && !s.basins) return { ...base, in_view: 0 }
  const sectors = Object.entries(s.sectors)
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, 4)
    .map(([k, v]) => ({ sector: SECTOR_WORDS[k] || k, facilities: v.n, share_of_shown_emissions_pct: Math.round((v.t / s.total) * 100) }))
  return {
    ...base,
    facilities_shown: s.count,
    sample_note: `Only the ${s.count.toLocaleString('en-US')} facilities drawn at this zoom are counted (the map shows the largest emitters first; smaller sites appear when zooming in). Totals describe these shown facilities, NOT the region's full emissions — never call them a regional or national total.`,
    shown_emissions_tonnes: sig(s.total, 3),
    by_sector: sectors,
    top_facilities: s.top.map(({ it, v }) => ({
      name: it.n,
      type: it.sub,
      country: s.countries[it.c] || it.c,
      tonnes_this_month: sig(v, 3),
      ...(it.o ? { owner: it.o } : {}),
      ...(it.q ? { estimate_confidence: it.q } : {}),
    })),
    ...(s.yoy ? {
      same_facilities_vs_year_earlier_pct: Math.round(((s.yoy.cur - s.yoy.prev) / s.yoy.prev) * 100),
      yoy_note: 'Change for the same shown facilities versus the same month a year earlier (only sites with estimates in both months).',
    } : {}),
    ...(s.basins ? {
      oil_gas_basins_shown: s.basins.n,
      basin_note: `Oil & gas basins (dashed rings) are whole-region estimates placed at a centre point, not single sites; kept separate from the facility figures. Largest shown: ${s.basins.top.it.n.replace(/_/g, ' ')} at ${sig(s.basins.top.v, 3)} t this month.`,
    } : {}),
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
    else if (def.kind === 'scalar') f = scalarFacts(def, payload, samples, c)
    else if (def.id === 'quakes') f = quakeFacts(def, payload, map, w, h, tolDeg)
    else if (def.id === 'hotspots') f = hotspotFacts(def, payload, map, w, h, tolDeg)
    else if (def.id === 'emissions') f = emissionsFacts(def, payload)
    else if (def.kind === 'raster') f = { id: def.id, name: def.name, note: 'satellite vegetation-loss alerts from the past 30 days are overlaid; no aggregate statistics available client-side' }
    if (!f) continue
    f.source = def.sourceName
    if (meta && def.stamp) f.data_stamp = def.stamp(meta)
    // Day/night where the DATA is (not where the view is centred): a layer
    // about a nocturnal phenomenon was narrated as "nocturnal migration" over
    // an 11 a.m. frame. Approximate local solar time from the data's longitude.
    if (def.nocturnal && Number.isFinite(f.data_centroid_lng)) {
      const t = new Date(meta?.tape ? meta.valid_ms : Date.now())
      const solar = (((t.getUTCHours() + t.getUTCMinutes() / 60 + f.data_centroid_lng / 15) % 24) + 24) % 24
      const hh = Math.floor(solar)
      f.local_solar_time_where_data_is = `${String(hh).padStart(2, '0')}:${String(Math.round((solar - hh) * 60) % 60).padStart(2, '0')}`
      // The UTC date is often the WRONG local date for an evening frame
      // (04:00Z on the 20th is the night of the 19th in Ohio).
      f.local_date_where_data_is = new Date(t.getTime() + (f.data_centroid_lng / 15) * 3.6e6).toISOString().slice(0, 10)
      f.daylight_where_data_is = solar >= 7 && solar < 18 ? 'DAYTIME' : solar >= 5 && solar < 7 ? 'around dawn' : solar >= 18 && solar < 20 ? 'around dusk' : 'NIGHT'
      f.day_night_note = f.daylight_where_data_is === 'DAYTIME'
        ? 'This frame is DAYTIME over the data. This phenomenon happens mostly at night, so daytime values are expected to be low — most birds are on the ground resting and feeding. Do NOT describe this frame as night-time migration in progress.'
        : 'Describe the time of day from daylight_where_data_is and the calendar date from local_date_where_data_is (the evening it began); do not derive them from the UTC time.'
    }
    delete f.data_centroid_lng
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
