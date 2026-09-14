/**
 * Carbon Mapper observed-emission-SOURCE overlay for /inmotion — the
 * observational companion to the modeled gas layers (methane, CO₂).
 *
 * Each reticle is a persistent SOURCE: a cluster of individual plume
 * detections at one location, carrying how often the site was seen emitting
 * across all overflights (persistence), a source-level rate ± uncertainty,
 * the facility name joined at bake from Climate TRACE, and its observation
 * history. See docs/CARBONMAPPER_API.md for the full upstream study.
 *
 * Visual language: lime target-reticles with expanding sonar pings — the
 * complement of the magenta gas wash and deliberately unlike every other
 * marker on the site. Age is graded into the marker (the archive reaches to
 * 2016, and at any moment most sources were last seen months-to-years ago —
 * drawing them all at full strength read as "detected now"): sources seen
 * within ~45 days of the reference time get full strength + sonar pings,
 * within a year they dim and stop pinging, older ones draw as faint hollow
 * archive reticles. Everything stays visible and clickable — the history is
 * the value — it just can't masquerade as current. Top of the z-order.
 * Repaints live during gestures (points stay glued to their facilities).
 *
 * Coverage honesty: targeted snapshots, not a survey — panel + popups say
 * an empty area means unsurveyed, never clean.
 */

import { getGlobeGeometry } from './globeGeom.js'
import { loadSystemsJson } from './windField.js'

// Below FULL_ZOOM the reticle treatment (ring + ticks + core + pings) is
// subpixel soup, but the sources must still EXIST on the map — a global
// view that hides every observed emitter reads as "no data". So low zooms
// draw compact age-graded dots that grow into the full reticles here.
const FULL_ZOOM = 3.6
const REFRESH_MS = 6 * 60 * 60e3
const MAX_DPR = 2
const FRESH_MS = 45 * 8.64e7 // sources detected within ~45 days of the reference time ping harder
const YEAR_MS = 365 * 8.64e7 // beyond this since last detection → faint archive style

export class MethanePlumesOverlay {
  /** opts: { dataset, expectKind, color } — e.g. ('methane-plumes',
   * 'ch4-sources'). Also renders UNEP MARS source artifacts (kind
   * 'mars-sources', see scripts/bake-mars.js) — same reticle language,
   * usually with a distinct `color` ('r,g,b') so provenance is separable. */
  constructor(map, canvas, opts = {}) {
    this.map = map
    this.canvas = canvas
    this.dataset = opts.dataset || 'methane-plumes'
    this.expectKind = opts.expectKind || 'ch4-sources'
    this.color = opts.color || '163,230,53' // lime unless told otherwise
    this.visible = true
    this._destroyed = false
    this._ctx = canvas.getContext('2d')
    this._data = null
    this._fetchedAt = 0
    this._loading = false
    this._cursor = null
    this._drawn = [] // { p, x, y, r } for hit tests

    // Points are anchored to geography: repaint on EVERY move frame so they
    // track the basemap exactly. The raster wash freezes-and-slides during
    // gestures (an affine estimate is fine for a blurry field), but applied
    // to points it read as markers drifting off their facilities and
    // snapping back at settle. project() over ~14k sources is a few ms.
    this._onMoveStart = () => { this._moving = true }
    this._onMove = () => this._paint()
    this._onMoveEnd = () => { this._moving = false; this._paint() }
    this._onResize = () => this._paint()
    map.on('movestart', this._onMoveStart)
    map.on('move', this._onMove)
    map.on('moveend', this._onMoveEnd)
    map.on('resize', this._onResize)
    // Attention pulse: throttled rAF repaint while markers are on screen.
    this._lastPulse = 0
    this._pulseLoop = (now) => {
      if (this._destroyed) return
      this._pulseRaf = requestAnimationFrame(this._pulseLoop)
      if (!this.visible || document.hidden || this._moving || !this._data) return
      // (compact low-zoom dots still ping their fresh sources — keep pulsing)
      if (now - this._lastPulse < 50) return // ~20 fps is plenty for a slow pulse
      this._lastPulse = now
      this._paint()
    }
    this._pulseRaf = requestAnimationFrame(this._pulseLoop)
    this._ensureData()
    this._paint()
  }

  /** Replay cursor (ms) or null for live: only sources first detected by the
   * cursor time draw; ones with detections near it ping brightest. */
  setTime(t_ms) {
    if (this._cursor === t_ms) return
    this._cursor = t_ms
    this._paint()
  }

  setVisible(visible) {
    this.visible = visible
    if (!visible) { this._clear(); this._drawn = [] } else { this._ensureData(); this._paint() }
  }

