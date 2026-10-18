/**
 * /whalewatch time machinery (Josh 2026-10-17): where each boat was at any hour of the last 12 months, its trail of the
 * hours before, its latest position on record ("live"), and the port it ties up at overnight (its home port, from AIS).
 *
 * Times along a track: Global Fishing Watch lines baked since 2026-10-02 carry the hour of every vertex (properties.ts),
 * so those positions are exact. NOAA lines carry only their start and end (t0, t1): times in between are spread along the
 * line by distance, the same estimate /ships' hover readout marks with ≈.
 */

const R = 6371000
export function metres([x1, y1], [x2, y2]) {
  const r = Math.PI / 180, dLat = (y2 - y1) * r, dLng = (x2 - x1) * r
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(y1 * r) * Math.cos(y2 * r) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
const bearing = ([x1, y1], [x2, y2]) => {
  const r = Math.PI / 180
  const y = Math.sin((x2 - x1) * r) * Math.cos(y2 * r)
  const x = Math.cos(y1 * r) * Math.sin(y2 * r) - Math.sin(y1 * r) * Math.cos(y2 * r) * Math.cos((x2 - x1) * r)
  return (Math.atan2(y, x) / r + 360) % 360
}

/** A boat's tracks → time-ordered segments { t0, t1, c: coords, ts: seconds per vertex, exact }. */
export function buildTimeline(features) {
  const segs = []
  for (const f of features) {
    const c = f.geometry?.coordinates
    const { t0, t1, ts } = f.properties
    if (!c || c.length < 2 || !Number.isFinite(t0) || !Number.isFinite(t1)) continue
    let times
    const exact = Array.isArray(ts) && ts.length === c.length
    if (exact) times = ts.slice()
    else {
      const cum = [0]
      for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + metres(c[i - 1], c[i]))
      const L = cum[cum.length - 1] || 1
      times = cum.map((d) => t0 + ((t1 - t0) * d) / L)
    }
    segs.push({ t0: times[0], t1: times[times.length - 1], c, ts: times, exact })
  }
  segs.sort((a, b) => a.t0 - b.t0)
  return segs
}

const lerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]

/**
 * Where the boat was at time T (epoch s). Inside a track: the interpolated point, its heading, moving = true.
 * Between tracks (tied up, or out of AIS range): its last position, if that was at most `holdS` ago (moving = false).
 * → { lngLat, heading, kn (knots, moving only), at (time of the fix), moving, exact } or null.
 */
export function positionAt(segs, T, holdS = 24 * 3600) {
  if (!segs.length || T < segs[0].t0) return null
  let lo = 0, hi = segs.length - 1
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segs[mid].t0 <= T) lo = mid; else hi = mid - 1 }
  // The latest segment starting at or before T may be shorter than an earlier, longer one still running at T.
  let s = segs[lo]
  for (let i = lo; i >= Math.max(0, lo - 3); i--) if (segs[i].t0 <= T && segs[i].t1 >= T) { s = segs[i]; break }
  if (T <= s.t1) {
    const { ts, c } = s
    let i = 1
    while (i < ts.length - 1 && ts[i] < T) i++
    const span = ts[i] - ts[i - 1]
    const k = span > 0 ? Math.min(1, Math.max(0, (T - ts[i - 1]) / span)) : 1
    // Speed over this leg (exact hourly fixes) or the line's average pace (times spread by distance): knots.
    const kn = span > 0 ? metres(c[i - 1], c[i]) / span / 0.514444 : null
    return { lngLat: lerp(c[i - 1], c[i], k), heading: bearing(c[i - 1], c[i]), kn, at: T, moving: true, exact: s.exact }
  }
  // After the segment: tied up / no signal since its end.
  let last = s
  for (let i = lo; i >= Math.max(0, lo - 3); i--) if (segs[i].t1 > last.t1 && segs[i].t1 <= T) last = segs[i]
  if (T - last.t1 > holdS) return null
  const n = last.c.length
  return { lngLat: last.c[n - 1], heading: bearing(last.c[n - 2], last.c[n - 1]), at: last.t1, moving: false, exact: last.exact }
}

/** The boat's latest position on record. */
export function latestPosition(segs) {
  if (!segs.length) return null
  let last = segs[0]
  for (const s of segs) if (s.t1 > last.t1) last = s
  const n = last.c.length
  return { lngLat: last.c[n - 1], heading: bearing(last.c[n - 2], last.c[n - 1]), at: last.t1, moving: false, exact: last.exact }
}

/** The path over (T - hours, T]: one coordinate list per segment touched, ending at the position at T. */
export function trailAt(segs, T, hours = 3) {
  const from = T - hours * 3600, out = []
  for (const s of segs) {
    if (s.t1 < from || s.t0 > T) continue
    const pts = []
    for (let i = 0; i < s.c.length; i++) {
      const t = s.ts[i]
      if (t < from) {
        if (i + 1 < s.c.length && s.ts[i + 1] >= from) pts.push(lerp(s.c[i], s.c[i + 1], (from - t) / (s.ts[i + 1] - t || 1)))
        continue
      }
      if (t > T) {
        if (i > 0) pts.push(lerp(s.c[i - 1], s.c[i], (T - s.ts[i - 1]) / (t - s.ts[i - 1] || 1)))
        break
      }
      pts.push(s.c[i])
    }
    if (pts.length >= 2) out.push(pts)
  }
  return out
}

// ─── Home port ───
const localDay = (() => {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' })
  return (sec) => fmt.format(new Date(sec * 1000))
})()

/**
 * Where the boat ties up overnight: the end of its last track of each local day, the most common ~500 m spot among
 * those, named after the nearest port we hold within `maxM`. → { name, portId, lngLat, nights, days, distM } or null.
 */
export function homePort(segs, ports, maxM = 6000) {
  const lastOfDay = new Map()
  for (const s of segs) {
    const d = localDay(s.t1)
    const cur = lastOfDay.get(d)
    if (!cur || s.t1 > cur.t) lastOfDay.set(d, { t: s.t1, p: s.c[s.c.length - 1] })
  }
  if (!lastOfDay.size) return null
  const cells = new Map()
  for (const { p } of lastOfDay.values()) {
    const k = `${Math.round(p[0] / 0.005)},${Math.round(p[1] / 0.005)}`
    if (!cells.has(k)) cells.set(k, [])
    cells.get(k).push(p)
  }
  // The busiest cell plus its 8 neighbours (a marina can straddle a cell edge).
  let best = null
  for (const [k, pts] of cells) {
    const [a, b] = k.split(',').map(Number)
    let n = 0, sx = 0, sy = 0
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const q = cells.get(`${a + i},${b + j}`)
      if (q) for (const p of q) { n++; sx += p[0]; sy += p[1] }
    }
    if (!best || n > best.n || (n === best.n && pts.length > best.own)) best = { n, own: pts.length, lngLat: [sx / n, sy / n] }
  }
  let port = null, distM = Infinity
  for (const f of ports) {
    const d = metres(best.lngLat, f.geometry.coordinates)
    if (d < distM) { distM = d; port = f }
  }
  const named = port && distM <= maxM
  return { name: named ? port.properties.n : null, portId: named ? port.properties.i : null, lngLat: best.lngLat,
    nights: best.n, days: lastOfDay.size, distM: named ? Math.round(distM) : null }
}
