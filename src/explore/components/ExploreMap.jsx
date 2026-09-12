import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { ensureWebGLSupport } from '../../utils/webglSupport'
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
// Source link for a sighting — every record links to its origin platform.
// eBird ids are `ebird-<subId>-<speciesCode>` (see normalizeEBirdObs), and the
// checklist page is the canonical public URL for an eBird observation.
function observationUrl(s) {
  const id = String(s.id)
  if (s.source === 'iNaturalist') return 'https://www.inaturalist.org/observations/' + id.replace('inat-', '')
  if (s.source === 'eBird') return 'https://ebird.org/checklist/' + id.split('-')[1]
  return 'https://www.gbif.org/occurrence/' + id
}

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
          <a href="${observationUrl(s)}" target="_blank" rel="noopener noreferrer" style="
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

/**
 * ExploreMap — unified Mapbox GL map for all EarthAtlas subsites.
 *
 * Recent-sightings rendering (all GL-native, GPU-rendered): one dot per
 * record, colored by species, newest sorted on top (circle-sort-key), with
 * click-to-popup. Patterns mode swaps in GBIF adhoc hex-bin density tiles.
 */
export default function ExploreMap({ sightings = [], center, activeSpecies, onCenterChange, onZoomChange, patternsMonth = null, radiusKm = null, searchId = 0, initialView = null, config = {} }) {
  const {
    fallbackColor = '#1a5276',
    fallbackEmoji = '',
    defaultZoom = 6,
    gbifTaxonKey = null,
  } = config

  // Taxon keys for GBIF adhoc map tiles (patterns mode) — repeated taxonKey
  // params OR together like the occurrence search API.
  const gbifTaxonKeys = gbifTaxonKey == null ? [] : (Array.isArray(gbifTaxonKey) ? gbifTaxonKey : [gbifTaxonKey])

  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [zoomLevel, setZoomLevel] = useState(
    initialView?.zoom != null ? initialView.zoom : (center ? defaultZoom : 2)
  )
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
    if (!ensureWebGLSupport(containerRef.current)) return
    mapboxgl.accessToken = MAPBOX_TOKEN

    // initialView (from a shared URL) overrides defaults: pass center to
    // place the map somewhere other than the search origin, pass zoom to
    // override defaultZoom, or both. Either triggers auto-fit suppression
    // so the map loads exactly where the link creator had it.
    const ivCenter = (initialView?.center?.lat != null && initialView?.center?.lng != null)
      ? initialView.center
      : null
    const ivZoom = initialView?.zoom != null ? initialView.zoom : null
    const hasInitialView = !!(ivCenter || ivZoom != null)
    const initialZoom = ivZoom != null ? ivZoom : (center ? defaultZoom : 1.5)
    const initialCenter = ivCenter
      ? [ivCenter.lng, ivCenter.lat]
      : (center ? [center.lng, center.lat] : [0, 20])

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: initialCenter,
      zoom: initialZoom,
      attributionControl: false,
      logoPosition: 'bottom-right',
    })

    // Mark user-panned so the flyTo-on-center-change and auto-fit effects
    // treat this as an intentional view and leave it alone.
    if (hasInitialView) {
      const refCenter = ivCenter || center
      if (refCenter) userCenterRef.current = { lat: refCenter.lat, lng: refCenter.lng }
      initialFitDone.current = true
    }

    map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right')
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')

    // Layer/fog setup on style.load, NOT the one-shot 'load' event — 'load'
    // waits for tiles and can be missed entirely (isStyleLoaded() can stay
    // false on a rendered map), leaving the map with no sighting layers.
    // See docs/MAP_TOOL_CONVENTIONS.md §4. style.load fires at style parse
    // and again after any future style switch. __eaStyleReady lets later
    // effects know setup already happened.
    map.on('style.load', () => {
      map.__eaStyleReady = true
      addSightingLayers()
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

    // ── Native GL layers (clusters + dots) from sighting GeoJSON ───────────
    function addSightingLayers() {
      if (map.getSource('sighting-src')) return

      map.addSource('sighting-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      // Sighting dots — every record its own dot, colored by species.
      // Newest render on top (circle-sort-key), so where dots overlap the
      // freshest sighting wins the pixel.
      map.addLayer({
        id: 'sighting-circles',
        type: 'circle',
        source: 'sighting-src',
        layout: {
          'circle-sort-key': ['get', 'ts'],
        },
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            0, 4,
            10, 6,
            14, 8,
          ],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
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

        // The map's box can extend past the browser fold, so "fits in the
        // map" isn't "visible". Anchor the popup toward the bigger VISIBLE
        // half: dot in the lower half of the on-screen map → popup opens
        // upward, and vice versa.
        const mapRect0 = map.getContainer().getBoundingClientRect()
        const visTop = Math.max(mapRect0.top, 0)
        const visBottom = Math.min(mapRect0.bottom, window.innerHeight)
        const dotClientY = mapRect0.top + map.project([s.lng, s.lat]).y
        const anchor = dotClientY > (visTop + visBottom) / 2 ? 'bottom' : 'top'

        const popup = new mapboxgl.Popup({
          offset: isMobile ? 0 : 12,
          closeButton: true,
          maxWidth: isMobile ? '100%' : '280px',
          // Default focus-on-open makes the BROWSER scroll the page to the
          // popup, yanking the map to the top. The panBy below keeps the
          // popup visible within the map instead.
          focusAfterOpen: false,
          ...(isMobile ? {} : { anchor }),
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
            // Fit against the VISIBLE map region — the intersection of the
            // map's box and the browser viewport — not the full container.
            const box = {
              left: Math.max(mapRect.left, 0),
              right: Math.min(mapRect.right, window.innerWidth),
              top: Math.max(mapRect.top, 0),
              bottom: Math.min(mapRect.bottom, window.innerHeight),
            }
            let dx = 0, dy = 0
            if (popupRect.left < box.left + pad)
              dx = popupRect.left - (box.left + pad)
            else if (popupRect.right > box.right - pad)
              dx = popupRect.right - (box.right - pad)
            if (popupRect.top < box.top + pad)
              dy = popupRect.top - (box.top + pad)
            else if (popupRect.bottom > box.bottom - pad)
              dy = popupRect.bottom - (box.bottom - pad)
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

    if (map.isStyleLoaded()) addSightingLayers() // style.load handler is the primary path

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
    if (import.meta.env.DEV) window.__exploreMap = map // dev-only QA handle
    if (import.meta.env.DEV) window.__eaMap = map // dev-only debugging handle

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
    // Parent-driven center change (e.g. Locate Me, manual location select)
    // clears the pinned view — the user wants to re-fit to the new origin.
    userCenterRef.current = null
    initialFitDone.current = false
    markFlying(1500)
    mapRef.current.flyTo({ center: [center.lng, center.lat], duration: 1200 })
  }, [center?.lat, center?.lng])

  // ─── Reset fit flag when a new search starts ────────────────────────────
  useEffect(() => {
    // Don't reset if the user has pinned a view (initialView from URL, or a
    // prior pan recorded in userCenterRef). Auto-fitting over their chosen
    // view would undo the whole point of a shareable map URL.
    if (userCenterRef.current) return
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
                ts: s.date ? Date.parse(s.date) : 0, // newest-on-top sort key
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

    // Source may not exist yet if style is still loading (style.load creates it)
    if (!updateSource()) {
      const onStyle = () => { updateSource(); map.off('style.load', onStyle) }
      map.on('style.load', onStyle)
      return () => map.off('style.load', onStyle)
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
        0, 4,
        10, 6,
        14, 8,
      ])
      map.setPaintProperty('sighting-circles', 'circle-color', ['get', 'color'])
      map.setPaintProperty('sighting-circles', 'circle-opacity', 1)
      map.setPaintProperty('sighting-circles', 'circle-stroke-width', 1.5)
      map.setPaintProperty('sighting-circles', 'circle-stroke-color', '#ffffff')
      map.setLayoutProperty('sighting-circles', 'circle-sort-key', ['get', 'ts'])
    } else {
      // Accept any identity the two callers use: explore subsites pass the
      // speciesKey (numeric GBIF key, or binomial fallback); the homepage
      // sidebar passes a lowercased scientific name (binomial for species,
      // trinomial for its subspecies rows). Features carry all three.
      const key = String(activeSpecies)
      const keyLower = key.toLowerCase()
      const matchExpr = ['any',
        ['==', ['get', 'speciesKey'], key],
        ['==', ['get', 'binomial'], keyLower],
        ['==', ['get', 'scientific'], keyLower],
      ]

      // Selected species: full brightness, bigger, yellow ring, above
      // everything. Others: dimmed context.
      map.setPaintProperty('sighting-circles', 'circle-radius', [
        'interpolate', ['linear'], ['zoom'],
        0, ['case', matchExpr, 6, 3],
        10, ['case', matchExpr, 9, 4.5],
        14, ['case', matchExpr, 11, 5.5],
      ])
      map.setPaintProperty('sighting-circles', 'circle-color', ['get', 'color'])
      map.setPaintProperty('sighting-circles', 'circle-opacity', [
        'case', matchExpr, 1, 0.3,
      ])
      map.setPaintProperty('sighting-circles', 'circle-stroke-width', [
        'case', matchExpr, 2.5, 0.5,
      ])
      map.setPaintProperty('sighting-circles', 'circle-stroke-color', [
        'case', matchExpr, '#ffeb3b', 'rgba(255, 255, 255, 0.3)',
      ])
      // Selected dots always paint over dimmed neighbors (newest-first within each group)
      map.setLayoutProperty('sighting-circles', 'circle-sort-key', [
        'case', matchExpr, ['+', ['get', 'ts'], 1e15], ['get', 'ts'],
      ])

      // No camera movement on selection — the map stays where the user put it;
      // highlighting alone tells the story.
    }
  }, [activeSpecies])

  // ─── Seasonal density layer (patterns mode) ──────────────────────────────
  // GBIF adhoc map tiles: server-side binned occurrence counts honoring the
  // month filter — EVERY record across all years, no fetch cap. Tiles carry
  // polygon bins (layer "occurrence") with a `total` count per bin.
  // Requires srs=EPSG:3857; the {z}/{x}/{y} template must stay unencoded in
  // the path, and the tile URL must be absolute (relative URLs throw in the
  // Mapbox worker).
  const seasonalUrlRef = useRef(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // GBIF adhoc tiles encode aggregated occurrences as tiny square POLYGONS
    // (one per aggregated pixel, `total` = count) — heatmap layers need
    // points. So: load the tiles through an invisible probe layer, convert
    // visible features to centroid points on idle, and run the heatmap on
    // that GeoJSON. Dedupe by coordinate (tile borders duplicate features).
    const sourceId = 'seasonal-bins'
    const probeLayerId = 'seasonal-bins-probe'
    const heatSourceId = 'seasonal-heat'
    const layerId = 'seasonal-heat-blobs'

    const sightingLayerIds = ['sighting-circles']

    function removeSeasonal() {
      for (const id of [layerId, probeLayerId]) if (map.getLayer(id)) map.removeLayer(id)
      for (const id of [heatSourceId, sourceId]) if (map.getSource(id)) map.removeSource(id)
      map.off('idle', rebuildPoints)
      map.off('sourcedata', onSourceData)
      seasonalUrlRef.current = null
    }

    function rebuildPoints() {
      if (!map.getSource(heatSourceId) || !map.getSource(sourceId)) return
      const feats = map.querySourceFeatures(sourceId, { sourceLayer: 'occurrence' })
      const seen = new Set()
      const points = []
      for (const ft of feats) {
        const ring = ft.geometry?.coordinates?.[0]
        if (!ring || !ring.length) continue
        // Ring positions are usually [lng, lat] arrays, but this query path
        // can surface mapbox Point objects ({x, y}) — handle both, skip junk.
        let x = 0; let y = 0; let n = 0
        for (let j = 0; j < ring.length; j++) {
          const pt = ring[j]
          const plng = Array.isArray(pt) ? pt[0] : pt?.x
          const plat = Array.isArray(pt) ? pt[1] : pt?.y
          if (!Number.isFinite(plng) || !Number.isFinite(plat)) continue
          x += plng; y += plat; n++
        }
        if (!n) continue
        const lng = x / n
        const lat = y / n
        const key = lng.toFixed(4) + ',' + lat.toFixed(4)
        if (seen.has(key)) continue
        seen.add(key)
        points.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { total: ft.properties.total || 1 } })
      }
      map.getSource(heatSourceId).setData({ type: 'FeatureCollection', features: points })
      // Recalibrate the ramp top from the TRUE kernel-density peak: for the
      // loaded points, evaluate the same Gaussian-falloff sum the GPU will
      // draw (kernel size tracks the paint: geographic below z6, screen-
      // capped above) and pin the hottest spot to the top of the ramp.
      // O(n²) on ≤~1k points — microseconds, and exact at every zoom.
      const z = map.getZoom()
      const kernelPx = z <= 3 ? 10 : z >= 6 ? 80 : 10 + ((Math.pow(2, z - 3) - 1) / 7) * 70
      const rDeg = Math.max(0.02, kernelPx * 360 / (512 * Math.pow(2, z)))
      const r2 = rDeg * rDeg
      const coslat = Math.cos((map.getCenter().lat * Math.PI) / 180)
      const ws = points.map((p) => Math.min(1, Math.log(1 + p.properties.total) / 7))
      let peak = 0
      for (let i = 0; i < points.length; i++) {
        const [xi, yi] = points[i].geometry.coordinates
        let d = 0
        for (let j = 0; j < points.length; j++) {
          const [xj, yj] = points[j].geometry.coordinates
          const dx = (xi - xj) * coslat
          const dy = yi - yj
          const q = (dx * dx + dy * dy) / r2
          if (q < 1) d += ws[j] * (1 - q) * (1 - q) // Epanechnikov-ish falloff
        }
        if (d > peak) peak = d
      }
      const band = Math.round(z)
      if (band !== ratchetBand) { ratchetBand = band; ratchet = 0 }
      if (peak > ratchet) {
        ratchet = peak
        if (map.getLayer(layerId)) map.setPaintProperty(layerId, 'heatmap-intensity', intensityExpr())
      }
    }

    // Density scale is MEASURED, not guessed: rebuildPoints tallies log
    // weights into fixed 0.35° geographic cells and pins the hottest cell
    // seen so far (ratchet — so the scale never flickers while exploring;
    // it resets when the selection changes) to the top of the color ramp.
    // Same selection → same scale wherever you pan or zoom, and "All
    // months" vs a sparse February each get a scale that shows structure.
    let ratchet = 0
    let ratchetBand = null
    function intensityExpr() {
      const k = Math.min(6, Math.max(0.1, 3.2 / Math.max(0.05, ratchet)))
      return ['interpolate', ['exponential', 2], ['zoom'], 3, 0.55 * k, 6, 2.0 * k]
    }

    function update() {
      if (!patternsMonth) {
        // Remove seasonal layers, restore sighting layers
        removeSeasonal()
        for (const id of sightingLayerIds) {
          if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible')
        }
        return
      }

      // Hide sighting layers during patterns mode (visibility, not opacity —
      // an opacity-0 layer still catches clicks)
      for (const id of sightingLayerIds) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none')
      }

      // `patternsMonth` is a single month, a GBIF range "5,9", or 'all'.
      const qs = new URLSearchParams({ srs: 'EPSG:3857', occurrenceStatus: 'PRESENT' })
      if (patternsMonth !== 'all') qs.set('month', String(patternsMonth))
      for (const k of gbifTaxonKeys) qs.append('taxonKey', k)
      // Observation records only — matches gbifSearchParams in the service.
      // Machine observations (acoustic arrays etc.) carry grid-estimated
      // positions that render as literal stripes.
      for (const b of ['HUMAN_OBSERVATION', 'OBSERVATION', 'OCCURRENCE']) qs.append('basisOfRecord', b)
      const tilesUrl = `https://api.gbif.org/v2/map/occurrence/adhoc/{z}/{x}/{y}.mvt?${qs.toString()}`

      if (seasonalUrlRef.current === tilesUrl) {
        // Same tiles — re-arm listeners (a prior cleanup detached them).
        map.on('sourcedata', onSourceData)
        map.on('idle', rebuildPoints)
        rebuildPoints()
        return
      }
      removeSeasonal()
      seasonalUrlRef.current = tilesUrl

      map.addSource(sourceId, { type: 'vector', tiles: [tilesUrl], minzoom: 0, maxzoom: 16 })
      map.addSource(heatSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      // Invisible probe: a source only loads tiles while some layer uses it.
      map.addLayer({
        id: probeLayerId,
        type: 'fill',
        source: sourceId,
        'source-layer': 'occurrence',
        paint: { 'fill-opacity': 0 },
      })
      map.addLayer({
        id: layerId,
        type: 'heatmap',
        source: heatSourceId,
        paint: {
          // ONE fixed spatial scale at every zoom and viewport. Log weight
          // (counts are long-tailed). The kernel is GEOGRAPHIC — exponential
          // base 2 doubles the pixel radius per zoom, so a blob is anchored
          // to a place and scales with the map instead of decomposing into
          // dots; sized ~0.7° so gridded data (iNat obscures threatened
          // species to ~0.2°; survey transects sit ~0.5° apart) merges into
          // a field instead of striping.
          'heatmap-weight': ['interpolate', ['linear'], ['ln', ['+', 1, ['get', 'total']]], 0, 0.008, 7, 1],
          'heatmap-intensity': intensityExpr(),
          // Geographic below z6 (blobs anchor to places; grids melt), then
          // screen-capped: past z6 you are inside the regional blob and an
          // ever-growing kernel drowns local structure — capping lets the
          // Channel-Islands-scale detail re-emerge as you zoom.
          'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 3, 10, 6, 80],
          // Low end stays transparent until real density — the kernel's
          // faint outer tail otherwise paints a misleading fringe well
          // inland/offshore of the actual sightings.
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,    'rgba(240, 180, 60, 0)',
            0.12, 'rgba(240, 195, 90, 0.18)',
            0.35, 'rgba(238, 150, 45, 0.42)',
            0.65, 'rgba(228, 95, 28, 0.62)',
            0.88, 'rgba(205, 50, 18, 0.76)',
            1,    'rgba(165, 20, 10, 0.76)',
          ],
        },
      })
      // Rebuild as tiles arrive (fresh loads race a single idle event) and
      // after every settle (pan/zoom loads new tiles).
      map.on('sourcedata', onSourceData)
      map.on('idle', rebuildPoints)
    }

    function onSourceData(e) {
      if (e.sourceId === sourceId && map.isSourceLoaded(sourceId)) rebuildPoints()
    }

    function teardownListeners() {
      map.off('idle', rebuildPoints)
      map.off('sourcedata', onSourceData)
    }

    if (map.__eaStyleReady || map.isStyleLoaded()) {
      update()
      return teardownListeners
    } else {
      const onStyle = () => { update(); map.off('style.load', onStyle) }
      map.on('style.load', onStyle)
      return () => { map.off('style.load', onStyle); teardownListeners() }
    }
  }, [patternsMonth, gbifTaxonKeys.join(',')])

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
