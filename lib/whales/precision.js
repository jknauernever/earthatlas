/**
 * How precisely a whale report is placed, and how many whales it stands for — one rule shared by the
 * /shiptraffic overlap job (scripts/shiptraffic/overlap-bake.mjs) and the page (src/shiptraffic/), so the
 * map, the popups and the scores always agree. Plain JS (Node + browser).
 *
 * Josh 2026-10-17: the overlap score counts WHALES, not reports (14 humpbacks in one spot matters), without
 * counting the same animals twice, and a report placed only roughly spreads its whales over the area it could be in.
 */

/** Metres a report's true position may be from where it's drawn. Rounded to a 0.1° grid (≈ 11 × 7 km here)
 *  = ±0.05°; otherwise the source's stated accuracy when it is coarse (≥ 1.5 km); else 0 (treated as exact). */
export function locationRadiusM(s) {
  const onTenth = (v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-6
  if (onTenth(s.lat) && onTenth(s.lng)) return Math.round(0.05 * 111320 * Math.cos((s.lat * Math.PI) / 180)) // half a 0.1° cell, east–west
  const acc = Number(s.accuracy_m)
  return Number.isFinite(acc) && acc >= 1500 ? acc : 0
}

export const APPROX_M = 1500 // at or beyond this, a report is "approximate": no close passes, its whales spread out
export const TOO_VAGUE_M = 10000 // beyond this (e.g. iNaturalist's obscured locations) it can't tell one route from another: shown, not scored

/** The box a report's whales spread over, as half-sizes in degrees: a 0.1°-rounded point → its 0.1° box;
 *  a coarse stated accuracy → ±that radius; null when the report is placed precisely (one cell) or too vaguely. */
export function spreadBox(s) {
  const r = locationRadiusM(s)
  if (r < APPROX_M || r > TOO_VAGUE_M) return null
  const onTenth = (v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-6
  if (onTenth(s.lat) && onTenth(s.lng)) return { dLat: 0.05, dLng: 0.05 }
  return { dLat: r / 111320, dLng: r / (111320 * Math.cos((s.lat * Math.PI) / 180)) }
}

/** Whales one report stands for: its count (largest of min/max), else 1; capped so one typo can't swamp a region. */
export function whalesIn(s) {
  const c = s.count
  const n = c ? Math.max(Number(c.min) || 0, Number(c.max) || 0) : 0
  return Math.min(200, n > 0 ? n : 1)
}

const R_KM = 2      // same group: within 2 km …
const R_S = 2 * 3600 // … and 2 hours (date-only reports: the same day)

function km(a, b) {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180)
  return Math.hypot((a.lng - b.lng) * k * 111.32, (a.lat - b.lat) * 111.32)
}

/**
 * Group the reports of the same animals: same species, same day, within 2 km and 2 h. Each group counts
 * max(HappyWhale individuals identified, largest count any one other report gave) — five people reporting one
 * pod is one pod; ten humpbacks photo-identified on one trip are ten whales. The same HappyWhale individual on
 * the same day counts once. Returns [{ members: [sighting], whales, species, approxM }].
 */
export function groupSightings(sightings) {
  const seenInd = new Set()
  const list = []
  for (const s of sightings) {
    const ind = s.individual?.id
    if (s.source === 'happywhale' && ind) {
      const k = `${ind}|${s.observed_date}`
      if (seenInd.has(k)) continue
      seenInd.add(k)
    }
    list.push(s)
  }
  const sp = (s) => String(s.taxon?.id ?? s.taxon?.reported_as ?? '?')
  const t = (s) => (s.time_precision === 'exact' && s.observed_at ? Date.parse(s.observed_at) / 1000 : null)
  const groups = []
  const byKey = new Map() // species|day → groups
  for (const s of list.sort((a, b) => String(a.observed_at || a.observed_date).localeCompare(String(b.observed_at || b.observed_date)))) {
    const key = `${sp(s)}|${s.observed_date}`
    const cand = byKey.get(key) || []
    const ts = t(s)
    let g = cand.find((g0) => g0.members.some((m) => {
      if (km(m, s) > R_KM) return false
      const tm = t(m)
      return ts == null || tm == null || Math.abs(ts - tm) <= R_S
    }))
    if (!g) {
      g = { members: [], species: s.taxon?.common || s.taxon?.scientific || s.taxon?.reported_as || 'Whale' }
      cand.push(g)
      byKey.set(key, cand)
      groups.push(g)
    }
    g.members.push(s)
  }
  for (const g of groups) {
    let hw = 0, other = 0
    for (const m of g.members) {
      if (m.source === 'happywhale') hw += whalesIn(m)
      else other = Math.max(other, whalesIn(m))
    }
    g.whales = Math.max(hw, other)
    g.approxM = Math.min(...g.members.map(locationRadiusM))
  }
  return groups
}

/**
 * Where a precisely placed group counts (Josh 2026-10-17): every ~1 km square whose center is within REACH_M of
 * any of its reports — a pod watched along 5 km of shore lights up that whole stretch, not just the square of its
 * first report. Each square counts the group's full number. `points` = [lng, lat, lng, lat, …] of its precise reports.
 */
export const REACH_M = 1000

export function nearPoints(points, lng, lat) {
  const k = Math.cos((lat * Math.PI) / 180) * 111320
  for (let p = 0; p < points.length; p += 2) {
    if (Math.hypot((points[p] - lng) * k, (points[p + 1] - lat) * 111320) <= REACH_M) return true
  }
  return false
}

/** The precise report positions of a group, deduplicated, as [lng, lat, …] rounded to 1e-5°. */
export function groupPoints(g) {
  const seen = new Set(), out = []
  for (const m of g.members) {
    if (locationRadiusM(m) >= APPROX_M) continue
    const lng = Math.round(m.lng * 1e5) / 1e5, lat = Math.round(m.lat * 1e5) / 1e5
    const key = `${lng},${lat}`
    if (!seen.has(key)) { seen.add(key); out.push(lng, lat) }
  }
  return out
}
