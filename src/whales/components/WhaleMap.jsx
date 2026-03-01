import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

/**
 * WhaleMap — Mapbox GL map for cetacean sightings.
 *
 * Props:
 *   sightings      — array of normalized sighting objects
 *   center         — { lat, lng } map center
 *   onSightingClick — (sighting) => void  called when a pin is clicked
 *   activeSighting  — id of currently highlighted sighting (optional)
 */
export default function WhaleMap({ sightings = [], center, onSightingClick, activeSighting }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: center ? [center.lng, center.lat] : [-100, 35],
      zoom: center ? 6 : 2,
      attributionControl: false,
      logoPosition: 'bottom-right',
    })

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // Update center
  useEffect(() => {
    if (!mapRef.current || !center) return
    mapRef.current.flyTo({ center: [center.lng, center.lat], zoom: 6, duration: 1200 })
  }, [center?.lat, center?.lng])

  // Render markers
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Remove old markers
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    sightings.forEach(s => {
      if (!s.lat || !s.lng) return

      const el = document.createElement('div')
      el.style.cssText = `
        width: 12px; height: 12px;
        border-radius: 50%;
        background: ${s.color || '#4dd9c0'};
        border: 2px solid rgba(255,255,255,0.25);
        cursor: pointer;
        transition: transform 0.15s;
        box-shadow: 0 0 8px ${s.color || '#4dd9c0'}88;
      `
      el.title = s.common

      el.addEventListener('mouseenter', () => { el.style.transform = 'scale(1.6)' })
      el.addEventListener('mouseleave', () => { el.style.transform = 'scale(1)' })
      el.addEventListener('click', () => onSightingClick?.(s))

      if (activeSighting === s.id) {
        el.style.transform = 'scale(1.8)'
        el.style.zIndex = '10'
        el.style.boxShadow = `0 0 16px ${s.color || '#4dd9c0'}`
      }

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([s.lng, s.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 12, className: 'whale-popup', closeButton: false })
            .setHTML(`
              <div style="
                font-family:'DM Sans',system-ui,sans-serif;
                background:#0d2545;
                color:#deeef8;
                padding:10px 14px;
                border-radius:10px;
                font-size:13px;
                line-height:1.5;
                min-width:160px;
              ">
                <div style="font-family:'Fraunces',Georgia,serif;font-size:15px;font-weight:300;margin-bottom:3px">${s.common}</div>
                ${s.scientific ? `<div style="font-style:italic;color:rgba(180,215,235,0.55);font-size:11px;margin-bottom:6px">${s.scientific}</div>` : ''}
                ${s.date ? `<div style="font-size:11px;color:rgba(120,165,195,0.7)">${formatDate(s.date)}</div>` : ''}
                ${s.place ? `<div style="font-size:11px;color:rgba(120,165,195,0.7)">${s.place}</div>` : ''}
              </div>
            `)
        )
        .addTo(map)

      markersRef.current.push(marker)
    })
  }, [sightings, activeSighting])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return dateStr }
}
