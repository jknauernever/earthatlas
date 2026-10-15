/**
 * Friends of the San Juans habitat layers drawn exactly as Salish Sea Explorer draws them (Josh 2026-10-15: "display
 * them exactly as they appear on that site"), on a Mapbox map. Ported from salish-sea-propmapper:
 *   src/config/layers.ts (styles, minZoom, haloByZoom), src/components/Map/KelpOverlay.ts (kelp chart squiggles,
 *   herring school, beach fish), src/config/markerIcons.ts + src/hooks/useLayers.ts (pins and their zoom thinning).
 * SSE paints its overlays on a 2D canvas above Google Maps; here the same 2D painting runs inside a Mapbox custom
 * layer (drawn as a texture), so the overlays keep their place in the layer stack, under whatever sits above them.
 *
 * Features carry `h` (src/permits/habitat.js): hfd documented spawning beach, hfp potential, hhe herring, hee eelgrass
 * deep edge, hkb bull kelp. Ids of the Mapbox layers added here start with `fhab-`.
 */

// SSE runs on Google Maps (256 px world at zoom 0); Mapbox's world is 512 px, so the same scale is one zoom level lower
// here. Every zoom below is SSE's (Google) zoom; GZ converts.
const GZ = 1
const gzoom = (map) => map.getZoom() + GZ

// ─── SSE layer styles (layers.ts), keyed by our habitat id ───
export const SSE_STYLE = {
  hhe: { minZoom: 12, fill: '#8B5CF6', fillOpacity: 0.3, stroke: '#6D28D9', strokeWeight: 1.5 },
  hkb: { minZoom: 0 }, // drawn only by the kelp overlay
  hee: { minZoom: 0, stroke: '#20B2AA', strokeWeight: 4.5 },
  hfp: { minZoom: 12, stroke: '#F9A8D4', strokeOpacity: 0.3, halo: { zoomWide: 15, weightWide: 8, zoomNarrow: 18, weightNarrow: 5 } },
  hfd: { minZoom: 12, stroke: '#E11D74', strokeOpacity: 0.38, halo: { zoomWide: 15, weightWide: 10, zoomNarrow: 18, weightNarrow: 6 } },
}
// Mapbox layer ids per habitat id (for visibility toggles and clicks).
export const LAYERS_OF = {
  hhe: ['fhab-hhe-fill', 'fhab-hhe-line', 'fhab-hhe-school'],
  hkb: ['fhab-hkb-hit', 'fhab-hkb-kelp', 'fhab-hkb-pins'],
  hee: ['fhab-hee', 'fhab-hee-pins'],
  hfp: ['fhab-hfp', 'fhab-hfp-fish'],
  hfd: ['fhab-hfd', 'fhab-hfd-fish'],
}
export const CLICK_LAYERS = ['fhab-hkb-pins', 'fhab-hee-pins', 'fhab-hfd', 'fhab-hfp', 'fhab-hee', 'fhab-hhe-fill', 'fhab-hkb-hit']

// haloByZoom: weight interpolates from zoomWide to zoomNarrow (strokeAtZoom in useLayers.ts).
const haloWidth = (h) => ['interpolate', ['linear'], ['zoom'], h.zoomWide - GZ, h.weightWide, h.zoomNarrow - GZ, h.weightNarrow]

