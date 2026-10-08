/**
 * The terminal card's Permits tab (Josh + Lovel 2026-10-06; pilot: BP Cherry Point, Marathon Anacortes). For the facility the
 * terminal serves: EPA program records (permits and reporting ids) and enforcement from ECHO, and the WA SEPA environmental
 * reviews from Ecology's SEPA Register. Every row links its stored record and the source's own page.
 * Data: api op=terminalPermits (lib/ships/facilities.js).
 */
import { useEffect, useState } from 'react'
import { publicLicense } from './publicLicense.js'
import styles from './ShipsApp.module.css'
import Chevron from './Chevron.jsx'
import { statusShort, statusTitle, nrcedResult, oncePhrase, sepaTypeTitle, sepaIndicator } from './permitStatus.js'
import { Loading } from '../components/panel'
import LandRecords from './LandRecords.jsx'

const fmtN = (n) => Number(n).toLocaleString('en-US')
const plural = (n, w, ws = `${w}s`) => `${fmtN(n)} ${n === 1 ? w : ws}`
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'no date')
const rec = (id) => `/ships/source/${id}`

const STATUTE = {
  State: 'Washington State permits (WA Ecology; not in EPA’s records)',
  CWA: 'Water discharges (Clean Water Act)', CAA: 'Air (Clean Air Act)', RCRA: 'Hazardous waste (RCRA)',
  EP313: 'Toxic releases reporting (TRI)', TSCA: 'Chemical substances (TSCA)', CERCLA: 'Contaminated-site records (Superfund)',
  SDWA: 'Drinking water system (Safe Drinking Water Act)',
  'BC EMA': 'Waste discharge authorizations (BC Environmental Management Act)',
  'MV AQ': 'Air quality permits (Metro Vancouver)',
  'WA air': 'Air permits from the local clean air agency',
}
const STATUTE_ORDER = ['State', 'CWA', 'CAA', 'WA air', 'RCRA', 'EP313', 'CERCLA', 'TSCA', 'SDWA', 'BC EMA', 'MV AQ']
const SYSTEM_TITLE = {
  'ICIS-NPDES': 'NPDES water discharge permit / permit coverage (EPA ICIS-NPDES)', 'ICIS-Air': 'Air program record (EPA ICIS-Air); Areas lists the air programs that apply',
  GHGRP: 'Greenhouse Gas Reporting Program facility id (a reporting id, not a permit)', RMP: 'Risk Management Plan id (accident prevention; a reporting id, not a permit)',
  CEDRI: 'Compliance and Emissions Data Reporting Interface id (reporting)', EIS: 'National Emissions Inventory id (reporting)',
  RCRAInfo: 'Hazardous waste handler id (EPA RCRAInfo)', TRI: 'Toxics Release Inventory reporting id', SEMS: 'Superfund site record (SEMS)',
  'WA-PARIS': 'Washington State permit (WA Ecology PARIS); not an EPA record',
  'BC-EMA': 'BC Environmental Management Act authorization (a permit, approval or registration under a regulation), from the BC Ministry of Environment and Parks register', SDWIS: 'Public water system id (SDWIS)', TSCA: 'TSCA submission id', ICIS: 'Facility id in EPA’s enforcement system ICIS (often under an older name)',
}
const AREA_WORDS = { CAAMACT: 'MACT', CAANESH: 'NESHAP', CAANSPS: 'NSPS', CAAPSD: 'PSD', CAASIP: 'SIP', CAATVP: 'Title V' }
const areaText = (a) => String(a || '').split(/,\s*/).map((x) => AREA_WORDS[x] || x).join(', ')
const AGENCY = { Local: 'local agency', State: 'state', EPA: 'EPA', Federal: 'EPA' }
const sepaTitle = sepaTypeTitle

function Fold({ title, children, open: start = false }) {
  const [open, setOpen] = useState(start)
  return (
    <div className={styles.pcAbout}>
      <button type="button" className={styles.recordToggle} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{title} <Chevron up={open} size={13} /></button>
      {open && <div>{children}</div>}
    </div>
  )
}

const ext = (href, label, title) => <a className={`${styles.sourceLink} ${styles.srcLink}`} href={href} target="_blank" rel="noopener noreferrer" title={title}>{label}</a>

