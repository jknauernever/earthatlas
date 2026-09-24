/**
 * Climate TRACE facility-emissions overlay for /inmotion — every power plant,
 * steel mill, refinery, mine, airport, port, landfill, wastewater plant and
 * cattle operation in the release, sized by what it emitted in the month
 * under the replay cursor (tonnes CO₂-equivalent, 100-year).
 *
 * DATA PATH: a Mapbox vector source over /api/trace-tiles (our PMTiles) with
 * an invisible probe layer does the tiling work — which facilities exist at
 * this zoom (the bake's rank ladder: the biggest emitters at world view,
 * smaller ones arriving as you zoom in) and which tiles are in view. This
 * overlay harvests those features (querySourceFeatures) and paints them on
 * its own canvas, so a month change is a repaint, not a tile reload. Each
 * feature carries its whole monthly series; see scripts/bake-climatetrace.
 *
 * VISUAL LANGUAGE: soft sector-colored discs, area ∝ emissions (radius ∝ √t),
 * biggest drawn first so small sources stay visible on top. Oil & gas
 * "sources" are whole basins placed at a centroid — drawn as faint dashed
 * rings so they never read as one smokestack. A month with no estimate draws
 * nothing (never a zero).
 */

import { getGlobeGeometry } from './globeGeom.js'
import { traceTileUrl, sectorStyle, decodeMonth, PRIMARY_MEASURE, availableMeasures } from './traceData.js'
import { nearbyOf } from './traceCard.js'

const SRC = 'trace-facilities'
const PROBE = 'trace-facilities-probe'
const SRC_LAYER = 'facilities'
const MAX_DPR = 2
const HARVEST_MS = 180
const MOVE_SMALL_CAP = 15000 // above this many candidates, sub-2px dots wait for moveend
const FLOW_CAP = 9000 // interpolate between months only when the scene is this light
const ITEM_CACHE_CAP = 250000

const rgbOf = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

export class TraceFacilitiesOverlay {
  /** index: the baked trace-index.json (months[], shards, countries, measures). */
  constructor(map, canvas, index, { measure = PRIMARY_MEASURE, sectors = null } = {}) {
    this.map = map
    this.canvas = canvas
    this.index = index
    this.measure = availableMeasures(index).includes(measure) ? measure : PRIMARY_MEASURE
    this.sectors = sectors // Set of sector keys to show, or null = everything
    this._k = this._scaleFor(this.measure)
    this.nMonths = index.months.length
    this.visible = true
    this._destroyed = false
    this._ctx = canvas.getContext('2d')
    this._items = new Map() // id → parsed item (series parsed once)
    this._list = [] // harvested items, biggest annual total first
    this._mi = this.nMonths - 1 // month index on screen
    this._mix = 0
    this._flow = false
    this._clamped = false // cursor sits past the latest published month
    this._drawn = { n: 0, x: new Float32Array(0), y: new Float32Array(0), r: new Float32Array(0), it: [] }
    this._colors = {}

    this._ensureSource = () => {
      try {
        if (!map.getSource(SRC)) {
          map.addSource(SRC, {
            type: 'vector', tiles: [traceTileUrl(this.measure)], minzoom: 0, maxzoom: 8,
            attribution: '<a href="https://climatetrace.org" target="_blank" rel="noopener">Climate TRACE</a>',
          })
        }
        if (!map.getLayer(PROBE)) {
          // Invisible: it exists only so Mapbox loads the tiles in view.
          map.addLayer({
            id: PROBE, type: 'circle', source: SRC, 'source-layer': SRC_LAYER,
            layout: { visibility: this.visible ? 'visible' : 'none' },
            paint: { 'circle-radius': 1, 'circle-opacity': 0, 'circle-stroke-opacity': 0 },
          })
        }
      } catch { /* style mid-swap — style.load retries */ }
    }
    this._onStyle = () => { this._ensureSource(); this._scheduleHarvest() }
    this._onMoveStart = () => { this._moving = true }
    this._onMove = () => this._paint()
    this._onMoveEnd = () => { this._moving = false; this._scheduleHarvest(); this._paint() }
    this._onResize = () => this._paint()
    this._onData = (e) => { if (e.sourceId === SRC) this._scheduleHarvest() }
    map.on('style.load', this._onStyle)
    map.on('movestart', this._onMoveStart)
    map.on('move', this._onMove)
    map.on('moveend', this._onMoveEnd)
    map.on('resize', this._onResize)
    map.on('sourcedata', this._onData)
    this._ensureSource()
    this._scheduleHarvest()
  }

