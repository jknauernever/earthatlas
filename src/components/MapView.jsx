import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
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

export default function MapView({ observations, onSelect, coords, radiusKm, dataSource }) {
  const mapContainer = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])  // each entry: { id, taxonKey, marker, el }
  const centerMarkerRef = useRef(null)
  const [activeSpeciesKey, setActiveSpeciesKey] = useState(null)

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

  // ─── GBIF heatmap density tiles ─────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const cleanup = () => {
      try {
        if (map.getLayer('gbif-density-heat')) map.removeLayer('gbif-density-heat')
        if (map.getSource('gbif-density')) map.removeSource('gbif-density')
      } catch { /* map may already be removed */ }
    }

    // Try to add source + layer directly; returns true on success
    const tryAdd = () => {
      if (dataSource !== 'GBIF') { cleanup(); return true }
      if (map.getSource('gbif-density')) return true // already present
      try {
        map.addSource('gbif-density', {
          type: 'vector',
          tiles: [
            'https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}.mvt'
          ],
          maxzoom: 14,
          attribution: 'GBIF.org',
        })
        const beforeLayer = map.getLayer('radius-fill') ? 'radius-fill' : undefined
        map.addLayer({
          id: 'gbif-density-heat',
          type: 'heatmap',
          source: 'gbif-density',
          'source-layer': 'occurrence',
          paint: {
            // Weight: only very high counts push toward 1
            'heatmap-weight': [
              'interpolate', ['linear'], ['get', 'total'],
              1, 0.02,
              500, 0.15,
              5000, 0.4,
              100000, 1,
            ],
            // Tight radius so blobs don't merge into a wall
            'heatmap-radius': [
              'interpolate', ['linear'], ['zoom'],
              2, 3,
              5, 5,
              8, 8,
              12, 12,
            ],
            // Low intensity — let the data speak
            'heatmap-intensity': [
              'interpolate', ['linear'], ['zoom'],
              2, 0.15,
              6, 0.25,
              10, 0.4,
              14, 0.5,
            ],
            // Transparent → light blue → deep blue
            'heatmap-color': [
              'interpolate', ['linear'], ['heatmap-density'],
              0,    'rgba(0,0,0,0)',
              0.1,  'rgba(170,210,240,0.25)',
              0.3,  'rgba(100,165,220,0.4)',
              0.5,  'rgba(80,100,190,0.55)',
              0.7,  'rgba(70,40,150,0.7)',
              1,    'rgba(45,10,100,0.85)',
            ],
            'heatmap-opacity': 0.8,
          },
        }, beforeLayer)
        return true
      } catch {
        return false
      }
    }

    // Attempt immediately — if style isn't ready, the addSource will throw and we retry
    if (tryAdd()) return () => cleanup()

    // Style not ready — retry on load event + poll as safety net
    const onLoad = () => { if (tryAdd()) clearInterval(poll) }
    map.once('load', onLoad)
    const poll = setInterval(() => {
      if (tryAdd()) { map.off('load', onLoad); clearInterval(poll) }
    }, 300)

    return () => {
      cleanup()
      map.off('load', onLoad)
      clearInterval(poll)
    }
  }, [dataSource])

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
      const taxonKey = obs.taxon?.id || obs.taxon?.name || null

      const el = document.createElement('div')
      el.className = styles.marker
      el.style.backgroundColor = color

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map)

      el.addEventListener('click', () => onSelect(obs))

      markersRef.current.push({ id: obs.id, taxonKey, marker, el, color })
    })
  }, [observations, coords, onSelect]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Highlight markers for active species ──────────────────────
  useEffect(() => {
    markersRef.current.forEach(m => {
      if (!activeSpeciesKey) {
        // No species selected — reset all markers
        m.el.classList.remove(styles.markerActive)
        m.el.style.opacity = '1'
      } else if (String(m.taxonKey) === String(activeSpeciesKey)) {
        m.el.classList.add(styles.markerActive)
        m.el.style.opacity = '1'
      } else {
        m.el.classList.remove(styles.markerActive)
        m.el.style.opacity = '0.2'
      }
    })

    // Fit map to matching markers
    if (activeSpeciesKey && mapRef.current) {
      const matching = markersRef.current.filter(m => String(m.taxonKey) === String(activeSpeciesKey))
      if (matching.length > 1) {
        const bounds = new mapboxgl.LngLatBounds()
        matching.forEach(m => bounds.extend(m.marker.getLngLat()))
        mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 600 })
      } else if (matching.length === 1) {
        mapRef.current.flyTo({ center: matching[0].marker.getLngLat(), speed: 1.2 })
      }
    }
  }, [activeSpeciesKey])

  // ─── Handle species row click ──────────────────────────────────
  const handleSpeciesClick = useCallback((taxonKey) => {
    setActiveSpeciesKey(prev => String(prev) === String(taxonKey) ? null : taxonKey)
  }, [])

  const species = useMemo(() => {
    const map = {}
    for (const obs of observations) {
      const taxon = obs.taxon
      const key = taxon?.id || taxon?.name || obs.id
      if (!map[key]) {
        map[key] = { taxon, count: 0, bestPhoto: null, firstObs: obs }
      }
      map[key].count++
      if (!map[key].bestPhoto) {
        const photo = obs.photos?.[0]?.url?.replace('square', 'small')
        if (photo) map[key].bestPhoto = photo
      }
    }
    return Object.values(map).sort((a, b) => b.count - a.count)
  }, [observations])

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
        {species.map(sp => {
          const taxon      = sp.taxon
          const taxonKey   = taxon?.id || taxon?.name
          const common     = taxon?.preferred_common_name || taxon?.name || 'Unnamed species'
          const scientific = taxon?.name || ''
          const iconicTaxon = taxon?.iconic_taxon_name || 'default'
          const { emoji } = getTaxonMeta(iconicTaxon)
          const photo      = sp.bestPhoto
          const isActive   = String(activeSpeciesKey) === String(taxonKey)

          return (
            <div
              key={taxonKey || scientific}
              className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
              onClick={() => handleSpeciesClick(taxonKey)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && handleRowClick(sp.firstObs)}
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

              <span className={styles.count}>{sp.count}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
