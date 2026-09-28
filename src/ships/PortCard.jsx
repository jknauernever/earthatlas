/**
 * The port card (/ships Phase 3 step 3; Josh, 2026-09-27): opened by clicking a port on the map.
 * - What the port is: World Port Index (or Global Fishing Watch's anchorage name), country, harbour size / type.
 * - Arrivals per month over the map's selected months (GFW /events/stats), a bar per month; click one to list its ships.
 * - Ships that called here that month (GFW port-visit events, stored as evidence); each opens its ship card.
 * - For ports IMF PortWatch covers: daily port calls and import / export estimates, 7-day averages, with PortWatch's
 *   required citation. Relative trends, not official statistics.
 * Every number links to where it came from (EarthAtlas inline-provenance rule). Data: lib/ships/portCard.js.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import styles from './ShipsApp.module.css'
import pick from './ShipPicker.module.css'
import Chevron from './Chevron.jsx'
import { Loading, LoadingInline } from '../components/panel'
import PortEmissions, { usePortEmissions, shortTonnes } from './PortEmissions.jsx'

export const PORT_HUE = '#fb923c'
const IMPORT_HUE = '#3b82f6' // validated pair on the dark card (dataviz validator, 2026-09-27)
const EXPORT_HUE = '#d97706'
const PW_CITATION = 'Sources: Kpler; UN Global Platform; IMF PortWatch (portwatch.imf.org).'
const HARBOR = { L: 'Large', M: 'Medium', S: 'Small', V: 'Very small' }
// WPI harborType codes seen in the data and named in NGA's field guide (docs/PORTS_SOURCES.md §1); others show raw.
const HARBOR_TYPE = { CN: 'coastal, natural', CB: 'coastal, breakwater', RN: 'river, natural' }
const PW_TYPES = [['container', 'container'], ['dry_bulk', 'dry bulk'], ['general_cargo', 'general cargo'], ['roro', 'RoRo'], ['tanker', 'tanker']]
const GFW_KIND = { passenger: 'passenger', other: 'other', fishing: 'fishing', cargo: 'cargo', carrier: 'fish carrier', bunker: 'bunker',
  gear: 'fishing gear', support: 'support', seismic_vessel: 'seismic', discrepancy: 'conflicting type', NA: 'no type' }

const titleCase = (s) => String(s).toLowerCase().replace(/(^|[\s\-'/(])([a-z])/g, (_, p, c) => p + c.toUpperCase())
const fmtN = (n) => Number(n).toLocaleString('en-US')
const plural = (n, w, ws = `${w}s`) => `${fmtN(n)} ${n === 1 ? w : ws}`
const monthName = (ym, style = 'short') => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: style, year: 'numeric', timeZone: 'UTC' })
const dayName = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const rec = (id) => `/ships/source/${id}`
const compactT = (t) => (t >= 1e6 ? `${(t / 1e6).toFixed(t >= 1e7 ? 0 : 1)} million t` : t >= 1e3 ? `${fmtN(Math.round(t / 1e3))} thousand t` : `${fmtN(Math.round(t))} t`)
const perDay = (v) => (v == null ? 'no value' : v >= 10 ? fmtN(Math.round(v)) : v.toFixed(1))

/** GFW's monthly arrivals, one bar per month; the listed month is drawn deeper. Click / arrow keys pick a month. */
// `say(n)` words one month's value (default: arrivals); `hue` colours the bars. Also used by PortEmissions.jsx.
export function MonthBars({ months, month, onMonth, say = (n) => plural(n, 'arrival'), hue = PORT_HUE, label = 'Arrivals per month; pick a month to list its ships', listed = true }) {
  const max = Math.max(1e-9, ...months.map((m) => m.n || 0))
  const [hover, setHover] = useState(null)
  const shown = hover ?? months.find((m) => m.month === month)
  return (
    <div className={styles.pcBars}>
      <div className={styles.pcBarsReadout} aria-live="polite">
        {shown ? <>{monthName(shown.month, 'long')}: <strong>{shown.n == null ? 'not reported' : say(shown.n)}</strong>{listed && shown.month === month && !hover ? ' · listed below' : ''}</> : ' '}
      </div>
      <div className={styles.pcBarsRow} role="listbox" aria-label={label}>
        {months.map((m) => {
          const on = m.month === month
          return (
            <button key={m.month} type="button" role="option" aria-selected={on} className={styles.pcBar}
              onClick={() => onMonth(m.month)} onMouseEnter={() => setHover(m)} onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(m)} onBlur={() => setHover(null)}
              aria-label={`${monthName(m.month, 'long')}: ${m.n == null ? 'not reported' : say(m.n)}`}>
              <span className={styles.pcBarFill} style={{ height: `${Math.max(m.n ? 6 : 0, (100 * (m.n || 0)) / max)}%`, background: hue, opacity: on ? 1 : 0.38 }} />
            </button>
          )
        })}
      </div>
      <div className={styles.pcBarsAxis}><span>{monthName(months[0].month)}</span><span>{monthName(months[months.length - 1].month)}</span></div>
    </div>
  )
}

