/**
 * /ships/source/<id>: one source record, readable (Josh, 2026-09-27: the raw JSON behind "source" links was
 * "not useful for anyone"). Who published it and under what licence, when we retrieved it, what it said about
 * each ship, where to see it at the source, and, for anyone who wants it, the data exactly as received.
 */
import { Fragment, useEffect, useState } from 'react'
import { publicLicense } from './publicLicense.js'
import { useParams } from 'react-router-dom'
import { Ev } from './VesselCard.jsx'
import { Loading } from '../components/panel'
import styles from './SourceRecordPage.module.css'

// Plain names for the attributes a record can give (the card's row labels).
const ATTR = {
  name: 'Name', imo: 'IMO number', mmsi: 'MMSI', callsign: 'Call sign', flag: 'Flag', vessel_type: 'Kind of ship',
  gear_type: 'Fishing gear', length_m: 'Length', width_m: 'Width', draft_m: 'Draft', tonnage_gt: 'Gross tonnage',
  builder: 'Builder', service_entry: 'Entered service', port_of_registry: 'Port of registry', transceiver: 'AIS transponder',
  registry_owner: 'Owner (as listed by a registry)', owner: 'Owner', registered_owner: 'Registered owner',
  beneficial_owner: 'Beneficial owner', operator: 'Operator', ship_manager: 'Ship manager', image: 'Photo',
  vessel_class: 'Ship class', max_capacity: 'Capacity (people)', certificate: 'Certificate',
  scrubber: 'Scrubber (EGCS), as notified to IMO', equivalent_compliance: 'MARPOL Annex VI Reg. 4.2 equivalent, as notified to IMO',
}
const ORDER = Object.keys(ATTR)
const label = (a) => ATTR[a] || (a.charAt(0).toUpperCase() + a.slice(1)).replaceAll('_', ' ')
// Identity facts first (the ATTR order), anything else after, each group in date order as returned.
const ordered = (cs) => [...cs].sort((x, y) => (ORDER.indexOf(x.attribute) + 1 || 999) - (ORDER.indexOf(y.attribute) + 1 || 999))
const day = (x) => (x ? String(x).slice(0, 10) : null)
const when = (c) => {
  if (c.period_kind === 'unknown' || (!c.from && !c.to)) return 'no date given'
  const a = day(c.from), b = day(c.to)
  return a && b ? (a === b ? a : `${a} → ${b}`) : a ? `from ${a}` : `until ${b}`
}

