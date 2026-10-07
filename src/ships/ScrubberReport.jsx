/**
 * /ships/reports/scrubbers: scrubber-fitted ships calling at terminals (docs/SHIPS_SCRUBBER_REPORT.md; Josh 2026-10-07, asked for by
 * Friends of the San Juans for the WA legislature). A standalone report, not tied to the map: headline numbers for a period, a monthly
 * chart that drills to days, port-authority vs private split, and a place table (state → county → city → terminal → ships).
 * Data: /api/ships?op=scrubberReport (lib/ships/scrubberReport.js). URL state: from, to, geo, open (row keys), m (drilled month).
 */
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import BuiltByCredit from '../components/BuiltByCredit.jsx'
import { kindWords } from './terminalIcons.js'
import c from './ScrubberReport.module.css'

const DEFAULT = { from: '2025-01', to: '2026-06', geo: 'WA' }
const OWN = [
  ['port_authority', 'Port authority', '#2a78d6'],
  ['private', 'Private', '#eb6834'],
  ['government', 'Government', '#1baf7a'],
  ['unknown', 'Not classified', '#9ca3af'],
]
// Lovel's grouping ("each port, terminal and refinery"): ports = docks a public port district owns (Josh 2026-10-07: port-authority
// terminals apart from private docks); refineries = refinery docks; terminals = every other dock.
const TYPES = [
  ['ports', 'Ports', '#2a78d6', 'Docks owned by a public port district (Port of Seattle, Tacoma, Vancouver…), whoever operates them'],
  ['terminals', 'Terminals', '#eb6834', 'Private and government docks other than refineries: fuel, grain, cement, chemical and other terminals'],
  ['refineries', 'Refineries', '#1baf7a', 'Refinery docks'],
]
export const typeOf = (t) => (t.kind === 'refinery_dock' ? 'refineries' : t.ownership === 'port_authority' ? 'ports' : 'terminals')
const TYPE_SINGULAR = { ports: 'Port', terminals: 'Terminal', refineries: 'Refinery' }
const TYPE_COLOR = Object.fromEntries(TYPES.map(([k, , col]) => [k, col]))
const OWN_LABEL = Object.fromEntries(OWN.map(([k, l]) => [k, l]))
const GEOS = [['WA', 'Washington'], ['BC', 'British Columbia'], ['ALL', 'All terminals']]
const STATE_NAME = { WA: 'Washington', OR: 'Oregon', BC: 'British Columbia' }
const SRC = {
  noaa: { name: 'NOAA / BOEM MarineCadastre AIS', href: 'https://hub.marinecadastre.gov/pages/vesseltraffic' },
  gisis: { name: 'IMO GISIS (MARPOL Annex VI Reg. 4.2)', href: 'https://gisis.imo.org/' },
  mep: { name: 'MEP Alliance scrubber lists', href: 'https://www.mepalliance.org/list-of-scrubber-fitted-ships' },
  usace: { name: 'USACE Navigation Facilities (Docks)', href: 'https://geospatial-usace.opendata.arcgis.com/datasets/23d91bd988ac4fc9943128965bddfa37_0' },
  census: { name: 'U.S. Census Bureau (TIGER)', href: 'https://geocoding.geo.census.gov/geocoder/' },
  gfw: { name: 'Powered by Global Fishing Watch', href: 'https://globalfishingwatch.org' },
  gfwPorts: { name: 'Powered by Global Fishing Watch (port visits)', href: 'https://globalfishingwatch.org/our-apis/documentation/docs/v3/events' },
}

const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'))
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–')
const monthName = (m, style = 'short') => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: style, year: 'numeric', timeZone: 'UTC' })
const monthShort = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
const placeLabel = (n) => (n ? n.replace(/\s+(city|town|CDP|village)$/i, '') : null)
const monthsBetween = (a, b) => {
  const out = []; let [y, m] = a.split('-').map(Number); const [y2, m2] = b.split('-').map(Number)
  while (y < y2 || (y === y2 && m <= m2)) { out.push(`${y}-${String(m).padStart(2, '0')}`); [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1] }
  return out
}
const MONTH_OPTIONS = monthsBetween('2025-01', '2026-12')

function readUrl() {
  const sp = new URLSearchParams(window.location.search)
  const ok = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v || '')
  return {
    from: ok(sp.get('from')) ? sp.get('from') : DEFAULT.from,
    to: ok(sp.get('to')) ? sp.get('to') : DEFAULT.to,
    geo: GEOS.some(([g]) => g === sp.get('geo')) ? sp.get('geo') : DEFAULT.geo,
    open: (sp.get('open') || '').split(',').filter(Boolean),
    m: ok(sp.get('m')) ? sp.get('m') : null,
  }
}

const Src = ({ k, children }) => <a className={c.src} href={SRC[k].href} target="_blank" rel="noopener noreferrer">{children || SRC[k].name}</a>

