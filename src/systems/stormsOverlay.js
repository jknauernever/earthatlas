/**
 * Tropical-cyclone overlay for /inmotion — the Storms layer's renderer.
 *
 * A canvas sibling of fireEventsOverlay.js. Nothing here is invented: every
 * shape on screen is geometry a warning centre published. The first version
 * drew a rotating three-armed spiral at the eye, which was neither — the arms
 * meant nothing and the fixed screen size misrepresented the storm's extent.
 * It was replaced by the advisory's own wind-field polygons, which are
 * lopsided and true, plus a still, minimum-size mark so a storm stays
 * findable on a whole-globe view.
 *
 * The one thing that DOES animate is the tracks: chevrons march along them in
 * the direction of travel, at a rate scaled by the storm's own forward speed.
 * That is motion carrying information — heading and pace — rather than
 * decoration, which is the line this file tries to hold.
 *
 * Drawn back to front, per storm:
 *   1. forecast cone      — where it might go, soft fill in its own color
 *   2. watch/warning      — the coastline people actually have to act on
 *   3. past track         — per-segment, colored by the category it HAD on
 *                           that stretch, thickening as it intensified: the
 *                           storm's whole life in one stroke
 *   4. forecast track     — dashed, ahead of the eye
 *   5. forecast points    — where it's expected to be, at each advisory step
 *   6. wind field + eye   — real 34/50/64 kt extents, then a still mark
 *
 * Geometry and facts both come from /api/storms (see docs/STORMS_API.md).
 */

import { getGlobeGeometry } from './globeGeom.js'

const MAX_DPR = 2

/** Shortest distance in pixels from a point to any segment of any run. */
function distToRuns(x, y, runs) {
  let best = Infinity
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1]
      const b = run[i]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      let t = len2 ? ((x - a.x) * dx + (y - a.y) * dy) / len2 : 0
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const d = (a.x + t * dx - x) ** 2 + (a.y + t * dy - y) ** 2
      if (d < best) best = d
    }
  }
  return Math.sqrt(best)
}

