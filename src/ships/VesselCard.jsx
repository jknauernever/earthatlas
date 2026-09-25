/**
 * The ship card that hangs under the Ships pill: identity over time,
 * ownership, characteristics and unmerged possible matches. Every value
 * carries its evidence class (AIS / Registry / Model) and a link to the exact
 * raw source record (EarthAtlas inline-provenance rule).
 */
import { useEffect, useMemo, useState } from 'react'
import styles from './ShipsApp.module.css'
import pick from './ShipPicker.module.css'

// How each evidence class is labelled, so "AIS reported this" never reads as "a registry confirms this".
export const EVIDENCE = {
  ais_self_reported: { label: 'AIS', cls: 'evAis', title: 'What the ship itself broadcast over AIS (self-reported, unverified)' },
  registry: { label: 'Registry', cls: 'evReg', title: 'A vessel registry record, as processed by Global Fishing Watch' },
  inferred: { label: 'Model', cls: 'evInf', title: 'Global Fishing Watch classification (machine-learning models + registries)' },
  derived_identity: { label: 'Matched', cls: 'evInf', title: 'Identity match made by a third party' },
  unverified: { label: 'Unverified', cls: 'evInf', title: 'Unverified third-party information' },
}

const IDENTITY_ROWS = [
  ['name', 'Name'], ['imo', 'IMO number'], ['mmsi', 'MMSI'], ['callsign', 'Call sign'], ['flag', 'Flag'],
]
const ROLE_ROWS = [
  ['registry_owner', 'Owner (as listed by a registry)'], ['registered_owner', 'Registered owner'],
  ['beneficial_owner', 'Beneficial owner'], ['operator', 'Operator'], ['ship_manager', 'Ship manager'],
  ['technical_manager', 'Technical manager'], ['commercial_manager', 'Commercial manager'],
  ['ism_manager', 'ISM manager'], ['bareboat_charterer', 'Bareboat charterer'],
]
const CHAR_ROWS = [['vessel_type', 'Vessel type'], ['gear_type', 'Gear type'], ['length_m', 'Length'], ['tonnage_gt', 'Gross tonnage'], ['authorization', 'Public authorizations']]

const day = (iso) => (iso ? String(iso).slice(0, 10) : null)
function fmtValue(attr, v) {
  if (attr === 'length_m') return `${v} m`
  if (attr === 'tonnage_gt') return `${Number(v).toLocaleString()} GT`
  if (attr === 'vessel_type' || attr === 'gear_type') return String(v).replaceAll('_', ' ').toLowerCase()
  return v
}
function fmtPeriod(a) {
  if (a.period_kind === 'unknown') return 'dates unknown'
  // Year-granular sources (GFW classifications) are shown as years, never as invented days.
  if (a.detail?.granularity === 'year') {
    const f = a.from && String(a.from).slice(0, 4), t = a.to && String(a.to).slice(0, 4)
    return f === t ? `in ${f}` : `${f || '?'}–${t || '?'}`
  }
  const f = day(a.from), t = day(a.to)
  const verb = a.period_kind === 'observed' ? 'seen ' : ''
  if (f && t) return f === t ? `${verb}${f}` : `${verb}${f} → ${t}`
  if (f) return `${a.period_kind === 'observed' ? 'seen from' : 'from'} ${f}`
  return `until ${t}`
}
function sourceTitle(a, sourcesById) {
  const src = sourcesById[a.source_id]
  const regs = a.detail?.registries?.length ? ` · registries: ${a.detail.registries.join(', ')}` : ''
  const basis = a.detail?.period_basis ? ` · dates = ${a.detail.period_basis}` : ''
  return `${src?.name || a.source_id}${regs}${basis} · ${src?.license || ''} — click for the raw source record`
}

/** Collapse identical claims (same value, evidence and dates) that several sub-records repeat. */
function rowsFor(assertions, attr) {
  const seen = new Map()
  for (const a of assertions.filter((x) => x.attribute === attr)) {
    const k = [a.value_norm, a.evidence_class, day(a.from), day(a.to), a.period_kind].join('|')
    if (!seen.has(k)) seen.set(k, a)
  }
  return [...seen.values()].sort((x, y) => String(x.from || '').localeCompare(String(y.from || '')))
}


export function Ev({ c }) {
  const e = EVIDENCE[c] || EVIDENCE.unverified
  return <span className={`${styles.ev} ${styles[e.cls]}`} title={e.title}>{e.label}</span>
}

