/**
 * /ships/reports/bunkering: planned vs. observed bunkering at Washington anchorages (Josh 2026-10-20). Every operation Washington
 * Ecology was notified of (Advance Notice of Transfer, public records release) beside what AIS shows: the tug of a bunker barge
 * (barges carry no AIS) lying beside the anchored ship. Data: /api/ships?op=bunkerReport (lib/ships/bunkerMatch.js).
 *
 * A topline report (Josh 2026-10-20: "any aggregated number you can click on to see what it summarizes"): headline tiles, a month
 * chart and breakdowns (anchorage, ship type, fuel, volume, company, tug), every number clickable to filter the whole page; the
 * operations themselves only listed when asked for. Factual record only: every value links to its source; no conclusions.
 * URL state: from, to (months, server); st, k, p, t, f, v, c, g, m, q (filters, client).
 */
import { useEffect, useMemo, useState } from 'react'
import BuiltByCredit from '../components/BuiltByCredit.jsx'
import { ShipLoader } from '../components/panel'
import c from './ScrubberReport.module.css'
import b from './BunkeringReport.module.css'

// localhost only: ?data=prod reads production's numbers through the dev proxy (vite.config.js), as the scrubber report does.
const API = import.meta.env.DEV && new URLSearchParams(window.location.search).get('data') === 'prod' ? '/__prodread/api/ships' : '/api/ships'
const ANT_HOME = 'https://ecology.wa.gov/regulations-permits/reporting-requirements/advance-notice-of-oil-transfer'
const MC_HOME = 'https://hub.marinecadastre.gov/pages/vesseltraffic'
const rec = (id) => (id ? `/ships/source/${id}` : null)
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'))
const gal = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : fmt(Math.round(n)))
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const monthShort = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
const pacific = (t) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })
const pacMonth = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).slice(0, 7)
const hrs = (h) => (h == null ? '—' : `${Math.round(h * 10) / 10} h`)
const median = (xs) => { const v = xs.filter((x) => x != null).sort((a, z) => a - z); return v.length ? v[Math.floor(v.length / 2)] : null }
const title = (s) => String(s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Atb|Lng|Lpg|Usa)\b/g, (m) => m.toUpperCase())
const placeName = (loc) => title(String(loc || '').replace(/^Anchor - /, '')).replace(/\(([^)]+)\)/, '($1)')
const countyName = (r) => (r ? `${title(r)} County` : null)
const yesNo = (v) => (v === true ? 'Yes' : v === false ? 'No' : '—')