/**
 * Small line chart (one y-axis) with a crosshair readout. series: [{ key, label, color, values }]; dates: 'YYYY-MM-DD'.
 * fmt formats a value for the readout; nulls break the line.
 */
function LineChart({ dates, series, fmt, height = 74, label }) {
  const W = 360, H = height, pad = { t: 6, r: 4, b: 14, l: 4 }
  const [hi, setHi] = useState(null)
  const svgRef = useRef(null)
  const max = Math.max(1e-9, ...series.flatMap((s) => s.values.filter((v) => v != null)))
  const x = (i) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, dates.length - 1)
  const y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b)
  const path = (vals) => vals.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .reduce((acc, p, i, arr) => (p == null ? acc : acc + (i === 0 || arr[i - 1] == null ? `M${p}` : `L${p}`)), '')
  const onMove = (e) => {
    const r = svgRef.current.getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left) / r.width * W - pad.l) / ((W - pad.l - pad.r) / Math.max(1, dates.length - 1)))
    setHi(Math.max(0, Math.min(dates.length - 1, i)))
  }
  return (
    <div className={styles.pcLine}>
      <div className={styles.pcBarsReadout} aria-live="polite">
        {hi != null ? <>{dayName(dates[hi])}: {series.map((s, k) => <span key={s.key}>{k > 0 && ' · '}{series.length > 1 && <span className={styles.pcSwatch} style={{ background: s.color }} />}{series.length > 1 ? `${s.label} ` : ''}<strong>{fmt(s.values[hi])}</strong></span>)}</>
          : <>{series.length > 1 ? series.map((s, k) => <span key={s.key}>{k > 0 && ' · '}<span className={styles.pcSwatch} style={{ background: s.color }} />{s.label}</span>) : label} <span className={styles.pcMuted}>· peak {fmt(max)}</span></>}
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label={label}
        onMouseMove={onMove} onMouseLeave={() => setHi(null)} style={{ display: 'block', cursor: 'crosshair' }}>
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="rgba(255,255,255,0.18)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {series.map((s) => <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
        {hi != null && <line x1={x(hi)} x2={x(hi)} y1={pad.t} y2={H - pad.b} stroke="rgba(255,255,255,0.45)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        <text x={pad.l} y={H - 2} fontSize="9" fill="rgba(255,255,255,0.5)">{dayName(dates[0])}</text>
        <text x={W - pad.r} y={H - 2} fontSize="9" fill="rgba(255,255,255,0.5)" textAnchor="end">{dayName(dates[dates.length - 1])}</text>
      </svg>
    </div>
  )
}

