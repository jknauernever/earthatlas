/**
 * /ships/reports/oil-transfers: planned vs. observed over-water oil transfers in Washington (Josh + Lovel Pratt, 2026-11-06).
 * Every operation Washington Ecology was notified of (Advance Notice of Transfer, public records release: cargo, fueling,
 * lightering, vacuum and other) beside what AIS shows: the ship at the notified terminal's berth, or a bunker tug alongside it at
 * an anchorage. Data: /api/ships?op=oilTransfers (lib/ships/oilTransfers.js; operations packed, lib/ships/oilTransfersPack.js).
 *
 * The same topline shape as the bunkering report (src/ships/BunkeringReport.jsx): clickable tiles, a month chart and breakdowns,
 * every number filters the whole page; operations listed only when asked for. Small craft (fishing boats, work boats,
 * recreational and unregulated vessels) are their own view, kept out of the main counts (Josh 2026-11-06). Factual record only.
 * URL state: from, to, g (group), st, k, s, p, r, y, f, d, t, c, v, x, m, q (filters), list.
 */
import { useEffect, useMemo, useState } from 'react'
import BuiltByCredit from '../components/BuiltByCredit.jsx'
import { ShipLoader } from '../components/panel'
import c from './ScrubberReport.module.css'
import b from './BunkeringReport.module.css'
import DocBrand from '../components/DocBrand.jsx'
import { unpackOps, productGroup } from '../../lib/ships/oilTransfersPack.js'
import { SHIP_TYPE_GROUPS, shipGroupOf, cruiseSourceOf, CRUISE, PASSENGER_OTHER } from '../../lib/ships/data/shipTypeGroups.js'

// localhost only: ?data=prod reads production's numbers through the dev proxy (vite.config.js), as the other reports do.
const API = import.meta.env.DEV && new URLSearchParams(window.location.search).get('data') === 'prod' ? '/__prodread/api/ships' : '/api/ships'
const ANT_HOME = 'https://ecology.wa.gov/regulations-permits/reporting-requirements/advance-notice-of-oil-transfer'
const MC_HOME = 'https://hub.marinecadastre.gov/pages/vesseltraffic'
const rec = (id) => (id ? `/ships/source/${id}` : null)
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'))
const gal = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : fmt(Math.round(n || 0)))
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const monthShort = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
const pacific = (t) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })
const pacMonth = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).slice(0, 7)
const hrs = (h) => (h == null ? '—' : `${Math.round(h * 10) / 10} h`)
const median = (xs) => { const v = xs.filter((x) => x != null).sort((a, z) => a - z); return v.length ? v[Math.floor(v.length / 2)] : null }
const title = (s) => String(s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Atb|Lng|Lpg|Usa|Us|Bp|Hf|Ssa|Wut|Pct|Uscg|Msrc|Tote)\b/g, (m) => m.toUpperCase())
const placeName = (loc) => title(String(loc || '').replace(/^Anchor - /i, '')) + (/^Anchor - /i.test(String(loc || '')) ? ' anchorage' : '')
const countyName = (r) => (r && r !== 'Unknown' ? `${title(r)} County` : null)
const yesNo = (v) => (v === true ? 'Yes' : v === false ? 'No' : '—')

// ── Categories (each one names what it is built from) ─────────────────────────
export const STATUS = [
  ['seen', 'Notified and seen in AIS', '#0e7490'],
  ['notSeen', 'Notified, not seen in AIS', '#d97706'],
  ['cantCheck', 'Notified, can’t be checked in AIS', '#94a3b8'],
]
const STATUS_COLOR = { ...Object.fromEntries(STATUS.map(([k, , col]) => [k, col])), small: '#64748b' }
const STATUS_LABEL = { ...Object.fromEntries(STATUS.map(([k, l]) => [k, l])), small: 'Small craft (not checked)' }
export const REASONS = {
  noAis: 'No vessel with AIS named (barges, facilities)',
  outside: 'Outside AIS coverage (Grays Harbor, Columbia and Snake rivers)',
  noTerminal: 'At a dock EarthAtlas does not track (ferry terminals, marinas, shipyards)',
  berthGap: 'At a terminal whose berth EarthAtlas’s AIS check does not cover',
  military: 'Military vessel not found in AIS (warships often do not broadcast it)',
  anchorageType: 'At an anchorage, not fueling or lightering',
  edge: 'Its window runs past the months of AIS',
  bargeTug: 'Towed barge whose tug was not at the berth in the window (a towed barge can be left at a dock)',
}
const REASON_SHORT = { noAis: 'no vessel with AIS named', outside: 'outside AIS coverage', noTerminal: 'at docks EarthAtlas does not track',
  berthGap: 'at berths the AIS check does not cover', military: 'military', anchorageType: 'other anchorage operations', edge: 'at the edge of the AIS months',
  bargeTug: 'towed barges, tug not at the berth' }
