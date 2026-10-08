/**
 * /ships/reports/scrubbers: scrubber-fitted ships calling at terminals (docs/SHIPS_SCRUBBER_REPORT.md; Josh 2026-10-07, asked for by
 * Friends of the San Juans for the WA legislature). A standalone report, not tied to the map: headline numbers for a period, a monthly
 * chart that drills to days, port-authority vs private split, and a place table (state → county → city → terminal → ships).
 * Data: /api/ships?op=scrubberReport (lib/ships/scrubberReport.js). URL state: from, to, geo, open (row keys), m (drilled month).
 */
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import BuiltByCredit from '../components/BuiltByCredit.jsx'
import { ShipLoader } from '../components/panel'
import { kindWords } from './terminalIcons.js'
import c from './ScrubberReport.module.css'

import { SCRUBBER_REPORT } from './scrubberReportDefaults.js'
// Lovel's own words for what the report covers (port-authority docks, private terminals, refinery docks), and what is counted: calls.
const AREA_WORDS = { WA: 'Washington', BC: 'British Columbia', ALL: 'Washington and British Columbia' }
const reportTitle = (geo) => `Scrubber-fitted ship calls at ${AREA_WORDS[geo] || AREA_WORDS.WA} ports, terminals and refineries`
const DEFAULT = { from: SCRUBBER_REPORT.from, to: SCRUBBER_REPORT.to, geo: 'WA' }
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
/** Which port a port-district dock belongs to, from its owner as recorded (USACE owner text, or the checked source). */
const titleCase = (x) => x.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bOf\b/g, 'of')
export const portOf = (t) => {
  const says = String(t.ownership_basis?.says || '')
  const auth = /(Vancouver Fraser Port Authority|Greater Victoria Harbour Authority|Nanaimo Port Authority)/i.exec(says)
  if (auth) return auth[1]
  const m = /port of ([a-z .'-]+?)(?:\s+berth\b|[.,;(]|$)/i.exec(says)
  const name = m ? `Port of ${titleCase(m[1].trim())}` : (t.operator || 'Other port')
  return name === 'Port of Vancouver' ? 'Port of Vancouver USA' : name   // the Washington port's own name (not Vancouver, BC)
}
export const typeOf = (t) => (t.kind === 'refinery_dock' ? 'refineries' : t.ownership === 'port_authority' ? 'ports' : 'terminals')
// Scrubber type, from the IMO notifications (Josh 2026-10-08: ships with no stated type appear as "type not reported").
const LOOP = [
  ['open', 'Open loop', '#c2410c', 'washwater discharged to the sea'],
  ['hybrid', 'Hybrid', '#2563eb', 'can run open or closed'],
  ['closed', 'Closed loop', '#15803d', 'washwater kept on board for treatment'],
  ['not_reported', 'Type not reported', '#6b7280', 'no scrubber type in the IMO notification, or listed by MEP Alliance only'],
]
const LOOP_LABEL = Object.fromEntries(LOOP.map(([k, l]) => [k, l]))
const loopOfShip = (a) => a.info?.scrubber?.loop || 'not_reported'
const KINDS_UI = [['cruise', 'Cruise and passenger'], ['container', 'Container'], ['tanker', 'Tankers'], ['bulk', 'Bulk and general cargo'], ['other', 'Other']]
const kindOfShip = (a) => {
  const k = a.info?.kind
  if (!k) return 'other'
  if (k.group === 'passenger') return 'cruise'
  if (/container/i.test(k.label || '')) return 'container'
  if (k.group === 'tanker') return 'tanker'
  if (k.group === 'cargo') return 'bulk'
  return 'other'
}
const operatorOf = (a) => a.info?.operator?.name || null
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
    op: sp.get('op') || null,
    focus: sp.get('focus') || null,
    t: sp.get('t') || null,   // a terminal to open in the place table (the terminal card's link)
  }
}