export default function ScrubberReport() {
  const { edition } = useParams()
  const [ed, setEd] = useState(null)   // a frozen edition's header (id, title, params, created_at)
  const [st, setSt] = useState(readUrl)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [days, setDays] = useState(null)
  const [hover, setHover] = useState(null)
  const [world, setWorld] = useState(null)
  const set = (patch) => setSt((s) => ({ ...s, ...patch }))

  useEffect(() => { document.title = 'Scrubber-fitted ships at terminals · EarthAtlas Ships' }, [])
  useEffect(() => {
    const sp = new URLSearchParams()
    if (st.from !== DEFAULT.from) sp.set('from', st.from)
    if (st.to !== DEFAULT.to) sp.set('to', st.to)
    if (st.geo !== DEFAULT.geo) sp.set('geo', st.geo)
    if (st.open.length) sp.set('open', st.open.join(','))
    if (st.m) sp.set('m', st.m)
    const qs = sp.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
  }, [st])
  useEffect(() => {
    setData(null); setErr(null)
    if (edition) {
      fetch(`/api/ships?op=scrubberEdition&id=${encodeURIComponent(edition)}`)
        .then((r) => r.json()).then((j) => {
          if (j.error) return setErr(j.error)
          setEd({ id: j.id, title: j.title, params: j.params, created_at: j.created_at })
          setData(j.payload)
        }).catch((e) => setErr(String(e)))
      return
    }
    fetch(`/api/ships?op=scrubberReport&from=${st.from}&to=${st.to}`)
      .then((r) => r.json()).then((j) => (j.error ? setErr(j.error) : setData(j))).catch((e) => setErr(String(e)))
  }, [edition, st.from, st.to])
  useEffect(() => {
    setDays(null)
    if (!st.m) return
    if (data?.estimated?.months?.includes(st.m)) {   // an estimated month: its days come with the report
      setDays(Object.entries(data.estimated.days || {}).filter(([d]) => d.startsWith(st.m))
        .flatMap(([d, byT]) => Object.entries(byT).map(([k, n]) => ({ terminal_key: k, day: d, scrubber_calls: n }))))
      return
    }
    if (edition) { if (data?.days) setDays(data.days[st.m] || []); return }
    fetch(`/api/ships?op=scrubberReportDays&month=${st.m}`).then((r) => r.json()).then((j) => setDays(j.days || [])).catch(() => setDays([]))
  }, [st.m, edition, data])

  useEffect(() => {
    setWorld(null)
    if (edition) { if (data?.world) setWorld(data.world[st.geo] || null); return }
    fetch(`/api/ships?op=scrubberWorldPorts&from=${st.from}&to=${st.to}&geo=${st.geo}`).then((r) => r.json()).then((j) => setWorld(j.error ? null : j)).catch(() => {})
  }, [edition, data, st.from, st.to, st.geo])

  const view = useMemo(() => (data ? build(data, st.geo) : null), [data, st.geo])

  return (
    <div className={c.page}>
      <header className={c.top}>
        <a href="/ships" className={c.brand}>EarthAtlas <span>Ships</span></a>
        <span className={c.edition}>{edition ? <>Edition {edition} · frozen · <a href="/ships/reports/scrubbers" className={c.src}>live report</a></> : 'Live report · updates as new data lands'}</span>
      </header>
      <main className={c.main}>
        <div className={c.kicker}>Report</div>
        <h1 className={c.title}>Scrubber-fitted ships at {st.geo === 'WA' ? 'Washington' : st.geo === 'BC' ? 'British Columbia' : 'Salish Sea and Washington'} terminals</h1>
        <p className={c.lede}>
          How often ships fitted with exhaust-gas scrubbers called at ports, terminals and refinery docks, month by month.
          A call is a ship stopped at a berth, counted minute by minute from <Src k="noaa">NOAA's AIS ship positions</Src>.
          A ship counts as scrubber-fitted when it is in the <Src k="gisis">IMO's scrubber notifications</Src> or
          on the <Src k="mep">MEP Alliance lists</Src>.
        </p>

        {ed && (
          <div className={c.editionBanner}>
            <b>{ed.title || `Edition ${ed.id}`}</b>: numbers frozen on {new Date(ed.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} for
            {' '}{monthName(ed.params.from, 'long')} – {monthName(ed.params.to, 'long')}. They will not change; the <a href="/ships/reports/scrubbers" className={c.src}>live report</a> adds
            newer data as it lands.
          </div>
        )}
        <div className={c.controls}>
          <div className={c.seg} role="tablist" aria-label="Area">
            {GEOS.map(([g, l]) => (
              <button key={g} role="tab" aria-selected={st.geo === g} className={st.geo === g ? c.segOn : c.segBtn} onClick={() => set({ geo: g, open: [] })}>{l}</button>
            ))}
          </div>
          {!edition && <div className={c.period}>
            <label>From <select value={st.from} onChange={(e) => set({ from: e.target.value, m: null, to: e.target.value > st.to ? e.target.value : st.to })}>
              {MONTH_OPTIONS.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select></label>
            <label>to <select value={st.to} onChange={(e) => set({ to: e.target.value, m: null, from: e.target.value < st.from ? e.target.value : st.from })}>
              {MONTH_OPTIONS.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select></label>
            <div className={c.presets}>
              {[['Jan 2025 – Jun 2026', '2025-01', '2026-06'], ['2025', '2025-01', '2025-12'], ['First half 2026', '2026-01', '2026-06']].map(([l, f, t]) => (
                <button key={l} className={st.from === f && st.to === t ? c.presetOn : c.preset} onClick={() => set({ from: f, to: t, m: null })}>{l}</button>
              ))}
            </div>
          </div>}
        </div>

        {err && <div className={c.error}>Couldn't load the report: {err}</div>}
        {!data && !err && <div className={c.loading}>Counting calls…</div>}

        {view && <>
          <Coverage data={data} view={view} />

          <section className={c.tiles} aria-label="Headline numbers">
            <Tile value={fmt(view.tot.scrubber_calls + (view.tot.est_calls || 0))} label="Scrubber-ship calls"
              sub={`at ${fmt(view.terminalsWithScrubber)} terminals${view.tot.est_calls ? `; ≈${fmt(view.tot.est_calls)} of them estimated` : ''}`}
              src={<><Src k="noaa">NOAA AIS</Src>{view.tot.est_calls ? <> · <Src k="gfw">Global Fishing Watch</Src></> : null}</>} />
            <Tile value={fmt(view.shipIds.size)} label="Scrubber-fitted ships" sub="different ships that made those calls" src={<><Src k="gisis">IMO</Src> · <Src k="mep">MEP Alliance</Src></>} />
            <Tile value={pct(view.tot.scrubber_calls, view.tot.large)} label="Share of large-ship calls" sub={`${fmt(view.tot.scrubber_calls)} of ${fmt(view.tot.large)} calls by passenger, cargo and tanker ships (NOAA-counted months)`} src={<Src k="noaa">AIS ship type</Src>} />
            <Tile value={fmt((view.byOwn.ports?.scrubber_calls || 0) + (view.byOwn.ports?.est_calls || 0))} label="At ports"
              sub={`${fmt((view.byOwn.terminals?.scrubber_calls || 0) + (view.byOwn.terminals?.est_calls || 0))} at other terminals, ${fmt((view.byOwn.refineries?.scrubber_calls || 0) + (view.byOwn.refineries?.est_calls || 0))} at refinery docks`} src={<Src k="usace">dock owner: USACE</Src>} />
          </section>

          <section className={c.card}>
            <div className={c.cardHead}>
              <h2 className={c.h2}>Each port, terminal and refinery, month by month</h2>
              <button className={c.csv} onClick={() => downloadCsv(view, data.period.months.filter((m) => data.coverage.months.includes(m) || view.estMonths.has(m)), st)}>Download CSV</button>
            </div>
            <div className={c.note}>Each cell: <b>scrubber-ship calls</b> and, under it, how many different scrubber-fitted ships made them. Totals count each ship once.</div>
            <Matrix view={view} months={data.period.months} covered={new Set(data.coverage.months)} />
          </section>

          <section className={c.card}>
            <div className={c.cardHead}>
              <h2 className={c.h2}>Scrubber-ship calls by month</h2>
              <Legend />
            </div>
            <MonthChart view={view} months={data.period.months} covered={new Set(data.coverage.months)} active={st.m} hover={hover} setHover={setHover}
              onPick={(m) => set({ m: st.m === m ? null : m })} />
            <div className={c.hint}>Select a month to see it day by day.</div>
            {st.m && <DayChart month={st.m} days={days} keys={view.keys} onClose={() => set({ m: null })} />}
          </section>

          <section className={c.ownGrid} aria-label="Ports, terminals and refineries">
            {TYPES.filter(([k]) => view.byOwn[k]).map(([k, l, col]) => {
              const o = view.byOwn[k]
              return (
                <div key={k} className={c.ownCard}>
                  <div className={c.ownHead}><span className={c.swatch} style={{ background: col }} />{l}</div>
                  <div className={c.ownValue}>{fmt(o.scrubber_calls + (o.est_calls || 0))}<span> scrubber-ship calls</span></div>
                  <div className={c.ownSub}>{fmt(o.ships.size)} ships · {fmt(o.terminals.size)} terminals · {pct(o.scrubber_calls, o.large)} of large-ship calls</div>
                </div>
              )
            })}
          </section>

          <section className={c.card}>
            <div className={c.cardHead}>
              <h2 className={c.h2}>By place</h2>
              <div className={c.note}>County and city from the <Src k="census">US Census Bureau</Src>; open a row for its terminals and ships.</div>
            </div>
            <PlaceTable view={view} open={st.open} setOpen={(open) => set({ open })} months={data.coverage.months} />
          </section>

          <WorldPorts world={world} geo={st.geo} />

          <Method data={data} />
        </>}
        <BuiltByCredit variant="panel" className={c.builtBy} />
      </main>
    </div>
  )
}

// ── Data shaping (pure) ─────────────────────────────────────────────────────

function build(data, geo) {
  const inGeo = (t) => geo === 'ALL' || (geo === 'WA' ? t.state_code === 'WA' : t.state_code === 'BC')
  const terms = data.terminals.filter(inGeo)
  const keys = new Set(terms.map((t) => t.key))
  const byKey = new Map(terms.map((t) => [t.key, t]))
  const own = (t) => t.ownership || 'unknown'
  const zero = () => ({ calls: 0, large: 0, scrubber_calls: 0 })
  const tot = zero()
  const perT = new Map(terms.map((t) => [t.key, { ...zero(), months: {}, monthShips: {}, ships: new Map() }]))
  const perMonth = {}
  for (const r of data.cells) {
    if (!keys.has(r.terminal_key)) continue
    const p = perT.get(r.terminal_key)
    for (const f of ['calls', 'large', 'scrubber_calls']) { p[f] += r[f]; tot[f] += r[f] }
    p.months[r.month] = (p.months[r.month] || 0) + r.scrubber_calls
    p.monthShips[r.month] = r.scrubber_ships
    const pm = perMonth[r.month] ||= { total: 0 }
    const ty = typeOf(byKey.get(r.terminal_key))
    pm[ty] = (pm[ty] || 0) + r.scrubber_calls
    pm.total += r.scrubber_calls
  }
  // Months after NOAA's latest: GFW-estimated stops (≈), never mixed into the counted calls or the large-ship share.
  const est = data.estimated
  const estMonths = new Set(est?.months || [])
  for (const r of est?.cells || []) {
    if (!keys.has(r.terminal_key)) continue
    const p = perT.get(r.terminal_key)
    p.est_calls = (p.est_calls || 0) + r.scrubber_calls
    tot.est_calls = (tot.est_calls || 0) + r.scrubber_calls
    p.months[r.month] = (p.months[r.month] || 0) + r.scrubber_calls
    p.monthShips[r.month] = r.scrubber_ships
    const pm = perMonth[r.month] ||= { total: 0 }
    const ty = typeOf(byKey.get(r.terminal_key))
    pm[ty] = (pm[ty] || 0) + r.scrubber_calls
    pm.total += r.scrubber_calls
  }
  const shipIds = new Set()
  const shipsBy = {}   // group key ('all' | type) → month → Set of ships, so a column's ships are counted once
  const addShip = (g, m, id) => ((shipsBy[g] ||= {})[m] ||= new Set()).add(id)
  for (const s of [...data.ships, ...(est?.ships || [])]) {
    if (!keys.has(s.terminal_key)) continue
    shipIds.add(s.vessel_id)
    const ty = typeOf(byKey.get(s.terminal_key))
    for (const g of ['all', ty]) { addShip(g, s.month, s.vessel_id); addShip(g, '*', s.vessel_id) }
    const m = perT.get(s.terminal_key).ships
    const e = m.get(s.vessel_id) || { ...s, calls: 0, months: {} }
    e.calls += s.calls; e.months[s.month] = (e.months[s.month] || 0) + s.calls
    m.set(s.vessel_id, e)
  }
  const byOwn = {}
  for (const t of terms) {
    if (!t.counted) continue
    const o = byOwn[typeOf(t)] ||= { ...zero(), ships: new Set(), terminals: new Set() }
    const p = perT.get(t.key)
    for (const f of ['calls', 'large', 'scrubber_calls']) o[f] += p[f]
    o.est_calls = (o.est_calls || 0) + (p.est_calls || 0)
    for (const id of p.ships.keys()) o.ships.add(id)
    o.terminals.add(t.key)
  }
  // Place tree: state → county → city (or "unincorporated") → terminal
  const tree = new Map()
  for (const t of terms) {
    const sk = t.state_code || t.country
    const ck = t.county_name || (sk === 'BC' ? 'British Columbia' : 'County not set')
    const pk = placeLabel(t.place_name) || (t.county_name ? `Unincorporated ${t.county_name.replace(/ County$/, '')} County` : '')
    const s = tree.get(sk) || tree.set(sk, new Map()).get(sk)
    const co = s.get(ck) || s.set(ck, new Map()).get(ck)
    const pl = co.get(pk) || co.set(pk, []).get(pk)
    pl.push(t)
  }
  return { terms, keys, byKey, perT, perMonth, tot, shipIds, shipsBy, byOwn, tree, estMonths, est, counted: terms.filter((t) => t.counted),
    notCounted: terms.filter((t) => !t.counted), terminalsWithScrubber: terms.filter((t) => perT.get(t.key).scrubber_calls + (perT.get(t.key).est_calls || 0) > 0).length }
}

function sumOf(view, list) {
  const out = { calls: 0, large: 0, scrubber_calls: 0, ships: new Set(), months: {}, counted: 0, n: list.length }
  for (const t of list) {
    const p = view.perT.get(t.key)
    for (const f of ['calls', 'large', 'scrubber_calls']) out[f] += p[f]
    out.est_calls = (out.est_calls || 0) + (p.est_calls || 0)
    for (const id of p.ships.keys()) out.ships.add(id)
    for (const [m, v] of Object.entries(p.months)) out.months[m] = (out.months[m] || 0) + v
    if (t.counted) out.counted++
  }
  return out
}

// ── The facility × month table (Lovel's request) ────────────────────────────

function Cell({ calls, ships, dim, est }) {
  if (dim) return <td className={c.mCellNa} title="Not counted yet">·</td>
  return (
    <td className={`${calls ? c.mCell : c.mCellZero}${est ? ` ${c.mEst}` : ''}`} title={est ? 'Estimated from hourly positions (≈)' : undefined}>
      <div className={c.mCalls}>{est && calls ? '≈' : ''}{calls ? fmt(calls) : '0'}</div>
      {calls > 0 && <div className={c.mShips}>{fmt(ships)} ship{ships === 1 ? '' : 's'}</div>}
    </td>
  )
}

function Matrix({ view, months, covered }) {
  const [hideZero, setHideZero] = useState(true)
  const est = view.estMonths
  const shown = (m) => covered.has(m) || est.has(m)
  // A terminal's month is blank ("·") when neither NOAA counted it nor an estimate exists for it there.
  const cellFor = (t, m, calls, ships) => <Cell key={m} dim={!shown(m) || (!est.has(m) && t && !t.counted)} est={est.has(m)} calls={calls} ships={ships} />
  const total = (p) => p.scrubber_calls + (p.est_calls || 0)
  return (
    <>
      <label className={c.mToggle}><input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} /> Hide facilities with no scrubber-ship calls</label>
      <div className={c.mWrap}>
        <table className={c.matrix}>
          <thead><tr>
            <th className={c.mFirst}>Facility</th>
            {months.map((m) => <th key={m} className={shown(m) ? (est.has(m) ? c.mEstH : '') : c.mNa}>{est.has(m) ? '≈' : ''}{monthShort(m)}<span>{m.slice(2, 4)}</span></th>)}
            <th className={c.mTot}>Total</th>
          </tr></thead>
          <tbody>
            {TYPES.map(([ty, label, col, desc]) => {
              const list = view.terms.filter((t) => typeOf(t) === ty)
              if (!list.length) return null
              const has = (t) => t.counted || (view.perT.get(t.key).est_calls || 0) > 0
              const rows = list.filter((t) => has(t) && (!hideZero || total(view.perT.get(t.key)) > 0))
                .sort((a, b) => total(view.perT.get(b.key)) - total(view.perT.get(a.key)) || a.name.localeCompare(b.name))
              const notCounted = list.filter((t) => !t.counted).length
              const hidden = list.filter(has).length - rows.length
              const sum = sumOf(view, list)
              return [
                <tr key={`h-${ty}`} className={c.mGroup}>
                  <th className={c.mFirst} scope="rowgroup"><span className={c.swatch} style={{ background: col }} />{label}<div className={c.mDesc}>{desc}</div></th>
                  {months.map((m) => cellFor(null, m, sum.months[m] || 0, view.shipsBy[ty]?.[m]?.size || 0))}
                  <Cell calls={sum.scrubber_calls + (sum.est_calls || 0)} ships={view.shipsBy[ty]?.['*']?.size || 0} />
                </tr>,
                ...rows.map((t) => {
                  const p = view.perT.get(t.key)
                  return (
                    <tr key={t.key}>
                      <th className={c.mFirst} scope="row">
                        <a href={`/ships?tl=${encodeURIComponent(t.key)}`} className={c.mName}>{t.name}</a>
                        <div className={c.mDesc}>{[placeLabel(t.place_name) || (t.county_name ? `${t.county_name}, unincorporated` : null), kindWords(t.kind)].filter(Boolean).join(' · ')}</div>
                      </th>
                      {months.map((m) => cellFor(t, m, p.months[m] || 0, p.monthShips[m] || 0))}
                      <Cell calls={total(p)} ships={p.ships.size} />
                    </tr>
                  )
                }),
                (hidden > 0 || notCounted > 0) && (
                  <tr key={`n-${ty}`} className={c.mMore}><td colSpan={months.length + 2}>
                    {[hidden > 0 && `${hidden} more ${label.toLowerCase()} with no scrubber-ship calls`, notCounted > 0 && `${notCounted} not yet in NOAA's count`].filter(Boolean).join(' · ')}
                  </td></tr>
                ),
              ]
            })}
            <tr className={c.mAll}>
              <th className={c.mFirst} scope="row">All facilities</th>
              {months.map((m) => cellFor(null, m, view.perMonth[m]?.total || 0, view.shipsBy.all?.[m]?.size || 0))}
              <Cell calls={view.tot.scrubber_calls + (view.tot.est_calls || 0)} ships={view.shipIds.size} />
            </tr>
          </tbody>
        </table>
      </div>
      <div className={c.hint}>
        {[months.some((m) => !shown(m)) && '“·” = not counted yet.',
          est.size > 0 && `≈ = estimated from hourly ship positions (Powered by Global Fishing Watch) for months NOAA has not published yet; replaced by NOAA's counts when they arrive.${view.est?.shared?.calls ? ` ${fmt(view.est.shared.calls)} more estimated stops by scrubber ships could be at either of two neighbouring terminals and are left out of the rows.` : ''}`]
          .filter(Boolean).join(' ')}
      </div>
    </>
  )
}

function downloadCsv(view, months, st) {
  const q = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const head = ['facility', 'type', 'kind', 'owner', 'owner_source', 'county', 'city_or_town', 'state', 'counted',
    ...months.flatMap((m) => (view.estMonths.has(m) ? [`${m}_scrubber_calls_estimated`, `${m}_scrubber_ships_estimated`] : [`${m}_scrubber_calls`, `${m}_scrubber_ships`])),
    'total_scrubber_calls', 'total_scrubber_ships', 'total_large_ship_calls_noaa_months']
  const rows = view.terms.map((t) => {
    const p = view.perT.get(t.key)
    return [t.name, typeOf(t), kindWords(t.kind), t.ownership || '', t.ownership_basis?.says || '', t.county_name || '', placeLabel(t.place_name) || '',
      t.state_code || '', t.counted ? 'yes' : 'not yet',
      ...months.flatMap((m) => (t.counted || view.estMonths.has(m) ? [p.months[m] || 0, p.monthShips[m] || 0] : ['', ''])),
      p.scrubber_calls + (p.est_calls || 0), p.ships.size, t.counted ? p.large : '']
  })
  const notes = [`# EarthAtlas scrubber-ship calls report, ${months[0]} to ${months.at(-1)} (months counted). earthatlas.org/ships/reports/scrubbers`,
    '# Calls: NOAA MarineCadastre AIS (CC0), counted by EarthAtlas. Scrubber-fitted: IMO GISIS Reg. 4.2 notifications or MEP Alliance lists.',
    '# Columns marked _estimated: months NOAA has not published yet, estimated from hourly positions (Powered by Global Fishing Watch, CC BY-NC 4.0); stops that could be at either of two neighbouring terminals are left out.']
  const csv = [...notes, head.join(','), ...rows.map((r) => r.map(q).join(','))].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = `earthatlas-scrubber-calls-${st.geo.toLowerCase()}-${months[0]}-to-${months.at(-1)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

// ── Where else these ships call (GFW port visits, worldwide) ─────────────────

function WorldPorts({ world, geo }) {
  const [all, setAll] = useState(false)
  if (!world) return null
  const cov = world.coverage || {}
  const who = geo === 'WA' ? 'the scrubber-fitted ships that called in Washington' : geo === 'BC' ? 'the scrubber-fitted ships that called in British Columbia' : 'the scrubber-fitted ships in this report'
  const maxC = Math.max(1, ...world.countries.map((x) => x.visits))
  const ports = all ? world.ports : world.ports.slice(0, 25)
  return (
    <section className={c.card} id="world">
      <div className={c.cardHead}>
        <h2 className={c.h2}>Where else these ships call</h2>
        <div className={c.note}>Port visits worldwide by {who}, in this period. <Src k="gfwPorts" /></div>
      </div>
      {cov.fetched < cov.ships && <div className={c.hint}>Port visits are loaded for {fmt(cov.fetched)} of these {fmt(cov.ships)} ships so far; the rest are being added.</div>}
      {world.countries.length === 0 ? <div className={c.none}>No port visits loaded yet for these ships.</div> : (
        <div className={c.worldGrid}>
          <div>
            <h3 className={c.h3}>By country</h3>
            <ul className={c.bars}>
              {world.countries.slice(0, 15).map((x) => (
                <li key={x.iso3 || 'x'}>
                  <span className={c.barLabel}>{x.country || x.iso3 || 'Unknown'}</span>
                  <span className={c.barTrack}><span className={c.barFill} style={{ width: `${(x.visits / maxC) * 100}%` }} /></span>
                  <span className={c.barNum}>{fmt(x.visits)}<small> · {fmt(x.ships)} ship{x.ships === 1 ? '' : 's'}</small></span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className={c.h3}>Most visited ports</h3>
            <table className={c.ships}>
              <thead><tr><th>Port</th><th>Country</th><th className={c.num}>Visits</th><th className={c.num}>Ships</th></tr></thead>
              <tbody>{ports.map((x) => (
                <tr key={x.key}>
                  <td>{x.port_name || x.gfw_name || x.port_label}</td>
                  <td>{x.country || x.iso3 || ''}</td>
                  <td className={c.num}>{fmt(x.visits)}</td>
                  <td className={c.num}>{fmt(x.ships)}</td>
                </tr>
              ))}</tbody>
            </table>
            {world.ports.length > 25 && <button className={c.preset} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${world.ports.length}`}</button>}
          </div>
        </div>
      )}
      <div className={c.shipsNote}>A port visit is Global Fishing Watch’s apparent port visit from AIS (entering within 3 km of an anchorage, stopping, leaving). Port names from
        the <a className={c.src} href="https://msi.nga.mil/Publications/WPI" target="_blank" rel="noopener noreferrer">World Port Index</a> where it lists the port, otherwise GFW’s own name.</div>
    </section>
  )
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Tile({ value, label, sub, src }) {
  return (
    <div className={c.tile}>
      <div className={c.tileValue}>{value}</div>
      <div className={c.tileLabel}>{label}</div>
      <div className={c.tileSub}>{sub}</div>
      <div className={c.tileSrc}>Source: {src}</div>
    </div>
  )
}