// ── Categories (each one names what it is built from) ─────────────────────────
export const STATUS = [
  ['seen', 'Notified and seen in AIS', '#0e7490'],
  ['notSeen', 'Notified, not seen in AIS', '#d97706'],
  ['noNotice', 'Seen in AIS, no notice found', '#7c3aed'],
]
const STATUS_COLOR = Object.fromEntries(STATUS.map(([k, , col]) => [k, col]))
const STATUS_LABEL = Object.fromEntries(STATUS.map(([k, l]) => [k, l]))
/** Ship type: the notice's receiver type (lightering: the deliverer, the tanker), else the AIS / EarthAtlas kind. */
export function shipTypeOf(antType, kind) {
  const t = String(antType || '').toUpperCase()
  if (t) {
    if (/TANK SHIP|LNG|LPG/.test(t)) return 'Tanker'
    if (/BULK/.test(t)) return 'Bulk carrier'
    if (/CONTAINER/.test(t)) return 'Container ship'
    if (/ROLL-ON|RO-RO|VEHICLE/.test(t)) return 'Ro-ro / vehicle carrier'
    if (/GENERAL CARGO/.test(t)) return 'General cargo'
    if (/ATB TUG|TUGBOAT|TUG\b/.test(t)) return 'ATB / tug'
    if (/BARGE/.test(t)) return 'Barge'
    return 'Other'
  }
  const l = String(kind?.label || ''), g = kind?.group
  if (g === 'tanker') return 'Tanker'
  if (/bulk/i.test(l)) return 'Bulk carrier'
  if (/container/i.test(l)) return 'Container ship'
  if (/vehicle|ro-?ro|car carrier/i.test(l)) return 'Ro-ro / vehicle carrier'
  if (/general/i.test(l)) return 'General cargo'
  if (g === 'cargo') return 'Cargo (kind not stated)'
  if (g === 'tug_tow') return 'ATB / tug'
  if (g === 'passenger') return 'Passenger'
  return 'Other'
}
/** Fuel: the notice's product, in a few groups (Ecology's own product names inside). */
export function fuelOf(product) {
  const p = String(product || '')
  if (/renewable/i.test(p)) return 'Renewable diesel'
  if (/diesel|gas oil|ulsd/i.test(p)) return 'Marine gas oil / diesel'
  if (/hfo|bunker/i.test(p)) return /0\.5\s*-\s*3\.5/.test(p) ? 'Heavy fuel oil, 0.5–3.5% sulfur' : 'Heavy fuel oil, ≤0.5% sulfur'
  if (/lube|motor/i.test(p)) return 'Lube / motor oil'
  return 'Other products'
}
const BANDS = [[25e3, 'Under 25,000 gal'], [100e3, '25,000–100,000 gal'], [250e3, '100,000–250,000 gal'], [500e3, '250,000–500,000 gal'], [Infinity, '500,000 gal or more']]
const bandOf = (g) => (g == null ? null : BANDS.find(([lim]) => g < lim)[1])
const kmBetween = (a, z) => {
  const r = Math.PI / 180, dLat = (z.lat - a.lat) * r, dLon = (z.lon - a.lon) * r
  return 2 * 6371 * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(z.lat * r) * Math.sin(dLon / 2) ** 2))
}

/** One row per operation, whatever its status, with every category it can be filtered by. */
function toRows(data) {
  const centers = data.locationCenters || []
  // The nearest notified location (within 6 km): an AIS-only operation takes its anchorage name, county and city.
  const nearest = (f) => {
    if (!f.anchorageCenter) return null
    let best = null
    for (const x of centers) { const d = kmBetween(f.anchorageCenter, x); if (d <= 6 && (!best || d < best.d)) best = { d, x } }
    return best?.x || null
  }
  const fromOp = (op) => {
    const fuels = new Map()
    for (const p of op.products) { const k = fuelOf(p.product); fuels.set(k, (fuels.get(k) || 0) + (p.gallons || 0)) }
    return { at: op.startAt, place: placeName(op.location), county: countyName(op.region), city: title(op.city) || null, shipName: op.kind === 'lightering' ? op.ship : op.receiver,
      shipType: shipTypeOf(op.kind === 'lightering' ? op.delivererType : op.receiverType, null), company: op.company || 'Not stated',
      kind: op.kind === 'lightering' ? 'Lightering' : 'Fueling', fuels: [...fuels].map(([k, g]) => ({ fuel: k, gallons: g })), gallons: op.gallons, band: bandOf(op.gallons), op }
  }
  const tugsOf = (f) => (f?.suppliers || []).map((s) => ({ name: s.name || `MMSI ${s.mmsi}`, v: s }))
  return [
    ...(data.matched || []).map((m) => ({ ...fromOp(m.op), status: 'seen', key: `a${m.op.antIds.join('-')}`, f: m.fueling, vessel: m.fueling.receiver,
      tugs: tugsOf(m.fueling), delayH: m.delayH, hoursDiff: m.hoursDiff, locationKm: m.locationKm })),
    ...(data.notSeen || []).map((op) => ({ ...fromOp(op), status: 'notSeen', key: `a${op.antIds.join('-')}`, tugs: [] })),
    ...(data.seenNoNotice || []).map((f) => { const n = nearest(f); return { status: 'noNotice', key: `s${f.receiver.mmsi}-${f.t0}`, at: f.t0,
      place: n ? placeName(n.location) : f.anchorageName, county: n ? countyName(n.region) : null, city: n ? title(n.city) || null : null, shipName: f.receiver.name,
      vessel: f.receiver, shipType: shipTypeOf(null, f.receiver.kind), company: null, kind: 'Not notified', fuels: [], gallons: null, band: null, f, tugs: tugsOf(f) } }),
  ].map((r) => ({ ...r, month: pacMonth(r.at) }))
}

