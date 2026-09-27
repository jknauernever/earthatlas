/**
 * Port card → "Ship emissions" (Josh, 2026-09-27). Climate TRACE's estimate of the emissions of the ships that call
 * at this port, for the months picked on the map. Which Climate TRACE port sources belong to this port comes from
 * api/ships op=portEmissions (lib/ships/climateTrace.js); the monthly numbers come live from the same Climate TRACE
 * release /inmotion shows (src/systems/traceData.js), so the card follows each new release.
 * Caveats are Climate TRACE's own (docs/CLIMATETRACE_FACTS.md): voyage emissions split half to the departure and
 * half to the arrival port, not port operations; one approximate point per port complex; modelled estimates.
 */
import { useEffect, useState } from 'react'
import { loadTraceIndex, loadTraceDetail, traceMixFacts, MEASURE_INFO, tonnesWord, TRACE_URL } from '../systems/traceData.js'
import { MonthBars } from './PortCard.jsx'
import { Loading } from '../components/panel'
import styles from './ShipsApp.module.css'

const HUE = '#38bdf8' // /inmotion's "Airports & ports" colour
const SUB = { 'domestic-shipping': 'domestic voyages', 'international-shipping': 'international voyages' }
const GASES = ['co2', 'ch4', 'n2o', 'pm2_5', 'so2', 'nox', 'co']
const t = (v) => (v == null ? 'not reported' : tonnesWord(v).replace(' tonnes', ' t'))
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })

export default function PortEmissions({ portId, months, month, onMonth }) {
  const [st, setSt] = useState({ state: 'loading' })
  useEffect(() => {
    let dead = false
    setSt({ state: 'loading' })
    ;(async () => {
      const r = await fetch(`/api/ships?op=portEmissions&id=${encodeURIComponent(portId)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      if (!j.joined?.length) return { state: 'none', nearby: j.nearby }
      const index = await loadTraceIndex()
      const recs = await Promise.all(j.joined.map((c) => loadTraceDetail(c.id, index.shards)
        .then((d) => ({ ct: c, rec: d || null })))) // already decoded by loadTraceDetail
      return { state: 'ok', release: index.release, lastMonth: index.months[index.months.length - 1], sources: recs }
    })().then((v) => { if (!dead) setSt(v) }).catch((e) => { if (!dead) setSt({ state: 'error', error: e.message }) })
    return () => { dead = true }
  }, [portId])

  if (st.state === 'loading') return <div className={styles.section}><div className={styles.sectionHead}>Ship emissions · Climate TRACE</div><Loading kind="quick" /></div>
  if (st.state === 'error') return null
  if (st.state === 'none') {
    return <div className={styles.legendNoteText}>Climate TRACE has no port estimate within 10 km of this port.</div>
  }

  // Per month, summed over this port's Climate TRACE sources (domestic + international, each terminal).
  const facts = (rec, ym) => (rec ? traceMixFacts(rec, ym) : {})
  const perMonth = months.map((ym) => {
    const vals = st.sources.map((s) => facts(s.rec, ym).co2e_100yr).filter((v) => v != null)
    return { month: ym, n: vals.length ? vals.reduce((a, b) => a + b, 0) : null }
  })
  const reported = perMonth.filter((m) => m.n != null)
  const total = reported.reduce((a, m) => a + m.n, 0)
  const bySub = {}
  const gas = {}
  for (const s of st.sources) {
    for (const ym of months) {
      const f = facts(s.rec, ym)
      if (f.co2e_100yr != null) bySub[s.ct.sub] = (bySub[s.ct.sub] || 0) + f.co2e_100yr
      for (const g of GASES) if (f[g] != null) gas[g] = (gas[g] || 0) + f[g]
    }
  }
  const range = `${monthName(months[0])} – ${monthName(months[months.length - 1])}`
  const beyond = months[months.length - 1] > st.lastMonth

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>Ship emissions · {range}</div>
      {reported.length ? <>
        <div className={styles.portSummary}>
          About <strong>{t(total)} CO₂e</strong> from ships’ voyages to and from here
          {Object.keys(bySub).length > 1 && <> ({Object.entries(bySub).map(([k, v], i) => <span key={k}>{i > 0 && ', '}{t(v)} {SUB[k] || k}</span>)})</>}
          {' '}<a className={`${styles.sourceLink} ${styles.srcLink}`} href={TRACE_URL} target="_blank" rel="noopener noreferrer"
            title={`Climate TRACE Emissions Inventory ${st.release}, CC BY 4.0: modelled estimates`}>Climate TRACE</a>
        </div>
        <MonthBars months={perMonth} month={month} onMonth={onMonth} hue={HUE} say={(n) => `${t(n)} CO₂e`}
          label="Ship emissions per month (tonnes CO₂e)" listed={false} />
        {Object.keys(gas).length > 0 && (
          <div className={styles.pcGasList}>
            {GASES.filter((g) => gas[g] != null).map((g) => (
              <div key={g} className={styles.pcGasRow} title={MEASURE_INFO[g].hint}>
                <span>{MEASURE_INFO[g].label}</span><span>{t(gas[g])}</span>
              </div>
            ))}
          </div>
        )}
      </> : <div className={styles.legendNoteText}>Climate TRACE has no estimate for these months{beyond ? ` (its latest month is ${monthName(st.lastMonth)})` : ''}.</div>}
      <div className={styles.legendNoteText}>
        Climate TRACE’s port estimate{st.sources.length > 1 ? 's' : ''}:{' '}
        {st.sources.map((s, i) => (
          <span key={s.ct.id}>{i > 0 && '; '}
            <a className={styles.sourceLink} href={`/ships/source/${s.ct.record_id}`} target="_blank" rel="noopener noreferrer"
              title={`Climate TRACE source ${s.ct.id}, ${s.ct.km} km from this port — click for the record`}>“{s.ct.name}”, {SUB[s.ct.sub] || s.ct.sub}</a>
            {s.ct.km >= 1 && <> ({s.ct.km} km)</>}
          </span>
        ))}.
      </div>
      <div className={styles.legendNoteText}>
        Modelled from ships’ AIS tracks. Each voyage’s emissions are split half to the port it left and half to the port it reached, so this
        is <strong>ships at sea, not the port’s own operations</strong>. Climate TRACE places one approximate point per port complex.
        {beyond && <> Latest month available: {monthName(st.lastMonth)}.</>}{' '}
        <a className={styles.sourceLink} href={TRACE_URL} target="_blank" rel="noopener noreferrer">Climate TRACE Emissions Inventory {st.release}</a>, CC BY 4.0.
      </div>
    </div>
  )
}
