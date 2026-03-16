import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

// IUCN status labels for popup banners
const IUCN_LABEL = {
  CR: 'Critically Endangered',
  EN: 'Endangered',
  VU: 'Vulnerable',
  NT: 'Near Threatened',
  LC: 'Least Concern',
}
const IUCN_COLOR = {
  CR: '#e74c3c',
  EN: '#e67e22',
  VU: '#f39c12',
  NT: '#27ae60',
  LC: '#2ecc71',
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return dateStr }
}

/**
 * ExploreMap — unified Mapbox GL map for all subsites.
 *
 * Props:
 *   sightings      — array of normalized sighting objects
 *   center         — { lat, lng } map center
 *   activeSpecies  — speciesKey of currently highlighted species
 *   onCenterChange — ({ lat, lng, zoom, bounds? }) => void
 *   onZoomChange   — (zoom) => void
 *   config         — {
 *     fallbackColor: string,    — default dot color (e.g. '#1a5276')
 *     fallbackEmoji: string,    — default emoji for popups (e.g. '🐋')
 *     heatmapLayers?: {         — if present, adds GBIF heatmap tile layers
 *       alltime: string,        — tile URL for all-time density
 *       recent: string,         — tile URL for recent (30-day) activity
 *       crossoverZoom: number,  — zoom level: below → heatmap, above → markers
 *     },
 *   }
 */