// Filters: URL key → [label, how a row is tested, its values for the breakdowns].
const DIMS = {
  st: ['Status', (r) => [r.status], (v) => STATUS_LABEL[v] || v],
  k: ['Operation', (r) => [r.kind]],
  p: ['Anchorage', (r) => [r.place]],
  r: ['County', (r) => (r.county ? [r.county] : [])],
  y: ['City', (r) => (r.city ? [r.city] : [])],
  t: ['Ship type', (r) => [r.shipType]],
  f: ['Fuel', (r) => r.fuels.map((x) => x.fuel)],
  v: ['Volume', (r) => (r.band ? [r.band] : [])],
  c: ['Company', (r) => (r.company ? [r.company] : [])],
  g: ['Tug', (r) => r.tugs.map((x) => x.name)],
  m: ['Month', (r) => [r.month], (v) => monthName(v)],
}
const FILTER_KEYS = Object.keys(DIMS)
const notified = (r) => r.status !== 'noNotice'
function applyFilters(rows, filt, except = null) {
  const q = (filt.q || '').trim().toUpperCase()
  return rows.filter((r) => {
    for (const k of FILTER_KEYS) {
      if (k === except || !filt[k]) continue
      if (k === 'st' && filt.st === 'notified') { if (!notified(r)) return false; continue }
      if (!DIMS[k][1](r).includes(filt[k])) return false
    }
    return !q || String(r.shipName || '').toUpperCase().includes(q) || r.tugs.some((x) => x.name.toUpperCase().includes(q))
  })
}

function readUrl() {
  const sp = new URLSearchParams(window.location.search)
  const ok = (v) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(v || '') ? v : null)
  const out = { from: ok(sp.get('from')), to: ok(sp.get('to')), q: sp.get('q') || '', list: sp.get('list') === '1' }
  for (const k of FILTER_KEYS) out[k] = sp.get(k) || ''
  return out
}

// ── Small pieces ─────────────────────────────────────────────────────────────
function Src({ href, title: t, children }) {
  return href ? <a className={c.src} href={href} target="_blank" rel="noopener noreferrer" title={t}>{children}</a> : <>{children}</>
}
const Ant = ({ op, children }) => <Src href={rec(op.recordIds?.[0])} title={`Ecology Advance Notice of Transfer ${op.antIds.join(', ')}, as released`}>{children}</Src>
const Ais = ({ id, children }) => <Src href={rec(id) || MC_HOME} title="Found by EarthAtlas in MarineCadastre AIS (NOAA / BOEM / USCG) — click for the count’s record">{children}</Src>
const Ship = ({ v, name }) => (v?.vesselId ? <a className={c.shipLink} href={`/ships?v=${v.vesselId}`} target="_blank" rel="noopener noreferrer" title="Open this ship’s card">{name || v.name}</a> : <span>{name || v?.name}</span>)

