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
const FONT = ['DIN Offc Pro Medium', 'Arial Unicode MS Regular']

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

export function createMeasureTool(map, { onChange } = {}) {
  let armed = false
  let pts = []            // 0, 1, or 2 fixed endpoints
  let cursor = null       // live mouse position while drawing, for the preview leg
  let prevDoubleClickZoom = null

  const emit = () => { if (onChange) onChange({ armed, hasLine: pts.length === 2, drawing: armed && pts.length === 1 }) }

  // ── GeoJSON build ─────────────────────────────────────────────────────────
  const featureCollection = () => {
    const feats = []
    const end = pts.length === 2 ? pts[1] : (pts.length === 1 && cursor ? cursor : null)
    if (pts.length && end) {
      const preview = pts.length < 2
      feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [pts[0], end] }, properties: { kind: preview ? 'preview' : 'line' } })
      feats.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: end },
        properties: { kind: 'pt', end: 1, label: formatDistance(kmBetween(pts[0], end)) },
      })
    }
    for (const c of pts) {
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { kind: 'pt', end: 0, label: '' } })
    }
    return { type: 'FeatureCollection', features: feats }
  }

  const refresh = () => {
    const src = map.getSource(SRC)
    if (src) src.setData(featureCollection())
  }

  // ── Layers (re-added on every style.load while geometry or armed) ─────────
  const ensureLayers = () => {
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
        'circle-radius': ['case', ['==', ['get', 'end'], 1], 5, 4],
        'circle-color': '#ffd166',
        'circle-stroke-color': 'rgba(10,14,23,0.9)',
        'circle-stroke-width': 1.5,
      },
    })
    map.addLayer({
      id: LBL, type: 'symbol', source: SRC,
      filter: ['==', ['get', 'kind'], 'pt'],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': FONT,
        'text-size': 14,
        'text-offset': [0, -1.1],
        'text-anchor': 'bottom',
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#ffd166',
        'text-halo-color': 'rgba(10,14,23,0.95)',
        'text-halo-width': 1.6,
      },
    })
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

  return { arm, disarm, clear, destroy, isArmed: () => armed, hasLine: () => pts.length === 2 }
}
