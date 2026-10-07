/**
 * /ships/permit/<id>: one permit, readable. Opened in a new tab from the terminal card's Permits tab.
 * Layout (Josh 2026-10-06: usability, readability, less scrolling): a compact header (what it is, number, holder, status,
 * Read-the-permit buttons top right); a sticky left column with the facts (status in plain words, issuer, holder and dock,
 * dates, versions, the cited "covers the dock" passage, reported emissions); the main column is tabs of compact tables —
 * Documents (filter chips by kind + search), Enforcement, SEPA reviews. The open tab and document filter live in the URL.
 * Every value links its source. Data: api op=permit (lib/ships/facilities.js permitPage).
 */
import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { publicLicense } from './publicLicense.js'
import { Loading } from '../components/panel'
import BuiltByCredit from '../components/BuiltByCredit.jsx'
import styles from './PermitPage.module.css'
import { STATUS_WORDS, statusKey, statusSource } from './permitStatus.js'

const fmtN = (n) => Number(n).toLocaleString('en-US')
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null)
const mb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)
const rec = (id) => `/ships/source/${id}`

const KIND = {
  'ICIS-NPDES': 'Water discharge permit (NPDES)', 'ICIS-Air': 'Air permit (Clean Air Act)', RCRAInfo: 'Hazardous waste (RCRA)',
  GHGRP: 'Greenhouse gas reporting id', RMP: 'Risk Management Plan id', TRI: 'Toxics Release Inventory id', SEMS: 'Superfund site record',
  CEDRI: 'Emissions reporting id', EIS: 'Emissions inventory id', SDWIS: 'Public water system', TSCA: 'Chemical substances (TSCA) id',
  ICIS: 'EPA enforcement-system facility id', 'WA-PARIS': 'Washington State permit (WA Ecology)',
}
const AREA = { CAAMACT: 'MACT', CAANESH: 'NESHAP', CAANSPS: 'NSPS', CAAPSD: 'PSD', CAASIP: 'SIP', CAATVP: 'Title V' }
const SRC = { 'wa-ecology-paris': 'WA Ecology PARIS', 'wa-ecology-industrial': 'WA Ecology refinery page', 'nwcaa-aop': 'Northwest Clean Air Agency' }
const AGENCY = { Local: 'Local agency', State: 'State', EPA: 'EPA', Federal: 'EPA' }
const GAS = [['co2', 'CO₂'], ['no2', 'NO₂'], ['so2', 'SO₂'], ['voc', 'VOC'], ['co', 'CO'], ['pm10', 'PM10']]

// Document kinds (PARIS's own document types): the permit itself first, routine submittals last.
const DOC_KINDS = [
  ['permit', 'Permit & fact sheets', (d) => /^Permit Documents$/i.test(d.type) || d.source !== 'wa-ecology-paris'],
  ['enforcement', 'Enforcement letters & orders', (d) => /^enforcement documents$/i.test(d.type || '') || /penalt/i.test(d.type || '')],
  ['ordered', 'Reports required by orders', (d) => /^enforcement submittals$/i.test(d.type || '')],
  ['appeal', 'Appeals', (d) => /appeal/i.test(d.type || '')],
  ['inspection', 'Inspection reports', (d) => /inspection/i.test(d.type || '')],
  ['application', 'Applications', (d) => /application/i.test(d.type || '')],
  ['communication', 'Letters', (d) => /communication/i.test(d.type || '')],
  ['submittal', 'Monitoring & other reports', (d) => /submittal/i.test(d.type || '')],
]
const kindOf = (d) => DOC_KINDS.find(([, , t]) => t(d))?.[0] ?? 'other'
const fileTag = (d) => /\.(pdf|docx?|xlsx?)/i.exec(d.title)?.[1]?.toUpperCase() || (/\.pdf|DownloadDocument|ViewDocument|wp-content\/uploads/i.test(d.url) ? 'PDF' : 'Page')

