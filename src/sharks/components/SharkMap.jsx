import { useEffect, useRef } from 'react'
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
  try { return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return dateStr }
}

export default function SharkMap({ sightings = [], center, activeSpecies, onCenterChange }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const activeSpeciesRef = useRef(activeSpecies)
  activeSpeciesRef.current = activeSpecies
  const flyingRef = useRef(false)
  const userCenterRef = useRef(null)

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: center ? [center.lng, center.lat] : [-40, 20],
      zoom: center ? 6 : 2,
      attributionControl: false,
      logoPosition: 'bottom-right',
    })

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')

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

  // Update center
  useEffect(() => {
    if (!mapRef.current || !center) return
    const uc = userCenterRef.current
    if (uc && Math.abs(uc.lat - center.lat) < 0.001 && Math.abs(uc.lng - center.lng) < 0.001) return
    flyingRef.current = true
    mapRef.current.once('moveend', () => { flyingRef.current = false })
    mapRef.current.flyTo({ center: [center.lng, center.lat], zoom: 6, duration: 1200 })
  }, [center?.lat, center?.lng])

  // Render markers
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    markersRef.current.forEach(m => m.marker.remove())
    markersRef.current = []

    sightings.forEach(s => {
      if (!s.lat || !s.lng) return

      const el = document.createElement('div')
      el.style.cssText = 'cursor: pointer;'
      el.title = s.common

      const dot = document.createElement('div')
      const isKnownShark = s.color && s.color !== '#e8e8e8'
      const dotColor = isKnownShark ? '#c0392b' : '#e67e22'
      dot.style.cssText = `
        width: ${isKnownShark ? '12px' : '9px'}; height: ${isKnownShark ? '12px' : '9px'};
        border-radius: 50%;
        background: ${dotColor};
        border: 2px solid rgba(255,255,255,0.6);
        transition: transform 0.15s, box-shadow 0.25s;
        box-shadow: 0 0 6px ${dotColor}88;
      `
      el.appendChild(dot)

      el.addEventListener('mouseenter', () => { dot.style.transform = 'scale(1.7)' })
      el.addEventListener('mouseleave', () => {
        const active = activeSpeciesRef.current
        dot.style.transform = active && String(s.speciesKey) === String(active) ? 'scale(1.4)' : 'scale(1)'
      })

      const photo = s.speciesPhoto || (s.photos && s.photos[0]) || null
      const iucnLabel = IUCN_LABEL[s.iucn] || null
      const iucnColor = IUCN_COLOR[s.iucn] || null

      const isMobile = window.innerWidth <= 600
      const photoH = isMobile ? 120 : 180

      const popup = new mapboxgl.Popup({
        offset: isMobile ? 0 : 12,
        closeButton: isMobile,
        maxWidth: isMobile ? '100%' : '280px',
      })
        .setHTML(`
          <div style="font-family:'DM Sans',system-ui,sans-serif;background:#fff;color:#1a2332;overflow:hidden;${isMobile ? 'width:100%;border-radius:16px 16px 0 0;' : 'width:260px;border-radius:12px;'}line-height:1.5;">
            ${iucnLabel ? `<div style="background:${iucnColor};color:#fff;font-size:10px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;padding:5px 16px;display:flex;align-items:center;gap:5px;"><span>⚠</span> ${iucnLabel}</div>` : ''}
            ${photo ? `<div style="position:relative;width:100%;height:${photoH}px;overflow:hidden;"><img src="${photo}" alt="${s.common}" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.parentElement.style.display='none'"/><div style="position:absolute;bottom:0;left:0;right:0;height:50px;background:linear-gradient(transparent,#fff);"></div></div>` : ''}
            <div style="padding:${isMobile ? '12px 16px 16px' : '14px 16px 16px'};">
              <div style="font-family:'Fraunces',Georgia,serif;font-size:${isMobile ? '18px' : '20px'};font-weight:400;color:#1a2332;margin-bottom:2px;line-height:1.25;">🦈 ${s.common}</div>
              ${s.scientific ? `<div style="font-style:italic;color:#5a6b7a;font-size:12px;margin-bottom:10px;">${s.scientific}</div>` : ''}
              ${s.fact ? `<div style="font-size:12px;color:#3d4f5f;line-height:1.5;margin-bottom:12px;border-left:2px solid ${dotColor}66;padding-left:10px;${isMobile ? 'display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;' : ''}">${s.fact}</div>` : ''}
              <div style="font-size:11px;color:#5a6b7a;display:flex;flex-direction:column;gap:3px;">
                ${s.place ? `<div>📍 ${s.place}</div>` : ''}
                ${s.date ? `<div>📅 ${formatDate(s.date)}</div>` : ''}
                <div style="margin-top:6px;font-size:10px;color:#7a8a96;text-transform:uppercase;letter-spacing:0.05em;">via ${s.source || 'GBIF'}</div>
              </div>
            </div>
          </div>
        `)

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
          if (popupRect.left < mapRect.left + pad) dx = popupRect.left - (mapRect.left + pad)
          else if (popupRect.right > mapRect.right - pad) dx = popupRect.right - (mapRect.right - pad)
          if (popupRect.top < mapRect.top + pad) dy = popupRect.top - (mapRect.top + pad)
          else if (popupRect.bottom > mapRect.bottom - pad) dy = popupRect.bottom - (mapRect.bottom - pad)
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

  // Highlight active species
  useEffect(() => {
    markersRef.current.forEach(({ dot, speciesKey }) => {
      if (!activeSpecies) {
        dot.style.transform = 'scale(1)'
        dot.style.borderColor = 'rgba(255,255,255,0.5)'
        dot.style.boxShadow = 'none'
      } else if (String(speciesKey) === String(activeSpecies)) {
        dot.style.transform = 'scale(1.8)'
        dot.style.borderColor = '#f5c518'
        dot.style.boxShadow = '0 0 0 3px #f5c518, 0 0 12px rgba(245,197,24,0.6)'
      } else {
        dot.style.transform = 'scale(0.75)'
        dot.style.borderColor = 'rgba(255,255,255,0.3)'
        dot.style.boxShadow = 'none'
      }
    })
  }, [activeSpecies])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
