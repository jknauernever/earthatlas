/**
 * /permits/source/<key>: one data-service record behind a /permits source link, readable (Josh 2026-10-13: "the
 * source ↗ links are linking to non-human readable documents"). Same layout and CSS as /ships/source/<id>: who
 * published it and under what licence, when EarthAtlas read it, where to see it at the source, what it says, what the
 * map uses it for, and the data exactly as received. Data: records/<key>.json via permitsData.js (scripts/permits/bake-permits.mjs).
 */
import { Fragment, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loading } from '../components/panel'
import styles from '../ships/SourceRecordPage.module.css'
import { fetchPermitsJson, permitsBase } from './permitsData.js'

const day = (x) => (x ? String(x).slice(0, 10) : null)

export default function PermitsSourcePage() {
  const { key } = useParams()
  const [rec, setRec] = useState(null)
  const [error, setError] = useState(null)
  const [raw, setRaw] = useState(false)
  useEffect(() => {
    if (!/^[A-Za-z0-9_.-]+$/.test(key || '')) { setError('That record doesn’t exist.'); return }
    fetchPermitsJson(`records/${key}.json`).then(setRec).catch(() => setError('That record doesn’t exist, or couldn’t be loaded.'))
  }, [key])
  useEffect(() => { if (rec) document.title = `Source record · ${rec.title} · EarthAtlas PermitTracker` }, [rec])

  // Group the map's uses by record, in the order the bake found them.
  const uses = []
  for (const u of rec?.uses || []) {
    const last = uses[uses.length - 1]
    if (last && last.name === u.name && last.id === u.id) last.what.push(u.what)
    else uses.push({ id: u.id, name: u.name, what: [u.what] })
  }

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <a href="/permits" className={styles.brand}>EarthAtlas <span>PermitTracker</span></a>
      </header>
      <main className={styles.main}>
        {error && <p className={styles.note}>{error}</p>}
        {!rec && !error && <Loading kind="quick" />}
        {rec && <>
          <div className={styles.kicker}>Source record</div>
          <h1 className={styles.title}>{rec.title}</h1>
          <div className={styles.sub}>Published by {rec.publisher}</div>

          <section className={styles.facts}>
            {rec.url && <a className={styles.primaryLink} href={rec.url} target="_blank" rel="noopener noreferrer">See it at the source ↗</a>}
            {!rec.url && rec.home && <a className={styles.primaryLink} href={rec.home.href} target="_blank" rel="noopener noreferrer">Visit {rec.home.label} ↗</a>}
            {rec.copies?.map((c, i) => (
              <a key={c} className={styles.primaryLink} href={`${permitsBase()}/notices/${c}`} target="_blank" rel="noopener noreferrer">Archived copy of the notice{rec.copies.length > 1 ? ` ${i + 1}` : ''} (PDF) ↗</a>
            ))}
            {rec.look_up && (
              <div className={styles.ids}>
                {!rec.url && <span className={styles.idsHint}>To find it there, look up:</span>}
                <span className={styles.idChip}><b>{rec.look_up}</b></span>
              </div>
            )}
            <dl className={styles.meta}>
              <dt>License</dt>
              <dd>{rec.licence ? (rec.licence.href ? <a href={rec.licence.href} target="_blank" rel="noopener noreferrer">{rec.licence.text}</a> : rec.licence.text) : 'See the source'}</dd>
              <dt>Read on</dt>
              <dd>{day(rec.retrieved) || 'Not read yet'}</dd>
            </dl>
          </section>

          {rec.rows.length > 0 && (
            <section className={styles.vessel}>
              <h2>What the record says</h2>
              <dl className={styles.meta}>
                {rec.rows.map((r, i) => <Fragment key={i}><dt>{r.label}</dt><dd>{r.value}</dd></Fragment>)}
              </dl>
            </section>
          )}

          {uses.length > 0 && (
            <section className={styles.vessel}>
              <h2>Used on the map for</h2>
              <table className={styles.table}>
                <tbody>
                  {uses.map((u, i) => (
                    <tr key={i}>
                      <th>{u.id ? <a href={`/permits?r=${encodeURIComponent(u.id)}`} style={{ color: 'rgba(120, 200, 255, 0.95)' }}>{u.name}</a> : u.name}</th>
                      <td>{u.what.join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className={styles.rawBox}>
            <button type="button" className={styles.rawToggle} onClick={() => setRaw((r) => !r)} aria-expanded={raw}>
              {raw ? 'Hide' : 'Show'} the data exactly as {rec.sender || rec.publisher} sent it
            </button>
            {raw && <>
              <p className={styles.note}>Stored unchanged{rec.api ? <> from <span style={{ wordBreak: 'break-all' }}>{rec.api}</span></> : null}.</p>
              <pre className={styles.raw}>{JSON.stringify(rec.payload, null, 2)}</pre>
            </>}
          </section>
        </>}
      </main>
    </div>
  )
}