  destroy() {
    this._destroyed = true
    cancelAnimationFrame(this._pulseRaf)
    this.map.off('movestart', this._onMoveStart)
    this.map.off('move', this._onMove)
    this.map.off('moveend', this._onMoveEnd)
    this.map.off('resize', this._onResize)
    this._clear()
  }

  /** Nearest drawn source within tap range of the screen point, or null. */
  hitTest(x, y) {
    let best = null
    let bestD = 14 * 14
    // Reverse order: drawn newest-last, so co-located sources resolve to the
    // most recently detected one.
    for (let i = this._drawn.length - 1; i >= 0; i--) {
      const d = this._drawn[i]
      const dx = x - d.x
      const dy = y - d.y
      const dist = dx * dx + dy * dy
      const reach = Math.max(12, d.r + 6) ** 2
      if (dist <= reach && dist < bestD) { bestD = dist; best = d.p }
    }
    return best
  }

  _ensureData() {
    if (this._destroyed || !this.visible || this._loading) return
    if (this._data && Date.now() - this._fetchedAt < REFRESH_MS) return
    this._loading = true
    loadSystemsJson(this.dataset, this.expectKind)
      .then((j) => {
        if (this._destroyed) return
        if (j.kind === 'mars-sources') {
          // UNEP MARS artifact — rows per scripts/bake-mars.js `columns`:
          // [lat, lng, kgh, kgh_std, t_last_ms, sector, source_type,
          //  persist_pct, n_plumes, t_first_ms, source_name, country,
          //  actionable, notified, sat_idx]
          this._data = j.sources.map((r) => ({
            lat: r[0], lng: r[1], kgh: r[2] ?? 0, unc: r[3], t_ms: r[4] || 0, sector: r[5] || '',
            srcType: r[6] || null, persist: r[7], det: r[8] || 0, obs: null,
            t_first: r[9] || r[4] || 0, source_name: r[10] || null, country: r[11] || null,
            actionable: !!r[12], notified: !!r[13], sat: (j.satellites || [])[r[14]] || null,
            mars: true, name: null, plume_id: null, scene_id: null,
          }))
        } else {
          // Carbon Mapper rows: [lat, lng, kgh, unc, t_last, sector, name,
          // dist_km, persist_pct, det_days, obs_days, t_first, plume_id, scene_id]
          this._data = j.sources.map((r) => ({
            lat: r[0], lng: r[1], kgh: r[2], unc: r[3], t_ms: r[4], sector: r[5],
            name: r[6] || null, distKm: r[7], persist: r[8], det: r[9], obs: r[10],
            t_first: r[11], plume_id: r[12], scene_id: r[13] || null,
          }))
        }
        // Oldest-last-seen first, so recently-detected sources paint (and
        // hit-test preferentially) ON TOP of the faint archive in dense
        // basins like Four Corners / Permian.
        this._data.sort((a, b) => (a.t_ms || 0) - (b.t_ms || 0))
        this._fetchedAt = Date.now()
        this._paint()
      })
      .catch(() => { /* markers are an enhancement — the modeled layer stands alone */ })
      .finally(() => { this._loading = false })
  }

