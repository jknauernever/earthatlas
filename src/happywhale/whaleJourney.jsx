/**
 * Whale journeys, shared by /happywhale and the main EarthAtlas search.
 *
 *   useWhaleJourney(id, …)     an identified whale's sightings worldwide + its legs routed through water
 *   addJourneyPathLayers(map)  dotted water-routed path + direction arrows (add BELOW the site's own dots)
 *   addJourneyStopLayers(map)  numbered stops, 1 = oldest (add ABOVE the site's own dots)
 *   setJourneyOnMap(map, …)    push a journey into those layers (null clears)
 *   <WhaleCard>                the whale card: overview, family, numbered sightings
 *
 * Moved out of HappyWhaleApp.jsx so both sites draw and describe a journey the same way.
 */
import { useEffect, useMemo, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { fetchIndividualTrack, sampleArrowPoints, speciesColor, individualUrl } from './happywhaleService.js'
import { routeJourney } from './oceanRouting.js'
import styles from './WhaleCard.module.css'

// ─── Helpers ─────────────────────────────────────────────────────────────────
export function fmtDate(d) {
  if (!d) return ''
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// HappyWhale individual bios arrive as markdown ("Mother of [**Scuba**](url)").
// Render just the subset they actually use — links and bold — as React nodes:
// text stays escaped, and hrefs are regex-limited to http(s), so nothing a
// bio author writes can inject markup.
function renderBoldRuns(text, keyBase) {
  const out = []
  const re = /\*\*([^*]+)\*\*/g
  let last = 0
  let m
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<strong key={`${keyBase}b${i++}`}>{m[1]}</strong>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function renderMarkdownLite(text) {
  const nodes = []
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  let last = 0
  let m
  let i = 0
  while ((m = linkRe.exec(text))) {
    if (m.index > last) nodes.push(...renderBoldRuns(text.slice(last, m.index), `t${i}`))
    nodes.push(
      <a key={`a${i}`} href={m[2]} target="_blank" rel="noopener noreferrer">
        {renderBoldRuns(m[1], `l${i}`)}
      </a>,
    )
    last = m.index + m[0].length
    i++
  }
  if (last < text.length) nodes.push(...renderBoldRuns(text.slice(last), 'tail'))
  return nodes
}


export const SEX_GLYPH = { MALE: '♂', FEMALE: '♀' }

// Wrap-aware bounds: shift each longitude to within 180° of the first point,
// so a set of points spanning the antimeridian fits the short way around
// instead of stretching the bounds across the whole globe (which zooms the
// camera out to z≈1 centered somewhere meaningless).
export function lngLatBoundsFor(coords) {
  if (!coords.length) return null
  const ref = coords[0][0]
  const b = new mapboxgl.LngLatBounds()
  for (const [lng, lat] of coords) {
    let L = lng
    while (L - ref > 180) L -= 360
    while (L - ref < -180) L += 360
    b.extend([L, lat])
  }
  return b
}

// ─── Journey map layers ──────────────────────────────────────────────────────
const PATH_SRC = 'hw-track'
const STOP_SRC = 'hw-journey-stops'
const EMPTY = { type: 'FeatureCollection', features: [] }

/** Dotted water-routed legs + pre-sampled direction arrows. Add below the site's own dots. Safe to call again after a style reload. */
export function addJourneyPathLayers(map) {
  if (map.getSource(PATH_SRC)) return
  map.addSource(PATH_SRC, { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'hw-track-line',
    type: 'line',
    source: PATH_SRC,
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 1.5,
      'line-opacity': 0.65,
      'line-dasharray': [1.5, 2.2],
    },
  })
  // Pre-sampled point glyphs with a zoom-LOD rank (Mapbox line placement drops symbols unpredictably; see
  // sampleArrowPoints).
  const rankGate = (minRank) => ['case', ['>=', ['get', 'rank'], minRank], 26, 0]
  map.addLayer({
    id: 'hw-track-arrows',
    type: 'symbol',
    source: PATH_SRC,
    filter: ['==', ['geometry-type'], 'Point'],
    layout: {
      'text-field': '→',
      // step, not interpolate: an arrow is either full size or hidden. Interpolating grew each new rank in from 0, so
      // between whole zooms the chain mixed full and half-size arrows.
      'text-size': ['step', ['zoom'], rankGate(7),
        3, rankGate(6), 4, rankGate(5), 5, rankGate(4),
        6, rankGate(3), 7, rankGate(2), 8, rankGate(1), 9, rankGate(0),
      ],
      'text-rotate': ['get', 'rot'],
      'text-rotation-alignment': 'map',
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': ['get', 'color'],
      // Dark outline on /happywhale's dark satellite; a light one where the site passes it (main search's light map).
      'text-halo-color': ['coalesce', ['get', 'halo'], 'rgba(0,0,0,0.55)'],
      'text-halo-width': 1.4,
    },
  })
}

/**
 * Numbered stops (1 = oldest). Numbered stops, not straight connectors: real encounters carry no route, and straight
 * lines send whales over land. Add above the site's own dots. Safe to call again after a style reload.
 */
export function addJourneyStopLayers(map) {
  if (map.getSource(STOP_SRC)) return
  map.addSource(STOP_SRC, { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'hw-journey-stops',
    type: 'circle',
    source: STOP_SRC,
    paint: {
      // NB: a zoom interpolate must be the OUTERMOST expression (wrapping it silently rejects the layer).
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 8, 6, 11, 10, 15],
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.95,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff',
    },
  })
  map.addLayer({
    id: 'hw-journey-seq',
    type: 'symbol',
    source: STOP_SRC,
    layout: {
      'text-field': ['to-string', ['get', 'seq']],
      'text-size': 11,
      'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(0,0,0,0.7)',
      'text-halo-width': 1.2,
    },
  })
}

/**
 * Show a journey (track from useWhaleJourney, legs may still be null while routing) or clear it with null.
 * color overrides the species color for the stops, dotted path and arrows: the main search has no species colors (every
 * dot is its orange), and species blues vanish on its blue ocean. /happywhale keeps species colors.
 */
export function setJourneyOnMap(map, track, legs, { color: siteColor = null, arrowHalo = null } = {}) {
  const path = map?.getSource(PATH_SRC)
  const stops = map?.getSource(STOP_SRC)
  if (!track) {
    path?.setData(EMPTY)
    stops?.setData(EMPTY)
    return
  }
  const color = siteColor || speciesColor(track.individual?.speciesKey)
  stops?.setData({
    type: 'FeatureCollection',
    features: track.encounters.map((e, i) => ({
      type: 'Feature',
      properties: { color, seq: i + 1, id: e.id },
      geometry: { type: 'Point', coordinates: [e.lng, e.lat] },
    })),
  })
  path?.setData(!legs ? EMPTY : {
    type: 'FeatureCollection',
    features: [
      ...legs.map((l) => ({ type: 'Feature', properties: { color }, geometry: { type: 'LineString', coordinates: l.coords } })),
      ...sampleArrowPoints(legs).map((p) => ({
        type: 'Feature',
        properties: { color, rot: p.rot, rank: p.rank, ...(arrowHalo ? { halo: arrowHalo } : {}) },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
    ],
  })
}

// ─── Journey data ────────────────────────────────────────────────────────────
/**
 * The selected whale's journey: { track, legs, setTrack }.
 *   id        HappyWhale individual id, or null for none
 *   local     encounters already loaded on the map (normalized, with .individual) — used when HappyWhale's record for
 *             the whale lists no sightings yet (seen live 2026-09: fresh matches not yet propagated)
 *   onMissing called when the whale can't be loaded (unknown id, network failure)
 * Deliberately not keyed on map readiness: a second fetch would produce a fresh track object and re-run camera
 * effects that already fired.
 */
export function useWhaleJourney(id, { local = [], onMissing } = {}) {
  const [track, setTrack] = useState(null)
  const [legs, setLegs] = useState(null)

  useEffect(() => {
    if (id == null) { setTrack(null); return }
    const ac = new AbortController()
    fetchIndividualTrack({ id, signal: ac.signal })
      .then((res) => {
        if (ac.signal.aborted) return
        if (!res.individual) { onMissing?.(); return }
        if (!res.encounters.length) {
          const mine = local.filter((e) => e.individual?.id === id).slice().sort((a, b) => a.time - b.time)
          setTrack({ ...res, encounters: mine, partial: true })
          return
        }
        setTrack(res)
      })
      .catch((err) => {
        if (ac.signal.aborted || err.name === 'AbortError') return
        console.error('happywhale: individual track failed', err)
        onMissing?.()
      })
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // A partial journey may have resolved before the map's own data — fill it in when that data lands.
  useEffect(() => {
    if (!track?.partial || track.encounters.length) return
    const mine = local.filter((e) => e.individual?.id === track.individual.id).slice().sort((a, b) => a.time - b.time)
    if (mine.length) setTrack((t) => (t && t.partial && !t.encounters.length ? { ...t, encounters: mine } : t))
  }, [local, track])

  // Route the legs through water (async: lazy-loads the land mask on the first journey, then A* per leg).
  useEffect(() => {
    if (!track || track.encounters.length < 2) { setLegs(null); return }
    let cancelled = false
    routeJourney(track.encounters)
      .then((l) => { if (!cancelled) setLegs(l) })
      .catch(() => { if (!cancelled) setLegs(null) })
    return () => { cancelled = true }
  }, [track])

  return { track, legs, setTrack }
}

/** Fit a map to a journey's stops (wrap-aware). */
export function fitJourney(map, track, { padding = 90, maxZoom = 8, duration = 1400 } = {}) {
  const b = track && lngLatBoundsFor(track.encounters.map((e) => [e.lng, e.lat]))
  if (map && b) map.fitBounds(b, { padding, maxZoom, duration, essential: true })
}

// ─── Whale card ──────────────────────────────────────────────────────────────
// Relatives are not a structured API field — researchers encode them as
// happywhale.com/individual links in the bio ("Mother of [**Scuba**](…)").
function familyLinks(bio, selfId) {
  if (!bio) return []
  const out = []
  const seen = new Set()
  const re = /\[([^\]]+)\]\(https?:\/\/happywhale\.com\/individual\/(\d+)\/?\)/g
  let m
  while ((m = re.exec(bio))) {
    const id = Number(m[2])
    if (id === selfId || seen.has(id)) continue
    seen.add(id)
    out.push({ id, label: m[1].replace(/\*\*/g, '') })
  }
  return out
}

const havKmApp = (lat1, lng1, lat2, lng2) => {
  const r = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(a))
}

const SEX_WORDS = { MALE: 'Male', FEMALE: 'Female' }

// "British Columbia, Canada" → "British Columbia": the card is tight on
// width and the country rarely disambiguates; full text stays in tooltips.
const regionShort = (r) => (r || '').split(',')[0].trim()

export function WhaleCard({ track, speciesName, scientificName, onClose, onZoomJourney, onSelectRelative, onZoomStop, inline = false }) {
  const [tab, setTab] = useState('overview')
  const ind = track.individual
  const encs = track.encounters
  const fam = useMemo(() => familyLinks(ind.bio, ind.id), [ind])
  const span = encs.length ? [encs[0].date, encs[encs.length - 1].date] : null
  // Overview facts, all derived from the loaded sightings.
  const facts = useMemo(() => {
    const heroEnc = [...encs].reverse().find((e) => e.media?.url || e.media?.thumbUrl)
    let distKm = 0
    for (let i = 1; i < encs.length; i++) distKm += havKmApp(encs[i - 1].lat, encs[i - 1].lng, encs[i].lat, encs[i].lng)
    const regionCount = new Map()
    for (const e of encs) if (e.region) regionCount.set(e.region, (regionCount.get(e.region) || 0) + 1)
    const regions = [...regionCount.entries()].sort((a, b) => b[1] - a[1])
    const years = new Set(encs.map((e) => (e.date || '').slice(0, 4)).filter(Boolean))
    return {
      hero: heroEnc ? (heroEnc.media.url || heroEnc.media.thumbUrl) : null,
      heroDate: heroEnc?.date || null,
      distKm: Math.round(distKm),
      regions,
      years: years.size,
    }
  }, [encs])
  const tabs = [
    ['overview', 'Overview'],
    ['family', fam.length ? `Family · ${fam.length}` : 'Family'],
    ['sightings', `Sightings · ${encs.length}`],
  ]
  return (
    <div className={`${styles.wcWrap} ${inline ? styles.wcWrapInline : ''}`}>
      <div className={styles.wcCard} role="dialog" aria-label="Whale card">
        <button type="button" className={styles.wcClose} onClick={onClose} aria-label="Close whale card">×</button>

        <div className={styles.wcHead}>
          {ind.avatar?.thumbUrl
            ? <img className={styles.wcAvatar} src={ind.avatar.thumbUrl} alt="" />
            : <span className={styles.journeyDot} style={{ background: speciesColor(ind.speciesKey) }} />}
          <div>
            <div className={styles.wcName}>
              {SEX_GLYPH[ind.sex] ? `${SEX_GLYPH[ind.sex]} ` : ''}{ind.nickname || ind.primaryId || 'Identified individual'}
            </div>
            <div className={styles.journeyMeta}>
              {speciesName(ind.speciesKey)}{ind.primaryId && ind.nickname ? ` · ${ind.primaryId}` : ''}
            </div>
            <div className={styles.journeyMeta}>
              {encs.length} encounters{span ? ` · ${fmtDate(span[0])} → ${fmtDate(span[1])}` : ''}
            </div>
          </div>
        </div>

        <div className={styles.wcTabs} role="tablist">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id}
              className={`${styles.wcTab} ${tab === id ? styles.wcTabOn : ''}`} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {tab === 'overview' && (
          <div>
            {track.partial && (
              <div className={styles.journeyDisclaimer}>
                HappyWhale's record for this whale doesn't list its sightings yet —
                showing {encs.length ? `the ${encs.length}` : 'none'} from the current map search.
              </div>
            )}
            {facts.hero && (
              <img className={styles.wcHero} src={facts.hero} alt=""
                title={facts.heroDate ? `Photographed ${fmtDate(facts.heroDate)} — © the contributing photographer, via HappyWhale` : ''} />
            )}
            {(scientificName || SEX_WORDS[ind.sex]) && (
              <div className={styles.journeyMeta}>
                {scientificName && <em>{scientificName}</em>}
                {scientificName && SEX_WORDS[ind.sex] ? ' · ' : ''}{SEX_WORDS[ind.sex] || ''}
              </div>
            )}
            {encs.length > 0 && (
              <div className={styles.statGrid}>
                <div className={styles.statBox}><span className={styles.statVal}>{facts.years}</span><span className={styles.statKey}>{facts.years === 1 ? 'year seen' : 'years seen'}</span></div>
                <div className={styles.statBox}><span className={styles.statVal}>{facts.distKm >= 100 ? `${facts.distKm.toLocaleString()}` : '—'}</span><span className={styles.statKey}>km ≥ traveled</span></div>
                <div className={styles.statBox}><span className={styles.statVal}>{facts.regions.length}</span><span className={styles.statKey}>{facts.regions.length === 1 ? 'region' : 'regions'}</span></div>
              </div>
            )}
            {(facts.regions.length > 0 || encs.length > 0) && (
              <div className={styles.wcKVs}>
                {facts.regions.length > 0 && (
                  <div className={styles.wcKV}>
                    <span className={styles.wcK}>Seen in</span>
                    <span className={styles.wcV} title={facts.regions.map(([r, n]) => `${r} (${n})`).join(' · ')}>
                      {facts.regions.slice(0, 3).map(([r, n]) => `${regionShort(r)} (${n})`).join(' · ')}
                      {facts.regions.length > 3 ? ` · +${facts.regions.length - 3} more` : ''}
                    </span>
                  </div>
                )}
                {encs.length > 0 && (
                  <div className={styles.wcKV}>
                    <span className={styles.wcK}>First seen</span>
                    <span className={styles.wcV}>{fmtDate(encs[0].date)}{encs[0].region ? ` · ${regionShort(encs[0].region)}` : ''}</span>
                  </div>
                )}
                {encs.length > 0 && (
                  <div className={styles.wcKV}>
                    <span className={styles.wcK}>Last seen</span>
                    <span className={styles.wcV}>{fmtDate(encs[encs.length - 1].date)}{encs[encs.length - 1].region ? ` · ${regionShort(encs[encs.length - 1].region)}` : ''}</span>
                  </div>
                )}
                <div className={styles.wcKV}>
                  <span className={styles.wcK}>On the map</span>
                  <span className={styles.wcV}>Stops numbered ① oldest → newest</span>
                </div>
              </div>
            )}
            <div className={styles.journeyDisclaimer}>
              Exact routes of whales between points are not known, but estimated. Distance
              is the shortest path between sightings — the whale swam at least this far.
            </div>
            {ind.bio && <div className={styles.journeyBio}>{renderMarkdownLite(ind.bio)}</div>}
            <button type="button" className={styles.journeyZoom} onClick={onZoomJourney}>⟶ Zoom to journey</button>
            <a className={styles.journeyLink} href={individualUrl(ind.id)} target="_blank" rel="noopener noreferrer">
              View on HappyWhale ↗
            </a>
          </div>
        )}

        {tab === 'family' && (
          <div>
            {fam.length === 0 && (
              <div className={styles.journeyMeta}>
                No relatives linked in this whale's records yet — family appears when
                researchers link relatives in the HappyWhale bio.
              </div>
            )}
            {fam.map((f) => (
              <button key={f.id} type="button" className={styles.wcRow} onClick={() => onSelectRelative(f.id)}
                title="Open this relative's journey">
                <span className={styles.wcRowMain}>{f.label}</span>
                <span className={styles.wcRowAction}>journey ⟶</span>
              </button>
            ))}
            {fam.length > 0 && (
              <div className={styles.journeyDisclaimer}>
                Relatives as linked by researchers in the HappyWhale bio.
              </div>
            )}
          </div>
        )}

        {tab === 'sightings' && (
          <div>
            {encs.map((e, i) => (
              <button key={e.id} type="button" className={styles.wcRow} onClick={() => onZoomStop(e)}
                title="Zoom to this sighting on the map">
                <span className={styles.wcSeq}>{i + 1}</span>
                {e.media?.thumbUrl && <img className={styles.wcThumb} src={e.media.thumbUrl} alt="" loading="lazy" />}
                <span className={styles.wcRowMain}>
                  {fmtDate(e.date)}
                  <span className={styles.wcRowSub}>{[e.location, e.region].filter(Boolean).join(' · ') || e.ocean || ''}</span>
                </span>
                <span className={styles.wcRowAction}>⌖</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

