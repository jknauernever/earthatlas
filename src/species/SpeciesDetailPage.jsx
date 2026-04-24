import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import { useSEO } from '../hooks/useSEO.js'
import { useQueryParams } from '../hooks/useQueryParams.js'

const SPECIES_QP_SCHEMA = {
  mode: { type: 'string', default: 'heatmap' }, // 'recent' | 'heatmap'
  d1:   { type: 'string' },                     // YYYY-MM-DD, recent-mode start
  d2:   { type: 'string' },                     // YYYY-MM-DD, recent-mode end
}
import {
  fetchTaxonDetail,
  fetchSeasonality,
  fetchRecentObservations,
  fetchWikipediaExtract,
  fetchGBIFPoints,
  fetchINatMapPoints,
  resolveGBIFTaxonKey,
  getPreloadedBundle,
  resolveGBIFToINat,
  resolveInatId,
} from './speciesService.js'
import styles from './SpeciesDetailPage.module.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

const IUCN_LABEL = {
  CR: 'Critically Endangered', EN: 'Endangered', VU: 'Vulnerable',
  NT: 'Near Threatened', LC: 'Least Concern', NE: 'Not Evaluated',
  DD: 'Data Deficient',
}
const IUCN_COLOR = {
  CR: '#e74c3c', EN: '#e67e22', VU: '#f39c12', NT: '#27ae60', LC: '#2ecc71',
  NE: '#999', DD: '#999',
}
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December']

function toSlug(name) {
  return name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || ''
}