/** A clickable headline number. */
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
      const x = m.get(v) || { v, n: 0, g: 0, by: { seen: 0, notSeen: 0, noNotice: 0 } }
      x.n++; x.by[r.status]++
      x.g += dim === 'f' ? (r.fuels.find((y) => y.fuel === v)?.gallons || 0) : (r.gallons || 0)
      m.set(v, x)
    }
    // A fixed order where the values have one (volume bands smallest first); else largest first.
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
                : STATUS.map(([k, , col]) => x.by[k] > 0 && <span key={k} className={b.fill} style={{ width: `${(x.by[k] / max) * 100}%`, background: col }} />)}</span>
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
  const by = new Map(months.map((m) => [m, { seen: 0, notSeen: 0, noNotice: 0, n: 0 }]))
  for (const r of rows) { const x = by.get(r.month); if (x) { x[r.status]++; x.n++ } }
  const max = Math.max(...[...by.values()].map((x) => x.n), 1)
  return (
    <div className={b.months}>
      {months.map((m, i) => {
        const x = by.get(m), on = filt.m === m
        // The year where it changes: on the first month shown and on every January.
        const withYear = i === 0 || m.endsWith('-01')
        return (
          <button key={m} type="button" className={`${b.monthCol} ${on ? b.monthOn : ''} ${filt.m && !on ? b.monthDim : ''}`} onClick={() => set({ m: on ? '' : m })}
            title={`${monthName(m)}: ${STATUS.map(([k, l]) => `${x[k]} ${l.charAt(0).toLowerCase() + l.slice(1)}`).join(', ')}`}>
            <span className={b.monthN}>{x.n || ''}</span>
            <span className={b.monthStack} style={{ height: `${(x.n / max) * 130}px` }}>
              {STATUS.map(([k, , col]) => x[k] > 0 && <span key={k} className={b.monthSeg} style={{ height: `${(x[k] / x.n) * 100}%`, background: col }} />)}
            </span>
            <span className={b.monthLbl}>{monthShort(m)}{withYear ? ` ’${m.slice(2, 4)}` : ''}</span>
          </button>
        )
      })}
    </div>
  )
}

/** The operations, only when asked for: 50 at a time. */
function OpsList({ rows, aisRecordId, rule }) {
  const [n, setN] = useState(50)
  const sorted = [...rows].sort((a, z) => z.at.localeCompare(a.at))
  return <>
    <div className={b.listWrap}><table className={b.list}>
      <thead><tr><th>Date (Pacific)</th><th>Anchorage</th><th>Ship</th><th>Notified to Ecology</th><th>Seen in AIS</th><th>Status</th></tr></thead>
      <tbody>{sorted.slice(0, n).map((r) => (
        <tr key={r.key}>
          <td>{r.op ? <Ant op={r.op}>{pacific(r.at)}</Ant> : <Ais id={aisRecordId}>{pacific(r.at)}</Ais>}</td>
          <td>{r.place}{r.f?.outside && <div className={b.sub}>AIS: just outside the charted area</div>}</td>
          <td>{r.vessel ? <Ship v={r.vessel} name={r.shipName} /> : r.op ? <Ant op={r.op}>{r.shipName}</Ant> : r.shipName}
            <div className={b.sub}>{r.shipType}{r.kind === 'Lightering' ? ` · lightering to ${r.op.receiver}` : ''}</div></td>
          <td>{r.op ? <>
            <Ant op={r.op}>{r.op.company}</Ant>{r.kind !== 'Lightering' && r.op.deliverers.length > 0 && <> · barge <Ant op={r.op}>{r.op.deliverers.join(', ')}</Ant></>}
            <div className={b.sub}><Ant op={r.op}>{fmt(Math.round(r.gallons))} gal</Ant>: {r.fuels.map((x) => `${x.fuel} ${gal(x.gallons)}`).join('; ')}</div>
            <div className={b.sub}>{hrs(r.op.durationH)} planned · pre-boomed <Ant op={r.op}>{yesNo(r.op.isPreboomed)}</Ant> · over 500 gal/min <Ant op={r.op}>{yesNo(r.op.rateGt500)}</Ant></div>
            {r.op.contacts.map((k, i) => <div key={i} className={b.sub}>Contact: <Ant op={r.op}>{[k.name, k.phone].filter(Boolean).join(', ')}</Ant></div>)}
          </> : <span className={b.sub}>No notice found within {rule?.tolH ?? 6} hours</span>}</td>
          <td>{r.f ? <>
            {r.tugs.map((x, i) => <span key={x.v.vesselId || x.v.mmsi}>{i > 0 && ', '}<Ship v={x.v} /></span>)} alongside
            <div className={b.sub}><Ais id={aisRecordId}>{pacific(r.f.t0)} – {pacific(r.f.t1)}</Ais></div>
            <div className={b.sub}>{hrs(r.f.hours)}{r.delayH != null && <> · started {r.delayH > 0 ? '+' : ''}{hrs(r.delayH)} vs. notified</>}</div>
            {r.locationKm != null && r.locationKm > (rule?.locationDiffKm ?? 3) && <div className={b.sub}>{r.locationKm} km from the notified location</div>}
          </> : <span className={b.sub}>Not seen</span>}</td>
          <td><span className={b.dot} style={{ background: STATUS_COLOR[r.status], marginRight: 6 }} />{STATUS_LABEL[r.status]}</td>
        </tr>))}</tbody>
    </table></div>
    {sorted.length > n && <button type="button" className={b.more} onClick={() => setN(n + 50)}>Show 50 more (of {fmt(sorted.length)})</button>}
  </>
}

