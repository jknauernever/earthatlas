/**
 * /permits/dashboard: the starting page for Friends of the San Juans' Clean Water Act §401/§404 watchdog work (Josh
 * 2026-10-15: "a webpage that acts as the starting point into deeper data dives that answer different critical
 * questions"). Four questions (dashboardLogic.js), each a count, an overview map and a ranked list; every row opens
 * the record on the map (/permits?r=) or its printable report, and "See all on the map" opens /permits?q=<question>.
 * Light document page like the permit report (PermitsReport.module.css look). URL state: ?q=<question id>.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import BuiltByCredit from '../components/BuiltByCredit.jsx'
import { fetchPermitsJson } from './permitsData.js'
import { fmtDate, permitKindOf, activityYears } from './permitLogic.js'
import { QUESTIONS, QUESTION_BY_ID, rankFor, priorityHits, latestPast, PRIORITY, PRIORITY_M } from './dashboardLogic.js'
import { FACTOR_BY_ID, FRIENDS_LOGO, FRIENDS_PAGE, distanceWords } from './habitat.js'
import { TIERS, GAPS } from './review.js'
import { statusShown, stageOf } from './process.js'
import c from './PermitsDashboard.module.css'

const DEFAULT_Q = 'review'
const VIEW = { center: [-122.98, 48.6], zoom: 9.4 }
const TIER_COLOR = { now: '#dc2626', watch: '#f59e0b', record: '#64748b' }
const VIO_WORDS = { red: 'Over a pollution limit, or repeated missed reports', orange: 'Smaller violations' }

const readQ = () => { const v = new URLSearchParams(window.location.search).get('q'); return QUESTION_BY_ID[v] ? v : DEFAULT_Q }

export default function PermitsDashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [qid, setQid] = useState(readQ)
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    fetchPermitsJson('permits.json').then(setData).catch(() => setError('The permit data could not be loaded.'))
    const prev = document.title
    document.title = 'PermitTracker dashboard: water permits, San Juan County · EarthAtlas'
    return () => { document.title = prev }
  }, [])
  useEffect(() => {
    const url = qid === DEFAULT_Q ? window.location.pathname : `${window.location.pathname}?q=${qid}`
    window.history.replaceState(window.history.state, '', url)
  }, [qid])

  const all = useMemo(() => (data ? [...data.projects, ...data.npdes].map((r) => ({ ...r, ...permitKindOf(r, data.docs) })) : []), [data])
  const byQ = useMemo(() => Object.fromEntries(QUESTIONS.map((q) => [q.id, all.filter(q.test).sort(rankFor(q))])), [all])
  const q = QUESTION_BY_ID[qid]
  const rows = byQ[qid] || []

  // Overview map: the chosen question's records; click a dot to open it on the full map.
  useEffect(() => {
    if (!mapEl.current || mapRef.current || !import.meta.env.VITE_MAPBOX_TOKEN) return
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN
    const map = new mapboxgl.Map({ container: mapEl.current, style: 'mapbox://styles/mapbox/satellite-streets-v12', ...VIEW, cooperativeGestures: true })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('style.load', () => {
      map.addSource('rows', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'rows', type: 'circle', source: 'rows', paint: {
        'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } })
      map.on('click', 'rows', (e) => { const id = e.features?.[0]?.properties.id; if (id) window.open(`/permits?r=${encodeURIComponent(id)}`, '_blank', 'noopener') })
      map.on('mouseenter', 'rows', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'rows', () => { map.getCanvas().style.cursor = '' })
      setMapReady(true)
    })
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [data])
  useEffect(() => {
    const src = mapReady && mapRef.current?.getSource('rows')
    if (!src) return
    src.setData({ type: 'FeatureCollection', features: rows.map((r) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
      properties: { id: r.id, color: qid === 'review' ? TIER_COLOR[r.review.tier] : r.violations ? (r.violations.level === 'red' ? '#dc2626' : '#f97316') : priorityHits(r)[0] ? FACTOR_BY_ID[priorityHits(r)[0].h].color : '#0e7490' } })) })
  }, [rows, mapReady])

  const usesFriends = rows.some((r) => (r.near || []).some((x) => FACTOR_BY_ID[x.h]?.friends))

  return (
    <div className={c.page}>
      <header className={c.top}>
        <a className={c.brand} href="/permits">EarthAtlas<span>PermitTracker</span></a>
        <nav className={c.nav}><span className={c.navOn}>Dashboard</span><a href="/permits">Map</a><a href="/permits/glossary">Terms</a></nav>
      </header>
      <main className={c.main}>
        <div className={c.kicker}>Water permits · San Juan County, Washington</div>
        <h1 className={c.title}>Where Clean Water Act permits meet the shoreline</h1>
        <p className={c.sub}>
          U.S. Army Corps of Engineers permits to build in the water (§404, §10), Washington State Department of Ecology’s water-quality sign-offs (§401) and discharge
          permits (§402), checked against impaired waters, shellfish growing areas and habitat mapped by Friends of the San
          Juans. Pick a question; every row opens the full record.
        </p>
        {error && <p className={c.error}>{error}</p>}
        {!data && !error && <p className={c.note}>Loading…</p>}
        {data && <>
          <div className={c.tiles} role="tablist">
            {QUESTIONS.map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={x.id === qid} className={x.id === qid ? c.tileOn : c.tile} onClick={() => setQid(x.id)}>
                <span className={c.tileNum}>{byQ[x.id].length}</span>
                <span className={c.tileTitle}>{x.title}</span>
              </button>
            ))}
          </div>

          <section className={c.question}>
            <h2 className={c.h2}>{q.ask}</h2>
            <p className={c.why}>{q.why}</p>
            <div className={c.split}>
              <div className={c.map} ref={mapEl} />
              <div className={c.legend}>
                {qid === 'review'
                  ? Object.entries(TIERS).map(([k, t]) => <div key={k} title={t.note}><i style={{ background: TIER_COLOR[k] }} />{t.label} <b>{rows.filter((r) => r.review.tier === k).length}</b></div>)
                  : qid === 'violations'
                  ? Object.entries(VIO_WORDS).map(([k, w]) => <div key={k}><i style={{ background: k === 'red' ? '#dc2626' : '#f97316' }} />{w} <b>{rows.filter((r) => r.violations.level === k).length}</b></div>)
                  : PRIORITY.map((h) => {
                      const n = rows.filter((r) => priorityHits(r)[0]?.h === h).length
                      return n ? <div key={h}><i style={{ background: FACTOR_BY_ID[h].color }} />Closest: {FACTOR_BY_ID[h].label.toLowerCase()} <b>{n}</b></div> : null
                    })}
                {qid === 'open' && <div><i style={{ background: '#0e7490' }} />None within {PRIORITY_M} m <b>{rows.filter((r) => !priorityHits(r).length).length}</b></div>}
                <a className={c.mapLink} href={`/permits?q=${qid}`}>See all {rows.length} on the map →</a>
              </div>
            </div>

            <table className={c.table}>
              <thead><tr><th>Project</th><th>Status</th><th>{qid === 'review' ? 'What to look at, and the way to act' : qid === 'violations' ? 'Violations' : `Sensitive waters or habitat within ${PRIORITY_M} m`}</th><th className={c.date}>Latest</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><a className={c.name} href={`/permits?r=${encodeURIComponent(r.id)}`} target="_blank" rel="noopener noreferrer">{r.name}</a>
                      <div className={c.small}>{[r.tag, r.type, r.island].filter(Boolean).join(' · ')}</div></td>
                    <td>{statusShown(r.status?.label) || r.status?.raw || ''}{stageOf(r) && <div className={c.small}>{stageOf(r)}</div>}</td>
                    <td>{qid === 'review'
                      ? <div className={c.review}>
                          <span className={c.tier} style={{ background: TIER_COLOR[r.review.tier] }}>{TIERS[r.review.tier].label}</span>
                          {r.review.gaps.map((g, i) => <div key={i} className={c.gap} title={GAPS[g.id]}>{g.text}{g.mark && <span className={c.mark}> · Reviewed: {g.mark.status}{g.mark.note ? ` (${g.mark.note})` : ''}</span>}</div>)}
                          <div className={c.small}>{r.review.lever}</div>
                        </div>
                      : qid === 'violations'
                      ? <span className={c.vio} style={{ borderColor: r.violations.level === 'red' ? '#dc2626' : '#f97316' }}>
                          {[[r.violations.pollution, 'over a limit'], [r.violations.evasion, 'never reported or sampled'], [r.violations.minor, 'smaller']].filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(' · ')} since {r.violations.since}</span>
                      : priorityHits(r).length ? priorityHits(r).map((x) => (
                          <div key={x.h} className={c.hab}><i style={{ background: FACTOR_BY_ID[x.h].color }} />{FACTOR_BY_ID[x.h].label}{x.h === 'wq' || x.h === 'shell' ? ` (${x.name})` : ''}, {distanceWords(x.m)}</div>))
                        : <span className={c.small}>none mapped</span>}
                      {r.approx && <div className={c.small}>Map position approximate</div>}</td>
                    <td className={c.date}>{fmtDate(latestPast(r)) || (activityYears(r).length ? <span title="No dated event in the record; year from the U.S. Army Corps of Engineers file number">file {Math.max(...activityYears(r))}</span> : '—')}</td>
                    <td className={c.actions}><a href={`/permits/report/${encodeURIComponent(r.id)}`} target="_blank" rel="noopener noreferrer">Report</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <p className={c.note}>No records answer this question in the current data.</p>}
          </section>

          {usesFriends && (
            <a className={c.friends} href={FRIENDS_PAGE} target="_blank" rel="noopener noreferrer">
              <img src={FRIENDS_LOGO} alt="Friends of the San Juans" />
              <span>Habitat data courtesy of Friends of the San Juans (forage fish spawning surveys; herring spawning from Washington Department of Fish and Wildlife; eelgrass with
                Washington DNR and Friday Harbor Labs; bull kelp with Washington DNR). Impaired waters: Washington Department of Ecology 303(d) list; shellfish growing areas: Washington
                Department of Health.</span>
            </a>
          )}
          <footer className={c.footer}>
            Agency records read {fmtDate(data.meta.baked.slice(0, 10))} (updated weekly). Every source is listed on the{' '}
            <a href="/permits">map</a> under “How this is sourced”.
            <BuiltByCredit variant="light" />
          </footer>
        </>}
      </main>
    </div>
  )
}