/** A listed ship: opens its card (our database), or saves GFW's identity first (server checks it's a listed ship). */
function ShipRow({ s, onSelectVessel }) {
  const [state, setState] = useState(null)
  const open = async () => {
    if (s.vesselId) return onSelectVessel(s.vesselId)
    setState('saving')
    try {
      const r = await fetch(`/api/ships?op=portShip&gfw=${encodeURIComponent(s.gfwId)}`, { method: 'POST' })
      const d = await r.json()
      if (d.vesselId) return onSelectVessel(d.vesselId)
      setState(d.status === 'ambiguous' ? 'ambiguous' : 'unknown')
    } catch { setState('error') }
  }
  const name = s.name ? titleCase(s.name) : `MMSI ${s.mmsi || '?'}`
  return (
    <div className={styles.incident}>
      <div className={styles.incidentHead}>
        <span className={styles.incidentTitle}>
          <button type="button" className={styles.pcShipLink} onClick={open} disabled={state === 'saving'}
            title={s.vesselId ? 'Open this ship’s card' : 'Not in EarthAtlas yet: look it up with Global Fishing Watch and open its card'}>{name}</button>
          {s.flag && <span className={styles.portCountry} title="Flag state the ship broadcast (AIS, as Global Fishing Watch gives it)">{s.flag}</span>}
        </span>
        <span className={styles.period}>{plural(s.calls, 'arrival')}</span>
      </div>
      <div className={styles.incidentMeta}>
        {[s.mmsi && s.name && `MMSI ${s.mmsi}`, s.gfwType && (GFW_KIND[s.gfwType] || s.gfwType)].filter(Boolean).join(' · ')}
        {' · '}last {dayName(s.lastAt)} UTC{' · '}
        <a className={`${styles.sourceLink} ${styles.srcLink}`} href={rec(s.recordId)} target="_blank" rel="noopener noreferrer"
          title={`Global Fishing Watch port-visit event ${s.eventId} (the latest arrival listed), exactly as received · CC BY-NC 4.0 — click for the raw record`}>GFW</a>
        {state === 'saving' && <> · looking up…</>}
        {state === 'ambiguous' && <> · several EarthAtlas ships share this identity</>}
        {(state === 'unknown' || state === 'error') && <> · couldn’t open this ship right now</>}
      </div>
    </div>
  )
}

/** A tab's notes and caveats, closed by default (the panel standard's "i" text, in card form). */
function About({ children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.pcAbout}>
      <button type="button" className={styles.recordToggle} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        About this data <Chevron up={open} size={13} />
      </button>
      {open && <div className={styles.legendNoteText}>{children}</div>}
    </div>
  )
}