export default function SpeciesDetailPage() {
  const { taxonId: rawId } = useParams()
  // Support formats: "12345", "12345-species-slug", or "scientific-name"
  const numericMatch = rawId.match(/^(\d+)/)
  const isNumeric = !!numericMatch
  const taxonId = isNumeric ? parseInt(numericMatch[1], 10) : null
  const scientificName = isNumeric ? null : decodeURIComponent(rawId)

  const [taxon, setTaxon] = useState(null)
  const [seasonality, setSeasonality] = useState(null)
  const [recentObs, setRecentObs] = useState(null)
  const [wiki, setWiki] = useState(null)
  const [gbifPoints, setGbifPoints] = useState(null)
  const [gbifTaxonKey, setGbifTaxonKey] = useState(null)
  const [inatTaxonId, setInatTaxonId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lightboxIdx, setLightboxIdx] = useState(null)
  const [hoverMonth, setHoverMonth] = useState(null)
  // Map mode + recent-mode date range live in the URL so specific filter
  // views (e.g. "Red Fox, recent mode, last 7 days") can be shared as a link.
  const [qp, setQP] = useQueryParams(SPECIES_QP_SCHEMA)
  const mapMode = qp.mode
  const setMapMode = useCallback((m) => setQP({ mode: m }), [setQP])
  const mapDateRange = useMemo(() => {
    if (qp.d1 && qp.d2) return { start: qp.d1, end: qp.d2 }
    const today = new Date().toISOString().split('T')[0]
    const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
    return { start: thirtyAgo, end: today }
  }, [qp.d1, qp.d2])
  const setMapDateRange = useCallback((r) => setQP({ d1: r?.start || null, d2: r?.end || null }), [setQP])
  const [mapZoom, setMapZoom] = useState(1.2)
  const [selectedObs, setSelectedObs] = useState(null)

  const mapRef = useRef(null)
  const mapContainerRef = useRef(null)

  // ─── Load data: preloaded bundle first, then live API fallback ────────
  useEffect(() => {
    if (!taxonId && !scientificName) { setError('Invalid species ID'); setLoading(false); return }

    let cancelled = false
    setLoading(true)
    setError(null)
    setTaxon(null)
    setSeasonality(null)
    setRecentObs(null)
    setWiki(null)
    setGbifPoints(null)

    ;(async () => {
      // Try preloaded build-time data first (only for numeric IDs)
      if (taxonId) {
        const preloaded = await getPreloadedBundle(taxonId)
        if (cancelled) return

        if (preloaded) {
          setTaxon(preloaded.taxon)
          setSeasonality(preloaded.seasonality)
          setRecentObs(preloaded.recentObs)
          setWiki(preloaded.wiki)
          setGbifPoints(preloaded.gbifPoints)
          setLoading(false)
          return
        }
      }

      // Resolve the effective iNat taxon ID
      let resolvedId = null

      if (scientificName) {
        // URL param is a scientific name — resolve via iNat search
        resolvedId = await resolveInatId(scientificName)
        if (cancelled) return
      } else {
        // Numeric ID — try as iNat ID first, then as GBIF key
        let t = await fetchTaxonDetail(taxonId).catch(() => null)
        if (cancelled) return

        if (t) {
          resolvedId = taxonId
        } else {
          // Might be a GBIF species key — resolve to iNat
          resolvedId = await resolveGBIFToINat(taxonId)
          if (cancelled) return
        }
      }

      if (!resolvedId) throw new Error('Species not found')

      const t = await fetchTaxonDetail(resolvedId)
      if (cancelled) return
      if (!t) throw new Error('Species not found')

      setTaxon(t)
      setInatTaxonId(resolvedId)
      setLoading(false)

      // Fire secondary fetches in parallel
      fetchSeasonality(resolvedId).then(d => { if (!cancelled) setSeasonality(d) }).catch(() => {})
      fetchRecentObservations(resolvedId).then(d => { if (!cancelled) setRecentObs(d) }).catch(() => {})
      fetchWikipediaExtract(t.wikipedia_url).then(d => { if (!cancelled) setWiki(d) }).catch(() => {})
      // Fetch from both GBIF and iNaturalist, merge into one set of map points
      Promise.all([
        fetchGBIFPoints(t.name).catch(() => []),
        fetchINatMapPoints(resolvedId).catch(() => []),
      ]).then(([gbif, inat]) => {
        if (!cancelled) setGbifPoints([...gbif, ...inat])
      })
      resolveGBIFTaxonKey(t.name).then(k => { if (!cancelled) setGbifTaxonKey(k) }).catch(() => {})
    })().catch(err => {
      if (!cancelled) {
        setError(err.message || 'Failed to load species data')
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [taxonId, scientificName])

  // ─── SEO ─────────────────────────────────────────────────────────────
  const commonName = taxon?.preferred_common_name || taxon?.name || ''
  const sciName = taxon?.name || ''
  const slug = `${taxonId}-${toSlug(sciName)}`

  useSEO({
    title: commonName ? `${commonName} (${sciName})` : sciName,
    description: taxon?.wikipedia_summary
      ? taxon.wikipedia_summary.slice(0, 160)
      : `Explore ${commonName || sciName} — photos, sightings, seasonality, and distribution on EarthAtlas.`,
    path: `/species/${slug}`,
    image: taxon?.default_photo?.medium_url || null,
  })

  // ─── IUCN status ────────────────────────────────────────────────────
  const iucn = taxon?.conservation_statuses?.find(s => s.authority === 'IUCN Red List')
  const iucnCode = iucn?.iucn || iucn?.status || null
  const iucnLabel = IUCN_LABEL[iucnCode]
  const iucnColor = IUCN_COLOR[iucnCode]

  // ─── Photos ──────────────────────────────────────────────────────────
  const photos = (taxon?.taxon_photos || []).slice(0, 12).map(tp => ({
    url: tp.photo?.medium_url || tp.photo?.url,
    large: tp.photo?.original_url || tp.photo?.large_url || tp.photo?.medium_url || tp.photo?.url,
    attribution: tp.photo?.attribution || '',
  })).filter(p => p.url)

  // ─── Find densest cluster center ────────────────────────────────────
  const findDenseCenter = useCallback((pts) => {
    if (!pts?.length) return null
    // Grid points into 10° cells, find the cell with most points
    const grid = {}
    for (const p of pts) {
      const key = `${Math.round(p.lat / 10) * 10},${Math.round(p.lng / 10) * 10}`
      if (!grid[key]) grid[key] = { count: 0, sumLat: 0, sumLng: 0 }
      grid[key].count++
      grid[key].sumLat += p.lat
      grid[key].sumLng += p.lng
    }
    let best = null
    for (const cell of Object.values(grid)) {
      if (!best || cell.count > best.count) best = cell
    }
    return best ? [best.sumLng / best.count, best.sumLat / best.count] : null
  }, [])

  // ─── Build GeoJSON from points (filtered to date range within last 30 days)
  const buildGeoJSON = useCallback((pts, range) => {
    const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
    const today = new Date().toISOString().split('T')[0]
    const lo = range.start && range.start > thirtyAgo ? range.start : thirtyAgo
    const hi = range.end && range.end < today ? range.end : today

    const filtered = pts.filter(p => p.date && p.date >= lo && p.date <= hi)
    filtered.sort((a, b) => (a.date || '') < (b.date || '') ? -1 : 1)

    const rangeMs = Math.max(new Date(hi + 'T12:00:00') - new Date(lo + 'T12:00:00'), 1)

    return {
      type: 'FeatureCollection',
      features: filtered.map(p => {
        const elapsed = (new Date(p.date + 'T12:00:00') - new Date(lo + 'T12:00:00')) / rangeMs
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties: {
            date: p.date,
            recency: Math.max(0, Math.min(1, elapsed)),
            place: p.place || '',
            observer: p.observer || '',
            source: p.source || 'GBIF',
            sourceId: p.sourceId || '',
            photo: p.photo || '',
          },
        }
      }),
    }
  }, [])

  // ─── Map: create/destroy on mode, style, or data changes ──────────
  useEffect(() => {
    if (!mapContainerRef.current) return
    if (!MAPBOX_TOKEN) return
    if (!gbifPoints?.length) return

    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }

    mapboxgl.accessToken = MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/outdoors-v12',
      center: [0, 20],
      zoom: 1.2,
      attributionControl: false,
      logoPosition: 'bottom-right',
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right')
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')
    map.on('zoom', () => setMapZoom(map.getZoom()))

    map.on('load', () => {
      // Match space color to page background so globe floats on parchment, not black
      try {
        map.setFog({
          color: '#f5f0e8',
          'high-color': '#f5f0e8',
          'space-color': '#f5f0e8',
          'horizon-blend': 0.02,
          'star-intensity': 0,
        })
      } catch (e) { console.warn('setFog failed:', e) }

      if (mapMode === 'heatmap') {
        const allPoints = {
          type: 'FeatureCollection',
          features: gbifPoints.map(p => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
            properties: {},
          })),
        }
        map.addSource('heat-points', { type: 'geojson', data: allPoints })
        map.addLayer({
          id: 'heat-layer',
          type: 'heatmap',
          source: 'heat-points',
          paint: {
            'heatmap-radius': [
              'interpolate', ['linear'], ['zoom'],
              0, 4,
              2, 8,
              4, 16,
              6, 24,
              9, 32,
            ],
            'heatmap-intensity': [
              'interpolate', ['linear'], ['zoom'],
              0, 0.4,
              2, 0.6,
              4, 1,
              8, 1.5,
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
              0, 0.6,
              12, 0.6,
            ],
          },
        })
      } else {
        // Show all data initially (date range filter applied by update effect)
        const geojson = buildGeoJSON(gbifPoints, mapDateRange)

        map.addSource('occurrences', { type: 'geojson', data: geojson })
        map.addLayer({
          id: 'occ-dots',
          type: 'circle',
          source: 'occurrences',
          layout: {
            'circle-sort-key': ['get', 'recency'],
          },
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 6, 3, 7, 5, 8, 10, 10],
            'circle-color': '#e67e22',
            'circle-opacity': ['interpolate', ['linear'], ['get', 'recency'], 0, 0.25, 1, 0.95],
            'circle-stroke-width': 1,
            'circle-stroke-color': 'rgba(255,255,255,0.8)',
          },
        })

        // Click handler for observation dots
        map.on('click', 'occ-dots', (e) => {
          const f = e.features?.[0]
          if (!f) return
          const p = f.properties
          const [lng, lat] = f.geometry.coordinates
          setSelectedObs({
            lat, lng,
            date: p.date || null,
            place: p.place || null,
            observer: p.observer || null,
            source: p.source || 'GBIF',
            sourceId: p.sourceId || null,
            photo: p.photo || null,
          })
          map.easeTo({ center: [lng, lat], duration: 400 })
        })
        // Clicking on empty space clears selection
        map.on('click', (e) => {
          const features = map.queryRenderedFeatures(e.point, { layers: ['occ-dots'] })
          if (!features.length) setSelectedObs(null)
        })
        map.on('mouseenter', 'occ-dots', () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', 'occ-dots', () => { map.getCanvas().style.cursor = '' })
      }

      // Spin the globe to the densest observation area
      // For recent mode, use only 30-day points so the globe faces the recent data
      if (mapMode === 'recent') {
        const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
        const recentPts = gbifPoints.filter(p => p.date && p.date >= thirtyAgo)
        const center = findDenseCenter(recentPts.length ? recentPts : gbifPoints)
        if (center) map.flyTo({ center, zoom: 1.5, duration: 2000, essential: true })
      } else {
        const center = findDenseCenter(gbifPoints)
        if (center) map.flyTo({ center, zoom: 1.5, duration: 2000, essential: true })
      }
    })

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [gbifPoints, gbifTaxonKey, inatTaxonId, mapMode, buildGeoJSON, findDenseCenter])

  // ─── Update dots when date range slider changes (no map recreation) ─
  useEffect(() => {
    const map = mapRef.current
    if (!map || mapMode !== 'recent' || !gbifPoints?.length) return
    const update = () => {
      const src = map.getSource('occurrences')
      if (src) src.setData(buildGeoJSON(gbifPoints, mapDateRange))
    }
    if (map.isStyleLoaded()) update()
    else map.once('load', update)
  }, [mapDateRange, gbifPoints, mapMode, buildGeoJSON])

  // ─── Lightbox keyboard nav ──────────────────────────────────────────
  useEffect(() => {
    if (lightboxIdx === null) return
    function onKey(e) {
      if (e.key === 'Escape') setLightboxIdx(null)
      if (e.key === 'ArrowRight') setLightboxIdx(i => (i + 1) % photos.length)
      if (e.key === 'ArrowLeft') setLightboxIdx(i => (i - 1 + photos.length) % photos.length)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lightboxIdx, photos.length])

  // ─── Loading state ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={styles.page}>
        <Header />
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <div className={styles.loadingText}>Loading species data...</div>
        </div>
      </div>
    )
  }

  if (error || !taxon) {
    return (
      <div className={styles.page}>
        <Header />
        <div className={styles.error}>
          <p>{error || 'Species not found'}</p>
          <Link to="/" style={{ color: 'var(--moss)', marginTop: 16, display: 'inline-block' }}>
            Back to EarthAtlas
          </Link>
        </div>
      </div>
    )
  }

  // ─── Seasonality helpers ────────────────────────────────────────────
  const maxSeason = seasonality ? Math.max(...seasonality, 1) : 1
  const totalSeason = seasonality ? seasonality.reduce((a, b) => a + b, 0) : 0

  const heroPhoto = taxon.default_photo?.original_url || taxon.default_photo?.large_url || taxon.default_photo?.medium_url

  return (
    <div className={styles.page}>
      <Header />

      {/* ─── Hero ─── */}
      <div className={styles.hero}>
        {heroPhoto && <img className={styles.heroImg} src={heroPhoto} alt={commonName} />}
        <div className={styles.heroOverlay}>
          <div className={styles.heroScrim}>
            <div className={styles.heroCommon}>{commonName}</div>
            <div className={styles.heroScientific}>{sciName}</div>
            <div className={styles.heroMeta}>
              {iucnLabel && (
                <span className={styles.iucnBadge} style={{ background: iucnColor }}>
                  {iucnCode} — {iucnLabel}
                </span>
              )}
              {taxon.observations_count > 0 && (
                <span className={styles.heroStat}>
                  <strong>{taxon.observations_count.toLocaleString()}</strong> observations on iNaturalist
                </span>
              )}
            </div>
            {wiki?.extract && (
              <div className={styles.heroWiki}>
                <p>{wiki.extract.length > 300 ? wiki.extract.slice(0, 300).replace(/\s+\S*$/, '') + '…' : wiki.extract}</p>
                {taxon.wikipedia_url && (
                  <a className={styles.heroWikiMore} href={taxon.wikipedia_url} target="_blank" rel="noopener noreferrer">
                    Read more on Wikipedia →
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.content}>
        {/* ─── Taxonomy ─── */}
        {taxon.ancestors?.length > 0 && (
          <div className={styles.taxonomy}>
            {taxon.ancestors
              .filter(a => ['kingdom','phylum','class','order','family','genus'].includes(a.rank))
              .map((a, i, arr) => (
                <span key={a.id}>
                  <Link className={styles.taxonLink} to={`/species/${a.id}-${toSlug(a.name)}`}>
                    {a.preferred_common_name || a.name}
                  </Link>
                  {i < arr.length - 1 && <span className={styles.taxonSep}> › </span>}
                </span>
              ))}
            <span className={styles.taxonSep}> › </span>
            <span className={styles.taxonCurrent}>{commonName || sciName}</span>
          </div>
        )}

        {/* ─── Global Map ─── */}
        {MAPBOX_TOKEN && (
          <div className={styles.section}>
            <div className={styles.mapHeader}>
              <h2 className={styles.sectionTitle}>Global Distribution</h2>
              <div className={styles.mapToggle}>
                <button
                  className={`${styles.mapToggleBtn} ${mapMode === 'recent' ? styles.mapToggleBtnActive : ''}`}
                  onClick={() => setMapMode('recent')}
                >
                  Recent
                </button>
                <button
                  className={`${styles.mapToggleBtn} ${mapMode === 'heatmap' ? styles.mapToggleBtnActive : ''}`}
                  onClick={() => { setMapMode('heatmap'); setSelectedObs(null) }}
                >
                  All-time heatmap
                </button>
              </div>
            </div>
            {gbifPoints === null ? (
              <div className={styles.shimmer} style={{ height: 440, borderRadius: 12 }} />
            ) : gbifPoints.length === 0 ? (
              <div className={styles.noRecentObs}>
                <div className={styles.noRecentObsTitle}>No observation data available</div>
                <div className={styles.noRecentObsText}>
                  We don't have any occurrence records for this species yet.
                </div>
              </div>
            ) : mapMode === 'recent' && !gbifPoints.some(p => {
              const thirtyAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
              return p.date && p.date >= thirtyAgo
            }) ? (
              <div className={styles.noRecentObs}>
                <div className={styles.noRecentObsTitle}>No observations in the last 30 days</div>
                <div className={styles.noRecentObsText}>
                  This species hasn't been recorded recently. View the all-time heatmap to see where it's been observed historically.
                </div>
                <button
                  className={styles.noRecentObsBtn}
                  onClick={() => setMapMode('heatmap')}
                >
                  View all-time heatmap
                </button>
              </div>
            ) : (
              <div className={styles.mapLayout}>
                <div className={styles.mapContainer}>
                  <div className={styles.mapWrapOuter}>
                    <div ref={mapContainerRef} className={styles.mapWrap} />
                    <div className={styles.mapZoom}>z{mapZoom.toFixed(1)}</div>
                  </div>
                  {mapMode === 'recent' && (
                    <MapTimeSlider value={mapDateRange} onChange={setMapDateRange} />
                  )}
                </div>
                {mapMode === 'recent' && <div className={styles.mapSidebar}>
                  {selectedObs ? (
                    <div className={styles.obsCard}>
                      {selectedObs.photo && (
                        <img
                          className={styles.obsCardPhoto}
                          src={selectedObs.photo}
                          alt="Observation"
                          onError={e => { e.target.style.display = 'none' }}
                        />
                      )}
                      <div className={styles.obsCardBody}>
                        <div className={styles.obsCardTitle}>{commonName || sciName}</div>
                        {selectedObs.date && (
                          <div className={styles.obsCardRow}>
                            <span className={styles.obsCardIcon}>{'\u{1F4C5}'}</span>
                            {new Date(selectedObs.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                          </div>
                        )}
                        {selectedObs.place && (
                          <div className={styles.obsCardRow}>
                            <span className={styles.obsCardIcon}>{'\u{1F4CD}'}</span>
                            {selectedObs.place}
                          </div>
                        )}
                        {selectedObs.observer && (
                          <div className={styles.obsCardRow}>
                            <span className={styles.obsCardIcon}>{'\u{1F464}'}</span>
                            {selectedObs.observer}
                          </div>
                        )}
                        <div className={styles.obsCardCoords}>
                          {selectedObs.lat.toFixed(4)}, {selectedObs.lng.toFixed(4)}
                        </div>
                        <div className={styles.obsCardActions}>
                          {selectedObs.sourceId && (
                            <a
                              className={styles.obsCardLink}
                              href={selectedObs.source === 'iNaturalist'
                                ? `https://www.inaturalist.org/observations/${selectedObs.sourceId}`
                                : `https://www.gbif.org/occurrence/${selectedObs.sourceId}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              View on {selectedObs.source} {'\u2197'}
                            </a>
                          )}
                        </div>
                        <div className={styles.obsCardSource}>via {selectedObs.source}</div>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.obsCardEmpty}>
                      Click an observation on the map to see details
                    </div>
                  )}
                </div>}
              </div>
            )}
          </div>
        )}

        {/* ─── Photo Gallery ─── */}
        {photos.length > 0 && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Photos</h2>
            <div className={styles.gallery}>
              {photos.map((p, i) => (
                <div key={i} className={styles.galleryItem} onClick={() => setLightboxIdx(i)}>
                  <img src={p.url} alt={`${commonName} photo ${i + 1}`} loading="lazy" />
                  {p.attribution && <div className={styles.galleryAttribution}>{p.attribution}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── Seasonality ─── */}
        {seasonality && totalSeason > 0 && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Seasonality</h2>
            <div className={styles.seasonChart}>
              <div className={styles.seasonBars}>
                {seasonality.map((count, i) => {
                  const h = count > 0 ? Math.max((count / maxSeason) * 100, 4) : 2
                  return (
                    <div
                      key={i}
                      className={`${styles.seasonBar} ${hoverMonth === i ? styles.seasonBarActive : ''}`}
                      style={{ height: `${h}%` }}
                      onMouseEnter={() => setHoverMonth(i)}
                      onMouseLeave={() => setHoverMonth(null)}
                    />
                  )
                })}
              </div>
              <div className={styles.seasonLabels}>
                {MONTHS.map(m => <div key={m} className={styles.seasonLabel}>{m}</div>)}
              </div>
              <div className={styles.seasonDetail}>
                {hoverMonth !== null ? (
                  <>
                    <strong>{MONTHS_FULL[hoverMonth]}</strong>: {seasonality[hoverMonth].toLocaleString()} observations
                    {totalSeason > 0 && <> ({((seasonality[hoverMonth] / totalSeason) * 100).toFixed(0)}% of annual activity)</>}
                  </>
                ) : (
                  <>Hover over a month to see observation counts</>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── Recent Sightings ─── */}
        {recentObs?.length > 0 && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Recent Observations</h2>
            <div className={styles.sightingsGrid}>
              {recentObs.map(obs => {
                const photo = obs.photos?.[0]
                const photoUrl = photo?.url?.replace('square', 'medium') || photo?.medium_url
                return (
                  <a
                    key={obs.id}
                    className={styles.sightingCard}
                    href={`https://www.inaturalist.org/observations/${obs.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {photoUrl && <img className={styles.sightingPhoto} src={photoUrl} alt="" loading="lazy" />}
                    <div className={styles.sightingBody}>
                      <div className={styles.sightingDate}>
                        {obs.observed_on_details?.date || obs.observed_on || 'Unknown date'}
                      </div>
                      <div className={styles.sightingPlace}>{obs.place_guess || 'Unknown location'}</div>
                      <div className={styles.sightingObserver}>by {obs.user?.login || 'anonymous'}</div>
                    </div>
                  </a>
                )
              })}
            </div>
          </div>
        )}

      </div>

      {/* ─── Lightbox ─── */}
      {lightboxIdx !== null && photos[lightboxIdx] && (
        <div className={styles.lightbox} onClick={() => setLightboxIdx(null)}>
          <img
            src={photos[lightboxIdx].large}
            alt={commonName}
            onClick={e => e.stopPropagation()}
          />
          <button className={styles.lightboxClose} onClick={() => setLightboxIdx(null)}>×</button>
          {photos.length > 1 && (
            <>
              <button
                className={`${styles.lightboxNav} ${styles.lightboxPrev}`}
                onClick={e => { e.stopPropagation(); setLightboxIdx(i => (i - 1 + photos.length) % photos.length) }}
              >‹</button>
              <button
                className={`${styles.lightboxNav} ${styles.lightboxNext}`}
                onClick={e => { e.stopPropagation(); setLightboxIdx(i => (i + 1) % photos.length) }}
              >›</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const MS_PER_DAY = 86400000

function MapTimeSlider({ value, onChange }) {
  const today = new Date().toISOString().split('T')[0]
  const thirtyAgo = new Date(Date.now() - 30 * MS_PER_DAY).toISOString().split('T')[0]
  const totalDays = 30

  const dateToDay = (d) => Math.round((new Date(d + 'T12:00:00') - new Date(thirtyAgo + 'T12:00:00')) / MS_PER_DAY)
  const dayToDate = (day) => new Date(new Date(thirtyAgo + 'T12:00:00').getTime() + day * MS_PER_DAY).toISOString().split('T')[0]
  const fmt = (d) => { try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) } catch { return d } }

  const loDay = value.start ? Math.max(0, dateToDay(value.start)) : 0
  const hiDay = value.end ? Math.min(totalDays, dateToDay(value.end)) : totalDays
  const loPct = (loDay / totalDays) * 100
  const hiPct = (hiDay / totalDays) * 100

  return (
    <div className={styles.tsBlock}>
      <div className={styles.tsSlider}>
        <span className={styles.tsLabel}>{fmt(thirtyAgo)}</span>
        <div className={styles.tsMiddle}>
          {loDay > 0 && <div className={styles.tsThumbLabel} style={{ left: `${loPct}%` }}>{fmt(value.start || thirtyAgo)}</div>}
          {hiDay < totalDays && <div className={styles.tsThumbLabel} style={{ left: `${hiPct}%` }}>{fmt(value.end || today)}</div>}
          <div className={styles.tsFill} style={{ left: `${loPct}%`, right: `${100 - hiPct}%` }} />
          <input
            type="range"
            className={`${styles.tsTrack} ${styles.tsTrackLo}`}
            min={0} max={totalDays} value={loDay}
            onChange={e => {
              const day = Math.min(parseInt(e.target.value, 10), hiDay - 1)
              onChange({ ...value, start: day <= 0 ? thirtyAgo : dayToDate(day) })
            }}
          />
          <input
            type="range"
            className={`${styles.tsTrack} ${styles.tsTrackHi}`}
            min={0} max={totalDays} value={hiDay}
            onChange={e => {
              const day = Math.max(parseInt(e.target.value, 10), loDay + 1)
              onChange({ ...value, end: day >= totalDays ? today : dayToDate(day) })
            }}
          />
        </div>
        <span className={styles.tsLabel}>{fmt(today)}</span>
      </div>
    </div>
  )
}

function Header() {
  return (
    <header className={styles.header}>
      <Link to="/" className={styles.logo}>
        Earth<span>Atlas</span>
      </Link>
      <Link to="/" className={styles.backLink}>← Back to EarthAtlas</Link>
    </header>
  )
}