function Legend() {
  return <div className={c.legend}>{TYPES.map(([k, l, col]) => <span key={k}><i style={{ background: col }} />{l}</span>)}</div>
}

function Coverage({ data, view }) {
  const est = [...view.estMonths].sort()
  const missing = data.coverage.missing.filter((m) => !view.estMonths.has(m))
  const span = (ms) => (ms.length === 1 ? monthName(ms[0], 'long') : `${monthName(ms[0])} – ${monthName(ms.at(-1))}`)
  if (!missing.length && !est.length && !view.notCounted.length) return null
  return (
    <div className={c.coverage}>
      {est.length > 0 && <div><b>≈ {span(est)}: estimated.</b> NOAA publishes its minute-by-minute positions about three months late, so these
        months are estimated from hourly ship positions (<Src k="gfw" />{data.estimated?.through ? `, through ${data.estimated.through}` : ''}) and
        replaced by NOAA's counts when they arrive. Hourly positions can't separate terminals less than about 1 km from each other; those stops are left out of the rows.</div>}
      {missing.length > 0 && <div><b>No data yet: {span(missing)}.</b> These months show as empty, never as zero.</div>}
      {view.notCounted.length > 0 && <div><b>{view.notCounted.length} terminal{view.notCounted.length === 1 ? ' is' : 's are'} not in NOAA's count yet</b> (added
        recently: cruise, container, ro-ro, Columbia River and Grays Harbor berths). Their NOAA months show “·”, never zero.</div>}
    </div>
  )
}

