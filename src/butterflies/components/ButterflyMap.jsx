import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const HEATMAP_CROSSOVER = 7 // zoom level: below → heatmap, above → markers

// Dot colors that signal conservation status → label for popup band
const STATUS_BY_COLOR = {
  '#e06868': 'Critically Endangered',
  '#d87060': 'Endangered',
  '#d08060': 'Endangered',
  '#c87060': 'Endangered',
}

// GBIF tile URLs — two layers for context
// Base: all-time density (faint, always visible context)
const GBIF_ALLTIME_URL =
  'https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@1x.png'
  + '?taxonKey=797&basisOfRecord=HUMAN_OBSERVATION&style=orangeHeat.point'

// Recent: past-30-day observations (brighter, on top)
function buildRecentTileUrl() {
  const d2 = new Date()
  const d1 = new Date(d2 - 30 * 86400000)
  const fmt = d => d.toISOString().split('T')[0]
  return 'https://api.gbif.org/v2/map/occurrence/adhoc/{z}/{x}/{y}@1x.png'
    + `?taxonKey=797&eventDate=${fmt(d1)},${fmt(d2)}&basisOfRecord=HUMAN_OBSERVATION`
    + '&style=fire.point'
}

/**
 * ButterflyMap — Mapbox GL map for lepidoptera sightings.
 *
 * Props:
 *   sightings      — array of normalized sighting objects
 *   center         — { lat, lng } map center
 *   activeSpecies  — speciesKey of currently highlighted species
 *   onCenterChange — ({ lat, lng, zoom }) => void
 */