export default function ExploreMap({ sightings = [], center, activeSpecies, onCenterChange, onZoomChange, patternsMonth = null, radiusKm = null, config = {} }) {
  const {
    fallbackColor = '#1a5276',
    fallbackEmoji = '',
    heatmapLayers = null,
  } = config

  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [zoomLevel, setZoomLevel] = useState(center ? 6 : 2)
  const markersRef = useRef([])  // each entry: { marker, dot, speciesKey }
  const activeSpeciesRef = useRef(activeSpecies)
  activeSpeciesRef.current = activeSpecies
  const onCenterChangeRef = useRef(onCenterChange)
  onCenterChangeRef.current = onCenterChange
  const onZoomChangeRef = useRef(onZoomChange)
  onZoomChangeRef.current = onZoomChange
  const flyingRef = useRef(0) // counter: >0 means programmatic fly in progress
  // Track the last center the user moved to, so we don't flyTo it back
  const userCenterRef = useRef(null)

  const crossoverZoom = heatmapLayers?.crossoverZoom ?? 7

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN

    const initialZoom = center ? (heatmapLayers ? 12 : 6) : 2

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: center ? [center.lng, center.lat] : [-100, 35],
      zoom: initialZoom,
      attributionControl: false,
      logoPosition: 'bottom-right',
    })

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')

    // Add GBIF heatmap tile layers if configured
    if (heatmapLayers) {
      function addHeatmapTileLayers() {
        if (map.getSource('gbif-alltime')) return

        // Base layer: all-time, faint
        map.addSource('gbif-alltime', {
          type: 'raster',
          tiles: [heatmapLayers.alltime],
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
              crossoverZoom - 1, 0.35,
              crossoverZoom, 0.12,
              crossoverZoom + 1, 0,
            ],
          },
        })

        // Recent layer: 30-day, brighter
        map.addSource('gbif-recent', {
          type: 'raster',
          tiles: [heatmapLayers.recent],
          tileSize: 512,
        })
        map.addLayer({
          id: 'gbif-recent',
          type: 'raster',
          source: 'gbif-recent',
          paint: {
            'raster-opacity': [
              'interpolate', ['linear'], ['zoom'],
              crossoverZoom - 1, 0.9,
              crossoverZoom, 0.35,
              crossoverZoom + 1, 0,
            ],
          },
        })
      }
      if (map.isStyleLoaded()) addHeatmapTileLayers()
      else map.on('load', addHeatmapTileLayers)
    }

    // Toggle marker visibility based on zoom when heatmap is present
    let markersOnMap = true
    function updateMarkerVisibility() {
      const z = map.getZoom()
      setZoomLevel(z)
      onZoomChangeRef.current?.(z)

      if (heatmapLayers) {
        const show = z >= crossoverZoom
        if (show && !markersOnMap) {
          markersRef.current.forEach(({ marker }) => marker.addTo(map))
          markersOnMap = true
        } else if (!show && markersOnMap) {
          markersRef.current.forEach(({ marker }) => marker.remove())
          markersOnMap = false
        }
      }
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
      if (flyingRef.current > 0) return
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
    flyingRef.current++
    mapRef.current.once('moveend', () => { flyingRef.current-- })

    if (heatmapLayers) {
      // When heatmap is present, only set zoom on initial load (from default z2); otherwise preserve user's zoom
      const currentZoom = mapRef.current.getZoom()
      if (currentZoom <= 2) {
        mapRef.current.flyTo({ center: [center.lng, center.lat], zoom: 12, duration: 1200 })
      } else {
        mapRef.current.flyTo({ center: [center.lng, center.lat], duration: 1200 })
      }
    } else {
      mapRef.current.flyTo({ center: [center.lng, center.lat], zoom: 6, duration: 1200 })
    }
  }, [center?.lat, center?.lng])

  // Fit map to search radius when radiusKm is provided, or auto-fit to sightings
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (center && radiusKm) {
      const earthRadius = 6371 // km
      const dLat = (radiusKm / earthRadius) * (180 / Math.PI)
      const dLng = dLat / Math.cos(center.lat * Math.PI / 180)

      const bounds = new mapboxgl.LngLatBounds(
        [center.lng - dLng, center.lat - dLat],
        [center.lng + dLng, center.lat + dLat]
      )

      flyingRef.current++
      map.once('moveend', () => { flyingRef.current-- })
      map.fitBounds(bounds, { padding: 40, duration: 800 })
    } else if (!radiusKm && sightings.length > 0) {
      // No radius — auto-fit to sighting bounds
      const bounds = new mapboxgl.LngLatBounds()
      for (const s of sightings) {
        if (s.lat != null && s.lng != null) bounds.extend([s.lng, s.lat])
      }
      if (!bounds.isEmpty()) {
        flyingRef.current++
        map.once('moveend', () => { flyingRef.current-- })
        map.fitBounds(bounds, { padding: 60, duration: 800, maxZoom: 12 })
      }
    }
  }, [center?.lat, center?.lng, radiusKm, sightings])

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
      const dotColor = s.color || fallbackColor
      dot.style.cssText = `
        width: 12px; height: 12px;
        border-radius: 50%;
        background: ${dotColor};
        border: 2px solid rgba(255,255,255,0.5);
        transition: transform 0.15s, border-color 0.25s, border-width 0.15s, box-shadow 0.25s, opacity 0.25s;
        box-shadow: 0 0 4px ${dotColor}44;
      `
      el.appendChild(dot)

      el.addEventListener('mouseenter', () => { dot.style.transform = 'scale(1.6)' })
      el.addEventListener('mouseleave', () => {
        const active = activeSpeciesRef.current
        dot.style.transform = active && String(s.speciesKey) === String(active) ? 'scale(1.4)' : 'scale(1)'
      })

      // Choose best photo: observation photo first, species curated photo as fallback
      const photo = (s.photos && s.photos[0]) || s.speciesPhoto || null

      // IUCN-based status detection for popup banner
      const iucn = s.iucn || s.meta?.iucn || null
      const iucnLabel = IUCN_LABEL[iucn] || null
      const iucnColor = IUCN_COLOR[iucn] || null

      const isMobile = window.innerWidth <= 600
      const photoH = isMobile ? 120 : 200

      const emoji = s.emoji || fallbackEmoji
      const accentColor = s.color || fallbackColor

      const popup = new mapboxgl.Popup({
        offset: isMobile ? 0 : 12,
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
            ${iucnLabel ? `<div style="
              background:${iucnColor};
              color:#fff;
              font-size:10px;
              font-weight:500;
              letter-spacing:0.08em;
              text-transform:uppercase;
              padding:5px 16px;
              display:flex;align-items:center;gap:5px;
            "><span style="font-size:12px">⚠</span> ${iucnLabel}</div>` : ''}
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
              ">${emoji ? emoji + ' ' : ''}${s.common}</div>
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
                border-left:2px solid ${accentColor}44;
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
              <div style="
                display:flex;gap:6px;margin-top:10px;
              ">
                ${(s.speciesKey || s.scientific) ? `<a href="/species/${
                  !isNaN(Number(s.speciesKey)) ? s.speciesKey : encodeURIComponent(s.scientific)
                }" style="
                  flex:1;text-align:center;white-space:nowrap;
                  padding:5px 8px;border-radius:5px;
                  background:${accentColor}18;color:${accentColor};
                  font-size:11px;font-weight:500;line-height:1.2;
                  text-decoration:none;
                  border:1px solid ${accentColor}30;
                ">Species info</a>` : ''}
                <a href="${s.source === 'iNaturalist'
                  ? 'https://www.inaturalist.org/observations/' + String(s.id).replace('inat-', '')
                  : 'https://www.gbif.org/occurrence/' + s.id
                }" target="_blank" rel="noopener noreferrer" style="
                  flex:1;text-align:center;white-space:nowrap;
                  padding:5px 8px;border-radius:5px;
                  background:#f0f2f5;color:#3d4f5f;
                  font-size:11px;font-weight:500;line-height:1.2;
                  text-decoration:none;
                  border:1px solid #e0e4e8;
                ">View observation ↗</a>
              </div>
            </div>
          </div>
        `)

      // Keep popup visible: on mobile center on marker; on desktop pan to fit
      popup.on('open', () => {
        if (isMobile) {
          // Bottom-sheet popup is fixed at bottom, just center on the marker
          flyingRef.current++
          map.once('moveend', () => { flyingRef.current-- })
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
            flyingRef.current++
            map.once('moveend', () => { flyingRef.current-- })
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

    // Sync marker visibility with heatmap zoom state
    if (heatmapLayers) {
      map._setMarkersOnMap(true)
      map._updateMarkerVisibility()
    }
  }, [sightings])

  // Highlight dots matching activeSpecies with a gold outline
  useEffect(() => {
    markersRef.current.forEach(({ dot, speciesKey }) => {
      if (!activeSpecies) {
        dot.style.transform = 'scale(1)'
        dot.style.border = '2px solid rgba(255,255,255,0.5)'
        dot.style.boxShadow = 'none'
        dot.style.opacity = '1'
      } else if (String(speciesKey) === String(activeSpecies)) {
        dot.style.transform = 'scale(1.8)'
        dot.style.border = '2.5px solid #ffeb3b'
        dot.style.boxShadow = '0 0 0 4px rgba(255,235,59,0.5), 0 0 18px rgba(255,235,59,0.7), 0 0 30px rgba(255,235,59,0.3)'
        dot.style.opacity = '1'
      } else {
        dot.style.transform = 'scale(0.7)'
        dot.style.border = '2px solid rgba(255,255,255,0.3)'
        dot.style.boxShadow = 'none'
        dot.style.opacity = '0.3'
      }
    })
  }, [activeSpecies])

  // ─── Seasonal heatmap layer (patterns mode) ─────────────────────────────
  // Renders sightings as a native Mapbox heatmap layer (same style as /species page)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const sourceId = 'seasonal-heat-points'
    const layerId = 'seasonal-heat-layer'

    function update() {
      if (!patternsMonth) {
        // Remove heatmap when leaving patterns mode, restore markers
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
        markersRef.current.forEach(({ marker }) => marker.addTo(map))
        return
      }

      // Hide all markers — heatmap replaces them
      markersRef.current.forEach(({ marker }) => marker.remove())

      // Build GeoJSON from sightings (already filtered server-side when a species is selected)
      const geojson = {
        type: 'FeatureCollection',
        features: sightings
          .filter(s => s.lat && s.lng)
          .map(s => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
            properties: {},
          })),
      }

      if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData(geojson)
      } else {
        map.addSource(sourceId, { type: 'geojson', data: geojson })
        map.addLayer({
          id: layerId,
          type: 'heatmap',
          source: sourceId,
          paint: {
            'heatmap-radius': [
              'interpolate', ['linear'], ['zoom'],
              0, 4,
              2, 8,
              4, 16,
              6, 24,
              9, 32,
            ],
            'heatmap-intensity': [
              'interpolate', ['linear'], ['zoom'],
              0, 0.4,
              2, 0.6,
              4, 1,
              8, 1.5,
            ],
            'heatmap-color': [
              'interpolate', ['linear'], ['heatmap-density'],
              0,    'rgba(0, 0, 0, 0)',
              0.05, 'rgba(65, 105, 225, 0.4)',
              0.15, 'rgb(0, 180, 120)',
              0.35, 'rgb(255, 200, 0)',
              0.55, 'rgb(255, 120, 0)',
              0.75, 'rgb(230, 50, 20)',
              1.0,  'rgb(180, 0, 30)',
            ],
            'heatmap-opacity': [
              'interpolate', ['linear'], ['zoom'],
              0, 0.6,
              12, 0.6,
            ],
          },
        })
      }
    }

    if (map.isStyleLoaded()) update()
    else map.on('load', update)
  }, [patternsMonth, sightings])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {heatmapLayers && (
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
      )}
    </div>
  )
}
