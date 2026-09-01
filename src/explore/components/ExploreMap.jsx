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

    const sourceId = 'seasonal-bins'
    const layerId = 'seasonal-bins-fill'

    const sightingLayerIds = ['sighting-circles']

    function removeSeasonal() {
      if (map.getLayer(layerId)) map.removeLayer(layerId)
      if (map.getSource(sourceId)) map.removeSource(sourceId)
      seasonalUrlRef.current = null
    }

    function update() {
      if (!patternsMonth) {
        // Remove seasonal bins, restore sighting layers
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

      // Hex bins read as organic density; raw square bins look like giant
      // pixel blocks at low zoom. hexPerTile sets the visual grain (hex
      // columns per 512px tile) — screen-constant across zooms since tiles
      // are screen-constant. ~19 → ~27px hexes.
      const qs = new URLSearchParams({ srs: 'EPSG:3857', month: String(patternsMonth), occurrenceStatus: 'PRESENT', bin: 'hex', hexPerTile: '19' })
      for (const k of gbifTaxonKeys) qs.append('taxonKey', k)
      const tilesUrl = `https://api.gbif.org/v2/map/occurrence/adhoc/{z}/{x}/{y}.mvt?${qs.toString()}`

      if (seasonalUrlRef.current === tilesUrl) return // same month — keep the source
      removeSeasonal()
      seasonalUrlRef.current = tilesUrl

      map.addSource(sourceId, {
        type: 'vector',
        tiles: [tilesUrl],
        minzoom: 0,
        maxzoom: 16,
      })
      map.addLayer({
        id: layerId,
        type: 'fill',
        source: sourceId,
        'source-layer': 'occurrence',
        paint: {
          'fill-color': [
            'interpolate', ['linear'], ['get', 'total'],
            1,    'rgba(255, 185, 0, 0.5)',
            10,   'rgba(255, 145, 0, 0.62)',
            100,  'rgba(255, 90, 0, 0.75)',
            1000, 'rgba(220, 40, 20, 0.85)',
          ],
          'fill-outline-color': 'rgba(255, 255, 255, 0.25)',
        },
      })
    }

    if (map.__eaStyleReady || map.isStyleLoaded()) {
      update()
    } else {
      const onStyle = () => { update(); map.off('style.load', onStyle) }
      map.on('style.load', onStyle)
      return () => map.off('style.load', onStyle)
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
