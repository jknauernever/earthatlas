/**
 * /risks/reports/land-value: the land in the path of sea-level rise in San Juan County (Josh 2026-10-31: economic impact, every
 * flooded parcel, not just the ones with buildings). Every county tax parcel matched against the County's four flood scenarios and
 * ESA's two erosion zones (scripts/bake-risks/parcel-exposure.mjs → economics.mjs → /risks-data/economics.json), with the
 * Assessor's own land, building and appraised values.
 *
 * A lot "reached" = at least 10 m² and 1% of it in the scenario's flood extent. "Land value underwater" = each reached lot's land
 * value × the share of the lot the flood covers. Erosion pairs 2060 with 2 ft and 2100 with 5 ft, as the report does.
 * URL state: s (2ft|5ft), st (1yr|100yr), i (island), u (land use).
 */
import { useEffect, useMemo, useState } from 'react'
import BuiltByCredit from '../components/BuiltByCredit.jsx'
import c from '../ships/ScrubberReport.module.css'
import b from '../ships/BunkeringReport.module.css'
import r from './LandValueReport.module.css'
import { SCENARIOS, SLR_LEVELS, STORMS, SLR_SERVICE_URL, EROSION_ZONES_URL, REPORT_URL, STORYMAP_URL, scenarioOf } from './risksLayers.js'
import { reportPage } from './risksSources.js'
import DocBrand from '../components/DocBrand.jsx'

const ASSESSOR_URL = 'https://www.sanjuancountywa.gov/149/Assessor'
const M2_PER_ACRE = 4046.856
// Flood scenarios: one hue, light → deep, mildest first (as the map's legend); erosion its own hue (the map's purple).
const SCEN_COLOR = ['#fca5a5', '#f87171', '#dc2626', '#991b1b']
const EROSION_COLOR = '#9333ea'
const SHARE_BANDS = [[0.1, 'Under 10%'], [0.25, '10–25%'], [0.5, '25–50%'], [0.75, '50–75%'], [1.01, '75–100%']]
const SHARE_COLOR = ['#fee2e2', '#fca5a5', '#f87171', '#dc2626', '#991b1b']

