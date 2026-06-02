/**
 * EarthAtlas CarbonApp — land-carbon calculator at /carbon.
 *
 * Draw a parcel on the map; get a measured estimate of the carbon stored in
 * its vegetation and soil. A native EarthAtlas rebuild of the standalone
 * "carbon-calculation-mapper" project — but with the simulated numbers replaced
 * by REAL Earth Engine zonal statistics (see api/carbon.js → the gee-tile-server
 * /api/carbon endpoint). Same EarthAtlas idiom as /quakes and /fire: full-bleed
 * Mapbox map, dark-glass panels, shared GeoSearch + ZoomIndicator, satellite
 * default, shareable URL state. The new elements for the codebase are polygon
 * drawing (@mapbox/mapbox-gl-draw) and the carbon results panel.
 *
 * Data (all measured rasters, no simulation):
 *   • Above/below-ground biomass carbon — NASA/ORNL Biomass Carbon Density
 *   • Soil organic carbon — OpenLandMap SOC content × bulk density (0–30 cm)
 *   • Land cover — ESA WorldCover · Vegetation — Sentinel-2 NDVI
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import GeoSearch from '../components/GeoSearch.jsx'
import ZoomIndicator from '../components/ZoomIndicator.jsx'
import styles from './CarbonApp.module.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

const DEFAULT_VIEW = { center: [-98.5, 39.5], zoom: 3.4 }

const BASEMAPS = [
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'dark', label: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'light', label: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'streets', label: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
  { id: 'outdoors', label: 'Outdoors', style: 'mapbox://styles/mapbox/outdoors-v12' },
]
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[0]).style

// Raster overlay toggles, served (with the GEE key injected) by /api/carbon.
const OVERLAYS = [
  { id: 'ndvi', label: 'NDVI (greenness)', legend: 'Low → high vegetation', gradient: 'linear-gradient(to right,#FF0000,#FFFF00,#00FF00)' },
  { id: 'urban', label: 'Land cover', legend: 'ESA WorldCover classes', gradient: 'linear-gradient(to right,#006400,#FFA500,#FFFF00,#FF0000,#0000FF)' },
]

const OVERLAY_SOURCE = 'carbon-overlay-src'
const OVERLAY_LAYER = 'carbon-overlay-layer'

// ─── Geometry helpers ───────────────────────────────────────────────────────
const toRad = (d) => (d * Math.PI) / 180

// Spherical polygon area (m²) — same approximation as turf.area; used for an
// instant on-screen readout while the server returns the authoritative figure.
function ringAreaM2(ring) {
  const R = 6378137
  const n = ring.length
  if (n < 3) return 0
  let total = 0
  for (let i = 0; i < n; i++) {
    const [lng1, lat1] = ring[i]
    const [lng2, lat2] = ring[(i + 1) % n]
    total += (toRad(lng2) - toRad(lng1)) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)))
  }
  return Math.abs((total * R * R) / 2)
}

// A ring's centroid (for framing the camera on a hydrated polygon).
function ringCentroid(ring) {
  let x = 0, y = 0
  for (const [lng, lat] of ring) { x += lng; y += lat }
  return [x / ring.length, y / ring.length]
}

// ─── Shareable URL state ────────────────────────────────────────────────────
// Round-trips the full view (camera + basemap + active overlay + the drawn
// polygon) into the query string — see docs/MAP_TOOL_CONVENTIONS.md. Params,
// each omitted at its default:
//   bm           basemap id (default 'satellite')
//   ov           active overlay id (none by default)
//   lat,lng,z    map camera
//   poly         drawn polygon ring as "lng,lat;lng,lat;…" (5-dp), unclosed
function readUrlState() {
  if (typeof window === 'undefined') return {}
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => { const v = sp.get(k); const n = v == null ? NaN : Number(v); return Number.isFinite(n) ? n : null }
  let poly = null
  const raw = sp.get('poly')
  if (raw) {
    const pts = raw.split(';').map((p) => p.split(',').map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite))
    if (pts.length >= 3) poly = pts
  }
  return { bm: sp.get('bm'), ov: sp.get('ov'), lat: num('lat'), lng: num('lng'), z: num('z'), poly }
}

function encodePoly(ring) {
  // Drop the closing vertex if present, round to 5 dp (~1 m).
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1) : ring
  return pts.map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(';')
}

function writeUrlQuery(qs) {
  if (typeof window === 'undefined') return
  const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
  if (url === window.location.pathname + window.location.search + window.location.hash) return
  window.history.replaceState(window.history.state, '', url)
}

const fmt = (n, d = 1) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }))

export default function CarbonApp() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const drawRef = useRef(null)
  // Ref to the latest addOverlayToMap — declared up here (before the map-init
  // effect that closes over it) so the style.load handler can re-add the
  // current overlay after a basemap switch without a TDZ reference error.
  const addOverlayRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)

  const initial = (typeof window !== 'undefined') ? readUrlState() : {}
  const initialCamera = (Number.isFinite(initial.lat) && Number.isFinite(initial.lng) && Number.isFinite(initial.z))
    ? { lat: initial.lat, lng: initial.lng, zoom: initial.z } : null
  const initialPolyRef = useRef(initial.poly || null)

  const [basemap, setBasemap] = useState(() => (BASEMAPS.some((b) => b.id === initial.bm) ? initial.bm : 'satellite'))
  const [basemapMenuOpen, setBasemapMenuOpen] = useState(false)
  const basemapMenuRef = useRef(null)
  const [activeOverlay, setActiveOverlay] = useState(() => (OVERLAYS.some((o) => o.id === initial.ov) ? initial.ov : null))

  const [drawnRing, setDrawnRing] = useState(null)       // [[lng,lat],…] closed ring, or null
  const [areaHa, setAreaHa] = useState(null)             // instant client estimate
  const [result, setResult] = useState(null)            // server carbon JSON
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const [showMethodology, setShowMethodology] = useState(false)
  const [mapView, setMapView] = useState(initialCamera)
  const suppressFlyRef = useRef(!!(initialCamera || initialPolyRef.current))

  // ─── Carbon calculation (POST the polygon to our proxy) ───────────────────
  const calcCarbon = useCallback(async (geometry) => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const r = await fetch('/api/carbon', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ geometry }),
      })
      // Parse defensively — a 404/HTML or empty body would otherwise throw a
      // cryptic "Unexpected end of JSON input" instead of a useful message.
      const text = await r.text()
      let data
      try { data = JSON.parse(text) } catch { data = null }
      if (!r.ok || !data || !data.success) {
        throw new Error((data && data.error) || `Calculation failed (HTTP ${r.status}).`)
      }
      setResult(data)
    } catch (e) {
      setError(e.message || 'Could not calculate carbon for this area.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Read the current polygon out of Draw and kick off a calculation.
  const syncFromDraw = useCallback(() => {
    const draw = drawRef.current
    if (!draw) return
    const fc = draw.getAll()
    const feat = fc.features[fc.features.length - 1]
    if (!feat || feat.geometry.type !== 'Polygon') { setDrawnRing(null); setAreaHa(null); setResult(null); return }
    const ring = feat.geometry.coordinates[0]
    setDrawnRing(ring)
    setAreaHa(ringAreaM2(ring) / 10000)
    calcCarbon({ type: 'Polygon', coordinates: feat.geometry.coordinates })
  }, [calcCarbon])

  // ─── Map init (once) ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN

    const startCamera = initialCamera
      || (initialPolyRef.current ? (() => { const [lng, lat] = ringCentroid(initialPolyRef.current); return { lng, lat, zoom: 13 } })() : null)
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: basemapStyleFor(basemap),
      center: startCamera ? [startCamera.lng, startCamera.lat] : DEFAULT_VIEW.center,
      zoom: startCamera ? startCamera.zoom : DEFAULT_VIEW.zoom,
      preserveDrawingBuffer: true,
    })
    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')

    // Polygon drawing — controls hidden; driven by our own dark-glass buttons.
    const draw = new MapboxDraw({ displayControlsDefault: false, controls: {} })
    drawRef.current = draw
    map.addControl(draw)
    map.on('draw.create', syncFromDraw)
    map.on('draw.update', syncFromDraw)
    map.on('draw.delete', () => { setDrawnRing(null); setAreaHa(null); setResult(null); setError(null) })

    map.on('moveend', () => { const c = map.getCenter(); setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }) })

    // style.load fires on the initial style AND after each basemap switch — so
    // re-assert readiness and re-add the overlay raster each time (setStyle
    // wipes custom sources/layers). More robust than 'load' under StrictMode
    // with the satellite style — mirrors /fire and /quakes. Call through a ref
    // so a later basemap switch re-adds the CURRENT overlay, not the mount-time
    // one captured by this closure.
    map.on('style.load', () => { setMapReady(true); addOverlayRef.current?.() })

    // Restore a shared polygon: add it to Draw and calculate, once on load.
    map.once('load', () => {
      if (initialPolyRef.current) {
        const ring = initialPolyRef.current
        const closed = (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ? ring : [...ring, ring[0]]
        draw.add({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [closed] } })
        setDrawnRing(closed)
        setAreaHa(ringAreaM2(closed) / 10000)
        calcCarbon({ type: 'Polygon', coordinates: [closed] })
      }
    })

    return () => { map.remove(); mapRef.current = null; drawRef.current = null; setMapReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Overlay raster: add/update the active overlay layer ───────────────────
  const overlayUrlRef = useRef({}) // cache fetched tile templates by overlay id
  const addOverlayToMap = useCallback(async () => {
    const map = mapRef.current
    if (!map) return
    // Remove any existing overlay first.
    if (map.getLayer(OVERLAY_LAYER)) map.removeLayer(OVERLAY_LAYER)
    if (map.getSource(OVERLAY_SOURCE)) map.removeSource(OVERLAY_SOURCE)
    if (!activeOverlay) return
    let url = overlayUrlRef.current[activeOverlay]
    if (!url) {
      try {
        const r = await fetch(`/api/carbon?overlay=${activeOverlay}`)
        const d = await r.json()
        url = d.tileUrl
        if (url) overlayUrlRef.current[activeOverlay] = url
      } catch { /* surfaced below */ }
    }
    const live = mapRef.current
    if (!url || !live || live._removed) { if (!url) setError('Overlay layer is unavailable right now.'); return }
    if (live.getSource(OVERLAY_SOURCE)) return
    live.addSource(OVERLAY_SOURCE, { type: 'raster', tiles: [url], tileSize: 256 })
    // Insert below Draw's layers so the drawn polygon stays visible on top.
    const firstDraw = live.getStyle().layers.find((l) => l.id.startsWith('gl-draw'))
    live.addLayer({ id: OVERLAY_LAYER, type: 'raster', source: OVERLAY_SOURCE, paint: { 'raster-opacity': 0.7 } }, firstDraw?.id)
  }, [activeOverlay])

  // Keep the ref (declared above) pointed at the latest addOverlayToMap so the
  // map-init style.load handler always re-adds the CURRENT overlay.
  useEffect(() => { addOverlayRef.current = addOverlayToMap }, [addOverlayToMap])
  useEffect(() => { if (mapReady) addOverlayToMap() }, [activeOverlay, mapReady, addOverlayToMap])

  // ─── Basemap switch ───────────────────────────────────────────────────────
  const appliedBasemapRef = useRef(basemap)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (appliedBasemapRef.current === basemap) return
    appliedBasemapRef.current = basemap
    map.setStyle(basemapStyleFor(basemap)) // style.load re-adds overlay; Draw persists its own layers
  }, [basemap, mapReady])

  // ─── Persist the full view to the URL ─────────────────────────────────────
  useEffect(() => {
    const sp = new URLSearchParams()
    if (basemap !== 'satellite') sp.set('bm', basemap)
    if (activeOverlay) sp.set('ov', activeOverlay)
    if (mapView) { sp.set('lat', mapView.lat.toFixed(3)); sp.set('lng', mapView.lng.toFixed(3)); sp.set('z', mapView.zoom.toFixed(1)) }
    if (drawnRing && drawnRing.length >= 3) sp.set('poly', encodePoly(drawnRing))
    writeUrlQuery(sp.toString())
  }, [basemap, activeOverlay, mapView, drawnRing])

  useEffect(() => {
    if (!basemapMenuOpen) return
    const onDoc = (e) => { if (basemapMenuRef.current && !basemapMenuRef.current.contains(e.target)) setBasemapMenuOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [basemapMenuOpen])

  // ─── Per-route SEO (the static carbon.html covers crawlers) ───────────────
  useEffect(() => {
    const prevTitle = document.title
    document.title = 'Carbon — Land carbon calculator · EarthAtlas'
    const setMeta = (sel, val) => { const el = document.head.querySelector(sel); if (!el) return null; const prev = el.getAttribute('content'); el.setAttribute('content', val); return prev }
    const desc = 'Draw any parcel and estimate the carbon stored in its vegetation and soil — from measured satellite datasets (NASA/ORNL biomass, OpenLandMap soil, ESA WorldCover). An EarthAtlas tool.'
    const prevDesc = setMeta('meta[name="description"]', desc)
    const prevOgT = setMeta('meta[property="og:title"]', document.title)
    const prevOgD = setMeta('meta[property="og:description"]', desc)
    const prevOgU = setMeta('meta[property="og:url"]', 'https://earthatlas.org/carbon')
    return () => {
      document.title = prevTitle
      if (prevDesc != null) setMeta('meta[name="description"]', prevDesc)
      if (prevOgT != null) setMeta('meta[property="og:title"]', prevOgT)
      if (prevOgD != null) setMeta('meta[property="og:description"]', prevOgD)
      if (prevOgU != null) setMeta('meta[property="og:url"]', prevOgU)
    }
  }, [])

  // ─── Handlers ─────────────────────────────────────────────────────────────
  const handleSelect = useCallback((r) => {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return
    mapRef.current?.flyTo({ center: [r.lng, r.lat], zoom: 15, duration: 1400, essential: true })
  }, [])

  const startDrawing = useCallback(() => {
    const draw = drawRef.current
    if (!draw) return
    draw.deleteAll()
    setDrawnRing(null); setAreaHa(null); setResult(null); setError(null)
    draw.changeMode('draw_polygon')
  }, [])

  const clearDrawing = useCallback(() => {
    drawRef.current?.deleteAll()
    setDrawnRing(null); setAreaHa(null); setResult(null); setError(null)
  }, [])

  // ─── No token guard ───────────────────────────────────────────────────────
  if (!MAPBOX_TOKEN) {
    return (
      <div className={styles.container}>
        <div className={styles.tokenError}><strong>Mapbox token missing.</strong> Set <code>VITE_MAPBOX_TOKEN</code> to load the map.</div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.mapWrap} ref={containerRef} />
      {mapReady && <ZoomIndicator map={mapRef.current} />}

      {/* Branding */}
      <div className={styles.branding}>
        <a className={styles.brandingLink} href="/" aria-label="EarthAtlas home">
          <span className={styles.wordmark}>Earth<em>Atlas</em></span>
        </a>
        <span className={styles.subBadge}>Carbon</span>
      </div>

      {/* Search */}
      <div className={styles.searchBox}>
        <GeoSearch
          placeholder="Search a place, then draw your parcel…"
          proximity={() => { const m = mapRef.current; if (!m) return undefined; try { const c = m.getCenter(); return { lng: c.lng, lat: c.lat } } catch { return undefined } }}
          onSelect={handleSelect}
        />
      </div>

      {/* Basemap picker */}
      <div className={styles.basemapMenu} ref={basemapMenuRef}>
        <button className={basemapMenuOpen ? styles.basemapToggleActive : styles.basemapToggle} onClick={() => setBasemapMenuOpen((o) => !o)} aria-label="Choose basemap" title="Basemap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
          </svg>
        </button>
        {basemapMenuOpen && (
          <div className={styles.basemapMenuPanel}>
            <div className={styles.basemapMenuTitle}>Basemap</div>
            {BASEMAPS.map((b) => (
              <button key={b.id} className={b.id === basemap ? styles.basemapMenuItemActive : styles.basemapMenuItem} onClick={() => { setBasemap(b.id); setBasemapMenuOpen(false) }}>
                <span className={styles.basemapMenuItemLabel}>{b.label}</span>
                {b.id === basemap && <span className={styles.basemapMenuCheck}>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Control / results panel */}
      <div className={`${styles.panel} ${panelOpen ? '' : styles.panelCollapsed}`}>
        <div className={styles.panelHead}>
          <span className={styles.panelTitle}>Land carbon</span>
          <button className={styles.panelCollapse} onClick={() => setPanelOpen((o) => !o)} aria-label={panelOpen ? 'Collapse' : 'Expand'}>{panelOpen ? '▾' : '▸'}</button>
        </div>

        {panelOpen && (
          <div className={styles.panelBody}>
            {/* Draw controls */}
            <div className={styles.drawRow}>
              <button className={styles.drawBtn} onClick={startDrawing}>✏️ Draw area</button>
              <button className={styles.clearBtn} onClick={clearDrawing} disabled={!drawnRing}>Clear</button>
            </div>
            {!drawnRing && !loading && (
              <p className={styles.hint}>Click <strong>Draw area</strong>, then click the map to drop the corners of your parcel. Double-click to finish. Drag a vertex to adjust.</p>
            )}

            {/* Area readout */}
            {areaHa != null && (
              <div className={styles.areaRow}>
                <span className={styles.areaVal}>{fmt(result?.area?.hectares ?? areaHa, 2)} ha</span>
                <span className={styles.areaSub}>{fmt((result?.area?.acres ?? areaHa * 2.47105), 2)} acres</span>
              </div>
            )}

            {/* Status */}
            {loading && (
              <div className={styles.status}><span className={styles.spinner} /> Sampling satellite datasets…</div>
            )}
            {error && <div className={styles.statusError}>{error}</div>}

            {/* Results */}
            {result && !loading && (
              <>
                <div className={styles.totalCard}>
                  <div className={styles.totalLabel}>Estimated carbon stored</div>
                  <div className={styles.totalVal}>{fmt(result.co2e_tonnes.total, 0)} <span className={styles.totalUnit}>t CO₂e</span></div>
                  <div className={styles.totalSub}>= {fmt(result.carbon_tonnes.total, 0)} t carbon{result.uncertainty_co2e?.biomass_plus_minus ? ` · biomass ±${fmt(result.uncertainty_co2e.biomass_plus_minus, 0)} t CO₂e` : ''}</div>
                </div>

                <div className={styles.poolList}>
                  <PoolRow label="Above-ground biomass" co2e={result.co2e_tonnes.above_ground_biomass} density={result.density_t_c_per_ha.above_ground_biomass} color="#34d399" />
                  <PoolRow label="Below-ground biomass" co2e={result.co2e_tonnes.below_ground_biomass} density={result.density_t_c_per_ha.below_ground_biomass} color="#a3e635" />
                  <PoolRow label="Soil organic carbon" co2e={result.co2e_tonnes.soil_organic} density={result.density_t_c_per_ha.soil_organic} color="#c084fc" />
                </div>

                {/* Land cover */}
                {result.land_cover?.length > 0 && (
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Land cover</label>
                    {result.land_cover.slice(0, 6).map((c) => (
                      <div key={c.code} className={styles.lcRow}>
                        <span className={styles.lcLabel}>{c.label}</span>
                        <span className={styles.lcBarWrap}><span className={styles.lcBar} style={{ width: `${Math.min(100, c.percent)}%` }} /></span>
                        <span className={styles.lcPct}>{fmt(c.percent, 0)}%</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Vegetation */}
                {result.vegetation?.ndvi_mean != null && (
                  <div className={styles.vegRow}>
                    <span>NDVI {fmt(result.vegetation.ndvi_mean, 2)}</span>
                    {result.vegetation.ndvi_std != null && <span className={styles.vegSub}>±{fmt(result.vegetation.ndvi_std, 2)}</span>}
                    {result.vegetation.sentinel2_scenes != null && <span className={styles.vegSub}>· {result.vegetation.sentinel2_scenes} S-2 scenes</span>}
                  </div>
                )}
              </>
            )}

            {/* Overlays */}
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Map overlay</label>
              <div className={styles.chipRow}>
                <button className={!activeOverlay ? styles.chipActive : styles.chip} onClick={() => setActiveOverlay(null)}>None</button>
                {OVERLAYS.map((o) => (
                  <button key={o.id} className={activeOverlay === o.id ? styles.chipActive : styles.chip} onClick={() => setActiveOverlay(o.id)}>{o.label}</button>
                ))}
              </div>
              {activeOverlay && (() => { const o = OVERLAYS.find((x) => x.id === activeOverlay); return (
                <><div className={styles.legendBar} style={{ background: o.gradient }} /><div className={styles.legendNote}>{o.legend}</div></>
              ) })()}
            </div>

            <button type="button" className={styles.methodology} onClick={() => setShowMethodology(true)}>ⓘ How this is calculated</button>
            <p className={styles.disclaimer}>Educational estimate from global satellite datasets — useful for landscape-level awareness, <strong>not</strong> a substitute for field measurement or carbon-credit verification.</p>

            <div className={styles.builtBy}>EarthAtlas is built by <a href="https://knauernever.com" target="_blank" rel="noopener noreferrer" className={styles.builtByLink}>KnauerNever.com</a></div>
          </div>
        )}
      </div>

      <div className={styles.tip}>Draw a parcel to estimate its stored carbon · search a place to get there fast</div>

      {showMethodology && <MethodologyModal onClose={() => setShowMethodology(false)} />}
    </div>
  )
}

function PoolRow({ label, co2e, density, color }) {
  return (
    <div className={styles.poolRow}>
      <span className={styles.poolDot} style={{ background: color }} />
      <span className={styles.poolLabel}>{label}</span>
      <span className={styles.poolVals}>
        <span className={styles.poolCo2e}>{fmt(co2e, 0)} t CO₂e</span>
        <span className={styles.poolDensity}>{fmt(density, 1)} t C/ha</span>
      </span>
    </div>
  )
}

// ─── "How this is calculated" modal ─────────────────────────────────────────
function MethodologyModal({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">×</button>
        <h2 className={styles.modalTitle}>How this is calculated</h2>

        <section className={styles.modalSection}>
          <h3>What you're looking at</h3>
          <p>
            When you draw a parcel, EarthAtlas samples published, <strong>measured</strong> satellite
            datasets over that exact shape using Google Earth Engine zonal statistics, and reports the
            carbon stored in three pools — above-ground biomass, below-ground (root) biomass, and soil.
            The same parcel always returns the same numbers; nothing is simulated or randomized.
          </p>
        </section>

        <section className={styles.modalSection}>
          <h3>Where the data comes from</h3>
          <ul>
            <li><strong>Above-ground biomass — ESA CCI Biomass v6.0</strong> (100 m, 2022): measured oven-dry woody biomass with a per-pixel uncertainty band, converted to carbon using the IPCC 0.47 carbon fraction.</li>
            <li><strong>Below-ground biomass</strong> is modeled from above-ground using an IPCC root-to-shoot ratio (0.24) — there is no fine-resolution global measured root-carbon product.</li>
            <li><strong>Soil organic carbon — OpenLandMap</strong> soil organic carbon content (g/kg) combined with bulk density, integrated over the top 0–30 cm to a stock in t C/ha (250 m).</li>
            <li><strong>Land cover — ESA WorldCover</strong> (10 m) describes the make-up of the parcel.</li>
            <li><strong>Vegetation — Copernicus Sentinel-2</strong> median NDVI (last 12 months) as a greenness indicator.</li>
          </ul>
        </section>

        <section className={styles.modalSection}>
          <h3>From carbon to CO₂e</h3>
          <p>
            Carbon stock is reported both as tonnes of carbon (t C) and as carbon-dioxide equivalent
            (t CO₂e = t C × 44/12 ≈ 3.67). Area is the true geodesic area of your polygon. The ± figure is
            the biomass datasets' own propagated uncertainty.
          </p>
        </section>

        <section className={styles.modalSection}>
          <h3>Limitations</h3>
          <p>
            These are <strong>global</strong> datasets (100 m biomass, 250 m soil) at a 2022 biomass epoch,
            so they capture landscape-level stocks, not recent change or fine detail. Results are an educational
            estimate — for carbon credits or transactions, commission ground-truthed measurement to a recognized
            registry standard. This tool is not a substitute for that.
          </p>
        </section>
      </div>
    </div>
  )
}
