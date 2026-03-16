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

// ─── Shared popup HTML builder ─────────────────────────────────────────────
function buildPopupHTML(s, { fallbackColor, fallbackEmoji }) {
  const photo = (s.photos && s.photos[0]) || s.speciesPhoto || null
  const iucn = s.iucn || s.meta?.iucn || null
  const iucnLabel = IUCN_LABEL[iucn] || null
  const iucnColor = IUCN_COLOR[iucn] || null
  const isMobile = window.innerWidth <= 600
  const photoH = isMobile ? 120 : 200
  const emoji = s.emoji || fallbackEmoji
  const accentColor = s.color || fallbackColor

  return `
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
      "><span style="font-size:12px">\u26A0</span> ${iucnLabel}</div>` : ''}
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
          ">View observation \u2197</a>
        </div>
      </div>
    </div>
  `
}

// ─── Hex to RGB for heatmap color ramp ─────────────────────────────────────
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Heatmap fades out over this range; circles are always visible
const HEAT_FADE_LO = 5   // heatmap starts fading
const HEAT_FADE_HI = 8   // heatmap fully gone

/**
 * ExploreMap — unified Mapbox GL map for all EarthAtlas subsites.
 *
 * Rendering tiers:
 *   z < 7   — native GL heatmap layer (GPU, from sighting GeoJSON)
 *   z 7–9   — smooth crossfade (heatmap fading out, circle dots fading in)
 *   z > 9   — circle dot layer with click-to-popup
 *
 * For subsites with config.heatmapLayers (e.g. butterflies), the GBIF raster
 * tile heatmap is used instead, with DOM markers toggled at the crossover zoom.
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
  const markersRef = useRef([])  // DOM markers (only used for heatmapLayers path)
  const sightingsRef = useRef(sightings) // full sighting objects for popup lookup
  sightingsRef.current = sightings
  const activeSpeciesRef = useRef(activeSpecies)
  activeSpeciesRef.current = activeSpecies
  const onCenterChangeRef = useRef(onCenterChange)
  onCenterChangeRef.current = onCenterChange
  const onZoomChangeRef = useRef(onZoomChange)
  onZoomChangeRef.current = onZoomChange
  const flyingRef = useRef(0) // counter: >0 means programmatic fly in progress
  const userCenterRef = useRef(null)
  const popupRef = useRef(null) // single reusable popup instance
  const initialFitDone = useRef(false) // only auto-fit on first data load
  const fallbackColorRef = useRef(fallbackColor)
  fallbackColorRef.current = fallbackColor
  const fallbackEmojiRef = useRef(fallbackEmoji)
  fallbackEmojiRef.current = fallbackEmoji

  const crossoverZoom = heatmapLayers?.crossoverZoom ?? 7

  // ─── Init map ──────────────────────────────────────────────────────────────
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

    // ── GBIF raster tile heatmap (butterflies path) ────────────────────────
    if (heatmapLayers) {
      function addHeatmapTileLayers() {
        if (map.getSource('gbif-alltime')) return
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

      // Toggle DOM marker visibility based on zoom (heatmapLayers path only)
      let markersOnMap = true
      function updateMarkerVisibility() {
        const z = map.getZoom()
        setZoomLevel(z)
        onZoomChangeRef.current?.(z)
        const show = z >= crossoverZoom
        if (show && !markersOnMap) {
          markersRef.current.forEach(({ marker }) => marker.addTo(map))
          markersOnMap = true
        } else if (!show && markersOnMap) {
          markersRef.current.forEach(({ marker }) => marker.remove())
          markersOnMap = false
        }
      }
      map.on('zoom', updateMarkerVisibility)
      map.on('zoomend', updateMarkerVisibility)
      map._updateMarkerVisibility = updateMarkerVisibility
      map._isMarkersOnMap = () => markersOnMap
      map._setMarkersOnMap = (v) => { markersOnMap = v }
    } else {
      // ── Native GL layers (heatmap + circles) from sighting GeoJSON ───────
      function addSightingLayers() {
        if (map.getSource('sighting-src')) return

        map.addSource('sighting-src', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })

        // Heatmap layer — subtle ambient glow behind dots, fades out at mid zoom
        const [r, g, b] = hexToRgb(fallbackColorRef.current)
        map.addLayer({
          id: 'sighting-heat',
          type: 'heatmap',
          source: 'sighting-src',
          paint: {
            'heatmap-radius': [
              'interpolate', ['linear'], ['zoom'],
              0, 4,
              4, 10,
              HEAT_FADE_LO, 16,
              HEAT_FADE_HI, 22,
            ],
            'heatmap-intensity': [
              'interpolate', ['linear'], ['zoom'],
              0, 0.2,
              HEAT_FADE_LO, 0.5,
              HEAT_FADE_HI, 0.8,
            ],
            'heatmap-color': [
              'interpolate', ['linear'], ['heatmap-density'],
              0,    'rgba(0, 0, 0, 0)',
              0.1,  `rgba(${r}, ${g}, ${b}, 0.08)`,
              0.3,  `rgba(${r}, ${g}, ${b}, 0.2)`,
              0.5,  `rgba(${r}, ${g}, ${b}, 0.35)`,
              0.7,  `rgba(${r}, ${g}, ${b}, 0.5)`,
              0.9,  `rgba(${Math.min(r + 40, 255)}, ${Math.min(g + 30, 255)}, ${b}, 0.6)`,
              1.0,  `rgba(${Math.min(r + 60, 255)}, ${Math.min(g + 50, 255)}, ${b}, 0.7)`,
            ],
            'heatmap-opacity': [
              'interpolate', ['linear'], ['zoom'],
              HEAT_FADE_LO, 0.55,
              HEAT_FADE_HI, 0,
            ],
          },
        })

        // Circle layer — always visible, grows with zoom
        map.addLayer({
          id: 'sighting-circles',
          type: 'circle',
          source: 'sighting-src',
          paint: {
            'circle-radius': [
              'interpolate', ['linear'], ['zoom'],
              0, 3,
              6, 4,
              10, 6,
              14, 7,
            ],
            'circle-color': ['get', 'color'],
            'circle-stroke-color': 'rgba(255, 255, 255, 0.7)',
            'circle-stroke-width': [
              'interpolate', ['linear'], ['zoom'],
              0, 1,
              10, 1.5,
            ],
            'circle-opacity': 0.85,
            'circle-stroke-opacity': 0.85,
          },
        })

        // Click handler — popup on circle click
        map.on('click', 'sighting-circles', (e) => {
          if (!e.features || !e.features[0]) return
          const idx = e.features[0].properties.idx
          const s = sightingsRef.current[idx]
          if (!s) return

          // Remove existing popup
          if (popupRef.current) popupRef.current.remove()

          const isMobile = window.innerWidth <= 600
          const popup = new mapboxgl.Popup({
            offset: isMobile ? 0 : 12,
            closeButton: isMobile,
            maxWidth: isMobile ? '100%' : '280px',
          })
            .setLngLat([s.lng, s.lat])
            .setHTML(buildPopupHTML(s, {
              fallbackColor: fallbackColorRef.current,
              fallbackEmoji: fallbackEmojiRef.current,
            }))
            .addTo(map)

          popupRef.current = popup

          // Pan to fit popup
          popup.on('open', () => {
            if (isMobile) {
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
        })

        // Cursor pointer on hover
        map.on('mouseenter', 'sighting-circles', () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', 'sighting-circles', () => {
          map.getCanvas().style.cursor = ''
        })
      }

      if (map.isStyleLoaded()) addSightingLayers()
      else map.on('load', addSightingLayers)

      // Track zoom for display
      map.on('zoom', () => {
        setZoomLevel(map.getZoom())
        onZoomChangeRef.current?.(map.getZoom())
      })
    }

    // ── Fire onCenterChange after user-initiated moves ─────────────────────
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
    return () => {
      clearTimeout(debounceTimer)
      if (popupRef.current) popupRef.current.remove()
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ─── Update center (programmatic flyTo) ──────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !center) return
    const uc = userCenterRef.current
    if (uc && Math.abs(uc.lat - center.lat) < 0.001 && Math.abs(uc.lng - center.lng) < 0.001) return
    flyingRef.current++
    mapRef.current.once('moveend', () => { flyingRef.current-- })

    if (heatmapLayers) {
      const currentZoom = mapRef.current.getZoom()
      if (currentZoom <= 2) {
        mapRef.current.flyTo({ center: [center.lng, center.lat], zoom: 12, duration: 1200 })
      } else {
        mapRef.current.flyTo({ center: [center.lng, center.lat], duration: 1200 })
      }
    } else {
      // Just center the map — data will determine the zoom via auto-fit
      mapRef.current.flyTo({ center: [center.lng, center.lat], duration: 1200 })
    }
  }, [center?.lat, center?.lng])

  // ─── Auto-fit to data on first load ─────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || sightings.length === 0) return

    if (radiusKm && center) {
      // Homepage map with explicit radius — fit to radius circle
      const earthRadius = 6371
      const dLat = (radiusKm / earthRadius) * (180 / Math.PI)
      const dLng = dLat / Math.cos(center.lat * Math.PI / 180)
      const bounds = new mapboxgl.LngLatBounds(
        [center.lng - dLng, center.lat - dLat],
        [center.lng + dLng, center.lat + dLat]
      )
      flyingRef.current++
      map.once('moveend', () => { flyingRef.current-- })
      map.fitBounds(bounds, { padding: 40, duration: 800 })
    } else if (!initialFitDone.current) {
      // Explore pages — fit to the data bounds on first load only
      initialFitDone.current = true
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

  // ─── Update sighting data ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (heatmapLayers) {
      // ── DOM markers path (butterflies with GBIF tile heatmap) ────────────
      markersRef.current.forEach(m => m.marker.remove())
      markersRef.current = []

      sightings.forEach(s => {
        if (!s.lat || !s.lng) return

        const el = document.createElement('div')
        el.style.cssText = `cursor: pointer;`
        el.title = s.common

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

        const isMobile = window.innerWidth <= 600
        const popup = new mapboxgl.Popup({
          offset: isMobile ? 0 : 12,
          closeButton: isMobile,
          maxWidth: isMobile ? '100%' : '280px',
        }).setHTML(buildPopupHTML(s, { fallbackColor, fallbackEmoji }))

        popup.on('open', () => {
          if (isMobile) {
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
            if (popupRect.left < mapRect.left + pad) dx = popupRect.left - (mapRect.left + pad)
            else if (popupRect.right > mapRect.right - pad) dx = popupRect.right - (mapRect.right - pad)
            if (popupRect.top < mapRect.top + pad) dy = popupRect.top - (mapRect.top + pad)
            else if (popupRect.bottom > mapRect.bottom - pad) dy = popupRect.bottom - (mapRect.bottom - pad)
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

      map._setMarkersOnMap(true)
      map._updateMarkerVisibility()
    } else {
      // ── GeoJSON source path (heatmap + circles) ──────────────────────────
      function updateSource() {
        const src = map.getSource('sighting-src')
        if (!src) return false

        const geojson = {
          type: 'FeatureCollection',
          features: sightings
            .map((s, i) => {
              if (!s.lat || !s.lng) return null
              return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
                properties: {
                  idx: i,
                  color: s.color || fallbackColor,
                  speciesKey: String(s.speciesKey || ''),
                },
              }
            })
            .filter(Boolean),
        }

        src.setData(geojson)
        return true
      }

      // Source may not exist yet if style is still loading
      if (!updateSource()) {
        const onLoad = () => { updateSource(); map.off('load', onLoad) }
        map.on('load', onLoad)
        return () => map.off('load', onLoad)
      }
    }
  }, [sightings])

  // ─── Active species highlighting ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (heatmapLayers) {
      // DOM markers path
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
    } else {
      // GL layers path — data-driven paint expressions
      if (!map.getLayer('sighting-circles')) return

      if (!activeSpecies) {
        // Reset to defaults
        map.setPaintProperty('sighting-circles', 'circle-radius', [
          'interpolate', ['linear'], ['zoom'],
          0, 3,
          6, 4,
          10, 6,
          14, 7,
        ])
        map.setPaintProperty('sighting-circles', 'circle-opacity', 0.85)
        map.setPaintProperty('sighting-circles', 'circle-stroke-width', [
          'interpolate', ['linear'], ['zoom'],
          0, 1,
          10, 1.5,
        ])
        map.setPaintProperty('sighting-circles', 'circle-stroke-color', 'rgba(255, 255, 255, 0.7)')
        map.setFilter('sighting-heat', null)
      } else {
        const key = String(activeSpecies)
        // Highlight matching, dim non-matching
        map.setPaintProperty('sighting-circles', 'circle-radius', [
          'interpolate', ['linear'], ['zoom'],
          0, ['case', ['==', ['get', 'speciesKey'], key], 5, 2],
          6, ['case', ['==', ['get', 'speciesKey'], key], 6, 3],
          10, ['case', ['==', ['get', 'speciesKey'], key], 9, 4],
          14, ['case', ['==', ['get', 'speciesKey'], key], 10, 4],
        ])
        map.setPaintProperty('sighting-circles', 'circle-opacity', [
          'case', ['==', ['get', 'speciesKey'], key], 1, 0.2,
        ])
        map.setPaintProperty('sighting-circles', 'circle-stroke-width', [
          'case', ['==', ['get', 'speciesKey'], key], 2.5, 0.5,
        ])
        map.setPaintProperty('sighting-circles', 'circle-stroke-color', [
          'case', ['==', ['get', 'speciesKey'], key], '#ffeb3b', 'rgba(255, 255, 255, 0.3)',
        ])
        // Focus heatmap on selected species
        map.setFilter('sighting-heat', ['==', ['get', 'speciesKey'], key])
      }
    }
  }, [activeSpecies])

  // ─── Seasonal heatmap layer (patterns mode) ──────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const sourceId = 'seasonal-heat-points'
    const layerId = 'seasonal-heat-layer'

    function update() {
      if (!patternsMonth) {
        // Remove seasonal heatmap, restore sighting layers
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
        if (heatmapLayers) {
          markersRef.current.forEach(({ marker }) => marker.addTo(map))
        } else {
          // Restore sighting GL layers visibility
          if (map.getLayer('sighting-heat')) {
            map.setPaintProperty('sighting-heat', 'heatmap-opacity', [
              'interpolate', ['linear'], ['zoom'],
              HEAT_FADE_LO, 0.55,
              HEAT_FADE_HI, 0,
            ])
          }
          if (map.getLayer('sighting-circles')) {
            map.setPaintProperty('sighting-circles', 'circle-opacity', 0.85)
            map.setPaintProperty('sighting-circles', 'circle-stroke-opacity', 0.85)
          }
        }
        return
      }

      // Hide sighting layers during patterns mode
      if (heatmapLayers) {
        markersRef.current.forEach(({ marker }) => marker.remove())
      } else {
        if (map.getLayer('sighting-heat')) map.setPaintProperty('sighting-heat', 'heatmap-opacity', 0)
        if (map.getLayer('sighting-circles')) {
          map.setPaintProperty('sighting-circles', 'circle-opacity', 0)
          map.setPaintProperty('sighting-circles', 'circle-stroke-opacity', 0)
        }
      }

      // Build seasonal heatmap from sightings
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
              0, 4, 2, 8, 4, 16, 6, 24, 9, 32,
            ],
            'heatmap-intensity': [
              'interpolate', ['linear'], ['zoom'],
              0, 0.4, 2, 0.6, 4, 1, 8, 1.5,
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
              0, 0.6, 12, 0.6,
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
