import { useState, useEffect, useRef, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { fetchSpeciesObservations } from '../services/iNaturalist'
import { getTaxonMeta, formatDate } from '../utils/taxon'
import styles from './SpeciesMapModal.module.css'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

// Saturate and brighten a hex color for map visibility
function vibrateHex(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  // Convert to HSL, boost saturation, increase lightness slightly
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    const rf = r / 255, gf = g / 255, bf = b / 255
    if (rf === max) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) / 6
    else if (gf === max) h = ((bf - rf) / d + 2) / 6
    else h = ((rf - gf) / d + 4) / 6
  }
  // Boost saturation to 85%, set lightness to 50%
  const ns = Math.min(0.85, s + 0.3)
  const nl = Math.min(0.55, l + 0.1)
  // HSL back to RGB
  const hue2rgb = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1/6) return p + (q - p) * 6 * t; if (t < 1/2) return q; if (t < 2/3) return p + (q - p) * (2/3 - t) * 6; return p }
  const q = nl < 0.5 ? nl * (1 + ns) : nl + ns - nl * ns
  const p = 2 * nl - q
  const nr = Math.round(hue2rgb(p, q, h + 1/3) * 255)
  const ng = Math.round(hue2rgb(p, q, h) * 255)
  const nb = Math.round(hue2rgb(p, q, h - 1/3) * 255)
  return `#${nr.toString(16).padStart(2,'0')}${ng.toString(16).padStart(2,'0')}${nb.toString(16).padStart(2,'0')}`
}