/** The filters in force, each removable (shared by the bar above the charts and the list). */
function FilterChips({ st, set, clearAll, count, hint }) {
  const active = FILTER_KEYS.filter((k) => st[k])
  if (!active.length && !st.q) return <span className={b.filterHint}>{hint}</span>
  return <>
    {active.map((k) => (
      <span key={k} className={b.chip}><b>{DIMS[k][0]}:</b> {k === 'st' && st.st === 'notified' ? 'Notified' : (DIMS[k][2] || ((v) => v))(st[k])}
        <button type="button" className={b.chipX} onClick={() => set({ [k]: '' })} aria-label={`Remove ${DIMS[k][0]}`}>×</button></span>))}
    {st.q && <span className={b.chip}><b>Ship or tug:</b> {st.q}<button type="button" className={b.chipX} onClick={() => set({ q: '' })} aria-label="Remove search">×</button></span>}
    <button type="button" className={b.clear} onClick={clearAll}>Clear all</button>
    {count != null && <span className={b.filterHint}>{fmt(count)} operations</span>}
  </>
}

/** Focus geography (as the scrubber report): one county, city or anchorage; picking one replaces the other two. */
function GeoPicker({ st, set, rows }) {
  const groups = [['r', 'Counties'], ['y', 'Cities and towns'], ['p', 'Anchorages']].map(([dim, label]) => {
    const m = new Map()
    for (const r of rows) for (const v of DIMS[dim][1](r)) m.set(v, (m.get(v) || 0) + 1)
    return [dim, label, [...m].sort((a, z) => String(a[0]).localeCompare(String(z[0])))]
  }).filter(([, , xs]) => xs.length)
  const value = ['r', 'y', 'p'].map((d) => (st[d] ? `${d}:${st[d]}` : '')).find(Boolean) || ''
  return (
    <label className={c.focus}>Focus geography:
      <select value={value} onChange={(e) => { const [d, ...v] = e.target.value.split(':'); set({ r: '', y: '', p: '', ...(d ? { [d]: v.join(':') } : {}) }) }}>
        <option value="">All Washington anchorages</option>
        {groups.map(([dim, label, xs]) => <optgroup key={dim} label={label}>{xs.map(([v, n]) => <option key={v} value={`${dim}:${v}`}>{v} ({fmt(n)})</option>)}</optgroup>)}
      </select>
    </label>
  )
}