  /** Replay cursor (ms) or null = the latest published month. `mode` 'flow'
   * (playing) eases sizes between months; anything else snaps to the month. */
  setTime(t, mode) {
    let mi = this.nMonths - 1, mix = 0, clamped = false
    if (t != null) {
      const d = new Date(t)
      const raw = (d.getUTCFullYear() - Number(this.index.months[0].slice(0, 4))) * 12 + d.getUTCMonth()
      const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
      const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
      if (raw >= this.nMonths) { clamped = true } else if (raw < 0) { mi = 0 } else { mi = raw; mix = (t - start) / (end - start) }
    }
    const flow = mode === 'flow' && this._list.length <= FLOW_CAP
    if (!flow) mix = 0
    if (mi === this._mi && mix === this._mix && flow === this._flow && clamped === this._clamped) return
    // Easing between months only needs ~20 fps; a month change always paints.
    const now = performance.now()
    const easeOnly = mi === this._mi && flow && this._flow && clamped === this._clamped
    if (easeOnly && now - (this._lastEase || 0) < 50) return
    this._lastEase = now
    this._mi = mi; this._mix = mix; this._flow = flow; this._clamped = clamped
    this._paint()
  }

  /** Size multiplier that puts every measure on the CO₂e view's visual
   * scale: each measure's bake stores a "big but not extreme" monthly value
   * (ref); tonnes are scaled so that value draws as large as CO₂e's does. */
  _scaleFor(g) {
    const m = this.index.measures
    if (!m?.[g]?.ref || !m?.[PRIMARY_MEASURE]?.ref) return 1
    return m[PRIMARY_MEASURE].ref / m[g].ref
  }

  /** Switch what the discs measure (co2e_100yr, ch4, pm2_5, …): a different
   * tile file, so drop the source and harvest again. */
  setMeasure(g) {
    if (!availableMeasures(this.index).includes(g) || g === this.measure) return
    this.measure = g
    this._k = this._scaleFor(g)
    this._items = new Map()
    this._list = []
    try {
      if (this.map.getLayer(PROBE)) this.map.removeLayer(PROBE)
      if (this.map.getSource(SRC)) this.map.removeSource(SRC)
    } catch { /* style mid-swap — _ensureSource re-adds */ }
    this._ensureSource()
    this._paint()
    this._scheduleHarvest()
  }

  /** Kinds of site to show (Set of sector keys), or null for everything. */
  setSectors(sectors) {
    this.sectors = sectors && sectors.size ? sectors : null
    this._paint()
  }

  /** Month on screen — 'YYYY-MM' — and whether the cursor ran past the data. */
  get month() { return { ym: this.index.months[this._mi], clamped: this._clamped, latest: this._mi === this.nMonths - 1 } }

  setVisible(visible) {
    this.visible = visible
    try { if (this.map.getLayer(PROBE)) this.map.setLayoutProperty(PROBE, 'visibility', visible ? 'visible' : 'none') } catch { /* style mid-swap */ }
    if (visible) this._scheduleHarvest()
    this._paint()
  }

  destroy() {
    this._destroyed = true
    clearTimeout(this._harvestTimer)
    const m = this.map
    m.off('style.load', this._onStyle)
    m.off('movestart', this._onMoveStart)
    m.off('move', this._onMove)
    m.off('moveend', this._onMoveEnd)
    m.off('resize', this._onResize)
    m.off('sourcedata', this._onData)
    try { if (m.getLayer(PROBE)) m.removeLayer(PROBE); if (m.getSource(SRC)) m.removeSource(SRC) } catch { /* map torn down */ }
    this._clear()
  }

  /** Emissions of an item in the month on screen (eased while playing). */
  valueOf(it) {
    const a = it.vals[this._mi]
    if (!this._flow || !this._mix || this._mi + 1 >= this.nMonths) return a
    const b = it.vals[this._mi + 1]
    return Number.isNaN(b) || Number.isNaN(a) ? a : a + (b - a) * this._mix
  }

  /** Nearest drawn facility within reach of a screen point → popup event. */
  nearest(x, y, reach = 14) {
    const d = this._drawn
    let best = -1, bestScore = Infinity
    for (let i = 0; i < d.n; i++) {
      const dx = x - d.x[i], dy = y - d.y[i]
      const dist = Math.sqrt(dx * dx + dy * dy)
      const within = Math.max(reach, d.r[i] + 3)
      if (dist > within) continue
      // Prefer the smallest disc under the pointer — it's drawn on top.
      const score = dist + d.r[i] * 0.5
      if (score < bestScore) { bestScore = score; best = i }
    }
    if (best < 0) return null
    const it = d.it[best]
    return this.eventFor(it)
  }