// ─── Pins (markerIcons.ts): white teardrop, colored disc, white glyph; 24×26 CSS px, anchor at the nub tip (12, 23) ───
const PIN = {
  eelgrass: { color: '#12A38E', glyph: 'M12 20c-.3-3.5.2-7.6 1.4-11.1.3-.9 1.6-.7 1.5.3-.4 3.4-1.4 7.2-2.9 10.8zM11.4 20C9.6 16.4 7.9 12.5 7.3 8.1c-.1-1 1.2-1.3 1.6-.4 1.6 3.9 2.7 8 2.5 12.3zM12.6 20c.6-3.3 2.2-6.5 4.8-8.9.7-.7 1.7.2 1.2 1-2.2 3-4.3 5.5-6 7.9z' },
  kelp: { color: '#B89A3A', stroke: true, glyph: 'M3.5 9.5c2.8-4.5 5.7-4.5 8.5 0s5.7 4.5 8.5 0M3.5 15.5c2.8-4.5 5.7-4.5 8.5 0s5.7 4.5 8.5 0' },
}
function pinSvg({ color, glyph, stroke }) {
  const g = 16 / 24
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="26" viewBox="0 0 24 26">
  <defs><filter id="sh" x="-25%" y="-15%" width="150%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="0.9" flood-color="#000" flood-opacity="0.32"/></filter></defs>
  <path d="M12 0a11 11 0 0 1 4.2 21.2L12 24.2 7.8 21.2A11 11 0 0 1 12 0z" fill="#FFFFFF" filter="url(#sh)"/>
  <circle cx="12" cy="11" r="9" fill="${color}"/>
  <g transform="translate(${12 - 12 * g} ${11 - 12 * g}) scale(${g})">${stroke
    ? `<path d="${glyph}" fill="none" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="${glyph}" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="0.9" stroke-linejoin="round"/>`}</g></svg>`
}
function addPinImage(map, name, spec) {
  if (map.hasImage(name)) return Promise.resolve()
  return new Promise((resolve) => {
    const img = new Image(48, 52)
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = 48; c.height = 52
      c.getContext('2d').drawImage(img, 0, 0, 48, 52)
      if (!map.hasImage(name)) map.addImage(name, c.getContext('2d').getImageData(0, 0, 48, 52), { pixelRatio: 2 })
      resolve()
    }
    img.onerror = () => resolve()
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pinSvg(spec))}`
  })
}
export const pinDataUri = (kind) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pinSvg(PIN[kind]))}`

// Pin positions (createMidpointMarkers): one per line at its middle, one per kelp patch ≥ 0.05 ac at an interior point;
// lengthRank 0 = longest line / biggest patch, which wins the zoom thinning.
function linePointAt(c, frac = 0.5) {
  if (c.length < 2) return c[0]
  const seg = []; let tot = 0
  for (let i = 1; i < c.length; i++) { const d = Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]); seg.push(d); tot += d }
  const half = tot * frac; let acc = 0
  for (let i = 0; i < seg.length; i++) {
    if (acc + seg[i] >= half) { const f = (half - acc) / seg[i]; return [c[i][0] + f * (c[i + 1][0] - c[i][0]), c[i][1] + f * (c[i + 1][1] - c[i][1])] }
    acc += seg[i]
  }
  return c[c.length - 1]
}
function lineLength(c) {
  let t = 0
  for (let i = 1; i < c.length; i++) t += Math.hypot((c[i][0] - c[i - 1][0]) * Math.cos((c[i][1] * Math.PI) / 180), c[i][1] - c[i - 1][1])
  return t
}
function ringArea(r) { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return a / 2 }
function interiorPoint(rings) {
  const ring = rings[0]
  let minY = Infinity, maxY = -Infinity
  for (const [, y] of ring) { if (y < minY) minY = y; if (y > maxY) maxY = y }
  const cy = (minY + maxY) / 2, xs = []
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [x1, y1] = r[j], [x2, y2] = r[i]
    if ((y1 <= cy) !== (y2 <= cy)) xs.push(x1 + ((cy - y1) * (x2 - x1)) / (y2 - y1))
  }
  xs.sort((a, b) => a - b)
  let bx = NaN, bw = -1
  for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > bw) { bw = xs[k + 1] - xs[k]; bx = (xs[k] + xs[k + 1]) / 2 }
  if (Number.isFinite(bx)) return [bx, cy]
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length]
}
function pinPoints(features, minAcres = 0) {
  const pts = []
  for (const f of features) {
    const g = f.geometry
    if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
      if (minAcres && Number(f.properties.acres) < minAcres) continue
      let best = null
      for (const rings of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) { const a = Math.abs(ringArea(rings[0])); if (!best || a > best.a) best = { rings, a } }
      if (best) pts.push({ at: interiorPoint(best.rings), len: best.a, props: f.properties })
    } else for (const c of g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []) {
      pts.push({ at: linePointAt(c), len: lineLength(c), props: f.properties })
    }
  }
  const rank = new Array(pts.length)
  pts.map((p, i) => [p.len, i]).sort((a, b) => b[0] - a[0]).forEach(([, i], pos) => { rank[i] = pts.length > 1 ? pos / (pts.length - 1) : 0 })
  return pts.map((p, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p.at }, properties: { ...p.props, mid: i, lengthRank: rank[i] } }))
}
// Zoom thinning (selectFromMeta): below zoom 16 one pin per world-pixel grid cell, the longest line's; all pins from 16.
const gridPx = (z) => (z <= 10 ? 180 : z <= 11 ? 150 : z <= 12 ? 120 : z <= 13 ? 100 : z <= 14 ? 84 : 70)
function worldPx0([lng, lat]) {
  const s = Math.sin((lat * Math.PI) / 180)
  return [((lng + 180) / 360) * 256, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256]
}
function chosenPins(pins, zoom) {
  if (zoom >= 16) return null
  const q = Math.round(zoom * 2) / 2, scale = 2 ** q, cell = gridPx(q), best = new Map()
  for (const p of pins) {
    const [x, y] = p.w, key = `${Math.floor((x * scale) / cell)}:${Math.floor((y * scale) / cell)}`
    const cur = best.get(key)
    if (!cur || p.rank < cur.rank) best.set(key, p)
  }
  return [...best.values()].map((p) => p.mid)
}

// ─── The 2D overlays (KelpOverlay.ts) ───
const PHONE = typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches
const MAX_DPR = PHONE ? 1 : 2
const ANIM_FPS = 15
const ANIMATE = !PHONE
const PATTERN_MIN_ZOOM = 12.5
const SCHOOL_MIN_ZOOM = 13
const SCHOOL_PX_PER_FISH = 700
const SCHOOL_MAX_PER_PATCH = 400
const FISH_FILL = 'rgba(255, 255, 255, 0.92)'
const FISH_EDGE = 'rgba(76, 29, 149, 0.8)'
const REF_ZOOM = 12
const CREAM = '#FFF4CC'
const CREAM_RGB = '255, 244, 204'

function mulberry32(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function fishPath(ctx, len) {
  const h = len * 0.28
  ctx.beginPath()
  ctx.moveTo(len * 0.5, 0); ctx.quadraticCurveTo(0, -h, -len * 0.42, 0); ctx.quadraticCurveTo(0, h, len * 0.5, 0)
  ctx.moveTo(-len * 0.38, 0); ctx.lineTo(-len * 0.62, -h * 0.9); ctx.lineTo(-len * 0.62, h * 0.9); ctx.closePath()
}
function squiggleTile(size, scale, dpr) {
  const c = document.createElement('canvas')
  c.width = c.height = Math.round(size * dpr)
  const ctx = c.getContext('2d')
  ctx.scale(dpr, dpr)
  ctx.strokeStyle = CREAM; ctx.fillStyle = CREAM; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 1.4 * scale
  for (const [x0, y0, dir] of [[size * 0.28, size * 0.1, 1], [size * 0.72, size * 0.55, -1]]) {
    const h = size * 0.42
    ctx.beginPath(); ctx.moveTo(x0, y0)
    ctx.bezierCurveTo(x0 + 3 * dir * scale, y0 + h * 0.3, x0 - 3 * dir * scale, y0 + h * 0.6, x0, y0 + h); ctx.stroke()
    for (const t of [0.35, 0.8]) {
      const y = y0 + h * t, sway = Math.sin(t * Math.PI) * 2 * dir * scale
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x0 + sway + side * 2.6 * scale, y, 2.2 * scale, 1.1 * scale, side * 0.6, 0, Math.PI * 2); ctx.fill() }
    }
  }
  return c
}
const world = (lng, lat) => {
  const s = Math.sin((lat * Math.PI) / 180), k = 256 * 2 ** REF_ZOOM
  return [((lng + 180) / 360) * k, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * k]
}

// One frame loop for every animated overlay, capped at ANIM_FPS (SSE's animSubscribe).
const subs = new Set()
let ticking = false
function tick() {
  if (!subs.size) { ticking = false; return }
  setTimeout(() => requestAnimationFrame(tick), 1000 / ANIM_FPS)
  for (const fn of subs) fn()
}
const animOn = (fn) => { if (!ANIMATE) return; subs.add(fn); if (!ticking) { ticking = true; requestAnimationFrame(tick) } }
const animOff = (fn) => subs.delete(fn)

/** A Mapbox custom layer painting one SSE overlay style: 'kelp' | 'school' | 'beach-solid' | 'beach-outline'. */
function overlayLayer(id, style, features) {
  const patches = [], lines = []
  for (const f of features) {
    const g = f.geometry
    if (g.type === 'LineString') lines.push(g.coordinates)
    else if (g.type === 'MultiLineString') lines.push(...g.coordinates)
    for (const rings of g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) patches.push({ rings })
  }
  // Geometry in world px at REF_ZOOM, built once.
  const wpaths = patches.map(({ rings }) => {
    const path = new Path2D(); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const ring of rings) {
      ring.forEach(([lng, lat], i) => { const [x, y] = world(lng, lat); i ? path.lineTo(x, y) : path.moveTo(x, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) })
      path.closePath()
    }
    return { path, bbox: [x0, y0, x1, y1] }
  })
  const wlines = lines.map((line) => {
    const pts = line.map(([lng, lat]) => world(lng, lat))
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
    return { pts, cum, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }
  }).filter((l) => l.pts.length >= 2)
  if (style === 'school') {
    // Seed fish inside each polygon once (deterministic), so they never re-randomize on pan.
    const probe = document.createElement('canvas').getContext('2d'), rnd = mulberry32(0x5eed)
    wpaths.forEach(({ path, bbox: [x0, y0, x1, y1] }, i) => {
      const fish = []; let hits = 0, tries = 0
      while (fish.length < SCHOOL_MAX_PER_PATCH && tries < SCHOOL_MAX_PER_PATCH * 12) {
        tries++
        const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0)
        if (!probe.isPointInPath(path, x, y, 'evenodd')) continue
        hits++; fish.push({ wx: x, wy: y, phase: rnd() * 1000, speed: 0.7 + rnd() * 0.6, wiggle: rnd() * Math.PI * 2 })
      }
      patches[i].fish = fish; patches[i].fillRatio = tries ? hits / tries : 0
    })
  }

  let map, gl, prog, buf, tex, aPos, uTex
  const canvas = document.createElement('canvas')
  const tileCache = new Map()
  const start = performance.now()
  let frame = null, animating = false, dirty = true
  const onAnim = () => { dirty = true; map?.triggerRepaint() }
  const setAnim = (on) => { if (on === animating) return; animating = on; if (on) animOn(onAnim); else animOff(onAnim) }

  function layout() {
    const b = map.getBounds(), z = gzoom(map)
    const tl = map.project([b.getWest(), b.getNorth()]), br = map.project([b.getEast(), b.getSouth()])
    const [wxA, wyA] = world(b.getWest(), b.getNorth()), [wxB, wyB] = world(b.getEast(), b.getSouth())
    const k = ((br.x - tl.x) / (wxB - wxA) + (br.y - tl.y) / (wyB - wyA)) / 2
    const ox = tl.x - wxA * k, oy = tl.y - wyA * k
    const c = map.getCanvas(), w = c.clientWidth, h = c.clientHeight
    const key = `${w}|${h}|${k}|${ox.toFixed(2)}|${oy.toFixed(2)}`
    if (frame?.key === key) return
    const m = new DOMMatrix([k, 0, 0, k, ox, oy])
    const screen = []
    wpaths.forEach(({ path, bbox }, i) => {
      const sb = [bbox[0] * k + ox, bbox[1] * k + oy, bbox[2] * k + ox, bbox[3] * k + oy]
      if (sb[2] < -50 || sb[0] > w + 50 || sb[3] < -50 || sb[1] > h + 50) return
      const sp = new Path2D(); sp.addPath(path, m); screen.push({ path: sp, bbox: sb, i })
    })
    const sl = style.startsWith('beach') ? wlines.filter((l) => !(l.bbox[2] * k + ox < -50 || l.bbox[0] * k + ox > w + 50 || l.bbox[3] * k + oy < -50 || l.bbox[1] * k + oy > h + 50))
      .map((l) => ({ pts: l.pts.map(([x, y]) => [x * k + ox, y * k + oy]), cum: l.cum.map((d) => d * k) })) : []
    frame = { key, w, h, k, ox, oy, zoom: z, screen, lines: sl }
    dirty = true
  }

  function pattern(ctx, zoom, dpr) {
    const step = zoom >= 18 ? 4 : zoom >= 16 ? 3 : zoom >= 14 ? 2 : 1, key = `${step}@${dpr}`
    if (!tileCache.has(key)) tileCache.set(key, ctx.createPattern(squiggleTile(22 + step * 7, 0.85 + step * 0.2, dpr), 'repeat'))
    return tileCache.get(key)
  }

  function paint() {
    const F = frame, dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
    if (canvas.width !== Math.round(F.w * dpr) || canvas.height !== Math.round(F.h * dpr)) { canvas.width = Math.round(F.w * dpr); canvas.height = Math.round(F.h * dpr) }
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, F.w, F.h)
    const t = (performance.now() - start) / 1000
    if (style === 'school') return paintSchool(ctx, F, t)
    if (style.startsWith('beach')) return paintBeach(ctx, F, t, style === 'beach-outline')
    // Kelp: chart squiggles drifting ±3 px over ~7 s from zoom 12.5; a soft cream band when zoomed out.
    const usePattern = F.zoom >= PATTERN_MIN_ZOOM, pat = usePattern ? pattern(ctx, F.zoom, dpr) : null
    setAnim(usePattern)
    if (pat) pat.setTransform(new DOMMatrix().scale(1 / dpr).translate(Math.sin((t / 7) * Math.PI * 2) * 3 * dpr, Math.sin((t / 11) * Math.PI * 2 + 1) * dpr))
    const s = Math.min(1, Math.max(0, (F.zoom - 10) / (PATTERN_MIN_ZOOM - 10))), haloW = 7 - 4 * s
    for (const { path } of F.screen) {
      if (pat) {
        ctx.fillStyle = `rgba(${CREAM_RGB}, 0.18)`; ctx.fill(path, 'evenodd')
        ctx.fillStyle = pat; ctx.fill(path, 'evenodd')
        ctx.strokeStyle = `rgba(${CREAM_RGB}, 0.9)`; ctx.lineWidth = 1.2; ctx.stroke(path)
      } else {
        ctx.strokeStyle = `rgba(${CREAM_RGB}, 0.32)`; ctx.lineWidth = haloW; ctx.lineJoin = 'round'; ctx.stroke(path)
        ctx.fillStyle = `rgba(${CREAM_RGB}, 0.8)`; ctx.fill(path, 'evenodd')
      }
    }
  }
  // Two to five small fish per spawning beach drifting along it; solid for documented, outlined for potential.
  function paintBeach(ctx, F, t, outline) {
    if (F.zoom < SCHOOL_MIN_ZOOM) return setAnim(false)
    setAnim(true)
    const len = F.zoom >= 17 ? 16 : F.zoom >= 15.5 ? 14 : F.zoom >= 14 ? 12 : 10
    ctx.fillStyle = outline ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.95)'
    ctx.strokeStyle = outline ? 'rgba(255, 255, 255, 1)' : 'rgba(120, 20, 70, 0.75)'
    ctx.lineWidth = outline ? 1.4 : 0.9; ctx.lineJoin = 'round'
    const at = (l, frac) => {
      const total = l.cum[l.cum.length - 1], d = Math.min(total, Math.max(0, frac * total))
      let i = 1; while (i < l.cum.length - 1 && l.cum[i] < d) i++
      const a = l.pts[i - 1], b = l.pts[i], u = (d - l.cum[i - 1]) / (l.cum[i] - l.cum[i - 1] || 1)
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, Math.atan2(b[1] - a[1], b[0] - a[0])]
    }
    let seed = 0
    for (const l of F.lines) {
      const total = l.cum[l.cum.length - 1]
      seed++
      if (total < len * 3) continue
      const n = outline ? Math.min(3, Math.max(1, Math.round(total / 90))) : Math.min(5, Math.max(1, Math.round(total / 50)))
      for (let i = 0; i < n; i++) {
        const phase = (seed * 7 + i * 13) % 17
        const frac = Math.min(0.95, Math.max(0.05, (i + 0.5) / n + Math.sin(t * 0.35 + phase) * 0.06))
        const [x, y, ang] = at(l, frac)
        const forward = Math.cos(t * 0.35 + phase) >= 0, size = len * (i % 2 ? 0.85 : 1)
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang + (forward ? 0 : Math.PI) + Math.sin(t * 5 + phase) * 0.1)
        ctx.translate(0, (i % 2 ? 1 : -1) * size * 0.35); fishPath(ctx, size); ctx.fill(); ctx.stroke(); ctx.restore()
      }
    }
  }
  // Herring: each polygon's seeded fish glide east inside it, clipped, with a slow wander and a tail wiggle.
  function paintSchool(ctx, F, t) {
    if (F.zoom < SCHOOL_MIN_ZOOM) return setAnim(false)
    setAnim(true)
    const len = F.zoom >= 17 ? 13 : F.zoom >= 15.5 ? 11 : F.zoom >= 14 ? 9 : 7, drift = len * 1.4
    ctx.fillStyle = FISH_FILL; ctx.strokeStyle = FISH_EDGE; ctx.lineWidth = 0.8; ctx.lineJoin = 'round'
    for (const { path, bbox: [bx0, by0, bx1, by1], i } of F.screen) {
      const p = patches[i]
      if (!p.fish?.length) continue
      const bw = bx1 - bx0, bh = by1 - by0
      if (bw < len * 3 || bh < len * 2) continue
      const n = Math.min(p.fish.length, Math.max(1, Math.round((bw * bh * (p.fillRatio ?? 0.5)) / SCHOOL_PX_PER_FISH)))
      ctx.save(); ctx.clip(path, 'evenodd')
      for (let j = 0; j < n; j++) {
        const f = p.fish[j], sx = f.wx * F.k + F.ox, sy = f.wy * F.k + F.oy
        const adv = (t * drift * f.speed + f.phase) % bw
        const x = bx0 + (((sx - bx0 + adv) % bw) + bw) % bw, y = sy + Math.sin(t * 0.35 + f.wiggle) * len * 0.6
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 5 + f.wiggle) * 0.12); fishPath(ctx, len); ctx.fill(); ctx.stroke(); ctx.restore()
      }
      ctx.restore()
    }
  }

  return {
    id, type: 'custom', renderingMode: '2d',
    onAdd(m, g) {
      map = m; gl = g
      const vs = gl.createShader(gl.VERTEX_SHADER)
      gl.shaderSource(vs, 'attribute vec2 p; varying vec2 v; void main(){ v = vec2((p.x + 1.0) / 2.0, (1.0 - p.y) / 2.0); gl_Position = vec4(p, 0.0, 1.0); }'); gl.compileShader(vs)
      const fs = gl.createShader(gl.FRAGMENT_SHADER)
      gl.shaderSource(fs, 'precision mediump float; uniform sampler2D t; varying vec2 v; void main(){ gl_FragColor = texture2D(t, v); }'); gl.compileShader(fs)
      prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog)
      aPos = gl.getAttribLocation(prog, 'p'); uTex = gl.getUniformLocation(prog, 't')
      buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
      tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex)
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
    },
    onRemove() { setAnim(false); gl?.deleteTexture(tex); gl?.deleteBuffer(buf); gl?.deleteProgram(prog); map = null },
    render(g) {
      if (map.getZoom() < (this.hostMinZoom || 0)) return setAnim(false)
      // Repaint the 2D canvas only when the view moved or an animation tick asked for it; otherwise redraw the texture.
      layout()
      g.useProgram(prog)
      g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, tex)
      if (dirty) {
        paint(); dirty = false
        g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, canvas)
        g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      }
      g.uniform1i(uTex, 0)
      g.bindBuffer(g.ARRAY_BUFFER, buf); g.enableVertexAttribArray(aPos); g.vertexAttribPointer(aPos, 2, g.FLOAT, false, 0, 0)
      g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA)
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
    },
  }
}

/**
 * Add every Friends habitat layer to `map`, below `beforeId` (the permit dots), from a FeatureCollection whose
 * features carry `h`; `minZoom` hides all of it below that Mapbox zoom. Call after each style load. Returns a function
 * that applies the zoom thinning to the pins.
 */
export function addFriendsHabitat(map, fc, beforeId, { minZoom = 0 } = {}) {
  const of = (h) => fc.features.filter((f) => f.properties.h === h)
  map.addSource('fhab', { type: 'geojson', data: fc })
  const S = SSE_STYLE
  // A host may hide all habitat below its own minZoom (Mapbox zoom); SSE's own gates still apply above it.
  const add = (layer) => map.addLayer(layer.type === 'custom' ? Object.assign(layer, { hostMinZoom: minZoom })
    : { ...layer, minzoom: Math.max(layer.minzoom ?? 0, minZoom) }, beforeId)
  // SSE zIndex order: herring 1, eelgrass 2, potential 3, documented 4; overlays paint over the vector layers.
  add({ id: 'fhab-hhe-fill', type: 'fill', source: 'fhab', minzoom: S.hhe.minZoom - GZ, filter: ['==', ['get', 'h'], 'hhe'], paint: { 'fill-color': S.hhe.fill, 'fill-opacity': S.hhe.fillOpacity } })
  add({ id: 'fhab-hhe-line', type: 'line', source: 'fhab', minzoom: S.hhe.minZoom - GZ, filter: ['==', ['get', 'h'], 'hhe'], paint: { 'line-color': S.hhe.stroke, 'line-width': S.hhe.strokeWeight } })
  // Kelp's own layer is a near-transparent click target (SSE: fillOpacity 0.01); the overlay draws it.
  add({ id: 'fhab-hkb-hit', type: 'fill', source: 'fhab', filter: ['==', ['get', 'h'], 'hkb'], paint: { 'fill-color': CREAM, 'fill-opacity': 0.01 } })
  const round = { 'line-cap': 'round', 'line-join': 'round' }
  add({ id: 'fhab-hee', type: 'line', source: 'fhab', filter: ['==', ['get', 'h'], 'hee'], layout: round, paint: { 'line-color': S.hee.stroke, 'line-width': S.hee.strokeWeight } })
  add({ id: 'fhab-hfp', type: 'line', source: 'fhab', minzoom: S.hfp.minZoom - GZ, filter: ['==', ['get', 'h'], 'hfp'], layout: round, paint: { 'line-color': S.hfp.stroke, 'line-opacity': S.hfp.strokeOpacity, 'line-width': haloWidth(S.hfp.halo) } })
  add({ id: 'fhab-hfd', type: 'line', source: 'fhab', minzoom: S.hfd.minZoom - GZ, filter: ['==', ['get', 'h'], 'hfd'], layout: round, paint: { 'line-color': S.hfd.stroke, 'line-opacity': S.hfd.strokeOpacity, 'line-width': haloWidth(S.hfd.halo) } })
  add(overlayLayer('fhab-hkb-kelp', 'kelp', of('hkb')))
  add(overlayLayer('fhab-hhe-school', 'school', of('hhe')))
  add(overlayLayer('fhab-hfp-fish', 'beach-outline', of('hfp')))
  add(overlayLayer('fhab-hfd-fish', 'beach-solid', of('hfd')))

  // Pins: kelp beds ≥ 0.05 ac and eelgrass edges, thinned by zoom like SSE.
  const pins = { hkb: pinPoints(of('hkb'), 0.05), hee: pinPoints(of('hee')) }
  const meta = Object.fromEntries(Object.entries(pins).map(([h, list]) => [h, list.map((f) => ({ mid: f.properties.mid, rank: f.properties.lengthRank, w: worldPx0(f.geometry.coordinates) }))]))
  for (const [h, img] of [['hkb', 'kelp'], ['hee', 'eelgrass']]) {
    map.addSource(`fhab-${h}-pins`, { type: 'geojson', data: { type: 'FeatureCollection', features: pins[h] } })
    addPinImage(map, `fhab-pin-${img}`, PIN[img])
    add({ id: `fhab-${h}-pins`, type: 'symbol', source: `fhab-${h}-pins`,
      layout: { 'icon-image': `fhab-pin-${img}`, 'icon-anchor': 'bottom', 'icon-offset': [0, 3], 'icon-allow-overlap': true, 'icon-ignore-placement': true } })
  }
  let tier = ''
  const thin = () => {
    const z = gzoom(map), t = z >= 16 ? 'all' : String(Math.round(z * 2) / 2)
    if (t === tier) return
    tier = t
    for (const h of ['hkb', 'hee']) {
      const ids = chosenPins(meta[h], z)
      if (map.getLayer(`fhab-${h}-pins`)) map.setFilter(`fhab-${h}-pins`, ids ? ['in', ['get', 'mid'], ['literal', ids]] : null)
    }
  }
  thin()
  return thin
}
