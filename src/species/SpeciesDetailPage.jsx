import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import { useSEO } from '../hooks/useSEO.js'
import {
  fetchTaxonDetail,
  fetchSeasonality,
  fetchRecentObservations,
  fetchWikipediaExtract,
  fetchGBIFPoints,
  getPreloadedBundle,
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
  const taxonId = parseInt(rawId, 10)

  const [taxon, setTaxon] = useState(null)
  const [seasonality, setSeasonality] = useState(null)
  const [recentObs, setRecentObs] = useState(null)
  const [wiki, setWiki] = useState(null)
  const [gbifPoints, setGbifPoints] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lightboxIdx, setLightboxIdx] = useState(null)
  const [hoverMonth, setHoverMonth] = useState(null)

  const mapRef = useRef(null)
  const mapContainerRef = useRef(null)

  // ─── Load data: preloaded bundle first, then live API fallback ────────
  useEffect(() => {
    if (!taxonId || isNaN(taxonId)) { setError('Invalid species ID'); setLoading(false); return }

    let cancelled = false
    setLoading(true)
    setError(null)
    setTaxon(null)
    setSeasonality(null)
    setRecentObs(null)
    setWiki(null)
    setGbifPoints(null)

    ;(async () => {
      // Try preloaded build-time data first
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

      // Fall back to live API
      const t = await fetchTaxonDetail(taxonId)
      if (cancelled) return
      if (!t) throw new Error('Species not found')

      setTaxon(t)
      setLoading(false)

      // Fire secondary fetches in parallel
      fetchSeasonality(taxonId).then(d => { if (!cancelled) setSeasonality(d) }).catch(() => {})
      fetchRecentObservations(taxonId).then(d => { if (!cancelled) setRecentObs(d) }).catch(() => {})
      fetchWikipediaExtract(t.wikipedia_url).then(d => { if (!cancelled) setWiki(d) }).catch(() => {})
      fetchGBIFPoints(t.name).then(d => { if (!cancelled) setGbifPoints(d) }).catch(() => {})
    })().catch(err => {
      if (!cancelled) {
        setError(err.message || 'Failed to load species data')
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [taxonId])

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

  // ─── Map ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!gbifPoints?.length || !mapContainerRef.current || mapRef.current) return
    if (!MAPBOX_TOKEN) return

    mapboxgl.accessToken = MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [0, 20],
      zoom: 1.3,
      attributionControl: false,
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')

    map.on('load', () => {
      const geojson = {
        type: 'FeatureCollection',
        features: gbifPoints.map(p => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties: { date: p.date },
        })),
      }
      map.addSource('occurrences', { type: 'geojson', data: geojson })
      map.addLayer({
        id: 'occ-dots',
        type: 'circle',
        source: 'occurrences',
        paint: {
          'circle-radius': 4,
          'circle-color': '#3d5a3e',
          'circle-opacity': 0.7,
          'circle-stroke-width': 0.5,
          'circle-stroke-color': '#fff',
        },
      })

      // Fit bounds to points
      if (gbifPoints.length > 1) {
        const bounds = new mapboxgl.LngLatBounds()
        gbifPoints.forEach(p => bounds.extend([p.lng, p.lat]))
        map.fitBounds(bounds, { padding: 60, maxZoom: 8 })
      } else {
        map.setCenter([gbifPoints[0].lng, gbifPoints[0].lat])
        map.setZoom(5)
      }
    })

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [gbifPoints])

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

        {/* ─── Wikipedia ─── */}
        {wiki?.extract_html && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>About {commonName || sciName}</h2>
            <div className={styles.wikiBlock}>
              <div dangerouslySetInnerHTML={{ __html: wiki.extract_html }} />
              {taxon.wikipedia_url && (
                <a className={styles.wikiMore} href={taxon.wikipedia_url} target="_blank" rel="noopener noreferrer">
                  Read full article on Wikipedia →
                </a>
              )}
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

        {/* ─── Global Map ─── */}
        {MAPBOX_TOKEN && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Global Distribution</h2>
            {gbifPoints === null ? (
              <div className={styles.shimmer} style={{ height: 440, borderRadius: 12 }} />
            ) : gbifPoints.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 14 }}>No occurrence data available from GBIF.</div>
            ) : (
              <div ref={mapContainerRef} className={styles.mapWrap} />
            )}
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