const CH = { w: 880, h: 240, l: 44, r: 8, t: 12, b: 34 }
function MonthChart({ view, months, covered, active, hover, setHover, onPick }) {
  const max = Math.max(1, ...months.map((m) => view.perMonth[m]?.total || 0))
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const iw = CH.w - CH.l - CH.r, ih = CH.h - CH.t - CH.b
  const bw = iw / months.length
  const y = (v) => CH.t + ih - (v / top) * ih
  const ticks = []; for (let v = 0; v <= top; v += step) ticks.push(v)
  return (
    <div className={c.chartWrap}>
      <svg viewBox={`0 0 ${CH.w} ${CH.h}`} className={c.chart} role="img" aria-label="Scrubber-ship calls by month, stacked by ports, terminals and refineries">
        {ticks.map((v) => <g key={v}><line x1={CH.l} x2={CH.w - CH.r} y1={y(v)} y2={y(v)} className={c.grid} /><text x={CH.l - 8} y={y(v) + 4} className={c.axis} textAnchor="end">{fmt(v)}</text></g>)}
        {months.map((m, i) => {
          const x = CH.l + i * bw, w = Math.max(4, bw - 6)
          const pm = view.perMonth[m] || {}
          let acc = 0
          const isEst = view.estMonths.has(m)
          const isCov = covered.has(m) || isEst
          return (
            <g key={m} className={c.barG} onMouseEnter={() => setHover(m)} onMouseLeave={() => setHover(null)} onClick={() => isCov && onPick(m)} style={{ cursor: isCov ? 'pointer' : 'default' }}>
              <rect x={x} y={CH.t} width={bw} height={ih} fill="transparent" />
              {!isCov && <rect x={x + 3} y={CH.t + ih - 26} width={w} height={26} rx={4} className={c.missing} />}
              {isCov && TYPES.map(([k, , col]) => {
                const v = pm[k] || 0
                if (!v) return null
                const y1 = y(acc + v), h = y(acc) - y1
                acc += v
                return <rect key={k} x={x + 3} y={y1 + 1} width={w} height={Math.max(0, h - 2)} rx={acc === pm.total ? 4 : 1} fill={col} opacity={(active && active !== m ? 0.35 : 1) * (isEst ? 0.5 : 1)} />
              })}
              <text x={x + bw / 2} y={CH.h - CH.b + 16} className={c.axis} textAnchor="middle">{monthShort(m)}</text>
              {(i === 0 || m.endsWith('-01')) && <text x={x + bw / 2} y={CH.h - CH.b + 29} className={c.axisYear} textAnchor="middle">{m.slice(0, 4)}</text>}
            </g>
          )
        })}
        {(() => {
          const miss = months.map((m, i) => [m, i]).filter(([m]) => !covered.has(m) && !view.estMonths.has(m))
          if (!miss.length) return null
          const x0 = CH.l + miss[0][1] * bw, x1 = CH.l + (miss.at(-1)[1] + 1) * bw
          return <text x={(x0 + x1) / 2} y={CH.t + ih - 34} className={c.missingLabel} textAnchor="middle">Not counted yet</text>
        })()}
      </svg>
      {hover && (
        <div className={c.tip} style={{ left: `${((CH.l + (months.indexOf(hover) + 0.5) * bw) / CH.w) * 100}%` }}>
          <div className={c.tipHead}>{monthName(hover, 'long')}{view.estMonths.has(hover) ? ' (estimated)' : ''}</div>
          {covered.has(hover) || view.estMonths.has(hover) ? <>
            <div className={c.tipTotal}>{view.estMonths.has(hover) ? '≈' : ''}{fmt(view.perMonth[hover]?.total || 0)} scrubber-ship calls</div>
            {TYPES.map(([k, l, col]) => (view.perMonth[hover]?.[k] ? <div key={k} className={c.tipRow}><i style={{ background: col }} />{l}<b>{fmt(view.perMonth[hover][k])}</b></div> : null))}
          </> : <div className={c.tipRow}>Not counted yet</div>}
        </div>
      )}
    </div>
  )
}

