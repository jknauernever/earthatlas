// ─── Measure tool — two-point distance ruler for any EarthAtlas map ──────────
// Shared across map tools (see docs/MAP_TOOL_CONVENTIONS.md §5). Interaction
// contract (per Josh's spec): activating the ruler arms a SINGLE measurement —
// the first map click starts the line, the second finishes it, and the tool
// immediately disarms itself so plain clicks go back to the host's popup. The
// finished line (with its distance label) STAYS on the map. Starting a new
// measurement replaces it; `clear()` removes it; pressing the ruler while armed
// cancels. While armed, the HOST must check `isArmed()` at the top of its own
// click handler and bail so the two clicks don't also open popups.
//
// The line survives pan/zoom and basemap switches (re-added on style.load).
// Distances are geodesic (haversine), labeled plain-language: miles first with
// km alongside, feet/meters below ~0.2 mi.

const SRC = 'ea-measure'
const LINE = 'ea-measure-line'
const PTS = 'ea-measure-pts'
const LBL = 'ea-measure-lbl'

// Present in every Mapbox-hosted style's glyph endpoint (all our basemaps).
const FONT = ['DIN Offc Pro Bold', 'Arial Unicode MS Bold']

const R_EARTH_KM = 6371.0088
export function kmBetween([lng1, lat1], [lng2, lat2]) {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(a))
}

// "870 ft (265 m)" below ~0.2 mi, else "3.2 mi (5.1 km)"; whole numbers once big.
export function formatDistance(km) {
  const mi = km * 0.621371
  if (mi < 0.2) return `${Math.round(mi * 5280)} ft (${Math.round(km * 1000)} m)`
  const f = (v) => (v >= 100 ? Math.round(v).toLocaleString() : v >= 10 ? v.toFixed(1) : v.toFixed(2).replace(/0$/, ''))
  return `${f(mi)} mi (${f(km)} km)`
}

// White rounded-rect plate behind the distance label, generated on a canvas so
// there's no asset to ship. Registered as a stretchable image (9-patch) that
// icon-text-fit expands to the text. Style-scoped, so re-added on style.load.
const PLATE = 'ea-measure-plate'
function makePlateImage() {
  const r = 2 // pixelRatio
  // Small rigid frame (just enough for the rounded corners) so the fitted box
  // hugs the text instead of ballooning past it.
  const w = 20 * r, h = 16 * r, rad = 4 * r, bw = 1 * r
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  const ctx = cv.getContext('2d')
  ctx.beginPath()
  ctx.roundRect(bw / 2, bw / 2, w - bw, h - bw, rad)
  ctx.fillStyle = 'rgba(255,255,255,0.65)' // translucent — terrain stays readable underneath
  ctx.fill()
  ctx.lineWidth = bw
  ctx.strokeStyle = 'rgba(10,14,23,0.55)'
  ctx.stroke()
  return { data: ctx.getImageData(0, 0, w, h), options: {
    pixelRatio: r,
    // Stretch zones + content box (in image px, pre-ratio): corners rigid,
    // middle band stretches; content box symmetric so the text sits centered.
    stretchX: [[7, 13]], stretchY: [[6, 10]], content: [6, 5, 14, 11],
  } }
}

// Midpoint of the segment AS RENDERED: Mapbox draws LineStrings straight in
// Web-Mercator screen space, so averaging raw lat puts the label off the line
// on long north–south spans. Average in projected space and unproject.
function segmentMidpoint([lng1, lat1], [lng2, lat2]) {
  const rad = Math.PI / 180
  const y = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2))
  const midY = (y(lat1) + y(lat2)) / 2
  return [(lng1 + lng2) / 2, (2 * Math.atan(Math.exp(midY)) - Math.PI / 2) / rad]
}