const DOC_SRC = { 'wa-ecology-paris': 'WA Ecology PARIS', 'wa-ecology-industrial': 'WA Ecology', 'nwcaa-aop': 'NW Clean Air Agency', 'pscaa-title-v': 'Puget Sound Clean Air', 'bc-nrced': 'BC NRCED' }
const BC_REGISTER = 'https://catalogue.data.gov.bc.ca/dataset/waste-discharge-authorizations-all-authorizations'
SYSTEM_TITLE['MV-AQ'] = 'Metro Vancouver air quality permit (GVRD Air Quality Management Bylaw No. 1082)'
DOC_SRC['metro-vancouver-aq-permits'] = 'Metro Vancouver'
// WA local clean air agencies (lib/ships/waAirAgencies.js): orders of approval, air discharge permits, registrations.
const AIR_AGENCY = { PSCAA: 'Puget Sound Clean Air Agency', ORCAA: 'Olympic Region Clean Air Agency', SWCAA: 'Southwest Clean Air Agency' }
for (const [k, v] of Object.entries(AIR_AGENCY)) SYSTEM_TITLE[k] = `${v}: an air permit or registration, from the agency’s own documents`
Object.assign(DOC_SRC, { 'pscaa-documents': 'Puget Sound Clean Air', 'orcaa-permits': 'Olympic Region Clean Air', 'swcaa-permits': 'Southwest Clean Air' })
// ECHO lists a local agency's air actions as "Local"; the ICIS-Air id's prefix names which agency (WAPSC… = PSCAA, WANCA… = NWCAA).
const LOCAL_AIR = { WAPSC: 'Puget Sound Clean Air Agency', WANCA: 'Northwest Clean Air Agency' }
const agencyWords = (x) => (x.agency === 'Local' && LOCAL_AIR[String(x.permit_key || '').slice(0, 5)]) || AGENCY[x.agency] || x.agency
const mb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)

