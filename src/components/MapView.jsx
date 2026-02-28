import { useEffect, useRef, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { getTaxonMeta } from '../utils/taxon'
import styles from './MapView.module.css'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

// Generate a GeoJSON polygon approximating a circle
function createCircleGeoJSON(center, radiusKm, points = 64) {
  const coords = []
  const earthRadius = 6371 // km
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI
    const lat = center.lat + (radiusKm / earthRadius) * (180 / Math.PI) * Math.sin(angle)
    const lng = center.lng + (radiusKm / earthRadius) * (180 / Math.PI) * Math.cos(angle) / Math.cos(center.lat * Math.PI / 180)
    coords.push([lng, lat])
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } }
}

export default function MapView({ observations, onSelect, coords, radiusKm }) {
  const mapContainer = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const centerMarkerRef = useRef(null)
  const activeObsRef = useRef(null)

  // ─── Initialize map ──────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current) return

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: coords ? [coords.lng, coords.lat] : [0, 0],
      zoom: coords ? 11 : 2,
    })

    map.addControl(new mapboxgl.NavigationControl(), 'top-left')
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Draw radius circle ──────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !coords || !radiusKm) return

    const draw = () => {
      const geojson = createCircleGeoJSON(coords, radiusKm)

      if (map.getSource('radius-circle')) {
        map.getSource('radius-circle').setData(geojson)
      } else {
        map.addSource('radius-circle', { type: 'geojson', data: geojson })
        map.addLayer({
          id: 'radius-fill',
          type: 'fill',
          source: 'radius-circle',
          paint: { 'fill-color': '#3d5a3e', 'fill-opacity': 0.08 },
        })
        map.addLayer({
          id: 'radius-stroke',
          type: 'line',
          source: 'radius-circle',
          paint: { 'line-color': '#3d5a3e', 'line-width': 1.5, 'line-dasharray': [4, 3], 'line-opacity': 0.5 },
        })
      }

      // Place crosshair at search center
      if (centerMarkerRef.current) centerMarkerRef.current.remove()
      const crosshair = document.createElement('div')
      crosshair.className = styles.crosshair
      crosshair.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3d5a3e" stroke-width="1.5" stroke-linecap="round">
        <circle cx="12" cy="12" r="4" opacity="0.4"/>
        <line x1="12" y1="2" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="22"/>
        <line x1="2" y1="12" x2="8" y2="12"/><line x1="16" y1="12" x2="22" y2="12"/>
      </svg>`
      centerMarkerRef.current = new mapboxgl.Marker({ element: crosshair, anchor: 'center' })
        .setLngLat([coords.lng, coords.lat])
        .addTo(map)

      // Fit map to the radius circle so the search area is always framed
      const circleCoords = geojson.geometry.coordinates[0]
      const circleBounds = new mapboxgl.LngLatBounds()
      circleCoords.forEach(c => circleBounds.extend(c))
      map.fitBounds(circleBounds, { padding: 40 })
    }

    if (map.isStyleLoaded()) {
      draw()
    } else {
      map.once('load', draw)
    }
  }, [coords, radiusKm])

  // ─── Plot markers when observations change ───────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clear old markers
    markersRef.current.forEach(m => m.marker.remove())
    markersRef.current = []

    observations.forEach(obs => {
      const lng = obs.geojson?.coordinates?.[0]
      const lat = obs.geojson?.coordinates?.[1]
      if (lng == null || lat == null) return

      const iconicTaxon = obs.taxon?.iconic_taxon_name || 'default'
      const { color } = getTaxonMeta(iconicTaxon)

      const el = document.createElement('div')
      el.className = styles.marker
      el.style.backgroundColor = color

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map)

      el.addEventListener('click', () => {
        setActiveObs(obs.id)
        onSelect(obs)
      })

      markersRef.current.push({ id: obs.id, marker, el })
    })
  }, [observations, coords, onSelect]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Highlight active marker ─────────────────────────────────
  const setActiveObs = useCallback((id) => {
    // Remove previous active
    markersRef.current.forEach(m => {
      m.el.classList.remove(styles.markerActive)
    })
    // Set new active
    const entry = markersRef.current.find(m => m.id === id)
    if (entry) {
      entry.el.classList.add(styles.markerActive)
      const lngLat = entry.marker.getLngLat()
      mapRef.current?.flyTo({ center: lngLat, speed: 1.2 })
    }
    activeObsRef.current = id
  }, [])

  // ─── Handle list row click ───────────────────────────────────
  const handleRowClick = useCallback((obs) => {
    setActiveObs(obs.id)
    onSelect(obs)
  }, [setActiveObs, onSelect])

  return (
    <div className={styles.container}>
      {/* Map panel */}
      <div className={styles.mapPanel}>
        <div ref={mapContainer} className={styles.map} />
      </div>

      {/* Species list panel */}
      <div className={styles.listPanel}>
        <div className={styles.listHeader}>
          Species list — {observations.length} observation{observations.length !== 1 ? 's' : ''}
        </div>
        {observations.map(obs => {
          const taxon      = obs.taxon
          const common     = taxon?.preferred_common_name || taxon?.name || 'Unnamed species'
          const scientific = taxon?.name || ''
          const iconicTaxon = taxon?.iconic_taxon_name || 'default'
          const { color, emoji } = getTaxonMeta(iconicTaxon)
          const photo      = obs.photos?.[0]?.url?.replace('square', 'small')
          const hasCoords  = obs.geojson?.coordinates != null

          return (
            <div
              key={obs.id}
              className={`${styles.row} ${activeObsRef.current === obs.id ? styles.rowActive : ''}`}
              onClick={() => handleRowClick(obs)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && handleRowClick(obs)}
              style={{ opacity: hasCoords ? 1 : 0.5 }}
            >
              {photo
                ? <img className={styles.thumb} src={photo} alt={scientific} loading="lazy"
                    onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }} />
                : null}
              <div className={styles.thumbPlaceholder} style={{ display: photo ? 'none' : 'flex' }}>{emoji}</div>

              <div className={styles.names}>
                <div className={`${styles.common} ${!taxon?.preferred_common_name ? styles.unnamed : ''}`}>{common}</div>
                <div className={styles.scientific}>{scientific}</div>
              </div>

              <span className={styles.badge} style={{ background: color }}>{iconicTaxon}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
