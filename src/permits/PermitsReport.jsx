/**
 * /permits/report/<id>: one permit's full record as a printable document (Josh 2026-10-14: "so that a lawyer would have
 * everything they need to create a dossier for that permit"). Everything in the map popup, laid out for paper:
 * full URLs printed, each agency's own terms kept beside the plain words, when each source was read, formal
 * citations for the laws. Nothing is stated that its source doesn't state. "Print or save as PDF" is the browser's own.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import BuiltByCredit from '../components/BuiltByCredit.jsx'
import { STATUS_WORDS, statusKey } from '../ships/permitStatus.js'
import { fetchPermitsJson } from './permitsData.js'
import { LAW, fmtDate, docHref, permitKindOf, whyItems, calm, whatOf } from './permitLogic.js'
import c from './PermitsReport.module.css'

const SITE = 'https://earthatlas.org'
const abs = (u) => (u && u.startsWith('/') ? `${SITE}${u}` : u)
const SEV = { pollution: 'Over a pollution limit or benchmark', evasion: 'Report, sample or analysis never done', minor: 'Smaller (late, lab error, capacity)' }
const KIND_WORDS = { '402': 'Discharge permit (Clean Water Act §402)', '402 · ended': 'Discharge permit, ended (Clean Water Act §402)', '404': 'Army Corps permit (Clean Water Act §404 / Rivers and Harbors Act §10)',
  '401 + 404': 'Ecology 401 certification on an Army Corps permit', '401': 'Ecology 401 certification', 'State order': 'Ecology administrative order (RCW 90.48)', '408': 'Army Corps Section 408 request', JD: 'Army Corps jurisdictional determination' }
const ECHO_ALIAS = { 'admin continued': 'administratively continued' }

// Every doc key a record cites, in the order they appear.
const keysOf = (r) => [...new Set((JSON.stringify(r).match(/"src":"[^"]+"/g) || []).map((m) => m.slice(7, -1)))]
const metres = (a, b) => { const k = Math.PI / 180, x = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * k), y = b[1] - a[1]; return Math.round(Math.hypot(x, y) * k * 6371000) }
function inRing(pt, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const inPolygon = (pt, g) => (g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [])
  .some((poly) => inRing(pt, poly[0]) && !poly.slice(1).some((h) => inRing(pt, h)))

function Url({ href }) {
  if (!href) return null
  return <a className={c.url} href={abs(href)} target="_blank" rel="noopener noreferrer">{abs(href)}</a>
}

export default function PermitsReport() {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [waters, setWaters] = useState(null)
  const [records, setRecords] = useState({})
  const [appendix, setAppendix] = useState(true)
  const [error, setError] = useState(null)
  const mapEl = useRef(null)

  useEffect(() => {
    Promise.all(['permits.json', 'wq303d.geojson', 'shellfish.geojson'].map(fetchPermitsJson))
      .then(([d, wq, shell]) => { setData(d); setWaters({ wq, shell }) })
      .catch(() => setError('The permit data could not be loaded.'))
  }, [])

  const all = useMemo(() => (data ? [...data.projects, ...data.npdes].map((r) => ({ ...r, ...permitKindOf(r, data.docs) })) : []), [data])
  const r = all.find((x) => x.id === id)
  const docs = data?.docs || {}
  const tags = data?.tags || {}
  const agencyName = (a) => tags[a]?.[1] || data?.agencies?.[a] || a

  // The data each database record held when it was read (source pages), for the appendix.
  useEffect(() => {
    if (!r) return
    for (const k of keysOf(r).filter((k) => docs[k]?.record)) {
      fetchPermitsJson(`records/${k}.json`).then((rec) => setRecords((m) => ({ ...m, [k]: rec }))).catch(() => {})
    }
    document.title = `Permit report · ${r.name} · PermitTracker`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.id])

  // The place on the map (satellite with labels), kept in the printed copy.
  useEffect(() => {
    if (!r || !mapEl.current || !import.meta.env.VITE_MAPBOX_TOKEN) return
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN
    const map = new mapboxgl.Map({ container: mapEl.current, style: 'mapbox://styles/mapbox/satellite-streets-v12', center: [r.lon, r.lat], zoom: 15,
      interactive: false, attributionControl: true, preserveDrawingBuffer: true })
    new mapboxgl.Marker({ color: '#dc2626' }).setLngLat([r.lon, r.lat]).addTo(map)
    return () => map.remove()
  }, [r?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className={c.page}><main className={c.main}><p className={c.error}>{error}</p></main></div>
  if (!data) return <div className={c.page}><main className={c.main}><p className={c.note}>Loading…</p></main></div>
  if (!r) return <div className={c.page}><main className={c.main}><p className={c.error}>No permit record “{id}”.</p></main></div>

  const what = whatOf(r)
  const st = r.status || {}
  const sk = ECHO_ALIAS[statusKey(st.raw)] || statusKey(st.raw)
  const statusPlain = st.raw ? (STATUS_WORDS[sk]?.short || st.raw) : st.label
  const trail = [...(r.trail || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const vios = trail.filter((t) => t.sev)
  const keys = keysOf(r).filter((k) => docs[k])
  const nearby = all.filter((x) => x.id !== r.id && metres([r.lon, r.lat], [x.lon, x.lat]) <= 100)
    .map((x) => ({ x, m: metres([r.lon, r.lat], [x.lon, x.lat]) })).sort((a, b) => a.m - b.m)
  const pt = [r.lon, r.lat]
  const inWq = (waters?.wq.features || []).filter((f) => inPolygon(pt, f.geometry))
  const inShell = (waters?.shell.features || []).filter((f) => inPolygon(pt, f.geometry))
  const reportUrl = `${SITE}/permits/report/${encodeURIComponent(r.id)}`
  const today = new Date().toISOString().slice(0, 10)
  const srcLink = (k, label) => { const h = docHref(docs, k); return h ? <a className={c.src} href={abs(h)} target="_blank" rel="noopener noreferrer">{label || docs[k]?.title}</a> : (label || docs[k]?.title) }

  // What each document states about this record (the popup's sections, as rows).
  const stated = (k) => {
    const rows = []
    if (r.summary?.src === k) rows.push(['Description', r.summary.text])
    if (r.status?.src === k) rows.push(['Status', st.raw ? `${statusPlain} (the source's term: “${st.raw}”)` : st.label], ['Applicant', r.applicant])
    if (r.water && r.summary?.src === k) rows.push(['Water', r.water])
    if (r.window?.src === k) rows.push(['In-water work window', r.window.text])
    for (const f of r.facts || []) if (f.src === k) rows.push([f.label, f.value])
    for (const x of r.refs || []) if (x.src === k) rows.push(['Number', x.label])
    if (r.note?.src === k) rows.push(['Note', r.note.text])
    if (r.position?.src === k) rows.push(['Map location', r.position.text])
    return rows
  }

  return (
    <div className={c.page}>
      <header className={c.top}>
        <a href="/permits" className={c.brand}>EarthAtlas <span>PermitTracker</span></a>
        <div className={c.actions}>
          <label className={c.toggle}><input type="checkbox" checked={appendix} onChange={(e) => setAppendix(e.target.checked)} /> Include each database record in full</label>
          <button className={c.print} onClick={() => window.print()}>Print or save as PDF</button>
        </div>
      </header>
      <main className={c.main}>
        <div className={c.kicker}>Permit report</div>
        <h1 className={c.title}>{r.name}</h1>
        <div className={c.sub}>{KIND_WORDS[r.tag] || r.type} · {r.type}</div>

        <dl className={c.meta}>
          <dt>Status</dt><dd>{statusPlain}{st.raw ? <> (the source's term: “{st.raw}”)</> : null} · Source: {srcLink(st.src)}</dd>
          <dt>Applicant</dt><dd>{r.applicant}</dd>
          {r.island && <><dt>Island</dt><dd>{r.island}</dd></>}
          <dt>Location</dt><dd>{r.lat.toFixed(5)}, {r.lon.toFixed(5)}{r.approx ? ' (approximate)' : ''} · Map location: {r.position?.text} · Source: {srcLink(r.position?.src)}</dd>
          <dt>Numbers</dt><dd>{(r.refs || []).map((x) => x.label).join(' · ') || 'None given'}</dd>
          <dt>Report</dt><dd><Url href={reportUrl} /> · generated {fmtDate(today)} from agency records read {fmtDate(data.meta.baked.slice(0, 10))}</dd>
          <dt>On the map</dt><dd><Url href={`/permits?r=${encodeURIComponent(r.id)}`} /></dd>
        </dl>

        <div className={c.map} ref={mapEl} aria-label={`Map of ${r.name}`} />

        {what && (
          <section className={c.section}>
            <h2 className={c.h2}>What it is</h2>
            <p>{what.label !== 'What it is:' && <b>{what.label} </b>}{calm(what.text)}</p>
            <p className={c.srcLine}>Source: {srcLink(what.srcKey, what.srcLabel)} · <Url href={docHref(docs, what.srcKey)} /></p>
          </section>
        )}

        <section className={c.section}>
          <h2 className={c.h2}>Why it needs a permit</h2>
          <ul className={c.list}>
            {whyItems(r, docs).map((pieces, i) => (
              <li key={i}>{pieces.map((x, j) => (typeof x === 'string' ? <Fragment key={j}>{x}</Fragment>
                : <Fragment key={j}>{LAW[x.law].name} ({LAW[x.law].cite})</Fragment>))}</li>
            ))}
          </ul>
          <p className={c.srcLine}>The laws: {[...new Set(whyItems(r, docs).flat().filter((x) => typeof x !== 'string').map((x) => x.law))]
            .map((k, i) => <Fragment key={k}>{i ? ' · ' : ''}{LAW[k].cite} <Url href={LAW[k].url} /></Fragment>)}</p>
        </section>

        {r.violations && (
          <section className={c.section}>
            <h2 className={c.h2}>Violations</h2>
            <p>Since {fmtDate(r.violations.since)}: {r.violations.pollution} over a pollution limit or benchmark, {r.violations.evasion} reports, samples or analyses never done, {r.violations.minor} smaller.</p>
            <table className={c.table}>
              <thead><tr><th>Date</th><th>Kind</th><th>What the record says</th><th>Source</th></tr></thead>
              <tbody>
                {[...vios].reverse().map((t, i) => (
                  <tr key={i}><td className={c.date}>{fmtDate(t.date)}</td><td>{SEV[t.sev]}</td><td>{t.event}{t.title ? <div className={c.term}>{t.title}</div> : null}</td>
                    <td>{agencyName(t.agency)}<br /><Url href={t.url || docHref(docs, t.src)} /></td></tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className={c.section}>
          <h2 className={c.h2}>Timeline</h2>
          <table className={c.table}>
            <thead><tr><th>Date</th><th>Agency</th><th>Event</th><th>Source</th></tr></thead>
            <tbody>
              {trail.filter((t) => !t.sev).map((t, i) => (
                <tr key={i} className={t.date > today ? c.future : ''}><td className={c.date}>{fmtDate(t.date)}{t.date > today ? ' (scheduled)' : ''}</td><td>{agencyName(t.agency)}</td>
                  <td>{t.event}</td><td>{docs[t.src]?.title}</td></tr>
              ))}
            </tbody>
          </table>
        </section>

        {(r.flags || []).length > 0 && (
          <section className={c.section}>
            <h2 className={c.h2}>Where sources disagree</h2>
            {r.flags.map((f, i) => <p key={i}>{f.text} Sources: {f.srcs.map((k, j) => <Fragment key={k}>{j ? '; ' : ''}{docs[k]?.title} <Url href={docHref(docs, k)} /></Fragment>)}</p>)}
          </section>
        )}

        <section className={c.section}>
          <h2 className={c.h2}>Source documents</h2>
          {keys.map((k) => {
            const d = docs[k], rows = stated(k), ev = trail.filter((t) => t.src === k)
            const dock = (r.docks || []).find((x) => x.src === k)
            return (
              <div key={k} className={c.doc}>
                <h3 className={c.h3}>{d.title}</h3>
                <div className={c.docMeta}>{agencyName(d.agency)} · {d.kind === 'Record' ? 'database record' : d.kind === 'PDF' ? 'PDF document' : 'web page'}
                  {records[k]?.retrieved ? ` · read ${fmtDate(records[k].retrieved.slice(0, 10))}` : ''}</div>
                <div><Url href={docHref(docs, k)} /></div>
                {rows.length > 0 && <table className={c.kv}><tbody>{rows.map(([a, b], i) => <tr key={i}><th>{a}</th><td>{b}</td></tr>)}</tbody></table>}
                {ev.length > 0 && <div className={c.events}>{ev.length} dated {ev.length === 1 ? 'entry' : 'entries'} from this source (listed under {ev.some((t) => t.sev) ? 'Violations and ' : ''}Timeline).</div>}
                {r.ecyDocs?.src === k && (
                  <table className={c.table}><thead><tr><th>Date</th><th>Ecology document</th></tr></thead>
                    <tbody>{r.ecyDocs.list.map((x) => <tr key={x.id}><td className={c.date}>{fmtDate(x.date)}</td><td>{x.what}<br /><Url href={x.url} /></td></tr>)}</tbody></table>
                )}
                {dock && (
                  <>
                    <p className={c.note}>Permits at a dock {dock.m} m from this point that name {dock.shared.join(', ')}:</p>
                    <table className={c.table}><thead><tr><th>Date</th><th>Agency</th><th>Permit</th><th>Status</th></tr></thead>
                      <tbody>{dock.permits.map((x, i) => <tr key={i}><td className={c.date}>{fmtDate(x.date)}</td><td>{agencyName(x.agency)}</td><td>{calm(x.what)}{x.number ? ` (${x.number})` : ''}{x.applicant ? ` · ${x.applicant}` : ''}</td><td>{x.status ? calm(x.status) : ''}</td></tr>)}</tbody></table>
                  </>
                )}
              </div>
            )
          })}
        </section>

        <section className={c.section}>
          <h2 className={c.h2}>At this place</h2>
          <p><b>Impaired waters (Ecology 303(d) list):</b> {inWq.length ? inWq.map((f, i) => <Fragment key={i}>{i ? '; ' : ''}{f.properties.ListingWaterbodyName}, {f.properties.ParameterName} (listing {f.properties.ListingNumber}) <Url href={docHref(docs, f.properties.doc)} /></Fragment>) : 'none at this point.'}</p>
          <p><b>Shellfish growing area (Department of Health):</b> {inShell.length ? inShell.map((f, i) => <Fragment key={i}>{i ? '; ' : ''}{f.properties.NAME}, {f.properties.CLASS} <Url href={docHref(docs, f.properties.doc)} /></Fragment>) : 'none at this point.'}</p>
          <p><b>Other records within 100 m:</b> {nearby.length ? '' : 'none.'}</p>
          {nearby.length > 0 && (
            <table className={c.table}><thead><tr><th>Distance</th><th>Record</th><th>Kind</th><th>Report</th></tr></thead>
              <tbody>{nearby.map(({ x, m }) => <tr key={x.id}><td className={c.date}>{m} m</td><td>{x.name}</td><td>{KIND_WORDS[x.tag] || x.type}</td><td><Url href={`/permits/report/${encodeURIComponent(x.id)}`} /></td></tr>)}</tbody></table>
          )}
        </section>

        {appendix && (
          <section className={`${c.section} ${c.appendix}`}>
            <h2 className={c.h2}>Appendix: database records in full</h2>
            {keys.filter((k) => docs[k].record).map((k) => {
              const rec = records[k]
              return (
                <div key={k} className={c.doc}>
                  <h3 className={c.h3}>{docs[k].title}</h3>
                  <div className={c.docMeta}>{rec?.publisher}{rec?.retrieved ? ` · read ${rec.retrieved.slice(0, 10)}` : ''}{rec?.licence ? ` · ${rec.licence.text}` : ''}</div>
                  <div>Source: <Url href={docs[k].url || rec?.home?.href} /> · Data as received: <Url href={docHref(docs, k)} /></div>
                  {rec?.rows?.length ? <table className={c.kv}><tbody>{rec.rows.map((x, i) => <tr key={i}><th>{x.label}</th><td>{x.value}</td></tr>)}</tbody></table>
                    : <p className={c.note}>{rec ? 'This record lists no fields.' : 'Loading…'}</p>}
                </div>
              )
            })}
          </section>
        )}

        <footer className={c.footer}>
          <p>Every statement in this report comes from the source named with it. Plain-word statuses and kinds are given with each source's own term. Generated {fmtDate(today)} · <Url href={reportUrl} /></p>
          <BuiltByCredit variant="light" />
        </footer>
      </main>
    </div>
  )
}