export default function SourceRecordPage() {
  const { id } = useParams()
  const [rec, setRec] = useState(null)
  const [error, setError] = useState(null)
  const [raw, setRaw] = useState(false)
  useEffect(() => {
    fetch(`/api/ships?op=recordView&id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'That record doesn’t exist.' : `Couldn’t load it (${r.status}).`))))
      .then(setRec).catch((e) => setError(e.message))
  }, [id])
  useEffect(() => { if (rec?.source) document.title = `Source record · ${rec.source.name} · EarthAtlas Ships` }, [rec])

  const s = rec?.source
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <a href="/ships" className={styles.brand}>EarthAtlas <span>Ships</span></a>
      </header>
      <main className={styles.main}>
        {error && <p className={styles.note}>{error}</p>}
        {!rec && !error && <Loading kind="quick" />}
        {rec && <>
          <div className={styles.kicker}>Source record</div>
          <h1 className={styles.title}>{rec.summary?.title || s?.name || rec.source?.id}</h1>
          {s?.publisher && <div className={styles.sub}>Published by {s.publisher}</div>}

          <section className={styles.facts}>
            {rec.summary?.sourceLink && (
              <a className={styles.primaryLink} href={rec.summary.sourceLink.href} target="_blank" rel="noopener noreferrer">{rec.summary.sourceLink.label} ↗</a>
            )}
            {!rec.summary && rec.links.map((l) => (
              <a key={l.href} className={styles.primaryLink} href={l.href} target="_blank" rel="noopener noreferrer">
                {l.home ? `Visit ${l.label}` : `See it at the source: ${l.label}`} ↗
              </a>
            ))}
            {!rec.summary && rec.identifiers.length > 0 && (
              <div className={styles.ids}>
                {!rec.links.some((l) => !l.home) && <span className={styles.idsHint}>To find it there, look up:</span>}
                {rec.identifiers.map((x) => <span key={`${x.label}${x.value}`} className={styles.idChip}>{x.label} <b>{x.value}</b></span>)}
              </div>
            )}
            <dl className={styles.meta}>
              <dt>Licence</dt>
              <dd>{publicLicense(s) ? (s?.license_url ? <a href={s.license_url} target="_blank" rel="noopener noreferrer">{publicLicense(s)}</a> : publicLicense(s)) : 'See the source'}</dd>
              {s?.attribution_text && <><dt>Credit</dt><dd>{s.attribution_url ? <a href={s.attribution_url} target="_blank" rel="noopener noreferrer">{s.attribution_text}</a> : s.attribution_text}</dd></>}
              <dt>Retrieved by EarthAtlas</dt>
              <dd>{day(rec.first_retrieved_at)}{day(rec.last_retrieved_at) !== day(rec.first_retrieved_at) && `, last checked ${day(rec.last_retrieved_at)}`}</dd>
              {rec.dataset_version && <><dt>Dataset version</dt><dd>{rec.dataset_version}</dd></>}
            </dl>
          </section>

          {rec.summary && (
            <section className={styles.vessel}>
              <h2>What DNR’s record says</h2>
              <dl className={styles.meta}>
                {rec.summary.rows.map((r) => <Fragment key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></Fragment>)}
                {rec.summary.lat != null && rec.summary.lon != null && <><dt>Location</dt><dd>
                  <a href={`/ships?lat=${rec.summary.lat.toFixed(4)}&lng=${rec.summary.lon.toFixed(4)}&z=14`}>Show on the map</a>
                  {' '}({rec.summary.lat.toFixed(4)}, {rec.summary.lon.toFixed(4)}, DNR’s point for this {rec.summary.title.startsWith('Port') ? 'area' : 'lease'})</dd></>}
              </dl>
              <p className={styles.note}>{rec.summary.note}</p>
            </section>
          )}
          {rec.summary ? null : rec.vessels.length > 0 ? rec.vessels.map((v) => (
            <section key={v.id} className={styles.vessel}>
              <h2><a href={`/ships?v=${v.id}`}>{v.name || 'Unnamed vessel'}</a> <span>what this record says</span></h2>
              <table className={styles.table}>
                <tbody>
                  {ordered(v.claims).map((c, i) => (
                    <tr key={i}>
                      <th>{label(c.attribute)}</th>
                      <td>{c.value_raw}</td>
                      <td className={styles.when}>{when(c)}</td>
                      <td><Ev c={c.evidence_class} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )) : <p className={styles.note}>This record isn’t tied to a ship’s details (it may describe a port, an area or a visit).</p>}

          {rec.terminals?.length > 0 && (
            <section className={styles.vessel}>
              <h2>Terminal in EarthAtlas’s list <span>EarthAtlas’s match, not the source’s</span></h2>
              {rec.terminals.map((t) => (
                <p key={t.key} className={styles.note}>
                  {t.name}{t.role === 'imo_port_facility' && (t.position_agrees === false
                    ? ' · matched by name (hand-checked); this record’s position is not used, it lies ' + (t.km ?? '?') + ' km from the terminal'
                    : ` · matched by name and position (${t.km ?? '?'} km from the terminal’s berth)`)}
                </p>
              ))}
            </section>
          )}

          <section className={styles.rawBox}>
            <button type="button" className={styles.rawToggle} onClick={() => setRaw((r) => !r)} aria-expanded={raw}>
              {raw ? 'Hide' : 'Show'} the data exactly as {s?.publisher || 'the source'} sent it
            </button>
            {raw && <>
              <p className={styles.note}>Stored unchanged for auditing (checksum {rec.payload_sha256?.slice(0, 12)}…). Personal details are withheld.</p>
              <pre className={styles.raw}>{JSON.stringify(rec.payload, null, 2)}</pre>
            </>}
          </section>
        </>}
      </main>
    </div>
  )
}