/** Change any filter from the list: one dropdown per category, listing the values that still have operations (with counts). */
function FilterEditor({ st, set, facetRows }) {
  const opts = (dim) => {
    const m = new Map()
    for (const r of facetRows(dim)) for (const v of new Set(DIMS[dim][1](r))) m.set(v, (m.get(v) || 0) + 1)
    const list = [...m].sort((a, z) => (dim === 'm' ? String(z[0]).localeCompare(String(a[0])) : dim === 'v' ? BANDS.findIndex(([, l]) => l === a[0]) - BANDS.findIndex(([, l]) => l === z[0]) : z[1] - a[1]))
    if (st[dim] && !m.has(st[dim])) list.unshift([st[dim], 0])
    return list
  }
  const statusOpts = [['notified', 'Notified (seen or not)'], ...STATUS.map(([k, l]) => [k, l])]
  return (
    <div className={b.editor}>
      <label>Status <select value={st.st} onChange={(e) => set({ st: e.target.value })}>
        <option value="">All</option>{statusOpts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      {['r', 'y', 'p', 't', 'f', 'v', 'c', 'g', 'm', 'k'].map((dim) => (
        <label key={dim}>{DIMS[dim][0]} <select value={st[dim]} onChange={(e) => set({ [dim]: e.target.value })}>
          <option value="">All</option>
          {opts(dim).map(([v, n]) => <option key={v} value={v}>{(DIMS[dim][2] || ((x) => x))(v)} ({fmt(n)})</option>)}
        </select></label>
      ))}
      <label>Ship or tug <input className={b.search} type="search" value={st.q} placeholder="Name…" onChange={(e) => set({ q: e.target.value })} /></label>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function BunkeringReport() {
  const [st, setSt] = useState(readUrl)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const set = (p) => setSt((s) => ({ ...s, ...p, ...(Object.keys(p).some((k) => FILTER_KEYS.includes(k) && p[k]) ? { list: true } : {}) }))
  useEffect(() => { document.title = 'Planned vs. observed bunkering at Washington anchorages · EarthAtlas Ships' }, [])
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    for (const k of ['from', 'to', 'q', ...FILTER_KEYS]) { if (st[k]) q.set(k, st[k]); else q.delete(k) }
    if (st.list) q.set('list', '1'); else q.delete('list')
    const s = q.toString()
    window.history.replaceState(null, '', window.location.pathname + (s ? `?${s}` : ''))
  }, [st])
  useEffect(() => {
    setData(null); setErr(null)
    const api = new URLSearchParams({ op: 'bunkerReport', ...(st.from ? { from: st.from } : {}), ...(st.to ? { to: st.to } : {}) })
    fetch(`${API}?${api}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`load failed (${r.status})`)))).then(setData).catch((e) => setErr(e.message))
  }, [st.from, st.to])

  const rows = useMemo(() => (data?.available ? toRows(data) : []), [data])
  const shown = useMemo(() => applyFilters(rows, st), [rows, st])
  const facetRows = (dim) => applyFilters(rows, st, dim)
  // The geography picker lists every county, city and anchorage that has operations under the other (non-place) filters.
  const geoRows = applyFilters(rows, { ...st, r: '', y: '', p: '' })
  const tileRows = applyFilters(rows, st, 'st')
  const count = (k) => tileRows.filter((r) => (k === 'notified' ? notified(r) : r.status === k)).length
  const nNotified = count('notified'), nSeen = count('seen')
  const fuelGal = tileRows.filter((r) => r.kind === 'Fueling').reduce((g, r) => g + (r.gallons || 0), 0)
  const seenRows = tileRows.filter((r) => r.status === 'seen')
  const months = data?.picked?.length ? data.picked : data?.months || []
  const allMonths = data?.months || []
  const from = st.from || allMonths[0], to = st.to || allMonths[allMonths.length - 1]
  const active = FILTER_KEYS.filter((k) => st[k])
  const tile = (k) => ({ on: st.st === k, onClick: () => set({ st: st.st === k ? '' : k }) })
  const clearAll = () => setSt((s) => ({ ...s, q: '', ...Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])) }))

  return (
    <div className={c.page}>
      <header className={c.top}>
        <a href="/ships" className={c.brand}>EarthAtlas <span>Ships</span></a>
        <button className={c.print} onClick={() => window.print()} disabled={!data?.available}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" />
          </svg>
          Print or save as PDF
        </button>
      </header>
      <main className={c.main}>
        <div className={c.kicker}>Report</div>
        <h1 className={c.title}>Planned vs. observed bunkering at Washington anchorages</h1>
        <p className={c.lede}>
          Every over-water transfer of more than 100 gallons of oil to a vessel in Washington is notified in advance to the{' '}
          <Src href={ANT_HOME}>Washington State Department of Ecology</Src>. This report sets the fueling and lightering notified at anchorages beside
          what <Src href={MC_HOME}>NOAA’s AIS ship positions</Src> show: the tug of a bunker barge (a barge carries no AIS of its own) lying beside the anchored ship.
          Click any number to see the operations behind it.
        </p>

        {data?.available && <dl className={c.facts}>
          <div><dt>Period</dt><dd>{from && to ? `${monthName(from)} – ${monthName(to)}` : '—'}</dd></div>
          <div><dt>Area</dt><dd>Washington anchorages within NOAA’s AIS coverage</dd></div>
          <div><dt>Notices</dt><dd><Src href={ANT_HOME}>Ecology Advance Notice of Transfer records</Src>, public records release ({String(data.release || '').replace(/^ant-/, '')})</dd></div>
          <div><dt>AIS</dt><dd><Ais id={data.aisRecordId}>MarineCadastre AIS (NOAA / BOEM / U.S. Coast Guard)</Ais></dd></div>
        </dl>}

        {data?.available && <div className={c.controls}>
          <div className={c.period}>
            <label>From <select value={from} onChange={(e) => set({ from: e.target.value, to: e.target.value > to ? e.target.value : to, m: '' })}>
              {allMonths.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select></label>
            <label>to <select value={to} onChange={(e) => set({ to: e.target.value, from: e.target.value < from ? e.target.value : from, m: '' })}>
              {allMonths.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select></label>
          </div>
          <GeoPicker st={st} set={set} rows={geoRows} />
          <input className={b.search} type="search" placeholder="Find a ship or tug…" value={st.q} onChange={(e) => set({ q: e.target.value, list: !!e.target.value || st.list })} aria-label="Find a ship or tug" />
        </div>}

        {err && <div className={c.error}>Couldn't load the report: {err}</div>}
        {!data && !err && <ShipLoader kind="bunkering" />}
        {data && !data.available && <div className={c.note}>No notices or AIS operations are loaded yet.</div>}

        {data?.available && <>
          <section className={b.tiles} aria-label="Headline numbers">
            <TileBtn value={fmt(nNotified)} label="Notified operations" sub={`${gal(fuelGal)} gallons of fuel notified`} src={<Src href={ANT_HOME}>Ecology</Src>} {...tile('notified')} />
            <TileBtn value={fmt(nSeen)} label="Seen in AIS" sub={nNotified ? `${Math.round((100 * nSeen) / nNotified)}% of notified operations` : ''} color={STATUS_COLOR.seen}
              src={<><Src href={ANT_HOME}>Ecology</Src> · <Ais id={data.aisRecordId}>AIS</Ais></>} {...tile('seen')} />
            <TileBtn value={fmt(count('notSeen'))} label="Notified, not seen in AIS" color={STATUS_COLOR.notSeen} src={<><Src href={ANT_HOME}>Ecology</Src> · <Ais id={data.aisRecordId}>AIS</Ais></>} {...tile('notSeen')} />
            <TileBtn value={fmt(count('noNotice'))} label="Seen in AIS, no notice found" color={STATUS_COLOR.noNotice} sub={`a known bunker tug alongside ${data.rule?.minUnmatchedHours ?? 2} h or more`}
              src={<><Ais id={data.aisRecordId}>AIS</Ais> · <Src href={ANT_HOME}>Ecology</Src></>} {...tile('noNotice')} />
          </section>
          {seenRows.length > 0 && <p className={c.note} style={{ margin: '-6px 0 18px' }}>
            Where both agree, the tug arrived a median <b>{hrs(median(seenRows.map((r) => r.delayH)))}</b> after the notified start and was alongside a median{' '}
            <b>{hrs(median(seenRows.map((r) => r.f.hours)))}</b>, against <b>{hrs(median(seenRows.map((r) => r.op.durationH)))}</b> planned.
          </p>}

          <div className={b.filterBar}>
            <FilterChips st={st} set={set} clearAll={clearAll} count={shown.length} hint="Click a number, a month or a bar to narrow the whole report." />
          </div>

          <section className={c.card}>
            <div className={c.cardHead}>
              <h2 className={c.h2}>By month</h2>
              <div className={b.legend}>{STATUS.map(([k, l, col]) => <span key={k}><i className={b.dot} style={{ background: col }} />{l}</span>)}</div>
            </div>
            <MonthChart rows={facetRows('m')} months={months} filt={st} set={set} />
          </section>

          <div className={b.facets}>
            <Facet name="By anchorage" dim="p" rows={facetRows('p')} filt={st} set={set} />
            <Facet name="By ship type" dim="t" rows={facetRows('t')} filt={st} set={set} />
            <Facet name="By fuel" dim="f" rows={facetRows('f')} filt={st} set={set} measure="gallons" sub="gallons notified · operations" />
            <Facet name="By volume per operation" dim="v" rows={facetRows('v')} filt={st} set={set} top={5} order={BANDS.map(([, l]) => l)} />
            <Facet name="By company (as notified)" dim="c" rows={facetRows('c')} filt={st} set={set} />
            <Facet name="By tug alongside (AIS)" dim="g" rows={facetRows('g')} filt={st} set={set} sub="operations" />
          </div>

          <section className={`${c.card} ${c.wide}`} id="operations">
            <div className={c.cardHead}>
              <h2 className={c.h2}>{active.length || st.q ? 'Operations' : 'All operations'} ({fmt(shown.length)})</h2>
              {/* What the number is made of, so it reads against the tiles above (Josh 2026-10-20: "what does 722 mean?"). */}
              <div className={b.legend}>{STATUS.map(([k, l, col]) => { const n = shown.filter((r) => r.status === k).length
                return n > 0 && <span key={k}><i className={b.dot} style={{ background: col }} />{fmt(n)} {l.charAt(0).toLowerCase() + l.slice(1)}</span> })}</div>
            </div>
            {(active.length > 0 || st.q) && <div className={b.listFilters}><span className={b.filterHint}>Filtered by</span>
              <FilterChips st={st} set={set} clearAll={clearAll} /></div>}
            <details className={b.change} open={!active.length && !st.q ? undefined : undefined}>
              <summary>{active.length || st.q ? 'Change the filters' : 'Filter these operations'}</summary>
              <FilterEditor st={st} set={set} facetRows={facetRows} />
            </details>
            {st.list ? <OpsList rows={shown} aisRecordId={data.aisRecordId} rule={data.rule} />
              : <button type="button" className={b.showBtn} onClick={() => set({ list: true })}>Show the {fmt(shown.length)} operations</button>}
          </section>

          <section className={c.card}>
            <div className={c.cardHead}><h2 className={c.h2}>How this is counted</h2></div>
            <dl className={c.defs}>
              <dt>Notices</dt>
              <dd>Fueling and lightering notices at anchorage locations (“Anchor - …”) in the <Src href={ANT_HOME}>Ecology Advance Notice of Transfer</Src> records
                released by Ecology. A notice can list several products, each its own row; two notices for the same ship and anchorage starting within 12 hours
                are one operation. Times and hours are as planned in the notice (Pacific time); contacts are as notified. Fuel groups and ship types group
                Ecology’s own product and vessel-type names.</dd>
              <dt>Seen in AIS</dt>
              <dd>A tug or towing vessel (15 m or longer) within 200 m of a ship anchored at an anchorage, both under 1 knot, for an hour or more, in{' '}
                <Ais id={data.aisRecordId}>MarineCadastre AIS</Ais> positions; tugs overlapping on one ship are one operation. A ship reporting “at anchor”
                just outside an anchorage’s charted area is listed under the nearest anchorage.</dd>
              <dt>Matching</dt>
              <dd>A notice and an AIS operation match when they name the same ship (by its EarthAtlas record, or by name) and the AIS operation falls within{' '}
                {data.rule?.tolH ?? 6} hours of the notified window. For lightering the notice’s deliverer, the tanker, is the ship AIS sees.</dd>
              <dt>No notice found</dt>
              <dd>An AIS operation of at least {data.rule?.minUnmatchedHours ?? 2} hours with a tug that was alongside in notified operations at least{' '}
                {data.rule?.learnMin ?? 2} times, and no notice for that ship within {data.rule?.tolH ?? 6} hours.</dd>
            </dl>
          </section>
        </>}
        <BuiltByCredit />
      </main>
    </div>
  )
}