const TIME_OPTIONS = [
  { key: '24h',   label: '24 Hours' },
  { key: 'week',  label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year',  label: 'Year' },
]

function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getDateRange(key) {
  const now = new Date()
  const d2 = localDate(now)
  const d = new Date(now)
  if (key === '24h')   d.setDate(d.getDate() - 1)
  else if (key === 'week')  d.setDate(d.getDate() - 7)
  else if (key === 'month') d.setMonth(d.getMonth() - 1)
  else if (key === 'year')  d.setFullYear(d.getFullYear() - 1)
  return { d1: localDate(d), d2 }
}

export default function SpeciesMapModal({ taxon, onClose }) {
  const open = !!taxon
  const [timeKey, setTimeKey] = useState('week')
  const [observations, setObservations] = useState([])
  const [totalResults, setTotalResults] = useState(null)
  const [loading, setLoading] = useState(false)

  const mapContainer = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])

  const common = taxon?.preferred_common_name || taxon?.name || 'Species'
  const scientific = taxon?.name || ''
  const iconic = taxon?.iconic_taxon_name || 'default'
  const { color, emoji } = getTaxonMeta(iconic)
  const photo = taxon?.default_photo?.square_url

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    const handleKey = e => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  // Initialize map when modal opens
  useEffect(() => {
    if (!open || mapRef.current) return

    // Wait for the modal transition to finish so the container has dimensions
    const timer = setTimeout(() => {
      if (!mapContainer.current) return
      const map = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/light-v11',
        center: [0, 20],
        zoom: 1.5,
      })
      map.addControl(new mapboxgl.NavigationControl(), 'top-left')
      // Ensure map resizes correctly once fully visible
      map.once('load', () => map.resize())
      mapRef.current = map
    }, 300)

    return () => {
      clearTimeout(timer)
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      markersRef.current = []
    }
  }, [open])

  // Fetch observations when taxon or time changes
  const fetchData = useCallback(async () => {
    if (!taxon?.id) return
    setLoading(true)
    try {
      const { d1, d2 } = getDateRange(timeKey)
      const data = await fetchSpeciesObservations({ taxonId: taxon.id, d1, d2 })
      setObservations(data.results || [])
      setTotalResults(data.total_results || 0)
    } catch {
      setObservations([])
      setTotalResults(0)
    } finally {
      setLoading(false)
    }
  }, [taxon?.id, timeKey])

  useEffect(() => {
    if (open) fetchData()
  }, [open, fetchData])

  const vibrantColor = vibrateHex(color)

  // Plot markers with popups
  useEffect(() => {
    const map = mapRef.current
    if (!map || loading) return

    // Clear old markers and popups
    markersRef.current.forEach(m => { m.popup?.remove(); m.marker.remove() })
    markersRef.current = []

    const bounds = new mapboxgl.LngLatBounds()
    let hasPoints = false

    observations.forEach(obs => {
      const lng = obs.geojson?.coordinates?.[0]
      const lat = obs.geojson?.coordinates?.[1]
      if (lng == null || lat == null) return

      const el = document.createElement('div')
      el.className = styles.marker
      el.style.backgroundColor = vibrantColor
      el.style.boxShadow = `0 0 0 1px rgba(0,0,0,0.15), 0 2px 6px ${vibrantColor}88`

      const photoUrl = obs.photos?.[0]?.url?.replace('square', 'medium')
      const place = obs.place_guess || 'Unknown location'
      const obsCommon = obs.taxon?.preferred_common_name || obs.taxon?.name || common
      const date = formatDate(obs.observed_on, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      const observer = obs.user?.login || 'Unknown'
      const quality = { research: 'Research Grade', needs_id: 'Needs ID', casual: 'Casual' }[obs.quality_grade] || ''
      const inatUrl = `https://www.inaturalist.org/observations/${obs.id}`

      const popupHtml = `
        <div style="font-family: var(--font-sans, sans-serif); width: 320px;">
          ${photoUrl ? `<img src="${photoUrl}" style="width:100%;height:200px;object-fit:cover;border-radius:8px 8px 0 0;display:block;" />` : ''}
          <div style="padding:14px 16px;">
            <div style="font-weight:700;font-size:16px;margin-bottom:4px;">${obsCommon}</div>
            <div style="font-size:13px;color:#5a5a5a;margin-bottom:8px;">${place}</div>
            <div style="display:flex;gap:16px;font-size:12px;color:#7a7060;margin-bottom:8px;">
              <span>${date}</span>
              <span>@${observer}</span>
            </div>
            ${quality ? `<span style="display:inline-block;font-size:10px;padding:3px 10px;border-radius:999px;background:#f0ebe3;color:#7a7060;margin-bottom:10px;">${quality}</span>` : ''}
            <div>
              <a href="${inatUrl}" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:#b8842a;text-decoration:none;font-weight:600;">View on iNaturalist ↗</a>
            </div>
          </div>
        </div>`

      const popup = new mapboxgl.Popup({ offset: 14, maxWidth: '360px', closeButton: true })
        .setHTML(popupHtml)

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([lng, lat])
        .setPopup(popup)
        .addTo(map)

      markersRef.current.push({ marker, popup })
      bounds.extend([lng, lat])
      hasPoints = true
    })

    if (hasPoints) {
      map.fitBounds(bounds, { padding: 60, maxZoom: 10 })
    }
  }, [observations, loading, common, vibrantColor])

  if (!open) return null

  return (
    <div
      className={`${styles.overlay} ${open ? styles.open : ''}`}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className={styles.modal} role="dialog" aria-modal="true">
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.titleRow}>
            {photo
              ? <img className={styles.photo} src={photo} alt={scientific} />
              : <div className={styles.photoPlaceholder}>{emoji}</div>}
            <div className={styles.titles}>
              <div className={styles.common}>{common}</div>
              <div className={styles.scientific}>{scientific}</div>
            </div>
            <span className={styles.taxonTag} style={{ background: color }}>{iconic}</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Toolbar */}
        <div className={styles.toolbar}>
          <div className={styles.timePills}>
            {TIME_OPTIONS.map(opt => (
              <button
                key={opt.key}
                className={`${styles.timePill} ${timeKey === opt.key ? styles.timePillActive : ''}`}
                onClick={() => setTimeKey(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {totalResults !== null && (
            <span className={styles.obsCount}>
              {totalResults.toLocaleString()} observation{totalResults !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Map */}
        <div className={styles.mapWrap}>
          <div ref={mapContainer} className={styles.map} />
          {loading && (
            <div className={styles.loadingOverlay}>
              <div className={styles.spinner} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