function niceStep(max) {
  const raw = max / 4, p = 10 ** Math.floor(Math.log10(raw)), n = raw / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p
}

function DayChart({ month, days, keys, onClose }) {
  const [y, mm] = month.split('-').map(Number)
  const n = new Date(Date.UTC(y, mm, 0)).getUTCDate()
  const per = {}
  for (const d of days || []) if (keys.has(d.terminal_key)) per[d.day] = (per[d.day] || 0) + d.scrubber_calls
  const vals = Array.from({ length: n }, (_, i) => per[`${month}-${String(i + 1).padStart(2, '0')}`] || 0)
  const max = Math.max(1, ...vals)
  return (
    <div className={c.days}>
      <div className={c.daysHead}><b>{monthName(month, 'long')}, day by day</b><button className={c.close} onClick={onClose}>Close</button></div>
      {!days ? <div className={c.loading}>Loading days…</div> : (
        <div className={c.dayBars}>
          {vals.map((v, i) => (
            <div key={i} className={c.dayCol} title={`${monthShort(month)} ${i + 1}: ${v} scrubber-ship call${v === 1 ? '' : 's'}`}>
              <div className={c.dayBar} style={{ height: `${(v / max) * 100}%` }} />
              <div className={c.dayNum}>{(i + 1) % 5 === 1 ? i + 1 : ''}</div>
            </div>
          ))}
        </div>
      )}
      <div className={c.hint}>A call is counted on the day the ship stopped at the berth (UTC).</div>
    </div>
  )
}