export default function VesselCard({ vesselId, onClose, onSelectVessel, onLoaded }) {
  const [vessel, setVessel] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const ctl = new AbortController()
    setVessel(null); setError(null)
    fetch(`/api/ships?op=vessel&id=${encodeURIComponent(vesselId)}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'Vessel not found' : `Load failed (${r.status})`))))
      .then((v) => { setVessel(v); onLoaded?.(v) })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message) })
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vesselId])

  const sourcesById = useMemo(() => Object.fromEntries((vessel?.sources || []).map((s) => [s.id, s])), [vessel])
  const current = useMemo(() => currentIdentity(vessel), [vessel])

  // Both directions: another vessel's record may match this one, or this one's record may match another.
  const candidates = vessel
    ? [...vessel.links.filter((l) => l.status === 'candidate'), ...vessel.outgoing]
        .filter((c) => c.other_vessel && c.other_vessel !== vessel.vessel.id)
        .filter((c, i, all) => all.findIndex((x) => x.other_vessel === c.other_vessel && x.method === c.method) === i)
    : []

  const Src = ({ a }) => (
    <a className={`${styles.sourceLink} ${styles.srcLink}`} href={`/api/ships?op=record&id=${a.last_source_record_id}`} target="_blank" rel="noopener noreferrer"
      title={sourceTitle(a, sourcesById)}>GFW</a>
  )

  const renderSection = (rows, title) => {
    const present = rows.filter(([attr]) => vessel.assertions.some((a) => a.attribute === attr))
    if (!present.length) return null
    return (
      <div className={styles.section}>
        <div className={styles.sectionHead}>{title}</div>
        {present.map(([attr, label]) => (
          <div key={attr} className={styles.attrBlock}>
            <div className={styles.attrLabel}>{label}</div>
            {rowsFor(vessel.assertions, attr).map((a) => (
              <div key={a.id} className={styles.valRow}>
                <span className={styles.val}>{fmtValue(attr, a.value_raw)}{attr === 'imo' && a.detail?.checksum_ok === false ? <span className={styles.warn} title="Fails the IMO check digit — likely a typo in the source"> ⚠︎</span> : null}</span>
                <span className={styles.period}>{fmtPeriod(a)}</span>
                <Ev c={a.evidence_class} />
                <Src a={a} />
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={pick.card} role="dialog" aria-label="Ship card">
      <button type="button" className={pick.close} onClick={onClose} aria-label="Close ship card">×</button>
      {error && <div className={styles.errorNote}>{error}</div>}
      {!vessel && !error && <div className={styles.loadingNote}>Loading ship…</div>}
      {vessel && (
        <>
          <div className={styles.vesselHead}>
            <div className={styles.vesselName}>{current.name?.value_raw || 'Unnamed vessel'}</div>
            <div className={styles.vesselSub}>
              {current.imo && <>IMO {current.imo.value_raw} · </>}{current.flag && <>{current.flag.value_raw} · </>}
              {current.mmsi && <>MMSI {current.mmsi.value_raw}</>}
            </div>
            {vessel.vessel.needs_review && (
              <div className={styles.review} title="EarthAtlas found evidence that conflicts with this identity. It did not merge anything automatically.">
                Identity needs review: see the conflicting evidence below.
              </div>
            )}
            <div className={styles.idNote} title="EarthAtlas's own id for this vessel. IMO and MMSI can change or be wrong; this id doesn't.">
              EarthAtlas vessel {vessel.vessel.id.slice(0, 8)}
            </div>
          </div>

          {renderSection(IDENTITY_ROWS, 'Identity over time')}
          {renderSection(ROLE_ROWS, 'Ownership & management')}
          {renderSection(CHAR_ROWS, 'Characteristics')}

          {candidates.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionHead}>Possible matches, not merged</div>
              {candidates.map((c, i) => (
                <div key={i} className={styles.candRow}>
                  {c.method === 'MMSI_TEMPORAL' ? `Shares MMSI ${c.evidence?.mmsi} during overlapping dates` : `Shares IMO ${c.evidence?.imo} (${c.evidence?.basis === 'registry' ? 'registry' : 'AIS-reported'})`}
                  {' '}with <button className={styles.inlineLink} onClick={() => onSelectVessel(c.other_vessel)}>another vessel ({c.other_vessel.slice(0, 8)})</button>
                </div>
              ))}
              <div className={styles.legendNoteText}>EarthAtlas keeps these separate until the evidence is strong enough. MMSIs get reused and mistyped, so a shared MMSI alone never merges two ships.</div>
            </div>
          )}
          <div className={styles.attribution}>
            Vessel identity: <a className={styles.sourceLink} href="https://globalfishingwatch.org" target="_blank" rel="noopener noreferrer">Powered by Global Fishing Watch.</a>{' '}
            <a className={styles.sourceLink} href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener noreferrer">CC BY-NC 4.0</a>
          </div>
        </>
      )}
    </div>
  )
}

/** Latest name/flag/MMSI and the registry IMO, for headers and the pill. */
export function currentIdentity(vessel) {
  if (!vessel) return {}
  const latest = (attr) => rowsFor(vessel.assertions, attr).sort((x, y) => String(y.to || '9999').localeCompare(String(x.to || '9999')))[0]
  return { name: latest('name'), flag: latest('flag'), mmsi: latest('mmsi'),
    imo: rowsFor(vessel.assertions, 'imo').find((a) => a.evidence_class === 'registry') || latest('imo') }
}
