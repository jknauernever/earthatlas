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

function formatTime(timeStr) {
  if (!timeStr) return ''
  try {
    // eBird: "2024-01-15 08:30" (local time, no timezone)
    if (timeStr.includes(' ') && !timeStr.includes('T')) {
      const timePart = timeStr.split(' ')[1]
      if (!timePart) return ''
      const [h, m] = timePart.split(':')
      const hr = parseInt(h, 10)
      const ampm = hr >= 12 ? 'PM' : 'AM'
      const hr12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr
      return `${hr12}:${m} ${ampm}`
    }
    // iNaturalist: ISO 8601 with timezone offset e.g. "2024-01-15T08:30:00-05:00"
    const d = new Date(timeStr)
    if (isNaN(d)) return ''
    // Extract the original timezone offset to display local observation time
    const match = timeStr.match(/([+-]\d{2}):?(\d{2})$/)
    if (match) {
      const offsetMin = parseInt(match[1], 10) * 60 + (parseInt(match[1], 10) < 0 ? -1 : 1) * parseInt(match[2], 10)
      const utcMs = d.getTime()
      const local = new Date(utcMs + offsetMin * 60000 + d.getTimezoneOffset() * 60000)
      return local.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    }
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch { return '' }
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
          ${s.date ? `<div>\u{1F4C5} ${formatDate(s.date)}${formatTime(s.time) ? ` at ${formatTime(s.time)}` : ''}</div>` : ''}
          ${s.observer ? `<div>\u{1F464} ${s.observer}</div>` : ''}
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

// Crossfade zone: heatmap fades out, circles fade in
const XFADE_LO = 7   // heatmap starts fading, circles start appearing
const XFADE_HI = 10  // heatmap gone, circles fully visible

/**
 * ExploreMap — unified Mapbox GL map for all EarthAtlas subsites.
 *
 * Rendering tiers (all GL-native, GPU-rendered):
 *   z < 7   — heatmap layer (from sighting GeoJSON)
 *   z 7–10  — smooth crossfade (heatmap fading out, circle dots fading in)
 *   z > 10  — circle dot layer with click-to-popup
 */
export default function ExploreMap({ sightings = [], center, activeSpecies, onCenterChange, onZoomChange, patternsMonth = null, radiusKm = null, searchId = 0, config = {} }) {
  const {
    fallbackColor = '#1a5276',
    fallbackEmoji = '',
    defaultZoom = 6,
    gbifTaxonKey = null,
  } = config

  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [zoomLevel, setZoomLevel] = useState(center ? defaultZoom : 2)
  const sightingsRef = useRef(sightings) // full sighting objects for popup lookup
  sightingsRef.current = sightings
  const activeSpeciesRef = useRef(activeSpecies)
  activeSpeciesRef.current = activeSpecies
  const onCenterChangeRef = useRef(onCenterChange)
  onCenterChangeRef.current = onCenterChange
  const onZoomChangeRef = useRef(onZoomChange)
  onZoomChangeRef.current = onZoomChange
  const flyingUntilRef = useRef(0) // timestamp until which programmatic moves are in progress
  const isFlying = () => Date.now() < flyingUntilRef.current
  const markFlying = (ms = 2500) => { flyingUntilRef.current = Math.max(flyingUntilRef.current, Date.now() + ms) }
  const userCenterRef = useRef(null)
  const popupRef = useRef(null) // single reusable popup instance
  const initialFitDone = useRef(false) // only auto-fit on first data load
  const fallbackColorRef = useRef(fallbackColor)
  fallbackColorRef.current = fallbackColor
  const fallbackEmojiRef = useRef(fallbackEmoji)
  fallbackEmojiRef.current = fallbackEmoji

  // ─── Init map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN

    const initialZoom = center ? defaultZoom : 1.5

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: center ? [center.lng, center.lat] : [0, 20],
      zoom: initialZoom,
      attributionControl: false,
      logoPosition: 'bottom-right',
    })

    map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right')
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')

    // Globe-style fog — match space color to page background
    map.on('load', () => {
      try {
        map.setFog({
          color: '#f5f0e8',
          'high-color': '#f5f0e8',
          'space-color': '#f5f0e8',
          'horizon-blend': 0.02,
          'star-intensity': 0,
        })
      } catch (e) { /* fog not supported */ }
    })

    // ── Native GL layers (heatmap + circles) from sighting GeoJSON ─────────
    function addSightingLayers() {
      if (map.getSource('sighting-src')) return

      // GBIF vector tile density heatmap — covers the entire globe
      if (gbifTaxonKey) {
        map.addSource('gbif-density', {
          type: 'vector',
          tiles: [
            `https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}.mvt?taxonKey=${gbifTaxonKey}&basisOfRecord=HUMAN_OBSERVATION`,
          ],
          maxzoom: 14,
        })
        map.addLayer({
          id: 'gbif-density-heat',
          type: 'heatmap',
          source: 'gbif-density',
          'source-layer': 'occurrence',
          paint: {
            'heatmap-weight': [
              'interpolate', ['linear'],
              ['get', 'total'],
              0, 0,
              1, 0.05,
              10, 0.15,
              100, 0.4,
              1000, 0.8,
              10000, 1,
            ],
            'heatmap-radius': [
              'interpolate', ['linear'], ['zoom'],
              0, 2,
              3, 6,
              5, 14,
              XFADE_LO, 22,
              XFADE_HI, 30,
            ],
            'heatmap-intensity': [
              'interpolate', ['linear'], ['zoom'],
              0, 0.15,
              3, 0.25,
              5, 0.4,
              XFADE_LO, 0.7,
              XFADE_HI, 1.0,
            ],
            'heatmap-color': [
              'interpolate', ['linear'], ['heatmap-density'],
              0,    'rgba(0, 0, 0, 0)',
              0.1,  'rgba(255, 200, 0, 0.1)',
              0.25, 'rgba(255, 190, 0, 0.2)',
              0.4,  'rgba(255, 180, 0, 0.35)',
              0.55, 'rgba(255, 160, 0, 0.45)',
              0.7,  'rgba(255, 130, 0, 0.55)',
              0.85, 'rgba(255, 100, 0, 0.65)',
              1.0,  'rgba(255, 60, 0, 0.75)',
            ],
            'heatmap-opacity': [
              'interpolate', ['linear'], ['zoom'],
              XFADE_LO - 1, 0.85,
              XFADE_LO, 0.6,
              XFADE_HI, 0,
            ],
          },
        })
      }

      map.addSource('sighting-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      // Heatmap layer — bright glowing blobs at low zoom, crossfades out
      map.addLayer({
        id: 'sighting-heat',
        type: 'heatmap',
        source: 'sighting-src',
        paint: {
          'heatmap-radius': [
            'interpolate', ['linear'], ['zoom'],
            0, 30,
            3, 40,
            5, 35,
            XFADE_LO, 30,
            XFADE_HI, 40,
          ],
          'heatmap-intensity': [
            'interpolate', ['linear'], ['zoom'],
            0, 0.6,
            4, 0.8,
            XFADE_LO, 1.2,
            XFADE_HI, 1.5,
          ],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,    'rgba(0, 0, 0, 0)',
            0.05, 'rgba(255, 180, 0, 0.25)',
            0.15, 'rgba(255, 190, 0, 0.5)',
            0.3,  'rgba(255, 200, 20, 0.7)',
            0.5,  'rgba(255, 190, 0, 0.8)',
            0.7,  'rgba(255, 160, 0, 0.85)',
            0.85, 'rgba(255, 120, 0, 0.9)',
            1.0,  'rgba(255, 80, 0, 0.95)',
          ],
          'heatmap-opacity': [
            'interpolate', ['linear'], ['zoom'],
            XFADE_LO - 1, 0.85,
            XFADE_LO, 0.75,
            XFADE_HI, 0,
          ],
        },
      })

      // Circle layer — crossfades in as heatmap fades out
      map.addLayer({
        id: 'sighting-circles',
        type: 'circle',
        source: 'sighting-src',
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            XFADE_LO, 3,
            XFADE_HI, 6,
            14, 8,
          ],
          'circle-color': '#ff6a00',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': [
            'interpolate', ['linear'], ['zoom'],
            XFADE_LO, 1,
            XFADE_HI, 2,
          ],
          'circle-opacity': [
            'interpolate', ['linear'], ['zoom'],
            XFADE_LO, 0,
            XFADE_LO + 1, 0.7,
            XFADE_HI, 1,
          ],
          'circle-stroke-opacity': [
            'interpolate', ['linear'], ['zoom'],
            XFADE_LO, 0,
            XFADE_LO + 1, 0.8,
            XFADE_HI, 1,
          ],
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
            markFlying(500)
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
              markFlying(500)
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

    // ── Fire onCenterChange after user-initiated moves ─────────────────────
    let debounceTimer = null
    map.on('moveend', () => {
      if (isFlying()) return
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

    // Resize map when container dimensions change (e.g. feed expand/collapse)
    const ro = new ResizeObserver(() => {
      if (mapRef.current) mapRef.current.resize()
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
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
    // Skip if map is already at the target center (avoids stuck flyingRef on init)
    const mc = mapRef.current.getCenter()
    if (Math.abs(mc.lat - center.lat) < 0.001 && Math.abs(mc.lng - center.lng) < 0.001) return
    markFlying(1500)
    mapRef.current.flyTo({ center: [center.lng, center.lat], duration: 1200 })
  }, [center?.lat, center?.lng])

  // ─── Reset fit flag when a new search starts ────────────────────────────
  useEffect(() => {
    initialFitDone.current = false
  }, [searchId])

  // ─── Auto-fit to data on first load ─────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || sightings.length === 0) return

    if (radiusKm && center && !initialFitDone.current) {
      // Homepage map with explicit radius — fit to radius circle once per search
      initialFitDone.current = true
      const earthRadius = 6371
      const dLat = (radiusKm / earthRadius) * (180 / Math.PI)
      const dLng = dLat / Math.cos(center.lat * Math.PI / 180)
      const bounds = new mapboxgl.LngLatBounds(
        [center.lng - dLng, center.lat - dLat],
        [center.lng + dLng, center.lat + dLat]
      )
      markFlying(1100)
      map.fitBounds(bounds, { padding: 40, duration: 800 })
    } else if (!center && !initialFitDone.current) {
      // Worldwide mode — fly to the densest cluster ONCE on first data load
      initialFitDone.current = true
      const valid = sightings.filter(s => s.lat != null && s.lng != null)
      if (valid.length === 0) return

      // Find density center using a simple grid-based approach
      const GRID = 10 // degrees per cell
      const cells = {}
      for (const s of valid) {
        const cellKey = `${Math.round(s.lat / GRID)},${Math.round(s.lng / GRID)}`
        if (!cells[cellKey]) cells[cellKey] = { sumLat: 0, sumLng: 0, count: 0 }
        cells[cellKey].sumLat += s.lat
        cells[cellKey].sumLng += s.lng
        cells[cellKey].count++
      }
      const densest = Object.values(cells).sort((a, b) => b.count - a.count)[0]
      const targetLat = densest.sumLat / densest.count
      const targetLng = densest.sumLng / densest.count

      // Zoom level based on spread of points in the densest cluster
      const bounds = new mapboxgl.LngLatBounds()
      for (const s of valid) bounds.extend([s.lng, s.lat])
      const span = Math.max(bounds.getNorth() - bounds.getSouth(), bounds.getEast() - bounds.getWest())
      const zoom = span > 100 ? 2 : span > 40 ? 3 : span > 15 ? 4 : span > 5 ? 5 : 6

      markFlying(2500)
      map.flyTo({
        center: [targetLng, targetLat],
        zoom,
        duration: 2000,
        essential: true,
      })
    }
  }, [center?.lat, center?.lng, radiusKm, sightings])

  // ─── Update sighting data ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

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
                scientific: (s.scientific || '').toLowerCase(),
                binomial: (s.scientific || '').toLowerCase().split(/\s+/).slice(0, 2).join(' '),
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
  }, [sightings])

  // ─── Active species highlighting ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('sighting-circles')) return

    if (!activeSpecies) {
      // Reset to defaults
      map.setPaintProperty('sighting-circles', 'circle-radius', [
        'interpolate', ['linear'], ['zoom'],
        XFADE_LO, 3,
        XFADE_HI, 6,
        14, 8,
      ])
      map.setPaintProperty('sighting-circles', 'circle-color', '#ff6a00')
      map.setPaintProperty('sighting-circles', 'circle-opacity', [
        'interpolate', ['linear'], ['zoom'],
        XFADE_LO, 0,
        XFADE_LO + 1, 0.7,
        XFADE_HI, 1,
      ])
      map.setPaintProperty('sighting-circles', 'circle-stroke-width', [
        'interpolate', ['linear'], ['zoom'],
        XFADE_LO, 1,
        XFADE_HI, 2,
      ])
      map.setPaintProperty('sighting-circles', 'circle-stroke-color', '#ffffff')
      map.setFilter('sighting-heat', null)
    } else {
      const key = String(activeSpecies).toLowerCase()
      // Determine if filtering by binomial (parent species) or exact scientific name (subspecies)
      const isBinomial = key.split(/\s+/).length <= 2
      const matchProp = isBinomial ? 'binomial' : 'scientific'
      const matchExpr = ['==', ['get', matchProp], key]

      // Highlight matching, dim non-matching
      map.setPaintProperty('sighting-circles', 'circle-radius', [
        'interpolate', ['linear'], ['zoom'],
        XFADE_LO, ['case', matchExpr, 5, 2],
        XFADE_HI, ['case', matchExpr, 9, 4],
        14, ['case', matchExpr, 11, 5],
      ])
      map.setPaintProperty('sighting-circles', 'circle-color', [
        'case', matchExpr, '#ff4400', '#ff6a00',
      ])
      map.setPaintProperty('sighting-circles', 'circle-opacity', [
        'interpolate', ['linear'], ['zoom'],
        XFADE_LO, 0,
        XFADE_LO + 1, ['case', matchExpr, 1, 0.25],
        XFADE_HI, ['case', matchExpr, 1, 0.25],
      ])
      map.setPaintProperty('sighting-circles', 'circle-stroke-width', [
        'case', matchExpr, 2.5, 0.5,
      ])
      map.setPaintProperty('sighting-circles', 'circle-stroke-color', [
        'case', matchExpr, '#ffeb3b', 'rgba(255, 255, 255, 0.3)',
      ])
      // Focus heatmap on selected species
      map.setFilter('sighting-heat', matchExpr)

      // Fly to the densest cluster for this species
      const matching = sightingsRef.current.filter(s => {
        const sci = (s.scientific || '').toLowerCase()
        const bin = sci.split(/\s+/).slice(0, 2).join(' ')
        return (isBinomial ? bin === key : sci === key) && s.lat != null && s.lng != null
      })
      if (matching.length > 0) {
        const GRID = 5
        const cells = {}
        for (const s of matching) {
          const ck = `${Math.round(s.lat / GRID)},${Math.round(s.lng / GRID)}`
          if (!cells[ck]) cells[ck] = { sumLat: 0, sumLng: 0, count: 0 }
          cells[ck].sumLat += s.lat
          cells[ck].sumLng += s.lng
          cells[ck].count++
        }
        const densest = Object.values(cells).sort((a, b) => b.count - a.count)[0]
        const tLat = densest.sumLat / densest.count
        const tLng = densest.sumLng / densest.count

        const bounds = new mapboxgl.LngLatBounds()
        for (const s of matching) bounds.extend([s.lng, s.lat])
        const span = Math.max(bounds.getNorth() - bounds.getSouth(), bounds.getEast() - bounds.getWest())
        const zoom = span > 100 ? 2.5 : span > 40 ? 3.5 : span > 15 ? 4.5 : span > 5 ? 6 : 8

        markFlying(1800)
        map.flyTo({ center: [tLng, tLat], zoom, duration: 1500, essential: true })
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
        if (map.getLayer('gbif-density-heat')) {
          map.setPaintProperty('gbif-density-heat', 'heatmap-opacity', [
            'interpolate', ['linear'], ['zoom'],
            XFADE_LO - 1, 0.85,
            XFADE_LO, 0.6,
            XFADE_HI, 0,
          ])
        }
        if (map.getLayer('sighting-heat')) {
          map.setPaintProperty('sighting-heat', 'heatmap-opacity', [
            'interpolate', ['linear'], ['zoom'],
            XFADE_LO - 1, 0.85,
            XFADE_LO, 0.75,
            XFADE_HI, 0,
          ])
        }
        if (map.getLayer('sighting-circles')) {
          map.setPaintProperty('sighting-circles', 'circle-opacity', [
            'interpolate', ['linear'], ['zoom'],
            XFADE_LO, 0,
            XFADE_HI, 0.9,
          ])
          map.setPaintProperty('sighting-circles', 'circle-stroke-opacity', [
            'interpolate', ['linear'], ['zoom'],
            XFADE_LO, 0,
            XFADE_HI, 0.85,
          ])
        }
        return
      }

      // Hide sighting layers during patterns mode
      if (map.getLayer('gbif-density-heat')) map.setPaintProperty('gbif-density-heat', 'heatmap-opacity', 0)
      if (map.getLayer('sighting-heat')) map.setPaintProperty('sighting-heat', 'heatmap-opacity', 0)
      if (map.getLayer('sighting-circles')) {
        map.setPaintProperty('sighting-circles', 'circle-opacity', 0)
        map.setPaintProperty('sighting-circles', 'circle-stroke-opacity', 0)
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
      <div style={{
        position: 'absolute', bottom: 8, left: 8,
        background: 'rgba(0,0,0,0.55)', color: 'rgba(255,255,255,0.75)',
        fontSize: 10, fontWeight: 500, fontFamily: 'monospace',
        padding: '2px 6px', borderRadius: 3,
        pointerEvents: 'none', zIndex: 5,
        lineHeight: 1.4,
      }}>
        z{zoomLevel.toFixed(1)}
      </div>
    </div>
  )
}
