/**
 * The Permits tab's dock section: state-owned aquatic land under the dock (WA DNR leases, harbor-area leases, port management
 * agreements) and county shoreline permits for work at the dock. Data: api op=terminalPermits → land (lib/ships/dnrLeases.js,
 * lib/ships/countyShoreline.js). Every value links its source; "stored" opens the record as EarthAtlas read it.
 */
import styles from './ShipsApp.module.css'

const longDay = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : null)
const rec = (id) => `/ships/source/${id}`
const ext = (href, label, title) => <a className={`${styles.sourceLink} ${styles.srcLink}`} href={href} target="_blank" rel="noopener noreferrer" title={title}>{label}</a>
const acres = (n) => (Number.isFinite(n) && n > 0 ? `${n >= 10 ? Math.round(n) : n.toFixed(1)} acres mapped` : null)
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bOf\b/g, 'of')

function Lease({ r }) {
  const status = r.status === 'Y' ? `in force since ${longDay(r.effective)}`
    : r.status === 'EX' ? `started ${longDay(r.effective)}; DNR lists it as extended or in holdover (past its term, continuing)`
      : r.statusWords
  return (
    <div className={styles.incident}>
      <div className={styles.incidentHead}>
        <span className={styles.incidentTitle}>{r.typeName || 'Use authorization'} {r.lease}</span>
        <span className={styles.period} title={`DNR status code ${r.status}`}>{r.status === 'Y' ? 'active' : r.status === 'EX' ? 'holdover' : r.statusWords}</span>
      </div>
      <div className={styles.incidentMeta}>
        {[`lessee ${r.lessee}`, status, acres(r.acres), 'end date not published by DNR'].filter(Boolean).join(' · ')}{' '}
        {ext(r.url, 'WA DNR', `DNR's public record for ${r.lease} (${r.layerName}) — opens DNR's map service`)}
        {' '}{ext(rec(r.record_id), 'stored', `The DNR record as EarthAtlas read it. Linked because: ${r.why}`)}
      </div>
      {r.others?.length > 0 && <div className={styles.legendNoteText}>{r.others.map((o) => `Also listed by DNR as ${o.statusWords}${o.effective ? ` (${longDay(o.effective)})` : ''}.`).join(' ')}</div>}
    </div>
  )
}

function Pma({ r }) {
  const port = titleCase(r.port)
  return (
    <div className={styles.incident}>
      <div className={styles.incidentHead}>
        <span className={styles.incidentTitle}>Managed by {port} for the state</span>
        <span className={styles.period} title="Port management agreement with WA DNR">port management agreement</span>
      </div>
      <div className={styles.incidentMeta}>
        {r.metres === 0 ? 'The berth is inside' : `The berth is ${r.metres} m outside the edge of`} the state-owned aquatic land {port} manages under
        {' '}agreement {r.lease} with the Washington Department of Natural Resources{r.effective ? ` (since ${longDay(r.effective)})` : ''}.
        {' '}Leases on this land are issued by the port, not by DNR.{' '}
        {ext(r.url, 'WA DNR', `DNR's public record for ${r.lease} — opens DNR's map service`)}
        {' '}{ext(rec(r.record_id), 'stored', `DNR's mapped area as EarthAtlas read it. Linked because: ${r.why}`)}
      </div>
    </div>
  )
}

function Shoreline({ r }) {
  const last = r.sepa?.[r.sepa.length - 1]
  return (
    <div className={styles.incident}>
      <div className={styles.incidentHead}>
        <span className={styles.incidentTitle}>{r.project}</span>
        <span className={styles.period} title={r.type}>{r.file}</span>
      </div>
      <div className={styles.incidentMeta}>
        {[r.type, `${r.county} County`, r.submitted && `applied ${longDay(r.submitted)}`, r.noticeDate && `notice of application ${longDay(r.noticeDate)}`,
          last && `SEPA: ${last.type} ${longDay(last.issued)}`, r.decision ? `decision: ${r.decision}` : 'permit decision not published online'].filter(Boolean).join(' · ')}{' '}
        {ext(r.noticeUrl, 'county notice', `${r.county} County's notice of application, as filed in Ecology's SEPA Register. It says: “${r.says}”`)}
        {(r.sepa || []).map((x) => <span key={x.sepa}>{' '}{ext(x.url, `SEPA ${x.sepa}`, `${x.type}, ${longDay(x.issued)}, lead agency ${x.lead} (files ${x.fileNumber}) — opens the SEPA Register`)}</span>)}
        {' '}{ext(rec(r.record_id), 'stored', `The notice as EarthAtlas read it. Linked because: ${r.why}`)}
      </div>
    </div>
  )
}

export default function LandRecords({ land }) {
  if (!land?.length) return null
  const dnr = land.filter((r) => r.kind === 'dnr_use_authorization'), pma = land.filter((r) => r.kind === 'dnr_port_management')
  const shore = land.filter((r) => r.kind === 'county_shoreline_permit')
  return (
    <div className={styles.section}>
      {(dnr.length > 0 || pma.length > 0) && <>
        <div className={styles.sectionHead}>State aquatic land under the dock (WA DNR)</div>
        {dnr.map((r) => <Lease key={r.key} r={r} />)}
        {pma.map((r) => <Pma key={r.key} r={r} />)}
      </>}
      {shore.length > 0 && <>
        <div className={styles.sectionHead}>Shoreline permits for work at the dock ({shore[0].county} County)</div>
        {shore.map((r) => <Shoreline key={r.key} r={r} />)}
      </>}
    </div>
  )
}