/** A party's kind for the direction breakdown, from Ecology's own vessel-type name. */
const sideOf = (type) => {
  const t = String(type || '').toUpperCase()
  if (t === 'FACILITY') return 'Facility'
  if (t === 'MOBILE') return 'Truck'
  if (/BARGE/.test(t)) return 'Barge'
  if (!t || /UNKNOWN|^VESSEL$/.test(t)) return 'Vessel (type not stated)'
  return 'Ship'
}
const shipTypeOf = (t) => (t ? title(t).replace(/\/(\w)/g, (m, x) => `/${x.toUpperCase()}`) : 'Not stated')
const BANDS = [[1e3, 'Under 1,000 gal'], [25e3, '1,000–25,000 gal'], [250e3, '25,000–250,000 gal'], [2.5e6, '250,000–2.5M gal'], [Infinity, '2.5M gal or more']]
const bandOf = (g) => (g == null ? null : BANDS.find(([lim]) => g < lim)[1])
const SCRUBBER_YES = 'Scrubber-fitted ship'
// The two scrubber lists (as the scrubber report names them).
const SCRUBBER_SRC = {
  gisis: { name: 'IMO GISIS scrubber notifications (MARPOL Annex VI Reg. 4.2)', short: 'IMO', href: 'https://gisis.imo.org/' },
  mep: { name: 'MEP Alliance scrubber lists', short: 'MEP Alliance', href: 'https://www.mepalliance.org/list-of-scrubber-fitted-ships' },
}
const ScrubberBadge = ({ r }) => {
  const ks = r.scrubberSrc === 'both' ? ['gisis', 'mep'] : [r.scrubberSrc]
  return <div className={b.sub}>{r.scrubberVessel ? <a className={c.src} href={`/ships?v=${r.scrubberVessel}`} target="_blank" rel="noopener noreferrer" title="Open this ship’s card">Scrubber-fitted</a> : 'Scrubber-fitted'}
    {' '}({ks.map((k, i) => <span key={k}>{i > 0 && ', '}<Src href={SCRUBBER_SRC[k].href} title={SCRUBBER_SRC[k].name}>{SCRUBBER_SRC[k].short}</Src></span>)})</div>
}
/** Why this tug stands for this barge: the AIS evidence, and the published source naming the pair where one was found. */
const PairNote = ({ pair, barge }) => (pair ? <div className={b.sub}>
  {pair.atb ? 'ATB unit' : 'Tug for this barge'}: at the berth through {pair.full} of the {pair.ops} notified transfers of {title(barge)} (EarthAtlas, from AIS)
  {pair.source?.url && <> · <Src href={pair.source.url} title={pair.source.name}>{pair.source.short || 'published pairing'}</Src></>}
</div> : null)
const KIND_LABEL = { 'Other (incl Lube/Hyd Oil)': 'Other (incl. lube / hydraulic oil)' }

/** Ecology's vessel type as its group and subtype; Ecology's "Passenger Ship" split into cruise ships (with their source) and others. */
function shipTypeFields(o) {
  const cruiseSrc = cruiseSourceOf(o.shipType, o.ship)
  const passenger = String(o.shipType || '').trim().toUpperCase() === 'PASSENGER SHIP'
  return { shipGroup: shipGroupOf(o.shipType), cruiseSrc, shipTypeLabel: cruiseSrc ? CRUISE : passenger ? PASSENGER_OTHER : shipTypeOf(o.shipType) }
}

/** One row per operation, with every category it can be filtered by. */
function toRows(data) {
  return unpackOps(data.packed).map((o, i) => {
    const prods = new Map()
    for (const p of o.products) { const k = productGroup(p.product); prods.set(k, (prods.get(k) || 0) + (p.gallons || 0)) }
    const kinds = o.transferTypes.length ? o.transferTypes.map((k) => KIND_LABEL[k] || k) : ['Not stated']
    return { ...o, key: `o${i}`, at: o.startAt, month: pacMonth(o.startAt), kinds, place: placeName(o.location), county: countyName(o.region), cityName: title(o.city) || null,
      settingLabel: o.setting === 'anchorage' ? 'Anchorage' : 'Dock or terminal', direction: `${sideOf(o.delivererType)} → ${sideOf(o.receiverType)}`,
      ...shipTypeFields(o), companyLabel: o.company ? o.company.replace(/\s+/g, ' ') : 'Not stated',
      prods: [...prods].map(([k, g]) => ({ group: k, gallons: g })), rawProds: [...new Set(o.products.map((p) => String(p.product || '').trim()).filter(Boolean))],
      band: bandOf(o.gallons) }
  })
}

// Filters: URL key → [label, a row's values for the breakdowns, how a value is shown, and (when wider) every value a row matches:
// a ship-type group as well as its type, a product group as well as Ecology's own product name].
const DIMS = {
  st: ['Status', (r) => [r.status], (v) => STATUS_LABEL[v] || v],
  k: ['Transfer type', (r) => r.kinds],
  s: ['Setting', (r) => [r.settingLabel]],
  p: ['Place', (r) => [r.place]],
  r: ['County', (r) => (r.county ? [r.county] : [])],
  y: ['City', (r) => (r.cityName ? [r.cityName] : [])],
  f: ['Product', (r) => r.prods.map((x) => x.group), null, (r) => [...r.prods.map((x) => x.group), ...r.rawProds]],
  d: ['Direction', (r) => [r.direction]],
  t: ['Ship type', (r) => [r.shipTypeLabel], null, (r) => [r.shipGroup, r.shipTypeLabel]],
  c: ['Company', (r) => [r.companyLabel]],
  v: ['Volume', (r) => (r.band ? [r.band] : [])],
  x: ['Why not checked', (r) => (r.reason ? [r.reason] : []), (v) => REASONS[v] || v],
  sc: ['Scrubber', (r) => (r.group !== 'ships' ? [] : [r.scrubberSrc ? SCRUBBER_YES : 'Not listed as scrubber-fitted'])],
  m: ['Month', (r) => [r.month], (v) => monthName(v)],
}
const FILTER_KEYS = Object.keys(DIMS)
function applyFilters(rows, filt, except = null) {
  const q = (filt.q || '').trim().toUpperCase()
  return rows.filter((r) => {
    if (filt.g !== 'all' && (filt.g === 'small') !== (r.group === 'small')) return false
    for (const k of FILTER_KEYS) {
      if (k === except || !filt[k]) continue
      if (!(DIMS[k][3] || DIMS[k][1])(r).includes(filt[k])) return false
    }
    return !q || [r.ship, r.receiver, ...r.deliverers].some((n) => String(n || '').toUpperCase().includes(q))
  })
}
const inMonths = (rows, from, to) => rows.filter((r) => (!from || r.month >= from) && (!to || r.month <= to))

