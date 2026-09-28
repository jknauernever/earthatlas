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
const REFINERY_HUE = '#f43f5e' // the Oil & gas facilities (Climate TRACE fossil-fuel) colour on the /ships map
const SUB = { 'domestic-shipping': 'domestic voyages', 'international-shipping': 'international voyages' }
const GASES = ['co2', 'ch4', 'n2o', 'pm2_5', 'so2', 'nox', 'co']
const t = (v) => (v == null ? 'not reported' : tonnesWord(v).replace(' tonnes', ' t'))
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })

/**
 * The port's Climate TRACE numbers for `months`, loaded once and shared by the summary strip (total) and the
 * Emissions tab. Returns { state: 'loading' | 'none' | 'error' | 'ok', total, bySub, perMonth, gas, sources, … }.
 */
// `url` (optional): another endpoint answering in op=portEmissions' shape, e.g. a terminal's Climate TRACE ids
// (api op=terminalEmissions); the monthly figures are read the same way for any Climate TRACE source.
export function usePortEmissions(portId, months, url = null) {
  const [st, setSt] = useState({ state: 'loading' })
  useEffect(() => {
    let dead = false
    setSt({ state: 'loading' })
    ;(async () => {
      const r = await fetch(url || `/api/ships?op=portEmissions&id=${encodeURIComponent(portId)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      if (!j.joined?.length) return { state: 'none', nearby: j.nearby }
      const index = await loadTraceIndex()
      const sources = await Promise.all(j.joined.map((c) => loadTraceDetail(c.id, index.shards)
        .then((d) => ({ ct: c, rec: d || null })))) // already decoded by loadTraceDetail
      return { state: 'ok', release: index.release, lastMonth: index.months[index.months.length - 1], sources }
    })().then((v) => { if (!dead) setSt(v) }).catch((e) => { if (!dead) setSt({ state: 'error', error: e.message }) })
    return () => { dead = true }
  }, [portId, url])
  if (st.state !== 'ok') return st
  // Per month, summed over this port's Climate TRACE sources (domestic + international, each terminal).
  const facts = (rec, ym) => (rec ? traceMixFacts(rec, ym) : {})
  const perMonth = months.map((ym) => {
    const vals = st.sources.map((s) => facts(s.rec, ym).co2e_100yr).filter((v) => v != null)
    return { month: ym, n: vals.length ? vals.reduce((a, b) => a + b, 0) : null }
  })
  const reported = perMonth.filter((m) => m.n != null)
  const bySub = {}, gas = {}
  for (const s of st.sources) {
    for (const ym of months) {
      const f = facts(s.rec, ym)
      if (f.co2e_100yr != null) bySub[s.ct.sub] = (bySub[s.ct.sub] || 0) + f.co2e_100yr
      for (const g of GASES) if (f[g] != null) gas[g] = (gas[g] || 0) + f[g]
    }
  }
  return { ...st, perMonth, reported: reported.length, total: reported.reduce((a, m) => a + m.n, 0), bySub, gas,
    beyond: months[months.length - 1] > st.lastMonth }
}

/** Short tonnes for the summary strip ("2.0 Mt", "456 kt", "380 t"). */
export function shortTonnes(v) {
  if (v == null) return '—'
  return v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)} Mt` : v >= 1e3 ? `${Math.round(v / 1e3)} kt` : `${Math.round(v)} t`
}

/**
 * The Emissions tab body, from usePortEmissions(). what = 'ships' (voyage emissions attributed to a port, the default) or
 * 'refinery' (a refinery plant's own emissions: the terminal card). `noneText` replaces the "no estimate" line.
 */
export default function PortEmissions({ em, months, month, onMonth, About, what = 'ships', noneText = null, title = null }) {
  if (em.state === 'loading') return <Loading kind="quick" />
  if (em.state === 'error') return <div className={styles.legendNoteText}>Couldn’t load Climate TRACE’s estimate right now.</div>
  if (em.state === 'none') return <div className={styles.legendNoteText}>{title && <strong>{title}: </strong>}{noneText || 'Climate TRACE has no port estimate within 10 km of this port.'}</div>
  const refinery = what === 'refinery'
  const range = `${monthName(months[0])} – ${monthName(months[months.length - 1])}`
  return (
    <div className={styles.section}>
      {title && <div className={styles.sectionHead}>{title}</div>}
      {em.reported ? <>
        <div className={styles.portSummary}>
          About <strong>{t(em.total)} CO₂e</strong> {refinery ? 'from the refinery plant itself' : 'from ships’ voyages to and from here'}, {range}
          {Object.keys(em.bySub).length > 1 && <> ({Object.entries(em.bySub).map(([k, v], i) => <span key={k}>{i > 0 && ', '}{t(v)} {SUB[k] || k}</span>)})</>}{' '}
          <a className={`${styles.sourceLink} ${styles.srcLink}`} href={TRACE_URL} target="_blank" rel="noopener noreferrer"
            title={`Climate TRACE Emissions Inventory ${em.release}, CC BY 4.0: modelled estimates`}>Climate TRACE</a>
        </div>
        <MonthBars months={em.perMonth} month={month} onMonth={onMonth} hue={refinery ? REFINERY_HUE : HUE} say={(n) => `${t(n)} CO₂e`} listed={false}
          label={refinery ? 'Refinery emissions per month (tonnes CO₂e)' : 'Ship emissions per month (tonnes CO₂e)'} />
        {Object.keys(em.gas).length > 0 && (
          <div className={styles.pcGasList}>
            {GASES.filter((g) => em.gas[g] != null).map((g) => (
              <div key={g} className={styles.pcGasRow} title={MEASURE_INFO[g].hint}>
                <span>{MEASURE_INFO[g].label}</span><span>{t(em.gas[g])}</span>
              </div>
            ))}
          </div>
        )}
      </> : <div className={styles.legendNoteText}>Climate TRACE has no estimate for these months{em.beyond ? ` (its latest month is ${monthName(em.lastMonth)})` : ''}.</div>}
      {refinery ? <About>
        Climate TRACE’s estimate for the <strong>refinery plant</strong> (its own operations, not ships). The plant point is Climate TRACE’s,
        often 1.5–4.5 km from the marine terminal; EarthAtlas links the two by hand. Climate TRACE rates its confidence in refinery
        estimates as very low, and the “owner” it names is a top shareholder, not the operator.{' '}
        {em.sources.map((s, i) => (
          <span key={s.ct.id}>{i > 0 && '; '}
            <a className={styles.sourceLink} href={`/ships/source/${s.ct.record_id}`} target="_blank" rel="noopener noreferrer"
              title={`Climate TRACE source ${s.ct.id} — click for the record`}>“{s.ct.name}”</a>{s.ct.km != null && <> ({s.ct.km} km from the terminal)</>}
          </span>
        ))}.{em.beyond && <> Latest month available: {monthName(em.lastMonth)}.</>}{' '}
        <a className={styles.sourceLink} href={TRACE_URL} target="_blank" rel="noopener noreferrer">Climate TRACE Emissions Inventory {em.release}</a>, CC BY 4.0.
      </About> : <About>
        Climate TRACE models each voyage from ships’ AIS tracks and splits its emissions half to the port it left and half to the port it
        reached, so this is <strong>ships at sea, not the port’s own operations</strong>. It places one approximate point per port complex;
        this port uses {em.sources.length > 1 ? 'these estimates' : 'this estimate'}:{' '}
        {em.sources.map((s, i) => (
          <span key={s.ct.id}>{i > 0 && '; '}
            <a className={styles.sourceLink} href={`/ships/source/${s.ct.record_id}`} target="_blank" rel="noopener noreferrer"
              title={`Climate TRACE source ${s.ct.id}, ${s.ct.km} km from this port — click for the record`}>“{s.ct.name}”, {SUB[s.ct.sub] || s.ct.sub}</a>
            {s.ct.km >= 1 && <> ({s.ct.km} km)</>}
          </span>
        ))}.
        {em.beyond && <> Latest month available: {monthName(em.lastMonth)}.</>}{' '}
        <a className={styles.sourceLink} href={TRACE_URL} target="_blank" rel="noopener noreferrer">Climate TRACE Emissions Inventory {em.release}</a>, CC BY 4.0.
      </About>}
    </div>
  )
}
