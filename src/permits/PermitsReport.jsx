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
import { processOf, statusShown } from './process.js'
import { TIERS } from './review.js'
import { FACTOR_BY_ID, distanceWords, FRIENDS_LOGO, FRIENDS_PAGE } from './habitat.js'
import { termsIn } from './glossary.js'
import { official } from './official.js'
import c from './PermitsReport.module.css'

const SITE = 'https://earthatlas.org'
const abs = (u) => (u && u.startsWith('/') ? `${SITE}${u}` : u)
const SEV = { pollution: 'Over a pollution limit or benchmark', evasion: 'Report, sample or analysis never done', minor: 'Smaller (late, lab error, capacity)' }
const KIND_WORDS = { '402': 'Discharge permit (Clean Water Act §402)', '402 · ended': 'Discharge permit, ended (Clean Water Act §402)', '404': 'U.S. Army Corps of Engineers permit (Clean Water Act §404 / Rivers and Harbors Act §10)',
  '401 + 404': 'Washington State Department of Ecology 401 certification on an U.S. Army Corps of Engineers permit', '401': 'Washington State Department of Ecology 401 certification', 'State order': 'Washington State Department of Ecology administrative order (RCW 90.48)', '408': 'U.S. Army Corps of Engineers Section 408 request', JD: 'U.S. Army Corps of Engineers jurisdictional determination' }
const ECHO_ALIAS = { 'admin continued': 'administratively continued' }
const STEP_WORD = { done: 'Done', now: 'Under way', na: 'Not part of this path', unknown: 'Not public' }