function readUrl() {
  const sp = new URLSearchParams(window.location.search)
  const ok = (v) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(v || '') ? v : null)
  const out = { from: ok(sp.get('from')), to: ok(sp.get('to')), g: sp.get('g') === 'small' ? 'small' : '', q: sp.get('q') || '', list: sp.get('list') === '1' }
  for (const k of FILTER_KEYS) out[k] = sp.get(k) || ''
  return out
}

// ── Small pieces ─────────────────────────────────────────────────────────────
function Src({ href, title: t, children }) {
  return href ? <a className={c.src} href={href} target="_blank" rel="noopener noreferrer" title={t}>{children}</a> : <>{children}</>
}
const Ant = ({ op, children }) => <Src href={rec(op.recordIds?.[0])} title={`Ecology Advance Notice of Transfer ${op.antIds.join(', ')}, as released`}>{children}</Src>
const Ais = ({ id, children }) => <Src href={rec(id) || MC_HOME} title="Found by EarthAtlas in MarineCadastre AIS (NOAA / BOEM / USCG) — click for the record">{children}</Src>

function TileBtn({ value, label, sub, src, on, onClick, color }) {
  return (
    <button type="button" className={`${b.tileBtn} ${on ? b.tileOn : ''}`} onClick={onClick} aria-pressed={on}>
      <div className={b.tileValue}>{color && <span className={b.dot} style={{ background: color }} />}{value}</div>
      <div className={b.tileLabel}>{label}</div>
      {sub && <div className={b.tileSub}>{sub}</div>}
      <div className={b.tileSrc}>Source: {src}</div>
      <div className={b.tileHint}>{on ? 'Showing these below · click to clear' : 'Click to see them'}</div>
    </button>
  )
}