  _clear() {
    this._ctx.setTransform(1, 0, 0, 1, 0, 0)
    this._ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  _paint() {
    if (this._destroyed) return
    const { map, canvas } = this
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    const ctx = this._ctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    this._drawn = []
    if (!this.visible || !this._data) return
    const zoom = map.getZoom()
    const compact = zoom < FULL_ZOOM // dots below, full reticles above
    this._ensureData()

    const geo = getGlobeGeometry(map, w, h)
    const clock = Date.now() // animation clock — always wall time
    const refT = this._cursor ?? clock // reference time for filtering/recency
    // Ease the full treatment in over its first half-zoom so the dot→reticle
    // handoff doesn't pop; compact dots render at full strength.
    const zoomAlpha = compact ? 1 : Math.min(1, (zoom - FULL_ZOOM) / 0.5 + 0.5)
    // Sonar-ping phase (0→1, ~2 s).
    const phase = (clock % 2000) / 2000
    // Distance guard: far-side, limb, and world-copy positions never draw —
    // nothing beyond 60° of arc from the map center is a useful marker.
    const c = map.getCenter()
    const d2r = Math.PI / 180
    const sinC = Math.sin(c.lat * d2r)
    const cosC = Math.cos(c.lat * d2r)
    for (const p of this._data) {
      if (p.t_first > refT + 12 * 3.6e6) continue // not yet observed at the cursor
      const pLat = p.lat * d2r
      const cosArc = sinC * Math.sin(pLat) + cosC * Math.cos(pLat) * Math.cos((p.lng - c.lng) * d2r)
      if (cosArc < 0.5) continue // > 60° of arc away
      if (geo && !geo.isVisible(p.lng, p.lat)) continue
      let pt
      try { pt = map.project([p.lng, p.lat]) } catch { continue }
      if (!pt || !Number.isFinite(pt.x)) continue
      if (pt.x < -20 || pt.y < -20 || pt.x > w + 20 || pt.y > h + 20) continue
      // Size by source rate (log); grows gently past z6 so single markers
      // stay findable over a saturated wash.
      const zScale = 1 + Math.min(1, Math.max(0, zoom - 6) * 0.18)
      const r = (3 + 2.5 * Math.log10(Math.max(1, p.kgh / 30))) * zScale
      const recent = Math.abs(refT - p.t_ms) < FRESH_MS || (refT >= p.t_first && refT - p.t_first < FRESH_MS)
      // Age tier: how long before the reference time this site was LAST seen
      // emitting. The archive reaches to 2016 and overflights are sporadic —
      // most sources' last look is months-to-years old — so age must be
      // legible on the map itself, not only in the popup date.
      const lastAge = Math.max(0, refT - (p.t_ms || 0))
      const fresh = recent || lastAge <= FRESH_MS
      const archive = !fresh && lastAge > YEAR_MS
      const ageFactor = fresh ? 1 : archive ? 0.3 : 0.55
      const alpha = zoomAlpha * ageFactor
      const LIME = this.color
      if (compact) {
        // Global-zoom mode: one small age-graded dot per source, dark-edged
        // so it survives the saturated wash; a ping only when fresh. The
        // world view must show WHERE the observed emitters are — the full
        // reticle language takes over past FULL_ZOOM.
        const r0 = (1.6 + (p.kgh >= 1000 ? 0.8 : 0)) * (1 + Math.max(0, zoom - 1.5) * 0.35)
        if (fresh) {
          const pr = r0 + 1 + (r0 * 2.2 + 4) * phase
          ctx.beginPath()
          ctx.arc(pt.x, pt.y, pr, 0, Math.PI * 2)
          ctx.lineWidth = 1.4 * (1 - phase) + 0.4
          ctx.strokeStyle = `rgba(${LIME},${(1 - phase) * 0.85})`
          ctx.stroke()
        }
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, r0, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${LIME},${fresh ? 0.95 : archive ? 0.35 : 0.65})`
        ctx.fill()
        ctx.lineWidth = 0.6
        ctx.strokeStyle = `rgba(15,25,10,${fresh ? 0.9 : 0.5})`
        ctx.stroke()
        this._drawn.push({ p, x: pt.x, y: pt.y, r: r0 })
        continue
      }
      // Expanding sonar ping — only sources seen recently (relative to the
      // reference time) ping; a 2019 snapshot must not pulse like live news.
      const ping = (ph, strength) => {
        if (ph <= 0.02 || ph >= 1) return
        const pr = r + 2 + (r * 2.6 + 6) * ph
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, pr, 0, Math.PI * 2)
        ctx.lineWidth = 2 * (1 - ph) + 0.5
        ctx.strokeStyle = `rgba(${LIME},${(1 - ph) * strength * zoomAlpha})`
        ctx.stroke()
      }
      if (fresh) {
        ping(phase, 0.9)
        if (recent) ping((phase + 0.5) % 1, 0.55)
      }
      // Target reticle: lime ring + four ticks around a white core — reads
      // as "detected at this exact spot". Archive sources draw hollow (no
      // white core) and faint: still there, still clickable, clearly old.
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, r + 2, 0, Math.PI * 2)
      ctx.lineWidth = archive ? 1.2 : 1.6
      ctx.strokeStyle = `rgba(${LIME},${0.95 * alpha})`
      ctx.stroke()
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.beginPath()
        ctx.moveTo(pt.x + dx * (r + 2), pt.y + dy * (r + 2))
        ctx.lineTo(pt.x + dx * (r + 5), pt.y + dy * (r + 5))
        ctx.stroke()
      }
      if (!archive) {
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, Math.max(2, r * 0.55), 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${0.95 * alpha})`
        ctx.fill()
        ctx.lineWidth = 1
        ctx.strokeStyle = `rgba(20,45,10,${0.85 * alpha})`
        ctx.stroke()
      }
      this._drawn.push({ p, x: pt.x, y: pt.y, r })
    }
  }
}