  eventFor(it) {
    // Co-located twins (e.g. a port's domestic + international entries) are
    // one place to a reader: one card, summed series. Neighbours within 4 km
    // feed the card's "why it matters here".
    const { twins, nearby } = nearbyOf(it, this._list)
    const series = []
    for (let i = 0; i < this.nMonths; i++) {
      let v = Number.isNaN(it.vals[i]) ? null : it.vals[i]
      for (const tw of twins) { const x = tw.vals[i]; if (!Number.isNaN(x)) v = (v || 0) + x }
      series.push(v)
    }
    return {
      ...it,
      vals: undefined,
      twins: twins.map(({ id, sub }) => ({ id, sub })),
      nearby,
      series,
      month: this.index.months[this._mi],
      months: this.index.months,
      monthIdx: this._mi,
      value: series[this._mi],
      clamped: this._clamped,
      latest: this._mi === this.nMonths - 1,
      fullYear: this.index.fullYear,
      measure: this.measure,
      measureTotal: this.index.measures?.[this.measure]?.count ?? this.index.count,
      total: this.index.count,
      shards: this.index.shards,
      country: this.index.countries?.[it.c] || it.c,
    }
  }

  /**
   * What is on screen right now, for "Explain this view": ONLY the sources
   * drawn at this zoom (the rank ladder hides smaller sites until you zoom
   * in), valued at the month on screen. Basins are kept apart — they are
   * regional estimates, not facilities, and would swamp any facility total.
   */
  summarize(topN = 5) {
    const d = this._drawn
    const mi = this._mi
    const sectors = {}
    const facilities = []
    let total = 0, prevSame = 0, curSame = 0, basinN = 0, basinT = 0, basinTop = null
    for (let k = 0; k < d.n; k++) {
      const it = d.it[k]
      const v = it.vals[mi]
      if (!(v > 0)) continue
      if (it.b) {
        basinN++; basinT += v
        if (!basinTop || v > basinTop.v) basinTop = { it, v }
        continue
      }
      total += v
      const s = (sectors[it.sec] ||= { n: 0, t: 0 })
      s.n++; s.t += v
      facilities.push([v, it])
      // Year-over-year on the SAME sites (both months estimated) — never
      // compares against sites that weren't there a year ago.
      const p = mi >= 12 ? it.vals[mi - 12] : NaN
      if (p > 0) { prevSame += p; curSame += v }
    }
    facilities.sort((a, b) => b[0] - a[0])
    return {
      month: this.index.months[mi],
      latest: mi === this.nMonths - 1,
      clamped: this._clamped,
      count: facilities.length,
      total,
      sectors,
      top: facilities.slice(0, topN).map(([v, it]) => ({ it, v })),
      yoy: prevSame > 0 ? { prev: prevSame, cur: curSame } : null,
      basins: basinN ? { n: basinN, t: basinT, top: basinTop } : null,
      countries: this.index.countries || {},
      zoom: this.map.getZoom(),
      totalSources: this.index.measures?.[this.measure]?.count ?? this.index.count,
      measure: this.measure,
      sectorsShown: this.sectors ? [...this.sectors] : null,
    }
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  _scheduleHarvest() {
    if (this._destroyed || !this.visible) return
    clearTimeout(this._harvestTimer)
    this._harvestTimer = setTimeout(() => this._harvest(), HARVEST_MS)
  }

  _harvest() {
    if (this._destroyed || !this.visible) return
    let feats
    try { feats = this.map.querySourceFeatures(SRC, { sourceLayer: SRC_LAYER }) } catch { return }
    const seen = new Set()
    const list = []
    for (const f of feats) {
      const p = f.properties
      const id = p.id
      if (seen.has(id)) continue
      seen.add(id)
      let it = this._items.get(id)
      if (!it) {
        const vals = new Float32Array(this.nMonths).fill(NaN)
        const m = p.m ? String(p.m) : ''
        for (let i = 0; i * 3 < m.length; i++) {
          const mi = p.m0 + i
          if (mi < this.nMonths) vals[mi] = decodeMonth(m.slice(i * 3, i * 3 + 3))
        }
        it = {
          id, n: p.n, sec: p.sec, sub: p.sub, c: p.c, at: p.at || null, b: !!p.b,
          y: p.y || 0, r: p.r, o: p.o || null, q: p.q || null, k: p.k || null, vals,
        }
        this._items.set(id, it)
      }
      // Positions come from the tile they were read from — refresh every
      // harvest so zooming in trades world-tile rounding for exact spots.
      const [lng, lat] = f.geometry.coordinates
      it.lng = lng; it.lat = lat
      list.push(it)
    }
    list.sort((a, b) => b.y - a.y)
    this._list = list
    if (this._items.size > ITEM_CACHE_CAP) {
      this._items = new Map(list.map((it) => [it.id, it]))
    }
    this._paint()
  }

  _clear() {
    this._ctx.setTransform(1, 0, 0, 1, 0, 0)
    this._ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this._drawn.n = 0
  }

  _rgb(sec) {
    return (this._colors[sec] ||= rgbOf(sectorStyle(sec).color))
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
    this._drawn.n = 0
    if (!this.visible || !this._list.length) return

    const list = this._list
    if (this._drawn.x.length < list.length) {
      const n = list.length + 1024
      this._drawn = { n: 0, x: new Float32Array(n), y: new Float32Array(n), r: new Float32Array(n), it: new Array(n) }
    }
    const D = this._drawn
    const zoom = map.getZoom()
    // Area ∝ tonnes. √ scale in px at world view; grows ~1.3× per zoom level
    // so a region view stays legible without the big plants swallowing it.
    const zs = Math.min(4, Math.max(0.85, Math.pow(1.3, zoom - 2)))
    const geo = getGlobeGeometry(map, w, h)
    const c = map.getCenter()
    const d2r = Math.PI / 180
    const sinC = Math.sin(c.lat * d2r)
    const cosC = Math.cos(c.lat * d2r)
    let bounds = null
    if (zoom >= 3.5) {
      try { const b = map.getBounds(); bounds = [b.getWest() - 1, b.getSouth() - 1, b.getEast() + 1, b.getNorth() + 1] } catch { bounds = null }
    }
    const skipSmall = this._moving && list.length > MOVE_SMALL_CAP
    // Small dots batch into one path per sector (one fill each — tens of
    // thousands of feedlots stay cheap); larger discs draw individually.
    const small = {}
    const basins = []

    for (const it of list) {
      const v = this.valueOf(it)
      if (!(v > 0)) continue // no estimate / zero this month → nothing drawn
      if (this.sectors && !this.sectors.has(it.sec)) continue
      if (bounds) {
        if (it.lat < bounds[1] || it.lat > bounds[3]) continue
        if (bounds[0] <= bounds[2] && (it.lng < bounds[0] || it.lng > bounds[2])) continue
      } else {
        const pLat = it.lat * d2r
        const cosArc = sinC * Math.sin(pLat) + cosC * Math.cos(pLat) * Math.cos((it.lng - c.lng) * d2r)
        if (cosArc < 0.2) continue // well past the limb
        if (geo && !geo.isVisible(it.lng, it.lat)) continue
      }
      const r = Math.min(it.b ? 95 : 60, (0.9 + 0.0115 * Math.sqrt(v * this._k)) * zs)
      if (skipSmall && r < 2) continue
      let pt
      try { pt = map.project([it.lng, it.lat]) } catch { continue }
      if (!pt || !Number.isFinite(pt.x)) continue
      if (pt.x < -r || pt.y < -r || pt.x > w + r || pt.y > h + r) continue
      if (it.b) { basins.push([pt.x, pt.y, r, it]); continue }
      const rgb = this._rgb(it.sec)
      if (r < 3) {
        const rr = Math.max(1.1, r)
        const path = (small[rgb] ||= new Path2D())
        path.moveTo(pt.x + rr, pt.y) // start each subpath on its own circle — no joining lines
        path.arc(pt.x, pt.y, rr, 0, Math.PI * 2)
      } else {
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${rgb},0.42)`
        ctx.fill()
        ctx.lineWidth = r > 10 ? 1.4 : 1
        ctx.strokeStyle = `rgba(${rgb},0.95)`
        ctx.stroke()
        if (r > 6) {
          // bright core: "the source is HERE", not somewhere in the blob
          ctx.beginPath()
          ctx.arc(pt.x, pt.y, Math.min(3, r * 0.18), 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(255,255,255,0.9)'
          ctx.fill()
        }
      }
      const k = D.n++
      D.x[k] = pt.x; D.y[k] = pt.y; D.r[k] = r; D.it[k] = it
    }
    for (const [rgb, path] of Object.entries(small)) {
      ctx.fillStyle = `rgba(${rgb},0.85)`
      ctx.fill(path)
    }
    // Basins last and faint: a region, not a site.
    ctx.save()
    ctx.setLineDash([5, 5])
    for (const [x, y, r, it] of basins) {
      const rgb = this._rgb(it.sec)
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${rgb},0.07)`
      ctx.fill()
      ctx.lineWidth = 1.3
      ctx.strokeStyle = `rgba(${rgb},0.7)`
      ctx.stroke()
      const k = D.n++
      D.x[k] = x; D.y[k] = y; D.r[k] = Math.min(r, 16); D.it[k] = it // click near the center, not anywhere in the region
    }
    ctx.restore()
  }
}