/** One document: its title opens the file at the agency; the chip opens the listing EarthAtlas read it from. */
function Doc({ d }) {
  const isPage = !/\.pdf|DownloadDocument|ViewDocument|wp-content\/uploads|DocumentCenter\/View/i.test(d.url)
  return (
    <div className={styles.legendNoteText}>
      <a className={styles.pcPlainLink} href={d.url} target="_blank" rel="noopener noreferrer"
        title={`Open ${isPage ? 'the page' : 'the document'} at ${DOC_SRC[d.source] || d.source}`}>{d.title}</a>
      <span className={styles.pcMuted}>{[d.description && d.description !== d.title && d.description, d.date && day(d.date),
        d.permitVersion && `permit version ${d.permitVersion}${d.permitStatus ? ` (${d.permitStatus.toLowerCase()})` : ''}`,
        d.size && mb(d.size), isPage && 'web page'].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>{' '}
      {ext(rec(d.record_id), DOC_SRC[d.source] || d.source, `Listed by ${DOC_SRC[d.source] || d.source}${d.type ? ` under “${d.type}”` : ''} — click for the listing as EarthAtlas read it`)}
    </div>
  )
}

const permitHref = (p) => `/ships/permit/${encodeURIComponent(p.permit_key)}?s=${encodeURIComponent(p.epa_system)}`

/** One permit. The whole block opens the permit page in a new tab (Josh 2026-10-06); its own source links still work. */
function Permit({ p, frsUrl }) {
  const open = () => window.open(permitHref(p), '_blank', 'noopener')
  return (
    <div className={`${styles.incident} ${styles.permitRow}`} role="link" tabIndex={0}
      title={`${SYSTEM_TITLE[p.epa_system] || p.epa_system}. Click to open the permit page (new tab): documents, enforcement, related SEPA reviews`}
      onClick={(e) => { if (!e.target.closest('a')) open() }}
      onKeyDown={(e) => { if (e.key === 'Enter' && !e.target.closest('a')) open() }}>
      <div className={styles.incidentHead}>
        <span className={styles.incidentTitle}>{p.waAir?.label || p.permit_key}</span>
        <span className={styles.period} title={p.program_status ? statusTitle(p) : undefined}>{p.program_status ? statusShort(p) : ''}</span>
      </div>
      <div className={styles.incidentMeta}>
        {p.waAir ? <>
          {[p.waAir.holder, p.universe, p.waAir.issued && `issued ${day(p.waAir.issued)}`, p.waAir.registration && `registration ${p.waAir.registration}`,
            p.waAir.source_class && `class ${p.waAir.source_class}`].filter(Boolean).join(' · ')}{' '}
          {ext(p.waAir.page_url || p.waAir.main_url, AIR_AGENCY[p.epa_system] || p.epa_system, `${SYSTEM_TITLE[p.epa_system]}. Opens the agency’s ${p.waAir.page_url ? 'page for it' : 'document'}`)}
          {' '}{ext(rec(p.source_record_id), 'stored', 'The agency’s document as EarthAtlas read it (text and file hash)')}</> : <>
        {[p.name, p.mv ? p.mv.authorizes : p.universe, p.bcEma ? p.areas && `waste type: ${p.areas.toLowerCase()}` : p.areas && areaText(p.areas),
          (p.bcEma?.issued || p.mv?.issued) && `issued ${day(p.bcEma?.issued || p.mv.issued)}`, p.mv?.amended && `amended ${day(p.mv.amended)}`,
          p.expires && `expires ${day(p.expires)}`].filter(Boolean).join(' · ')}{' '}
        {p.mv ? <>
          {ext(p.mv.doc_url || p.mv.application_url, 'Metro Vancouver', `${SYSTEM_TITLE['MV-AQ']}. Opens ${p.mv.doc_url ? 'the document' : 'the application page'} at Metro Vancouver`)}
          {' '}{ext(rec(p.source_record_id), 'stored', 'The document as EarthAtlas read it (text and file hash)')}</>
          : p.bcEma ? <>
          {ext(rec(p.source_record_id), 'BC EMA register', `${SYSTEM_TITLE['BC-EMA']}. Click for the register row as EarthAtlas read it`)}
          {' '}{ext(BC_REGISTER, 'BC Data Catalogue', 'The register on the BC Data Catalogue')}</>
          : p.frs_ids.length ? <>
          {ext(rec(p.source_record_id), 'EPA ECHO', `${SYSTEM_TITLE[p.epa_system] || p.epa_system}. Listed in EPA ECHO's Detailed Facility Report for FRS ${p.frs_ids.join(', ')} — click for the stored report`)}
          {' '}{ext(frsUrl, 'ECHO page', 'Open the facility in EPA ECHO')}</>
          : ext(rec(p.source_record_id), 'WA Ecology PARIS', 'A Washington State permit listed on the facility’s PARIS page (EPA does not track it) — click for the listing')}</>}
      </div>
      {p.coversTerminal && (
        <div className={styles.coverNote}>
          <span className={styles.coverBadge}>covers this dock</span>{' '}“{p.coversTerminal.says}”{' '}
          <a className={`${styles.sourceLink} ${styles.srcLink}`} href={p.coversTerminal.doc_url} target="_blank" rel="noopener noreferrer"
            title={`${p.coversTerminal.doc_title || 'The permit document'}, ${p.coversTerminal.where} — opens the document`}>{p.coversTerminal.where}</a>
        </div>
      )}
      {p.paris?.current && (p.paris.current.issued || p.paris.current.effective) && (
        <div className={styles.incidentMeta}>WA Ecology: version {p.paris.current.version}{p.paris.current.issued ? `, issued ${day(p.paris.current.issued)}` : ''}
          {p.paris.current.effective ? `, effective ${day(p.paris.current.effective)}` : ''}{p.paris.current.expires ? `, expires ${day(p.paris.current.expires)}` : ''}</div>
      )}
      {p.mv?.address && <div className={styles.incidentMeta}>{p.mv.address}</div>}
      {p.waAir && <div className={styles.incidentMeta}>{[p.waAir.address, p.waAir.what].filter(Boolean).join(' · ')}</div>}
      {p.waAir?.status_note && <div className={styles.incidentMeta}>{p.waAir.status_note}</div>}
      {p.mv?.application && <div className={styles.incidentMeta}>Application {p.mv.application.gva} ({String(p.mv.application.status || '').toLowerCase()}): {p.mv.application.purpose}{' '}
        {ext(p.mv.application_url, 'application page', 'Metro Vancouver’s page for this application')}</div>}
      {p.bcEma?.address && <div className={styles.incidentMeta}>{p.bcEma.address}{p.bcEma.facility_type ? ` · ${((t) => t.length > 90 ? `${t.slice(0, 90)}…` : t)(oncePhrase(p.bcEma.facility_type))}` : ''}</div>}
      <div className={styles.permitOpen}>
        {p.sepa && ((s) => <span className={`${styles.sepaTag} ${p.sepa.status === 'linked' ? styles.sepaTagLinked : ''}`}
          title={`${s.long}. The permit page shows the evidence for each review, what the permit’s own documents say, and what was searched`}>{s.short}</span>)(sepaIndicator(p.sepa))}
        {p.documents?.length ? `${fmtN(p.documents.length)} document${p.documents.length === 1 ? '' : 's'} · ` : ''}Open permit ↗</div>
    </div>
  )
}

function Enforcement({ frs }) {
  // A formal action's ECHO case (same program id, same date) gives the agency's own case / penalty number and a case report link.
  const caseOf = (f, x) => (x.kind === 'formal' ? (f.cases || []).find((c) => c.permit_key === x.permit_key && c.date === x.date) : null)
  const rows = frs.flatMap((f) => [...f.enforcement.formal, ...f.enforcement.notices].map((x) => ({ ...x, frs: f, case: caseOf(f, x) })))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  const win = frs.find((f) => f.primary)?.enforcement.windows
  const span = [...(win?.formal || []), ...(win?.notices || [])]
  const from = span.map((w) => w.from).filter(Boolean).sort()[0], to = span.map((w) => w.to).filter(Boolean).sort().pop()
  return <>
    <div className={styles.sectionHead}>Enforcement {from && to ? `(${day(from)} – ${day(to)}, as EPA ECHO shows it)` : ''}</div>
    {!rows.length && <div className={styles.legendNoteText}>No enforcement action or notice in ECHO's window.</div>}
    {rows.map((x, i) => (
      <div key={`${x.frs.id}:${x.kind}:${x.date}:${i}`} className={styles.legendNoteText}>
        <strong>{day(x.date)}</strong> · {x.type} ({x.statute}, {agencyWords(x)})
        {x.kind === 'formal' && x.penalty && x.penalty !== '$0' ? <> · penalty <strong>{x.penalty}</strong></> : ''}
        {x.permit_key ? <span className={styles.pcMuted}> · {x.permit_key}</span> : ''}{' '}
        {x.case && <>{ext(x.case.url, `case ${String(x.case.name || x.case.id).replace(/\s+CP$/, '')}`, `EPA ECHO case report ${x.case.id}${x.case.name ? ` (the agency’s number: ${x.case.name})` : ''}: status, penalty and settlement`)}{' '}</>}
        {ext(rec(x.frs.record_id), 'EPA ECHO', `${x.kind === 'formal' ? 'Formal enforcement action' : 'Informal action (notice)'} in EPA ECHO's Detailed Facility Report for FRS ${x.frs.id} — click for the stored report`)}
      </div>
    ))}
  </>
}

/** BC: NRCED compliance and enforcement records (inspections, orders, penalties) issued to the facility's company. */
function NrcedList({ rows }) {
  return <>
    <div className={styles.sectionHead}>Inspections and enforcement ({fmtN(rows.length)} in BC NRCED)</div>
    {!rows.length && <div className={styles.legendNoteText}>No NRCED record was found for this facility.</div>}
    {rows.map((x) => (
      <div key={x.id} className={styles.legendNoteText}>
        <strong>{day(x.date)}</strong> · {x.kind}{x.trigger ? ` (${x.trigger.toLowerCase()})` : ''}
        {x.outcome && <> · <span title={`NRCED lists the result as “${x.outcome}”`}>{nrcedResult(x.outcome)}</span></>}
        {x.why.authorization ? <span className={styles.pcMuted}> · authorization {x.why.authorization}</span> : ''}
        {x.agency ? <span className={styles.pcMuted}> · {x.agency}</span> : ''}{' '}
        {x.documents.map((d, i) => <span key={d.url}>{ext(d.url, x.documents.length > 1 ? `file ${i + 1}` : 'file', `${d.title}: the agency’s file`)}{' '}</span>)}
        {ext(rec(x.record_id), 'BC NRCED', `Record ${x.id} in BC’s Natural Resource Compliance and Enforcement Database — click for the record as EarthAtlas read it. Shown because it is issued to the company and ${x.why.authorization ? `names authorization ${x.why.authorization}` : `its location names “${x.why.place_word}”`}`)}
      </div>
    ))}
  </>
}

/** Canada Energy Regulator records (lib/ships/cer.js): orders, inspections and meetings with their findings, incidents,
 *  contamination, O&M activities and the conditions about the marine terminal. Each row links CER's dataset and the stored record. */
const lc = (s) => String(s || '').toLowerCase()
const sentence = (s) => { const t = lc(s); return t ? t[0].toUpperCase() + t.slice(1) : '' }
const TOOL_PLURAL = { 'Notice of non-compliance': 'notices of non-compliance', 'Information request': 'information requests',
  'Assurance of voluntary compliance': 'assurances of voluntary compliance', 'Inspection officer order': 'inspection officer orders', 'Audit finding': 'audit findings' }
const toolsText = (t) => Object.entries(t).map(([k, n]) => `${fmtN(n)} ${n === 1 ? lc(k) : TOOL_PLURAL[k] || lc(k)}`).join(', ')
function CerSection({ c }) {
  const ds = (k, label = 'CER open data') => ext(c.datasets[k].url, label, `${c.datasets[k].title}, on open.canada.ca (Open Government Licence – Canada)`)
  const stored = (id, what) => ext(rec(id), 'stored', `${what} as EarthAtlas read it`)
  const findingsN = c.inspections.reduce((s, x) => s + x.findings.length, 0)
  return <>
    <div className={styles.sectionHead}>Canada Energy Regulator</div>
    {c.orders.map((o) => (
      <div key={o.id} className={styles.incident}>
        <div className={styles.incidentHead}>
          <span className={styles.incidentTitle}>Inspection officer order {o.id}</span>
          <span className={styles.period}>{day(o.date)}</span>
        </div>
        <div className={styles.incidentMeta}>{o.about}{o.cva ? ` · from inspection ${o.cva}` : ''}</div>
        <div className={styles.legendNoteText}>“{o.says}” {ext(o.url, 'order', 'The order on the Canada Energy Regulator’s site')}{' '}
          {o.related.map((x) => <span key={x.url}>{ext(x.url, lc(x.title.split(' (')[0]).replace(/^notice: /, ''), x.title)}{' '}</span>)}
          {stored(o.record_id, 'The order page')}</div>
      </div>
    ))}
    <Fold title={`Inspections and meetings (${fmtN(c.inspections.length)}; ${fmtN(findingsN)} findings)`}>
      {c.inspections.map((x) => {
        const head = <>
          <strong>{day(x.start)}</strong> · {sentence(x.type)}{x.disciplines ? ` (${lc(x.disciplines).trim()})` : ''} · {x.findings.length ? toolsText(x.tools) : 'no findings recorded for Westridge'}
          <span className={styles.pcMuted}> · {x.id} · {x.status}</span>{' '}
          {ds('cva')}{' '}{stored(x.record_id, `Compliance activity ${x.id} with its findings`)}
          {x.instruments.filter((i) => i.url).map((i) => <span key={i.number}>{' '}{ext(i.url, i.number, `Regulatory instrument ${i.number} in the CER’s REGDOCS`)}</span>)}
        </>
        return x.findings.length
          ? <div key={x.id} className={styles.legendNoteText}>{head}
            <Fold title={`The ${fmtN(x.findings.length)} finding${x.findings.length === 1 ? '' : 's'}`}>
            {x.findings.map((g, i) => (
              <div key={i} className={styles.pcMuted}>· {day(g.date)} · {g.tool}: {[g.category, g.sub].filter(Boolean).join(' – ')}
                {g.repeated ? ' · repeated' : ''}{g.closed ? ` · closed ${day(g.closed)}` : g.due ? ` · due ${day(g.due)}` : ''}{g.source ? ` · ${g.source}` : ''}
                {' '}{ds('nc', 'CER non-compliances')}</div>
            ))}
            </Fold></div>
          : <div key={x.id} className={styles.legendNoteText}>{head}</div>
      })}
    </Fold>
    <Fold title={`Incidents (${fmtN(c.incidents.length)})`}>
      {c.incidents.map((x) => (
        <div key={x.id} className={styles.legendNoteText}>
          <strong>{day(x.date)}</strong> · {x.type}{x.what ? ` · what happened: ${lc(x.what)}` : ''}{x.why ? ` · why: ${lc(x.why)}` : ''}
          <span className={styles.pcMuted}> · {x.id}{x.status ? ` · ${lc(x.status)}${x.closed ? ` ${day(x.closed)}` : ''}` : ''}</span>{' '}
          {ds('incident')}{' '}{stored(x.record_id, `Incident ${x.id}`)}
        </div>
      ))}
    </Fold>
    {c.contamination.map((x) => (
      <div key={x.id} className={styles.legendNoteText}>
        <strong>Contamination notice {x.id}</strong>{x.submitted ? ` (${day(x.submitted)})` : ''}: {x.description}{x.contaminants ? ` · ${x.contaminants}` : ''}
        {x.status ? <span className={styles.pcMuted}> · site status: {lc(x.status)}</span> : ''}{' '}{ds('contamination')}{' '}{stored(x.record_id, `Notice ${x.id}`)}
      </div>
    ))}
    {c.om.length > 0 && <Fold title={`Operations and maintenance notices (${fmtN(c.om.length)})`}>
      {c.om.map((x) => (
        <div key={x.id} className={styles.legendNoteText}>
          <strong>{day(x.start)}</strong>{x.end ? ` – ${day(x.end)}` : ''} · {x.circumstances.join('; ')}
          <span className={styles.pcMuted}> · {x.id}</span>{' '}{ds('om')}{' '}{stored(x.record_id, `Activity ${x.id}`)}
        </div>
      ))}
    </Fold>}
    {c.conditions.length > 0 && <Fold title={`Conditions about the marine terminal (${fmtN(c.conditions.length)})`}>
      {c.conditions.map((x) => (
        <div key={x.id} className={styles.legendNoteText}>
          <strong>{x.title || `Condition ${x.number}`}</strong>
          <span className={styles.pcMuted}> · {x.instrument} condition {x.number} · {lc(x.status)}{x.phase ? ` · ${lc(x.phase)}` : ''}</span>
          {x.quote && <div className={styles.pcMuted}>“{x.quote}”</div>}
          {ds('condition')}{' '}{x.regdocs && <>{ext(x.regdocs, x.instrument, `Instrument ${x.instrument} in the CER’s REGDOCS`)}{' '}</>}{stored(x.record_id, `Condition ${x.id}`)}
        </div>
      ))}
    </Fold>}
  </>
}

/** BC: Environmental Assessment Office projects that name this facility. */
function EaoList({ rows, none, searches }) {
  return <>
    <div className={styles.sectionHead}>Environmental assessments ({fmtN(rows.length)} in the BC Environmental Assessment Office’s records)</div>
    {!rows.length && <div className={styles.capNote}>{none || 'No BC Environmental Assessment Office project was found for this facility.'} Federal reviews are not checked here.</div>}
    {rows.map((r) => (
      <div key={r.id} className={styles.incident}>
        <div className={styles.incidentHead}>
          <span className={styles.incidentTitle}>{r.name}</span>
          <span className={styles.period} title={`EAO decision: ${r.decision}`}>{r.decision}</span>
        </div>
        <div className={styles.incidentMeta}>
          {[r.decisionDate && `decided ${day(r.decisionDate)}`, r.proponent && `proponent ${r.proponent}`, r.act, r.phase && `now: ${r.phase}`,
            r.federal && r.federal !== 'None' && `federal involvement: ${r.federal}`].filter(Boolean).join(' · ')}{' '}
          {ext(r.url, 'EAO project page', 'Open the project on the BC Environmental Assessment Office’s EPIC site')}
          {r.federalUrl && <>{' '}{ext(r.federalUrl, 'federal registry', 'The federal Impact Assessment registry page the EAO record links to')}</>}
          {' '}{ext(rec(r.record_id), 'stored', `The project as EarthAtlas read it. Linked because: ${r.why}${searches ? `. Searches: ${searches.join(', ')}` : ''}`)}
        </div>
        {r.description && <div className={styles.legendNoteText}>{r.description}</div>}
      </div>
    ))}
  </>
}

function SepaRow({ r }) {
  const what = r.proposalName || (r.description ? `${r.description.slice(0, 140)}${r.description.length > 140 ? '…' : ''}` : 'no description')
  return (
    <div className={styles.incident}>
      <div className={styles.incidentHead}>
        <span className={styles.incidentTitle}>{what}</span>
        <span className={styles.period} title={sepaTitle(r.type)}>{r.type}</span>
      </div>
      <div className={styles.incidentMeta}>
        {day(r.issued)} · lead agency {r.lead}{r.fileNumber ? ` (file ${r.fileNumber})` : ''} · applicant {r.applicant}{' '}
        {ext(r.url, `SEPA ${r.sepa}`, `${sepaTitle(r.type)}. Open the record in Washington Ecology's SEPA Register${r.documents.length ? ` (${plural(r.documents.length, 'document')})` : ''}`)}
        {' '}{ext(rec(r.record_id), 'stored', `The record as EarthAtlas read it. Linked because the applicant names “${r.why.applicant_word}”, the county is ${r.why.county}, and the text names “${r.why.place_word}”`)}
      </div>
      {r.documents.map((d) => (
        <div key={d.id} className={styles.legendNoteText}>
          <a className={styles.pcPlainLink} href={d.url} target="_blank" rel="noopener noreferrer" title="Open the document in the SEPA Register">{d.name}</a>
          {d.size && <span className={styles.pcMuted}> · {d.size}</span>}
        </div>
      ))}
    </div>
  )
}

/** WA local clean air agencies: what was searched for this dock and found nothing (or a note), with the searched sources. */
function AirSearches({ rows }) {
  const notes = rows.filter((r) => r.none)
  if (!notes.length) return null
  return notes.map((r) => (
    <div key={r.agency} className={styles.capNote}>
      {r.none}{' '}
      <span className={styles.pcMuted}>Searched:</span>{' '}
      {r.searched.map((x) => <span key={x.url}>{ext(x.url, x.short || x.title, `${x.title}, searched ${day(x.date)}`)}{' '}</span>)}
      {ext(rec(r.recordId), 'stored', 'What EarthAtlas searched, when, and what it found, as stored')}
    </div>
  ))
}

function Facility({ f, onLocate, airSearches = [] }) {
  const prim = f.frs.find((x) => x.primary)
  const isBc = f.country === 'CA'
  // Permits whose own text names this dock come first in each group.
  const byCover = (ps) => [...ps].sort((a, b) => (b.coversTerminal ? 1 : 0) - (a.coversTerminal ? 1 : 0))
  const groups = STATUTE_ORDER.map((s) => [s, byCover(f.permits.filter((p) => p.statute === s))]).filter(([, ps]) => ps.length)
  const other = f.permits.filter((p) => !STATUTE_ORDER.includes(p.statute))
  const recent = f.sepa.slice(0, 8), older = f.sepa.slice(8)
  return (
    <div className={styles.section}>
      <div className={styles.portSummary}>
        {f.relation === 'owned_by'
          ? <>This dock is owned and run by <strong>{f.name}</strong>{f.relationSource && <>{' '}{ext(f.relationSource, 'source', f.relationSays || 'The page that states it')}</>}.
            {' '}These are that company’s own permits.{' '}</>
          : isBc
            ? <>This dock is part of <strong>{f.name}</strong>. These are the site’s BC authorizations and compliance records.{' '}</>
          : f.kind === 'refinery'
            ? <>This dock serves <strong>{f.name}</strong>. These permits are held by the refinery, not issued to the dock;
              {' '}one marked <span className={styles.coverBadge}>covers this dock</span> names the dock in its own text.{' '}</>
            : <>This dock is part of <strong>{f.name}</strong>. These permits are the site’s;
              {' '}one marked <span className={styles.coverBadge}>covers this dock</span> names the dock in its own text.{' '}</>}
        {ext(rec(f.entryRecordId), 'EarthAtlas list', isBc
          ? 'EarthAtlas’s hand-checked facility entry: which BC authorizations and records are this site, and why — click for the record'
          : 'EarthAtlas’s hand-checked facility entry: which EPA records are this site, and why — click for the record')}
        {prim && <> · EPA facility {prim.id} {ext(prim.url, 'ECHO page', 'Open the facility in EPA ECHO')}</>}
        {onLocate && Number.isFinite(f.lat) && <>{' · '}<button type="button" className={styles.locateLink} onClick={() => onLocate([[f.lon, f.lat]])}
          title={isBc ? `Zoom the map to the dock and ${f.name} (the point its main BC authorization lists)` : `Zoom the map to the dock and ${f.name} (EPA’s point for facility ${prim?.id ?? ''})`}>Show {f.kind === 'refinery' ? 'refinery' : 'site'} and dock on map</button></>}
      </div>

      <div className={styles.sectionHead}>Permits and program records held by {f.name} ({fmtN(f.permits.length)})</div>
      {isBc && !f.permits.some((p) => p.epa_system === 'BC-EMA') && <div className={styles.capNote}>{f.bc?.emaNone || 'No BC waste discharge authorization was matched to this facility.'}</div>}
      {isBc && !f.permits.some((p) => p.epa_system === 'MV-AQ') && (f.bc?.mvNone || f.bc?.mvOutside) && <div className={styles.capNote}>{f.bc.mvNone || f.bc.mvOutside}</div>}
      {groups.map(([s, ps]) => (
        <Fold key={s} title={`${s === 'WA air' ? `Air permits from the ${[...new Set(ps.map((p) => AIR_AGENCY[p.epa_system]))].join(' and ')}` : STATUTE[s] || s} (${fmtN(ps.length)})`}
          open={s === 'CWA' || s === 'CAA' || s === 'WA air' || s === 'BC EMA' || s === 'MV AQ'}>
          {ps.map((p) => <Permit key={`${p.epa_system}:${p.permit_key}`} p={p} frsUrl={prim?.url} />)}
        </Fold>
      ))}
      {!isBc && <AirSearches rows={airSearches} />}
      {other.length > 0 && <Fold title={`Other (${fmtN(other.length)})`}>{other.map((p) => <Permit key={`${p.epa_system}:${p.permit_key}`} p={p} frsUrl={prim?.url} />)}</Fold>}

      {isBc ? <NrcedList rows={f.bc?.nrced || []} /> : <Enforcement frs={f.frs} />}
      {isBc && f.cer && <CerSection c={f.cer} />}

      {f.documents?.length > 0 && <>
        <div className={styles.sectionHead}>Other documents and pages about this facility</div>
        {f.documents.map((d) => <Doc key={d.id} d={d} />)}
      </>}

      {isBc ? <EaoList rows={f.bc?.eao || []} none={f.bc?.eaoNone} searches={f.bc?.eaoSearches} /> : <>
        <div className={styles.sectionHead}>SEPA environmental reviews ({fmtN(f.sepa.length)} in the WA SEPA Register)</div>
        {!f.sepa.length && <div className={styles.capNote}>No SEPA Register record found for this facility. The Register starts in 2000 and some actions are exempt from SEPA, so this is not proof that no review happened.</div>}
        {recent.map((r) => <SepaRow key={r.sepa} r={r} />)}
        {older.length > 0 && <Fold title={`Older reviews (${fmtN(older.length)}, back to ${day(older[older.length - 1].issued)})`}>{older.map((r) => <SepaRow key={r.sepa} r={r} />)}</Fold>}
      </>}

      {isBc ? <Fold title="About this data">
        <div className={styles.legendNoteText}>
          <strong>BC authorizations.</strong> From the BC Ministry of Environment and Parks’ register of waste discharge authorizations under the
          Environmental Management Act (permits, approvals and registrations under its regulations). EarthAtlas checked by hand which register
          entries are this site, by their listed location near the dock and the company’s name:
          {f.permits.filter((p) => p.bcEma?.why).map((p) => <div key={p.permit_key} className={styles.pcMuted}>· {p.permit_key}: {p.bcEma.why}</div>)}
          {f.permits.some((p) => p.mv) && <>Metro Vancouver air quality permits, found through Metro Vancouver’s published permits and permit applications and checked by hand
            (holder and address):{f.permits.filter((p) => p.mv?.why).map((p) => <div key={p.permit_key} className={styles.pcMuted}>· {p.permit_key}: {p.mv.why}</div>)}</>}
          Work on port land is permitted by the port authority; those permits are not included yet.
        </div>
        <div className={styles.legendNoteText}>
          <strong>Inspections and enforcement.</strong> From BC’s Natural Resource Compliance and Enforcement Database (NRCED). A record is shown when it
          is issued to the company and names one of the authorizations above or the place.
          {f.bc?.nrcedCandidates > 0 && ` ${plural(f.bc.nrcedCandidates, 'other record')} issued to the company don’t name the site and are not shown.`}
          {' '}Federal records (for example the Canada Energy Regulator’s) are not included.
        </div>
      </Fold> : <Fold title="About this data">
        <div className={styles.legendNoteText}>
          <strong>EPA records.</strong> EPA’s Facility Registry gives one id per site and lists every program record under it. EarthAtlas
          also links {plural(f.frs.length - 1, 'other EPA facility id')} that are the same site (projects, old names), each with its reason:
          {f.frs.filter((x) => !x.primary).map((x) => <div key={x.id} className={styles.pcMuted}>· {x.id}: {x.why} {ext(x.url, 'ECHO page', 'Open in EPA ECHO')}</div>)}
          Program records include reporting ids (greenhouse gas, toxics, risk plans) as well as permits. An expiry date in the past does not
          mean the site runs without a permit: usually a renewal is pending and the old permit stays in force (EPA).
          {f.airAgency && <>{' '}Air permits here are issued by the {ext(f.airAgency.url, f.airAgency.name, `${f.airAgency.name} website`)}.</>}
        </div>
        <div className={styles.legendNoteText}>
          <strong>SEPA reviews.</strong> Records come from searches of Washington Ecology’s SEPA Register by the refinery’s applicant names and
          place. One is shown only when the county matches, the applicant names the company, and the record names the site.
          {f.sepaCandidates > 0 && ` ${plural(f.sepaCandidates, 'other record')} found by the same searches don’t pass that test and are not shown.`}
          {' '}Each permit’s own page says which of these reviews cover that permit, and why (the review names the permit, the
          permit’s fact sheet or air permit names the review or the approval it reviewed, or both name the same project), or what the
          permit’s fact sheet says about SEPA (for example that a renewal is exempt). The Register holds records from 2000 on.
        </div>
      </Fold>}
    </div>
  )
}

/** A terminal checked for permits with no facility found: what was searched, and why nearby records were left out. */
function NoneFound({ n }) {
  return (
    <div className={styles.section}>
      <div className={styles.capNote}>{n.says}{' '}{ext(rec(n.record_id), 'EarthAtlas list', 'EarthAtlas’s hand-checked note for this terminal: what was searched and why each nearby record was left out — click for the record')}</div>
      <div className={styles.sectionHead}>What was searched{n.checked ? ` (${day(n.checked)})` : ''}</div>
      {n.searched.map((x, i) => <div key={i} className={styles.legendNoteText}>· {x.url ? ext(x.url, x.what, 'Open the search or page') : x.what}{x.found ? <span className={styles.pcMuted}> — {x.found}</span> : ''}</div>)}
      {n.leftOut.length > 0 && <Fold title={`Nearby records left out (${fmtN(n.leftOut.length)})`}>
        {n.leftOut.map((x) => <div key={x.id} className={styles.legendNoteText}>{x.name ? <strong>{x.name}</strong> : x.id}{' '}
          {/^\d{12}$/.test(x.id) && ext(`https://echo.epa.gov/detailed-facility-report?fid=${x.id}`, 'ECHO page', 'Open the facility in EPA ECHO')}
          <span className={styles.pcMuted}> · {x.why}</span></div>)}
      </Fold>}
      {n.airAgency && <div className={styles.legendNoteText}>Air permits here are issued by the {ext(n.airAgency.url, n.airAgency.name, `${n.airAgency.name} website`)}.</div>}
    </div>
  )
}

/** Fetches op=terminalPermits; returns { state: 'loading' | 'none' | 'ok' | 'error', data }. */
export function useTerminalPermits(terminalKey) {
  const [st, setSt] = useState({ key: null, state: 'loading', data: null })
  useEffect(() => {
    const ctl = new AbortController()
    setSt({ key: terminalKey, state: 'loading', data: null })
    fetch(`/api/ships?op=terminalPermits&key=${encodeURIComponent(terminalKey)}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setSt({ key: terminalKey, state: d.facilities?.length || d.land?.length || d.none ? 'ok' : 'none', data: d }))
      .catch((e) => { if (e.name !== 'AbortError') setSt({ key: terminalKey, state: 'error', data: null }) })
    return () => ctl.abort()
  }, [terminalKey])
  return st.key === terminalKey ? st : { state: 'loading', data: null }
}

export default function TerminalPermits({ permits, onLocate }) {
  if (permits.state === 'loading') return <Loading kind="quick" className={styles.loadingNote} />
  if (permits.state === 'error') return <div className={styles.errorNote}>Permits didn’t load.</div>
  const d = permits.data
  return <>
    <LandRecords land={d.land} />
    {d.none && <NoneFound n={d.none} />}
    {d.facilities.map((f, i) => <Facility key={f.key} f={f} onLocate={onLocate} airSearches={i === 0 ? d.airSearches || [] : []} />)}
    <div className={styles.attribution}>
      {(d.sources || []).map((x, i) => (
        <span key={x.id}>{i > 0 && ' · '}
          <a className={styles.sourceLink} href={x.attribution_url || x.homepage_url || '#'} target="_blank" rel="noopener noreferrer" title={x.name}>{x.attribution_text}</a>
          {x.license_url && publicLicense(x) && publicLicense(x) !== x.attribution_text && <> <a className={styles.sourceLink} href={x.license_url} target="_blank" rel="noopener noreferrer">{publicLicense(x)}</a></>}
        </span>
      ))}
    </div>
  </>
}
