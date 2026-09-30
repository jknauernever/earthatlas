/**
 * Ship card → "Emissions" tab (Josh, 2026-09-27). Climate TRACE's modelled emissions for this ship's voyages and
 * port stays, from our Salish Sea pull of its `shipping_voyages` table (2024–2025 start dates; baked by
 * scripts/ships/bake-ct-voyages, served by api/ship-tracks op=voyages). Climate TRACE files a ship under an MMSI
 * or an IMO; we ask for each identifier the ship has. MMSIs get reused, so an MMSI's voyages count only inside
 * the window this ship held it (as the ship's own tracks do). Every number is Climate TRACE's own.
 * Who tracked the ship for Climate TRACE (OceanMind or Global Fishing Watch) and the ship's deadweight / modelled CO₂ per
 * nautical mile come from the same rows (lib/ships/ctVoyages.js: trackerOf, shipFacts; Josh 2026-09-29).
 * Above them, in its own block: the ship's VERIFIED EU MRV reports (ShipMrv.jsx; Phase 4, Josh 2026-09-29). The two are never mixed.
 */
import { useEffect, useMemo, useState } from 'react'
import { MonthBars } from './PortCard.jsx'
import { MEASURE_INFO, tonnesWord, TRACE_URL } from '../systems/traceData.js'
import { Loading } from '../components/panel'
import { trackerOf, shipFacts } from '../../lib/ships/ctVoyages.js'
import trackSource from './trackSource.json'
import ShipMrv from './ShipMrv.jsx'
import styles from './ShipsApp.module.css'

const HUE = '#38bdf8'
const F = { kind: 0, start: 1, end: 2, from: 3, to: 4, fromIso: 5, toIso: 6, sector: 7, co2e: 8, co2e20: 9 }
const GASES = [['co2', 10], ['ch4', 11], ['n2o', 12], ['so2', 13], ['nox', 14], ['pm2_5', 15], ['co', 16]]
const t = (v) => (v == null ? 'not reported' : tonnesWord(v).replace(' tonnes', ' t'))
const day = (s) => String(s || '').slice(0, 10)
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const secs = (s) => Date.parse(`${String(s).replace(' ', 'T')}Z`) / 1000
const SLACK = 31 * 86400 // an MMSI window is when we SAW it; allow a month either side
const releaseWords = (r) => String(r || 'v5.10.0').replaceAll('_', '.')
const TRACKED_TITLE = {
  oceanmind: 'OceanMind is Climate TRACE’s shipping sector lead; it tracks the large ships that carry full identity information',
  gfw: 'Global Fishing Watch tracks the smaller ships for Climate TRACE, and those with little identity information or that don’t broadcast',
}