export default function ButterflyMap({ sightings = [], center, activeSpecies, onCenterChange, onZoomChange }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [zoomLevel, setZoomLevel] = useState(center ? 6 : 2)
  const [markerCount, setMarkerCount] = useState(0)
  const markersRef = useRef([])  // each entry: { marker, dot, speciesKey }
  const activeSpeciesRef = useRef(activeSpecies)
  activeSpeciesRef.current = activeSpecies
  const onCenterChangeRef = useRef(onCenterChange)
  onCenterChangeRef.current = onCenterChange
  const onZoomChangeRef = useRef(onZoomChange)
  onZoomChangeRef.current = onZoomChange
  const flyingRef = useRef(false) // true during programmatic flyTo
  // Track the last center the user moved to, so we don't flyTo it back
  const userCenterRef = useRef(null)

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: center ? [center.lng, center.lat] : [-100, 35],
      zoom: center ? 14 : 2,
      attributionControl: false,
      logoPosition: 'bottom-right',
    })

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')

    // Add two GBIF heatmap tile layers:
    //   1. All-time density (faint base — shows historical hotspots)
    //   2. Recent 30-day (brighter overlay — shows current activity)
    function addHeatmapLayers() {
      if (map.getSource('gbif-alltime')) return

      // Base layer: all-time, faint
      map.addSource('gbif-alltime', {
        type: 'raster',
        tiles: [GBIF_ALLTIME_URL],
        tileSize: 512,
        attribution: '© GBIF',
      })
      map.addLayer({
        id: 'gbif-alltime',
        type: 'raster',
        source: 'gbif-alltime',
        paint: {
          'raster-opacity': [
            'interpolate', ['linear'], ['zoom'],
            HEATMAP_CROSSOVER - 1, 0.35,
            HEATMAP_CROSSOVER, 0.12,
            HEATMAP_CROSSOVER + 1, 0,
          ],
        },
      })

      // Recent layer: 30-day, brighter
      map.addSource('gbif-recent', {
        type: 'raster',
        tiles: [buildRecentTileUrl()],
        tileSize: 512,
      })
      map.addLayer({
        id: 'gbif-recent',
        type: 'raster',
        source: 'gbif-recent',
        paint: {
          'raster-opacity': [
            'interpolate', ['linear'], ['zoom'],
            HEATMAP_CROSSOVER - 1, 0.9,
            HEATMAP_CROSSOVER, 0.35,
            HEATMAP_CROSSOVER + 1, 0,
          ],
        },
      })
    }
    // Use 'load' event (fires after style + all tiles ready)
    if (map.isStyleLoaded()) addHeatmapLayers()
    else map.on('load', addHeatmapLayers)

    // Toggle marker visibility based on zoom + track zoom level
    // Uses marker.remove() / marker.addTo(map) for bulletproof hiding
    let markersOnMap = true
    function updateMarkerVisibility() {
      const z = map.getZoom()
      setZoomLevel(z)
      onZoomChangeRef.current?.(z)
      const show = z >= HEATMAP_CROSSOVER
      if (show && !markersOnMap) {
        markersRef.current.forEach(({ marker }) => marker.addTo(map))
        markersOnMap = true
      } else if (!show && markersOnMap) {
        markersRef.current.forEach(({ marker }) => marker.remove())
        markersOnMap = false
      }
      setMarkerCount(markersRef.current.length)
    }
    map.on('zoom', updateMarkerVisibility)
    map.on('zoomend', updateMarkerVisibility)
    // Expose for sightings effect to call
    map._updateMarkerVisibility = updateMarkerVisibility
    map._isMarkersOnMap = () => markersOnMap
    map._setMarkersOnMap = (v) => { markersOnMap = v }

    // Fire onCenterChange after user-initiated moves (not programmatic flyTo)
    let debounceTimer = null
    map.on('moveend', () => {
      if (flyingRef.current) return
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        const c = map.getCenter()
        const z = map.getZoom()
        const b = map.getBounds()
        userCenterRef.current = { lat: c.lat, lng: c.lng }
        onCenterChangeRef.current?.({
          lat: c.lat, lng: c.lng, zoom: z,
          bounds: {
            minLat: b.getSouth(),
            maxLat: b.getNorth(),
            minLng: b.getWest(),
            maxLng: b.getEast(),
          },
        })
      }, 600)
    })

    mapRef.current = map
    return () => { clearTimeout(debounceTimer); map.remove(); mapRef.current = null }
  }, [])

  // Update center (programmatic — skip moveend callback)
  // Only flyTo for genuinely new locations, not echoes from user moves
  useEffect(() => {
    if (!mapRef.current || !center) return
    const uc = userCenterRef.current
    if (uc && Math.abs(uc.lat - center.lat) < 0.001 && Math.abs(uc.lng - center.lng) < 0.001) return
    flyingRef.current = true
    mapRef.current.once('moveend', () => { flyingRef.current = false })
    const currentZoom = mapRef.current.getZoom()
    // Only set zoom on initial load (from default z2); otherwise preserve user's zoom
    if (currentZoom <= 2) {
      mapRef.current.flyTo({ center: [center.lng, center.lat], zoom: 14, duration: 1200 })
    } else {
      mapRef.current.flyTo({ center: [center.lng, center.lat], duration: 1200 })
    }
  }, [center?.lat, center?.lng])

  // Render markers — only re-create when sightings change
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Remove old markers
    markersRef.current.forEach(m => m.marker.remove())
    markersRef.current = []

    sightings.forEach(s => {
      if (!s.lat || !s.lng) return

      // Outer wrapper for Mapbox positioning (receives transform: translate)
      const el = document.createElement('div')
      el.style.cssText = `cursor: pointer;`
      el.title = s.common

      // Inner dot — safe to transform without overwriting Mapbox's translate
      const dot = document.createElement('div')
      const dotColor = s.color || '#5a3e28'
      dot.style.cssText = `
        width: 12px; height: 12px;
        border-radius: 50%;
        background: ${dotColor};
        border: 2px solid rgba(255,255,255,0.5);
        transition: transform 0.15s, border-color 0.25s, border-width 0.15s, box-shadow 0.25s;
        box-shadow: 0 0 4px ${dotColor}44;
      `
      el.appendChild(dot)

      el.addEventListener('mouseenter', () => { dot.style.transform = 'scale(1.6)' })
      el.addEventListener('mouseleave', () => {
        const active = activeSpeciesRef.current
        dot.style.transform = active && String(s.speciesKey) === String(active) ? 'scale(1.4)' : 'scale(1)'
      })

      // Choose best photo: species curated photo → GBIF occurrence photo → none
      const photo = s.speciesPhoto || (s.photos && s.photos[0]) || null

      const status = STATUS_BY_COLOR[s.color] || null

      const isMobile = window.innerWidth <= 600
      const photoH = isMobile ? 120 : 200

      const popup = new mapboxgl.Popup({
        offset: isMobile ? 0 : 12,
        className: 'butterfly-popup',
        closeButton: isMobile,
        maxWidth: isMobile ? '100%' : '280px',
      })
        .setHTML(`
          <div style="
            font-family:'DM Sans',system-ui,sans-serif;
            background:#ffffff;
            color:#1a2332;
            overflow:hidden;
            ${isMobile ? 'width:100%;border-radius:16px 16px 0 0;' : 'width:260px;border-radius:12px;'}
            line-height:1.5;
          ">
            ${status ? `<div style="
              background:${s.color};
              color:#fff;
              font-size:10px;
              font-weight:500;
              letter-spacing:0.08em;
              text-transform:uppercase;
              padding:5px 16px;
              display:flex;align-items:center;gap:5px;
            "><span style="font-size:12px">⚠</span> ${status}</div>` : ''}
            ${photo ? `
            <div style="position:relative;width:100%;height:${photoH}px;overflow:hidden;">
              <img src="${photo}" alt="${s.common}" style="
                width:100%;height:100%;object-fit:cover;display:block;
              " onerror="this.parentElement.style.display='none'" />
              <div style="
                position:absolute;bottom:0;left:0;right:0;height:60px;
                background:linear-gradient(transparent, #ffffff);
              "></div>
            </div>` : ''}
            <div style="padding:${isMobile ? '12px 16px 16px' : '14px 16px 16px'};">
              <div style="
                font-family:'Fraunces',Georgia,serif;
                font-size:${isMobile ? '18px' : '20px'};font-weight:400;
                color:#1a2332;
                margin-bottom:2px;
                line-height:1.25;
              ">${s.emoji || '🦋'} ${s.common}</div>
              ${s.scientific ? `<div style="
                font-style:italic;
                color:#5a6b7a;
                font-size:12px;
                margin-bottom:10px;
              ">${s.scientific}</div>` : ''}
              ${s.fact ? `<div style="
                font-size:12px;
                color:#3d4f5f;
                line-height:1.5;
                margin-bottom:12px;
                border-left:2px solid ${s.color || '#5a3e28'}44;
                padding-left:10px;
                ${isMobile ? 'display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;' : ''}
              ">${s.fact}</div>` : ''}
              <div style="
                font-size:11px;
                color:#5a6b7a;
                display:flex;flex-direction:column;gap:3px;
              ">
                ${s.place ? `<div>\u{1F4CD} ${s.place}</div>` : ''}
                ${s.date ? `<div>\u{1F4C5} ${formatDate(s.date)}</div>` : ''}
                <div style="
                  margin-top:6px;
                  font-size:10px;
                  color:#7a8a96;
                  text-transform:uppercase;
                  letter-spacing:0.05em;
                ">via ${s.source || 'GBIF'}</div>
              </div>
            </div>
          </div>
        `)

      // Keep popup visible: on mobile center on marker; on desktop pan to fit
      popup.on('open', () => {
        if (isMobile) {
          flyingRef.current = true
          map.once('moveend', () => { flyingRef.current = false })
          map.easeTo({ center: [s.lng, s.lat], duration: 300 })
          return
        }
        requestAnimationFrame(() => {
          const popupEl = popup.getElement()
          if (!popupEl) return
          const mapRect = map.getContainer().getBoundingClientRect()
          const popupRect = popupEl.getBoundingClientRect()
          const pad = 20
          let dx = 0, dy = 0

          if (popupRect.left < mapRect.left + pad)
            dx = popupRect.left - (mapRect.left + pad)
          else if (popupRect.right > mapRect.right - pad)
            dx = popupRect.right - (mapRect.right - pad)

          if (popupRect.top < mapRect.top + pad)
            dy = popupRect.top - (mapRect.top + pad)
          else if (popupRect.bottom > mapRect.bottom - pad)
            dy = popupRect.bottom - (mapRect.bottom - pad)

          if (dx !== 0 || dy !== 0) {
            flyingRef.current = true
            map.once('moveend', () => { flyingRef.current = false })
            map.panBy([dx, dy], { duration: 300, easing: t => t * (2 - t) })
          }
        })
      })

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([s.lng, s.lat])
        .setPopup(popup)
        .addTo(map)

      markersRef.current.push({ marker, dot, speciesKey: s.speciesKey })
    })
    // Sync: add all markers first, then let visibility handler hide if zoomed out
    map._setMarkersOnMap(true)
    map._updateMarkerVisibility()
    setMarkerCount(markersRef.current.length)
  }, [sightings])

  // Highlight dots matching activeSpecies with a gold outline
  useEffect(() => {
    markersRef.current.forEach(({ dot, speciesKey }) => {
      if (!activeSpecies) {
        dot.style.transform = 'scale(1)'
        dot.style.border = '2px solid rgba(255,255,255,0.5)'
        dot.style.boxShadow = 'none'
      } else if (String(speciesKey) === String(activeSpecies)) {
        dot.style.transform = 'scale(1.8)'
        dot.style.border = '2.5px solid #f5c518'
        dot.style.boxShadow = '0 0 0 3px #f5c518, 0 0 12px rgba(245,197,24,0.6)'
      } else {
        dot.style.transform = 'scale(1)'
        dot.style.border = '2px solid rgba(255,255,255,0.5)'
        dot.style.boxShadow = 'none'
      }
    })
  }, [activeSpecies])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div style={{
        position: 'absolute', bottom: 8, left: 8,
        background: 'rgba(0,0,0,0.7)', color: '#fff',
        fontSize: 10, fontWeight: 500, fontFamily: 'monospace',
        padding: '3px 8px', borderRadius: 4,
        pointerEvents: 'none', zIndex: 5,
        lineHeight: 1.4,
      }}>
        z{zoomLevel.toFixed(1)}
      </div>
    </div>
  )
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return dateStr }
}