export function createMeasureTool(map, { onChange } = {}) {
  let armed = false
  let pts = []            // 0, 1, or 2 fixed endpoints
  let cursor = null       // live mouse position while drawing, for the preview leg
  let prevDoubleClickZoom = null

  const emit = () => { if (onChange) onChange({ armed, hasLine: pts.length === 2, drawing: armed && pts.length === 1, line: pts.length === 2 ? pts.map((c) => [...c]) : null }) }

  // ── GeoJSON build ─────────────────────────────────────────────────────────
  const featureCollection = () => {
    const feats = []
    const end = pts.length === 2 ? pts[1] : (pts.length === 1 && cursor ? cursor : null)
    if (pts.length && end) {
      const preview = pts.length < 2
      feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [pts[0], end] }, properties: { kind: preview ? 'preview' : 'line' } })
      // The distance plate sits at the line's midpoint — it reads as "the
      // length of THIS line" and leaves both endpoints visible.
      feats.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: segmentMidpoint(pts[0], end) },
        properties: { kind: 'label', label: formatDistance(kmBetween(pts[0], end)) },
      })
    }
    for (const c of pts) {
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { kind: 'pt', label: '' } })
    }
    return { type: 'FeatureCollection', features: feats }
  }

  const refresh = () => {
    const src = map.getSource(SRC)
    if (src) src.setData(featureCollection())
  }

  // ── Layers (re-added on every style.load while geometry or armed) ─────────
  const ensureImage = () => {
    if (!map.hasImage(PLATE)) {
      const { data, options } = makePlateImage()
      map.addImage(PLATE, data, options)
    }
  }
  const ensureLayers = () => {
    ensureImage()
    if (map.getSource(SRC)) { refresh(); return }
    map.addSource(SRC, { type: 'geojson', data: featureCollection() })
    map.addLayer({
      id: LINE, type: 'line', source: SRC,
      filter: ['in', ['get', 'kind'], ['literal', ['line', 'preview']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ffd166',
        'line-width': 2.5,
        'line-dasharray': ['case', ['==', ['get', 'kind'], 'preview'], ['literal', [1.2, 1.6]], ['literal', [1, 0]]],
      },
    })
    map.addLayer({
      id: PTS, type: 'circle', source: SRC,
      filter: ['==', ['get', 'kind'], 'pt'],
      paint: {
        'circle-radius': 4.5,
        'circle-color': '#ffd166',
        'circle-stroke-color': 'rgba(10,14,23,0.9)',
        'circle-stroke-width': 1.5,
      },
    })
    map.addLayer({
      id: LBL, type: 'symbol', source: SRC,
      filter: ['==', ['get', 'kind'], 'label'],
      layout: {
        // The distance IS the story a shared link tells — a headline on a
        // white plate (the stretchable PLATE image), not a map label.
        'text-field': ['get', 'label'],
        'text-font': FONT,
        'text-size': 16,
        'text-anchor': 'center',
        'text-allow-overlap': true,
        'icon-image': PLATE,
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [2, 6, 2, 6],
        'icon-allow-overlap': true,
      },
      paint: {
        'text-color': '#0a0e17',
      },
    })
    raiseToTop()
  }

  // The measurement is meta-information ABOUT the map — it must never be
  // buried under data layers. Exposed as `raise()` so the HOST calls it at the
  // end of its own restack routine (the one place that owns z-order); GL v3
  // has no reliable event for "some layer moved above you".
  const raiseToTop = () => {
    for (const id of [LINE, PTS, LBL]) {
      try { if (map.getLayer(id)) map.moveLayer(id) } catch { /* mid style swap */ } // no beforeId → top
    }
  }

  // Keep the measurement alive across basemap switches.
  const onStyleLoad = () => { if (armed || pts.length) ensureLayers() }
  map.on('style.load', onStyleLoad)

  // ── Interaction ───────────────────────────────────────────────────────────
  const onClick = (e) => {
    pts.push([e.lngLat.lng, e.lngLat.lat])
    if (pts.length >= 2) {
      pts = pts.slice(0, 2)
      refresh()
      // Second click completes the measurement: keep the line, hand plain
      // clicks straight back to the host's popup. Disarm on the NEXT tick so
      // the host's click handler (which runs after ours for this same event)
      // still sees isArmed() and skips opening a popup on the finishing click.
      setTimeout(() => disarm({ keep: true }), 0)
    } else {
      refresh(); emit()
    }
  }
  const onMove = (e) => {
    if (pts.length !== 1) return
    cursor = [e.lngLat.lng, e.lngLat.lat]
    refresh()
  }
  const onKey = (e) => {
    if (e.key === 'Escape') disarm({ keep: false })
  }

  function arm() {
    if (armed) return
    armed = true
    pts = []; cursor = null
    // If armed mid-style-load, addSource/addLayer can throw; the style.load
    // hook re-adds everything once the style settles, so arming still works.
    try { ensureLayers() } catch { /* re-added on style.load */ }
    refresh()
    map.getCanvas().style.cursor = 'crosshair'
    prevDoubleClickZoom = map.doubleClickZoom.isEnabled()
    map.doubleClickZoom.disable()
    map.on('click', onClick)
    map.on('mousemove', onMove)
    window.addEventListener('keydown', onKey)
    emit()
  }

  // keep:true (measurement finished) leaves the line on the map;
  // keep:false (cancel) wipes it.
  function disarm({ keep = false } = {}) {
    if (!armed) return
    armed = false
    if (!keep) pts = []
    cursor = null
    map.off('click', onClick)
    map.off('mousemove', onMove)
    window.removeEventListener('keydown', onKey)
    map.getCanvas().style.cursor = ''
    if (prevDoubleClickZoom) map.doubleClickZoom.enable()
    refresh(); emit()
  }

  // For URL round-tripping: the finished line's endpoints, or null.
  function getLine() {
    return pts.length === 2 ? pts.map((c) => [...c]) : null
  }
  // Restore a finished line (e.g. from a shared URL) without arming.
  function setLine(two) {
    if (!Array.isArray(two) || two.length !== 2) return
    pts = two.map((c) => [c[0], c[1]])
    try { ensureLayers() } catch { /* re-added on style.load */ }
    refresh(); emit()
  }

  function clear() {
    pts = []; cursor = null
    refresh(); emit()
  }

  function destroy() {
    disarm({ keep: false })
    map.off('style.load', onStyleLoad)
    for (const id of [LBL, PTS, LINE]) { if (map.getLayer(id)) map.removeLayer(id) }
    if (map.getSource(SRC)) map.removeSource(SRC)
  }

  return { arm, disarm, clear, destroy, isArmed: () => armed, hasLine: () => pts.length === 2, getLine, setLine, raise: raiseToTop }
}