/** One breakdown: count per value (bars split by status), click a value to filter by it. */
function Facet({ name, dim, rows, filt, set, measure = 'count', top = 7, sub, order = null }) {
  const [all, setAll] = useState(false)
  const groups = useMemo(() => {
    const m = new Map()
    for (const r of rows) for (const v of [...new Set(DIMS[dim][1](r))]) {
      const x = m.get(v) || { v, n: 0, g: 0, by: { seen: 0, notSeen: 0, cantCheck: 0, small: 0 } }
      x.n++; x.by[r.status]++
      x.g += dim === 'f' ? (r.prods.find((y) => y.group === v)?.gallons || 0) : (r.gallons || 0)
      m.set(v, x)
    }
    if (order) return [...m.values()].sort((a, z) => order.indexOf(a.v) - order.indexOf(z.v))
    return [...m.values()].sort((a, z) => (measure === 'gallons' ? z.g - a.g : z.n - a.n) || String(a.v).localeCompare(String(z.v)))
  }, [rows, dim, measure, order])
  if (!groups.length) return null
  const max = Math.max(...groups.map((x) => (measure === 'gallons' ? x.g : x.n)), 1)
  const shown = all ? groups : groups.slice(0, top)
  const label = DIMS[dim][2] || ((v) => v)
  return (
    <section className={b.facet}>
      <div className={b.facetHead}><h3 className={b.facetTitle}>{name}</h3><span className={b.facetSub}>{sub || (measure === 'gallons' ? 'gallons notified · operations' : 'operations · gallons notified')}</span></div>
      <div className={b.rows}>
        {shown.map((x) => {
          const on = filt[dim] === x.v
          const scale = (measure === 'gallons' ? x.g : x.n) / max
          return (
            <button key={x.v} type="button" className={on ? b.rowOn : b.row} onClick={() => set({ [dim]: on ? '' : x.v })} title={`Show the ${fmt(x.n)} operations: ${label(x.v)}`}>
              <span className={b.rowLabel}>{label(x.v)}</span>
              <span className={b.track}>{measure === 'gallons'
                ? <span className={b.fill} style={{ width: `${scale * 100}%`, background: STATUS_COLOR.seen }} />
                : ['seen', 'notSeen', 'cantCheck', 'small'].map((k) => x.by[k] > 0 && <span key={k} className={b.fill} style={{ width: `${(x.by[k] / max) * 100}%`, background: STATUS_COLOR[k] }} />)}</span>
              <span className={b.rowNum}>{measure === 'gallons' ? <>{gal(x.g)}<small>{fmt(x.n)}</small></> : <>{fmt(x.n)}{x.g > 0 && <small>{gal(x.g)} gal</small>}</>}</span>
            </button>
          )
        })}
      </div>
      {groups.length > top && <button type="button" className={b.more} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${groups.length}`}</button>}
    </section>
  )
}

function MonthChart({ rows, months, filt, set }) {
  const by = new Map(months.map((m) => [m, { seen: 0, notSeen: 0, cantCheck: 0, small: 0, n: 0 }]))
  for (const r of rows) { const x = by.get(r.month); if (x) { x[r.status]++; x.n++ } }
  const max = Math.max(...[...by.values()].map((x) => x.n), 1)
  const keys = ['seen', 'notSeen', 'cantCheck', 'small']
  return (
    <div className={b.months}>
      {months.map((m, i) => {
        const x = by.get(m), on = filt.m === m
        const withYear = i === 0 || m.endsWith('-01')
        return (
          <button key={m} type="button" className={`${b.monthCol} ${on ? b.monthOn : ''} ${filt.m && !on ? b.monthDim : ''}`} onClick={() => set({ m: on ? '' : m })}
            title={`${monthName(m)}: ${keys.filter((k) => x[k]).map((k) => `${x[k]} ${STATUS_LABEL[k].charAt(0).toLowerCase() + STATUS_LABEL[k].slice(1)}`).join(', ')}`}>
            <span className={b.monthN}>{x.n || ''}</span>
            <span className={b.monthStack} style={{ height: `${(x.n / max) * 130}px` }}>
              {keys.map((k) => x[k] > 0 && <span key={k} className={b.monthSeg} style={{ height: `${(x[k] / x.n) * 100}%`, background: STATUS_COLOR[k] }} />)}
            </span>
            <span className={b.monthLbl}>{monthShort(m)}{withYear ? ` ’${m.slice(2, 4)}` : ''}</span>
          </button>
        )
      })}
    </div>
  )
}

/** The operations, only when asked for: 50 at a time. */
function OpsList({ rows, data }) {
  const [n, setN] = useState(50)
  const sorted = [...rows].sort((a, z) => z.at.localeCompare(a.at))
  const terminalName = (k) => data.terminals?.[k] || (data.docks?.[k] ? placeName(data.docks[k]) : k)
  const recOf = (k) => (data.docks?.[k] ? data.dockRecordId : data.callRecordId)
  return <>
    <div className={b.listWrap}><table className={b.list}>
      <thead><tr><th>Date (Pacific)</th><th>Place</th><th>Ship</th><th>Notified to Ecology</th><th>Seen in AIS</th><th>Status</th></tr></thead>
      <tbody>{sorted.slice(0, n).map((r) => (
        <tr key={r.key}>
          <td><Ant op={r}>{pacific(r.at)}</Ant></td>
          <td>{r.place}<div className={b.sub}>{[r.cityName, r.county].filter(Boolean).join(', ')}</div></td>
          <td>{r.ship ? <Ant op={r}>{r.ship}</Ant> : '—'}<div className={b.sub}>{r.cruiseSrc ? <>Passenger ship (<Ant op={r}>Ecology</Ant>), cruise ship (<Src href={r.cruiseSrc.url} title={`${r.cruiseSrc.name} lists this ship as a cruise ship`}>{r.cruiseSrc.name}</Src>)</> : r.shipTypeLabel}</div>{r.scrubberSrc && <ScrubberBadge r={r} />}</td>
          <td>
            <Ant op={r}>{r.kinds.join(', ')}</Ant> · <Ant op={r}>{r.companyLabel}</Ant>
            <div className={b.sub}><Ant op={r}>{r.deliverers.join(', ') || '—'}</Ant> → <Ant op={r}>{r.receiver || '—'}</Ant></div>
            <div className={b.sub}><Ant op={r}>{fmt(Math.round(r.gallons || 0))} gal</Ant>: {r.prods.map((x) => `${x.group} ${gal(x.gallons)}`).join('; ')}</div>
            <div className={b.sub}>{hrs(r.durationH)} planned · pre-boomed <Ant op={r}>{yesNo(r.isPreboomed)}</Ant> · over 500 gal/min <Ant op={r}>{yesNo(r.rateGt500)}</Ant></div>
            {r.contacts.map((k, i) => <div key={i} className={b.sub}>Contact: <Ant op={r}>{[k.name, k.phone].filter(Boolean).join(', ')}</Ant></div>)}
          </td>
          <td>{r.seen?.kind === 'call' || r.seen?.kind === 'dock' ? <>
            At <Ais id={recOf(r.seen.terminalKey)}>{terminalName(r.seen.terminalKey)}</Ais>
            <div className={b.sub}><Ais id={recOf(r.seen.terminalKey)}>{pacific(r.seen.t0)} – {pacific(r.seen.t1)}</Ais></div>
            <div className={b.sub}>AIS name {r.seen.aisName || '—'} · MMSI {r.seen.mmsi}{Math.abs(r.seen.delayH) <= 24 && <> · arrived {r.seen.delayH > 0 ? '+' : ''}{hrs(r.seen.delayH)} vs. notified start</>}</div>
          </> : r.seen?.kind === 'otherPier' ? <>
            At <Ais id={recOf(r.seen.terminalKey)}>{terminalName(r.seen.terminalKey)}</Ais>, not the pier named in the notice
            <div className={b.sub}><Ais id={recOf(r.seen.terminalKey)}>{pacific(r.seen.t0)} – {pacific(r.seen.t1)}</Ais></div>
            <div className={b.sub}>AIS name {r.seen.aisName || '—'} · MMSI {r.seen.mmsi}</div>
          </> : r.seen?.kind === 'tug' ? <>
            Its tug <Ais id={recOf(r.seen.terminalKey)}>{r.seen.aisName || `MMSI ${r.seen.mmsi}`}</Ais> at <Ais id={recOf(r.seen.terminalKey)}>{terminalName(r.seen.terminalKey)}</Ais>
            <div className={b.sub}><Ais id={recOf(r.seen.terminalKey)}>{pacific(r.seen.t0)} – {pacific(r.seen.t1)}</Ais></div>
            <PairNote pair={data.bargeTugs?.pairs?.[r.ship]} barge={r.ship} />
          </> : r.seen?.kind === 'alongside' ? <>
            {r.seen.tugs.join(', ')} alongside at <Ais id={data.bunkerRecordId}>{r.seen.place || 'the anchorage'}</Ais>
            <div className={b.sub}><Ais id={data.bunkerRecordId}>{pacific(r.seen.t0)} – {pacific(r.seen.t1)}</Ais> · {hrs(r.seen.hours)}</div>
          </> : <span className={b.sub}>{r.status === 'notSeen' ? 'Not seen' : r.reason ? REASONS[r.reason] : 'Not checked'}</span>}</td>
          <td><span className={b.dot} style={{ background: STATUS_COLOR[r.status], marginRight: 6 }} />{STATUS_LABEL[r.status]}</td>
        </tr>))}</tbody>
    </table></div>
    {sorted.length > n && <button type="button" className={b.more} onClick={() => setN(n + 50)}>Show 50 more (of {fmt(sorted.length)})</button>}
  </>
}

function FilterChips({ st, set, clearAll, count, hint }) {
  const active = FILTER_KEYS.filter((k) => st[k])
  if (!active.length && !st.q) return <span className={b.filterHint}>{hint}</span>
  return <>
    {active.map((k) => (
      <span key={k} className={b.chip}><b>{DIMS[k][0]}:</b> {(DIMS[k][2] || ((v) => v))(st[k])}
        <button type="button" className={b.chipX} onClick={() => set({ [k]: '' })} aria-label={`Remove ${DIMS[k][0]}`}>×</button></span>))}
    {st.q && <span className={b.chip}><b>Ship:</b> {st.q}<button type="button" className={b.chipX} onClick={() => set({ q: '' })} aria-label="Remove search">×</button></span>}
    <button type="button" className={b.clear} onClick={clearAll}>Clear all</button>
    {count != null && <span className={b.filterHint}>{fmt(count)} operations</span>}
  </>
}

function GeoPicker({ st, set, rows }) {
  const groups = [['r', 'Counties'], ['y', 'Cities and towns'], ['p', 'Places']].map(([dim, label]) => {
    const m = new Map()
    for (const r of rows) for (const v of DIMS[dim][1](r)) m.set(v, (m.get(v) || 0) + 1)
    return [dim, label, [...m].sort((a, z) => String(a[0]).localeCompare(String(z[0])))]
  }).filter(([, , xs]) => xs.length)
  const value = ['r', 'y', 'p'].map((d) => (st[d] ? `${d}:${st[d]}` : '')).find(Boolean) || ''
  return (
    <label className={c.focus}>Focus geography:
      <select value={value} onChange={(e) => { const [d, ...v] = e.target.value.split(':'); set({ r: '', y: '', p: '', ...(d ? { [d]: v.join(':') } : {}) }) }}>
        <option value="">All of Washington</option>
        {groups.map(([dim, label, xs]) => <optgroup key={dim} label={label}>{xs.map(([v, n]) => <option key={v} value={`${dim}:${v}`}>{v} ({fmt(n)})</option>)}</optgroup>)}
      </select>
    </label>
  )
}

const TOP_KEYS = ['t', 'f', 'k']
/** Counts per value for a dimension, over every value a row matches. */
function countsOf(rows, dim) {
  const m = new Map()
  for (const r of rows) for (const v of new Set((DIMS[dim][3] || DIMS[dim][1])(r))) m.set(v, (m.get(v) || 0) + 1)
  return m
}

/** Ship type, product and transfer type at the top of the report: groups with their subtypes (Josh 2026-11-08). */
function TopFilters({ st, set, facetRows }) {
  const sel = (dim, groups, label) => {
    const n = countsOf(facetRows(dim), dim)
    const opt = (v, text) => <option key={v} value={v}>{text} ({fmt(n.get(v) || 0)})</option>
    return (
      <label className={b.topFilter}>{label}
        <select value={st[dim]} onChange={(e) => set({ [dim]: e.target.value })}>
          <option value="">All</option>
          {groups ? groups.filter(([g]) => n.get(g)).map(([g, all]) => [g, all.filter((v) => n.get(v))]).map(([g, subs]) => subs.length < 2 && !subs.includes(st[dim])
            // One subtype (in the rows shown): the group alone, named after it, so the same count is not listed twice.
            ? opt(g, subs.length && subs[0].toLowerCase() !== g.toLowerCase() ? `${g}: ${subs[0]}` : g)
            : <optgroup key={g} label={g}>
            {opt(g, `All ${g.charAt(0).toLowerCase()}${g.slice(1)}`)}
            {subs.filter((v) => n.get(v)).map((v) => opt(v, `\u00a0\u00a0${v}`))}
          </optgroup>)
            : [...n].sort((a, z) => z[1] - a[1]).map(([v]) => opt(v, v))}
        </select>
      </label>
    )
  }
  const all = facetRows('t')
  const typeGroups = SHIP_TYPE_GROUPS.map(([g]) => [g, [...new Set(all.filter((r) => r.shipGroup === g).map((r) => r.shipTypeLabel))].sort()])
  const prodRows = facetRows('f')
  const prodGroups = [...new Set(prodRows.flatMap((r) => r.prods.map((x) => x.group)))].sort().map((g) =>
    [g, [...new Set(prodRows.flatMap((r) => r.rawProds.filter((p) => productGroup(p) === g)))].filter((p) => p !== g).sort()])
  return <div className={b.topFilters}>
    {sel('t', typeGroups, 'Ship type')}
    {sel('f', prodGroups, 'Product')}
    {sel('k', null, 'Transfer type')}
  </div>
}

function FilterEditor({ st, set, facetRows }) {
  const opts = (dim) => {
    const m = new Map()
    for (const r of facetRows(dim)) for (const v of new Set(DIMS[dim][1](r))) m.set(v, (m.get(v) || 0) + 1)
    const list = [...m].sort((a, z) => (dim === 'm' ? String(z[0]).localeCompare(String(a[0])) : dim === 'v' ? BANDS.findIndex(([, l]) => l === a[0]) - BANDS.findIndex(([, l]) => l === z[0]) : z[1] - a[1]))
    if (st[dim] && !m.has(st[dim])) list.unshift([st[dim], 0])
    return list
  }
  return (
    <div className={b.editor}>
      {FILTER_KEYS.filter((dim) => !TOP_KEYS.includes(dim)).map((dim) => (
        <label key={dim}>{DIMS[dim][0]} <select value={st[dim]} onChange={(e) => set({ [dim]: e.target.value })}>
          <option value="">All</option>
          {opts(dim).map(([v, n]) => <option key={v} value={v}>{(DIMS[dim][2] || ((x) => x))(v)} ({fmt(n)})</option>)}
        </select></label>
      ))}
      <label>Ship <input className={b.search} type="search" value={st.q} placeholder="Name…" onChange={(e) => set({ q: e.target.value })} /></label>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function OilTransfersReport() {
  const [st, setSt] = useState(readUrl)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const set = (p) => setSt((s) => ({ ...s, ...p, ...(Object.keys(p).some((k) => FILTER_KEYS.includes(k) && p[k]) ? { list: true } : {}) }))
  useEffect(() => { document.title = 'Planned vs. observed over-water oil transfers in Washington · EarthAtlas Ships' }, [])
  // Unlisted for now (Josh 2026-11-10: Lovel controls who has the URL): not linked anywhere, and search engines are asked not to index it.
  useEffect(() => {
    const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex, nofollow'
    document.head.appendChild(m)
    return () => m.remove()
  }, [])
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    for (const k of ['from', 'to', 'g', 'q', ...FILTER_KEYS]) { if (st[k]) q.set(k, st[k]); else q.delete(k) }
    if (st.list) q.set('list', '1'); else q.delete('list')
    const s = q.toString()
    window.history.replaceState(null, '', window.location.pathname + (s ? `?${s}` : ''))
  }, [st])
  useEffect(() => {
    fetch(`${API}?op=oilTransfers`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`load failed (${r.status})`)))).then(setData).catch((e) => setErr(e.message))
  }, [])

  const allRows = useMemo(() => (data?.available ? toRows(data) : []), [data])
  const allMonths = data?.months || []
  const from = st.from || allMonths[0], to = st.to || allMonths[allMonths.length - 1]
  const rows = useMemo(() => inMonths(allRows, from, to), [allRows, from, to])
  const shown = useMemo(() => applyFilters(rows, st), [rows, st])
  const facetRows = (dim) => applyFilters(rows, st, dim)
  const geoRows = applyFilters(rows, { ...st, r: '', y: '', p: '' })
  const tileRows = applyFilters(rows, { ...st, g: 'all' }, 'st')
  const main = tileRows.filter((r) => r.group !== 'small'), small = tileRows.filter((r) => r.group === 'small')
  const count = (k) => main.filter((r) => r.status === k).length
  const nSeen = count('seen'), nNot = count('notSeen'), nCant = count('cantCheck')
  const mainGal = main.reduce((g, r) => g + (r.gallons || 0), 0)
  const cantTop = Object.entries(main.filter((r) => r.status === 'cantCheck').reduce((m, r) => ({ ...m, [r.reason]: (m[r.reason] || 0) + 1 }), {})).sort((a, z) => z[1] - a[1])
  // Arrival times: ships at terminals and docks only, and only where the call began within a day of the notified start (a ferry
  // that comes and goes within 6 h stays one call for days, so its arrival says nothing about the transfer).
  const seenRows = shown.filter((r) => r.status === 'seen' && r.seen && (r.seen.kind === 'call' || r.seen.kind === 'dock' || r.seen.kind === 'alongside') && Math.abs(r.seen.delayH) <= 24)
  const months = allMonths.filter((m) => m >= from && m <= to)
  const active = FILTER_KEYS.filter((k) => st[k])
  const tile = (k) => ({ on: st.st === k && st.g !== 'small', onClick: () => set({ g: '', st: st.st === k && st.g !== 'small' ? '' : k }) })
  const clearAll = () => setSt((s) => ({ ...s, q: '', ...Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])) }))
  const viewingSmall = st.g === 'small'
  const shares = (k) => (nSeen + nNot ? `${Math.round((100 * (k === 'seen' ? nSeen : nNot)) / (nSeen + nNot))}% of the operations that can be checked` : '')

  return (
    <div className={c.page}>
      <header className={c.top}>
        <DocBrand tool="Ships" href="/ships"><a href="/ships" className={c.brand}>EarthAtlas <span>Ships</span></a></DocBrand>
        <button className={c.print} onClick={() => window.print()} disabled={!data?.available}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" />
          </svg>
          Print or save as PDF
        </button>
      </header>
      <main className={c.main}>
        <div className={c.kicker}>Report</div>
        <h1 className={c.title}>Planned vs. observed over-water oil transfers in Washington</h1>
        <p className={c.lede}>
          Every over-water transfer of more than 100 gallons of oil to or from a vessel in Washington is notified in advance to the{' '}
          <Src href={ANT_HOME}>Washington State Department of Ecology</Src>: cargo loaded and unloaded at refineries and terminals, ships fueled,
          lightering between vessels. This report sets every notified operation beside what <Src href={MC_HOME}>NOAA’s AIS ship positions</Src> show:
          the ship at the notified terminal or dock, a barge’s tug with it at the berth, or a bunker tug alongside a ship at an anchorage. Click any number to see the operations behind it.
          Fueling and lightering at anchorages alone are in the <a className={c.src} href="/ships/reports/bunkering">anchorage report</a>.
        </p>

        {data?.available && <dl className={c.facts}>
          <div><dt>Period</dt><dd>{from && to ? `${monthName(from)} – ${monthName(to)}` : '—'}</dd></div>
          <div><dt>Area</dt><dd>Washington (Ecology’s records); AIS check within NOAA’s AIS coverage</dd></div>
          <div><dt>Notices</dt><dd><Src href={ANT_HOME}>Ecology Advance Notice of Transfer records</Src>, public records release ({String(data.release || '').replace(/^ant-/, '')})</dd></div>
          <div><dt>AIS</dt><dd><Ais id={data.callRecordId}>MarineCadastre AIS (NOAA / BOEM / U.S. Coast Guard)</Ais></dd></div>
        </dl>}

        {data?.available && <div className={c.controls}>
          <div className={c.period}>
            <label>From <select value={from} onChange={(e) => set({ from: e.target.value, to: e.target.value > to ? e.target.value : to, m: '' })}>
              {allMonths.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select></label>
            <label>to <select value={to} onChange={(e) => set({ to: e.target.value, from: e.target.value < from ? e.target.value : from, m: '' })}>
              {allMonths.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select></label>
          </div>
          <GeoPicker st={st} set={set} rows={geoRows} />
          <input className={b.search} type="search" placeholder="Find a ship…" value={st.q} onChange={(e) => set({ q: e.target.value, list: !!e.target.value || st.list })} aria-label="Find a ship" />
        </div>}

        {err && <div className={c.error}>Couldn't load the report: {err}</div>}
        {!data && !err && <ShipLoader kind="report" />}
        {data && !data.available && <div className={c.note}>No notices or AIS months are loaded yet.</div>}

        {data?.available && <>
          <TopFilters st={st} set={set} facetRows={facetRows} />
          <div className={b.filterBar}>
            {!viewingSmall && st.sc !== SCRUBBER_YES && <button type="button" className={b.chip} onClick={() => set({ sc: SCRUBBER_YES })}
              title="Ships in the IMO’s scrubber notifications or on the MEP Alliance lists">Scrubber ships only</button>}
            {viewingSmall && <span className={b.chip}><b>Showing:</b> small craft<button type="button" className={b.chipX} onClick={() => set({ g: '' })} aria-label="Back to the main counts">×</button></span>}
            <FilterChips st={st} set={set} clearAll={clearAll} count={shown.length} hint="Click a number, a month or a bar to narrow the whole report." />
          </div>

          <section className={b.tiles} aria-label="Headline numbers">
            <TileBtn value={fmt(main.length)} label="Notified operations" sub={`${gal(mainGal)} gallons notified`} src={<Src href={ANT_HOME}>Ecology</Src>}
              on={!st.st && !viewingSmall} onClick={() => set({ g: '', st: '' })} />
            <TileBtn value={fmt(nSeen)} label="Seen in AIS" sub={shares('seen')} color={STATUS_COLOR.seen}
              src={<><Src href={ANT_HOME}>Ecology</Src> · <Ais id={data.callRecordId}>AIS</Ais></>} {...tile('seen')} />
            <TileBtn value={fmt(nNot)} label="Notified, not seen in AIS" sub={shares('notSeen')} color={STATUS_COLOR.notSeen}
              src={<><Src href={ANT_HOME}>Ecology</Src> · <Ais id={data.callRecordId}>AIS</Ais></>} {...tile('notSeen')} />
            <TileBtn value={fmt(nCant)} label="Can’t be checked in AIS" color={STATUS_COLOR.cantCheck}
              sub={cantTop.slice(0, 2).map(([k, n]) => `${fmt(n)} ${REASON_SHORT[k]}`).join(' · ')}
              src={<Src href={ANT_HOME}>Ecology</Src>} {...tile('cantCheck')} />
            <TileBtn value={fmt(small.length)} label="Small craft" sub="fishing boats, work boats, recreational and other small vessels; not in the counts beside" color={STATUS_COLOR.small}
              src={<Src href={ANT_HOME}>Ecology</Src>} on={viewingSmall} onClick={() => set({ g: viewingSmall ? '' : 'small', st: '' })} />
          </section>
          {seenRows.length > 0 && <p className={c.note} style={{ margin: '-6px 0 18px' }}>
            Where both agree, the median time between the notified start and the ship’s arrival in AIS is <b>{hrs(median(seenRows.map((r) => r.seen.delayH)))}</b>.
          </p>}

          <section className={c.card}>
            <div className={c.cardHead}>
              <h2 className={c.h2}>By month</h2>
              <div className={b.legend}>{(viewingSmall ? [['small', STATUS_LABEL.small, STATUS_COLOR.small]] : STATUS).map(([k, l, col]) => <span key={k}><i className={b.dot} style={{ background: col }} />{l}</span>)}</div>
            </div>
            <MonthChart rows={facetRows('m')} months={months} filt={st} set={set} />
          </section>

          <div className={b.facets}>
            <Facet name="By transfer type" dim="k" rows={facetRows('k')} filt={st} set={set} />
            <Facet name="By product" dim="f" rows={facetRows('f')} filt={st} set={set} measure="gallons" top={8} />
            <Facet name="By place" dim="p" rows={facetRows('p')} filt={st} set={set} />
            <Facet name="Dock or anchorage" dim="s" rows={facetRows('s')} filt={st} set={set} />
            <Facet name="By direction (deliverer → receiver)" dim="d" rows={facetRows('d')} filt={st} set={set} />
            <Facet name="By ship type (as notified; cruise ships split out)" dim="t" rows={facetRows('t')} filt={st} set={set} />
            <Facet name="By company (as notified)" dim="c" rows={facetRows('c')} filt={st} set={set} />
            <Facet name="By volume per operation" dim="v" rows={facetRows('v')} filt={st} set={set} top={5} order={BANDS.map(([, l]) => l)} />
            {!viewingSmall && <Facet name="Scrubber-fitted ships" dim="sc" rows={facetRows('sc')} filt={st} set={set} sub="operations" />}
            {!viewingSmall && <Facet name="Why some can’t be checked" dim="x" rows={facetRows('x')} filt={st} set={set} sub="operations" />}
          </div>

          <section className={`${c.card} ${c.wide}`} id="operations">
            <div className={c.cardHead}>
              <h2 className={c.h2}>{active.length || st.q ? 'Operations' : 'All operations'} ({fmt(shown.length)})</h2>
              <div className={b.legend}>{['seen', 'notSeen', 'cantCheck', 'small'].map((k) => { const n = shown.filter((r) => r.status === k).length
                return n > 0 && <span key={k}><i className={b.dot} style={{ background: STATUS_COLOR[k] }} />{fmt(n)} {STATUS_LABEL[k].charAt(0).toLowerCase() + STATUS_LABEL[k].slice(1)}</span> })}</div>
            </div>
            {(active.length > 0 || st.q) && <div className={b.listFilters}><span className={b.filterHint}>Filtered by</span>
              <FilterChips st={st} set={set} clearAll={clearAll} /></div>}
            <details className={b.change}>
              <summary>{active.length || st.q ? 'Change the filters' : 'Filter these operations'}</summary>
              <FilterEditor st={st} set={set} facetRows={facetRows} />
            </details>
            {st.list ? <OpsList rows={shown} data={data} />
              : <button type="button" className={b.showBtn} onClick={() => set({ list: true })}>Show the {fmt(shown.length)} operations</button>}
          </section>

          <section className={c.card}>
            <div className={c.cardHead}><h2 className={c.h2}>How this is counted</h2></div>
            <dl className={c.defs}>
              <dt>Notices</dt>
              <dd>Every notice in the <Src href={ANT_HOME}>Ecology Advance Notice of Transfer</Src> records released by Ecology, starting in the months shown.
                A notice can list several products, each its own row; notices for the same ship and place starting within 12 hours are one operation.
                Times and hours are as planned in the notice (Pacific time); companies, vessel types, products and contacts are as notified. Product groups,
                ship-type groups and directions group Ecology’s own product and vessel-type names. Ecology’s “Passenger Ship” is split into cruise ships,
                where Wikidata or Wikimedia Commons lists the ship as a cruise ship (linked on each operation), and other passenger ships.</dd>
              <dt>The ship</dt>
              <dd>The party to the notice that carries AIS: the receiver, else the deliverer. Facilities, fuel trucks and barges carry none (an ATB barge is
                named apart from its tug). Fishing vessels, work boats, recreational and unregulated vessels are counted as small craft, apart from the
                other numbers.</dd>
              <dt>Seen in AIS, at a dock</dt>
              <dd>The ship has a call at the notified terminal in <Ais id={data.callRecordId}>MarineCadastre AIS</Ais> positions (stopped, under 0.5 knot,
                within a berth’s radius for 15 minutes or more) overlapping the notified window widened by {data.rule?.tolH ?? 6} hours on each side. The ship is the
                same when one of its EarthAtlas records’ MMSIs made the call or the name it broadcast agrees with the notified name.
                At docks that are not terminals (ferry terminals, cruise berths, tug docks, shipyards, marinas), the same rule is applied
                {data.dockRecordId ? <> to <Ais id={data.dockRecordId}>dock calls</Ais></> : ' to dock calls'} within a radius of the point Ecology gives for the dock.
                A passenger ship notified at a Seattle dock but moored at Seattle’s other cruise terminal (Smith Cove / Pier 91 or Bell Street / Pier 66) in the window
                counts as seen, with the pier AIS shows named on the operation. Names Ecology spells out and ships shorten on AIS (“National Geographic” as
                “Nat Geo”) are treated as the same name.</dd>
              <dt>Seen in AIS, at an anchorage</dt>
              <dd>Fueling and lightering at anchorages are matched as in the <a className={c.src} href="/ships/reports/bunkering">anchorage report</a>: a tug alongside the
                anchored ship in <Ais id={data.bunkerRecordId}>AIS</Ais> within {data.rule?.tolH ?? 6} hours of the notified window.</dd>
              <dt>Barges</dt>
              <dd>Barges carry no AIS. Where a barge works with one tug, the tug that stays at the berth through most of the barge’s notified transfers
                (escort and assist tugs come and go) is paired with it, and checked against published fleet pages where they exist. A barge transfer is seen when
                its tug has a call at the notified place in the widened window. An ATB barge and its tug are one unit, so an ATB transfer whose tug is not there
                is not seen; a towed barge can be left at a dock, so one whose tug is not there can’t be checked.</dd>
              <dt>Scrubber-fitted ships</dt>
              <dd>A ship counts as scrubber-fitted when it is in the <Src href={SCRUBBER_SRC.gisis.href}>IMO’s scrubber notifications</Src> or on
                the <Src href={SCRUBBER_SRC.mep.href}>MEP Alliance lists</Src>, and every ship in EarthAtlas carrying the notified name is (narrowed to
                the ship whose MMSI AIS saw, where seen).</dd>
              <dt>Can’t be checked</dt>
              <dd>{Object.values(REASONS).join('; ')}.</dd>
            </dl>
          </section>
        </>}
        <BuiltByCredit variant="light" className={c.builtBy} />
      </main>
    </div>
  )
}