// Every doc key a record cites, in the order they appear.
const keysOf = (r) => [...new Set((JSON.stringify(r).match(/"src":"[^"]+"/g) || []).map((m) => m.slice(7, -1)))]
const metres = (a, b) => { const k = Math.PI / 180, x = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * k), y = b[1] - a[1]; return Math.round(Math.hypot(x, y) * k * 6371000) }
// Timeline groups: one per permit file. An event belongs to the Corps file it names; otherwise to its source record's
// own file, unless it predates that file (an Ecology record can list an earlier action on the same dock), in which
// case it is grouped as an earlier action of that record. Never attributed by guess beyond that.
const NWS = /NWS-(\d{4})-\d{4,5}/
function fileOf(t, docs) {
  const named = NWS.exec(`${t.event} ${t.title || ''}`)
  if (named) return { key: named[0], label: `U.S. Army Corps of Engineers file ${named[0]}` }
  const d = docs[t.src] || {}
  const own = NWS.exec(`${t.src} ${(d.rows || []).map((x) => x.value).join(' ')} ${d.title || ''}`)
  if (own && t.date && t.date.slice(0, 4) < own[1]) return { key: `${t.src}:earlier`, label: `Earlier action listed in ${d.look_up || d.title} (its file is not named)` }
  if (own) return { key: own[0], label: `U.S. Army Corps of Engineers file ${own[0]}` }
  return { key: t.src || 'other', label: d.title || 'Other records' }
}
function Term({ text }) {
  // Hover a sentence for the plain meaning of the terms in it (listed in full under "Terms used").
  const found = termsIn(text)
  return found.length ? <span className={c.termed} title={found.map((t) => `${t.term}: ${t.plain}`).join('\n\n')}>{text}</span> : text
}

function Url({ href }) {
  if (!href) return null
  return <a className={c.url} href={abs(href)} target="_blank" rel="noopener noreferrer">{abs(href)}</a>
}

export default function PermitsReport() {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [records, setRecords] = useState({})
  const [appendix, setAppendix] = useState(true)
  const [error, setError] = useState(null)
  const mapEl = useRef(null)

  useEffect(() => {
    // Waters and habitat come attached to each record (`near`, `receiving`), so only permits.json is needed.
    fetchPermitsJson('permits.json').then(setData)
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
  const reportUrl = `${SITE}/permits/report/${encodeURIComponent(r.id)}`
  const today = new Date().toISOString().slice(0, 10)
  const tracks = processOf(r)
  const docks = r.docks || []
  const dockKeys = new Set(docks.map((x) => x.src))
  const ownKeys = keys.filter((k) => !dockKeys.has(k))
  const groups = [...trail.filter((t) => !t.sev).reduce((m, t) => { const f = fileOf(t, docs); if (!m.has(f.key)) m.set(f.key, { ...f, events: [] }); m.get(f.key).events.push(t); return m }, new Map()).values()]
  const terms = termsIn(r.name, r.type, r.status?.label, trail.map((t) => t.event), tracks.flatMap((t) => [t.label, ...t.steps.map((x) => `${x.name} ${x.text || ''}`)]),
    r.review?.gaps.map((g) => g.text), r.review?.lever, whyItems(r, docs).flat().filter((x) => typeof x === 'string'), docks.flatMap((d) => d.permits.map((x) => x.what)))
  const srcLink = (k, label) => { const h = k && docHref(docs, k); return h ? <a className={c.src} href={abs(h)} target="_blank" rel="noopener noreferrer">{label || docs[k]?.title}</a> : (label || docs[k]?.title || '') }

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
          <a className={c.src} href="/permits/glossary">Terms</a>
          <label className={c.toggle}><input type="checkbox" checked={appendix} onChange={(e) => setAppendix(e.target.checked)} /> Include each database record in full</label>
          <button className={c.print} onClick={() => window.print()}>Print or save as PDF</button>
        </div>
      </header>
      <main className={c.main}>
        <div className={c.kicker}>Permit report</div>
        <h1 className={c.title}>{r.name}</h1>
        <div className={c.sub}>{KIND_WORDS[r.tag] || r.type} · {r.type}</div>

        <dl className={c.meta}>
          <dt>Status</dt><dd>{statusShown(statusPlain)}{st.raw ? <> (the source's term: “{st.raw}”)</> : null} · Source: {srcLink(st.src)}</dd>
          <dt>Applicant</dt><dd>{r.applicant}</dd>
          {r.island && <><dt>Island</dt><dd>{r.island}</dd></>}
          <dt>Location</dt><dd>{r.lat.toFixed(5)}, {r.lon.toFixed(5)}{r.approx ? ' (approximate)' : ''} · Map location: {r.position?.text} · Source: {srcLink(r.position?.src)}</dd>
          <dt>Numbers</dt><dd>{(r.refs || []).map((x) => x.label).join(' · ') || 'None given'}</dd>
          <dt>Report</dt><dd><Url href={reportUrl} /> · generated {fmtDate(today)} from agency records read {fmtDate(data.meta.baked.slice(0, 10))}</dd>
          <dt>On the map</dt><dd><Url href={`/permits?r=${encodeURIComponent(r.id)}`} /></dd>
        </dl>

        <div className={c.map} ref={mapEl} aria-label={`Map of ${r.name}`} />

        {r.review && (
          <section className={`${c.section} ${c.reviewBox}`}>
            <h2 className={c.h2}>Needs review · {TIERS[r.review.tier].label}</h2>
            <ul className={c.list}>{r.review.gaps.map((g, i) => <li key={i}><Term text={g.text} />{g.mark ? <b> Reviewed: {g.mark.status}{g.mark.note ? `, ${g.mark.note}` : ''}</b> : null}</li>)}</ul>
            <p className={c.srcLine}><Term text={r.review.lever} /></p>
          </section>
        )}

        {tracks.length > 0 && (
          <section className={c.section}>
            <h2 className={c.h2}>Where it is in the review process</h2>
            {tracks.map((t) => (
              <div key={t.id} className={c.track}>
                <h3 className={c.h3}><Term text={t.label} /></h3>
                <table className={c.kv}><tbody>{t.steps.map((st, k) => (
                  <tr key={k} className={c[`step_${st.state}`]}><th>{STEP_WORD[st.state]} · <Term text={st.name} /></th>
                    <td>{st.date ? `${fmtDate(st.date)} · ` : ''}<Term text={st.state === 'unknown' ? (st.text || 'Not in public records we hold') : (st.text || '')} />{st.src ? <> · {srcLink(st.src)}</> : null}</td></tr>
                ))}</tbody></table>
                {t.note && <p className={c.note}>{t.note}</p>}
              </div>
            ))}
          </section>
        )}

        {what && (
          <section className={c.section}>
            <h2 className={c.h2}>What it is</h2>
            <p>{what.label !== 'What it is:' && <b>{what.label} </b>}{calm(what.text)}</p>
            <p className={c.srcLine}>Source: {srcLink(what.srcKey, what.srcLabel)}</p>
          </section>
        )}

        <section className={c.section}>
          <h2 className={c.h2}>Why it needs a permit</h2>
          <ul className={c.list}>
            {whyItems(r, docs).map((pieces, i) => (
              <li key={i}>{pieces.map((x, j) => (typeof x === 'string' ? <Fragment key={j}>{x}</Fragment>
                : <a key={j} className={c.src} href={LAW[x.law].url} target="_blank" rel="noopener noreferrer">{LAW[x.law].name} ({LAW[x.law].cite})</a>))}</li>
            ))}
          </ul>
        </section>

        <section className={c.section}>
          <h2 className={c.h2}>Waters and habitat near it</h2>
          {(r.near || []).length + (r.receiving || []).length === 0 ? <p>None mapped within 300 m of this record’s point.</p> : (
            <table className={c.table}><thead><tr><th>What</th><th>Where</th><th>Source</th></tr></thead>
              <tbody>
                {(r.receiving || []).map((x, i) => { const f = FACTOR_BY_ID[x.h]; return <tr key={`r${i}`}><td><Term text={f.short} /> ({x.name})</td><td>Receives this discharge</td><td>{srcLink(x.src)}</td></tr> })}
                {(r.near || []).map((x, i) => { const f = FACTOR_BY_ID[x.h]; return <tr key={i}><td><Term text={f.short} />{x.name ? ` (${x.name})` : ''}</td><td>{distanceWords(x.m)}</td>
                  <td>{f.friends ? <a className={c.src} href={FRIENDS_PAGE} target="_blank" rel="noopener noreferrer">Friends of the San Juans habitat maps</a> : srcLink(x.src)}</td></tr> })}
              </tbody></table>
          )}
          {(r.near || []).some((x) => FACTOR_BY_ID[x.h]?.friends) && <p className={c.friends}><img src={FRIENDS_LOGO} alt="Friends of the San Juans" /> Habitat maps courtesy of Friends of the San Juans.</p>}
        </section>

        {(r.conditions || []).map((cd) => (
          <section key={cd.permit} className={c.section}>
            <h2 className={c.h2}>Spawning-season conditions in Washington Department of Fish and Wildlife permit {cd.permit}</h2>
            <p className={c.srcLine}><Term text="Hydraulic Project Approval" /> issued {fmtDate(cd.issued)} · <a className={c.src} href={cd.file} target="_blank" rel="noopener noreferrer">the permit</a> · <a className={c.src} href={cd.record} target="_blank" rel="noopener noreferrer">Washington Department of Fish and Wildlife record</a> · read {fmtDate(cd.read)}</p>
            <table className={c.kv}><tbody>
              <tr><th><Term text="Work window" /></th><td>{cd.timing?.length ? cd.timing[0] : 'No timing limitation in the permit.'}</td></tr>
              {Object.entries({ smelt: 'Surf smelt', sandlance: 'Pacific sand lance', herring: 'Pacific herring' }).map(([k, label]) => (
                <tr key={k}><th>{label}</th><td>{cd.species?.[k] ? `Provision ${cd.species[k].provision}: “${cd.species[k].quote}”` : 'Not named in the permit.'}</td></tr>))}
              {(cd.surveys || []).map((f, i) => <tr key={i}><th>Survey file</th><td><a className={c.src} href={f.url} target="_blank" rel="noopener noreferrer">{f.name}</a>: {f.permitCopy ? 'a copy of the permit, not a survey.' : f.image ? 'photo or scan.' : `${f.dates?.[0] ? `dated ${f.dates[0]}; ` : ''}${f.result ? `says “${f.result}”${f.ocr ? ' (read by OCR)' : ''}.` : 'no egg result stated in its text.'}`}</td></tr>)}
            </tbody></table>
          </section>
        ))}

        {r.violations && (
          <section className={c.section}>
            <h2 className={c.h2}>Violations</h2>
            <p>Since {fmtDate(r.violations.since)}: {r.violations.pollution} over a pollution limit or benchmark, {r.violations.evasion} reports, samples or analyses never done, {r.violations.minor} smaller.</p>
            <table className={c.table}>
              <thead><tr><th>Date</th><th>Kind</th><th>What the record says</th><th>Source</th></tr></thead>
              <tbody>
                {[...vios].reverse().map((t, i) => (
                  <tr key={i}><td className={c.date}>{fmtDate(t.date)}</td><td>{SEV[t.sev]}</td><td>{t.event}{t.title ? <div className={c.term}>{t.title}</div> : null}</td>
                    <td>{t.url ? <a className={c.src} href={t.url} target="_blank" rel="noopener noreferrer">{agencyName(t.agency)}</a> : srcLink(t.src, agencyName(t.agency))}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className={c.section}>
          <h2 className={c.h2}>Timeline, by permit file</h2>
          {groups.map((g) => (
            <div key={g.key} className={c.group}>
              <h3 className={c.h3}>{g.label}</h3>
              <table className={c.table}>
                <thead><tr><th>Date</th><th>Agency</th><th>Event</th><th>Source</th></tr></thead>
                <tbody>{g.events.map((t, i) => (
                  <tr key={i} className={t.date > today ? c.future : ''}><td className={c.date}>{fmtDate(t.date)}{t.date > today ? ' (scheduled)' : ''}</td><td>{agencyName(t.agency)}</td>
                    <td><Term text={t.event} /></td><td>{t.url ? <a className={c.src} href={t.url} target="_blank" rel="noopener noreferrer">{docs[t.src]?.title || 'Source'}</a> : srcLink(t.src)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ))}
        </section>

        {(r.flags || []).length > 0 && (
          <section className={c.section}>
            <h2 className={c.h2}>Where sources disagree</h2>
            {r.flags.map((f, i) => <p key={i}>{f.text} Sources: {f.srcs.map((k, j) => <Fragment key={k}>{j ? '; ' : ''}{srcLink(k)}</Fragment>)}</p>)}
          </section>
        )}

        <section className={c.section}>
          <h2 className={c.h2}>Source documents for this project</h2>
          {ownKeys.map((k) => {
            const d = docs[k], rows = stated(k), ev = trail.filter((t) => t.src === k)
            return (
              <div key={k} className={c.doc}>
                <h3 className={c.h3}>{srcLink(k)}</h3>
                <div className={c.docMeta}>{agencyName(d.agency)} · {d.kind === 'Record' ? 'database record' : d.kind === 'PDF' ? 'PDF document' : 'web page'}
                  {records[k]?.retrieved ? ` · read ${fmtDate(records[k].retrieved.slice(0, 10))}` : ''}</div>
                {rows.length > 0 && <table className={c.kv}><tbody>{rows.map(([a, b], i) => <tr key={i}><th>{a}</th><td><Term text={String(b)} /></td></tr>)}</tbody></table>}
                {ev.length > 0 && <div className={c.events}>{ev.length} dated {ev.length === 1 ? 'entry' : 'entries'} from this source, in the timeline above.</div>}
                {r.ecyDocs?.src === k && (
                  <table className={c.table}><thead><tr><th>Date</th><th>Washington State Department of Ecology document</th></tr></thead>
                    <tbody>{r.ecyDocs.list.map((x) => <tr key={x.id}><td className={c.date}>{fmtDate(x.date)}</td><td><a className={c.src} href={x.url} target="_blank" rel="noopener noreferrer">{x.what}</a></td></tr>)}</tbody></table>
                )}
              </div>
            )
          })}
        </section>

        {(docks.length > 0 || nearby.length > 0) && (
          <section className={c.section}>
            <h2 className={c.h2}>Possibly related records</h2>
            {docks.map((dk, i) => (
              <div key={i} className={c.doc}>
                <h3 className={c.h3}>Permits at a dock {dk.m} m away</h3>
                <p className={c.srcLine}>Permits at a dock {dk.m} m from this record’s map point that name {dk.shared.join(', ')}. Source: {srcLink(dk.src)}</p>
                <table className={c.table}><thead><tr><th>Date</th><th>Agency</th><th>Permit</th><th>Status</th></tr></thead>
                  <tbody>{dk.permits.map((x, k) => <tr key={k}><td className={c.date}>{fmtDate(x.date)}</td><td>{agencyName(x.agency)}</td><td><Term text={`${calm(x.what)}${x.number ? ` (${x.number})` : ''}`} />{x.applicant ? ` · ${x.applicant}` : ''}</td><td>{x.status ? calm(x.status) : ''}</td></tr>)}</tbody></table>
              </div>
            ))}
            {nearby.length > 0 && <>
              <h3 className={c.h3}>Other /permits records within 100 m</h3>
              <table className={c.table}><thead><tr><th>Distance</th><th>Record</th><th>Kind</th></tr></thead>
                <tbody>{nearby.map(({ x, m }) => <tr key={x.id}><td className={c.date}>{m} m</td><td><a className={c.src} href={`/permits/report/${encodeURIComponent(x.id)}`}>{x.name}</a></td><td>{KIND_WORDS[x.tag] || x.type}</td></tr>)}</tbody></table>
            </>}
          </section>
        )}

        {terms.length > 0 && (
          <section className={c.section}>
            <h2 className={c.h2}>Terms used in this report</h2>
            <dl className={c.terms}>{terms.map((t) => <Fragment key={t.id}><dt>{t.term}</dt><dd>{t.plain} <a className={c.src} href={t.href} target="_blank" rel="noopener noreferrer">{t.law}</a></dd></Fragment>)}</dl>
            <p className={c.note}><a className={c.src} href="/permits/glossary">All terms</a></p>
          </section>
        )}

        {appendix && (
          <section className={`${c.section} ${c.appendix}`}>
            <h2 className={c.h2}>Appendix: database records in full</h2>
            {keys.filter((k) => docs[k].record).map((k) => {
              const rec = records[k]
              return (
                <div key={k} className={c.doc}>
                  <h3 className={c.h3}>{docs[k].title}</h3>
                  <div className={c.docMeta}>{official(rec?.publisher)}{rec?.retrieved ? ` · read ${rec.retrieved.slice(0, 10)}` : ''}{rec?.licence ? ` · ${rec.licence.text}` : ''}</div>
                  <div>Source: <Url href={docs[k].url || rec?.home?.href} /> · Data as received: <Url href={docHref(docs, k)} /></div>
                  {rec?.rows?.length ? <table className={c.kv}><tbody>{rec.rows.map((x, i) => <tr key={i}><th>{official(x.label)}</th><td>{/^History/.test(x.label) ? official(x.value) : x.value}</td></tr>)}</tbody></table>
                    : <p className={c.note}>{rec ? 'This record lists no fields.' : 'Loading…'}</p>}
                </div>
              )
            })}
          </section>
        )}

        <footer className={c.footer}>
          <p>Generated {fmtDate(today)} · <Url href={reportUrl} /></p>
          <BuiltByCredit variant="light" />
        </footer>
      </main>
    </div>
  )
}