/** Ray-cast point-in-polygon over a run of {x, y} screen points. */
function pointInPolygon(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const { x: xi, y: yi } = poly[i]
    const { x: xj, y: yj } = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Plain-language name for a wind threshold, matching the legend's wording. */
export const windWord = (kt) =>
  kt >= 64 ? 'hurricane-force winds' : kt >= 50 ? 'damaging winds' : 'tropical-storm-force winds'

// Same wording as layerDefs' fmtRun ("Sep 22, 12z UTC"), defined locally on
// purpose: layerDefs imports THIS module for its colors and words, so
// importing back would close a cycle.
const fmtFixTime = (ms) => {
  const d = new Date(ms)
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${day}, ${String(d.getUTCHours()).padStart(2, '0')}z UTC`
}

/** "6:00 PM Tue", or a time derived from the advisory when none is labelled. */
export function whenLabel(f, storm) {
  if (f.when) return f.when
  if (storm.advisory_ms != null && f.tau != null) {
    return new Date(storm.advisory_ms + f.tau * 3.6e6).toLocaleString([], {
      weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
    }) + ' UTC'
  }
  return f.tau != null ? `+${f.tau} h` : null
}

// Saffir-Simpson-style scale, tuned for a dark globe. Sub-hurricane stages
// get their own cool colors so a track visibly crosses from "disturbance"
// into "hurricane" — that transition is the story on a rapid-intensification
// storm like Polo (20 kt to 140 kt in five days, 2026-09-22).
export const STORM_COLORS = {
  DB: '#94a3b8', LO: '#94a3b8', WV: '#94a3b8',
  TD: '#5ebaff', SD: '#5ebaff',
  TS: '#31e8d8', SS: '#31e8d8', STS: '#31e8d8',
  EX: '#a5b4fc', PT: '#a5b4fc', IN: '#a5b4fc',
}
// Watch vs warning is not a severity ladder — it is certainty AND lead time,
// and these are NHC's own definitions. Getting them backwards on a coastline
// where people make evacuation decisions would be the worst error this layer
// could make, so they are spelled out rather than paraphrased.
export const WW_MEANING = {
  TWA: ['Tropical storm watch', 'tropical-storm-force winds are POSSIBLE on this coast', 'generally within 48 hours'],
  TWR: ['Tropical storm warning', 'tropical-storm-force winds are EXPECTED on this coast', 'generally within 36 hours'],
  HWA: ['Hurricane watch', 'hurricane-force winds are POSSIBLE on this coast', 'generally within 48 hours'],
  HWR: ['Hurricane warning', 'hurricane-force winds are EXPECTED on this coast', 'generally within 36 hours'],
}

// Past-track segments carry the raw advisory code, not a phrase.
export const TYPE_WORDS = {
  DB: 'Disturbance', LO: 'Low', WV: 'Tropical wave',
  TD: 'Tropical depression', TS: 'Tropical storm',
  HU: 'Hurricane', MH: 'Major hurricane',
  SD: 'Subtropical depression', SS: 'Subtropical storm',
  EX: 'Post-tropical cyclone', PT: 'Post-tropical cyclone', IN: 'Inland',
}

export const CAT_COLORS = ['#31e8d8', '#ffe066', '#ffb020', '#ff7a2f', '#ff4d5e', '#d963e8']

/** Color for a stage: category wins once it's a hurricane, else the type. */
export const stageColor = (type, cat) =>
  cat > 0 ? CAT_COLORS[Math.min(5, cat)] : STORM_COLORS[type] || '#94a3b8'

/**
 * "Category 5 hurricane" / "Category 4 typhoon" / "Tropical storm" — what a
 * person in that ocean would actually call it. The Saffir-Simpson number is
 * the same everywhere, but the noun is not: the western Pacific says typhoon,
 * the Indian Ocean and Southern Hemisphere say cyclone, and calling Dujuan a
 * hurricane would be quietly wrong.
 */
export const stageWord = (typeWord, cat) => {
  if (!(cat > 0)) return typeWord || 'Tropical cyclone'
  const noun = /typhoon/i.test(typeWord || '') ? 'typhoon'
    : /cyclone/i.test(typeWord || '') ? 'cyclone'
      : 'hurricane'
  return `Category ${cat} ${noun}`
}

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgba = (hex, a) => {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${a})`
}

// Wind speed → color, on the SAME ramp the category legend uses, so a
// 64-knot shell is the same yellow as the Category 1 chip beside it. Used to
// paint the wind-field shells: the thresholds NOAA reports (34/50/64 kt) then
// read as a heat gradient from the storm's edge inward, instead of three
// identical rings you have to count.
const WIND_RAMP = [
  [34, '#31e8d8'],
  [64, '#ffe066'],
  [83, '#ffb020'],
  [96, '#ff7a2f'],
  [113, '#ff4d5e'],
  [137, '#d963e8'],
]

export function windColor(kt) {
  if (!Number.isFinite(kt)) return '#94a3b8'
  if (kt <= WIND_RAMP[0][0]) return WIND_RAMP[0][1]
  const last = WIND_RAMP[WIND_RAMP.length - 1]
  if (kt >= last[0]) return last[1]
  for (let i = 1; i < WIND_RAMP.length; i++) {
    const [k1, c1] = WIND_RAMP[i]
    if (kt > k1) continue
    const [k0, c0] = WIND_RAMP[i - 1]
    const t = (kt - k0) / (k1 - k0)
    const a = hexToRgb(c0)
    const b = hexToRgb(c1)
    const mix = a.map((v, j) => Math.round(v + (b[j] - v) * t))
    return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`
  }
  return last[1]
}

// ─── Wind-field flow ────────────────────────────────────────────────────────
//
// Particles that circulate inside a storm's published wind field. Everything
// steering them is from the advisory or from settled physics — this is a
// faithful schematic of what NOAA reported, not a simulation and not
// decoration:
//
//   direction  Coriolis. Cyclones turn counterclockwise north of the equator
//              and clockwise south of it. Not a style choice.
//   speed      the quadrant radii themselves. A particle between the 50- and
//              64-knot rings is in air the advisory says is moving 50–64 kt,
//              and inside the 64-knot ring it runs at the storm's reported
//              maximum sustained wind.
//   shape      the same lopsided quadrant radii the shells are drawn from, so
//              the flow fills the real footprint and thins where the wind
//              genuinely doesn't reach.
//   drift      the storm's own forward motion, when the advisory publishes
//              it. This is why the right-front quadrant is the dangerous one
//              in the northern hemisphere, and it shows up on screen for free.
//
// What is NOT drawn, because it isn't published: rainbands, eyewall
// structure, and the radius of maximum wind. Inside the 64-knot ring the
// speed is simply the reported maximum, with no invented peak location.

// Surface inflow across the boundary layer — air spirals IN toward the low,
// it doesn't orbit cleanly. ~20° is the textbook open-ocean value.
const INFLOW_DEG = 20

// Settled on with Josh over a run of side-by-side sketches. The combination
// matters: long tails need low turbulence (a wobbly long tail is noise, a
// smooth one is a vortex arm) and small heads (big heads at this density read
// as a swarm of comets and bury the swirl).
const FLOW_TAIL = 28      // history points per particle — the vortex length
const FLOW_HEAD = 1.6     // px; deliberately subtle, the tail dominates
const FLOW_PER_PX = 4.5   // particles per px of field radius
const FLOW_MAX = 650      // per storm, so a full screen stays affordable
// Presentation gets louder as a storm shrinks on screen; its GEOMETRY never
// changes. The wind field is drawn at true scale at every zoom, because the
// width of the field is the datum — an earlier version inflated small storms
// to a minimum size and that is exactly the kind of lie this layer exists not
// to tell. What scales instead is how many sprites fill the field and how
// fast they move, so a Category 5 still reads as a bright, obviously spinning
// thing when it is only a dozen pixels across.
// Calibrated against zoom 6, where Josh signed off on the look: "the sprites
// look PERFECT at 6 z — good density, the streaks, colors". A storm's wind
// field is ~120 px of radius there, so that is the reference size, and the
// boosts below exist to carry that same CHARACTER down to smaller zooms
// rather than letting it thin away. At the reference every boost is 1.0, so
// the approved appearance is reproduced exactly.
const FLOW_REF_PX = 120
const FLOW_DENSITY_BOOST = 3.5 // max × particles-per-px on a small storm
const FLOW_TIME_BOOST = 3      // max × circulation rate on a small storm
// Streak length in pixels goes as `speed × field radius × tail points`, so
// softening the speed ramp shortened the streaks as a side effect. Tail
// points are the lever that buys them back WITHOUT spinning the storm faster,
// and they are nearly free: tails are stroked as FLOW_RUNS batched runs, so a
// longer tail costs lineTo calls, not stroke calls.
const FLOW_TAIL_BOOST = 2.5    // max × history points on a small storm
// Below this field radius (roughly zoom 5) the sprites themselves get finer.
// Stroke weight is not a data claim — the field's WIDTH is — and at high
// density with long tails, full-weight strokes on a small storm clot into a
// blob. Thinning them lets the density and the streaks read instead.
// Streak length also scales with WIND SPEED, so a 55-knot tropical storm drew
// streaks a third the length of a 155-knot hurricane's and read as a fuzzy
// ball of specks rather than a slow swirl. Slow should look slow, not
// unresolved — so weak storms get proportionally more tail points back.
// Normalised so a strong hurricane is 1.0 and the approved look is untouched.
const FLOW_SLOW_REF_KT = 120
const FLOW_SLOW_BOOST = 2.5
const FLOW_TAIL_MAX = 120
const FLOW_FINE_PX = 55
const FLOW_FINE_MIN = 0.45
const FLOW_MIN_PTS = 80
const FLOW_TURB = 0.05
const FLOW_RUNS = 5       // batched strokes per tail

/** Quadrant radius (nm) for a bearing, from the four reported values. */
function radiusFor(shell, brgDeg) {
  const b = ((brgDeg % 360) + 360) % 360
  return (b < 90 ? shell.ne : b < 180 ? shell.se : b < 270 ? shell.sw : shell.nw) || 0
}

/**
 * Wind at a point near the eye, in nautical miles east/north of it.
 * @returns {{kt:number, brg:number}|null} null where the advisory reports nothing.
 */
function windAt(v, xNm, yNm) {
  const r = Math.hypot(xNm, yNm)
  const brg = (Math.atan2(xNm, yNm) * 180) / Math.PI
  const shells = v.shells || []
  if (!shells.length) return null

  // Knots as a function of radius, through the reported rings for this
  // quadrant. Beyond the 34-kt radius the wind decays; there is no published
  // figure out there, so particles fade rather than claim a speed.
  const knots = []
  for (const sh of shells) {
    const rad = radiusFor(sh, brg)
    if (rad > 0) knots.push([rad, sh.kt])
  }
  if (!knots.length) return null
  knots.sort((a, b) => a[0] - b[0]) // tightest ring (strongest wind) first

  const rInner = knots[0][0]
  const rOuter = knots[knots.length - 1][0]
  let kt
  if (r <= rInner) {
    // Inside the strongest reported ring, ramp from that ring's threshold up
    // to the storm's reported maximum sustained wind at the centre. BOTH ends
    // are published numbers; only the shape of the rise between them is an
    // assumption, and it is a mild one. What is deliberately NOT drawn is a
    // calm eye: a real cyclone peaks at the eyewall and quiets inside it, but
    // NHC publishes no radius of maximum wind, so a calm hole would be a
    // shape invented to look convincing. Josh's rule — if we don't know the
    // shape of the eye, don't pretend.
    const base = knots[0][1]
    kt = base + (1 - r / rInner) * (Math.max(base, v.kt_max || base) - base)
  } else if (r >= rOuter) {
    if (r > rOuter * 1.25) return null
    kt = knots[knots.length - 1][1] * (1 - (r - rOuter) / (rOuter * 0.25)) * 0.75
  } else {
    let i = 0
    while (i < knots.length - 1 && knots[i + 1][0] < r) i++
    const [r0, k0] = knots[i]
    const [r1, k1] = knots[i + 1]
    kt = k0 + ((r - r0) / Math.max(1e-6, r1 - r0)) * (k1 - k0)
  }
  if (!(kt > 0)) return null

  // Tangential, turned inward by the inflow angle. Sign is the hemisphere.
  const sign = v.lat >= 0 ? -1 : 1
  return { kt, brg: brg + sign * (90 + INFLOW_DEG) }
}

export class StormsOverlay {
  constructor(map, canvas, storms) {
    this.map = map
    this.canvas = canvas
    this.storms = storms || []
    this.visible = true
    this._destroyed = false
    this._ctx = canvas.getContext('2d')
    this._drawn = [] // { s, cx, cy, r } for hit tests
    this._t0 = performance.now()
    this._t = null // replay cursor; null = live
    this._flow = new Map() // storm id → circulating wind particles
    this._lastMs = performance.now()

    // Shapes are cheap (a handful of storms), so this repaints on every move
    // rather than freezing the last frame under a CSS transform the way the
    // heavier overlays do.
    this._onMove = () => this._paint()
    this._onResize = () => this._paint()
    // Hover is read straight off the map's own mouse events and kept in a
    // plain field — deliberately NOT React state, which would re-render the
    // whole app on every mouse move. The next animation frame picks it up.
    this._hover = null
    this._onMouseMove = (e) => { this._hover = { x: e.point.x, y: e.point.y } }
    this._onMouseOut = () => { this._hover = null }
    map.on('move', this._onMove)
    map.on('moveend', this._onMove)
    map.on('resize', this._onResize)
    map.on('mousemove', this._onMouseMove)
    map.on('mouseout', this._onMouseOut)

    // Paint once immediately, THEN start the loop. The loop skips hidden
    // documents to save battery, but that must never mean "draw nothing":
    // requestAnimationFrame is throttled or parked whenever the page isn't
    // visible (a background tab, an unfocused pane), so a renderer that only
    // paints inside its loop shows a blank canvas with no error anywhere.
    // This cost an hour the first time. Every state change repaints on its
    // own for the same reason.
    this._paint()
    const loop = () => {
      if (this._destroyed) return
      if (this.visible && !document.hidden) this._paint()
      this._raf = requestAnimationFrame(loop)
    }
    this._raf = requestAnimationFrame(loop)
  }

  /**
   * Replay cursor, driven by the shared transport bar (SystemsApp's event
   * timeline effect, same path the earthquake tape uses).
   *
   * `mode === 'last24'` is the controller's way of saying "parked at Now", so
   * that restores the live picture. Any other time puts the layer into
   * history: see _viewOf for what that means and, importantly, what it
   * refuses to draw.
   */
  setTime(t, mode = 'day') {
    const next = mode === 'last24' ? null : t
    if (next === this._t) return
    this._t = next
    this._paint()
  }

  /**
   * A storm as it was at the replay cursor, or null if it did not exist yet.
   *
   * The rule that matters: **the forecast is a product of the present.** The
   * cone, the forecast track and the forecast dots all describe what
   * forecasters expect from NOW, so replaying to last Sunday and drawing
   * today's cone would be showing a prediction that did not exist at the time
   * the bar is pointing at. In history those are dropped entirely, along with
   * the coastal watches and warnings, which are equally a statement about
   * now. What remains is only what was observed and published then: position,
   * intensity, category, and the wind field measured at that fix.
   */
  _viewOf(s) {
    const t = this._t
    if (t == null) {
      return {
        lat: s.lat, lng: s.lng, cat: s.cat || 0, type: s.type, type_word: s.type_word,
        mph: s.mph, mb: s.mb, kt_max: s.kt, historic: false,
        shells: s.wind_field || [], pastSegs: s.past_track || [],
        forecast: s.forecast || [], forecastTrack: s.forecast_track || [],
        cone: s.cone || [], watches: s.watches || [],
      }
    }
    // JTWC's warning product carries no track history at all, so its storms
    // simply cannot be replayed. Drawing them frozen at their present
    // position while everything else moved would be a lie about the past.
    const fixes = (s.past || []).filter((p) => p.at_ms != null && p.at_ms <= t)
    if (!fixes.length) return null
    const now = fixes[fixes.length - 1]
    const segs = []
    for (let i = 1; i < fixes.length; i++) {
      const a = fixes[i - 1]
      const b = fixes[i]
      segs.push({ type: b.type, cat: b.cat || 0, lines: [[[a.lng, a.lat], [b.lng, b.lat]]] })
    }
    // The wind field published at (or most recently before) this fix. Only
    // accepted within one advisory cycle, so an early disturbance doesn't
    // borrow shells measured hours later.
    let shells = []
    for (const fr of s.past_wind || []) {
      if (fr.at_ms <= t && t - fr.at_ms <= 6 * 3.6e6) shells = fr.shells
    }
    return {
      lat: now.lat, lng: now.lng, cat: now.cat || 0, type: now.type,
      type_word: TYPE_WORDS[now.type] || now.type_word,
      mph: now.kt != null ? Math.round(now.kt * 1.15078) : null,
      mb: now.mb, kt_max: now.kt, historic: true, at_ms: now.at_ms,
      shells, pastSegs: segs,
      forecast: [], forecastTrack: [], cone: [], watches: [],
    }
  }

  setStorms(storms) {
    this.storms = storms || []
    this._paint()
  }

  setVisible(visible) {
    this.visible = visible
    if (!visible) { this._clear(); this._drawn = [] } else this._paint()
  }

  destroy() {
    this._destroyed = true
    cancelAnimationFrame(this._raf)
    this.map.off('move', this._onMove)
    this.map.off('moveend', this._onMove)
    this.map.off('resize', this._onResize)
    this.map.off('mousemove', this._onMouseMove)
    this.map.off('mouseout', this._onMouseOut)
    this._clear()
  }

  /**
   * What is under a screen point, in priority order.
   *
   * The whole point of the Storms layer is that a cyclone is several distinct
   * published things stacked on one another — an eye, a wind field, a track
   * it has already walked, a forecast, and a cone of uncertainty. A hit test
   * that only answered "which storm" threw away the interesting half: a click
   * inside the cone could not say it was inside the cone. This answers WHICH
   * PART, so both the hover tooltip and the click popup can speak precisely.
   *
   * Priority runs most-specific to least: a forecast dot beats the cone it
   * sits inside, and the tightest wind shell beats the loosest.
   */
  _probe(x, y) {
    for (const d of this._drawn) {
      for (const fp of d.fcstPts) {
        if ((fp.x - x) ** 2 + (fp.y - y) ** 2 <= 11 * 11) {
          return { storm: d.s, v: d.v, part: 'forecast', detail: fp.f }
        }
      }
    }
    for (const d of this._drawn) {
      const lim = Math.max(20, d.r + 7)
      if ((d.cx - x) ** 2 + (d.cy - y) ** 2 <= lim * lim) {
        return { storm: d.s, v: d.v, part: 'eye', detail: null }
      }
    }
    for (const d of this._drawn) {
      for (const pp of d.pastPts) {
        if ((pp.x - x) ** 2 + (pp.y - y) ** 2 <= 9 * 9) {
          return { storm: d.s, v: d.v, part: 'past', detail: pp.p }
        }
      }
    }
    // The track lines themselves. More specific than the shell or cone they
    // sit inside, so they're tested first: hovering the line between two
    // forecast dots should talk about the track, not the cone around it.
    const LINE_PX = 7
    // Coastal watches and warnings outrank every other line. They're thin,
    // they sit on a busy coastline, and they're the only thing here that
    // tells somebody to do something.
    for (const d of this._drawn) {
      for (const wh of d.watches) {
        if (distToRuns(x, y, wh.runs) <= LINE_PX + 2) {
          return { storm: d.s, v: d.v, part: 'watch', detail: wh.w }
        }
      }
    }
    for (const d of this._drawn) {
      if (d.fcstRuns.length && distToRuns(x, y, d.fcstRuns) <= LINE_PX) {
        return { storm: d.s, v: d.v, part: 'fcstline', detail: null }
      }
      for (const ps of d.pastSegs) {
        if (distToRuns(x, y, ps.runs) <= LINE_PX) {
          return { storm: d.s, v: d.v, part: 'pastline', detail: ps.seg }
        }
      }
    }

    // Wind shells: strongest threshold that contains the point.
    let bestShell = null
    for (const d of this._drawn) {
      for (const sh of d.shells) {
        if (sh.polys.some((poly) => pointInPolygon(x, y, poly))) {
          if (!bestShell || (sh.kt || 0) > (bestShell.detail.kt || 0)) {
            bestShell = { storm: d.s, v: d.v, part: 'wind', detail: sh }
          }
        }
      }
    }
    if (bestShell) return bestShell
    for (const d of this._drawn) {
      if (d.conePolys.some((poly) => pointInPolygon(x, y, poly))) {
        return { storm: d.s, v: d.v, part: 'cone', detail: null }
      }
    }
    return null
  }

  /** Tooltip lines for a probe result — the same words the popup will use. */
  _hoverLines(hit) {
    const s = hit.storm
    const name = s.name
    if (hit.part === 'forecast') {
      const f = hit.detail
      return [
        `${name} — forecast`,
        whenLabel(f, s),
        `${stageWord(f.type_word || s.type_word, f.cat)}${f.kt != null ? ` · ${Math.round(f.kt * 1.15078)} mph` : ''}`,
      ].filter(Boolean)
    }
    if (hit.part === 'past') {
      const p = hit.detail
      return [
        `${name} — where it was`,
        p.at_ms ? fmtFixTime(p.at_ms) : null,
        `${stageWord(p.type_word, p.cat)}${p.kt != null ? ` · ${Math.round(p.kt * 1.15078)} mph` : ''}`,
      ].filter(Boolean)
    }
    if (hit.part === 'watch') {
      const m = WW_MEANING[hit.detail.code]
      return m ? [`${name} — ${m[0].toLowerCase()}`, m[1], m[2]] : [`${name} — ${hit.detail.word}`]
    }
    if (hit.part === 'fcstline') {
      const last = s.forecast?.[s.forecast.length - 1]
      return [
        `${name} — forecast track`,
        'the centre is forecast to travel along this line',
        last ? `through ${whenLabel(last, s) || `+${last.tau} h`}` : null,
      ].filter(Boolean)
    }
    if (hit.part === 'pastline') {
      const seg = hit.detail
      return [
        `${name} — past track`,
        'the centre actually passed along here',
        `it was a ${stageWord(TYPE_WORDS[seg.type] || seg.type, seg.cat).toLowerCase()} on this stretch`,
      ]
    }
    if (hit.part === 'wind') {
      const kt = hit.detail.kt
      return [
        `${name} — wind field`,
        `${windWord(kt)} reach here`,
        `${Math.round(kt * 1.15078)} mph or stronger`,
      ]
    }
    if (hit.part === 'cone') {
      return [
        `${name} — forecast cone`,
        `inside the ${s.cone_days ? `${s.cone_days}-day ` : ''}track forecast`,
        'the centre could pass through here',
      ]
    }
    const v = hit.v || s
    return [
      v.historic ? `${name} — ${fmtFixTime(v.at_ms)}` : `${name} — now`,
      stageWord(v.type_word, v.cat),
      `${v.mph != null ? `${v.mph} mph` : 'intensity not reported'}${v.mb != null ? ` · ${v.mb} mb` : ''}`,
    ]
  }

  /**
   * Draw and advance the circulating wind particles for one storm.
   *
   * Particles live in nautical miles relative to the eye, so they follow the
   * storm on a spinning globe without re-deriving anything, and are projected
   * only at draw time. They are skipped entirely when the wind field is too
   * small on screen to read — at whole-globe zoom an 80-nautical-mile field
   * is a couple of pixels, and filling it with motion would be noise
   * pretending to be information.
   */
  _drawFlow(ctx, s, v, eye, dt, pxPerNm) {
    const shells = v.shells || []
    if (!shells.length || !(pxPerNm > 0)) return false

    let rMaxNm = 0
    for (const sh of shells) rMaxNm = Math.max(rMaxNm, sh.ne || 0, sh.se || 0, sh.sw || 0, sh.nw || 0)
    const rPx = rMaxNm * pxPerNm
    if (!(rMaxNm > 0) || rPx < 7) return false

    // How much louder presentation has to get for this storm to read the way
    // the reference does. 1.0 at the reference size, rising as it shrinks.
    const small = Math.max(1, FLOW_REF_PX / Math.max(6, rPx))
    const densityBoost = Math.min(FLOW_DENSITY_BOOST, small)
    // Angular speed is the same at every zoom, but at twelve pixels across
    // that reads as stationary — a whole outer-band orbit takes half a minute.
    // Spinning small storms faster is presentation, not geometry: the field
    // keeps its true width, the air inside it just moves more visibly.
    // Square root, not linear: scaling speed straight off the size ratio hit
    // 5× by zoom 3 and span like a pinwheel. The root gives a much gentler
    // ramp — about 2.8× at zoom 3 instead of 5× — and still lands exactly on
    // 1.0 at the reference size, so the approved look is untouched.
    const timeBoost = Math.min(FLOW_TIME_BOOST, Math.sqrt(small))
    // Same root curve as the speed, so the two stay in step and the streak
    // recovers to roughly its reference length in pixels at every zoom.
    // Floored at 1: this only ever LENGTHENS a slow storm's tail. Without the
    // floor a 155-knot hurricane got 120/155 = 0.77 and its tail shrank from
    // 28 points to 22, quietly moving the one look that was signed off.
    const slowBoost = Math.max(1, Math.min(
      FLOW_SLOW_BOOST,
      FLOW_SLOW_REF_KT / Math.max(30, v.kt_max || FLOW_SLOW_REF_KT),
    ))
    const tailN = Math.min(
      FLOW_TAIL_MAX,
      Math.round(FLOW_TAIL * Math.min(FLOW_TAIL_BOOST, Math.sqrt(small)) * slowBoost),
    )
    // 1.0 at and above ~zoom 5, tapering to FLOW_FINE_MIN below it.
    const fine = Math.max(FLOW_FINE_MIN, Math.min(1, rPx / FLOW_FINE_PX))
    const headPx = FLOW_HEAD * fine

    let st = this._flow.get(s.id)
    if (!st) { st = { pts: [] }; this._flow.set(s.id, st) }

    // Density as a RATIO — particles per pixel of drawn field radius — so the
    // texture stays consistent whether the storm is at true scale or held at
    // the floor. Capped because tails are 28 segments each.
    const want = Math.min(FLOW_MAX, Math.max(FLOW_MIN_PTS, Math.round(rPx * FLOW_PER_PX * densityBoost)))
    if (st.pts.length > want) st.pts.length = want

    const spawn = () => {
      for (let k = 0; k < 10; k++) {
        const ang = Math.random() * Math.PI * 2
        const rr = Math.sqrt(Math.random()) * rMaxNm * 1.05
        const x = Math.sin(ang) * rr
        const y = Math.cos(ang) * rr
        if (windAt(v, x, y)) {
          // Life shortens as the circulation speeds up, so a particle still
          // covers the same share of the field — which is what keeps the
          // streaks the same LENGTH IN PIXELS at every zoom.
          return { x, y, age: Math.random() * 2.5 / timeBoost,
            life: (2.2 + Math.random() * 1.8) / timeBoost,
            gust: 0.6 + Math.random() * 1.0, hist: [[x, y, 34]] }
        }
      }
      return null
    }
    while (st.pts.length < want) { const np = spawn(); if (!np) break; st.pts.push(np) }

    // Storm time runs fast: at real speed a 100-knot particle needs an hour to
    // cross 100 nm, which reads as a still image. The one presentation number
    // here, and a uniform one — every particle is sped up by the same factor,
    // so relative speeds stay honest.
    const TIME_SCALE = 2100 * timeBoost
    const drift = (v.historic || s.move_dir == null || s.move_kt == null)
      ? null : { brg: s.move_dir, kt: s.move_kt }

    // Particles live in nautical miles around the eye and are placed by simple
    // screen offset from the projected eye, NOT by projecting every point's
    // lng/lat. At 650 particles × 28 history points that removed about
    // eighteen thousand projections per frame, and it's what lets the storm be
    // drawn out of scale at all.
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let i = 0; i < st.pts.length; i++) {
      const p = st.pts[i]
      if (!p) { st.pts[i] = spawn(); continue }
      const w = windAt(v, p.x, p.y)
      if (!w) { st.pts[i] = spawn(); continue }

      const rad = (w.brg * Math.PI) / 180
      let vx = Math.sin(rad) * w.kt
      let vy = Math.cos(rad) * w.kt
      // A small random kick. Storms are not laminar; without it the arms look
      // machined. Texture, not a data claim, kept low so the spiral reads.
      vx += (Math.random() - 0.5) * w.kt * FLOW_TURB
      vy += (Math.random() - 0.5) * w.kt * FLOW_TURB
      if (drift) {
        const dr = (drift.brg * Math.PI) / 180
        vx += Math.sin(dr) * drift.kt
        vy += Math.cos(dr) * drift.kt
      }
      const stepNm = (dt / 3600) * TIME_SCALE * p.gust
      p.x += vx * stepNm
      p.y += vy * stepNm
      p.age += dt
      // The tail follows the path actually travelled — a straight extrapolated
      // tail at this curvature just reads as a dash.
      p.hist.push([p.x, p.y, w.kt])
      while (p.hist.length > tailN) p.hist.shift()
      if (p.age > p.life) { st.pts[i] = spawn(); continue }

      const H = p.hist
      const L = H.length
      if (L < 2) continue
      const f = p.age / p.life
      const live = Math.min(1, Math.min(f * 7, (1 - f) * 2.4))

      // Colour and width both vary monotonically down the tail, so contiguous
      // runs share one stroke: 5 calls instead of 27.
      const per = Math.ceil((L - 1) / FLOW_RUNS)
      for (let r = 0; r < FLOW_RUNS; r++) {
        const q0 = 1 + r * per
        const q1 = Math.min(L - 1, q0 + per)
        if (q0 > q1) break
        const mid = Math.floor((q0 + q1) / 2)
        const tt = mid / (L - 1)
        ctx.strokeStyle = rgba(windColor(H[mid][2]), live * tt * tt * 0.95)
        ctx.lineWidth = Math.max(0.3, headPx * 2 * Math.pow(tt, 1.35))
        ctx.beginPath()
        ctx.moveTo(eye.x + H[q0 - 1][0] * pxPerNm, eye.y - H[q0 - 1][1] * pxPerNm)
        for (let q = q0; q <= q1; q++) ctx.lineTo(eye.x + H[q][0] * pxPerNm, eye.y - H[q][1] * pxPerNm)
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.arc(eye.x + p.x * pxPerNm, eye.y - p.y * pxPerNm, headPx, 0, Math.PI * 2)
      ctx.fillStyle = rgba(windColor(H[L - 1][2]), live * 0.98)
      ctx.fill()
    }
    ctx.restore()
    return true
  }

  /**
   * A thin white outline on whatever the cursor is actually on.
   *
   * Kept deliberately quiet — one hairline at partial alpha, no fill, no glow
   * beyond a faint one to lift it off a bright basemap. Its job is to confirm
   * "yes, THIS is the thing the tooltip is describing", which matters most
   * here because a storm is several overlapping shapes and the tooltip alone
   * can't tell you whether it read the 50-knot shell or the 64.
   */
  _drawHighlight(ctx, hit) {
    const d = this._drawn.find((e) => e.s === hit.storm)
    if (!d) return
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 1.5
    ctx.shadowColor = 'rgba(255,255,255,0.45)'
    ctx.shadowBlur = 5
    if (hit.part === 'forecast') {
      const fp = d.fcstPts.find((q) => q.f === hit.detail)
      if (fp) { ctx.beginPath(); ctx.arc(fp.x, fp.y, 6.5, 0, Math.PI * 2); ctx.stroke() }
    } else if (hit.part === 'past') {
      const pp = d.pastPts.find((q) => q.p === hit.detail)
      if (pp) { ctx.beginPath(); ctx.arc(pp.x, pp.y, 5.5, 0, Math.PI * 2); ctx.stroke() }
    } else if (hit.part === 'eye') {
      ctx.beginPath(); ctx.arc(d.cx, d.cy, d.r + 3.5, 0, Math.PI * 2); ctx.stroke()
    } else if (hit.part === 'watch') {
      const wh = d.watches.find((q) => q.w === hit.detail)
      if (wh) this._strokeRuns(ctx, wh.runs)
    } else if (hit.part === 'fcstline') {
      this._strokeRuns(ctx, d.fcstRuns)
    } else if (hit.part === 'pastline') {
      const ps = d.pastSegs.find((q) => q.seg === hit.detail)
      if (ps) this._strokeRuns(ctx, ps.runs)
    } else if (hit.part === 'wind') {
      this._fillRuns(ctx, hit.detail.polys)
      ctx.stroke()
    } else if (hit.part === 'cone') {
      this._fillRuns(ctx, d.conePolys)
      ctx.stroke()
    }
    ctx.restore()
  }

  /**
   * Hover contract for the shared tooltip (see SystemsApp's hover controller):
   * geometry knowledge stays here, rendering does not. Returns the lines to
   * show and the color to key them with, or null for "nothing here".
   */
  hoverAt(x, y) {
    const hit = this._probe(x, y)
    if (!hit) return null
    return { lines: this._hoverLines(hit), color: stageColor((hit.v || hit.storm).type, (hit.v || hit.storm).cat) }
  }

  /**
   * Storm whose eye is within maxPx of a screen point.
   * Aliased as `nearest` because SystemsApp's generic events-layer click path
   * calls `instance.nearest(x, y, px)` — matching that shape means the Storms
   * layer needs no special case in the click handler at all.
   */
  nearest(x, y) {
    const hit = this._probe(x, y)
    if (!hit) return null
    // The click path gets the storm PLUS which part of it was clicked, so a
    // click inside the cone can say "inside the cone" instead of silently
    // reporting the storm as if you'd clicked its eye.
    return { ...hit.storm, _hit: { part: hit.part, detail: hit.detail, view: hit.v } }
  }

  hitTest(x, y, maxPx = 26) {
    // `_drawn` is rebuilt each paint and only holds storms that passed the
    // horizon test, so a storm behind the globe can't be clicked either.
    let best = null
    let bestD = Infinity
    for (const d of this._drawn) {
      const dist = (d.cx - x) ** 2 + (d.cy - y) ** 2
      const lim = Math.max(maxPx, d.r + 6) ** 2
      if (dist < lim && dist < bestD) { bestD = dist; best = d.s }
    }
    return best
  }

  _clear() {
    this._ctx.setTransform(1, 0, 0, 1, 0, 0)
    this._ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  /**
   * Project a [lng, lat] pair, returning null when it falls on the far side
   * of the globe.
   *
   * This is not optional bookkeeping: Mapbox happily projects back-facing
   * points to plausible on-screen coordinates, so without the cull a storm in
   * the Atlantic draws straight through the planet while you're looking at
   * the Philippine Sea. Adding JTWC made it obvious, because there is now
   * almost always a storm on the hemisphere you aren't looking at.
   *
   * Same two-part test every other overlay here uses: the exact limb test
   * when the horizon is on screen, and an unproject round-trip when zoomed in
   * far enough that the horizon isn't. `_beginFrame` caches the geometry once
   * per paint so this stays cheap across a few thousand cone vertices.
   */
  _project(lng, lat) {
    let p
    try { p = this.map.project([lng, lat]) } catch { return null }
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
    if (this._geo) return this._geo.isVisible(lng, lat) ? p : null
    let rt
    try { rt = this.map.unproject([p.x, p.y]) } catch { return null }
    if (!rt || !Number.isFinite(rt.lng) || !Number.isFinite(rt.lat)) return null
    const dLng = Math.abs(((rt.lng - lng + 540) % 360) - 180)
    const cosLat = Math.max(0.05, Math.cos((lat * Math.PI) / 180))
    return dLng * cosLat + Math.abs(rt.lat - lat) <= this._tolDeg ? p : null
  }

  /**
   * Project a lng/lat line into screen-space runs, broken wherever the line
   * leaves the visible hemisphere or wraps the antimeridian. Returns an array
   * of runs so a track that dips behind the globe draws as two strokes
   * instead of one chord across the planet.
   */
  _runs(line) {
    const runs = []
    let cur = null
    let prevX = null
    for (const [lng, lat] of line) {
      const p = this._project(lng, lat)
      if (!p) { cur = null; prevX = null; continue }
      if (cur && prevX != null && Math.abs(p.x - prevX) > this._w * 0.5) cur = null
      if (!cur) { cur = []; runs.push(cur) }
      cur.push(p)
      prevX = p.x
    }
    return runs.filter((r) => r.length > 1)
  }

  /** Build a closed path from runs and return them for later hit testing. */
  _fillRuns(ctx, runs) {
    ctx.beginPath()
    for (const run of runs) {
      ctx.moveTo(run[0].x, run[0].y)
      for (let i = 1; i < run.length; i++) ctx.lineTo(run[i].x, run[i].y)
      ctx.closePath()
    }
    return runs
  }

  _strokeRuns(ctx, runs) {
    ctx.beginPath()
    for (const run of runs) {
      ctx.moveTo(run[0].x, run[0].y)
      for (let i = 1; i < run.length; i++) ctx.lineTo(run[i].x, run[i].y)
    }
    ctx.stroke()
  }

  /**
   * Chevrons marching along a track, pointing the way the storm travels.
   *
   * This is the layer's only animation, and it exists because direction is
   * real data: the past track runs toward the present position, the forecast
   * runs away from it. `phase` slides the chevrons along the path, so the
   * line reads as flow rather than as a static thread — the same visual
   * grammar as the wind particles elsewhere on /inmotion. March speed is
   * scaled by the storm's own forward speed, so a racing extratropical
   * transition visibly outruns a stalled tropical depression.
   */
  _chevrons(ctx, runs, color, phase, { spacing = 38, size = 4.6, alpha = 0.95 } = {}) {
    ctx.save()
    ctx.strokeStyle = rgba(color, alpha)
    ctx.lineWidth = 1.7
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const run of runs) {
      // Walk the polyline by arc length, dropping a chevron every `spacing`
      // pixels at the positions where (distance from the run's start) is
      // congruent to `phase` modulo the spacing.
      //
      // Getting this backwards is easy and looks wrong immediately: an
      // earlier version used `d = spacing - carried`, which makes d DECREASE
      // as phase increases, so the chevrons slid toward the start of the
      // track while still pointing forward. Josh spotted it as "arrows going
      // backwards". `d` must grow with `phase`.
      let acc = 0
      for (let i = 1; i < run.length; i++) {
        const a = run[i - 1]
        const b = run[i]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const segLen = Math.hypot(dx, dy)
        if (segLen < 0.01) continue
        const ux = dx / segLen
        const uy = dy / segLen
        let d = (((phase - acc) % spacing) + spacing) % spacing
        while (d <= segLen) {
          const cx = a.x + ux * d
          const cy = a.y + uy * d
          // A "V" opening backwards from the direction of travel.
          ctx.beginPath()
          ctx.moveTo(cx - ux * size + uy * size * 0.8, cy - uy * size - ux * size * 0.8)
          ctx.lineTo(cx + ux * size * 0.5, cy + uy * size * 0.5)
          ctx.lineTo(cx - ux * size - uy * size * 0.8, cy - uy * size + ux * size * 0.8)
          ctx.stroke()
          d += spacing
        }
        acc += segLen
      }
    }
    ctx.restore()
  }

  _path(ctx, line, close = false) {
    let started = false
    let any = false
    let prevX = null
    for (const [lng, lat] of line) {
      const p = this._project(lng, lat)
      if (!p) { started = false; continue }
      // Antimeridian: a jump of more than half the viewport means the line
      // wrapped the seam — break the stroke instead of drawing it across.
      if (started && prevX != null && Math.abs(p.x - prevX) > this._w * 0.5) started = false
      if (!started) { ctx.moveTo(p.x, p.y); started = true } else ctx.lineTo(p.x, p.y)
      prevX = p.x
      any = true
    }
    if (close && any) ctx.closePath()
    return any
  }

  _paint() {
    if (!this.visible) return
    const { map, canvas } = this
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    this._w = w
    this._h = h
    // Globe geometry for this frame: null when the horizon is off screen
    // (zoomed in), which is what the round-trip fallback in _project covers.
    this._geo = getGlobeGeometry(map, w, h)
    const degPerPx = 360 / (512 * Math.pow(2, map.getZoom()))
    this._tolDeg = degPerPx * 12 + 0.05

    const t = (performance.now() - this._t0) / 1000
    const nowMs = performance.now()
    // Clamped so a backgrounded tab returning after minutes doesn't teleport
    // every particle across the ocean in one frame.
    const dt = Math.min(0.1, Math.max(0, (nowMs - this._lastMs) / 1000))
    this._lastMs = nowMs

    const ctx = this._ctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    this._drawn = []


    for (const s of this.storms) {
      const v = this._viewOf(s)
      if (!v || v.lat == null || v.lng == null) continue
      const color = stageColor(v.type, v.cat)
      // Screen geometry collected while drawing, so the hover/click probe
      // tests exactly what was painted — no second projection pass that could
      // disagree with the picture.
      const shellHits = []
      const fcstHits = []
      const pastHits = []
      const pastSegHits = []
      const watchHits = []
      let fcstRunHits = []

      // ── 1. forecast cone ──────────────────────────────────────────────
      const coneRuns = v.cone.flatMap((ring) => this._runs(ring))
      if (coneRuns.length) {
        ctx.save()
        this._fillRuns(ctx, coneRuns)
        ctx.fillStyle = rgba(color, 0.12)
        ctx.fill('evenodd')
        ctx.strokeStyle = rgba(color, 0.45)
        ctx.lineWidth = 1
        ctx.setLineDash([4, 4])
        ctx.stroke()
        ctx.restore()
      }

      // ── 2. watch / warning coastline ──────────────────────────────────
      for (const wRec of v.watches) {
        const warn = wRec.code === 'TWR' || wRec.code === 'HWR'
        const wRuns = wRec.lines.flatMap((line) => this._runs(line))
        if (!wRuns.length) continue
        watchHits.push({ runs: wRuns, w: wRec })
        ctx.save()
        ctx.strokeStyle = warn ? 'rgba(255,70,70,0.95)' : 'rgba(255,170,40,0.95)'
        ctx.lineWidth = 3
        ctx.lineCap = 'round'
        ctx.shadowColor = warn ? 'rgba(255,70,70,0.8)' : 'rgba(255,170,40,0.8)'
        ctx.shadowBlur = 8
        this._strokeRuns(ctx, wRuns)
        ctx.restore()
      }

      // How fast this storm's chevrons march. Tied to its real forward speed
      // (kt), clamped so a stalled system still creeps and a 40-kt sprinter
      // doesn't strobe.
      const marchPxPerSec = Math.max(6, Math.min(30, ((v.historic ? null : s.move_kt) ?? 10) * 0.9))
      const phase = t * marchPxPerSec

      // ── 3. past track, colored and weighted by the stage it was in ────
      for (const seg of v.pastSegs) {
        const segColor = stageColor(seg.type, seg.cat)
        const weight = 1.4 + (seg.cat || 0) * 0.55
        const runs = seg.lines.flatMap((line) => this._runs(line))
        if (!runs.length) continue
        pastSegHits.push({ runs, seg })
        ctx.save()
        ctx.strokeStyle = rgba(segColor, 0.9)
        ctx.lineWidth = weight
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.shadowColor = rgba(segColor, 0.6)
        ctx.shadowBlur = 6
        this._strokeRuns(ctx, runs)
        ctx.restore()
        // Chevrons run the same way the storm did: toward the present.
        this._chevrons(ctx, runs, segColor, phase, { spacing: 42, size: 4, alpha: 0.75 })
      }

      // ── 4. forecast track ─────────────────────────────────────────────
      const fRuns = v.forecastTrack.flatMap((line) => this._runs(line))
      fcstRunHits = fRuns
      if (fRuns.length) {
        ctx.save()
        ctx.strokeStyle = rgba(color, 0.7)
        ctx.lineWidth = 1.8
        ctx.setLineDash([7, 6])
        // Dashes crawl forward along the forecast path, so "where it's going"
        // is legible without reading the labels.
        ctx.lineDashOffset = -phase
        this._strokeRuns(ctx, fRuns)
        ctx.restore()
        this._chevrons(ctx, fRuns, color, phase, { spacing: 34, size: 5, alpha: 0.95 })
      }

      // ── 5. forecast points (skip tau 0 — the eye is drawn below) ──────
      for (const f of v.forecast) {
        if (!f.tau || f.lng == null) continue
        const p = this._project(f.lng, f.lat)
        if (!p) continue
        fcstHits.push({ x: p.x, y: p.y, f })
        const c = stageColor(f.type, f.cat)
        ctx.save()
        ctx.beginPath()
        ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2)
        ctx.fillStyle = rgba(c, 0.9)
        ctx.strokeStyle = 'rgba(8,12,20,0.85)'
        ctx.lineWidth = 1
        ctx.fill()
        ctx.stroke()
        ctx.restore()
      }

      // Past positions aren't drawn as dots (the colored track carries them),
      // but they ARE hoverable: each one is a real advisory fix with its own
      // time, intensity and category.
      for (const pp of v.historic ? [] : s.past || []) {
        if (pp.lng == null || pp.lat == null) continue
        const p = this._project(pp.lng, pp.lat)
        if (p) pastHits.push({ x: p.x, y: p.y, p: pp })
      }

      // ── 6. the eye ────────────────────────────────────────────────────
      const p = this._project(v.lng, v.lat)
      if (!p) continue

      // One scale for everything this storm draws, and it is the true one.
      const northP = this._project(v.lng, v.lat + 1)
      const truePxPerNm = northP ? Math.hypot(northP.x - p.x, northP.y - p.y) / 60 : 0
      let rMaxNm = 0
      for (const sh of v.shells) rMaxNm = Math.max(rMaxNm, sh.ne || 0, sh.se || 0, sh.sw || 0, sh.nw || 0)

      // The storm's real wind field, drawn as true geography: three nested,
      // asymmetric shells for tropical-storm (34 kt), damaging (50 kt) and
      // hurricane-force (64 kt) winds. An earlier version of this layer drew
      // a rotating three-armed spiral at a fixed screen size instead. It was
      // invented — the arms corresponded to nothing, and the size lied about
      // how big the storm was — and it looked like a loading spinner. These
      // polygons are NHC's own quadrant radii, so a hurricane renders as the
      // lopsided thing it actually is.
      const fieldPx = rMaxNm * truePxPerNm
      for (const shell of v.shells) {
        const strength = shell.kt >= 64 ? 1 : shell.kt >= 50 ? 0.66 : 0.38
        // Each shell is painted by the wind speed it represents, not by the
        // storm's overall category, so the nesting reads as a heat gradient:
        // teal at the tropical-storm edge, yellow at the hurricane-force
        // core. Same ramp as the legend chips.
        const shellColor = windColor(shell.kt)
        const shellRuns = shell.rings.flatMap((ring) => this._runs(ring))
        if (shellRuns.length) {
          ctx.save()
          this._fillRuns(ctx, shellRuns)
          ctx.fillStyle = rgba(shellColor, 0.07 * strength + 0.05)
          ctx.fill('evenodd')
          ctx.strokeStyle = rgba(shellColor, 0.4 + 0.42 * strength)
          ctx.lineWidth = 0.9 + strength * 0.9
          ctx.stroke()
          ctx.restore()
          shellHits.push({ kt: shell.kt, polys: shellRuns })
        }
      }

      // Fill the shells with the circulation they describe. Drawn after the
      // shells so the particles read as being inside them, and before the eye
      // mark so the mark stays on top.
      const flowDrew = this._drawFlow(ctx, s, v, p, dt, truePxPerNm)

      // A minimum legible mark, so a storm is findable when its wind field is
      // tiny or unpublished.
      //
      // This used to include a bold ring at `max(13, min(fieldPx, 28.6))` px,
      // which Josh spotted as "the purple line around the cat5 hurricane".
      // He was right to ask: that radius corresponds to NO measured quantity.
      // It was a legibility floor from before the circulation existed, and
      // being a crisp circle in the same visual language as the wind shells —
      // which ARE true geography — it read as a boundary. The ring is now
      // drawn ONLY when there is no circulation to mark the storm (no wind
      // radii published, or the field is sub-pixel). Where the vortex draws,
      // the mark is just the eye and a soft halo, neither of which claims an
      // extent.
      const markR = Math.max(5.5, Math.min(13, 5.5 + (v.cat || 0) * 1.5))
      const r = Math.max(markR, Math.min(fieldPx, markR * 2.2))

      ctx.save()
      ctx.translate(p.x, p.y)

      // One soft halo, not a pulse: it separates the mark from whatever
      // layer is underneath without drawing attention to itself.
      const glow = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 2.6)
      glow.addColorStop(0, rgba(color, 0.3))
      glow.addColorStop(1, rgba(color, 0))
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(0, 0, r * 2.6, 0, Math.PI * 2)
      ctx.fill()

      // Locator ring — only when nothing else marks the storm.
      if (!flowDrew) {
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, Math.PI * 2)
        ctx.strokeStyle = rgba(color, 0.95)
        ctx.lineWidth = 1.6
        ctx.stroke()
      }

      ctx.beginPath()
      ctx.arc(0, 0, Math.max(1.6, r * 0.26), 0, Math.PI * 2)
      ctx.fillStyle = (v.cat || 0) >= 3 ? 'rgba(8,12,20,0.95)' : rgba(color, 0.95)
      ctx.fill()
      if ((v.cat || 0) >= 3) {
        // Major hurricanes get a hollow eye — the one visual cue that is both
        // honest (they really do clear one out) and instantly readable.
        ctx.strokeStyle = rgba(color, 0.95)
        ctx.lineWidth = 1.2
        ctx.stroke()
      }
      ctx.restore()

      // ── label ─────────────────────────────────────────────────────────
      const label = v.cat > 0 ? `${s.name} · Cat ${v.cat}` : `${s.name} · ${v.type_word}`
      ctx.save()
      ctx.font = '600 12px system-ui, -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const ly = p.y + r * 1.45 + 4
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(6,10,18,0.9)'
      ctx.strokeText(label, p.x, ly)
      ctx.fillStyle = rgba(color, 1)
      ctx.fillText(label, p.x, ly)
      ctx.restore()

      this._drawn.push({
        s, v, cx: p.x, cy: p.y, r,
        conePolys: coneRuns,
        shells: shellHits,
        fcstPts: fcstHits,
        pastPts: pastHits,
        pastSegs: pastSegHits,
        fcstRuns: fcstRunHits,
        watches: watchHits,
      })
    }

    // Last, on top of everything: outline whatever the cursor is on. Probed
    // against the geometry just recorded this frame, so the highlight can
    // never lag the picture during a drag.
    if (this._hover) {
      const hit = this._probe(this._hover.x, this._hover.y)
      if (hit) this._drawHighlight(ctx, hit)
    }
  }
}