function Spark({ months, values }) {
  const max = Math.max(1, ...months.map((m) => values[m] || 0))
  return (
    <svg viewBox={`0 0 ${months.length * 6} 20`} className={c.spark} aria-hidden="true">
      {months.map((m, i) => { const h = ((values[m] || 0) / max) * 18; return <rect key={m} x={i * 6} y={20 - h} width={4} height={h || 0.5} rx={1} /> })}
    </svg>
  )
}

function PlaceTable({ view, open, setOpen, months }) {
  const isOpen = (k) => open.includes(k)
  const toggle = (k) => setOpen(isOpen(k) ? open.filter((x) => x !== k) : [...open, k])
  const rows = []
  const states = [...view.tree.entries()].sort()
  const showStates = states.length > 1
  for (const [sk, counties] of states) {
    const stateTerms = [...counties.values()].flatMap((p) => [...p.values()].flat())
    const sKey = `s:${sk}`
    const sOpen = !showStates || isOpen(sKey)
    if (showStates) rows.push(<Row key={sKey} level={0} label={STATE_NAME[sk] || sk} sum={sumOf(view, stateTerms)} months={months} open={sOpen} onToggle={() => toggle(sKey)} />)
    if (!sOpen) continue
    const cs = [...counties.entries()].map(([ck, places]) => [ck, places, sumOf(view, [...places.values()].flat())]).sort((a, b) => b[2].scrubber_calls - a[2].scrubber_calls || a[0].localeCompare(b[0]))
    for (const [ck, places, csum] of cs) {
      const cKey = `c:${sk}:${ck}`
      rows.push(<Row key={cKey} level={showStates ? 1 : 0} label={ck} sum={csum} months={months} open={isOpen(cKey)} onToggle={() => toggle(cKey)} />)
      if (!isOpen(cKey)) continue
      const ps = [...places.entries()].map(([pk, list]) => [pk, list, sumOf(view, list)]).sort((a, b) => b[2].scrubber_calls - a[2].scrubber_calls)
      for (const [pk, list, psum] of ps) {
        const pKey = `p:${sk}:${ck}:${pk}`
        const single = !pk
        if (!single) rows.push(<Row key={pKey} level={(showStates ? 2 : 1)} label={pk} sum={psum} months={months} open={isOpen(pKey)} onToggle={() => toggle(pKey)} />)
        if (!single && !isOpen(pKey)) continue
        const ts = [...list].sort((a, b) => view.perT.get(b.key).scrubber_calls - view.perT.get(a.key).scrubber_calls || a.name.localeCompare(b.name))
        for (const t of ts) {
          const tKey = `t:${t.key}`
          rows.push(<TerminalRow key={tKey} level={(showStates ? 3 : 2) - (single ? 1 : 0)} t={t} view={view} months={months} open={isOpen(tKey)} onToggle={() => toggle(tKey)} />)
        }
      }
    }
  }
  return (
    <div className={c.tableWrap}>
      <table className={c.table}>
        <thead><tr>
          <th className={c.thPlace}>Place</th><th>Scrubber-ship calls</th><th>Scrubber ships</th><th>Large-ship calls</th><th>Share</th><th className={c.thSpark}>By month</th>
        </tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  )
}