export default function ShipEmissions({ vessel }) {
  const ids = useMemo(() => {
    const imos = [...new Set(vessel.assertions.filter((a) => a.attribute === 'imo' && /^\d{7}$/.test(a.value_norm)).map((a) => a.value_norm))]
    const mmsis = new Map()
    for (const a of vessel.assertions) {
      if (a.attribute !== 'mmsi' || !/^\d{9}$/.test(a.value_norm)) continue
      const w = mmsis.get(a.value_norm) || []
      w.push({ from: a.from ? Date.parse(a.from) / 1000 : null, to: a.to ? Date.parse(a.to) / 1000 : null, known: a.period_kind !== 'unknown' })
      mmsis.set(a.value_norm, w)
    }
    return { imos, mmsis }
  }, [vessel])
  const [st, setSt] = useState({ state: 'loading' })
  useEffect(() => {
    let dead = false
    setSt({ state: 'loading' })
    // &v=: a new pack version is a new URL, so the edge cache never serves an older pack's answer.
    const get = (q) => fetch(`/api/ship-tracks?op=voyages&${q}&v=${trackSource.ctVoyages?.version || 'v1'}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    Promise.all([...ids.imos.map((i) => get(`imo=${i}`)), ...[...ids.mmsis.keys()].map((m) => get(`mmsi=${m}`))])
      .then((rs) => { if (!dead) setSt({ state: 'ok', assets: rs.filter((r) => r?.found) }) })
    return () => { dead = true }
  }, [ids])

  // Verified EU MRV reports first, then Climate TRACE's modelled estimates: two blocks, never one number (Josh 2026-09-29).
  const mrv = (co2ByYear = null) => <ShipMrv vessel={vessel} modelledCo2ByYear={co2ByYear} />
  const modelledHead = (
    <div className={styles.sectionHead} style={{ marginTop: 14 }}>
      Modelled: Climate TRACE estimates{' '}
      <span className={`${styles.ev} ${styles.evInf}`} title="Estimated by Climate TRACE with a computer model from the ship’s AIS track and characteristics; not reported or measured">estimate</span>
    </div>
  )
  if (st.state === 'loading') return <>{mrv()}{modelledHead}<Loading kind="quick" /></>

  // Keep MMSI-filed rows inside this ship's windows for that MMSI; drop exact duplicates across Climate TRACE assets.
  const rows = []
  const seen = new Set()
  for (const a of st.assets) {
    const wins = a.kind === 'mmsi' ? ids.mmsis.get(String(a.key)) || [] : null
    const known = wins?.filter((w) => w.known) || []
    for (const v of a.v) {
      if (known.length) {
        const s = secs(v[F.start])
        if (!known.some((w) => (w.from == null || s >= w.from - SLACK) && (w.to == null || s <= w.to + SLACK))) continue
      }
      const k = `${v[F.kind]}|${v[F.start]}|${v[F.from]}|${v[F.to]}`
      if (seen.has(k)) continue
      seen.add(k)
      rows.push({ v, asset: a })
    }
  }
  if (!rows.length) {
    return (<>{mrv()}{modelledHead}
      <div className={styles.legendNoteText}>
        No Climate TRACE voyage estimates for this ship in our Salish Sea set (voyages to or from Salish Sea ports that began in 2024–2025).
        {!ids.imos.length && !ids.mmsis.size && ' It has no IMO or MMSI to look up.'}
      </div>
    </>)
  }

  const sum = (list, i) => list.reduce((a, r) => a + (r.v[i] ?? 0), 0)
  const trips = rows.filter((r) => r.v[F.kind] === 't'), stays = rows.filter((r) => r.v[F.kind] === 's')
  const total = sum(rows, F.co2e)
  const months = [...new Set(rows.map((r) => r.v[F.start].slice(0, 7)))].sort()
  const allMonths = []
  for (let ym = months[0]; ym <= months[months.length - 1];) {
    allMonths.push(ym)
    const [y, m] = ym.split('-').map(Number)
    ym = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  }
  const perMonth = allMonths.map((ym) => {
    const r = rows.filter((x) => x.v[F.start].startsWith(ym))
    return { month: ym, n: r.length ? sum(r, F.co2e) : null }
  })
  const byYear = {}
  for (const r of rows) { const y = r.v[F.start].slice(0, 4); byYear[y] = (byYear[y] || 0) + (r.v[F.co2e] ?? 0) }
  // Modelled CO₂ (the CO₂ gas, not CO₂e) per calendar year, for the "small EU share" note only (euMrvFormat.smallEuShare).
  const co2ByYear = {}
  for (const r of rows) { const y = r.v[F.start].slice(0, 4); co2ByYear[y] = (co2ByYear[y] || 0) + (r.v[10] ?? 0) }
  const top = [...trips].sort((a, b) => (b.v[F.co2e] ?? 0) - (a.v[F.co2e] ?? 0)).slice(0, 8)
  const topStays = [...stays].sort((a, b) => (b.v[F.co2e] ?? 0) - (a.v[F.co2e] ?? 0)).slice(0, 4)
  const names = [...new Set(st.assets.map((a) => `${a.name || 'unnamed'} (${a.id})`))]
  const release = releaseWords(st.assets[0]?.release)
  // Who tracked the ship: the tracker of every Climate TRACE asset whose rows are shown here.
  const used = new Set(rows.map((r) => r.asset))
  const trackers = [...new Map([...used].map((a) => trackerOf(a.id)).filter(Boolean).map((x) => [x.id, x])).values()]
  // Per-ship facts (OceanMind-tracked ships carry them): one value per asset; shown only when the assets agree.
  const factsOf = [...used].map((a) => ({ a, f: shipFacts(a) }))
  const one = (k) => { const vs = [...new Set(factsOf.map((x) => x.f[k]).filter((v) => v != null))]; return vs.length === 1 ? vs[0] : null }
  const dwt = one('deadweight_t'), perNm = one('co2_kg_per_nm')
  const factAsset = factsOf.find((x) => x.f.deadweight_t != null || x.f.co2_kg_per_nm != null)?.a

  return (<>{mrv(co2ByYear)}
    <div className={styles.section}>
      {modelledHead}
      <div className={styles.portSummary}>
        About <strong>{t(total)} CO₂e</strong> from {trips.length.toLocaleString()} trip{trips.length === 1 ? '' : 's'} and{' '}
        {stays.length.toLocaleString()} port stay{stays.length === 1 ? '' : 's'} that began {monthName(months[0])} – {monthName(months[months.length - 1])}
        {Object.keys(byYear).length > 1 && <> ({Object.entries(byYear).map(([y, v], i) => <span key={y}>{i > 0 && ', '}{y}: {t(v)}</span>)})</>}{' '}
        <a className={`${styles.sourceLink} ${styles.srcLink}`} href={TRACE_URL} target="_blank" rel="noopener noreferrer"
          title={`Climate TRACE shipping voyages (release ${release}), CC BY 4.0: modelled estimates`}>Climate TRACE</a>
        {trackers.map((x) => (
          <span key={x.id} className={styles.pcMuted}> · tracked by{' '}
            <a className={`${styles.sourceLink} ${styles.srcLink}`} href={x.url} target="_blank" rel="noopener noreferrer"
              title={`${TRACKED_TITLE[x.id]} (Climate TRACE files it as ${[...used].filter((a) => trackerOf(a.id)?.id === x.id).map((a) => a.id).join(', ')})`}>
              {x.name}</a>
          </span>
        ))}
      </div>
      {(dwt != null || perNm != null) && (
        <div className={styles.pcGasList}>
          {dwt != null && (
            <div className={styles.pcGasRow} title="The ship’s deadweight (how much it can carry: cargo, fuel, stores and crew), in tonnes, as recorded in Climate TRACE’s voyage data">
              <span>Deadweight (Climate TRACE)</span>
              <span>{Math.round(dwt).toLocaleString('en-US')} t{' '}
                <a className={`${styles.sourceLink} ${styles.srcLink}`} href={TRACE_URL} target="_blank" rel="noopener noreferrer"
                  title={`Climate TRACE shipping voyages (release ${release}), ${factAsset?.id}: deadweight in tonnes, CC BY 4.0`}>Climate TRACE</a></span>
            </div>
          )}
          {perNm != null && (
            <div className={styles.pcGasRow} title="Climate TRACE’s model estimate of the CO₂ this ship emits for each nautical mile it sails (kilograms of CO₂ per nautical mile). A model figure, not a measurement">
              <span>CO₂ per nautical mile at sea (Climate TRACE model)</span>
              <span>about {Math.round(perNm).toLocaleString('en-US')} kg{' '}
                <a className={`${styles.sourceLink} ${styles.srcLink}`} href={TRACE_URL} target="_blank" rel="noopener noreferrer"
                  title={`Climate TRACE shipping voyages (release ${release}), ${factAsset?.id}: CO₂ emissions factor from its model, kg per nautical mile, CC BY 4.0`}>Climate TRACE</a></span>
            </div>
          )}
        </div>
      )}
      <MonthBars months={perMonth} month={null} onMonth={() => {}} hue={HUE} say={(n) => `${t(n)} CO₂e`} listed={false}
        label="This ship’s emissions per month (tonnes CO₂e, by the month each trip or stay began)" />

      <div className={styles.pcGasList}>
        {GASES.map(([g, i]) => { const v = sum(rows, i); return v > 0 && (
          <div key={g} className={styles.pcGasRow} title={MEASURE_INFO[g]?.hint}><span>{MEASURE_INFO[g]?.label || g}</span><span>{t(v)}</span></div>
        ) })}
      </div>

      {top.length > 0 && <>
        <div className={styles.sectionHead} style={{ marginTop: 10 }}>Biggest trips</div>
        {top.map(({ v }, i) => (
          <div key={i} className={styles.pcGasRow}>
            <span>{v[F.from] || '?'} → {v[F.to] || '?'} <span className={styles.pcMuted}>· {day(v[F.start])}{v[F.sector] === 'i' ? ' · international' : ''}</span></span>
            <span>{t(v[F.co2e])}</span>
          </div>
        ))}
      </>}
      {topStays.length > 0 && <>
        <div className={styles.sectionHead} style={{ marginTop: 10 }}>Biggest port stays</div>
        {topStays.map(({ v }, i) => (
          <div key={i} className={styles.pcGasRow}>
            <span>{v[F.from] || '?'} <span className={styles.pcMuted}>· {day(v[F.start])} → {day(v[F.end])}</span></span>
            <span>{t(v[F.co2e])}</span>
          </div>
        ))}
      </>}

      <div className={styles.legendNoteText} style={{ marginTop: 10 }}>
        Climate TRACE models each trip and port stay from the ship’s AIS track and its characteristics: estimates, not measurements.
        Port stays count fuel burned while at a port (engines and boilers). Our copy covers trips and stays that began in 2024–2025 and
        touched the Salish Sea; the whole trip counts, even when it started far away. Filed by Climate TRACE as {names.join('; ')}.
        {' '}Climate TRACE’s ships are tracked by two partners: <a className={styles.sourceLink} href="https://www.oceanmind.global" target="_blank" rel="noopener noreferrer">OceanMind</a>,
        its shipping lead, for large ships with full identity information, and Global Fishing Watch for smaller ships, ships with little identity
        information and ships that don’t broadcast.
        {perNm != null && ' The CO₂ per nautical mile is Climate TRACE’s model figure for this ship under way; a trip’s own figure depends on its speed and conditions.'}
      </div>
      <div className={styles.legendNoteText}>
        <a className={styles.sourceLink} href={TRACE_URL} target="_blank" rel="noopener noreferrer">Climate TRACE Emissions Inventory {release}</a> (shipping voyages), CC BY 4.0.
        {trackers.some((x) => x.id === 'gfw') && <> Ship tracking: <a className={styles.sourceLink} href="https://globalfishingwatch.org" target="_blank" rel="noopener noreferrer">Powered by Global Fishing Watch</a>.</>}
      </div>
    </div>
  </>)
}
