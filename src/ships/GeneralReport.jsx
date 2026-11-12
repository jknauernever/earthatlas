/**
 * /ships/reports: the /ships general report (Josh 2026-11-10). High-level numbers for everything /ships holds, worldwide: the
 * ships, where they go (tracks, port visits, routes), terminals, anchorages, oil and gas, incidents and oil slicks, plus where
 * each dataset covers. Bunkering and lightering stay out (their reports are unlisted).
 *
 * Data: one JSON built daily by lib/ships/generalReport.js (api/cron/ships-counts.js ?part=report) at REPORT_URL. Localhost reads
 * public/dev-data/ships/general-report.json first (scripts/ships/general-report.mjs; `zsh scripts/ships/prod.sh report` for prod's).
 */
import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { mapboxToken } from '../lib/mapboxToken.js'
import BuiltByCredit from '../components/BuiltByCredit.jsx'
import DocBrand from '../components/DocBrand.jsx'
import { ChartTipProvider, useChartTip } from '../components/ChartTip.jsx'
import { kindWords } from './terminalIcons.js'
import { INCIDENT_TYPE } from './incidentTypes.js'
import c from './ScrubberReport.module.css'
import g from './GeneralReport.module.css'
import { AISSTREAM_URL, OPENWATERS_LICENSE_URL, WSF_URL, liveSource } from './liveSources.js'

// Country flags (flag-icons, MIT): one SVG per ISO 3166-1 alpha-2 code. Lazy, so only the flags shown are fetched and none
// land in the site's main bundle (eager imports inlined ~200 of them into it, +217 KB on every page).
const FLAG_SVGS = import.meta.glob('../../node_modules/flag-icons/flags/4x3/*.svg', { query: '?url', import: 'default' })
const flagLoader = (iso2) => (iso2 ? FLAG_SVGS[`../../node_modules/flag-icons/flags/4x3/${iso2.toLowerCase()}.svg`] || null : null)

function Flag({ iso2 }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    const load = flagLoader(iso2)
    let live = true
    if (load) load().then((u) => { if (live) setSrc(u) }).catch(() => {})
    return () => { live = false }
  }, [iso2])
  return <img className={g.flag} src={src || undefined} alt="" style={src ? undefined : { visibility: 'hidden' }} />
}

const REPORT_URL = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com/ships/general-report.json'
const DEV_URL = '/dev-data/ships/general-report.json'
// Ships per 1° square (scripts/ships/track-grid.py, .github/workflows/ships-track-grid.yml); localhost reads its own first.
const GRID_URL = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com/ships/track-grid/grid.json'
const GRID_DEV_URL = '/dev-data/ships/track-grid.json'
const getJson = (u) => fetch(u, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))

const SRC = {
  gfw: { name: 'Powered by Global Fishing Watch', href: 'https://globalfishingwatch.org' },
  gfwPorts: { name: 'Powered by Global Fishing Watch (port visits)', href: 'https://globalfishingwatch.org/our-apis/documentation/docs/v3/events' },
  noaa: { name: 'NOAA / BOEM MarineCadastre AIS', href: 'https://hub.marinecadastre.gov/pages/vesseltraffic' },
  wpi: { name: 'World Port Index', href: 'https://msi.nga.mil/Publications/WPI' },
  ct: { name: 'Climate TRACE', href: 'https://climatetrace.org' },
  gisis: { name: 'IMO GISIS', href: 'https://gisis.imo.org/Public/' },
  mep: { name: 'MEP Alliance', href: 'https://www.mepalliance.org/list-of-scrubber-fitted-ships' },
  cerulean: { name: 'SkyTruth Cerulean', href: 'https://cerulean.skytruth.org' },
  boem: { name: 'BOEM', href: 'https://www.data.boem.gov/' },
  emodnet: { name: 'EMODnet Human Activities', href: 'https://emodnet.ec.europa.eu/en/human-activities' },
  uswtdb: { name: 'US Wind Turbine Database', href: 'https://eerscmap.usgs.gov/uswtdb/' },
  mpa: { name: 'NOAA Marine Protected Areas Inventory', href: 'https://marineprotectedareas.noaa.gov/dataanalysis/mpainventory/' },
  srkw: { name: 'NOAA Fisheries and Fisheries and Oceans Canada', href: 'https://www.fisheries.noaa.gov/resource/map/southern-resident-killer-whale-critical-habitat' },
  uscg: { name: 'US Coast Guard', href: 'https://cgmix.uscg.mil/' },
  tc: { name: 'Transport Canada', href: 'https://wwwapps.tc.gc.ca/saf-sec-sur/4/vrqs-srib/eng/vessel-registrations' },
  fcc: { name: 'FCC', href: 'https://www.fcc.gov/uls' },
  wikidata: { name: 'Wikidata', href: 'https://www.wikidata.org' },
  bcports: { name: 'BC Ports and Terminals', href: 'https://catalogue.data.gov.bc.ca/dataset/bc-ports-and-terminals' },
  usace: { name: 'US Army Corps of Engineers', href: 'https://geospatial-usace.opendata.arcgis.com/datasets/23d91bd988ac4fc9943128965bddfa37_0' },
  dfo: { name: 'Fisheries and Oceans Canada', href: 'https://www.pac.dfo-mpo.gc.ca/' },
  aisstream: { name: 'aisstream.io', href: AISSTREAM_URL },
  openwaters: { name: 'Open Waters AIS (ODbL, incl. AISHub contributors)', href: OPENWATERS_LICENSE_URL },
  wsf: { name: 'Washington State Ferries', href: WSF_URL },
  ecfr: { name: 'eCFR (33 CFR 110)', href: 'https://www.ecfr.gov/current/title-33/chapter-I/subchapter-I/part-110' },
}
const OFFSHORE_SRC = { boem: 'boem', 'emodnet-platforms': 'emodnet', 'emodnet-windfarms': 'emodnet', uswtdb: 'uswtdb' }
const OFFSHORE_KIND = { platform: 'Oil and gas platforms', windfarm: 'Offshore wind farms', turbine: 'Offshore wind turbines' }
const OFFSHORE_STATUS = { operating: 'operating', removed: 'removed', planned: 'planned', construction: 'under construction' }