const fmt = (n) => Math.round(n).toLocaleString('en-US')
const money = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${fmt(n)}`)
const pct = (x) => (x >= 0.1 ? `${Math.round(x * 100)}%` : x >= 0.001 ? `${(x * 100).toFixed(1)}%` : x > 0 ? '<0.1%' : '0%')
const FT = 0.3048
// Distance bands to the projected erosion line (metres): crossed, within 50 ft, 50–100 ft
const NEAR_BANDS = [['The line crosses the building', -0.01, 0], ['Within 50 ft', 0, 50 * FT], ['50–100 ft away', 50 * FT, 100 * FT + 0.01]]
const scenName = (s) => `${SLR_LEVELS.find((l) => l.id === s.slr).label} + ${STORMS.find((t) => t.id === s.storm).plain.toLowerCase()}`

// Parcel row: [island, use, flags, land, bldg, appraised, lot m², fl1..fl4, er2060, er2100, district, % of building footprint flooded ×4]
const P = { isl: 0, use: 1, flags: 2, land: 3, bldg: 4, app: 5, lot: 6, fl: 7, er: 11, dist: 13, bs: 14 }
// An Assessor district as an area name: "21 Orcas - Eastsound" → "Eastsound"
const areaName = (d) => String(d || '').replace(/^\d+\s+/, '').replace(/^[^-]+-\s*/, '')

function readUrl() {
  const sp = new URLSearchParams(window.location.search)
  return { s: sp.get('s') === '2ft' ? '2ft' : '5ft', st: sp.get('st') === '1yr' ? '1yr' : '100yr', i: sp.get('i') || '', d: sp.get('d') || '', u: sp.get('u') || '' }
}

/** Everything the page shows for one scenario (index into SCENARIOS) and the filtered parcels. */
function measure(parcels, k, erYears) {
  const out = { reached: 0, half: 0, quarter: 0, halfApp: 0, quarterApp: 0, reachedApp: 0, land: 0, lb: 0, m2: 0, noBldg: 0, noBldgApp: 0,
    bands: SHARE_BANDS.map(() => ({ n: 0, app: 0 })), erN: 0, erLand: 0, erM2: 0 }
  for (const p of parcels) {
    let a = 0
    for (let j = 0; j <= k; j++) a += p[P.fl + j]
    const lot = p[P.lot] || 1, share = Math.min(1, a / lot)
    if (a >= 10 && share >= 0.01) {
      out.reached++; out.reachedApp += p[P.app]; out.land += p[P.land] * share
      out.lb += p[P.land] * share + (p[P.bldg] * (p[P.bs + k] || 0)) / 100; out.m2 += Math.min(a, lot)
      if (share >= 0.25) { out.quarter++; out.quarterApp += p[P.app] }
      if (share >= 0.5) { out.half++; out.halfApp += p[P.app] }
      if (!p[P.bldg]) { out.noBldg++; out.noBldgApp += p[P.app] }
      const bi = SHARE_BANDS.findIndex(([lim]) => share < lim)
      out.bands[bi].n++; out.bands[bi].app += p[P.app]
    }
    const e = p[P.er] + (erYears === 2100 ? p[P.er + 1] : 0)
    if (e >= 10) { const es = Math.min(1, e / lot); out.erN++; out.erLand += p[P.land] * es; out.erM2 += Math.min(e, lot) }
  }
  return out
}

function Src({ href, title, children }) {
  return <a className={c.src} href={href} target="_blank" rel="noopener noreferrer" title={title}>{children}</a>
}
const Method = ({ children }) => <a className={c.src} href="#how" title="How this is counted">{children}</a>

/** Four scenario bars for one measure; click a bar to pick that scenario. */
function StepChart({ title, values, label, k, pick, src }) {
  const max = Math.max(...values, 1)
  return (
    <div className={r.step}>
      <div className={r.stepTitle}>{title}</div>
      <div className={r.stepBars}>
        {SCENARIOS.map((s, j) => (
          <button key={s.id} type="button" className={`${r.stepCol} ${j === k ? r.stepOn : ''}`} onClick={() => pick(s)} title={`${scenName(s)}: ${label(values[j])}`}>
            <span className={r.stepPlot}>
              <span className={r.stepN}>{label(values[j])}</span>
              <span className={r.stepBar} style={{ height: `${Math.max(2, (values[j] / max) * 100)}%`, background: SCEN_COLOR[j] }} />
            </span>
            <span className={r.stepLbl}>{SLR_LEVELS.find((l) => l.id === s.slr).label}<br />{STORMS.find((t) => t.id === s.storm).plain.toLowerCase()}</span>
          </button>
        ))}
      </div>
      <div className={c.note}>Source: {src}</div>
    </div>
  )
}

/** A breakdown table (island or land use): click a row to filter the page by it. */
function Breakdown({ title, names, rows, totals, active, onPick, k, erYears, sub, label = (n) => n }) {
  const data = names.map((name, idx) => {
    const m = measure(rows.filter((p) => p[sub] === idx), k, erYears)
    return { name, idx, m, county: totals[idx] }
  }).filter((d) => d.m.reached || d.m.erN).sort((a, z) => z.m.land - a.m.land)
  const max = Math.max(...data.map((d) => d.m.land), 1)
  return (
    <div className={c.card}>
      <div className={c.cardHead}><h2 className={c.h2}>{title}</h2><span className={c.note}>Click a row to show only it · click again to clear</span></div>
      <div className={c.tableWrap}>
        <table className={`${c.table} ${r.bd}`}>
          <thead><tr>
            <th>{sub === P.isl ? 'Island' : sub === P.dist ? 'Area (Assessor district)' : 'Land use'}</th>
            <th className={c.num}>Lots reached</th><th className={c.num}>At least half flooded</th><th className={c.num}>Acres flooded</th>
            <th className={c.num}>Land value underwater</th><th className={r.barTh} /><th className={c.num}>Share of its land value</th><th className={c.num}>Land + buildings underwater</th><th className={c.num}>Lost to erosion</th>
          </tr></thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.name} className={`${r.click} ${active === d.name ? r.rowOn : ''}`} onClick={() => onPick(active === d.name ? '' : d.name)}>
                <td>{label(d.name)}</td>
                <td className={c.num}>{fmt(d.m.reached)}</td>
                <td className={c.num}>{fmt(d.m.half)}</td>
                <td className={c.num}>{fmt(d.m.m2 / M2_PER_ACRE)}</td>
                <td className={c.num}><b>{money(d.m.land)}</b></td>
                <td className={r.barTd}><span className={r.bar}><span style={{ width: `${(d.m.land / max) * 100}%`, background: SCEN_COLOR[k] }} /></span></td>
                <td className={c.num}>{pct(d.m.land / (d.county[1] || 1))}<span className={r.of}> of {money(d.county[1])}</span></td>
                <td className={c.num}>{money(d.m.lb)}</td>
                <td className={c.num}>{d.m.erLand ? money(d.m.erLand) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={c.hint}>Values: <Src href={ASSESSOR_URL} title="San Juan County Assessor">San Juan County Assessor</Src> · flooding: <Src href={SLR_SERVICE_URL} title="County map service">County flood layers</Src> · erosion: <Src href={EROSION_ZONES_URL} title="County map service">ESA erosion zones</Src> · <Method>how this is counted</Method></div>
    </div>
  )
}

export default function LandValueReport() {
  const [st, setSt] = useState(readUrl)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    fetch('/risks-data/economics.json').then((x) => (x.ok ? x.json() : Promise.reject(new Error(`HTTP ${x.status}`)))).then(setData).catch((e) => setErr(e.message))
  }, [])
  useEffect(() => {
    const sp = new URLSearchParams()
    if (st.s !== '5ft') sp.set('s', st.s)
    if (st.st !== '100yr') sp.set('st', st.st)
    if (st.i) sp.set('i', st.i)
    if (st.d) sp.set('d', st.d)
    if (st.u) sp.set('u', st.u)
    const q = sp.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}`)
    document.title = `Land in the path of sea-level rise${st.i ? ` · ${st.i}` : ''} · San Juan County · EarthAtlas`
  }, [st])
  const set = (patch) => setSt((o) => ({ ...o, ...patch }))

  const scen = scenarioOf(st.s, st.st)
  const k = SCENARIOS.indexOf(scen)
  const erYears = st.s === '2ft' ? 2060 : 2100
  const view = useMemo(() => {
    if (!data) return null
    const ii = data.islands.indexOf(st.i), ui = data.uses.indexOf(st.u), di = ii < 0 ? -1 : data.districts.indexOf(st.d)
    const inIsland = (p) => ii < 0 || p[P.isl] === ii
    const byI = data.parcels.filter((p) => inIsland(p) && (di < 0 || p[P.dist] === di))
    const byIslandU = data.parcels.filter((p) => inIsland(p) && (ui < 0 || p[P.use] === ui))   // the area table: the whole island
    const byU = ui < 0 ? data.parcels : data.parcels.filter((p) => p[P.use] === ui)
    const rows = byI.filter((p) => ui < 0 || p[P.use] === ui)
    const all = SCENARIOS.map((_, j) => measure(rows, j, SCENARIOS[j].slr === '2ft' ? 2060 : 2100))
    // County context for the filtered view: land value of every parcel on that island / of that use (both: not held, so the island's)
    const ctxLand = di >= 0 ? data.totals.district[di][1] : ii >= 0 ? data.totals.island[ii][1] : ui >= 0 ? data.totals.use[ui][1] : data.totals.land
    const holders = [
      ['Private, taxed', (p) => !(p[P.flags] & 2)],
      ['Tax-exempt (public and nonprofit)', (p) => !!(p[P.flags] & 2)],
      ['Under a conservation easement', (p) => !!(p[P.flags] & 1)],
    ].map(([name, f]) => ({ name, m: measure(rows.filter(f), k, erYears) }))
    // Buildings near the projected erosion line for this scenario's year, by distance band
    const near = (data.nearErosion || []).filter((b) => (ii < 0 || b[0] === ii) && (di < 0 || b[7] === di) && (ui < 0 || b[1] === ui))
      .map((b) => ({ d: erYears === 2060 ? b[3] : b[4], home: b[1] === 0, lot: b[5], app: b[6] })).filter((b) => b.d >= 0)
    const lotNearest = new Map()   // each lot once, at its nearest building
    for (const b of near) if (!lotNearest.has(b.lot) || b.d < lotNearest.get(b.lot).d) lotNearest.set(b.lot, b)
    const nearRows = NEAR_BANDS.map(([name, lo, hi]) => {
      const inBand = (b) => b.d > lo && b.d <= hi, bs = near.filter(inBand), lots = [...lotNearest.values()].filter(inBand)
      return { name, n: bs.length, homes: bs.filter((b) => b.home).length, lots: lots.length, app: lots.reduce((a, b) => a + b.app, 0) }
    })
    const nearLots = new Map(near.map((b) => [b.lot, b]))
    const nearTotal = { n: near.length, homes: near.filter((b) => b.home).length, lots: nearLots.size, app: [...nearLots.values()].reduce((a, b) => a + b.app, 0) }
    return { rows, byI, byU, byIslandU, all, m: all[k], ctxLand, holders, nearRows, nearTotal }
  }, [data, st.i, st.d, st.u, k, erYears])

  const where = [st.i && st.d ? `${areaName(st.d)}, ${st.i}` : st.i, st.u].filter(Boolean).join(' · ') || 'All of San Juan County'
  const filterNote = st.i && st.u ? ` (share of all ${st.d ? areaName(st.d) : st.i} land)` : ''

  return (
    <div className={c.page}>
      <header className={c.top}>
        <DocBrand tool="Sea-level risks" href="/risks"><a href="/risks" className={c.brand}>EarthAtlas <span>Sea-level risks</span></a></DocBrand>
        <button className={c.print} onClick={() => window.print()} disabled={!view}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" />
          </svg>
          Print or save as PDF
        </button>
      </header>
      <main className={c.main}>
        <div className={c.kicker}>San Juan County, Washington · sea-level rise</div>
        <h1 className={c.title}>The land in the rising sea’s path</h1>
        <p className={c.lede}>
          Every tax parcel in the county, matched against the County’s <Src href={SLR_SERVICE_URL} title="County map service">flood scenarios</Src> and
          ESA’s <Src href={EROSION_ZONES_URL} title="County map service">projected erosion zones</Src> from its <Src href={REPORT_URL} title="ESA 2024 report">2024 sea-level rise assessment</Src>,
          with the <Src href={ASSESSOR_URL} title="San Juan County Assessor">Assessor’s</Src> values for each lot: homes, farms, forests, parks, open space and undeveloped land alike.
        </p>

        <div className={c.controls}>
          <span className={c.focus}>If the sea rises
            <span className={c.seg}>{SLR_LEVELS.map((l) => <button key={l.id} type="button" className={st.s === l.id ? c.segOn : c.segBtn} onClick={() => set({ s: l.id })}>{l.label}</button>)}</span>
          </span>
          <span className={c.focus}>with
            <span className={c.seg}>{[...STORMS].reverse().map((t) => <button key={t.id} type="button" className={st.st === t.id ? c.segOn : c.segBtn} onClick={() => set({ st: t.id })}>{t.id === '100yr' ? 'a major storm' : 'the yearly flood'}</button>)}</span>
          </span>
          {data && <label className={c.focus}>Island
            <select value={st.i} onChange={(e) => set({ i: e.target.value, d: '' })}><option value="">All islands</option>{data.islands.map((x) => <option key={x}>{x}</option>)}</select></label>}
          {data && st.i && data.districtIsland.filter((x) => x === data.islands.indexOf(st.i)).length > 1 && <label className={c.focus}>Area
            <select value={st.d} onChange={(e) => set({ d: e.target.value })}><option value="">All of {st.i}</option>
              {data.districts.filter((x, j) => data.districtIsland[j] === data.islands.indexOf(st.i)).map((x) => <option key={x} value={x}>{areaName(x)}</option>)}</select></label>}
          {data && <label className={c.focus}>Land use
            <select value={st.u} onChange={(e) => set({ u: e.target.value })}><option value="">All land uses</option>{data.uses.map((x) => <option key={x}>{x}</option>)}</select></label>}
        </div>

        <dl className={c.facts}>
          <div><dt>Scenario</dt><dd>{SLR_LEVELS.find((l) => l.id === st.s).words} ({SLR_LEVELS.find((l) => l.id === st.s).when}) with {STORMS.find((t) => t.id === st.st).words}</dd></div>
          <div><dt>Showing</dt><dd>{where}</dd></div>
          <div><dt>Values</dt><dd><Src href={ASSESSOR_URL} title="San Juan County Assessor">San Juan County Assessor</Src></dd></div>
          {data && <div><dt>Built</dt><dd>{data.built}</dd></div>}
        </dl>

        {err && <div className={c.error}>Couldn’t load the parcel data ({err}).</div>}
        {!view && !err && <div className={c.loading}>Loading parcels…</div>}
        {view && <>
          <div className={c.tiles}>
            <div className={c.tile}>
              <div className={c.tileValue}>{money(view.m.land)}</div>
              <div className={c.tileLabel}>of land value underwater</div>
              <div className={c.tileSub}>{pct(view.m.land / view.ctxLand)} of {money(view.ctxLand)}, the land value of {st.i || st.u ? where : 'the whole county'}{filterNote}</div>
              <div className={c.tileSub}><b>{money(view.m.lb)}</b> with the flooded buildings’ value</div>
              <div className={c.tileSrc}>Source: <Src href={ASSESSOR_URL} title="San Juan County Assessor">Assessor</Src> × <Src href={SLR_SERVICE_URL} title="County flood layer">flood layer</Src> · <Method>how</Method></div>
            </div>
            <div className={c.tile}>
              <div className={c.tileValue}>{fmt(view.m.m2 / M2_PER_ACRE)}</div>
              <div className={c.tileLabel}>acres of private and public lots flooded</div>
              <div className={c.tileSub}>across {fmt(view.m.reached)} lots the flood reaches</div>
              <div className={c.tileSrc}>Source: <Src href={SLR_SERVICE_URL} title="County flood layer">County flood layer</Src> over <Src href={ASSESSOR_URL} title="Assessor">tax parcels</Src></div>
            </div>
            <div className={c.tile}>
              <div className={c.tileValue}>{fmt(view.m.half)}</div>
              <div className={c.tileLabel}>lots at least half flooded</div>
              <div className={c.tileSub}>appraised at {money(view.m.halfApp)}, land and buildings</div>
              <div className={c.tileSrc}>Source: <Src href={ASSESSOR_URL} title="Assessor">Assessor</Src> × <Src href={SLR_SERVICE_URL} title="County flood layer">flood layer</Src></div>
            </div>
            <div className={c.tile}>
              <div className={c.tileValue} style={{ color: '#6b21a8' }}>{money(view.m.erLand)}</div>
              <div className={c.tileLabel}>of land projected to erode away by {erYears}</div>
              <div className={c.tileSub}>{fmt(view.m.erM2 / M2_PER_ACRE)} acres from {fmt(view.m.erN)} lots</div>
              <div className={c.tileSrc}>Source: <Src href={EROSION_ZONES_URL} title="ESA erosion zones">ESA erosion zones</Src> · <Src href={reportPage(30)} title="report p. 25">report, p. 25</Src></div>
            </div>
          </div>

          <div className={c.card}>
            <div className={c.cardHead}><h2 className={c.h2}>Each step up in the sea takes more</h2><span className={c.note}>{where} · click a scenario to show it</span></div>
            <div className={r.steps}>
              <StepChart title="Land value underwater" values={view.all.map((m) => m.land)} label={money} k={k} pick={(s) => set({ s: s.slr, st: s.storm })}
                src={<><Src href={ASSESSOR_URL} title="Assessor">Assessor</Src> × <Src href={SLR_SERVICE_URL} title="County flood layers">flood layers</Src></>} />
              <StepChart title="Land + buildings underwater" values={view.all.map((m) => m.lb)} label={money} k={k} pick={(s) => set({ s: s.slr, st: s.storm })}
                src={<><Src href={ASSESSOR_URL} title="Assessor">Assessor</Src> × <Src href={`${SLR_SERVICE_URL}/0`} title="County building footprints">building footprints</Src></>} />
              <StepChart title="Lots at least half flooded" values={view.all.map((m) => m.half)} label={fmt} k={k} pick={(s) => set({ s: s.slr, st: s.storm })}
                src={<><Src href={ASSESSOR_URL} title="Assessor">tax parcels</Src> × <Src href={SLR_SERVICE_URL} title="County flood layers">flood layers</Src></>} />
              <StepChart title="Acres flooded" values={view.all.map((m) => m.m2 / M2_PER_ACRE)} label={fmt} k={k} pick={(s) => set({ s: s.slr, st: s.storm })}
                src={<Src href={SLR_SERVICE_URL} title="County flood layers">County flood layers</Src>} />
            </div>
          </div>

          <div className={c.card}>
            <div className={c.cardHead}><h2 className={c.h2}>How much of each lot the water covers</h2><span className={c.note}>{scenName(scen)} · {where}</span></div>
            <div className={r.shares}>
              {view.m.bands.map((bd, j) => {
                const max = Math.max(...view.m.bands.map((x) => x.n), 1)
                return (
                  <div key={j} className={r.shareRow}>
                    <span className={r.shareLbl}>{SHARE_BANDS[j][1]} of the lot</span>
                    <span className={r.bar}><span style={{ width: `${(bd.n / max) * 100}%`, background: SHARE_COLOR[j] }} /></span>
                    <span className={r.shareN}><b>{fmt(bd.n)}</b> lots<small>appraised {money(bd.app)}</small></span>
                  </div>
                )
              })}
            </div>
            <div className={c.hint}>Lots with no building at all: <b>{fmt(view.m.noBldg)}</b>, appraised at {money(view.m.noBldgApp)} · Source: <Src href={ASSESSOR_URL} title="Assessor">Assessor</Src> × <Src href={SLR_SERVICE_URL} title="County flood layer">flood layer</Src> · <Method>how</Method></div>
          </div>

          {!st.i
            ? <Breakdown title="By island" names={data.islands} rows={view.byU} totals={data.totals.island} active={st.i} onPick={(i) => set({ i, d: '' })} k={k} erYears={erYears} sub={P.isl} />
            : data.districtIsland.filter((x) => x === data.islands.indexOf(st.i)).length > 1 &&
              <Breakdown title={`By area of ${st.i}`} names={data.districts} rows={view.byIslandU} totals={data.totals.district} active={st.d} onPick={(d) => set({ d })} k={k} erYears={erYears} sub={P.dist} label={areaName} />}
          <Breakdown title="By land use" names={data.uses} rows={view.byI} totals={data.totals.use} active={st.u} onPick={(u) => set({ u })} k={k} erYears={erYears} sub={P.use} />

          <div className={c.card}>
            <div className={c.cardHead}><h2 className={c.h2}>Who holds the land</h2><span className={c.note}>{scenName(scen)} · {where}</span></div>
            <div className={c.tableWrap}>
              <table className={`${c.table} ${r.bd}`}>
                <thead><tr><th>Holder</th><th className={c.num}>Lots reached</th><th className={c.num}>At least half flooded</th><th className={c.num}>Acres flooded</th><th className={c.num}>Land value underwater</th><th className={c.num}>Land + buildings underwater</th><th className={c.num}>Lost to erosion</th></tr></thead>
                <tbody>{view.holders.map((h) => (
                  <tr key={h.name}><td>{h.name}</td><td className={c.num}>{fmt(h.m.reached)}</td><td className={c.num}>{fmt(h.m.half)}</td><td className={c.num}>{fmt(h.m.m2 / M2_PER_ACRE)}</td><td className={c.num}><b>{money(h.m.land)}</b></td><td className={c.num}>{money(h.m.lb)}</td><td className={c.num}>{h.m.erLand ? money(h.m.erLand) : '—'}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className={c.hint}>Tax status and conservation easements: the <Src href={ASSESSOR_URL} title="Assessor">Assessor’s</Src> tax-status and land-use codes. Easement lots are also counted in the first two rows.</div>
          </div>

          <div className={c.card}>
            <div className={c.cardHead}><h2 className={c.h2}>Land erosion is projected to take</h2><span className={c.note}>{where}</span></div>
            <div className={r.erosion}>
              {[2060, 2100].map((y) => {
                const m = view.all[y === 2060 ? 0 : 3]
                return (
                  <div key={y} className={r.erCard}>
                    <div className={r.erYear}>By {y} <span>(paired with {y === 2060 ? '2 ft' : '5 ft'} of rise)</span></div>
                    <div className={r.erVal}>{money(m.erLand)}</div>
                    <div className={c.tileSub}>{fmt(m.erM2 / M2_PER_ACRE)} acres of {fmt(m.erN)} lots</div>
                  </div>
                )
              })}
            </div>
            <h3 className={r.h3}>Buildings near the projected {erYears} erosion line</h3>
            <div className={c.tableWrap}>
              <table className={c.table}>
                <thead><tr><th>Distance to the line</th><th className={c.num}>Buildings</th><th className={c.num}>On home lots</th><th className={c.num}>Lots</th><th className={c.num}>Appraised value of those lots</th></tr></thead>
                <tbody>
                  {view.nearRows.map((x) => (
                    <tr key={x.name}><td>{x.name}</td><td className={c.num}>{fmt(x.n)}</td><td className={c.num}>{fmt(x.homes)}</td><td className={c.num}>{fmt(x.lots)}</td><td className={c.num}><b>{money(x.app)}</b></td></tr>
                  ))}
                  <tr className={c.lvl1}><td>All within 100 ft</td><td className={c.num}>{fmt(view.nearTotal.n)}</td><td className={c.num}>{fmt(view.nearTotal.homes)}</td><td className={c.num}>{fmt(view.nearTotal.lots)}</td><td className={c.num}><b>{money(view.nearTotal.app)}</b></td></tr>
                </tbody>
              </table>
            </div>
            <div className={c.hint}>The land between today’s shoreline and ESA’s projected erosion line for each year. Distance: each county building footprint’s shortest distance to the line, measured by EarthAtlas; a lot is counted once, at its nearest building. Source: <Src href={EROSION_ZONES_URL} title="ESA erosion zones">ESA erosion zones</Src> · <Src href={reportPage(30)} title="report p. 25">report, p. 25</Src> · values: <Src href={ASSESSOR_URL} title="Assessor">Assessor</Src></div>
          </div>

          <div className={c.card} id="how">
            <div className={c.cardHead}><h2 className={c.h2}>How this is counted</h2></div>
            <ul className={r.how}>
              <li><b>Parcels and values:</b> all {fmt(data.totals.parcels)} tax parcels in San Juan County with the <Src href={ASSESSOR_URL} title="Assessor">Assessor’s</Src> land value, building value and appraised value (land plus buildings). Islands come from the Assessor’s district; land use from the Assessor’s use code, grouped.</li>
              <li><b>Flooding:</b> the County’s four <Src href={SLR_SERVICE_URL} title="County map service">sea-level rise scenarios</Src> (2 or 5 ft of rise with the yearly or 100-year storm, ESA 2024; <Src href={reportPage(22)} title="report p. 17">report, p. 17</Src>). Each scenario includes the ground of every milder one, as on the <a className={c.src} href="/risks">/risks map</a>.</li>
              <li><b>A lot the flood reaches:</b> at least 10 square meters and 1% of the lot inside the scenario’s flood extent (exact polygon overlap).</li>
              <li><b>Land value underwater:</b> each lot’s land value times the share of the lot the flood covers.</li>
              <li><b>Land + buildings underwater:</b> that land value plus each lot’s building value times the share of the lot’s building footprint area (the County’s <Src href={`${SLR_SERVICE_URL}/0`} title="County building footprints">building footprints</Src>) the flood covers. The <a className={c.src} href="/risks">/risks map</a>’s “land + buildings” total for the map view counts the same way.</li>
              <li><b>Erosion:</b> ESA’s <Src href={EROSION_ZONES_URL} title="County map service">projected erosion zones</Src>, 2060 with 2 ft of rise and 2100 with 5 ft (<Src href={reportPage(30)} title="report p. 25">report, p. 25</Src>), counted the same way.</li>
              <li><b>Buildings near the erosion line:</b> the County’s <Src href={`${SLR_SERVICE_URL}/0`} title="County building footprints">building footprints</Src>, each one’s shortest distance to ESA’s projected line for the year (in UTM zone 10N), joined to its lot by parcel number. “On home lots”: buildings on lots the Assessor codes as homes and cabins.</li>
              <li><b>Study:</b> <Src href={REPORT_URL} title="ESA 2024 report">San Juan County Sea Level Rise Vulnerability Assessment (ESA, 2024)</Src> · <Src href={STORYMAP_URL} title="StoryMap">County StoryMap</Src>.</li>
            </ul>
          </div>
        </>}
        <BuiltByCredit variant="light" className={c.builtBy} />
      </main>
    </div>
  )
}