function Fact({ label, children }) {
  if (children == null || children === false || children === '') return null
  return <div className={styles.fact}><dt>{label}</dt><dd>{children}</dd></div>
}

function Documents({ docs, kind: asked, setKind }) {
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(60)
  const counts = useMemo(() => docs.reduce((m, d) => m.set(kindOf(d), (m.get(kindOf(d)) || 0) + 1), new Map()), [docs])
  // Default view = the permit and its fact sheets; a permit with none of those opens on All.
  const kind = asked !== 'all' && !counts.get(asked) ? 'all' : asked
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return docs.filter((d) => (kind === 'all' || kindOf(d) === kind)
      && (!t || [d.title, d.description, d.type].some((x) => String(x || '').toLowerCase().includes(t))))
  }, [docs, kind, q])
  const chips = [['all', 'All', docs.length], ...DOC_KINDS.map(([k, label]) => [k, label, counts.get(k) || 0]), ['other', 'Other', counts.get('other') || 0]]
    .filter(([k, , n]) => k === 'all' || n)
  return <>
    <p className={styles.small}>Counts here are files. The Actions & inspections tab counts events: one action can have several files, and many have none.</p>
    <div className={styles.toolbar}>
      <div className={styles.chips}>
        {chips.map(([k, label, n]) => (
          <button key={k} type="button" className={`${styles.chip} ${kind === k ? styles.chipOn : ''}`} onClick={() => { setKind(k); setLimit(60) }}>
            {label}<span>{fmtN(n)}</span></button>
        ))}
      </div>
      <input className={styles.search} type="search" placeholder="Search titles" value={q} onChange={(e) => { setQ(e.target.value); setLimit(60) }} aria-label="Search document titles" />
    </div>
    {!shown.length && <p className={styles.note}>No documents match.</p>}
    {shown.length > 0 && (
      <table className={styles.grid}>
        <thead><tr><th className={styles.cDate}>Date</th><th>Document</th><th className={styles.cVer}>Version</th><th className={styles.cSize}>Size</th></tr></thead>
        <tbody>
          {shown.slice(0, limit).map((d) => (
            <tr key={d.id}>
              <td className={styles.cDate}>{day(d.date) || '—'}</td>
              <td>
                <a className={styles.docLink} href={d.url} target="_blank" rel="noopener noreferrer">{d.title}</a>
                <div className={styles.sub}>
                  <span className={styles.tag}>{fileTag(d)}</span>
                  {[d.description && d.description !== d.title ? d.description : null, d.type].filter(Boolean).join(' · ')}
                  {' · '}<a href={rec(d.record_id)} target="_blank" rel="noopener noreferrer" title="The listing as EarthAtlas read it">{SRC[d.source] || d.source}</a>
                </div>
              </td>
              <td className={styles.cVer}>{d.permitVersion || '—'}</td>
              <td className={styles.cSize}>{d.size ? mb(d.size) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
    {shown.length > limit && <button type="button" className={styles.more} onClick={() => setLimit((l) => l + 200)}>Show more ({fmtN(shown.length - limit)} left)</button>}
  </>
}

const KIND_WORD = { formal: 'Formal action', notice: 'Notice', agency: 'Ecology record', inspection: 'Inspection' }
const vText = (v) => [v.parameter, v.value != null ? `${v.value}` : null, v.max_limit != null ? `limit ${v.max_limit}` : v.min_limit != null ? `min ${v.min_limit}` : null,
  v.point ? `outfall ${v.point}` : null].filter(Boolean).join(' · ')

function Enforcement({ rows, window, onViolations }) {
  if (!rows.length) return <p className={styles.note}>No notice, action or inspection is recorded against this permit.</p>
  return <>
    <table className={styles.grid}>
      <thead><tr><th className={styles.cDate}>Date</th><th>What happened</th><th>Read it</th><th className={styles.cSize}>Penalty</th></tr></thead>
      <tbody>
        {rows.map((x, i) => (
          <tr key={`${x.date}:${x.kind}:${i}`} className={x.kind === 'inspection' ? styles.rowInsp : ''}>
            <td className={styles.cDate}>{day(x.date) || '—'}</td>
            <td>
              <div className={styles.what}>{x.kind === 'inspection' ? `Inspection: ${x.type}` : x.type}</div>
              {x.outcome && <div className={styles.outcome}>Ecology’s decision: <strong>{x.outcome}</strong>{' '}
                <a href={rec(x.outcomeRecord)} target="_blank" rel="noopener noreferrer" className={styles.muted}>PARIS</a></div>}
              {x.violations?.length > 0 && (
                <div className={styles.vlist}>
                  <div className={styles.muted}>{x.violations.length === 1 ? 'Violation' : `${fmtN(x.violations.length)} violations`} recorded
                    {x.violationsSince ? ` since ${day(x.violationsSince)}` : ''}:</div>
                  {x.violations.slice(0, 4).map((v, k) => <div key={k}>{day(v.date)} · {v.violation}: {vText(v)}</div>)}
                  {x.violations.length > 4 && <button type="button" className={styles.linkBtn} onClick={onViolations}>All {fmtN(x.violations.length)} in Violations ›</button>}
                </div>
              )}
              <div className={styles.sub}>{KIND_WORD[x.kind] || x.kind} · {AGENCY[x.agency] || x.agency}{x.inspectionId ? ` · PARIS inspection ${x.inspectionId}` : ''}
                {' · '}{x.source === 'paris'
                  ? <a href={rec(x.record_id ?? x.documents?.[0]?.record_id)} target="_blank" rel="noopener noreferrer">WA Ecology PARIS</a>
                  : <a href={rec(x.record_id)} target="_blank" rel="noopener noreferrer">EPA ECHO</a>}</div>
            </td>
            <td>
              {x.documents?.map((d) => (
                <div key={d.url}><a className={styles.docLink} href={d.url} target="_blank" rel="noopener noreferrer" title={d.title}>
                  {d.what || 'Document'}{d.docket ? ` · docket ${d.docket}` : ''} ↗</a></div>
              ))}
              {x.case && <div><a href={x.case.url} target="_blank" rel="noopener noreferrer"
                title={`EPA ECHO case report ${x.case.id}: status, program, penalty and settlement. The agency’s own order isn’t published online`}>ECHO case {x.case.name || x.case.id} ↗</a></div>}
              {!x.documents?.length && !x.case && <span className={styles.muted}>{x.violations?.length ? 'No letter; details at left' : 'No document published'}</span>}
            </td>
            <td className={styles.cSize}>{x.penalty && x.penalty !== '$0' ? <strong>{x.penalty}</strong> : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {window && <p className={styles.small}>From EPA ECHO (about the last five years) and WA Ecology PARIS, matched by permit and date. “Ecology’s decision” is PARIS’s
      enforcement entry on the same day. Violations under a notice are the ones PARIS recorded for this permit since the previous action, grouped by EarthAtlas by date.
      For air permits, Northwest Clean Air Agency doesn’t publish its orders; the ECHO case report shows status, penalty and settlement.</p>}
  </>
}

function Violations({ rows }) {
  if (!rows.length) return <p className={styles.note}>WA Ecology PARIS lists no violations for this permit.</p>
  return <>
    <table className={styles.grid}>
      <thead><tr><th className={styles.cDate}>Date</th><th>Violation</th><th>Measured</th><th>Limit</th><th className={styles.cVer}>Outfall</th><th className={styles.cVer}>Addressed</th></tr></thead>
      <tbody>{rows.map((v, i) => (
        <tr key={i}>
          <td className={styles.cDate}>{day(v.date) || '—'}</td>
          <td>{v.violation}<div className={styles.sub}>{[v.parameter, v.category, v.event && v.event !== v.violation ? v.event : null].filter(Boolean).join(' · ')}</div></td>
          <td>{v.value != null ? `${fmtN(v.value)}${v.units && !/standard units/i.test(v.units) ? ` ${v.units}` : ''}` : '—'}</td>
          <td>{v.max_limit != null ? `max ${fmtN(v.max_limit)}` : v.min_limit != null ? `min ${fmtN(v.min_limit)}` : v.benchmark_max != null ? `benchmark ${fmtN(v.benchmark_max)}` : '—'}</td>
          <td className={styles.cVer}>{v.point || '—'}</td>
          <td className={styles.cVer}>{v.addressed === 'Y' ? 'Yes' : v.addressed === 'N' ? 'No' : '—'}</td>
        </tr>))}</tbody>
    </table>
    <p className={styles.small}>As listed by <a href={rec(rows[0].record_id)} target="_blank" rel="noopener noreferrer">WA Ecology PARIS</a> for this permit
      (limit exceedances, late or missing reports, permit triggers).</p>
  </>
}

function Sepa({ rows, issuer }) {
  return <>
    <p className={styles.small}>Environmental reviews of this facility’s projects where {issuer} was SEPA lead. Which permit each covered is in its own documents; not linked yet.</p>
    {!rows.length && <p className={styles.note}>No SEPA Register record with this agency as lead was matched to the facility.</p>}
    {rows.length > 0 && (
      <table className={styles.grid}>
        <thead><tr><th className={styles.cDate}>Issued</th><th>Proposal</th><th className={styles.cVer}>Decision</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sepa}>
              <td className={styles.cDate}>{day(r.issued)}</td>
              <td>
                <a className={styles.docLink} href={r.url} target="_blank" rel="noopener noreferrer">{r.proposalName || (r.description ? `${r.description.slice(0, 140)}${r.description.length > 140 ? '…' : ''}` : `SEPA ${r.sepa}`)}</a>
                <div className={styles.sub}>SEPA {r.sepa}{r.fileNumber ? ` · file ${r.fileNumber}` : ''}{r.applicant ? ` · ${r.applicant}` : ''}</div>
                {r.documents?.length > 0 && <div className={styles.sub}>{r.documents.map((d, i) => <span key={d.id}>{i > 0 && ' · '}<a href={d.url} target="_blank" rel="noopener noreferrer">{d.name}</a>{d.size ? ` (${d.size})` : ''}</span>)}</div>}
              </td>
              <td className={styles.cVer}>{r.type}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </>
}

export default function PermitPage() {
  const { id } = useParams()
  const [sp, setSp] = useSearchParams()
  const system = sp.get('s')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    fetch(`/api/ships?op=permit&key=${encodeURIComponent(id)}${system ? `&system=${encodeURIComponent(system)}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'We don’t hold that permit.' : `Couldn’t load it (${r.status}).`))))
      .then(setData).catch((e) => setError(e.message))
  }, [id, system])
  const p = data?.permit
  useEffect(() => { if (p) document.title = `${p.key} · ${KIND[p.system] || p.system} · EarthAtlas Ships` }, [p])

  const tabs = p ? [['documents', 'Documents', data.documents.length], ['enforcement', 'Actions & inspections', data.enforcement.length],
    ...(data.violations?.length ? [['violations', 'Violations', data.violations.length]] : []),
    ...(data.sepaLead ? [['sepa', 'SEPA reviews', data.sepa.length]] : [])] : []
  const tab = tabs.some(([t]) => t === sp.get('tab')) ? sp.get('tab') : 'documents'
  const kind = sp.get('k') || 'permit'
  // Tab and document filter live in the URL, so a shared link opens the same view.
  const setParam = (k, v, dflt) => setSp((cur) => { const n = new URLSearchParams(cur); if (v === dflt) n.delete(k); else n.set(k, v); return n }, { replace: true })

  const buttons = useMemo(() => {
    const docs = data?.documents || []
    const top = docs.find((d) => /^permit[,\s]/i.test(d.description || '')) || docs.find((d) => d.source === 'nwcaa-aop' && d.type === 'AOP')
    const sheet = docs.find((d) => /^fact sheet/i.test(d.description || '')) || docs.find((d) => d.source === 'nwcaa-aop' && d.type === 'SOB')
    return [top && ['Read the permit', top], sheet && [sheet.source === 'nwcaa-aop' ? 'Statement of Basis' : 'Fact sheet', sheet]].filter(Boolean)
  }, [data])
  const sw = p && STATUS_WORDS[statusKey(p.status)]
  const pastExpiry = p?.expires && new Date(p.expires) < new Date()

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <a href="/ships" className={styles.brand}>EarthAtlas <span>Ships</span></a>
      </header>
      {error && <p className={`${styles.note} ${styles.pad}`}>{error}</p>}
      {!data && !error && <div className={styles.pad}><Loading kind="quick" /></div>}
      {data?.ambiguous && <p className={`${styles.note} ${styles.pad}`}>That id is used in more than one EPA system: {data.ambiguous.map((a) => (
        <a key={a.system} href={`/ships/permit/${encodeURIComponent(id)}?s=${encodeURIComponent(a.system)}`}> {a.system}</a>))}</p>}
      {p && <>
        <div className={styles.head}>
          <div className={styles.headMain}>
            <div className={styles.kicker}>{KIND[p.system] || p.system}</div>
            <h1 className={styles.title}>{p.key}
              {p.status && <span className={`${styles.status} ${/^(Effective|Operating|Active)/.test(p.status) ? styles.statusOn : ''}`}
                title={`${statusSource(p)} lists it as “${p.status}”${sw ? `: ${sw.long}` : ''}`}>{sw?.short ?? p.status}</span>}
            </h1>
            <div className={styles.holder}>{p.name}</div>
          </div>
          {buttons.length > 0 && (
            <div className={styles.actions}>
              {buttons.map(([label, d]) => <a key={d.id} className={styles.primary} href={d.url} target="_blank" rel="noopener noreferrer">{label} ↗</a>)}
            </div>
          )}
        </div>

        <div className={styles.body}>
          <aside className={styles.side}>
            <dl className={styles.facts}>
              <Fact label="Status">{sw ? <>{sw.long[0].toUpperCase() + sw.long.slice(1)} <span className={styles.muted}>({statusSource(p)}: “{p.status}”)</span></> : p.status}</Fact>
              <Fact label="Issued by">{data.issuer}</Fact>
              <Fact label="Held for">{data.facilities.map((f) => <div key={f.key}>{f.name}{f.adminArea ? <span className={styles.muted}>, {f.adminArea}</span> : ''}</div>)}</Fact>
              <Fact label="Dock">{data.facilities.flatMap((f) => f.terminals).map((t) => <div key={t.key}><a href={`/ships?tl=${t.key}&tb=permits`}>{t.name}</a></div>)}</Fact>
              <Fact label="Type">{[p.universe, p.areas && p.areas.split(/,\s*/).map((a) => AREA[a] || a).join(', ')].filter(Boolean).join(' · ')}</Fact>
              <Fact label="Expires">{p.expires && <>{day(p.expires)}{pastExpiry && <div className={styles.muted}>A past date alone doesn’t mean no permit: renewals keep the old one in force (EPA).</div>}</>}</Fact>
              {data.air && <Fact label="Air permit">{data.air.aop} · dated {data.air.permitDate}<div className={styles.muted}>{data.air.status}</div></Fact>}
              <Fact label="Records">
                {p.echoUrl ? <><a href={p.echoUrl} target="_blank" rel="noopener noreferrer">EPA ECHO</a> · <a href={rec(p.recordId)} target="_blank" rel="noopener noreferrer">stored</a></>
                  : <><a href={rec(p.recordId)} target="_blank" rel="noopener noreferrer">WA Ecology PARIS</a> <span className={styles.muted}>(state permit; not in EPA’s records)</span></>}
              </Fact>
            </dl>

            {data.coverage?.length > 0 ? data.coverage.map((c) => (
              <div key={c.key} className={styles.cover}>
                <div className={styles.coverTag}>Covers the dock</div>
                <div>“{c.says}”</div>
                <div className={styles.muted}><a href={c.doc_url} target="_blank" rel="noopener noreferrer">{c.doc_title || 'Permit document'}, {c.where}</a></div>
              </div>
            )) : data.facilities.length > 0 && <p className={styles.small}>No permit document we’ve read names a dock as covered; the permit is the facility’s.</p>}

            {p.paris?.versions?.length > 0 && (
              <div className={styles.sideBlock}>
                <div className={styles.sideHead}>Versions <span>WA Ecology</span></div>
                <table className={styles.mini}>
                  <thead><tr><th>#</th><th>Status</th><th>Effective</th><th>Expires</th></tr></thead>
                  <tbody>{p.paris.versions.map((v) => (
                    <tr key={v.version} className={p.paris.current?.version === v.version ? styles.rowOn : ''} title={v.issued ? `Issued ${day(v.issued)}` : undefined}>
                      <td>{v.version}</td><td>{v.status}</td><td>{day(v.effective) || '—'}</td><td>{day(v.expires) || '—'}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            )}

            {data.air?.emissions && (
              <div className={styles.sideBlock}>
                <div className={styles.sideHead}>Reported emissions <span>t / year</span></div>
                <div className={styles.gases}>
                  {GAS.filter(([k]) => data.air.emissions[k] != null).map(([k, label]) => (
                    <div key={k} className={styles.gas}><span>{label}</span><strong>{fmtN(data.air.emissions[k])}</strong></div>
                  ))}
                </div>
                <div className={styles.muted}><a href={rec(data.air.recordId)} target="_blank" rel="noopener noreferrer">NWCAA permits page</a></div>
              </div>
            )}
          </aside>

          <section className={styles.content}>
            <div className={styles.tabs} role="tablist">
              {tabs.map(([t, label, n]) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} className={`${styles.tab} ${tab === t ? styles.tabOn : ''}`}
                  onClick={() => setParam('tab', t, 'documents')}>{label}<span className={styles.tabN}>{fmtN(n)}</span></button>
              ))}
            </div>
            {tab === 'documents' && (data.documents.length
              ? <Documents docs={data.documents} kind={kind} setKind={(k) => setParam('k', k, 'permit')} />
              : <p className={styles.note}>No document listing found for this permit yet. EPA ECHO lists the permit id only.</p>)}
            {tab === 'enforcement' && <Enforcement rows={data.enforcement} window={data.enforcementWindow} onViolations={() => setParam('tab', 'violations', 'documents')} />}
            {tab === 'violations' && <Violations rows={data.violations || []} />}
            {tab === 'sepa' && <Sepa rows={data.sepa} issuer={data.issuer} />}
            {tab === 'documents' && data.listings.length > 0 && (
              <p className={styles.small}>Read from {data.listings.map((l, i) => <span key={l.id}>{i > 0 && ', '}<a href={l.url} target="_blank" rel="noopener noreferrer">{SRC[l.source] || l.source}</a></span>)}
                {' '}on {day(data.listings[0].checked)}. Files open at the agency; EarthAtlas doesn’t keep copies.</p>
            )}
          </section>
        </div>

        <footer className={styles.foot}>
          {data.sources.map((x, i) => (
            <span key={x.id}>{i > 0 && ' · '}<a href={x.attribution_url || x.homepage_url || '#'} target="_blank" rel="noopener noreferrer">{x.attribution_text}</a>
              {x.license_url && publicLicense(x) && publicLicense(x) !== x.attribution_text && <> (<a href={x.license_url} target="_blank" rel="noopener noreferrer">{publicLicense(x)}</a>)</>}</span>
          ))}
          <BuiltByCredit variant="panel" className={styles.builtBy} />
        </footer>
      </>}
    </div>
  )
}