// Palette: the scrubber report's.
const BLUE = '#2a78d6', ORANGE = '#eb6834', GREEN = '#1baf7a', ROSE = '#e11d48', GRAY = '#9ca3af', VIOLET = '#7c3aed'

const fmt = (n) => (n == null ? '–' : Math.round(Number(n)).toLocaleString('en-US'))
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : fmt(n))
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–')
const monthName = (m) => (m ? new Date(`${m.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '–')
const dayName = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '–')
const span = (a, b) => `${monthName(a)} – ${monthName(b)}`
// Names arrive as sources write them ("PORT MOODY", "NETHERLANDS"): all-caps words are title-cased; mixed case is kept.
const nice = (s) => (!s ? s : /[a-z]/.test(s) ? s : String(s).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()))
const shipHref = (id) => `/ships?v=${encodeURIComponent(id)}`
const portHref = (id) => `/ships?pc=${encodeURIComponent(id)}`
const terminalHref = (key) => `/ships?tl=${encodeURIComponent(key)}`
const anchorageHref = (key) => `/ships?an=${encodeURIComponent(key)}`

function Src({ k, href, children, title }) {
  const s = k ? SRC[k] : null
  const url = href || s?.href
  const internal = url.startsWith('/') || url.startsWith('#')
  return <a className={c.src} href={url} title={title || s?.name} {...(internal ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>{children || s?.name}</a>
}
const How = () => <Src href="#how" title="How this is counted">how</Src>

/** Horizontal bars, longest first. rows = [{ key, label, href?, n, sub?, tip? }] */
function Bars({ rows, color = BLUE, unit = '', of, ofWord }) {
  const tip = useChartTip()
  if (!rows.length) return null
  const max = Math.max(...rows.map((r) => r.n), 1)
  return (
    <ul className={g.bars}>
      {rows.map((r) => (
        <li key={r.key} {...tip({
          head: r.label,
          rows: [{ color, label: unit || 'Count', value: fmt(r.n), on: true }, ...(r.tip || [])],
          foot: of ? `${pct(r.n, of)} of ${fmt(of)} ${ofWord || ''}`.trim() : undefined,
        })}>
          <span className={g.barLabel}>{r.flag && <Flag iso2={r.flag} />}{r.href ? <a className={c.src} href={r.href}>{r.label}</a> : r.label}{r.sub && <span className={g.sub}>{r.sub}</span>}</span>
          <span className={g.track}><span style={{ width: `${(r.n / max) * 100}%`, background: color }} /></span>
          <span className={g.barN}>{fmt(r.n)}{of ? <span className={g.unit}> {pct(r.n, of)}</span> : null}</span>
        </li>
      ))}
    </ul>
  )
}

/** Columns over time. series = [{ key, label, color }]; rows = [{ x, label, [key]: n }] (stacked). */
function Columns({ rows, series, height = 170, width = 1000, yearTicks = true, unit = '', total: showTotal = true }) {
  const tip = useChartTip()
  if (!rows.length) return null
  const W = width, H = height, padL = 46, padB = 24, w = (W - padL) / rows.length
  const max = Math.max(...rows.map((r) => series.reduce((n, s) => n + (r[s.key] || 0), 0)), 1)
  const step = 10 ** Math.floor(Math.log10(max)), nice2 = Math.ceil(max / step) * step
  const ticks = [0, nice2 / 2, nice2]
  const y = (v) => (H - padB) - (v / nice2) * (H - padB - 8)
  return (
    <svg className={c.chart} viewBox={`0 0 ${W} ${H}`} role="img">
      {ticks.map((t) => (
        <g key={t}><line className={c.grid} x1={padL} x2={W} y1={y(t)} y2={y(t)} /><text className={c.axis} x={padL - 6} y={y(t) + 4} textAnchor="end">{short(t)}</text></g>
      ))}
      {rows.map((r, i) => {
        let acc = 0
        const total = series.reduce((n, s) => n + (r[s.key] || 0), 0)
        return (
          <g key={r.x} className={c.barG} {...tip({ head: r.label, rows: series.map((s) => ({ color: s.color, label: s.label, value: `${fmt(r[s.key] || 0)}${unit ? ` ${unit}` : ''}` })),
            foot: series.length > 1 && showTotal ? `${fmt(total)} in all` : undefined })}>
            <rect x={padL + i * w} y={0} width={w} height={H - padB} fill="transparent" />
            {series.map((s) => {
              const v = r[s.key] || 0
              if (!v) return null
              const y0 = y(acc), y1 = y(acc + v); acc += v
              return <rect key={s.key} rx={w > 6 ? 1.5 : 0} x={padL + i * w + (w > 4 ? 0.6 : 0)} width={Math.max(w - (w > 4 ? 1.2 : 0), 0.8)} y={y1} height={Math.max(y0 - y1, 0.5)} fill={s.color} />
            })}
            {yearTicks && r.tick && <text className={c.axis} x={padL + i * w} y={H - 6}>{r.tick}</text>}
          </g>
        )
      })}
    </svg>
  )
}

function Legend({ items }) {
  return <div className={c.legend}>{items.map(([label, color]) => <span key={label}><i style={{ background: color }} />{label}</span>)}</div>
}

function Card({ title, note, children, foot, id }) {
  return (
    <section className={c.card} id={id}>
      <div className={c.cardHead}><h2 className={c.h2}>{title}</h2>{note && <span className={c.note}>{note}</span>}</div>
      {children}
      {foot && <div className={c.hint}>{foot}</div>}
    </section>
  )
}

function Tile({ value, label, sub, src, color }) {
  return (
    <div className={c.tile}>
      <div className={c.tileValue} style={color ? { color } : undefined}>{value}</div>
      <div className={c.tileLabel}>{label}</div>
      {sub && <div className={c.tileSub}>{sub}</div>}
      {src && <div className={c.tileSrc}>Source: {src}</div>}
    </div>
  )
}

function Table({ head, rows }) {
  return (
    <div className={c.tableWrap}>
      <table className={`${c.table} ${g.table}`}>
        <thead><tr>{head.map(([h, num], i) => <th key={i} className={num ? c.num : undefined}>{h}</th>)}</tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  )
}

// ─── Sections ────────────────────────────────────────────────────────────────

function Headline({ d }) {
  const n = d.counts, tv = n.terminalVisits, as = n.anchorageStays
  return (
    <div className={c.tiles}>
      <Tile value={fmt(n.ships)} label="ships" sub={`${fmt(d.fleet?.known?.imo)} with an IMO number`} src={<><Src k="gfw" />, <Src k="uscg" />, <Src k="tc" /> and others</>} />
      <Tile value={short(n.shipTracks.total)} label="ship tracks" sub="one ship’s path in one month, 2015 to now" src={<><Src k="noaa">NOAA AIS</Src>, <Src k="gfw" /></>} />
      <Tile value={fmt(n.portVisits)} label="port visits" sub={`at ${fmt(d.ports?.ports)} ports in ${fmt(d.ports?.countries?.length)} countries`} src={<Src k="gfwPorts" />} />
      <Tile value={fmt(n.ports)} label="ports" sub="worldwide" src={<><Src k="wpi" />, <Src k="gfw" /></>} />
      <Tile value={fmt(n.terminals)} label="terminals" sub={`${fmt(n.berths)} berths · ${fmt(tv.counted + tv.estimated)} visits`} src={<><Src k="bcports" />, <Src k="usace" /></>} />
      <Tile value={fmt(n.anchorages)} label="official anchorages" sub={`${fmt(as.counted + as.estimated)} stays at ${fmt(as.anchoragesWithStays)} of them`} src={<><Src k="noaa">MarineCadastre</Src>, <Src k="dfo" /></>} />
      <Tile value={`${short(n.terminalEmissions.co2eTonnes)} t`} label="CO₂e from ships at terminals" sub={`while stopped at the berths, ${span(n.terminalEmissions.from, n.terminalEmissions.to)}`} src={<Src k="ct" />} />
      <Tile value={fmt(n.incidents)} label="incidents" sub={d.incidents?.ships ? `involving ${fmt(d.incidents.ships)} ships we hold` : null} src={<><Src k="uscg" />, NOAA, WA Ecology</>} />
    </div>
  )
}

function Coverage({ d }) {
  const t = d.tracks, p = d.ports, n = d.counts, inc = d.incidents
  const rows = [
    ['Ship identity', 'Worldwide: every ship seen in our tracks, port visits, terminals or registries', `as of ${dayName(d.asOf.slice(0, 10))}`, <><Src k="gfw" />, <Src k="uscg" />, <Src k="tc" />, <Src k="fcc" />, <Src k="wikidata" /></>],
    t && ['Ship tracks, minute by minute', 'US waters', span(t.minute.from, t.minute.to), <Src k="noaa" />],
    t && ['Ship tracks, hourly', `${fmt(t.hourly.areas)} ocean areas outside US waters`, span(t.hourly.from, t.hourly.to), <Src k="gfw" />],
    t?.live && ['Ship tracks, recorded live', 'Salish Sea', `${dayName(t.live.from)} – ${dayName(t.live.through)}`, <LiveSrc />],
    p && ['Port visits', 'Worldwide, by the ships we hold', `${dayName(p.from)} – ${dayName(p.to)}`, <Src k="gfwPorts" />],
    ['Ports', 'Worldwide', '', <><Src k="wpi" />, <Src k="gfw" /></>],
    ['Terminals', `${fmt(d.terminals.byCountry.US || 0)} in Washington, ${fmt(d.terminals.byCountry.CA || 0)} in British Columbia`,
      `visits ${span(n.terminalVisits.from, n.terminalVisits.to)}`, <><Src k="bcports" />, <Src k="usace" /></>],
    ['Official anchorages', 'United States and Canada', `stays ${span(n.anchorageStays.from, n.anchorageStays.to)}`, <><Src k="noaa">MarineCadastre</Src>, <Src k="ecfr" />, <Src k="dfo" /></>],
    ['Ship emissions at terminals', 'Washington and British Columbia terminals', span(n.terminalEmissions.from, n.terminalEmissions.to), <Src k="ct" />],
    d.oilGas?.trace && ['Oil and gas facilities', 'Worldwide', `${d.oilGas.trace.release}, to ${monthName(d.oilGas.trace.lastMonth)}`, <Src k="ct" />],
    d.oilGas?.offshore && ['Offshore platforms and wind', 'US waters and Europe', '', <><Src k="boem" />, <Src k="uswtdb" />, <Src k="emodnet" /></>],
    inc && ['Incidents', 'United States (US Coast Guard, NOAA); Washington (Ecology)', inc.sources.length ? `${inc.years[0]?.year} – ${inc.years[inc.years.length - 1]?.year}` : '', <><Src k="uscg" />, NOAA, WA Ecology</>],
    d.slicks && ['Oil slicks', 'Worldwide', `${dayName(d.slicks.from)} – now`, <Src k="cerulean" />],
    ['Scrubber-fitted ships', 'Worldwide', '', <><Src k="gisis" />, <Src k="mep" /></>],
    ['Protected areas', 'US waters', '', <Src k="mpa" />],
    ['Orca critical habitat', 'Resident killer whales, United States and Canada', '', <Src k="srkw" />],
  ].filter(Boolean)
  // Closed by default at the end of the page (Josh 2026-11-11): the charts lead. Opens from the top line's link, and for printing.
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const show = () => setOpen(true)
    const fromHash = () => { if (window.location.hash === '#coverage') show() }
    fromHash()
    window.addEventListener('hashchange', fromHash); window.addEventListener('beforeprint', show)
    return () => { window.removeEventListener('hashchange', fromHash); window.removeEventListener('beforeprint', show) }
  }, [])
  return (
    <section className={c.card} id="coverage">
      <details className={g.disclose} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          <svg className={g.chev} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
          <h2 className={c.h2}>What the data covers</h2>
          <span className={c.note}>{rows.length} datasets: where and when each has data</span>
        </summary>
        <Table head={[['Data'], ['Where'], ['When'], ['Source']]} rows={rows.map(([a, b, when, s]) => (
          <tr key={a}><td><b>{a}</b></td><td>{b}</td><td className={g.nowrap}>{when}</td><td className={g.srcTd}>{s}</td></tr>
        ))} />
      </details>
    </section>
  )
}

/** Decades built → bars, newest first; everything before 1960 in one bar so the old tail stays readable. */
function builtRows(decades) {
  const old = decades.filter((x) => x.decade < 1960).reduce((n, x) => n + x.n, 0)
  const rows = decades.filter((x) => x.decade >= 1960).sort((a, b) => b.decade - a.decade)
    .map((x) => ({ key: x.decade, label: x.decade >= 2020 ? `${x.decade} to now` : `${x.decade}s`, n: x.n }))
  return old ? [...rows, { key: 'old', label: 'Before 1960', n: old }] : rows
}

function Fleet({ f }) {
  if (!f) return null
  const k = f.known
  return (
    <>
      <Card title="The ships" note={`${fmt(f.ships)} ships · ${fmt(f.classified)} with a known kind`}
        foot={<>Kinds: EarthAtlas’s classification of registry, AIS and <Src k="gfw" /> types, as the ship search uses it · <How /></>}>
        <div className={g.two}>
          <div>
            <h3 className={g.h3}>By kind</h3>
            <Bars rows={f.groups.map((x) => ({ key: x.group, label: x.label, n: x.n }))} of={f.classified} ofWord="ships with a known kind" />
          </div>
          <div>
            <h3 className={g.h3}>Most common kinds</h3>
            <Bars rows={f.classes.slice(0, 12).map((x) => ({ key: x.class, label: x.label, n: x.n }))} color={ORANGE} />
          </div>
        </div>
      </Card>
      <Card title="Flags, sizes and ages" note="one value per ship: a registry’s where there is one, otherwise the latest"
        foot={<>Flags and sizes: registries and AIS (<Src k="gfw" />, <Src k="uscg" />, <Src k="tc" />, <Src k="noaa">MarineCadastre</Src>) · <How /></>}>
        <div className={g.two}>
          <div>
            <h3 className={g.h3}>Flag <span className={g.unit}>{fmt(f.flags.length)} flags</span></h3>
            <Bars rows={f.flags.slice(0, 12).map((x) => ({ key: x.iso3, label: x.name, n: x.n, flag: x.iso2 }))} of={f.flags.reduce((n, x) => n + x.n, 0)} ofWord="ships with a flag" />
          </div>
          <div>
            <h3 className={g.h3}>Length <span className={g.unit}>{fmt(f.withLength)} ships</span></h3>
            <Bars rows={f.lengths.map((x) => ({ key: x.label, label: x.label, n: x.n }))} color={GREEN} of={f.withLength} ofWord="ships with a length" />
            <h3 className={g.h3}>Built <span className={g.unit}>{fmt(f.withYear)} ships</span></h3>
            <Bars rows={builtRows(f.decades)} color={GREEN} of={f.withYear} ofWord="ships with a year built" />
          </div>
        </div>
      </Card>
      <Card title="What we know about each ship" note={`out of ${fmt(f.ships)} ships`}>
        <Bars color={BLUE} of={f.ships} ofWord="ships" rows={[
          { key: 'registry', label: 'A registry record', n: k.registry },
          { key: 'imo', label: 'An IMO number', n: k.imo },
          { key: 'year', label: 'Year built', n: k.year_built },
          { key: 'photo', label: 'A photo', n: k.photo },
          { key: 'owner', label: 'An owner or operator', n: k.owner },
          { key: 'scrubber', label: 'A scrubber fitted', n: k.scrubber, sub: <> <Src k="gisis" />, <Src k="mep" /></> },
        ]} />
      </Card>
    </>
  )
}

function Tracks({ t }) {
  if (!t) return null
  const L = t.live
  // Live feeds seen in any month, busiest first (a month bakes its split only once it's rebuilt; older months show –).
  const feedN = new Map()
  for (const m of L?.perMonth || []) for (const [f, x] of Object.entries(m.sources || {})) feedN.set(f, (feedN.get(f) || 0) + x.vessels)
  const feeds = [...feedN.keys()].sort((a, b) => feedN.get(b) - feedN.get(a))
  const rows = t.months.map((m) => ({ x: m.month, label: monthName(m.month), minute: m.minute, hourly: m.hourly, live: m.live || 0, tick: m.month.endsWith('-01') && +m.month.slice(0, 4) % 2 === 1 ? m.month.slice(0, 4) : null }))
  return (
    <Card title="Ships tracked each month" note={`${fmt(t.minute.total + t.hourly.total)} tracks · one track = one ship’s path in one month`}
      foot={<>Minute by minute: <Src k="noaa" />, US waters, {span(t.minute.from, t.minute.to)} · hourly: <Src k="gfw" />, {fmt(t.hourly.areas)} areas outside US waters, {span(t.hourly.from, t.hourly.to)}{L && <> · recorded live: <LiveSrc />, Salish Sea, {dayName(L.from)} – {dayName(L.through)}</>} · <How /></>}>
      <Legend items={[['Minute by minute (US waters)', BLUE], ['Hourly (elsewhere)', ORANGE], ...(L ? [['Recorded live (Salish Sea)', VIOLET]] : [])]} />
      <Columns rows={rows} unit="ships" total={!L}
        series={[{ key: 'minute', label: 'Minute by minute', color: BLUE }, { key: 'hourly', label: 'Hourly', color: ORANGE },
          ...(L ? [{ key: 'live', label: 'Recorded live', color: VIOLET }] : [])]} />
      {L && <>
        <h3 className={g.h3}>Recorded live in the Salish Sea <span className={g.unit}>since {dayName(L.from)}</span></h3>
        <Table head={[['Month'], ['Ships', 'num'], ...feeds.map((f) => [<a key={f} className={c.src} href={liveSource(f).url} target="_blank" rel="noopener noreferrer"
            title={liveSource(f).name}>{liveSource(f).short}</a>, 'num']), ['Days recorded']]} rows={L.perMonth.slice().reverse().map((m) => (
          <tr key={m.month}><td>{monthName(m.month)}</td><td className={c.num}>{fmt(m.vessels)}</td>
            {feeds.map((f) => { const x = m.sources?.[f]
              return <td key={f} className={c.num} title={x ? `${fmt(x.vessels)} ships heard by ${liveSource(f).name}; ${fmt(x.only)} heard by it alone` : undefined}>
                {x ? <>{fmt(x.vessels)}<span className={g.sub}>{fmt(x.only)} only here</span></> : '–'}</td> })}
            <td>{dayName(m.first)} – {dayName(m.through)}</td></tr>
        ))} />
        <p className={g.sub}>EarthAtlas’s own recorder keeps at most one position per ship per minute from <LiveSrc />.{feeds.length ? ' Each feed column counts the ships it heard; a ship heard by several feeds is in each of them.' : ''} As above, one track is one ship’s path in one month; the latest month is still filling. Ships seen live can also be in the hourly count for the same month.</p>
      </>}
    </Card>
  )
}

// "Where we have ship tracks": distinct ships whose tracks touch each 1° square, all months, faint → deep blue.
const GRID_STEPS = [[1, '#dbeafe', '1–9'], [10, '#93c5fd', '10–49'], [50, '#60a5fa', '50–199'], [200, '#2563eb', '200–999'],
  [1000, '#1e40af', '1,000–4,999'], [5000, '#172554', '5,000+']]
const GRID_SERIES = [['minute', 'Minute by minute', BLUE], ['hourly', 'Hourly', ORANGE], ['live', 'Recorded live', VIOLET]]
const deg = (v, pos, neg) => `${Math.abs(v)}°${v >= 0 ? pos : neg}`

function TrackGrid() {
  const [grid, setGrid] = useState(null)
  const el = useRef(null)
  const tip = useChartTip()
  const tipRef = useRef(tip)
  tipRef.current = tip
  useEffect(() => {
    ;(import.meta.env.DEV ? getJson(GRID_DEV_URL).catch(() => getJson(GRID_URL)) : getJson(GRID_URL)).then(setGrid).catch(() => {})
  }, [])
  useEffect(() => {
    if (!grid || !el.current || !mapboxToken) return
    const col = Object.fromEntries(grid.columns.map((k, i) => [k, i]))
    const features = grid.cells.map((r) => {
      const x = (r[0] % 360) - 180, y = Math.floor(r[0] / 360) - 90
      const p = { n: r[col.all], x, y }
      for (const [k] of GRID_SERIES) p[k] = col[k] != null ? r[col[k]] : 0
      return { type: 'Feature', id: r[0], properties: p, geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]] } }
    })
    mapboxgl.accessToken = mapboxToken
    const zoomFor = () => Math.log2(el.current.clientWidth / 512) - 0.11
    const map = new mapboxgl.Map({
      container: el.current, style: 'mapbox://styles/mapbox/light-v11', projection: 'equalEarth', center: [0, 12], zoom: zoomFor(),
      renderWorldCopies: false, cooperativeGestures: true, dragRotate: false, touchPitch: false, preserveDrawingBuffer: true,
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    // The whole world shows in Equal Earth; zoomed in, the usual flat (Mercator) map, as on the /ships map.
    // Zooming back out to the whole world returns to Equal Earth, centered.
    let flat = false
    const fitProjection = () => {
      const wantFlat = map.getZoom() > zoomFor() + 0.4
      if (wantFlat === flat) return
      flat = wantFlat
      map.setProjection(flat ? 'mercator' : 'equalEarth')
      if (!flat) map.jumpTo({ center: [0, 12], zoom: zoomFor() })
    }
    map.on('zoomend', fitProjection)
    let hovered = null
    const setHover = (id) => {
      if (hovered != null) map.setFeatureState({ source: 'grid', id: hovered }, { hover: false })
      hovered = id
      if (id != null) map.setFeatureState({ source: 'grid', id }, { hover: true })
    }
    map.on('load', () => {
      map.addSource('grid', { type: 'geojson', data: { type: 'FeatureCollection', features } })
      const labels = map.getStyle().layers.find((l) => l.type === 'symbol')?.id // squares under place names
      map.addLayer({ id: 'grid', type: 'fill', source: 'grid', paint: {
        'fill-color': ['step', ['get', 'n'], GRID_STEPS[0][1], ...GRID_STEPS.slice(1).flatMap(([v, c]) => [v, c])],
        'fill-opacity': 0.85, 'fill-outline-color': 'rgba(255,255,255,0.25)' } }, labels)
      map.addLayer({ id: 'grid-hover', type: 'line', source: 'grid', paint: {
        'line-color': '#111827', 'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 1.5, 0] } }, labels)
    })
    map.on('mousemove', 'grid', (e) => {
      const f = e.features?.[0]
      if (!f) return
      setHover(f.id)
      map.getCanvas().style.cursor = 'default'
      const p = f.properties
      tipRef.current({
        head: `${deg(p.y, 'N', 'S')} – ${deg(p.y + 1, 'N', 'S')}, ${deg(p.x, 'E', 'W')} – ${deg(p.x + 1, 'E', 'W')}`,
        rows: GRID_SERIES.filter(([k]) => p[k]).map(([k, label, color]) => ({ color, label, value: fmt(p[k]) })),
        foot: `${fmt(p.n)} different ${p.n === 1 ? 'ship' : 'ships'} tracked here`,
      }).onPointerMove(e.originalEvent)
    })
    map.on('mouseleave', 'grid', () => { setHover(null); tipRef.current({}).onPointerLeave?.() })
    const ro = new ResizeObserver(() => { map.resize(); if (!flat) map.jumpTo({ center: [0, 12], zoom: zoomFor() }) })
    ro.observe(el.current)
    return () => { ro.disconnect(); map.remove() }
  }, [grid])
  if (!grid) return null
  const S = grid.sources || {}
  const spanOf = (k) => (S[k] ? span(S[k].from, S[k].through) : null)
  return (
    <Card title="Where we have ship tracks" note={`${fmt(grid.ships)} ships · each square is 1° (about 110 km)`}
      foot={<>{S.minute && <>Minute by minute: <Src k="noaa" />, US waters, {spanOf('minute')} · </>}{S.hourly && <>hourly: <Src k="gfw" />, areas outside US waters, {spanOf('hourly')} · </>}{S.live && <>recorded live: <LiveSrc />, Salish Sea, {spanOf('live')} · </>}<b>blank areas: no ship tracks yet</b> · <How /></>}>
      <div ref={el} className={g.gridMap} role="img" aria-label="World map of 1-degree squares shaded by how many ships we have tracks for" />
      <div className={g.gridLegend}>
        <span>Fewer ships</span>
        <span className={g.gridRamp}>{GRID_STEPS.map(([v, color, label]) => <i key={v} style={{ background: color }} title={`${label} ships`} />)}</span>
        <span>More ships</span>
        <span className={g.unit}>{GRID_STEPS.map(([, , label]) => label).join(' · ')}</span>
      </div>
      <p className={g.sub}>Each square counts the different ships whose tracks cross it, over every month we hold. Hover a square for each source’s count; a ship tracked by two sources counts once in the total.</p>
    </Card>
  )
}

function LiveSrc() {
  return <><Src k="aisstream" />, <Src k="openwaters" />, <Src k="wsf" /></>
}

function Ports({ p }) {
  if (!p) return null
  const portRow = (x) => ({ key: x.id, label: nice(x.name) || 'Unnamed port', href: portHref(x.id), n: x.visits, sub: x.country,
    tip: [{ label: 'Ships', value: fmt(x.ships) }] })
  const routeRow = (r) => ({ key: `${r.a.id}-${r.b.id}`, label: <><a className={c.src} href={portHref(r.a.id)}>{nice(r.a.name)}</a> ↔ <a className={c.src} href={portHref(r.b.id)}>{nice(r.b.name)}</a></>,
    n: r.trips, tip: [{ label: 'Ships', value: fmt(r.ships) }] })
  return (
    <>
      <Card title="Where ships go: ports" note={`${fmt(p.visits)} visits by ${fmt(p.ships)} ships to ${fmt(p.ports)} ports, ${dayName(p.from)} – ${dayName(p.to)}`}
        foot={<>Port visits by the ships we hold: <Src k="gfwPorts" /> · <How /></>}>
        <div className={g.two}>
          <div><h3 className={g.h3}>Most visited ports</h3><Bars rows={p.top.slice(0, 12).map(portRow)} unit="Visits" /></div>
          <div><h3 className={g.h3}>Most visited outside the US and Canada</h3><Bars rows={p.abroad.slice(0, 12).map(portRow)} unit="Visits" color={ORANGE} /></div>
        </div>
        <h3 className={g.h3}>By country <span className={g.unit}>{fmt(p.countries.length)} countries</span></h3>
        <Bars rows={p.countries.slice(0, 15).map((x) => ({ key: x.iso3, label: x.name, n: x.visits, tip: [{ label: 'Ports', value: fmt(x.ports) }] }))} unit="Visits" of={p.visits} ofWord="visits" color={GREEN} />
      </Card>
      <Card title="Where ships go: routes" note={`${fmt(p.legs)} trips between ${fmt(p.routeCount)} pairs of ports`}
        foot={<>A trip is one visit followed by the same ship’s next visit at a different port, either direction · <Src k="gfwPorts" /> · <How /></>}>
        <div className={g.two}>
          <div><h3 className={g.h3}>Busiest routes</h3><Bars rows={p.routes.map(routeRow)} unit="Trips" /></div>
          <div><h3 className={g.h3}>Busiest routes between countries</h3><Bars rows={p.international.map(routeRow)} unit="Trips" color={ORANGE} /></div>
        </div>
      </Card>
      <Card title="Most-traveled ships" note="the most countries visited" foot={<>Port visits: <Src k="gfwPorts" /></>}>
        <Table head={[['Ship'], ['Flag'], ['Countries', 1], ['Ports', 1], ['Visits', 1]]} rows={p.traveled.map((s, i) => (
          <tr key={s.id || i}>
            <td>{s.id ? <a className={c.src} href={shipHref(s.id)}>{nice(s.name) || 'Unnamed'}</a> : nice(s.name) || 'Unnamed'}</td>
            <td>{nice(s.flag) || '–'}</td><td className={c.num}><b>{fmt(s.countries)}</b></td><td className={c.num}>{fmt(s.ports)}</td><td className={c.num}>{fmt(s.visits)}</td>
          </tr>
        ))} />
      </Card>
    </>
  )
}

function Terminals({ t }) {
  const v = t.visits, e = t.emissions
  return (
    <>
      <Card title="Terminals" note={`${fmt(t.terminals)} terminals · ${fmt(v.counted + v.estimated)} visits, ${span(v.from, v.to)}`}
        foot={<>Visits: ships of the kinds each terminal serves, counted minute by minute from <Src k="noaa">NOAA AIS</Src> ({fmt(v.counted - (v.recorded || 0))}){v.recorded ? <>, from EarthAtlas’s recording of live AIS for months NOAA hasn’t published (<LiveSrc />; {fmt(v.recorded)})</> : null} or estimated from <Src k="gfw" /> hourly positions ({fmt(v.estimated)}) · <How /></>}>
        <div className={g.two}>
          <div>
            <h3 className={g.h3}>Busiest terminals</h3>
            <Bars rows={t.top.filter((x) => x.visits + x.estimated > 0).map((x) => ({ key: x.key, label: x.name, href: terminalHref(x.key), n: x.visits + x.estimated, sub: kindWords(x.kind),
              tip: [{ label: 'Counted', value: fmt(x.visits) }, { label: 'Estimated', value: fmt(x.estimated) }, { label: 'Ships', value: fmt(x.ships) }] }))} unit="Visits" />
          </div>
          <div>
            <h3 className={g.h3}>By kind of terminal</h3>
            <Bars rows={t.kinds.filter((k) => k.visits + k.estimated > 0).map((k) => ({ key: k.kind, label: kindWords(k.kind), n: k.visits + k.estimated, sub: `${fmt(k.terminals)} terminal${k.terminals === 1 ? '' : 's'}` }))}
              unit="Visits" color={GREEN} of={v.counted + v.estimated} ofWord="visits" />
          </div>
        </div>
      </Card>
      {t.topEmissions.length > 0 && (
        <Card title="Ship emissions at terminals" note={`${fmt(e.co2eTonnes)} t CO₂e from ${fmt(e.stays)} stops, ${span(e.from, e.to)}`}
          foot={<>CO₂e (100-year) while stopped at the berths, by the kinds of ship each terminal serves: <Src k="ct" /> · <How /></>}>
          <Bars rows={t.topEmissions.map((x) => ({ key: x.key, label: x.name, href: `${terminalHref(x.key)}&tb=emissions`, n: x.co2e, sub: kindWords(x.kind),
            tip: [{ label: 'Stops', value: fmt(x.ctStays) }] }))} unit="t CO₂e" color={ROSE} of={e.co2eTonnes} ofWord="t CO₂e at all terminals" />
        </Card>
      )}
    </>
  )
}

function Anchorages({ a }) {
  const s = a.stays
  return (
    <Card title="Anchorages" note={`${fmt(a.anchorages)} official anchorages · ${fmt(s.counted + s.estimated)} stays at ${fmt(a.withStays)}, ${span(s.from, s.to)}`}
      foot={<>Stays: ships stopped inside an anchorage, counted minute by minute from <Src k="noaa">NOAA AIS</Src> ({fmt(s.counted - (s.recorded || 0))}){s.recorded ? <>, from EarthAtlas’s recording of live AIS for months NOAA hasn’t published (<LiveSrc />; {fmt(s.recorded)})</> : null} or estimated from <Src k="gfw" /> hourly positions ({fmt(s.estimated)}) · anchorages: <Src k="noaa">MarineCadastre</Src>, <Src k="ecfr" />, <Src k="dfo" /> · <How /></>}>
      <div className={g.two}>
        <div>
          <h3 className={g.h3}>Busiest anchorages</h3>
          <Bars rows={a.top.filter((x) => x.stays + x.estimated > 0).map((x) => ({ key: x.key, label: x.name || 'Anchorage', href: anchorageHref(x.key), n: x.stays + x.estimated, sub: x.location,
            tip: [{ label: 'Counted', value: fmt(x.stays) }, { label: 'Estimated', value: fmt(x.estimated) }, { label: 'Ships', value: fmt(x.ships) }] }))} unit="Stays" />
        </div>
        <div>
          <h3 className={g.h3}>Longest at anchor</h3>
          <Table head={[['Ship'], ['Anchorage'], ['Days', 1]]} rows={a.longest.slice(0, 10).map((x, i) => (
            <tr key={`${x.mmsi}-${i}`}>
              <td>{x.vesselId ? <a className={c.src} href={shipHref(x.vesselId)}>{nice(x.aisName) || `MMSI ${x.mmsi}`}</a> : nice(x.aisName) || `MMSI ${x.mmsi}`}{x.kind && <span className={g.sub}>{x.kind}</span>}</td>
              <td><a className={c.src} href={anchorageHref(x.anchorage.key)}>{x.anchorage.name}</a></td>
              <td className={c.num}><b>{fmt(x.days)}</b></td>
            </tr>
          ))} />
        </div>
      </div>
    </Card>
  )
}

function OilGas({ o, t }) {
  if (!o) return null
  const off = o.offshore?.rows || []
  const offRows = Object.keys(OFFSHORE_KIND).map((k) => {
    const rs = off.filter((r) => r.kind === k)
    if (!rs.length) return null
    const by = (st) => rs.filter((r) => r.status === st).reduce((n, r) => n + r.n, 0)
    const srcs = [...new Set(rs.map((r) => OFFSHORE_SRC[r.src]).filter(Boolean))]
    return { k, total: rs.reduce((n, r) => n + r.n, 0), by, srcs }
  }).filter(Boolean)
  const tr = o.trace
  return (
    <Card title="Oil and gas" note="terminals, refineries and oil and gas sites">
      <div className={c.tiles}>
        <Tile value={fmt(o.terminals)} label="oil, gas and fuel terminals" sub={`${fmt(o.visits)} ship visits · ${short(o.co2e)} t CO₂e from ships at the berths`} src={<><Src k="bcports" />, <Src k="usace" />, <Src k="ct" /></>} color={ROSE} />
        <Tile value={fmt(o.refineries.reduce((n, r) => n + r.n, 0))} label="refineries with their own docks" sub={o.refineries.map((r) => `${r.n} in ${r.country === 'US' ? 'Washington' : r.country === 'CA' ? 'British Columbia' : r.country}`).join(' · ')} />
        {tr && <Tile value={fmt(tr.refining)} label="oil refineries worldwide" sub={`and ${fmt(tr.production)} oil and gas production fields and basins`} src={<><Src k="ct" /> {tr.release}</>} />}
      </div>
      <div className={g.two}>
        <div>
          <h3 className={g.h3}>Our oil, gas and fuel terminals</h3>
          <Bars rows={o.kinds.map((k) => ({ key: k.kind, label: kindWords(k.kind), n: k.visits, sub: `${fmt(k.terminals)} terminal${k.terminals === 1 ? '' : 's'}` }))} unit="Visits" color={ROSE} />
          <div className={c.hint}>Visits since {monthName(t.visits.from)} · <How /></div>
        </div>
        {offRows.length > 0 && (
          <div>
            <h3 className={g.h3}>Offshore facilities</h3>
            <Table head={[[''], ['Operating', 1], ['Planned or building', 1], ['Removed', 1], ['Source']]} rows={offRows.map((r) => (
              <tr key={r.k}><td><b>{OFFSHORE_KIND[r.k]}</b></td><td className={c.num}>{fmt(r.by('operating'))}</td>
                <td className={c.num}>{fmt(r.by('planned') + r.by('construction'))}</td><td className={c.num}>{fmt(r.by('removed'))}</td>
                <td className={g.srcTd}>{r.srcs.map((s, i) => <span key={s}>{i ? ', ' : ''}<Src k={s} /></span>)}</td></tr>
            ))} />
          </div>
        )}
      </div>
    </Card>
  )
}

function Incidents({ i }) {
  if (!i) return null
  const tip = i.years
  return (
    <Card title="Incidents" note={`${fmt(i.total)} records`}
      foot={<>Records from {i.sources.map((s, k) => <span key={s.id}>{k ? ', ' : ''}{s.url ? <Src href={s.url}>{s.publisher || s.name}</Src> : s.publisher || s.name} ({fmt(s.n)})</span>)} · one record can be several kinds · <How /></>}>
      <div className={g.two}>
        <div>
          <h3 className={g.h3}>By kind</h3>
          <Bars rows={i.types.slice(0, 14).map((x) => ({ key: x.type, label: INCIDENT_TYPE[x.type] || x.type.replaceAll('_', ' '), n: x.n }))} color={ROSE} />
        </div>
        <div>
          <h3 className={g.h3}>By year</h3>
          <Columns rows={tip.map((x) => ({ x: x.year, label: String(x.year), n: x.n, tick: x.year % 10 === 0 ? String(x.year) : null }))} series={[{ key: 'n', label: 'Records', color: ROSE }]} height={260} width={480} />
        </div>
      </div>
    </Card>
  )
}

function Slicks({ s }) {
  if (!s || !s.credible) return null
  return (
    <Card title="Oil slicks" note={`seen by satellite radar worldwide, ${dayName(s.from)} – now`}
      foot={<>Slicks <Src k="cerulean" /> counts as credible, and how many it ties to each kind of likely source; one slick can have several · <How /></>}>
      <div className={c.tiles}>
        <Tile value={fmt(s.credible)} label="credible oil slicks" sub="worldwide" color={ROSE} src={<Src k="cerulean" />} />
        <Tile value={fmt(s.ship)} label="with a likely ship source" sub="a ship broadcasting AIS nearby" src={<Src k="cerulean" />} />
        <Tile value={fmt(s.infra)} label="with likely offshore infrastructure" sub="platforms and pipelines nearby" src={<Src k="cerulean" />} />
        <Tile value={fmt(s.dark)} label="with a likely unidentified vessel" sub="a vessel seen by radar with no AIS" src={<Src k="cerulean" />} />
      </div>
      <a className={g.mapBtn} href="/ships?sl=1">See the slicks on the map</a>
    </Card>
  )
}

function HowCounted({ d }) {
  return (
    <Card title="How this is counted" id="how">
      <ul className={g.how}>
        <li><b>Updated daily</b> from the same data the <a className={c.src} href="/ships">/ships map</a> and its cards use; this edition was built {dayName(d.asOf.slice(0, 10))}. Terminal and anchorage numbers are read by each card’s own code, so they match the cards and the <a className={c.src} href="/ships/changelog">changelog</a>.</li>
        <li><b>Ships:</b> EarthAtlas ship records. Each joins what registries, AIS and other sources say about one ship. Kinds, flags, lengths and years take one value per ship: a registry’s where there is one, otherwise the latest.</li>
        <li><b>Ship tracks:</b> one track is one ship’s path in one month. US waters come from NOAA’s minute-by-minute AIS; other areas from Global Fishing Watch’s hourly positions. Since October 18, 2026 EarthAtlas also records live AIS in the Salish Sea, counted on its own.</li>
        <li><b>Where we have ship tracks:</b> the world in 1° squares (about 110 km). A square counts the different ships (by MMSI) whose tracks cross it, in every month we hold; a line between two positions counts in each square it passes through. Blank squares have no tracks yet, not no ships.</li>
        <li><b>Port visits and routes:</b> Global Fishing Watch’s port visits for the ships we hold. A route counts one visit and the same ship’s next visit at a different port, in either direction.</li>
        <li><b>Terminal visits and anchorage stays:</b> ships stopped at a berth, or inside an anchorage, counted from NOAA AIS where it covers; in the Salish Sea, for months NOAA hasn’t published yet, counted with the same rule from EarthAtlas’s recording of live AIS (replaced by NOAA’s counts when NOAA publishes); elsewhere estimated from Global Fishing Watch hourly positions. Terminal visits count the kinds of ship each terminal serves.</li>
        <li><b>Emissions:</b> Climate TRACE’s estimates for each ship stopped at a berth, in CO₂e over 100 years.</li>
        <li><b>Oil slicks:</b> SkyTruth’s own rule for credible oil: linked to a likely source, or very confident and too new to have been matched yet.</li>
      </ul>
    </Card>
  )
}

export default function GeneralReport() {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    document.title = 'Ships: the general report · EarthAtlas'
    const get = (u) => fetch(u, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    ;(import.meta.env.DEV ? get(DEV_URL).catch(() => get(REPORT_URL)) : get(REPORT_URL)).then(setD).catch((e) => setErr(e.message))
  }, [])
  return (
    <ChartTipProvider>
    <div className={c.page}>
      <header className={c.top}>
        <DocBrand tool="Ships" href="/ships"><a href="/ships" className={c.brand}>EarthAtlas <span>Ships</span></a></DocBrand>
        <span className={g.topRight}>
          <a className={g.mapBtn} href="/ships">Open the map</a>
          <button className={c.print} onClick={() => window.print()} disabled={!d}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" />
            </svg>
            <span className={g.printLbl}>Print or save as PDF</span>
          </button>
        </span>
      </header>
      <main className={c.main}>
        <div className={c.kicker}>Report</div>
        <h1 className={c.title}>Ships: the general report</h1>
        <p className={c.lede}>
          Everything on the <a className={c.src} href="/ships">/ships map</a>, counted: the ships, where they go, the terminals and anchorages
          they use, oil and gas sites, incidents and oil slicks. Every name links to its card on the map.
        </p>
        {d && (
          <dl className={c.facts}>
            <div><dt>Area</dt><dd>Worldwide, where each dataset reaches · <a className={c.src} href="#coverage" onClick={() => { const el = document.querySelector('#coverage details'); if (el) el.open = true }}>what each dataset covers ↓</a></dd></div>
            <div><dt>Updated</dt><dd>Daily; this edition {dayName(d.asOf.slice(0, 10))}</dd></div>
            <div><dt>Other reports</dt><dd><a className={c.src} href="/ships/reports/scrubbers">Scrubber-fitted ship calls</a> · <a className={c.src} href="/ships/changelog">What’s new</a></dd></div>
          </dl>
        )}
        {err && <div className={c.error}>Couldn’t load the report ({err}).</div>}
        {!d && !err && <div className={c.loading}>Loading…</div>}
        {d && <>
          <Headline d={d} />
          <Fleet f={d.fleet} />
          <Tracks t={d.tracks} />
          <TrackGrid />
          <Ports p={d.ports} />
          <Terminals t={d.terminals} />
          <Anchorages a={d.anchorages} />
          <OilGas o={d.oilGas} t={d.terminals} />
          <Incidents i={d.incidents} />
          <Slicks s={d.slicks} />
          <Coverage d={d} />
          <HowCounted d={d} />
        </>}
        <BuiltByCredit variant="light" className={c.builtBy} />
      </main>
    </div>
    </ChartTipProvider>
  )
}