// localhost only: ?data=prod reads production's numbers through the dev proxy (vite.config.js) so a change can be checked on real data.
const API = import.meta.env.DEV && new URLSearchParams(window.location.search).get('data') === 'prod' ? '/__prodread/api/ships' : '/api/ships'

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

  useEffect(() => {
    const w = data ? focusWords(st.focus, data.terminals, AREA_WORDS[st.geo] || AREA_WORDS.WA) : null
    document.title = `${w ? `Scrubber-fitted ship calls at ${w[0]}` : reportTitle(st.geo)} · EarthAtlas Ships`
  }, [st.geo, st.focus, data])
  useEffect(() => {
    const sp = new URLSearchParams()
    if (st.from !== DEFAULT.from) sp.set('from', st.from)
    if (st.to !== DEFAULT.to) sp.set('to', st.to)
    if (st.geo !== DEFAULT.geo) sp.set('geo', st.geo)
    if (st.open.length) sp.set('open', st.open.join(','))
    if (st.m) sp.set('m', st.m)
    if (st.op) sp.set('op', st.op)
    if (st.focus) sp.set('focus', st.focus)
    if (API !== '/api/ships') sp.set('data', 'prod')
    const qs = sp.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
  }, [st])
  useEffect(() => {
    setData(null); setErr(null)
    if (edition) {
      fetch(`${API}?op=scrubberEdition&id=${encodeURIComponent(edition)}`)
        .then((r) => r.json()).then((j) => {
          if (j.error) return setErr(j.error)
          setEd({ id: j.id, title: j.title, params: j.params, created_at: j.created_at })
          setData(j.payload)
        }).catch((e) => setErr(String(e)))
      return
    }
    fetch(`${API}?op=scrubberReport&from=${st.from}&to=${st.to}`)
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
    fetch(`${API}?op=scrubberReportDays&month=${st.m}`).then((r) => r.json()).then((j) => setDays(j.days || [])).catch(() => setDays([]))
  }, [st.m, edition, data])

  const focusKeys = useMemo(() => (data && st.focus ? data.terminals.filter((t) => matchFocus(t, st.focus)).map((t) => t.key).join(',') : ''), [data, st.focus])
  useEffect(() => {
    setWorld(null)
    if (edition) { if (data?.world && !st.focus) setWorld(data.world[st.geo] || null); return }   // an edition holds whole areas only
    fetch(`${API}?op=scrubberWorldPorts&from=${st.from}&to=${st.to}&geo=${st.geo}${focusKeys ? `&terminals=${encodeURIComponent(focusKeys)}` : ''}`)
      .then((r) => r.json()).then((j) => setWorld(j.error ? null : j)).catch(() => {})
  }, [edition, data, st.from, st.to, st.geo, st.focus, focusKeys])

  const view = useMemo(() => (data ? build(data, st.geo, st.focus) : null), [data, st.geo, st.focus])
  const focusOpts = useMemo(() => (data ? focusOptions(data, st.geo) : []), [data, st.geo])
  const fw = view ? focusWords(st.focus, view.terms, AREA_WORDS[st.geo] || AREA_WORDS.WA) : null
  // ?t=<terminal>: open its row in the place table (with its county and city) and bring it into view, once.
  useEffect(() => {
    if (!view || !st.t) return
    const t = view.terms.find((x) => x.key === st.t)
    if (!t) { set({ t: null }); return }
    const [sk, ck, pk] = placePath(t)
    const keys = [...(view.tree.size > 1 ? [`s:${sk}`] : []), `c:${sk}:${ck}`, ...(pk ? [`p:${sk}:${ck}:${pk}`] : []), `t:${t.key}`]
    setSt((s0) => ({ ...s0, t: null, open: [...new Set([...s0.open, ...keys])] }))
    setTimeout(() => document.getElementById(`row-${t.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300)
  }, [view, st.t])

  return (
    <div className={c.page}>
      <header className={c.top}>
        <a href="/ships" className={c.brand}>EarthAtlas <span>Ships</span></a>
        <button className={c.print} onClick={() => window.print()} disabled={!view}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" />
          </svg>
          Print or save as PDF
        </button>
      </header>
      <main className={c.main}>
        <div className={c.kicker}>Report</div>
        <h1 className={c.title}>{fw ? `Scrubber-fitted ship calls at ${fw[0]}` : reportTitle(st.geo)}</h1>
        <p className={c.lede}>
          How often ships fitted with exhaust gas cleaning systems, better known as scrubbers, called at ports, terminals and refinery docks,
          month by month. A call is a ship stopped at a berth, counted minute by minute from <Src k="noaa">NOAA's AIS ship positions</Src>.
          A ship counts as scrubber-fitted when it is in the <Src k="gisis">IMO's scrubber notifications</Src> or
          on the <Src k="mep">MEP Alliance lists</Src>. A call by a scrubber-fitted ship does not show that the scrubber was running at the berth.
        </p>

        {data && <ReportFacts data={data} geo={st.geo} ed={ed} edition={edition} areaLine={fw?.[1]}
          query={(() => { const q = new URLSearchParams(); if (st.geo !== DEFAULT.geo) q.set('geo', st.geo); if (st.focus) q.set('focus', st.focus)
            if (!edition && (st.from !== DEFAULT.from || st.to !== DEFAULT.to)) { q.set('from', st.from); q.set('to', st.to) }
            const x = q.toString(); return x ? `?${x}` : '' })()} />}
        <div className={c.controls}>
          <div className={c.seg} role="tablist" aria-label="Area">
            {GEOS.map(([g, l]) => (
              <button key={g} role="tab" aria-selected={st.geo === g} className={st.geo === g ? c.segOn : c.segBtn} onClick={() => set({ geo: g, open: [], focus: null, op: null })}>{l}</button>
            ))}
          </div>
          <label className={c.focus}>Focus Geography:
            <select value={st.focus || ''} onChange={(e) => set({ focus: e.target.value || null, open: [], op: null, m: null })}>
              <option value="">Whole area</option>
              {focusOpts.map(([g, xs]) => <optgroup key={g} label={g}>{xs.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>)}
            </select>
          </label>
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
        {!data && !err && <ShipLoader kind="report" />}

        {view && <>
          <Coverage data={data} view={view} />

          <section className={c.tiles} aria-label="Headline numbers">
            <Tile value={fmt(view.tot.scrubber_calls + (view.tot.est_calls || 0))} label="Scrubber-ship calls"
              sub={`at ${fmt(view.terminalsWithScrubber)} terminals${view.tot.est_calls ? `; ≈${fmt(view.tot.est_calls)} of them estimated` : ''}`}
              src={<><Src k="noaa">NOAA AIS</Src>{view.tot.est_calls ? <> · <Src k="gfw">Global Fishing Watch</Src></> : null}</>} />
            <Tile value={fmt(view.shipIds.size)} label="Scrubber-fitted ships" sub="different ships that made those calls" src={<><Src k="gisis">IMO</Src> · <Src k="mep">MEP Alliance</Src></>} />
            <Tile value={pct(view.tot.scrubber_calls, view.tot.large)} label="Share of large-ship calls" sub={`${fmt(view.tot.scrubber_calls)} of ${fmt(view.tot.large)} calls by passenger, cargo and tanker ships${view.tot.est_calls ? ', not counting estimates' : ''}`} src={<Src k="noaa">AIS ship type</Src>} />
            <Tile value={fmt((view.byOwn.ports?.scrubber_calls || 0) + (view.byOwn.ports?.est_calls || 0))} label="At ports"
              sub={`${fmt((view.byOwn.terminals?.scrubber_calls || 0) + (view.byOwn.terminals?.est_calls || 0))} at other terminals, ${fmt((view.byOwn.refineries?.scrubber_calls || 0) + (view.byOwn.refineries?.est_calls || 0))} at refinery docks`} src={<Src k="usace">dock owner: USACE</Src>} />
            <LoopTile view={view} />
          </section>

          <section className={`${c.card} ${c.flow} ${c.wide}`}>
            <div className={c.cardHead}>
              <h2 className={c.h2}>Each port, terminal and refinery, month by month</h2>
            </div>
            <div className={c.note}>Each cell: the number of <b>calls</b> by scrubber-fitted ships, and under it in grey the number of <span className={c.shipsKey}>different ships</span> that made them. Totals count each ship once.</div>
            <Matrix view={view} months={data.period.months} covered={new Set(data.coverage.months)} />
          </section>

          <section className={c.card}>
            <div className={c.cardHead}>
              <h2 className={c.h2}>Scrubber-ship calls by month</h2>
              <Legend />
            </div>
            <MonthChart view={view} months={data.period.months} covered={new Set(data.coverage.months)} active={st.m} hover={hover} setHover={setHover}
              onPick={(m) => set({ m: st.m === m ? null : m })} />
            <div className={`${c.hint} ${c.noPrint}`}>Select a month to see it day by day.</div>
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

          <section className={`${c.card} ${c.flow}`}>
            <div className={c.cardHead}>
              <h2 className={c.h2}>By place</h2>
              <div className={c.note}>County and city from the <Src k="census">US Census Bureau</Src><span className={c.noPrint}>; open a row for its terminals and ships</span>.</div>
            </div>
            <PlaceTable view={view} open={st.open} setOpen={(open) => set({ open })} months={data.coverage.months} />
          </section>

          {view.shipList.length > 0 && Object.keys(view.info).length > 0 && <>
            <Operators view={view} onPick={(op) => { set({ op }); document.getElementById('ships')?.scrollIntoView({ behavior: 'smooth' }) }} />
            <Ships view={view} months={data.period.months} op={st.op} setOp={(op) => set({ op })} />
          </>}

          <WorldPorts world={world} geo={st.geo} />

          <Method data={data} world={world} />
        </>}
        <BuiltByCredit variant="light" className={c.builtBy} />
      </main>
    </div>
  )
}

// ── Data shaping (pure) ─────────────────────────────────────────────────────

/** A terminal's place in the place table: [state, county, city or town ('' when none)]. */
const placePath = (t) => {
  const sk = t.state_code || t.country
  const ck = t.county_name || (sk === 'BC' ? 'British Columbia' : 'County not set')
  const pk = placeLabel(t.place_name) || (t.county_name ? `Unincorporated ${t.county_name.replace(/ County$/, '')} County` : '')
  return [sk, ck, pk]
}

// ── Focus: narrow the whole report to one port, county, city or town, type of facility, or one facility (Josh 2026-10-08) ──
// focus = 'port:<name>' | 'county:<name>' | 'place:<state>|<county>|<place>' | 'type:<ports|terminals|refineries>' | 'term:<key>'
const TYPE_PLURAL = { ports: 'ports', terminals: 'terminals', refineries: 'refineries' }
function matchFocus(t, focus) {
  if (!focus) return true
  const [kind, ...rest] = focus.split(':'); const v = rest.join(':')
  if (kind === 'port') return t.ownership === 'port_authority' && portOf(t) === v
  if (kind === 'county') return t.county_name === v
  if (kind === 'place') { const [sk, ck, pk] = placePath(t); return `${sk}|${ck}|${pk}` === v }
  if (kind === 'type') return typeOf(t) === v
  if (kind === 'term') return t.key === v
  return true
}
/** Words for a focus: [title phrase, area line]. */
function focusWords(focus, terms, areaName) {
  if (!focus) return null
  const [kind, ...rest] = focus.split(':'); const v = rest.join(':')
  if (kind === 'port') return [`the ${v.replace(/^Port of /, 'Port of ')}`, `${v}, ${areaName}`]
  if (kind === 'county') return [`${v} ports, terminals and refineries`, `${v}, ${areaName}`]
  if (kind === 'place') { const pk = v.split('|')[2]; return [`${pk} ports, terminals and refineries`, `${pk}, ${areaName}`] }
  if (kind === 'type') return [`${areaName} ${TYPE_PLURAL[v] || v}`, `${areaName}: ${TYPE_PLURAL[v] || v} only`]
  if (kind === 'term') { const t = terms.find((x) => x.key === v); return t ? [t.name, `${t.name}, ${areaName}`] : null }
  return null
}
/** The focus choices for this area: only what the report has data for. */
function focusOptions(data, geo) {
  const inGeo = (t) => geo === 'ALL' || (geo === 'WA' ? t.state_code === 'WA' : t.state_code === 'BC')
  const estKeys = new Set((data.estimated?.cells || []).map((r) => r.terminal_key))
  const ts = data.terminals.filter(inGeo).filter((t) => t.counted || estKeys.has(t.key) || (t.estimatedOnly && (data.estimated?.allMonths || []).length > 0))
  const uniq = (xs) => [...new Map(xs.map((x) => [x[0], x])).values()].sort((a, b) => a[1].localeCompare(b[1]))
  return [
    ['Ports', uniq(ts.filter((t) => t.ownership === 'port_authority').map((t) => [`port:${portOf(t)}`, portOf(t)]))],
    ['Counties', uniq(ts.filter((t) => t.county_name).map((t) => [`county:${t.county_name}`, t.county_name]))],
    ['Cities and towns', uniq(ts.map((t) => { const [sk, ck, pk] = placePath(t); return pk && !/^Unincorporated/.test(pk) ? [`place:${sk}|${ck}|${pk}`, pk] : null }).filter(Boolean))],
    ['Type of facility', TYPES.map(([k, l]) => [`type:${k}`, l]).filter(([k]) => ts.some((t) => `type:${typeOf(t)}` === k))],
    ['One facility', uniq(ts.map((t) => [`term:${t.key}`, t.name]))],
  ].filter(([, xs]) => xs.length)
}

function build(data, geo, focus = null) {
  const inGeo = (t) => geo === 'ALL' || (geo === 'WA' ? t.state_code === 'WA' : t.state_code === 'BC')
  const est = data.estimated
  const estKeys = new Set((est?.cells || []).map((r) => r.terminal_key))
  // Only facilities we have numbers for: counted from NOAA's AIS, or estimated from hourly positions.
  // (a terminal beyond NOAA's reach has data whenever hourly estimates exist for the period, even when they hold no scrubber calls)
  const terms = data.terminals.filter(inGeo).filter((t) => t.counted || estKeys.has(t.key) || (t.estimatedOnly && (est?.allMonths || []).length > 0))
    .filter((t) => matchFocus(t, focus))
  const keys = new Set(terms.map((t) => t.key))
  const byKey = new Map(terms.map((t) => [t.key, t]))
  const own = (t) => t.ownership || 'unknown'
  const zero = () => ({ calls: 0, large: 0, scrubber_calls: 0 })
  const tot = zero()
  const perT = new Map(terms.map((t) => [t.key, { ...zero(), months: {}, monthShips: {}, ships: new Map(), estM: new Set() }]))
  const estCol = { all: new Set() }   // columns (overall / per type) that include an estimated number
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
  // Estimated stops (≈): months after NOAA's latest, and terminals NOAA's receivers don't reach. Never in the large-ship share.
  const estMonths = new Set(est?.months || [])
  for (const r of est?.cells || []) {
    if (!keys.has(r.terminal_key)) continue
    const p = perT.get(r.terminal_key)
    p.est_calls = (p.est_calls || 0) + r.scrubber_calls
    p.estM.add(r.month)
    tot.est_calls = (tot.est_calls || 0) + r.scrubber_calls
    p.months[r.month] = (p.months[r.month] || 0) + r.scrubber_calls
    p.monthShips[r.month] = r.scrubber_ships
    const pm = perMonth[r.month] ||= { total: 0 }
    const ty = typeOf(byKey.get(r.terminal_key))
    pm[ty] = (pm[ty] || 0) + r.scrubber_calls
    pm.total += r.scrubber_calls
    estCol.all.add(r.month); (estCol[ty] ||= new Set()).add(r.month)
    if (ty === 'ports') (estCol[`port:${portOf(byKey.get(r.terminal_key))}`] ||= new Set()).add(r.month)
  }
  const shipIds = new Set()
  const shipsBy = {}   // group key ('all' | type) → month → Set of ships, so a column's ships are counted once
  const addShip = (g, m, id) => ((shipsBy[g] ||= {})[m] ||= new Set()).add(id)
  for (const s of [...data.ships, ...(est?.ships || [])]) {
    if (!keys.has(s.terminal_key)) continue
    shipIds.add(s.vessel_id)
    const ty = typeOf(byKey.get(s.terminal_key))
    const groups = ty === 'ports' ? ['all', ty, `port:${portOf(byKey.get(s.terminal_key))}`] : ['all', ty]
    for (const g of groups) { addShip(g, s.month, s.vessel_id); addShip(g, '*', s.vessel_id) }
    const m = perT.get(s.terminal_key).ships
    const e = m.get(s.vessel_id) || { ...s, calls: 0, months: {} }
    e.calls += s.calls; e.months[s.month] = (e.months[s.month] || 0) + s.calls
    m.set(s.vessel_id, e)
  }
  const byOwn = {}
  for (const t of terms) {
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
    const [sk, ck, pk] = placePath(t)
    const s = tree.get(sk) || tree.set(sk, new Map()).get(sk)
    const co = s.get(ck) || s.set(ck, new Map()).get(ck)
    const pl = co.get(pk) || co.set(pk, []).get(pk)
    pl.push(t)
  }
  // Each scrubber ship in this area: its calls (counted + estimated), where, by month, with what we hold about it.
  const info = data.shipInfo || {}
  const shipAgg = new Map()
  for (const t of terms) {
    for (const [id, e] of perT.get(t.key).ships) {
      const a = shipAgg.get(id) || shipAgg.set(id, { id, name: info[id]?.name || e.name, info: info[id] || null, calls: 0, months: {}, where: [] }).get(id)
      a.calls += e.calls
      for (const [m, v] of Object.entries(e.months)) a.months[m] = (a.months[m] || 0) + v
      a.where.push([t, e.calls])
    }
  }
  for (const a of shipAgg.values()) a.where.sort((x, y) => y[1] - x[1])
  const shipList = [...shipAgg.values()].sort((a, b) => b.calls - a.calls || String(a.name).localeCompare(String(b.name)))
  return { terms, keys, byKey, perT, perMonth, tot, shipIds, shipsBy, byOwn, tree, estMonths, est, estCol, info, shipList,
    estAll: new Set(est?.allMonths || []), counted: terms.filter((t) => t.counted),
    terminalsWithScrubber: terms.filter((t) => perT.get(t.key).scrubber_calls + (perT.get(t.key).est_calls || 0) > 0).length }
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
  if (dim) return <td className={c.mCellNa} title="No data for this month">·</td>
  return (
    <td className={`${calls ? c.mCell : c.mCellZero}${est ? ` ${c.mEst}` : ''}`} title={est ? 'Estimated from hourly positions (≈)' : undefined}>
      <div className={c.mCalls}>{est && calls ? '≈' : ''}{calls ? fmt(calls) : '0'}</div>
      {calls > 0 && <div className={c.mShips} title={`${fmt(ships)} different ship${ships === 1 ? '' : 's'}`}>{fmt(ships)}</div>}
    </td>
  )
}

function Matrix({ view, months, covered }) {
  const [hideZero, setHideZero] = useState(true)
  const est = view.estMonths
  const shown = (m) => covered.has(m) || est.has(m)
  // A month is blank ("·") only where there is no data at all: NOAA hasn't published it and no estimate exists. A terminal NOAA
  // doesn't reach shows its estimates in every month.
  const rowShown = (t, m) => (t.estimatedOnly ? view.estAll.has(m) : shown(m))
  const cellFor = (t, m, calls, ships, ty) => {
    const isEst = t ? (est.has(m) || view.perT.get(t.key).estM.has(m)) : (est.has(m) || view.estCol[ty || 'all']?.has(m))
    return <Cell key={m} dim={t ? !rowShown(t, m) : !(shown(m) || view.estCol.all.has(m))} est={isEst} calls={calls} ships={ships} />
  }
  const total = (p) => p.scrubber_calls + (p.est_calls || 0)
  // Ports grouped by port, busiest port first; docks keep their own order (busiest first) inside it.
  const byPort = (ts) => {
    const g = new Map()
    for (const t of ts) { const k = portOf(t); (g.get(k) || g.set(k, []).get(k)).push(t) }
    return [...g.entries()].sort((a, b) => sumOf(view, b[1]).scrubber_calls + (sumOf(view, b[1]).est_calls || 0)
      - sumOf(view, a[1]).scrubber_calls - (sumOf(view, a[1]).est_calls || 0) || a[0].localeCompare(b[0]))
  }
  return (
    <>
      <label className={`${c.mToggle} ${c.noPrint}`}><input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} /> Hide facilities with no scrubber-ship calls</label>
      <div className={c.mWrap}>
        <table className={c.matrix}>
          <colgroup><col className={c.mColFirst} />{months.map((m) => <col key={m} />)}<col className={c.mColTot} /></colgroup>
          <thead><tr>
            <th className={c.mFirst}>Facility</th>
            {months.map((m) => <th key={m} className={shown(m) ? (est.has(m) ? c.mEstH : '') : c.mNa}>{est.has(m) ? '≈' : ''}{monthShort(m)}<span>{m.slice(2, 4)}</span></th>)}
            <th className={c.mTot}>Total</th>
          </tr></thead>
          <tbody>
            {TYPES.map(([ty, label, col, desc]) => {
              const list = view.terms.filter((t) => typeOf(t) === ty)
              if (!list.length) return null
              const rows = list.filter((t) => !hideZero || total(view.perT.get(t.key)) > 0)
                .sort((a, b) => total(view.perT.get(b.key)) - total(view.perT.get(a.key)) || a.name.localeCompare(b.name))
              const hidden = list.length - rows.length
              const sum = sumOf(view, list)
              return [
                <tr key={`h-${ty}`} className={c.mGroup}>
                  <th className={c.mFirst} scope="rowgroup"><span className={c.swatch} style={{ background: col }} />{label}<div className={c.mDesc}>{desc}</div></th>
                  {months.map((m) => cellFor(null, m, sum.months[m] || 0, view.shipsBy[ty]?.[m]?.size || 0, ty))}
                  <Cell calls={sum.scrubber_calls + (sum.est_calls || 0)} ships={view.shipsBy[ty]?.['*']?.size || 0} est={(sum.est_calls || 0) > 0} />
                </tr>,
                ...(ty === 'ports' ? byPort(rows) : rows.map((t) => [null, [t]])).flatMap(([port, ts]) => [
                  // A port with two or more docks shown gets its own subtotal row (Lovel 2026-10-08: see the Port of Seattle as one group).
                  port && ts.length > 1 && (() => {
                    const ps = sumOf(view, ts), g = `port:${port}`
                    return (
                      <tr key={g} className={c.mPort}>
                        <th className={c.mFirst} scope="rowgroup">{port}<div className={c.mDesc}>{ts.length} docks</div></th>
                        {months.map((m) => cellFor(null, m, ps.months[m] || 0, view.shipsBy[g]?.[m]?.size || 0, g))}
                        <Cell calls={ps.scrubber_calls + (ps.est_calls || 0)} ships={view.shipsBy[g]?.['*']?.size || 0} est={(ps.est_calls || 0) > 0} />
                      </tr>
                    )
                  })(),
                  ...ts.map((t) => {
                    const p = view.perT.get(t.key)
                    const inPort = port && ts.length > 1
                    return (
                      <tr key={t.key} className={inPort ? c.mInPort : ''}>
                        <th className={c.mFirst} scope="row">
                          <a href={`/ships?tl=${encodeURIComponent(t.key)}`} className={c.mName}>{t.name}</a>
                          <div className={c.mDesc}>{[port && !inPort ? port : null, placeLabel(t.place_name) || (t.county_name ? `${t.county_name}, unincorporated` : null), kindWords(t.kind)].filter(Boolean).join(' · ')}</div>
                        </th>
                        {months.map((m) => cellFor(t, m, p.months[m] || 0, p.monthShips[m] || 0))}
                        <Cell calls={total(p)} ships={p.ships.size} est={(p.est_calls || 0) > 0} />
                      </tr>
                    )
                  }),
                ]),
                hidden > 0 && (
                  <tr key={`n-${ty}`} className={c.mMore}><td colSpan={months.length + 2}>
                    {hidden} more {label.toLowerCase()} with no scrubber-ship calls in this period
                  </td></tr>
                ),
              ]
            })}
            <tr className={c.mAll}>
              <th className={c.mFirst} scope="row">All facilities</th>
              {months.map((m) => cellFor(null, m, view.perMonth[m]?.total || 0, view.shipsBy.all?.[m]?.size || 0))}
              <Cell calls={view.tot.scrubber_calls + (view.tot.est_calls || 0)} ships={view.shipIds.size} est={(view.tot.est_calls || 0) > 0} />
            </tr>
          </tbody>
        </table>
      </div>
      {(view.estCol.all.size > 0 || months.some((m) => !shown(m))) && (
        <div className={c.hint}>
          {[view.estCol.all.size > 0 && '≈ estimated from hourly ship positions (Global Fishing Watch).', months.some((m) => !shown(m)) && '· no data for that month.']
            .filter(Boolean).join(' ')}
        </div>
      )}
    </>
  )
}


// ── What the report is (also the top of the printed / PDF copy) ─────────────

const longDay = (d) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
function ReportFacts({ data, geo, ed, edition, areaLine, query = '' }) {
  const { from, to } = data.period
  const area = areaLine || (geo === 'WA' ? 'Washington State' : geo === 'BC' ? 'British Columbia' : 'Washington State and British Columbia')
  const url = `earthatlas.org/ships/reports/scrubbers${edition ? `/${edition}` : ''}${query}`
  return (
    <dl className={c.facts}>
      <div><dt>Period</dt><dd>{monthName(from, 'long')} – {monthName(to, 'long')}</dd></div>
      <div><dt>Area</dt><dd>{area}</dd></div>
      <div><dt>Data as of</dt><dd>{longDay(ed?.created_at || Date.now())}</dd></div>
      {edition && <div><dt>Report</dt><dd>Edition {edition}</dd></div>}
      <div><dt>Online</dt><dd><a href={`https://${url}`} className={c.src}>{url}</a></dd></div>
    </dl>
  )
}

// ── The scrubber ships: equipment, operators, the ships themselves ──────────

function LoopBadge({ info }) {
  const loop = info?.scrubber?.loop || 'not_reported'
  const col = LOOP.find(([k]) => k === loop)?.[2] || '#6b7280'
  const src = info?.scrubber?.sources?.gisis ? 'gisis' : info?.scrubber?.sources?.mep ? 'mep' : null
  const maker = info?.scrubber?.maker
  const badge = <span className={c.loop} style={{ '--loop': col }}>{LOOP_LABEL[loop]}</span>
  return (
    <span className={c.loopCell}>
      {src ? <a className={c.loopLink} href={SRC[src].href} target="_blank" rel="noopener noreferrer" title={`Source: ${SRC[src].name}`}>{badge}</a> : badge}
      {maker && <span className={c.sub}>{maker}</span>}
    </span>
  )
}

/** Share of scrubber-ship calls made by open-loop ships (the ships that discharge washwater to the sea). */
function LoopTile({ view }) {
  if (!view.shipList.length || !Object.keys(view.info).length) return null
  const by = {}
  let all = 0
  for (const a of view.shipList) { by[loopOfShip(a)] = (by[loopOfShip(a)] || 0) + a.calls; all += a.calls }
  const p = (k) => pct(by[k] || 0, all)
  return (
    <Tile value={p('open')} label="Calls by open-loop ships"
      sub={`Hybrid ${p('hybrid')} · closed loop ${p('closed')} · type not reported ${p('not_reported')}`}
      src={<Src k="gisis">IMO scrubber notifications</Src>} />
  )
}

function Operators({ view, onPick }) {
  const [all, setAll] = useState(false)
  const g = new Map()
  for (const a of view.shipList) {
    const k = operatorOf(a) || ''
    const e = g.get(k) || g.set(k, { name: k, ships: 0, calls: 0, open: 0, where: new Map() }).get(k)
    e.ships++; e.calls += a.calls
    if (loopOfShip(a) === 'open') e.open += a.calls
    for (const [t, n] of a.where) e.where.set(t.name, (e.where.get(t.name) || 0) + n)
  }
  const named = [...g.values()].filter((e) => e.name).sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
  const unnamed = g.get('')
  const list = all ? named : named.slice(0, 12)
  return (
    <section className={c.card}>
      <div className={c.cardHead}>
        <h2 className={c.h2}>Operators</h2>
        <div className={c.note}>The companies operating these ships, as the <Src k="mep" /> name them. <span className={c.noPrint}>Select one to list its ships.</span></div>
      </div>
      <table className={c.table}>
        <thead><tr><th className={c.thPlace}>Operator</th><th>Ships</th><th>Scrubber-ship calls</th><th>By open-loop ships</th><th className={c.thPlace}>Most calls at</th></tr></thead>
        <tbody>
          {list.map((e) => (
            <tr key={e.name} className={c.opRow} onClick={() => onPick(e.name)}>
              <td className={c.place}><button className={c.toggle}>{e.name}</button></td>
              <td className={c.num}>{fmt(e.ships)}</td>
              <td className={c.num}><b>{fmt(e.calls)}</b></td>
              <td className={c.num}>{pct(e.open, e.calls)}</td>
              <td className={c.place}>{[...e.where].sort((a, b) => b[1] - a[1])[0]?.[0]}</td>
            </tr>
          ))}
          {unnamed && <tr><td className={c.place}><span className={c.sub}>Operator not reported</span></td><td className={c.num}>{fmt(unnamed.ships)}</td><td className={c.num}>{fmt(unnamed.calls)}</td><td className={c.num}>{pct(unnamed.open, unnamed.calls)}</td><td /></tr>}
        </tbody>
      </table>
      {named.length > 12 && <button className={`${c.preset} ${c.noPrint}`} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${named.length} operators`}</button>}
    </section>
  )
}

function Ships({ view, months, op, setOp }) {
  const [kind, setKind] = useState(null)
  const [loop, setLoop] = useState(null)
  const list = view.shipList.filter((a) => (!kind || kindOfShip(a) === kind) && (!loop || loopOfShip(a) === loop) && (!op || operatorOf(a) === op))
  const count = (f) => view.shipList.filter(f).length
  const chips = (opts, cur, setCur, of) => opts.map(([k, l]) => {
    const n = count((a) => of(a) === k)
    return n ? <button key={k} className={cur === k ? c.presetOn : c.preset} onClick={() => setCur(cur === k ? null : k)}>{l} <span className={c.chipN}>{n}</span></button> : null
  })
  const filters = [kind && KINDS_UI.find(([k]) => k === kind)?.[1], loop && LOOP_LABEL[loop], op].filter(Boolean)
  return (
    <section className={`${c.card} ${c.flow}`} id="ships">
      <div className={c.cardHead}>
        <h2 className={c.h2}>Ships</h2>
        <div className={c.note}>{fmt(list.length)} of {fmt(view.shipList.length)} scrubber-fitted ships{filters.length ? ` · ${filters.join(' · ')}` : ''}</div>
      </div>
      <div className={`${c.filters} ${c.noPrint}`}>
        <div className={c.filterRow}><span className={c.filterLabel}>Ship type</span>{chips(KINDS_UI, kind, setKind, kindOfShip)}</div>
        <div className={c.filterRow}><span className={c.filterLabel}>Scrubber</span>{chips(LOOP.map(([k, l]) => [k, l]), loop, setLoop, loopOfShip)}</div>
        {op && <div className={c.filterRow}><span className={c.filterLabel}>Operator</span><button className={c.presetOn} onClick={() => setOp(null)}>{op} ✕</button></div>}
      </div>
      <div className={c.tableWrap}>
        <table className={c.table}>
          <thead><tr>
            <th className={c.thPlace}>Ship</th><th className={c.thPlace}>Flag</th><th className={c.thPlace}>Operator</th><th className={c.thPlace}>Scrubber</th>
            <th>Calls</th><th className={c.thPlace}>Where</th><th className={c.thSpark}>Calls by month</th>
          </tr></thead>
          <tbody>{list.map((a) => (
            <tr key={a.id}>
              <td className={c.place}><a href={`/ships?v=${a.id}`} className={c.shipLink}>{a.name || 'Unnamed'}</a>{a.info?.kind?.label && <div className={c.sub}>{a.info.kind.label}</div>}</td>
              <td className={c.place}>{a.info?.flag?.name || '–'}</td>
              <td className={c.place}>{a.info?.operator?.name || '–'}
                {a.info?.owner?.name && a.info.owner.name.toUpperCase() !== String(a.info?.operator?.name || '').toUpperCase() && <div className={c.sub}>Owner: {a.info.owner.name}</div>}</td>
              <td className={c.place}><LoopBadge info={a.info} /></td>
              <td className={c.num}><b>{fmt(a.calls)}</b></td>
              <td className={c.place}>{a.where.slice(0, 2).map(([t]) => t.name).join(', ')}{a.where.length > 2 ? <span className={c.sub}> +{a.where.length - 2} more</span> : null}</td>
              <td><Spark months={months} values={a.months} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className={c.shipsNote}>Flag from the ships’ registry records (via <Src k="gfwPorts">Global Fishing Watch</Src>, US Coast Guard, Wikidata); operator from the <Src k="mep" />; owner as registered;
        scrubber type and maker from the <Src k="gisis" />.</div>
    </section>
  )
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
            {world.ports.length > 25 && <button className={`${c.preset} ${c.noPrint}`} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${world.ports.length}`}</button>}
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
  const missing = data.coverage.missing.filter((m) => !view.estMonths.has(m))
  const span = (ms) => (ms.length === 1 ? monthName(ms[0], 'long') : `${monthName(ms[0])} – ${monthName(ms.at(-1))}`)
  if (!missing.length && !view.estCol.all.size) return null
  return (
    <div className={c.coverage}>
      {view.estCol.all.size > 0 && <div>Numbers marked ≈ are estimated from hourly ship positions (<Src k="gfw" />). See “How this is counted”.</div>}
      {missing.length > 0 && <div>No data yet for {span(missing)}.</div>}
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
          return <text x={(x0 + x1) / 2} y={CH.t + ih - 34} className={c.missingLabel} textAnchor="middle">No data yet</text>
        })()}
      </svg>
      {hover && (
        <div className={c.tip} style={{ left: `${((CH.l + (months.indexOf(hover) + 0.5) * bw) / CH.w) * 100}%` }}>
          <div className={c.tipHead}>{monthName(hover, 'long')}{view.estMonths.has(hover) ? ' (estimated)' : ''}</div>
          {covered.has(hover) || view.estMonths.has(hover) ? <>
            <div className={c.tipTotal}>{view.estMonths.has(hover) ? '≈' : ''}{fmt(view.perMonth[hover]?.total || 0)} scrubber-ship calls</div>
            {TYPES.map(([k, l, col]) => (view.perMonth[hover]?.[k] ? <div key={k} className={c.tipRow}><i style={{ background: col }} />{l}<b>{fmt(view.perMonth[hover][k])}</b></div> : null))}
          </> : <div className={c.tipRow}>No data yet</div>}
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

/**
 * A small month-by-month bar chart. Every month has a faint slot, so an empty month reads as empty and a bar's position is its month;
 * a baseline with a tick at each January; the first and last month under it; hover a bar for the month and its count.
 */
function Spark({ months, values }) {
  const max = Math.max(1, ...months.map((m) => values[m] || 0))
  const W = 6, H = 20
  const tip = (m) => `${monthName(m, 'long')}: ${fmt(values[m] || 0)} call${(values[m] || 0) === 1 ? '' : 's'}`
  return (
    <div className={c.sparkBox}>
      <svg viewBox={`0 0 ${months.length * W} ${H + 3}`} className={c.spark} role="img"
        aria-label={`Calls by month, ${monthName(months[0])} – ${monthName(months.at(-1))}: ${months.map((m) => values[m] || 0).join(', ')}`}>
        {months.map((m, i) => {
          const v = values[m] || 0, h = (v / max) * (H - 2)
          return (
            <g key={m}>
              <rect x={i * W} y={0} width={W - 1.5} height={H} className={c.sparkSlot}><title>{tip(m)}</title></rect>
              {v > 0 && <rect x={i * W} y={H - h} width={W - 1.5} height={h} rx={1} className={c.sparkBar}><title>{tip(m)}</title></rect>}
              {m.endsWith('-01') && i > 0 && <line x1={i * W - 0.75} x2={i * W - 0.75} y1={H} y2={H + 3} className={c.sparkTick} />}
            </g>
          )
        })}
        <line x1={0} x2={months.length * W - 1.5} y1={H + 0.5} y2={H + 0.5} className={c.sparkBase} />
      </svg>
      <div className={c.sparkAxis}><span>{monthShort(months[0])} ’{months[0].slice(2, 4)}</span><span>{monthShort(months.at(-1))} ’{months.at(-1).slice(2, 4)}</span></div>
    </div>
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
          <th className={c.thPlace}>Place</th><th>Scrubber-ship calls</th><th>Scrubber ships</th><th>Large-ship calls</th><th>Share</th><th className={c.thSpark}>Calls by month</th>
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
        <span className={c.count}>{sum.n} terminal{sum.n === 1 ? '' : 's'}</span>
      </td>
      {sum.n ? <>
        <td className={c.num}><b>{fmt(sum.scrubber_calls)}</b></td>
        <td className={c.num}>{fmt(sum.ships.size)}</td>
        <td className={c.num}>{fmt(sum.large)}</td>
        <td className={c.num}>{pct(sum.scrubber_calls, sum.large)}</td>
        <td><Spark months={months} values={sum.months} /></td>
      </> : <td colSpan={5} />}
    </tr>
  )
}

function TerminalRow({ level, t, view, months, open, onToggle }) {
  const p = view.perT.get(t.key)
  const ships = [...p.ships.values()].sort((a, b) => b.calls - a.calls || String(a.name).localeCompare(String(b.name)))
  return (
    <>
      <tr className={c.termRow} id={`row-${t.key}`}>
        <td className={c.place} style={{ paddingLeft: 10 + level * 18 }}>
          <button className={c.toggle} onClick={onToggle} aria-expanded={open} disabled={false}><Chev open={open} />{t.name}</button>
          <span className={c.meta}>
            <a href={`/ships?tl=${encodeURIComponent(t.key)}`} className={c.mapLink}>{kindWords(t.kind)}</a>
            {' · '}<span className={c.own} style={{ '--own': TYPE_COLOR[typeOf(t)] }} title={t.ownership_basis?.says ? `Owner per ${t.ownership_basis.source === 'usace-docks' ? `USACE dock record ${t.ownership_basis.ref}` : 'EarthAtlas terminal list'}: ${t.ownership_basis.says}` : 'Owner not established'}>
              {TYPE_SINGULAR[typeOf(t)]}{t.ownership && typeOf(t) !== 'ports' ? ` (${OWN_LABEL[t.ownership].toLowerCase()})` : ''}</span>
          </span>
        </td>
        {true ? <>
          <td className={c.num}><b>{fmt(p.scrubber_calls)}</b></td>
          <td className={c.num}>{fmt(p.ships.size)}</td>
          <td className={c.num}>{fmt(p.large)}</td>
          <td className={c.num}>{pct(p.scrubber_calls, p.large)}</td>
          <td><Spark months={months} values={p.months} /></td>
        </> : null}
      </tr>
      {open && (
        <tr className={c.shipsRow}><td colSpan={6}>
          {ships.length === 0 ? <div className={c.none}>No scrubber-fitted ship called here in this period.</div> : (
            <table className={c.ships}>
              <thead><tr><th>Ship</th><th>Flag</th><th>Operator</th><th>Scrubber</th><th>Calls</th><th className={c.thSpark}>Calls by month</th></tr></thead>
              <tbody>{ships.map((s) => {
                const inf = view.info[s.vessel_id]
                return (
                  <tr key={s.vessel_id}>
                    <td><a href={`/ships?v=${s.vessel_id}`} className={c.shipLink}>{inf?.name || s.name || 'Unnamed'}</a>{inf?.kind?.label && <div className={c.sub}>{inf.kind.label}</div>}</td>
                    <td>{inf?.flag?.name || '–'}</td>
                    <td>{inf?.operator?.name || '–'}</td>
                    <td><LoopBadge info={inf} /></td>
                    <td className={c.num}>{fmt(s.calls)}</td>
                    <td><Spark months={months} values={s.months} /></td>
                  </tr>
                )
              })}</tbody>
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

function Method({ data, world }) {
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
        <dd>Calls by ships whose AIS ship type is passenger, cargo or tanker. Tugs, fishing boats and pleasure craft are not included in the report.</dd>
        <dt>Terminals and ownership</dt>
        <dd>Berth positions from <Src k="usace" />, WA Ecology, BC Ports and Terminals and OpenStreetMap. A port-authority terminal is owned by a
          public port district (Port of Seattle, Port of Tacoma…) even when a private company operates it; private docks include refinery wharves.
          Owner from the USACE dock record unless a checked source says otherwise. The report groups facilities as <b>Ports</b> (port-district
          docks), <b>Refineries</b> (refinery docks) and <b>Terminals</b> (every other dock).</dd>
        <dt>Places</dt>
        <dd>County and city or town from the <Src k="census" /> at each terminal's position. "Unincorporated" means outside any city or town.</dd>
        <dt>NOAA data</dt>
        <dd>{data.coverage.months.length ? `${monthName(data.coverage.months[0], 'long')} – ${monthName(data.coverage.months.at(-1), 'long')}` : 'None in this period'}.
          NOAA publishes its minute-by-minute positions about three months after the fact.</dd>
        {data.estimated && <>
          <dt>Estimates (≈)</dt>
          <dd>From hourly ship positions (<Src k="gfw" />), for months NOAA has not published and for terminals beyond the reach of NOAA’s
            receivers (Howe Sound and Texada Island). A stop counts at a terminal only when that terminal is the one nearby that fits the kind of
            ship; a stop that fits two neighbouring terminals is not counted at either.</dd>
        </>}
        {world?.coverage?.ships > 0 && <>
          <dt>Port visits</dt>
          <dd>Global Fishing Watch’s apparent port visits, for the {fmt(world.coverage.fetched)} of these {fmt(world.coverage.ships)} ships it holds
            a record for.</dd>
        </>}
      </dl>
    </section>
  )
}
