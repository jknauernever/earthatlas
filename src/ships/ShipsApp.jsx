/**
 * /ships — vessel identity, tracks and ship pollution from open sources.
 * Rules: src/ships/CLAUDE.md.
 *
 * Shell = /inmotion's (Josh, 2026-09-24): globe + atmosphere, the universal
 * "Fly to a place" search top right, icon dock ("I want to see…") ⇄ panel on
 * the left, control column on the right. Ship lookup uses /inmotion's pill
 * construct (MeasurePicker): a top-center "Ships: …" pill whose popover holds
 * the ship search, kind-of-ship chips and results. The picked ship's card
 * hangs under the pill. Once ships have positions (tracks, Phase 2) the card
 * can move to the map like the facility cards.
 *
 * Map conventions (docs/MAP_TOOL_CONVENTIONS.md): shareable URL state,
 * satellite default, ZoomIndicator, mapReady from style.load, globe carve-out.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { ensureWebGLSupport } from '../utils/webglSupport'
import ZoomIndicator from '../components/ZoomIndicator.jsx'
import MapSheet from '../components/MapSheet.jsx'
import MapSearch from '../components/MapSearch.jsx'
import GeoSearch from '../components/GeoSearch.jsx'
import ShareControl from '../components/ShareControl.jsx'
import { flyToSearchResult } from '../lib/eaGeoSearch.js'
import { scheduleViewCard, captureMapImage } from '../lib/shareCard.js'
import { useIsMobile } from '../hooks/useMediaQuery'
import ShipPicker from './ShipPicker.jsx'
import VesselCard, { Ev, currentIdentity } from './VesselCard.jsx'
import styles from './ShipsApp.module.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const DEFAULT_VIEW = { center: [-40, 24], zoom: 1.9 } // same opening globe as /inmotion

const BASEMAPS = [
  { id: 'dark', label: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'light', label: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'streets', label: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
]
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[1]).style

// Dock/panel entries — only what exists. More ship layers (tracks, traffic,
// emissions…) join as their phases land, never as placeholders.
const SHIP_ICON = '<path d="M3 17l2 4h14l2-4-9-3-9 3z"/><path d="M5 15V9h14v6"/><path d="M12 3v6"/><path d="M9 6h6"/>'
const IDENTITY = {
  id: 'identity', name: 'Ship identity', sub: 'names, numbers, flags, owners over time', hue: '#67e8f9', iconSvg: SHIP_ICON,
  sourceName: 'Global Fishing Watch', sourceUrl: 'https://globalfishingwatch.org',
}

// On-state derivations from a hue, as /inmotion: border .6, background .13, icon = hue.
function hueStyle(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return { '--hue': hex, '--hue-border': `rgba(${r},${g},${b},0.6)`, '--hue-bg': `rgba(${r},${g},${b},0.13)` }
}
const Icon = ({ svg, size = 19 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
)

//   v   picked vessel (EarthAtlas uuid)     q  ship search text      k  kinds (comma list)
//   id  '0' = Ship identity layer off       bm basemap               lat,lng,z camera
function readUrlState() {
  if (typeof window === 'undefined') return {}
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => { const v = sp.get(k); const n = v == null || v === '' ? NaN : Number(v); return Number.isFinite(n) ? n : null }
  return {
    v: sp.get('v'), q: sp.get('q'), k: sp.get('k'), id: sp.get('id'), bm: sp.get('bm'),
    lat: num('lat'), lng: num('lng'), z: num('z'),
  }
}
function writeUrlQuery(qs) {
  if (typeof window === 'undefined') return
  const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
  if (url === window.location.pathname + window.location.search + window.location.hash) return
  window.history.replaceState(window.history.state, '', url)
}

export default function ShipsApp() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  const isMobile = useIsMobile()
  const initial = useMemo(() => readUrlState(), [])
  const [basemap, setBasemap] = useState(() => (BASEMAPS.some((b) => b.id === initial.bm) ? initial.bm : 'satellite'))
  const [basemapMenuOpen, setBasemapMenuOpen] = useState(false)
  const basemapMenuRef = useRef(null)
  const [mapView, setMapView] = useState(initial.lat != null && initial.lng != null && initial.z != null ? { lat: initial.lat, lng: initial.lng, zoom: initial.z } : null)
  const captureShareImage = () => (mapRef.current ? captureMapImage(mapRef.current) : Promise.resolve(null))

  // Navigation exactly like /inmotion: desktop dock ⇄ panel; phones pill ⇄ dock ⇄ drawer.
  const [panelOpen, setPanelOpen] = useState(false)
  const [mobileView, setMobileView] = useState('dock')

  const [identityOn, setIdentityOn] = useState(initial.id !== '0')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState(initial.q || '')
  const [kinds, setKinds] = useState(() => (initial.k ? initial.k.split(',').filter(Boolean) : []))
  const [vesselId, setVesselId] = useState(initial.v || null)
  const [vesselName, setVesselName] = useState(null)

  // ─── Map init (once) — globe + atmosphere, as /inmotion ───────────────────
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return
    if (!ensureWebGLSupport(containerRef.current)) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: basemapStyleFor(basemap),
      center: mapView ? [mapView.lng, mapView.lat] : DEFAULT_VIEW.center,
      zoom: mapView ? mapView.zoom : DEFAULT_VIEW.zoom,
      projection: 'globe',
    })
    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('moveend', () => { const c = map.getCenter(); setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }) })
    map.on('style.load', () => {
      map.setFog({ color: 'rgb(10, 14, 23)', 'high-color': 'rgb(20, 30, 60)', 'horizon-blend': 0.08, 'space-color': 'rgb(6, 8, 16)', 'star-intensity': 0.7 })
      setMapReady(true)
    })
    return () => { map.remove(); mapRef.current = null; setMapReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const appliedBasemapRef = useRef(basemap)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || appliedBasemapRef.current === basemap) return
    appliedBasemapRef.current = basemap
    map.setStyle(basemapStyleFor(basemap))
  }, [basemap, mapReady])

  useEffect(() => {
    if (!basemapMenuOpen) return
    const onDoc = (e) => { if (basemapMenuRef.current && !basemapMenuRef.current.contains(e.target)) setBasemapMenuOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [basemapMenuOpen])

  useEffect(() => { document.title = 'Ships — vessel identity over time · EarthAtlas' }, [])

  const handlePlace = useCallback((r) => { flyToSearchResult(mapRef.current, r) }, [])

  // ─── Shareable URL ────────────────────────────────────────────────────────
  useEffect(() => {
    const sp = new URLSearchParams()
    if (!identityOn) sp.set('id', '0')
    if (vesselId) sp.set('v', vesselId)
    if (query.trim()) sp.set('q', query.trim())
    if (kinds.length) sp.set('k', kinds.join(','))
    if (basemap !== 'satellite') sp.set('bm', basemap)
    if (mapView) { sp.set('lat', mapView.lat.toFixed(3)); sp.set('lng', mapView.lng.toFixed(3)); sp.set('z', mapView.zoom.toFixed(1)) }
    writeUrlQuery(sp.toString())
    if (mapReady) scheduleViewCard(captureShareImage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityOn, vesselId, query, kinds, basemap, mapView, mapReady])

  const toggleIdentity = () => {
    const next = !identityOn
    setIdentityOn(next)
    setPickerOpen(next && !vesselId) // turning on with nothing picked → open the search
  }
  const pickShip = (r) => { setVesselName(r.latest?.name?.value || null); setVesselId(r.id); setPickerOpen(false) }

  if (!MAPBOX_TOKEN) return <div className={styles.tokenError}>Missing <code>VITE_MAPBOX_TOKEN</code>.</div>

  const activeCount = identityOn ? 1 : 0
  return (
    <div className={styles.container}>
      <div className={styles.mapWrap} ref={containerRef} />
      {mapReady && <ZoomIndicator map={mapRef.current} />}

      <div className={styles.branding}>
        <a className={styles.brandingLink} href="/" aria-label="EarthAtlas home">
          <span className={styles.wordmark}>Earth<em>Atlas</em></span>
        </a>
        <span className={styles.subBadge}>Ships</span>
      </div>

      {/* Search — the universal place search, as on every EarthAtlas map */}
      <MapSearch className={styles.searchBox}>
        <GeoSearch
          placeholder="Fly to a place on the globe…"
          proximity={() => {
            const m = mapRef.current
            if (!m) return undefined
            try { const c = m.getCenter(); return { lng: c.lng, lat: c.lat } } catch { return undefined }
          }}
          onSelect={handlePlace}
        />
      </MapSearch>

      {/* Ships pill — /inmotion's MeasurePicker construct; the card hangs under it */}
      {identityOn && (
        <ShipPicker shipName={vesselId ? vesselName : null} query={query} onQuery={setQuery} kinds={kinds} onKinds={setKinds}
          onPick={pickShip} open={pickerOpen} onOpen={setPickerOpen}>
          {vesselId && (
            <VesselCard vesselId={vesselId} onClose={() => { setVesselId(null); setVesselName(null) }}
              onSelectVessel={(id) => setVesselId(id)}
              onLoaded={(v) => setVesselName(currentIdentity(v).name?.value_raw || 'Unnamed vessel')} />
          )}
        </ShipPicker>
      )}

      <div className={styles.basemapMenu} ref={basemapMenuRef}>
        <button className={basemapMenuOpen ? styles.basemapToggleActive : styles.basemapToggle}
          onClick={() => setBasemapMenuOpen((o) => !o)} aria-label="Choose basemap" title="Basemap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
          </svg>
        </button>
        {basemapMenuOpen && (
          <div className={styles.basemapMenuPanel}>
            <div className={styles.basemapMenuTitle}>Basemap</div>
            {BASEMAPS.map((b) => (
              <button key={b.id} className={b.id === basemap ? styles.basemapMenuItemActive : styles.basemapMenuItem}
                onClick={() => { setBasemap(b.id); setBasemapMenuOpen(false) }}>
                <span className={styles.basemapMenuItemLabel}>{b.label}</span>
                {b.id === basemap && <span className={styles.basemapMenuCheck}>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {mapReady && <ShareControl capture={captureShareImage} className={styles.shareCtl} />}

      {/* Icon dock — default navigation on every screen size (as /inmotion). */}
      {((!isMobile && !panelOpen) || (isMobile && mobileView === 'dock')) && (
        <div className={`${styles.dock} ${isMobile ? styles.dockMobile : ''}`} role="toolbar" aria-label="Ship data">
          <div className={styles.dockTitle}>I want to see…</div>
          <div className={styles.dockMeta}>
            <span className={styles.countChip}>{activeCount} on</span>
            <div className={styles.dockCtl}>
              {isMobile && <button type="button" className={styles.dockBtnSm} onClick={() => setMobileView('pill')} aria-label="Hide icons">«</button>}
              <button type="button" className={styles.dockBtnSm} onClick={() => { if (isMobile) setMobileView('drawer'); else setPanelOpen(true) }} aria-label="Expand panel">▸</button>
            </div>
          </div>
          <div className={styles.dockGroup}>
            <div className={styles.dockGroupLabel}>SHIPS</div>
            <div className={styles.dockGrid}>
              <button type="button" className={`${styles.dockBtn} ${identityOn ? styles.dockOn : ''}`}
                style={identityOn ? hueStyle(IDENTITY.hue) : undefined} onClick={toggleIdentity} aria-pressed={identityOn} aria-label={IDENTITY.name}>
                <Icon svg={IDENTITY.iconSvg} size={isMobile ? 16 : 19} />
                {identityOn && <span className={styles.liveDotHue} aria-hidden="true" />}
                {!isMobile && <span className={styles.dockTip} aria-hidden="true">{IDENTITY.name} <span>· {IDENTITY.sub}</span></span>}
              </button>
            </div>
          </div>
        </div>
      )}
      {isMobile && mobileView === 'pill' && (
        <button type="button" className={styles.pill} onClick={() => setMobileView('dock')} aria-label="Show ship data">
          <Icon svg={SHIP_ICON} size={20} />
          {activeCount > 0 && <span className={styles.pillBadge}>{activeCount}</span>}
        </button>
      )}

      {(!isMobile || mobileView === 'drawer') && (
        <MapSheet title="I want to see…" summary={`${activeCount} on`}
          className={`${styles.panel} ${!isMobile && !panelOpen ? styles.panelHidden : ''}`}
          desktopCollapsible={false}
          onSnapChange={(snap) => { if (isMobile && snap === 'peek' && mobileView === 'drawer') setMobileView('dock') }}>
          <div className={styles.panelHead}>
            <span className={styles.dockTitle}>I want to see…</span>
            <span className={styles.countChip}>{activeCount} on</span>
            <button className={styles.panelCollapse} onClick={() => { if (isMobile) setMobileView('dock'); else setPanelOpen(false) }} aria-label="Back to icon bar" title="Back to icon bar">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>
          {(panelOpen || isMobile) && (
            <div className={styles.panelBody}>
              <div className={styles.group}>
                <div className={styles.groupHead}>Ships</div>
                <div className={styles.layerBlock}>
                  <div className={styles.layerRow} role="switch" aria-checked={identityOn} tabIndex={0} onClick={toggleIdentity}
                    onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleIdentity() } }}>
                    <span className={`${styles.rowIcon} ${identityOn ? styles.dockOn : ''}`} style={identityOn ? hueStyle(IDENTITY.hue) : undefined} aria-hidden="true">
                      <Icon svg={IDENTITY.iconSvg} size={16} />
                    </span>
                    <div className={styles.layerInfo}>
                      <span className={styles.layerName}>{IDENTITY.name}</span>
                      <span className={styles.layerSub}>{IDENTITY.sub}</span>
                    </div>
                  </div>
                  {identityOn && (
                    <div className={styles.liveNote}>
                      Use the <strong>Ships</strong> pill at the top to find a ship. Every value on its card says whether the ship broadcast it
                      (<Ev c="ais_self_reported" />) or a registry recorded it (<Ev c="registry" />). Data:{' '}
                      <a className={styles.sourceLink} href={IDENTITY.sourceUrl} target="_blank" rel="noopener noreferrer">Powered by Global Fishing Watch.</a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </MapSheet>
      )}
    </div>
  )
}
