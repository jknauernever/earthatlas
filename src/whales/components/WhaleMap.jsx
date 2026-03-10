import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

// Dot colors that signal conservation status → label for popup band
const STATUS_BY_COLOR = {
  '#e06868': 'Critically Endangered',
  '#d87060': 'Endangered',
  '#d08060': 'Endangered',
  '#c87060': 'Endangered',
}

/**
 * WhaleMap — Mapbox GL map for cetacean sightings.
 *
 * Props:
 *   sightings      — array of normalized sighting objects
 *   center         — { lat, lng } map center
 *   onSightingClick — (sighting) => void  called when a pin is clicked
 *   activeSighting  — id of currently highlighted sighting (optional)
 */
export default function WhaleMap({ sightings = [], center, activeSpecies, onCenterChange }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])  // each entry: { marker, dot, speciesKey }
  const activeSpeciesRef = useRef(activeSpecies)
  activeSpeciesRef.current = activeSpecies
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
      zoom: center ? 6 : 2,
      attributionControl: false,
      logoPosition: 'bottom-right',
    })

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')

    // Fire onCenterChange after user-initiated moves (not programmatic flyTo)
    let debounceTimer = null
    map.on('moveend', () => {
      if (flyingRef.current) return
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        const c = map.getCenter()
        const z = map.getZoom()
        userCenterRef.current = { lat: c.lat, lng: c.lng }
        onCenterChange?.({ lat: c.lat, lng: c.lng, zoom: z })
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
    mapRef.current.flyTo({ center: [center.lng, center.lat], zoom: 6, duration: 1200 })
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
      const dotColor = s.color || '#1a5276'
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

      const popup = new mapboxgl.Popup({ offset: 12, className: 'whale-popup', closeButton: false, maxWidth: '280px' })
        .setHTML(`
          <div style="
            font-family:'DM Sans',system-ui,sans-serif;
            background:#ffffff;
            color:#1a2332;
            border-radius:12px;
            overflow:hidden;
            width:260px;
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
            <div style="position:relative;width:100%;height:200px;overflow:hidden;">
              <img src="${photo}" alt="${s.common}" style="
                width:100%;height:100%;object-fit:cover;display:block;
              " onerror="this.parentElement.style.display='none'" />
              <div style="
                position:absolute;bottom:0;left:0;right:0;height:60px;
                background:linear-gradient(transparent, #ffffff);
              "></div>
            </div>` : ''}
            <div style="padding:14px 16px 16px;">
              <div style="
                font-family:'Fraunces',Georgia,serif;
                font-size:20px;font-weight:400;
                color:#1a2332;
                margin-bottom:2px;
                line-height:1.25;
              ">${s.emoji || '🐋'} ${s.common}</div>
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
                border-left:2px solid ${s.color || '#1a5276'}44;
                padding-left:10px;
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

      // Pan the map so the full popup is visible after it opens
      // Set flyingRef so this pan doesn't trigger onCenterChange (which would reload data)
      popup.on('open', () => {
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
  }, [sightings])

  // Highlight dots matching activeSpecies with a white outline
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

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return dateStr }
}