function Row({ level, label, sum, months, open, onToggle }) {
  return (
    <tr className={c[`lvl${level}`]}>
      <td className={c.place} style={{ paddingLeft: 10 + level * 18 }}>
        <button className={c.toggle} onClick={onToggle} aria-expanded={open}><Chev open={open} />{label}</button>
        <span className={c.count}>{sum.n} terminal{sum.n === 1 ? '' : 's'}{sum.counted < sum.n ? `, ${sum.n - sum.counted} not counted yet` : ''}</span>
      </td>
      {sum.counted ? <>
        <td className={c.num}><b>{fmt(sum.scrubber_calls)}</b></td>
        <td className={c.num}>{fmt(sum.ships.size)}</td>
        <td className={c.num}>{fmt(sum.large)}</td>
        <td className={c.num}>{pct(sum.scrubber_calls, sum.large)}</td>
        <td><Spark months={months} values={sum.months} /></td>
      </> : <td colSpan={5} className={c.notCounted}>Not counted yet</td>}
    </tr>
  )
}

function TerminalRow({ level, t, view, months, open, onToggle }) {
  const p = view.perT.get(t.key)
  const ships = [...p.ships.values()].sort((a, b) => b.calls - a.calls || String(a.name).localeCompare(String(b.name)))
  return (
    <>
      <tr className={c.termRow}>
        <td className={c.place} style={{ paddingLeft: 10 + level * 18 }}>
          <button className={c.toggle} onClick={onToggle} aria-expanded={open} disabled={!t.counted}><Chev open={open} />{t.name}</button>
          <span className={c.meta}>
            <a href={`/ships?tl=${encodeURIComponent(t.key)}`} className={c.mapLink}>{kindWords(t.kind)}</a>
            {' · '}<span className={c.own} style={{ '--own': TYPE_COLOR[typeOf(t)] }} title={t.ownership_basis?.says ? `Owner per ${t.ownership_basis.source === 'usace-docks' ? `USACE dock record ${t.ownership_basis.ref}` : 'EarthAtlas terminal list'}: ${t.ownership_basis.says}` : 'Owner not established'}>
              {TYPE_SINGULAR[typeOf(t)]}{t.ownership && typeOf(t) !== 'ports' ? ` (${OWN_LABEL[t.ownership].toLowerCase()})` : ''}</span>
          </span>
        </td>
        {t.counted ? <>
          <td className={c.num}><b>{fmt(p.scrubber_calls)}</b></td>
          <td className={c.num}>{fmt(p.ships.size)}</td>
          <td className={c.num}>{fmt(p.large)}</td>
          <td className={c.num}>{pct(p.scrubber_calls, p.large)}</td>
          <td><Spark months={months} values={p.months} /></td>
        </> : <td colSpan={5} className={c.notCounted}>Not counted yet: berths added {t.country === 'US' && t.lat < 47 ? '(Columbia River / Grays Harbor) ' : ''}after the latest count</td>}
      </tr>
      {open && t.counted && (
        <tr className={c.shipsRow}><td colSpan={6}>
          {ships.length === 0 ? <div className={c.none}>No scrubber-fitted ship called here in this period.</div> : (
            <table className={c.ships}>
              <thead><tr><th>Ship</th><th>IMO</th><th>Calls</th><th>Scrubber listed by</th><th className={c.thSpark}>By month</th></tr></thead>
              <tbody>{ships.map((s) => (
                <tr key={s.vessel_id}>
                  <td><a href={`/ships?v=${s.vessel_id}`} className={c.shipLink}>{s.name || 'Unnamed'}</a></td>
                  <td className={c.mono}>{s.ais_imo || '–'}</td>
                  <td className={c.num}>{fmt(s.calls)}</td>
                  <td>
                    {s.gisis && <Src k="gisis"><span className={c.badge}>IMO</span></Src>}
                    {s.mep && <Src k="mep"><span className={c.badge}>MEP Alliance{s.mep_inferred && !s.gisis ? ' (inferred)' : ''}</span></Src>}
                  </td>
                  <td><Spark months={months} values={s.months} /></td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <div className={c.shipsNote}>Calls from <Src k="noaa">NOAA AIS</Src>, matched to the ship by MMSI at the time of the call (and IMO when broadcast).</div>
        </td></tr>
      )}
    </>
  )
}

const Chev = ({ open }) => (
  <svg className={c.chev} viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>
    <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

function Method({ data }) {
  const s = data.scrubberSet
  return (
    <section className={c.method} id="method">
      <h2 className={c.h2}>How this is counted</h2>
      <dl className={c.defs}>
        <dt>A call</dt>
        <dd>A ship stopped (under 0.5 knots) within a berth's radius for at least 15 minutes, read from minute-by-minute AIS positions
          published by <Src k="noaa" />. A gap of more than 6 hours starts a new call. Every call counts: a cruise ship that docks every week is
          one call a week.</dd>
        <dt>Scrubber-fitted</dt>
        <dd>{fmt(s.vessels)} ships in EarthAtlas: {fmt(s.gisis)} with a scrubber notified to the IMO under MARPOL Annex VI Regulation 4.2
          (<Src k="gisis">IMO GISIS</Src>), {fmt(s.mep)} on the <Src k="mep" /> ({fmt(s.mep_inferred)} matched by name and size only, marked
          "inferred"). A ship on neither list may still have a scrubber. A call by a scrubber-fitted ship does not show that the scrubber was
          running at the berth.</dd>
        <dt>Large-ship calls</dt>
        <dd>Calls by ships whose AIS ship type is passenger, cargo or tanker. Tugs, fishing boats and pleasure craft are left out of the share.</dd>
        <dt>Terminals and ownership</dt>
        <dd>Berth positions from <Src k="usace" />, WA Ecology, BC Ports and Terminals and OpenStreetMap. A port-authority terminal is owned by a
          public port district (Port of Seattle, Port of Tacoma…) even when a private company operates it; private docks include refinery wharves.
          Owner from the USACE dock record unless a checked source says otherwise. The report groups facilities as <b>Ports</b> (port-district
          docks), <b>Refineries</b> (refinery docks) and <b>Terminals</b> (every other dock).</dd>
        <dt>Places</dt>
        <dd>County and city or town from the <Src k="census" /> at each terminal's position. "Unincorporated" means outside any city or town.</dd>
        <dt>Coverage</dt>
        <dd>Months counted: {data.coverage.months.length ? `${monthName(data.coverage.months[0])} – ${monthName(data.coverage.months.at(-1))}` : 'none in this period'}.
          NOAA publishes detailed positions a few months after the fact; newer months are added as they appear.</dd>
      </dl>
    </section>
  )
}