export default function PortCard({ portId, months, month, onMonth, onClose, onSelectVessel, onOpenPort, folded, onFold, tab: tabProp, onTab }) {
  const [data, setData] = useState(null)
  const [list, setList] = useState([])
  const [err, setErr] = useState(null)
  const [more, setMore] = useState(false)
  const [slow, setSlow] = useState(false)
  const from = months[0], to = months[months.length - 1]
  const base = `/api/ships?op=port&id=${encodeURIComponent(portId)}&from=${from}&to=${to}${month ? `&m=${month}` : ''}`
  useEffect(() => {
    const ctl = new AbortController()
    setErr(null); setSlow(false)
    const t = setTimeout(() => setSlow(true), 3000)
    fetch(`${base}&limit=40`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'Port not found' : `Load failed (${r.status})`))))
      .then((d) => { setData(d); setList(d.ships?.list || []) })
      .catch((e) => { if (e.name !== 'AbortError') setErr(e.message) })
      .finally(() => clearTimeout(t))
    return () => { ctl.abort(); clearTimeout(t) }
  }, [base])
  const loadMore = () => {
    setMore(true)
    fetch(`${base}&fetch=0&limit=40&offset=${list.length}`).then((r) => r.json())
      .then((d) => setList((l) => [...l, ...(d.ships?.list || [])])).catch(() => {}).finally(() => setMore(false))
  }
  const src = useMemo(() => Object.fromEntries((data?.sources || []).map((x) => [x.id, x])), [data])
  const loading = !data || (data.port && String(data.port.id) !== String(portId))
  const p = data?.port
  const pname = p ? (p.origin === 'gfw_port_label' ? titleCase(p.name || '') : p.name) : null
  const f = data?.fetch || {}
  const gfwTrouble = ['failed', 'budget', 'no_gfw'].some((k) => [f.stats, f.events, f.discover].includes(k))
  const em = usePortEmissions(portId, data?.window?.months || months)
  // Tabs this port has data for; a tab from the URL that doesn't apply falls back to Traffic.
  const tabs = [['traffic', 'Traffic'], ...(data?.labels?.length ? [['ships', 'Ships']] : []), ['emissions', 'Emissions'],
    ...(data?.portwatch?.join === 'joined' && data.portwatch.series?.dates?.length ? [['trade', 'Trade']] : [])]
  const tab = tabs.some(([id]) => id === tabProp) ? tabProp : 'traffic'

  return (
    <div className={`${pick.card} ${folded ? pick.cardFolded : ''}`} role="dialog" aria-label="Port card">
      <button type="button" className={pick.fold} onClick={() => onFold(!folded)}
        aria-label={folded ? 'Unfold port card' : 'Fold port card'} title={folded ? 'Show the whole card' : 'Fold the card to its name'}><Chevron up={!folded} size={16} /></button>
      <button type="button" className={pick.close} onClick={onClose} aria-label="Close port card">×</button>
      {err && <div className={styles.errorNote}>{err}</div>}
      {loading && !err && (
        <Loading kind={slow ? 'slow' : 'quick'} className={styles.loadingNote} style={{ paddingRight: 56 }} />
      )}
      {!loading && p && <>
        <div className={styles.vesselHead}>
          <div className={styles.pcKicker}><span className={styles.pcDot} style={{ background: PORT_HUE }} aria-hidden="true" />Port</div>
          <div className={styles.vesselName}>{pname}{' '}
            <a className={`${styles.sourceLink} ${styles.srcLink}`} href={rec(p.name_source_record_id)} target="_blank" rel="noopener noreferrer"
              title={p.origin === 'wpi' ? `World Port Index port ${p.wpi_number} (NGA Pub 150, public domain) — click for the WPI record`
                : p.origin === 'climate_trace' ? 'Not in the World Port Index: a port Climate TRACE estimates ship emissions for (no World Port Index or GFW port within 10 km) — click for the Climate TRACE record'
                : `No World Port Index port here; name from ${p.name_source_id === 'gfw-anchorage-overrides' ? 'Global Fishing Watch’s reviewed anchorage-name list (Apache-2.0)' : 'Global Fishing Watch’s port-visit events'} for GFW port ${data.labels.map((l) => l.label).join(', ')} — click for the record`}>
              {p.origin === 'wpi' ? 'WPI' : p.origin === 'climate_trace' ? 'Climate TRACE' : p.name_source_id === 'gfw-anchorage-overrides' ? 'GFW anchorages' : 'GFW'}</a>
          </div>
          <div className={styles.vesselSub}>
            {p.country_name
              ? <a className={styles.pcPlainLink} href={p.country_record_id ? rec(p.country_record_id) : 'https://www.geonames.org'} target="_blank" rel="noopener noreferrer"
                  title={`Country code ${p.iso2 || p.iso3} from ${p.origin === 'wpi' ? 'the World Port Index' : 'Global Fishing Watch'}; English name from GeoNames (CC BY 4.0) — click for the GeoNames row`}>{p.country_name}</a>
              : (p.iso2 || p.iso3)}
            {p.harbor_size && <> · <a className={styles.pcPlainLink} href={rec(p.name_source_record_id)} target="_blank" rel="noopener noreferrer"
              title="World Port Index harbour size (NGA: based on area, facilities and wharf space, not any single factor) and type — click for the WPI record">
              {HARBOR[p.harbor_size] || p.harbor_size} harbour{p.harbor_type ? `, ${HARBOR_TYPE[p.harbor_type] || `type ${p.harbor_type}`}` : ''}</a></>}
            {p.unlocode && <span className={styles.pcMuted} title="UN/LOCODE as the World Port Index gives it (used to match IMF PortWatch)"> · {p.unlocode}</span>}
          </div>
          {data.labels.length > 0 && (
            <div className={styles.idNote} title="Global Fishing Watch port labels EarthAtlas matched to this port (World Port Index port within 4 km of GFW's anchorages, or GFW's own name)">
              Global Fishing Watch port{data.labels.length > 1 ? 's' : ''}: {data.labels.map((l) => l.label).join(', ')}
            </div>
          )}
        </div>

        {/* Option A (Josh 2026-09-27): headline numbers for the picked months, then one topic per tab. */}
        <div className={styles.pcKpis}>
          <div className={styles.pcKpi}><span>Arrivals</span><strong>{data.stats ? fmtN(data.stats.numEvents) : '—'}</strong></div>
          <div className={styles.pcKpi}><span>Ships</span><strong>{data.stats ? fmtN(data.stats.numVessels) : '—'}</strong></div>
          <div className={styles.pcKpi} title="Ships’ voyage emissions attributed to this port by Climate TRACE (tonnes CO₂e)">
            <span>Ship CO₂e</span><strong>{em.state === 'loading' ? '…' : em.state === 'ok' && em.reported ? shortTonnes(em.total) : '—'}</strong></div>
        </div>
        <div className={styles.pcWindow}>{monthName(data.window.months[0])} – {monthName(data.window.months[data.window.months.length - 1])} · the months picked on the map</div>

        {!folded && <>
          <div className={pick.tabs} role="tablist">
            {tabs.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id}
                className={`${pick.tab} ${tab === id ? pick.tabOn : ''}`} onClick={() => onTab(id)}>{label}</button>
            ))}
          </div>

          {tab === 'traffic' && (
            <div className={styles.section}>
            {data.stats ? <>
                <div className={styles.portSummary}>
                  <strong>{plural(data.stats.numEvents, 'arrival')}</strong> by {plural(data.stats.numVessels, 'ship')}{' '}
                  <a className={`${styles.sourceLink} ${styles.srcLink}`} href={rec(data.stats.recordId)} target="_blank" rel="noopener noreferrer"
                    title="Global Fishing Watch /v3/events/stats for this port's labels, visits by start month, exactly as received — click for the raw record">GFW</a>
                </div>
                <MonthBars months={data.stats.months} month={data.ships.month} listed={false}
                  onMonth={(m) => { onMonth(m); if (data.labels.length) onTab('ships') }} label="Arrivals per month; pick a month to see its ships" />
              </> : (
                <div className={styles.legendNoteText}>
                  {!data.labels.length
                    ? <>Global Fishing Watch has no port of its own matched to this {p.origin === 'wpi' ? 'World Port Index port' : 'port'}{data.discovered ? ` (checked visits within 4 km in ${monthName(data.discovered.month, 'long')})` : ''}.
                        {data.nearby.length > 0 && <> Ships stopping within 4 km are counted at {data.nearby.map((n, i) => <span key={n.label}>{i > 0 && ', '}<button type="button" className={styles.inlineLink} onClick={() => onOpenPort?.(String(n.port_id))}
                          title={`Open the card of the port Global Fishing Watch label ${n.label} is matched to`}>{n.origin === 'wpi' ? n.name : titleCase(n.name || n.label)}</button></span>)}.</>}</>
                    : gfwTrouble ? 'Couldn’t reach Global Fishing Watch right now.' : 'No arrival totals yet.'}
                </div>
              )}
              <About>
                Arrivals are Global Fishing Watch port visits that began here each month (UTC), counted from ships’ AIS. Pick a month to list its
                ships on the Ships tab.
              </About>
            </div>
          )}

          {tab === 'ships' && data.labels.length > 0 && (
            <div className={styles.section}>
              {data.stats && <MonthBars months={data.stats.months} month={data.ships.month} onMonth={onMonth} listed={false}
                label="Pick a month to list its ships" />}
              <div className={styles.sectionHead}>Ships that called here · {monthName(data.ships.month, 'long')}</div>
              {data.ships.arrivals > 0 ? (
                <div className={styles.portSummary}>
                  {plural(data.ships.arrivals, 'arrival')} by {plural(data.ships.total, 'ship')}:{' '}
                  {data.ships.kinds.slice(0, 4).map((k, i) => <span key={k.kind}>{i > 0 && ', '}{fmtN(k.arrivals)} {GFW_KIND[k.kind] || k.kind}</span>)}
                  {data.ships.kinds.length > 4 && ', …'}
                </div>
              ) : (
                <div className={styles.legendNoteText}>{f.events === 'failed' || f.events === 'budget' || f.events === 'no_gfw'
                  ? 'Couldn’t ask Global Fishing Watch right now, and nothing is stored for this month yet.'
                  : `Global Fishing Watch recorded no arrivals here in ${monthName(data.ships.month, 'long')}.`}</div>
              )}
              {data.ships.complete === false && (
                <div className={styles.capNote}>Busy port: listing the first {fmtN(data.ships.arrivals)} of {fmtN(data.ships.gfwTotal)} arrivals Global Fishing Watch has for this month.</div>
              )}
              {list.map((s) => <ShipRow key={s.gfwId} s={s} onSelectVessel={onSelectVessel} />)}
              {list.length < data.ships.total && (
                <button type="button" className={styles.recordToggle} onClick={loadMore} disabled={more}>
                  {more ? <LoadingInline kind="more" /> : `Show more ships (${fmtN(data.ships.total - list.length)} more)`} <Chevron size={13} />
                </button>
              )}
              <About>
                An arrival is a Global Fishing Watch port visit that began here that month (UTC): the ship’s AIS came within 3 km of one of the port’s anchorages,
                stopped, and left beyond 4 km. Ships are listed by their AIS identity, most arrivals first; kinds are GFW’s AIS-based classes (most pleasure boats show as passenger or other).
                {data.ships.fetchedAt && <> Checked with Global Fishing Watch {String(data.ships.fetchedAt).slice(0, 16).replace('T', ' ')} UTC.</>}
              </About>
            </div>
          )}

          {tab === 'emissions' && <PortEmissions em={em} months={data.window.months} month={data.ships.month} onMonth={onMonth} About={About} />}

          {tab === 'trade' && <>
          {data.portwatch?.join === 'joined' && data.portwatch.series?.dates?.length > 0 && (() => {
            const pw = data.portwatch, s = pw.series
            const types = PW_TYPES.filter(([k]) => pw.totals[`portcalls_${k}`] > 0)
            const pwUrl = pw.pageid ? `https://portwatch.imf.org/pages/${pw.pageid}` : 'https://portwatch.imf.org'
            return (
              <div className={styles.section}>
                <div className={styles.sectionHead}>Cargo &amp; tanker traffic · IMF PortWatch</div>
                <div className={styles.portSummary}>
                  {plural(pw.totals.portcalls, 'port call')} from {dayName(s.dates[0])} to {dayName(pw.lastDate)}
                  {types.length > 0 && <>: {types.map(([k, w], i) => <span key={k}>{i > 0 && ', '}{fmtN(pw.totals[`portcalls_${k}`])} {w}</span>)}</>}
                </div>
                <LineChart dates={s.dates} label="Port calls a day (7-day average)" fmt={(v) => `${perDay(v)} a day`}
                  series={[{ key: 'calls', label: 'Port calls', color: PORT_HUE, values: s.calls7 }]} />
                <LineChart dates={s.dates} label="Estimated trade" fmt={(v) => (v == null ? 'no value' : `${compactT(v)} a day`)}
                  series={[{ key: 'import', label: 'Imports', color: IMPORT_HUE, values: s.import7 }, { key: 'export', label: 'Exports', color: EXPORT_HUE, values: s.export7 }]} />
                <About>
                  7-day averages of PortWatch’s daily estimates: port calls = cargo and tanker ships arriving at berth; trade in metric tonnes, estimated from how much deeper or
                  shallower ships sit when they leave. <strong>Relative trends, not official statistics.</strong> PortWatch’s “{pw.name}” (UN/LOCODE {p.unlocode}, {pw.km} km from the World Port Index position).
                  Updated weekly; checked {String(pw.fetchedAt || '').slice(0, 10)}.
                </About>
                <div className={styles.legendNoteText}>
                  <a className={styles.sourceLink} href={pwUrl} target="_blank" rel="noopener noreferrer" title={src['imf-portwatch']?.license || 'IMF PortWatch terms'}>{PW_CITATION}</a>
                </div>
              </div>
            )
          })()}
          </>}

          <div className={styles.attribution}>
            {['gfw-port-visits', 'nga-wpi', 'gfw-anchorage-overrides', 'geonames-countries'].map((id) => src[id]).filter(Boolean).map((x, i) => (
              <span key={x.id}>{i > 0 && ' · '}
                <a className={styles.sourceLink} href={x.attribution_url || x.homepage_url} target="_blank" rel="noopener noreferrer" title={x.name}>{x.attribution_text}</a>{' '}
                <a className={styles.sourceLink} href={x.license_url} target="_blank" rel="noopener noreferrer">{x.license.split(' (')[0]}</a>
              </span>
            ))}
          </div>
        </>}
      </>}
    </div>
  )
}
