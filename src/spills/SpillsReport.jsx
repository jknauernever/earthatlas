/**
 * /spills/reports: the report for the Fossil Fuel Spills & Releases map (/spills). NRC oil spill reports (today Lake Michigan; the
 * geography is a choice so the national NRC set can drop in) and U.S. pipeline accidents (PHMSA, national), with the exposure the
 * bake measured for each report: NOAA ESI shoreline classes and species, USGS PAD-US protected areas.
 *
 * Data comes through loadSpillsFiles() (bundled files on localhost, the Blob manifest in production), the same as the map, and
 * the default filters are the map's (storm-drain matches off), so every count matches /spills for the same years.
 *
 * URL state (defaults omitted, replaceState):
 *   scope  region:<id> (default: the first region in the data, lm = Lake Michigan) | st:<ST> | co:<County>,<ST> | pl:<City>,<ST>
 *          | a:<protected area index> | sp:<iNaturalist id>
 *   y0,y1  first / last year (default: every year)      mo, po   as on /spills (match bases, location kinds off)
 *   ps     pipeline area: us (default) | rg (the report area's states) | <ST>
 *   ft, fw, fl   flow-chart filters: source type, water, shoreline level
 *   pg=all every protected area (default GAP 1–2)       pc=1   count reports placed by nearest city only in the protected-area table
 *
 * Charts: Observable Plot (SVG, prints as vectors) and d3-sankey for the flow chart; this file is its own lazy route chunk.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as Plot from '@observablehq/plot'
import { sankey as d3sankey, sankeyLinkHorizontal } from 'd3-sankey'
import BuiltByCredit from '../components/BuiltByCredit.jsx'
import DocBrand from '../components/DocBrand.jsx'
import c from '../ships/ScrubberReport.module.css'
import s from './SpillsReport.module.css'
import { SPILLS_SOURCES, SPILLS_SOURCES_INTRO, SPILLS_SOURCES_NOTES } from './spillsSources.jsx'
import {
  loadSpillsFiles, loadRegion, loadRegionList, NRC_HOME, ESI_HOME, PADUS_HOME, PHMSA_HOME, CENSUS_GEOCODER, CENSUS_GAZ, PIPE_COLOR, GAS_COLOR, PA_COLOR,
  COMMODITY_PLAIN, GAS_SYSTEM, PRECISION_BY_ID, ESI_COLORS, esiNumber, esiShort, esiLevel, isListed, statusFull, speciesHref,
  bblText, mcfText, MANAGER, gapOf, fmtDate, titleCase,
} from './spillsShared.js'

const SPILL = '#ff1f3d'
const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'))
const pctOf = (a, b) => (b ? Math.round((100 * a) / b) : 0)
const ext = { target: '_blank', rel: 'noopener noreferrer' }

// Regions an NRC point can belong to. Today's bake is Lake Michigan only, so a point without a region field is in `lm`;
// a national bake can tag each point (p.rg) and name its regions (summary.regions = {id: name}).
const DEFAULT_REGION_NAMES = { lm: 'Lake Michigan' }
const regionOf = (p) => p.rg || 'lm'

const US_STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico', GU: 'Guam', VI: 'U.S. Virgin Islands', AS: 'American Samoa', MP: 'Northern Mariana Islands' }
const stateName = (st) => US_STATES[st] || st

// The map's match bases and their defaults (SpillsApp MATCHES / MATCHES_OFF_DEFAULT).
const MATCH_IDS = ['named', 'basin', 'drain']
const MATCH_OFF_DEFAULT = ['drain']
const PREC_IDS = Object.keys(PRECISION_BY_ID)
const PREC_GROUP = { coords: 'exact', text: 'exact', address: 'near', place: 'near', offset: 'near', city: 'city' }
const PREC_WORDS = { exact: 'reported coordinates (1 km)', near: 'an address, named site or distance from a city (2–3 km)', city: 'nearest city only (5 km)' }
// Precision: one hue, deep = most precise.
const PREC_COLOR = { exact: '#9f1239', near: '#e11d48', city: '#fda4af' }

// NRC source types, in plain words.
const SOURCE_PLAIN = { Vessel: 'Boats and ships', 'Unknown Sheen': 'Unknown source (a sheen on the water)', Fixed: 'Fixed sites (plants, docks, marinas)',
  Mobile: 'Vehicles and moving equipment', 'Storage Tank': 'Storage tanks', Railroad: 'Railroads', Pipeline: 'Pipelines', Aircraft: 'Aircraft' }
const sourcePlain = (t) => SOURCE_PLAIN[t] || t || 'Not given'
// Where the oil went, from the water body the caller named.
const WATER = [
  ['lake', 'The lake itself'], ['named', 'A river, harbor, bay or other named water'], ['drain', 'A storm drain, sewer or ditch'], ['none', 'No water named'],
]
const WATER_LABEL = Object.fromEntries(WATER)
function waterOf(p, regionName) {
  const w = String(p.w || '').toUpperCase().trim()
  if (p.match === 'drain' || /STORM|SEWER|\bDRAINS?\b|DRAINAGE|DITCH|CULVERT|OUTFALL/.test(w)) return 'drain'
  if (regionName && w.includes(regionName.toUpperCase())) return 'lake'
  if (!w || /^(UNKNOWN|NONE|N\/?A)$/.test(w)) return 'none'
  return 'named'
}
// Shoreline level in words (spillsShared esiLevel) and the two non-shoreline outcomes.
const LEVELS = [
  ['most', 'Most easily harmed shore nearby', '#9f1239'], ['easily', 'Easily harmed shore nearby', '#e11d48'],
  ['some', 'Somewhat easily harmed shore nearby', '#fb7185'], ['least', 'Least easily harmed shore nearby', '#fecdd3'],
  ['noshore', 'No mapped shoreline within reach', '#cbd5e1'], ['unplaced', 'Not placed on the map', '#e5e7eb'],
]
const LEVEL_LABEL = Object.fromEntries(LEVELS.map(([k, l]) => [k, l]))
const LEVEL_COLOR = Object.fromEntries(LEVELS.map(([k, , col]) => [k, col]))
const LEVEL_KEY = { 'Most easily harmed': 'most', 'Easily harmed': 'easily', 'Somewhat easily harmed': 'some', 'Least easily harmed': 'least' }
const levelOf = (p) => (!p.loc ? 'unplaced' : p.e ? LEVEL_KEY[esiLevel(p.e)] : 'noshore')

// What spilled, grouped in plain words (a report can name more than one).
const MATERIALS = [
  ['Gasoline', /GASOLINE/], ['Diesel, fuel oil or bilge oil', /DIESEL|FUEL: NO|FUEL OIL|BILGE|CRUDE|KEROSENE|JET/],
  ['Hydraulic oil', /HYDRAULIC/], ['Motor, lube or gear oil', /MOTOR|LUBRIC|GEAR|TRANSMISSION|TURBINE|WASTE OIL|GREASE/],
  ['Transformer or mineral oil', /TRANSFORMER|MINERAL|POLYCHLORINATED/], ['Unknown oil', /UNKNOWN/],
]
const materialsOf = (p) => {
  const out = new Set()
  for (const m of p.m || []) { const hit = MATERIALS.find(([, re]) => re.test(m)); out.add(hit ? hit[0] : 'Other') }
  return out
}

// A PHMSA accident's place in words: its city, or its county when the operator wrote "not within a municipality".
const pipePlace = (a) => {
  const city = /not within/i.test(a.city || '') ? '' : a.city
  const where = city || (a.county ? `${a.county} County` : '')
  if (a.wh && !where) return a.wh   // offshore: the sea, distance off a state, OCS block and depth (phmsa/build.py)
  return [where, a.st].filter(Boolean).join(', ') || 'Place not named in the report'
}
const barrelsTotal = (bbl) => `${fmt(bbl)} barrels (${bbl * 42 >= 1e6 ? `${(bbl * 42 / 1e6).toFixed(1)} million` : fmt(bbl * 42)} gallons)`
// PAD-US manager name codes (Mang_Name domain), in words.
const AGENCY = { CITY: 'City', CNTY: 'County', REG: 'Regional agency', NGO: 'Nonprofit', SDNR: 'State natural resources agency',
  SDC: 'State conservation agency', SFW: 'State fish and wildlife agency', SPR: 'State parks and recreation', SDOL: 'State land board',
  OTHS: 'Other state agency', NRCS: 'Natural Resources Conservation Service', USFS: 'U.S. Forest Service', FWS: 'U.S. Fish and Wildlife Service',
  NPS: 'National Park Service', BLM: 'Bureau of Land Management', OTHF: 'Other federal agency', PVT: 'Private', JNT: 'Jointly managed',
  RWD: 'Regional water district', UNKL: 'Local agency', TRIB: 'Tribe', DOD: 'Department of Defense', USACE: 'U.S. Army Corps of Engineers', NOAA: 'NOAA' }
const LIQ = 'Oil and other liquids'
const GAS = 'Natural gas and other gases'

// ─── Data ───────────────────────────────────────────────────────────────────
const getJson = (u) => fetch(u).then((x) => { if (!x.ok) throw new Error(`HTTP ${x.status}`); return x.json() })
/** The one place the report reads NRC spill reports: Lake Michigan (with NOAA ESI) or one state's file (the national
 *  bake), through the map's own loader. A state has no ESI species; its reports' critical habitat (`ch`, FWS and NOAA
 *  Fisheries) stands in as the species list, so the species tiles and ranking read either. */
async function loadRegionReports(files, region = 'lm') {
  const d = await loadRegion(files, region)
  if (d.species.length || !d.ch_species?.length) return d
  const species = d.ch_species.map((x) => ({ n: x.n, g: `critical habitat (${x.src === 'NOAA Fisheries' || x.src === 'Fisheries and Oceans Canada' ? x.src : 'FWS'})`,
    fed: x.fed, sara: x.sara, st: {}, url: x.url, sci: x.sci, crit: true }))
  return { ...d, species, points: d.points.map((p) => (p.ch?.length ? { ...p, sp: p.ch.map(([i]) => i) } : p)) }
}
// Which file a scope reads: a region, or the state a state/county/place scope names; areas and species stay on the last.
const dataRegionOf = (scope, fallback) => {
  const [k, v] = [scope.slice(0, scope.indexOf(':')), scope.slice(scope.indexOf(':') + 1)]
  if (k === 'region') return v || 'lm'
  if (k === 'st') return v
  if (k === 'co' || k === 'pl') return v.split(',').pop()
  return fallback
}

// ─── URL state ──────────────────────────────────────────────────────────────
function readUrl() {
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => { const n = Number(sp.get(k)); return sp.get(k) && Number.isFinite(n) ? n : null }
  const matchOff = new Set(MATCH_OFF_DEFAULT)
  for (const t of (sp.get('mo') || '').split(',')) { const id = t.slice(1); if (MATCH_IDS.includes(id)) t[0] === '+' ? matchOff.delete(id) : matchOff.add(id) }
  return {
    scope: sp.get('scope') || '', y0: num('y0'), y1: num('y1'), matchOff, precOff: new Set((sp.get('po') || '').split(',').filter((x) => PREC_IDS.includes(x))),
    rg: /^[A-Z]{2}$/.test(sp.get('rg') || '') ? sp.get('rg') : null, co: sp.get('co') || null,
    ps: sp.get('ps') || 'rg', ft: sp.get('ft') || '', fw: sp.get('fw') || '', fl: sp.get('fl') || '', pg: sp.get('pg') || '', pc: sp.get('pc') === '1',
  }
}
const moText = (off) => MATCH_IDS.filter((id) => off.has(id) !== MATCH_OFF_DEFAULT.includes(id)).map((id) => `${off.has(id) ? '-' : '+'}${id}`).join(',')

// ─── Small pieces ───────────────────────────────────────────────────────────
const SRC = {
  nrc: [NRC_HOME, 'National Response Center incident reports (U.S. Coast Guard)', 'NRC'],
  esi: [ESI_HOME, 'NOAA Environmental Sensitivity Index atlas', 'NOAA ESI'],
  padus: [PADUS_HOME, 'USGS Protected Areas Database of the United States (PAD-US 4.1)', 'USGS PAD-US'],
  phmsa: [PHMSA_HOME, 'PHMSA pipeline accident and incident reports', 'PHMSA'],
  census: [CENSUS_GEOCODER, 'U.S. Census Bureau Geocoder and Gazetteer places', 'Census'],
  gaz: [CENSUS_GAZ, 'U.S. Census Bureau 2024 Gazetteer places', 'Census places'],
}
function Src({ k, children }) {
  const [href, title, label] = SRC[k]
  return <a className={c.src} href={href} title={title} {...ext}>{children || label}</a>
}

/** An Observable Plot chart that re-draws at its container's width. `make(width)` returns the figure. */
function PlotChart({ make, deps, className }) {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (w < 120 || !ref.current) return undefined
    const fig = make(w)
    if (!fig) { ref.current.replaceChildren(); return undefined }
    ref.current.replaceChildren(fig)
    return () => fig.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, ...deps])
  return <div ref={ref} className={`${s.plot} ${className || ''}`} />
}
const PLOT_STYLE = { fontFamily: 'inherit', fontSize: '11px', color: '#374151', background: 'transparent', overflow: 'visible' }
// Click handler for each drawn element of a mark (Plot's render transform): kid i ↔ data[index[i]].
const onClickEach = (data, fn) => ({
  render(index, scales, values, dims, ctx, next) {
    const g = next(index, scales, values, dims, ctx)
    const kids = g.querySelectorAll(':scope > rect, :scope > circle, :scope > path')
    kids.forEach((el, i) => { el.style.cursor = 'pointer'; el.addEventListener('click', () => fn(data[index[i]])) })
    return g
  },
})

/** 100 squares, `share` (0–1) of them filled. */
function Waffle({ share, color }) {
  const n = Math.round(share * 100)
  return (
    <svg className={s.waffle} viewBox="0 0 100 100" aria-hidden="true" data-tip={`${n} of 100 squares filled: ${n}%`}>
      {Array.from({ length: 100 }, (_, i) => (
        <rect key={i} x={(i % 10) * 10 + 0.8} y={Math.floor(i / 10) * 10 + 0.8} width="8.4" height="8.4" rx="1.4"
          fill={i < n ? color : '#eef0f3'} />
      ))}
    </svg>
  )
}

/** Instant hover values for the hand-drawn charts (flow chart, sparklines, waffles): any element with `data-tip`. */
function HoverTips() {
  const [tip, setTip] = useState(null)
  useEffect(() => {
    const move = (e) => {
      const el = e.target.closest?.('[data-tip]')
      setTip(el ? { text: el.getAttribute('data-tip'), x: e.clientX, y: e.clientY } : null)
    }
    document.addEventListener('mousemove', move)
    return () => document.removeEventListener('mousemove', move)
  }, [])
  return tip ? <div className={s.hoverTip} style={{ left: tip.x + 12, top: tip.y + 14 }}>{tip.text}</div> : null
}

/** A per-year mini bar chart (same scale within a table). */
function Spark({ years, counts, max, color = SPILL }) {
  const w = 120, h = 24, bw = w / years.length
  return (
    <svg className={s.spark} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" style={{ pointerEvents: 'all' }}>
      {years.map((y, i) => {
        const v = counts[y] || 0, bh = v ? Math.max(2, (v / (max || 1)) * (h - 2)) : 0
        return <g key={y} data-tip={`${y}: ${v.toLocaleString('en-US')} report${v === 1 ? '' : 's'}`}><rect x={i * bw + 0.5} y={0} width={bw - 1} height={h} fill="#f1f5f9" />{v > 0 && <rect x={i * bw + 0.5} y={h - bh} width={bw - 1} height={bh} fill={color} />}</g>
      })}
    </svg>
  )
}

function PrecBar({ row, max }) {
  return (
    <span className={s.stack}>
      {['exact', 'near', 'city'].map((g) => row[g] > 0 && <span key={g} style={{ width: `${(row[g] / max) * 100}%`, background: PREC_COLOR[g] }} title={`${fmt(row[g])} placed by ${PREC_WORDS[g]}`} />)}
    </span>
  )
}

const PrecLegend = () => (
  <span className={c.legend}>
    {['exact', 'near', 'city'].map((g) => <span key={g}><i style={{ background: PREC_COLOR[g] }} />Placed by {PREC_WORDS[g]}</span>)}
  </span>
)

// ─── The flow chart (d3-sankey) ─────────────────────────────────────────────
function Flow({ pts, regionName, filters, onPick }) {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  const graph = useMemo(() => {
    if (!w || !pts.length) return null
    const links = new Map()
    const add = (a, b) => links.set(`${a}→${b}`, (links.get(`${a}→${b}`) || 0) + 1)
    const nodes = new Map()
    for (const p of pts) {
      const t = `t:${p.t || ''}`, wb = `w:${waterOf(p, regionName)}`, l = `l:${levelOf(p)}`
      for (const n of [t, wb, l]) nodes.set(n, (nodes.get(n) || 0) + 1)
      add(t, wb); add(wb, l)
    }
    const name = (id) => { const [k, v] = [id.slice(0, 1), id.slice(2)]; return k === 't' ? sourcePlain(v) : k === 'w' ? (v === 'lake' ? regionName || WATER_LABEL.lake : WATER_LABEL[v]) : LEVEL_LABEL[v] }
    const order = (id) => { const [k, v] = [id.slice(0, 1), id.slice(2)]; return k === 'w' ? WATER.findIndex(([x]) => x === v) : k === 'l' ? LEVELS.findIndex(([x]) => x === v) : -nodes.get(id) }
    const nodeList = [...nodes.keys()].map((id) => ({ id, name: name(id), n: nodes.get(id) }))
    const h = Math.max(260, Math.min(520, nodeList.length * 34))
    const narrow = w < 640
    const gen = d3sankey().nodeId((d) => d.id).nodeWidth(12).nodePadding(narrow ? 8 : 12)
      .nodeSort((a, b) => order(a.id) - order(b.id))
      .extent([[1, 6], [w - 1, h - 6]])
    const g = gen({ nodes: nodeList.map((d) => ({ ...d })), links: [...links].map(([k, v]) => { const [a, b] = k.split('→'); return { source: a, target: b, value: v } }) })
    return { ...g, h, narrow }
  }, [w, pts, regionName])
  const active = (id) => (id.startsWith('t:') ? filters.ft === id.slice(2) : id.startsWith('w:') ? filters.fw === id.slice(2) : filters.fl === id.slice(2))
  const any = filters.ft || filters.fw || filters.fl
  return (
    <div ref={ref} className={s.flow}>
      {graph && (
        <svg width={w} height={graph.h} viewBox={`0 0 ${w} ${graph.h}`} className={s.flowSvg} role="img" aria-label="Where the oil went: source, water and shoreline">
          <g fill="none">
            {graph.links.map((l, i) => {
              const lvl = l.target.id.startsWith('l:') ? l.target.id.slice(2) : null
              const on = any && active(l.source.id) && active(l.target.id)
              return (
                <path key={i} d={sankeyLinkHorizontal()(l)} stroke={lvl ? LEVEL_COLOR[lvl] : '#94a3b8'} strokeOpacity={on ? 0.8 : lvl ? 0.5 : 0.32}
                  strokeWidth={Math.max(1, l.width)} className={s.flowLink} onClick={() => onPick([l.source.id, l.target.id])}
                  data-tip={`${l.source.name} → ${l.target.name}: ${fmt(l.value)} reports`} />
              )
            })}
          </g>
          {graph.nodes.map((n) => {
            const col = n.id.startsWith('t:') ? 0 : n.id.startsWith('w:') ? 1 : 2
            const fill = col === 2 ? LEVEL_COLOR[n.id.slice(2)] : col === 1 ? '#475569' : '#1f2937'
            const right = col < 2
            return (
              <g key={n.id} className={s.flowNode} onClick={() => onPick([n.id])} data-tip={`${n.name}: ${fmt(n.n)} reports · click to show only these`}>
                <rect x={n.x0} y={n.y0} width={n.x1 - n.x0} height={Math.max(1, n.y1 - n.y0)} fill={fill} stroke={active(n.id) ? '#0f172a' : 'none'} strokeWidth="2" />
                <text x={right ? n.x1 + 6 : n.x0 - 6} y={(n.y0 + n.y1) / 2} dy="0.35em" textAnchor={right ? 'start' : 'end'} className={s.flowLabel}
                  fontWeight={active(n.id) ? 700 : 500}>
                  {n.name} <tspan className={s.flowN}>{fmt(n.n)}</tspan>
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

// ─── The page ───────────────────────────────────────────────────────────────
export default function SpillsReport() {
  const [st, setSt] = useState(readUrl)
  const set = (patch) => setSt((o) => ({ ...o, ...patch }))
  const [data, setData] = useState(null)
  const [pipeRaw, setPipeRaw] = useState(null)
  const [gasRaw, setGasRaw] = useState(null)
  const [err, setErr] = useState(null)
  const [moreSp, setMoreSp] = useState(false)
  const [morePa, setMorePa] = useState(false)

  const [files, setFiles] = useState(null)
  const [regionList, setRegionList] = useState(null)
  const dataRegion = dataRegionOf(st.scope || 'region:lm', st.rg || 'lm')
  useEffect(() => {
    if (!files) return
    let live = true
    setData(null)
    loadRegionReports(files, dataRegion).then((d) => { if (live) setData(d) }).catch((e) => { if (live) setErr(e.message) })
    return () => { live = false }
  }, [files, dataRegion])
  useEffect(() => {
    loadSpillsFiles().then((f) => {
      setFiles(f)
      loadRegionList(f).then(setRegionList)
      getJson(f.pipe).then(setPipeRaw).catch(() => {})
      if (f.gas) getJson(f.gas).then(setGasRaw).catch(() => {})
    })
  }, [])

  // ─── Data, decoded once ───────────────────────────────────────────────────
  const regionNames = useMemo(() => ({ ...DEFAULT_REGION_NAMES, ...(data?.summary?.regions || {}) }), [data])
  const regions = ['lm']   // regions with their own bake (more as NOAA shoreline atlases come in); states come from the region list
  const defaultRegion = 'lm'
  const scope = st.scope || `region:${defaultRegion}`
  const [scopeKind, scopeVal] = [scope.slice(0, scope.indexOf(':')), scope.slice(scope.indexOf(':') + 1)]

  // A report's place name, as the map's place list names it (the bake's commonest city in its 5 km cell).
  const placeLabel = useMemo(() => {
    const m = new Map()
    for (const h of data?.hotspots || []) if (h.places?.[0]) for (const sq of h.seqs) m.set(sq, h.places[0])
    return m
  }, [data])
  // states: the official Census place (`pc`, states.py); Lake Michigan: its 5 km cell's name
  const placeOf = (p) => placeLabel.get(p.seq) || (data?.region !== 'lm' ? p.pc : p.city) || (data?.region !== 'lm' ? null : p.city)

  const decode = (raw) => (raw ? raw.rows.map((r) => { const a = Object.fromEntries(raw.fields.map((f, k) => [f, r[k]])); a.o = raw.operators[a.o]; return a }) : [])
  const pipes = useMemo(() => decode(pipeRaw), [pipeRaw])
  const gases = useMemo(() => decode(gasRaw), [gasRaw])

  const yearsAll = data?.summary.years || [2015, 2026]
  const from = Math.max(yearsAll[0], st.y0 ?? yearsAll[0]), to = Math.min(yearsAll[1], st.y1 ?? yearsAll[1])
  const yrLabel = from === to ? String(from) : `${from}–${to}`
  const latestNrc = useMemo(() => (data ? data.points.reduce((m, p) => (p.d > m ? p.d : m), '') : ''), [data])
  const soFar = (y, latestYear) => (y === latestYear ? `${y} so far` : String(y))

  // ─── Scope ────────────────────────────────────────────────────────────────
  const scopeTest = useMemo(() => {
    if (!data) return () => false
    if (scopeKind === 'region') return () => true   // the region's own file is loaded
    if (scopeKind === 'st') return (p) => p.st === scopeVal
    if (scopeKind === 'co') { const [co, s2] = scopeVal.split(','); return (p) => p.county === co && p.st === s2 }
    if (scopeKind === 'pl') { const [pl, s2] = scopeVal.split(','); return (p) => p.st === s2 && placeOf(p) === pl }
    if (scopeKind === 'a') { const i = +scopeVal; return (p) => (p.pa || []).some(([j]) => j === i) }
    if (scopeKind === 'sp') { const ids = new Set(data.species.map((x, i) => (String(x.tx) === scopeVal ? i : -1)).filter((i) => i >= 0)); return (p) => (p.sp || []).some((i) => ids.has(i)) }
    return () => true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, scopeKind, scopeVal, placeLabel])
  const scopeRegion = scopeKind === 'region' ? scopeVal : defaultRegion
  const regionName = regionNames[scopeRegion] || scopeRegion
  const scopeName = useMemo(() => {
    if (scopeKind === 'region') return regionNames[scopeVal] || scopeVal
    if (scopeKind === 'st') return stateName(scopeVal)
    if (scopeKind === 'co') { const [co, s2] = scopeVal.split(','); return `${co} County, ${s2}` }
    if (scopeKind === 'pl') { const [pl, s2] = scopeVal.split(','); return `${pl}, ${s2}` }
    if (scopeKind === 'a') return data?.areas?.[+scopeVal]?.n || 'a protected area'
    if (scopeKind === 'sp') { const sp = data?.species.find((x) => String(x.tx) === scopeVal); return sp ? `near ${sp.n}` : 'a species' }
    return ''
  }, [scopeKind, scopeVal, data, regionNames])
  // "in Michigan", "in or near Indiana Dunes National Park", "near Common gallinule"
  const scopeWords = scopeKind === 'sp' ? scopeName : scopeKind === 'a' ? `in or near ${scopeName}` : `in ${scopeName}`

  // Every report in the scope and match bases, every year (the year chart), then the years, then the flow filters.
  const scoped = useMemo(() => (data ? data.points.filter((p) => !st.matchOff.has(p.match) && scopeTest(p)) : []), [data, st.matchOff, scopeTest])
  const inYearsAll = useMemo(() => scoped.filter((p) => p.y >= from && p.y <= to), [scoped, from, to])
  const flowFilter = (p) => (!st.ft || (p.t || '') === st.ft) && (!st.fw || waterOf(p, regionName) === st.fw) && (!st.fl || levelOf(p) === st.fl)
  const inYears = useMemo(() => (st.ft || st.fw || st.fl ? inYearsAll.filter(flowFilter) : inYearsAll),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inYearsAll, st.ft, st.fw, st.fl, regionName])
  const placed = useMemo(() => inYears.filter((p) => p.loc && !st.precOff.has(p.loc)), [inYears, st.precOff])
  const hasEsi = useMemo(() => placed.some((p) => p.e), [placed])
  const hasSpecies = useMemo(() => !!data?.species?.length && placed.some((p) => p.sp?.length), [data, placed])
  const hasAreas = useMemo(() => !!data?.areas?.length && placed.some((p) => p.pa?.length), [data, placed])

  // The scope's states (for the pipeline "same area" choice and the state picker)
  const scopeStates = useMemo(() => [...new Set(scoped.map((p) => p.st).filter(Boolean))].sort(), [scoped])
  const regionStates = useMemo(() => [...new Set((data?.points || []).filter((p) => regionOf(p) === scopeRegion).map((p) => p.st).filter(Boolean))].sort(), [data, scopeRegion])
  const allStates = useMemo(() => (regionList?.regions || []).map((r) => r.id).sort((a, b) => stateName(a).localeCompare(stateName(b))), [regionList])

  // ─── Links to the map ─────────────────────────────────────────────────────
  const mapHref = (sel, { lat, lon, z = 11, y, gas } = {}) => {
    const q = new URLSearchParams()
    if (lat != null && lon != null) { q.set('lat', lat.toFixed(3)); q.set('lng', lon.toFixed(3)); q.set('z', String(z)) }
    let a = from, b = to
    if (y != null && (y < from || y > to)) { a = b = Math.max(yearsAll[0], Math.min(yearsAll[1], y)) }
    if (a !== yearsAll[1]) q.set('y0', String(a))
    if (b !== yearsAll[1]) q.set('y1', String(b))
    if (gas) q.set('ly', '+gas')
    if (st.precOff.size) q.set('po', [...st.precOff].join(','))
    const mo = moText(st.matchOff)
    if (mo) q.set('mo', mo)
    if (sel) q.set('sel', sel)
    return `/spills?${q.toString()}`
  }
  const reportHref = (p) => mapHref(`r:${p.seq}`, { lat: p.lat, lon: p.lon, y: p.y })

  // ─── URL + title ──────────────────────────────────────────────────────────
  useEffect(() => {
    const q = new URLSearchParams()
    if (st.scope && st.scope !== `region:${defaultRegion}`) q.set('scope', st.scope)
    if (st.y0 != null && st.y0 !== yearsAll[0]) q.set('y0', String(st.y0))
    if (st.y1 != null && st.y1 !== yearsAll[1]) q.set('y1', String(st.y1))
    const mo = moText(st.matchOff)
    if (mo) q.set('mo', mo)
    if (st.precOff.size) q.set('po', [...st.precOff].join(','))
    if (st.ps !== 'rg') q.set('ps', st.ps)   // pipelines follow the report's area unless a person picks otherwise
    for (const k of ['ft', 'fw', 'fl']) if (st[k]) q.set(k, st[k])
    if (st.pg === 'all') q.set('pg', 'all')
    if (st.pc) q.set('pc', '1')
    if (dataRegion !== 'lm' && !/^(st|co|pl):/.test(st.scope || '')) q.set('rg', dataRegion)
    if (st.co && (st.scope || '').startsWith('pl:')) q.set('co', st.co)   // the county a place was picked in   // an area or species inside a state
    const qs = q.toString()
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`
    if (url !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, '', url)
    document.title = `Fossil fuel spills and releases ${scopeWords}, ${yrLabel} · EarthAtlas report`
  }, [st, defaultRegion, yearsAll, scopeWords, yrLabel])

  // ─── NRC aggregates (each once per scope / years / filters) ───────────────
  const nrc = useMemo(() => {
    if (!data) return null
    const years = []; for (let y = yearsAll[0]; y <= yearsAll[1]; y++) years.push(y)
    const perYear = Object.fromEntries(years.map((y) => [y, 0]))
    for (const p of scoped) if (flowFilter(p)) perYear[p.y]++
    const grp = (f) => { const o = { exact: 0, near: 0, city: 0, n: 0 }; for (const p of placed) if (f(p)) { o[PREC_GROUP[p.loc]]++; o.n++ } return o }
    const listed = grp((p) => (p.sp || []).some((i) => isListed(data.species[i])))
    const gap12 = grp((p) => (p.pa || []).some(([i]) => { const g = data.areas[i]?.gap; return g === '1' || g === '2' }))
    const shore = grp((p) => p.e && esiNumber(p.e) >= 9)
    const vols = inYears.filter((p) => p.g != null && p.g > 0).map((p) => p.g).sort((a, b) => a - b)
    const median = vols.length ? (vols.length % 2 ? vols[(vols.length - 1) / 2] : (vols[vols.length / 2 - 1] + vols[vols.length / 2]) / 2) : null
    // shoreline classes
    const byClass = new Map()
    for (const p of placed) if (p.e) byClass.set(p.e, (byClass.get(p.e) || 0) + 1)
    const classes = [...byClass].map(([code, n]) => ({ code, n, label: `${esiShort(code)} (class ${code})`, level: esiLevel(code) }))
      .sort((a, b) => esiNumber(b.code) - esiNumber(a.code) || b.code.localeCompare(a.code))
    const noShore = placed.filter((p) => !p.e).length
    // places
    const places = new Map()
    for (const p of placed) {
      const name = placeOf(p); if (!name) continue
      const k = `${name},${p.st}`
      const pl = places.get(k) || { k, name, st: p.st, n: 0, years: {}, pts: [] }
      pl.n++; pl.years[p.y] = (pl.years[p.y] || 0) + 1; pl.pts.push(p)
      places.set(k, pl)
    }
    const topPlaces = [...places.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 12)
    // materials and causes
    const mats = new Map(), causes = new Map(), sources = new Map()
    for (const p of inYears) {
      for (const m of materialsOf(p)) mats.set(m, (mats.get(m) || 0) + 1)
      causes.set(p.c || 'Not given', (causes.get(p.c || 'Not given') || 0) + 1)
      sources.set(sourcePlain(p.t), (sources.get(sourcePlain(p.t)) || 0) + 1)
    }
    const sorted = (m) => [...m].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n)
    const largest = inYears.filter((p) => p.g != null && p.g > 0).sort((a, b) => b.g - a.g).slice(0, 10)
    return { years, perYear, listed, gap12, shore, vols, median, classes, noShore, topPlaces, mats: sorted(mats), causes: sorted(causes), sources: sorted(sources), largest }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, scoped, inYears, placed, from, to, yearsAll, latestNrc, placeLabel, st.ft, st.fw, st.fl, regionName])

  // Listed species within reach, by name (ESI can list one species in several records), split by location precision.
  const species = useMemo(() => {
    if (!data || !hasSpecies) return []
    const by = new Map()
    for (const p of placed) {
      const seen = new Set()
      for (const i of p.sp || []) {
        const sp = data.species[i]
        if (!isListed(sp) || seen.has(sp.n)) continue
        seen.add(sp.n)
        const r = by.get(sp.n) || { sp: { ...sp, st: { ...sp.st } }, exact: 0, near: 0, city: 0, n: 0 }
        if (!r.sp.fed && sp.fed) r.sp.fed = sp.fed
        if (!r.sp.sara && sp.sara) r.sp.sara = sp.sara
        for (const [k, v] of Object.entries(sp.st)) if (!r.sp.st[k] || v === 'E') r.sp.st[k] = v
        if (!r.sp.tx && sp.tx) { r.sp.tx = sp.tx; r.sp.txn = sp.txn }
        r[PREC_GROUP[p.loc]]++; r.n++
        by.set(sp.n, r)
      }
    }
    return [...by.values()].sort((a, b) => b.n - a.n || a.sp.n.localeCompare(b.sp.n))
  }, [data, placed, hasSpecies])

  // Most exposed protected areas.
  const areas = useMemo(() => {
    if (!data || !hasAreas) return []
    const by = new Map()
    for (const p of placed) {
      if (!st.pc && p.loc === 'city') continue
      for (const [i, m] of p.pa || []) {
        const a = data.areas[i]
        if (st.pg !== 'all' && a.gap !== '1' && a.gap !== '2') continue
        const r = by.get(i) || { i, a, inside: 0, near: 0, reach: 0, years: {}, p0: p }
        if (m === 0) r.inside++; else if (m <= 500) r.near++
        r.reach++; r.years[p.y] = (r.years[p.y] || 0) + 1
        if (m < (r.m0 ?? Infinity)) { r.m0 = m; r.p0 = p }
        by.set(i, r)
      }
    }
    return [...by.values()].sort((a, b) => b.inside + b.near - (a.inside + a.near) || b.reach - a.reach || a.a.n.localeCompare(b.a.n))
  }, [data, placed, hasAreas, st.pg, st.pc])

  // ─── Pipelines ────────────────────────────────────────────────────────────
  // Pipelines follow the report's area ('rg', the default): a region's states, the state, or the county (PHMSA gives the
  // county); 'us' or a state code when a person picks one.
  const areaStates = scopeKind === 'region' ? regionStates : scopeStates
  const psCounty = st.ps === 'rg' && scopeKind === 'co' ? scopeVal.split(',')[0].toUpperCase().replace(/ COUNTY$/, '') : null
  const psStates = st.ps === 'us' ? null : st.ps === 'rg' ? new Set(areaStates) : new Set([st.ps])
  const psName = st.ps === 'us' ? 'the U.S.' : st.ps === 'rg'
    ? (psCounty ? `${scopeVal.split(',')[0]} County, ${scopeVal.split(',')[1]}` : areaStates.length === 1 ? stateName(areaStates[0]) : `${scopeName} states (${areaStates.join(', ')})`)
    : stateName(st.ps)
  const inPs = (a) => (!psStates || psStates.has(a.st)) && (!psCounty || (a.county || '').toUpperCase().replace(/ COUNTY$/, '') === psCounty)
  const pipeAll = useMemo(() => (psStates ? pipes.filter(inPs) : pipes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pipes, st.ps, scopeStates.join(), regionStates.join(), psCounty])
  const gasAll = useMemo(() => (psStates ? gases.filter(inPs) : gases),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gases, st.ps, scopeStates.join(), regionStates.join(), psCounty])
  const pipeStates = useMemo(() => [...new Set([...pipes, ...gases].map((a) => a.st).filter((x) => US_STATES[x]))].sort((a, b) => stateName(a).localeCompare(stateName(b))), [pipes, gases])
  const pl = useMemo(() => {
    if (!pipes.length || (!pipeAll.length && !gasAll.length)) return null   // no pipeline accidents in this area: no sections
    const liq = pipeAll.filter((a) => a.y >= from && a.y <= to), gas = gasAll.filter((a) => a.y >= from && a.y <= to)
    const y0 = Math.min(...pipes.map((a) => a.y)), y1 = Math.max(...pipes.map((a) => a.y))
    const years = []; for (let y = y0; y <= y1; y++) years.push(y)
    const per = []
    for (const y of years) {
      per.push({ y, kind: LIQ, n: 0 }); per.push({ y, kind: GAS, n: 0 })
    }
    const idx = (y, k) => (y - y0) * 2 + k
    for (const a of pipeAll) per[idx(a.y, 0)].n++
    for (const a of gasAll) if (a.y >= y0 && a.y <= y1) per[idx(a.y, 1)].n++
    const sum = (xs, f) => xs.reduce((t, a) => t + (f(a) || 0), 0)
    const causeCount = (xs) => { if (!xs.length || xs[0].cause === undefined) return null; const m = new Map(); for (const a of xs) m.set(a.cause || 'Not given', (m.get(a.cause || 'Not given') || 0) + 1); return [...m].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n) }
    const harm = years.filter((y) => y >= from && y <= to).flatMap((y) => {
      const g = gas.filter((a) => a.y === y)
      return [{ y, k: 'Deaths', n: sum(g, (a) => a.fat) }, { y, k: 'Injuries', n: sum(g, (a) => a.inj) }]
    })
    return {
      years, y1, per, liq, gas,
      liqT: { n: liq.length, bbl: sum(liq, (a) => a.bbl), rec: sum(liq, (a) => a.rec), fat: sum(liq, (a) => a.fat), inj: sum(liq, (a) => a.inj), fire: liq.filter((a) => a.fire).length, water: liq.filter((a) => a.water).length, wild: liq.filter((a) => a.wild).length },
      gasT: { n: gas.length, mcf: sum(gas, (a) => a.mcf), fat: sum(gas, (a) => a.fat), inj: sum(gas, (a) => a.inj), fire: gas.filter((a) => a.fire || a.boom).length, boom: gas.filter((a) => a.boom).length, evac: sum(gas, (a) => a.evac) },
      bigLiq: liq.filter((a) => a.bbl > 0).sort((a, b) => b.bbl - a.bbl).slice(0, 10),
      bigGas: gas.filter((a) => a.mcf > 0).sort((a, b) => b.mcf - a.mcf).slice(0, 10),
      liqCauses: causeCount(liq), gasCauses: causeCount(gas), harm,
    }
  }, [pipes, pipeAll, gasAll, from, to])

  // ─── Controls helpers ─────────────────────────────────────────────────────
  const counties = useMemo(() => {
    const stSel = scopeKind === 'st' ? scopeVal : scopeKind === 'co' || scopeKind === 'pl' ? scopeVal.split(',')[1] : null
    if (!stSel || !data) return { stSel, list: [], places: [] }
    const pts = data.points.filter((p) => p.st === stSel && !st.matchOff.has(p.match))
    const list = [...new Set(pts.map((p) => p.county).filter(Boolean))].sort()
    // places: those in the chosen county when there is one (a place scope keeps its county via `co`, or the whole state)
    const county = scopeKind === 'co' ? scopeVal.split(',')[0] : st.co || null
    const pm = new Map(); for (const p of pts) { if (county && p.county !== county) continue; const n = placeOf(p); if (n) pm.set(n, (pm.get(n) || 0) + 1) }
    return { stSel, list, places: [...pm].filter(([, n]) => n >= 3).map(([n]) => n).sort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, scopeKind, scopeVal, st.matchOff, st.co, placeLabel])
  const setScope = (v, co = null) => set({ scope: v, co, ft: '', fw: '', fl: '', ps: 'rg' })   // a new area resets pipelines to follow it
  const pickFlow = (ids) => {
    const patch = {}
    const all = ids.every((id) => (id[0] === 't' ? st.ft : id[0] === 'w' ? st.fw : st.fl) === id.slice(2))
    for (const id of ids) patch[id[0] === 't' ? 'ft' : id[0] === 'w' ? 'fw' : 'fl'] = all ? '' : id.slice(2)
    set(patch)
  }
  const flowWords = [st.ft && sourcePlain(st.ft), st.fw && (st.fw === 'lake' ? regionName : WATER_LABEL[st.fw]), st.fl && LEVEL_LABEL[st.fl]].filter(Boolean)
  const presets = [
    ['all', `All years (${yearsAll[0]}–${yearsAll[1]})`, yearsAll[0], yearsAll[1]],
    ['p5', 'Past 5 years', yearsAll[1] - 4, yearsAll[1]],
    ['p2', 'Past 2 years', yearsAll[1] - 1, yearsAll[1]],
    ['p1', `${yearsAll[1]} so far`, yearsAll[1], yearsAll[1]],
  ]
  const preset = presets.find(([, , a, b]) => a === from && b === to)?.[0] || 'custom'
  const yearOpts = []; for (let y = yearsAll[0]; y <= yearsAll[1]; y++) yearOpts.push(y)

  const ready = data && nrc
  const precLeft = [...st.precOff].map((id) => PRECISION_BY_ID[id].short)

  return (
    <div className={c.page}>
      <HoverTips />
      <header className={c.top}>
        <DocBrand tool="Fossil Fuel Spills & Releases" href="/spills"><a href="/spills" className={c.brand}>EarthAtlas <span>Fossil Fuel Spills &amp; Releases</span></a></DocBrand>
        <span className={s.topRight}>
          <a className={s.mapBtn} href={mapHref(null)}>Open the map</a>
          <button className={c.print} onClick={() => window.print()} disabled={!ready}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" />
            </svg>
            Print or save as PDF
          </button>
        </span>
      </header>
      <main className={c.main}>
        <div className={c.kicker}>Fossil Fuel Spills &amp; Releases · report</div>
        <h1 className={c.title}>Oil spill reports {scopeWords}, {yrLabel}{pl ? <>, and pipeline accidents in {psName}</> : null}</h1>
        <p className={c.lede}>
          Oil and petroleum spills reported to the <Src k="nrc">National Response Center</Src>, each checked against the shoreline types and
          wildlife in NOAA’s <Src k="esi">Environmental Sensitivity Index</Src> and the parks and preserves in <Src k="padus">PAD-US</Src> near
          where it was reported; and pipeline accidents operators reported to <Src k="phmsa">PHMSA</Src>.
        </p>

        {data && (
          <div className={c.controls}>
            <label className={c.focus}>Area
              <select value={scopeKind === 'region' ? scope : scopeKind === 'st' || scopeKind === 'co' || scopeKind === 'pl' ? `st:${counties.stSel}` : scope}
                onChange={(e) => setScope(e.target.value)}>
                {regions.map((r) => <option key={r} value={`region:${r}`}>{regionNames[r] || r}</option>)}
                {allStates.map((x) => <option key={x} value={`st:${x}`}>{stateName(x)}</option>)}
                {(scopeKind === 'a' || scopeKind === 'sp') && <option value={scope}>{scopeKind === 'sp' ? `Reports ${scopeName}` : scopeName}</option>}
              </select>
            </label>
            {counties.stSel && counties.list.length > 1 && (
              <label className={c.focus}>County
                <select value={scopeKind === 'co' ? scopeVal : st.co ? `${st.co},${counties.stSel}` : ''} onChange={(e) => setScope(e.target.value ? `co:${e.target.value}` : `st:${counties.stSel}`)}>
                  <option value="">All of {stateName(counties.stSel)}</option>
                  {counties.list.map((x) => <option key={x} value={`${x},${counties.stSel}`}>{x}</option>)}
                </select>
              </label>
            )}
            {counties.stSel && counties.places.length > 1 && (
              <label className={c.focus}>Place
                <select value={scopeKind === 'pl' ? scopeVal : ''} onChange={(e) => {
                  const co = scopeKind === 'co' ? scopeVal.split(',')[0] : st.co
                  setScope(e.target.value ? `pl:${e.target.value}` : co ? `co:${co},${counties.stSel}` : `st:${counties.stSel}`, e.target.value ? co : null)
                }}>
                  <option value="">Any place</option>
                  {counties.places.map((x) => <option key={x} value={`${x},${counties.stSel}`}>{x}</option>)}
                </select>
              </label>
            )}
            <label className={c.focus}>Years
              <select value={preset} onChange={(e) => { const p = presets.find(([id]) => id === e.target.value); if (p) set({ y0: p[2], y1: p[3] }) }}>
                {presets.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                {preset === 'custom' && <option value="custom">{yrLabel}</option>}
              </select>
              <select value={from} aria-label="First year" onChange={(e) => { const v = +e.target.value; set({ y0: v, y1: Math.max(v, to) }) }}>{yearOpts.map((y) => <option key={y}>{y}</option>)}</select>
              to
              <select value={to} aria-label="Last year" onChange={(e) => { const v = +e.target.value; set({ y1: v, y0: Math.min(v, from) }) }}>{yearOpts.map((y) => <option key={y}>{y}</option>)}</select>
            </label>
            <label className={c.focus}>
              <input type="checkbox" checked={!st.matchOff.has('drain')} onChange={() => { const n = new Set(st.matchOff); n.has('drain') ? n.delete('drain') : n.add('drain'); set({ matchOff: n }) }} />
              Include reports that only reached a storm drain or sewer
            </label>
            {flowWords.length > 0 && <button type="button" className={s.chip} onClick={() => set({ ft: '', fw: '', fl: '' })}>Only: {flowWords.join(' · ')} <b aria-hidden="true">×</b><span className={s.sr}>clear</span></button>}
            {(scopeKind === 'a' || scopeKind === 'sp') && <button type="button" className={s.chip} onClick={() => setScope(`region:${defaultRegion}`)}>{scopeKind === 'sp' ? `Reports ${scopeName}` : scopeName} <b aria-hidden="true">×</b><span className={s.sr}>clear</span></button>}
          </div>
        )}

        <dl className={c.facts}>
          <div><dt>Area</dt><dd>{scopeKind === 'sp' ? `Reports ${scopeName}` : scopeName}{scopeKind !== 'region' && scopeKind !== 'st' ? ` (${regionName})` : ''}</dd></div>
          <div><dt>Years</dt><dd>{yrLabel}</dd></div>
          {latestNrc && <div><dt>Spill reports through</dt><dd>{fmtDate(latestNrc)} (<Src k="nrc" />)</dd></div>}
          {pipeRaw && <div><dt>Pipeline reports through</dt><dd>{fmtDate(pipeRaw.range[1])} (<Src k="phmsa" />)</dd></div>}
          {flowWords.length > 0 && <div><dt>Only</dt><dd>{flowWords.join(' · ')}</dd></div>}
          {precLeft.length > 0 && <div><dt>Leaving out reports placed by</dt><dd>{precLeft.join(', ')}</dd></div>}
          {st.matchOff.has('drain') && <div><dt>Counted</dt><dd>Reports that reached open water (as on the map)</dd></div>}
        </dl>

        {err && <div className={c.error}>The spill reports did not load ({err}). Reload to try again.</div>}
        {!ready && !err && <div className={c.loading}>Loading the reports…</div>}
        {ready && <>
          {/* 1. Headline tiles */}
          <div className={`${c.tiles} ${s.tilesPhone}`}>
            <div className={c.tile}>
              <div className={c.tileValue}>{fmt(inYears.length)}</div>
              <div className={c.tileLabel}>oil spill reports {scopeWords}, {yrLabel}</div>
              <div className={c.tileSub}>{fmt(placed.length)} placed on the map ({fmt(placed.filter((p) => p.loc !== 'city').length)} better than the nearest city)</div>
              <div className={c.tileSrc}>Source: <Src k="nrc" /> · places: <Src k="census" /></div>
            </div>
            {hasSpecies && <Tile n={nrc.listed} of={placed.length} color={SPILL} label={data.region === 'lm' ? 'of placed reports were near a listed species' : 'of placed reports were near critical habitat for a listed species'}
              src={data.region === 'lm' ? <Src k="esi">NOAA ESI</Src> : <><a className={c.src} href="https://ecos.fws.gov/ecp/report/table/critical-habitat.html" {...ext}>FWS</a> · <a className={c.src} href="https://www.fisheries.noaa.gov/resource/map/national-esa-critical-habitat-mapper" {...ext}>NOAA Fisheries</a></>} />}
            {hasAreas && <Tile n={nrc.gap12} of={placed.length} color={PA_COLOR} label="were near land protected for nature" sub="GAP status 1–2: refuges, nature preserves, wilderness" src={<Src k="padus" />} />}
            {hasEsi && <Tile n={nrc.shore} of={placed.length} color="#9f1239" label="had the most easily harmed shoreline nearby" sub="marshes, swamps, wetlands and grassy banks (ESI 9–10)" src={<Src k="esi">NOAA ESI</Src>} />}
          </div>

          {/* 2. Histograms by year */}
          <div className={c.card}>
            <div className={c.cardHead}><h2 className={c.h2}>Oil spill reports each year {scopeWords}</h2><span className={c.note}>Click a year to show only it</span></div>
            <PlotChart deps={[nrc.perYear, from, to]} make={(w) => {
              const rows = nrc.years.map((y) => ({ y, n: nrc.perYear[y], on: y >= from && y <= to }))
              return Plot.plot({
                width: w, height: 230, marginLeft: 40, marginBottom: w < 640 ? 46 : 30, style: PLOT_STYLE,
                x: { type: 'band', domain: nrc.years, label: null, tickFormat: (y) => soFar(y, yearsAll[1]), tickRotate: w < 640 ? -45 : 0, padding: 0.18 },
                y: { grid: true, label: 'Reports', nice: true },
                marks: [
                  Plot.barY(rows, { x: 'y', y: 'n', fill: SPILL, fillOpacity: (d) => (d.on ? 1 : 0.3), tip: true, title: (d) => `${soFar(d.y, yearsAll[1])}: ${fmt(d.n)} reports`, ...onClickEach(rows, (d) => set({ y0: d.y, y1: d.y })) }),
                  Plot.text(rows, { x: 'y', y: 'n', text: (d) => fmt(d.n), dy: -7, fontSize: 10.5, fill: '#374151' }),
                  Plot.ruleY([0]),
                ],
              })
            }} />
            <div className={c.hint}>Each report counted once (repeat calls about the same spill are one report). Source: <Src k="nrc">NRC incident reports</Src></div>
          </div>

          {pl && (
            <div className={c.card}>
              <div className={c.cardHead}>
                <h2 className={c.h2}>Pipeline accidents each year in {psName}</h2>
                <label className={c.focus}>Pipelines in
                  <select value={st.ps} onChange={(e) => set({ ps: e.target.value })}>
                    <option value="rg">{st.ps === 'rg' ? psName : 'The report’s area'}</option>
                    <option value="us">The whole U.S.</option>
                    {pipeStates.map((x) => <option key={x} value={x}>{stateName(x)}</option>)}
                  </select>
                </label>
              </div>
              <span className={c.legend}><span><i style={{ background: PIPE_COLOR }} />{LIQ} (crude oil, fuels, gas liquids)</span><span><i style={{ background: GAS_COLOR }} />{GAS}</span></span>
              <PlotChart deps={[pl.per, from, to]} make={(w) => {
                const narrow = w < 700
                const common = { tip: true, title: (d) => `${soFar(d.y, pl.y1)}, ${d.kind.toLowerCase()}: ${fmt(d.n)}`, fill: 'kind', fillOpacity: (d) => (d.y >= from && d.y <= to ? 1 : 0.35) }
                const color = { domain: [LIQ, GAS], range: [PIPE_COLOR, GAS_COLOR] }
                const yearFmt = (y) => soFar(y, pl.y1)
                if (narrow) {
                  return Plot.plot({
                    width: w, height: 240, marginLeft: 40, marginBottom: 46, style: PLOT_STYLE, color,
                    x: { type: 'band', domain: pl.years, label: null, tickFormat: yearFmt, tickRotate: -45, padding: 0.15 },
                    y: { grid: true, label: 'Accidents' },
                    marks: [Plot.barY(pl.per, { x: 'y', y: 'n', ...common }), Plot.ruleY([0])],
                  })
                }
                return Plot.plot({
                  width: w, height: 250, marginLeft: 40, style: PLOT_STYLE, color,
                  fx: { domain: pl.years, label: null, tickFormat: yearFmt, padding: 0.12, axis: 'bottom' },
                  x: { axis: null, domain: [LIQ, GAS], padding: 0.05 },
                  y: { grid: true, label: 'Accidents' },
                  marks: [
                    Plot.barY(pl.per, { fx: 'y', x: 'kind', y: 'n', ...common }),
                    Plot.text(pl.per, { fx: 'y', x: 'kind', y: 'n', text: (d) => fmt(d.n), dy: -6, fontSize: 8.5, fill: '#374151' }),
                    Plot.ruleY([0]),
                  ],
                })
              }} />
              <div className={c.hint}>Paler bars: years outside {yrLabel}. Oil and other liquids: hazardous liquid pipeline accident reports. Gas: gas transmission, gathering, distribution and LNG incident reports. Source: <Src k="phmsa">PHMSA</Src></div>
            </div>
          )}

          {/* 3. Through time: reports each month */}
          <div className={c.card}>
            <div className={c.cardHead}><h2 className={c.h2}>Oil spill reports each month, {yrLabel}</h2></div>
            <PlotChart deps={[inYears]} make={(w) => {
              if (!inYears.length) return null
              const date = (p) => new Date(`${p.d.slice(0, 10)}T12:00:00Z`)
              // only dates inside the chosen years: a spill on Dec 31 reported on Jan 2 counts in the later year's file
              const lo = new Date(Date.UTC(from, 0, 1)), hi = new Date(Date.UTC(to + 1, 0, 1))
              const rows = inYears.filter((p) => { const d = date(p); return d >= lo && d < hi })
              return Plot.plot({ width: w, height: 240, marginLeft: 40, style: PLOT_STYLE, x: { type: 'utc', label: null, domain: [lo, hi] }, y: { grid: true, label: 'Reports' },
                marks: [
                  Plot.rectY(rows, Plot.binX({ y: 'count', title: (ps) => `${new Date(`${ps[0].d.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}: ${fmt(ps.length)} report${ps.length === 1 ? '' : 's'}` },
                    { x: date, interval: 'month', fill: SPILL, inset: 0.5, tip: true })),
                  Plot.ruleY([0]),
                ] })
            }} />
            <div className={c.hint}>Each bar counts the reports of spills in that month, by the date the spill was reported to happen. Source: <Src k="nrc">NRC incident reports</Src></div>
          </div>


          {/* 5. Where the oil went */}
          <div className={c.card}>
            <div className={c.cardHead}><h2 className={c.h2}>Where the oil came from and where it went</h2><span className={c.note}>Click a block or band to show only those reports · click again to clear</span></div>
            <div className={s.flowScroll}><div className={s.flowInner}>
              <div className={s.flowHeads}><span>What spilled it</span><span>The water it reached</span><span>{hasEsi ? 'The shore nearby' : 'On the map'}</span></div>
              <Flow pts={inYears} regionName={regionName} filters={st} onPick={pickFlow} />
            </div></div>
            <div className={c.hint}>Source and water: as the caller told the <Src k="nrc">NRC</Src>. Shore nearby: the most easily harmed <Src k="esi">NOAA ESI</Src> shoreline within each report’s reach (1 km for coordinates, 2–3 km for an address, named site or distance from a city, 5 km for a nearest city).</div>
          </div>

          {/* 6. Species */}
          {hasSpecies && species.length > 0 && (
            <div className={c.card}>
              <div className={c.cardHead}><h2 className={c.h2}>Listed species within reach of a report</h2><PrecLegend /></div>
              <div className={c.tableWrap}>
                <table className={`${c.table} ${s.tbl}`}>
                  <thead><tr><th>Species</th><th>Status</th><th className={c.num}>Reports</th><th className={s.barTh}>How the reports were placed</th><th className={s.noPrintCol} /></tr></thead>
                  <tbody>
                    {(moreSp ? species : species.slice(0, 20)).map((r) => {
                      const href = speciesHref(r.sp) || r.sp.url   // EarthAtlas species page, or the FWS / NOAA profile for critical habitat
                      return (
                        <tr key={r.sp.n}>
                          <td>{href ? <a className={c.src} href={href} {...ext}>{r.sp.n}</a> : r.sp.n}<span className={c.sub}>{r.sp.txn || ''}{r.sp.g ? ` · ${r.sp.g}` : ''}</span></td>
                          <td className={s.wrap}>{statusFull(r.sp)}</td>
                          <td className={c.num}><b>{fmt(r.n)}</b></td>
                          <td><PrecBar row={r} max={species[0].n} /></td>
                          <td className={s.noPrintCol}>{r.sp.tx && <button type="button" className={s.linkBtn} onClick={() => setScope(`sp:${r.sp.tx}`)}>Only these</button>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {species.length > 20 && <button type="button" className={s.more} onClick={() => setMoreSp((v) => !v)}>{moreSp ? 'Show the top 20' : `Show all ${species.length} species`}</button>}
              {data.region === 'lm'
                ? <div className={c.hint}>A species counts when NOAA maps it within a report’s reach. Species and listing status: <Src k="esi">NOAA ESI</Src> · names link to their EarthAtlas species page (<a className={c.src} href="https://www.inaturalist.org/" {...ext}>iNaturalist</a> taxa) · placed by: <Src k="nrc">NRC</Src>, <Src k="census" /></div>
                : <div className={c.hint}>A species counts when its critical habitat lies within a report’s reach. Habitat and listing status: <a className={c.src} href="https://ecos.fws.gov/ecp/report/table/critical-habitat.html" {...ext}>FWS</a> · <a className={c.src} href="https://www.fisheries.noaa.gov/resource/map/national-esa-critical-habitat-mapper" {...ext}>NOAA Fisheries</a> · names link to their EarthAtlas species page where one is matched, otherwise to the agency’s species profile · placed by: <Src k="nrc">NRC</Src>, <Src k="census" /></div>}
            </div>
          )}

          {/* 7. Shoreline classes */}
          {hasEsi && nrc.classes.length > 0 && (
            <div className={c.card}>
              <div className={c.cardHead}><h2 className={c.h2}>The most easily harmed shoreline near each report</h2><span className={c.note}>NOAA’s own colors · click a bar to see that shoreline on the map</span></div>
              <PlotChart deps={[nrc.classes]} make={(w) => {
                const narrow = w < 640, max = Math.max(...nrc.classes.map((d) => d.n))
                const bar = { tip: true, y: 'label', x: 'n', fill: (d) => ESI_COLORS[d.code] || '#9ca3af', href: (d) => mapHref(`e:${d.code}`), title: (d) => `${d.label}: ${fmt(d.n)} reports · ${d.level.toLowerCase()} by oil · NOAA: ${data.esi_names[d.code] || ''}` }
                const val = { y: 'label', x: 'n', text: (d) => `${fmt(d.n)} · ${d.level.toLowerCase()}`, dx: 5, textAnchor: 'start', fontSize: 10.5, fill: '#374151' }
                if (narrow) {
                  // Phones: each class's name above its bar, so the bars get the full width.
                  return Plot.plot({ width: w, height: 8 + nrc.classes.length * 38, marginTop: 14, marginBottom: 4, marginLeft: 0, marginRight: 4, style: PLOT_STYLE,
                    x: { axis: null, domain: [0, max * 1.9] }, y: { domain: nrc.classes.map((d) => d.label), axis: null, paddingInner: 0.55, paddingOuter: 0.3 },
                    marks: [Plot.barX(nrc.classes, bar), Plot.text(nrc.classes, val),
                      Plot.text(nrc.classes, { y: 'label', x: 0, text: 'label', dy: -16, textAnchor: 'start', fontSize: 11, fill: '#111827' })] })
                }
                return Plot.plot({ width: w, height: 12 + nrc.classes.length * 26, marginTop: 6, marginBottom: 6, marginLeft: Math.min(300, w * 0.5), marginRight: 10, style: PLOT_STYLE,
                  x: { axis: null, domain: [0, max * 1.4] }, y: { domain: nrc.classes.map((d) => d.label), label: null, tickSize: 0 },
                  marks: [Plot.barX(nrc.classes, bar), Plot.text(nrc.classes, val)] })
              }} />
              <div className={c.hint}>{nrc.noShore > 0 && <>{fmt(nrc.noShore)} placed reports had no mapped shoreline within reach. </>}Shoreline classes 1 (oil washes off) to 10 (oil stays for years): <Src k="esi">NOAA ESI</Src></div>
            </div>
          )}

          {/* 8. Protected areas */}
          {hasAreas && (
            <div className={c.card}>
              <div className={c.cardHead}>
                <h2 className={c.h2}>Protected areas with the most reports</h2>
                <span className={s.toggles}>
                  <label><input type="checkbox" checked={st.pg === 'all'} onChange={() => set({ pg: st.pg === 'all' ? '' : 'all' })} /> All public and protected land</label>
                  <label><input type="checkbox" checked={st.pc} onChange={() => set({ pc: !st.pc })} /> Include reports placed by nearest city only</label>
                </span>
              </div>
              {areas.length > 0 ? (
                <div className={c.tableWrap}>
                  <table className={`${c.table} ${s.tbl}`}>
                    <thead><tr><th>Protected area</th><th>Manager</th><th>Protection</th><th className={c.num}>Reports inside</th><th className={c.num}>Within 500 m</th><th className={c.num}>Within reach</th><th className={c.thSpark}>Each year, {yrLabel}</th></tr></thead>
                    <tbody>
                      {(() => {
                        const yrs = []; for (let y = from; y <= to; y++) yrs.push(y)
                        const rows = morePa ? areas.slice(0, 100) : areas.slice(0, 15)
                        const max = Math.max(1, ...rows.flatMap((r) => Object.values(r.years)))
                        return rows.map((r) => (
                          <tr key={r.i}>
                            <td><a className={c.src} href={mapHref(`a:${r.i}`, { lat: r.p0.lat, lon: r.p0.lon, z: 12 })}>{r.a.n}</a><span className={c.sub}>{r.a.d}{r.a.st ? ` · ${r.a.st}` : ''}</span></td>
                            <td className={s.wrap}>{AGENCY[r.a.mn] || MANAGER[r.a.mt] || r.a.mt}{AGENCY[r.a.mn] && MANAGER[r.a.mt] && <span className={c.sub}>{MANAGER[r.a.mt]}</span>}</td>
                            <td className={s.wrap}>{gapOf(r.a).label}</td>
                            <td className={c.num}><b>{fmt(r.inside)}</b></td>
                            <td className={c.num}>{fmt(r.near)}</td>
                            <td className={c.num}>{fmt(r.reach)}</td>
                            <td><Spark years={yrs} counts={r.years} max={max} color="#16a34a" /></td>
                          </tr>
                        ))
                      })()}
                    </tbody>
                  </table>
                </div>
              ) : <div className={c.none}>No {st.pg === 'all' ? 'protected land' : 'land protected for nature (GAP 1–2)'} near these reports{st.pc ? '' : ' placed better than the nearest city'}.</div>}
              {areas.length > 15 && <button type="button" className={s.more} onClick={() => setMorePa((v) => !v)}>{morePa ? 'Show the top 15' : `Show ${Math.min(100, areas.length)} of ${areas.length} areas`}</button>}
              <div className={c.hint}>{st.pg === 'all' ? 'Every protected or public area' : 'Land protected for nature (GAP status 1–2)'}{st.pc ? '' : ', counting reports placed by coordinates, an address, a named site or a distance from a city'}. Areas, managers and protection: <Src k="padus" /> · reports: <Src k="nrc" /> · click a name to open it on the map</div>
            </div>
          )}

          {/* 9. Pipelines */}
          {pl && <>
            <h2 className={s.sectionH}>Pipeline accidents in {psName}, {yrLabel}</h2>
            <div className={`${c.tiles} ${s.tilesPhone}`}>
              <div className={c.tile}>
                <div className={c.tileValue} style={{ color: '#c2410c' }}>{fmt(pl.liqT.n)}</div>
                <div className={c.tileLabel}>oil and liquid pipeline accidents</div>
                <div className={c.tileSub}>{barrelsTotal(pl.liqT.bbl)} released; {fmt(pl.liqT.rec)} barrels recovered</div>
                <div className={c.tileSub}>{fmt(pl.liqT.water)} reached water · {fmt(pl.liqT.wild)} harmed wildlife</div>
                <div className={c.tileSrc}>Source: <Src k="phmsa" /></div>
              </div>
              <div className={c.tile}>
                <div className={c.tileValue} style={{ color: '#7e22ce' }}>{fmt(pl.gasT.n)}</div>
                <div className={c.tileLabel}>gas pipeline incidents</div>
                <div className={c.tileSub}>{mcfText(pl.gasT.mcf)} of gas released into the air</div>
                <div className={c.tileSub}>{fmt(pl.gasT.evac)} people evacuated</div>
                <div className={c.tileSrc}>Source: <Src k="phmsa" /></div>
              </div>
              <div className={c.tile}>
                <div className={c.tileValue}>{fmt(pl.liqT.fat + pl.gasT.fat)}</div>
                <div className={c.tileLabel}>people killed</div>
                <div className={c.tileSub}>{fmt(pl.gasT.fat)} in gas incidents, {fmt(pl.liqT.fat)} in liquid accidents</div>
                <div className={c.tileSub}><b>{fmt(pl.liqT.inj + pl.gasT.inj)}</b> people hurt ({fmt(pl.gasT.inj)} gas, {fmt(pl.liqT.inj)} liquid)</div>
                <div className={c.tileSrc}>Source: <Src k="phmsa" /></div>
              </div>
              <div className={c.tile}>
                <div className={c.tileValue}>{fmt(pl.gasT.fire + pl.liqT.fire)}</div>
                <div className={c.tileLabel}>caught fire or exploded</div>
                <div className={c.tileSub}>{fmt(pl.gasT.fire)} gas incidents ({fmt(pl.gasT.boom)} exploded), {fmt(pl.liqT.fire)} liquid accidents caught fire</div>
                <div className={c.tileSrc}>Source: <Src k="phmsa" /></div>
              </div>
            </div>

            {pl.bigLiq.length > 0 && (
              <div className={c.card}>
                <div className={c.cardHead}><h2 className={c.h2}>Largest oil and liquid accidents: released and recovered</h2>
                  <span className={c.legend}><span><i style={{ background: PIPE_COLOR }} />Released</span><span><i style={{ background: '#0f766e' }} />Recovered</span></span></div>
                <PlotChart deps={[pl.bigLiq]} make={(w) => {
                  const rows = pl.bigLiq.map((a) => ({ a, label: w < 640 ? `${fmtDate(a.d)} · ${a.st || ''}` : `${fmtDate(a.d)} · ${pipePlace(a)}`, bbl: a.bbl, rec: Math.max(0, a.rec || 0), href: mapHref(`x:${a.id}`, { lat: a.lat, lon: a.lon, z: 10, y: a.y }) }))
                  return Plot.plot({ width: w, height: 30 + rows.length * 26, marginLeft: Math.min(230, w * 0.45), marginRight: 20, style: PLOT_STYLE,
                    x: { grid: true, label: 'Barrels', tickFormat: (v) => fmt(v), nice: true }, y: { domain: rows.map((d) => d.label), label: null, tickSize: 0 },
                    marks: [
                      Plot.link(rows, { x1: 'rec', x2: 'bbl', y1: 'label', y2: 'label', stroke: '#cbd5e1', strokeWidth: 3 }),
                      Plot.dot(rows, { x: 'rec', y: 'label', fill: '#0f766e', r: 5, tip: true, title: (d) => `Recovered ${fmt(d.rec)} barrels` }),
                      Plot.dot(rows, { x: 'bbl', y: 'label', fill: PIPE_COLOR, r: 6, href: 'href', tip: true, title: (d) => `${d.label}: ${bblText(d.bbl)} released, ${fmt(d.rec)} barrels recovered · ${COMMODITY_PLAIN[d.a.c] || d.a.c} · ${d.a.o}` }),
                    ] })
                }} />
                <div className={c.tableWrap}>
                  <table className={`${c.table} ${s.tbl}`}>
                    <thead><tr><th>Date</th><th>Place</th><th>What spilled</th><th className={c.num}>Released</th><th className={c.num}>Recovered</th><th>Operator</th>{pl.liqCauses && <th>Cause</th>}</tr></thead>
                    <tbody>{pl.bigLiq.map((a) => (
                      <tr key={a.id}>
                        <td><a className={c.src} href={mapHref(`x:${a.id}`, { lat: a.lat, lon: a.lon, z: 10, y: a.y })}>{fmtDate(a.d)}</a></td>
                        <td className={s.wrap}>{pipePlace(a)}</td>
                        <td className={s.wrap}>{COMMODITY_PLAIN[a.c] || a.c}</td>
                        <td className={c.num}><b>{fmt(a.bbl)}</b> bbl</td>
                        <td className={c.num}>{fmt(a.rec)} bbl</td>
                        <td className={s.wrap}>{a.o}</td>
                        {pl.liqCauses && <td className={s.wrap}>{a.cause}</td>}
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div className={c.hint}>Barrels as the operator reported them (1 barrel = 42 gallons). Click a date or a dot to open the accident on the map. Source: <Src k="phmsa">PHMSA accident reports</Src></div>
              </div>
            )}

            {pl.bigGas.length > 0 && (
              <div className={c.card}>
                <div className={c.cardHead}><h2 className={c.h2}>Largest gas releases</h2></div>
                <div className={c.tableWrap}>
                  <table className={`${c.table} ${s.tbl}`}>
                    <thead><tr><th>Date</th><th>Place</th><th>Kind of line</th><th className={c.num}>Gas released</th><th className={c.num}>Killed</th><th className={c.num}>Hurt</th><th>Fire</th><th>Operator</th>{pl.gasCauses && <th>Cause</th>}</tr></thead>
                    <tbody>{pl.bigGas.map((a) => (
                      <tr key={a.id}>
                        <td><a className={c.src} href={mapHref(`q:${a.id}`, { lat: a.lat, lon: a.lon, z: 10, y: a.y, gas: true })}>{fmtDate(a.d)}</a></td>
                        <td className={s.wrap}>{pipePlace(a)}</td>
                        <td className={s.wrap}>{GAS_SYSTEM[a.s] || a.s}</td>
                        <td className={c.num}><b>{mcfText(a.mcf)}</b></td>
                        <td className={c.num}>{fmt(a.fat)}</td>
                        <td className={c.num}>{fmt(a.inj)}</td>
                        <td>{a.boom ? 'Exploded' : a.fire ? 'Caught fire' : 'No'}</td>
                        <td className={s.wrap}>{a.o}</td>
                        {pl.gasCauses && <td className={s.wrap}>{a.cause}</td>}
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div className={c.hint}>Gas released into the air, as the operator reported it. Click a date to open the incident on the map. Source: <Src k="phmsa">PHMSA incident reports</Src></div>
              </div>
            )}

            {pl.harm.some((d) => d.n > 0) && (
              <div className={c.card}>
                <div className={c.cardHead}><h2 className={c.h2}>People killed and hurt in gas pipeline incidents</h2>
                  <span className={c.legend}><span><i style={{ background: '#581c87' }} />Killed</span><span><i style={{ background: '#c084fc' }} />Hurt</span></span></div>
                <PlotChart deps={[pl.harm]} make={(w) => Plot.plot({
                  width: w, height: 210, marginLeft: 40, marginBottom: w < 640 ? 46 : 30, style: PLOT_STYLE,
                  color: { domain: ['Deaths', 'Injuries'], range: ['#581c87', '#c084fc'] },
                  x: { type: 'band', label: null, tickFormat: (y) => soFar(y, pl.y1), tickRotate: w < 640 ? -45 : 0, padding: 0.2 }, y: { grid: true, label: 'People' },
                  marks: [Plot.barY(pl.harm, { x: 'y', y: 'n', fill: 'k', title: (d) => `${soFar(d.y, pl.y1)}: ${fmt(d.n)} ${d.k === 'Deaths' ? 'killed' : 'hurt'}` }), Plot.ruleY([0])],
                })} />
                <div className={c.hint}>{psName === 'the U.S.' ? 'The whole U.S.' : psName} · source: <Src k="phmsa">PHMSA gas incident reports</Src></div>
              </div>
            )}

            {(pl.liqCauses || pl.gasCauses) && (
              <div className={c.card}>
                <div className={c.cardHead}><h2 className={c.h2}>What caused the pipeline accidents</h2></div>
                <div className={s.two}>
                  {[[pl.liqCauses, LIQ, PIPE_COLOR], [pl.gasCauses, GAS, GAS_COLOR]].filter(([x]) => x?.length).map(([rows, name, col]) => (
                    <div key={name}>
                      <h3 className={c.h3}>{name}</h3>
                      <PlotChart deps={[rows]} make={(w) => Plot.plot({ width: w, height: 24 + rows.length * 24, marginLeft: Math.min(200, w * 0.52), marginRight: 44, style: PLOT_STYLE,
                        x: { axis: null }, y: { domain: rows.map((d) => d.name), label: null, tickSize: 0 },
                        marks: [Plot.barX(rows, { y: 'name', x: 'n', fill: col, tip: true, title: (d) => `${d.name}: ${fmt(d.n)}` }), Plot.text(rows, { y: 'name', x: 'n', text: (d) => fmt(d.n), dx: 4, textAnchor: 'start', fontSize: 10.5 })] })} />
                    </div>
                  ))}
                </div>
                <div className={c.hint}>The cause the operator gave. Source: <Src k="phmsa" /></div>
              </div>
            )}
          </>}

          {/* 10. Places, materials, causes, amounts */}
          {nrc.topPlaces.length > 1 && (
            <div className={c.card}>
              <div className={c.cardHead}><h2 className={c.h2}>The places with the most spill reports</h2><span className={c.note}>Reports each year, {yrLabel} · click a name to open it on the map</span></div>
              <div className={s.multiples}>
                {nrc.topPlaces.map((p) => {
                  const yrs = []; for (let y = from; y <= to; y++) yrs.push(y)
                  const max = Math.max(...nrc.topPlaces.flatMap((x) => Object.values(x.years)))
                  return (
                    <div key={p.k} className={s.mult}>
                      <div className={s.multHead}><a className={c.src} href={mapHref(`p:${p.name}`, { lat: p.pts[0].lat, lon: p.pts[0].lon, z: 10 })}>{p.name}, {p.st}</a><b>{fmt(p.n)}</b></div>
                      <Spark years={yrs} counts={p.years} max={max} />
                      <div className={s.multAxis}><span>{from}</span><span>{to === yearsAll[1] ? `${to} so far` : to}</span></div>
                    </div>
                  )
                })}
              </div>
              <div className={c.hint}>Places as the map names them: the most common city named in reports within about 5 km. Source: <Src k="nrc" /> · places: <Src k="gaz" /></div>
            </div>
          )}

          <div className={c.card}>
            <div className={c.cardHead}><h2 className={c.h2}>What spilled, from what, and why</h2></div>
            <div className={s.three}>
              {[['What spilled', nrc.mats], ['What it came from', nrc.sources], ['Cause the caller gave', nrc.causes]].map(([name, rows]) => (
                <div key={name}>
                  <h3 className={c.h3}>{name}</h3>
                  <PlotChart deps={[rows]} make={(w) => Plot.plot({ width: w, height: 24 + rows.length * 22, marginLeft: Math.min(190, w * 0.58), marginRight: 40, style: PLOT_STYLE,
                    x: { axis: null }, y: { domain: rows.map((d) => d.name), label: null, tickSize: 0 },
                    marks: [Plot.barX(rows, { y: 'name', x: 'n', fill: SPILL, tip: true, title: (d) => `${d.name}: ${fmt(d.n)} reports` }), Plot.text(rows, { y: 'name', x: 'n', text: (d) => fmt(d.n), dx: 4, textAnchor: 'start', fontSize: 10.5 })] })} />
                </div>
              ))}
            </div>
            <div className={c.hint}>A report can name more than one material. Source: <Src k="nrc">NRC incident reports</Src></div>
          </div>

          {nrc.largest.length > 0 && (
            <div className={c.card}>
              <div className={c.cardHead}><h2 className={c.h2}>The largest amounts reported</h2></div>
              <div className={c.tableWrap}>
                <table className={`${c.table} ${s.tbl}`}>
                  <thead><tr><th>Date</th><th>Place</th><th>Water</th><th>What spilled</th><th className={c.num}>Gallons</th><th>NRC report</th></tr></thead>
                  <tbody>{nrc.largest.map((p) => (
                    <tr key={p.seq}>
                      <td><a className={c.src} href={reportHref(p)}>{fmtDate(p.d)}</a></td>
                      <td>{[placeOf(p), p.st].filter(Boolean).join(', ')}</td>
                      <td className={s.wrap}>{p.w ? titleCase(p.w) : '—'}</td>
                      <td className={s.wrap}>{(p.m || []).map(titleCase).join('; ')}</td>
                      <td className={c.num}><b>{fmt(p.g)}</b></td>
                      <td><a className={c.src} href={NRC_HOME} {...ext} title="National Response Center">{p.seq}</a></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div className={c.hint}>Amounts as the caller first reported them. Click a date to open the report on the map. Source: <Src k="nrc">NRC incident reports</Src></div>
            </div>
          )}
        </>}

        {/* 11. Sources */}
        <section className={c.method} id="sources">
          <h2 className={c.h2}>How this is sourced</h2>
          <p className={s.intro}>{SPILLS_SOURCES_INTRO}</p>
          {SPILLS_SOURCES.map((sec) => (
            <div key={sec.heading} className={s.srcSec}>
              <h3 className={c.h3}>{sec.heading}</h3>
              <ul className={s.srcList}>
                {sec.sources.map((x) => (
                  <li key={x.name}>
                    <a className={c.src} href={x.href} {...ext}>{x.name}</a>{x.publisher && <span className={s.dim}> · {x.publisher}</span>}
                    {x.licence && <span className={s.dim}> · {x.licenceHref ? <a className={c.src} href={x.licenceHref} {...ext}>{x.licence}</a> : x.licence}</span>}
                    {x.method && <div className={s.method}>{x.method}</div>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <dl className={c.defs}>
            {SPILLS_SOURCES_NOTES.map((n) => <div key={n.heading} style={{ display: 'contents' }}><dt>{n.heading}</dt><dd>{n.body}</dd></div>)}
          </dl>
        </section>
        <BuiltByCredit variant="light" className={c.builtBy} />
      </main>
    </div>
  )
}

function Tile({ n, of, color, label, sub, src }) {
  const share = of ? n.n / of : 0
  return (
    <div className={`${c.tile} ${s.wTile}`}>
      <Waffle share={share} color={color} />
      <div>
        <div className={c.tileValue}>{pctOf(n.n, of)}%</div>
        <div className={c.tileLabel}>{label}</div>
        <div className={c.tileSub}>{fmt(n.n)} of {fmt(of)}{sub ? ` · ${sub}` : ''}</div>
        <div className={c.tileSub}>{fmt(n.exact + n.near)} placed by coordinates, an address or a site; {fmt(n.city)} by nearest city only</div>
        <div className={c.tileSrc}>Source: {src} · <Src k="nrc" /></div>
      </div>
    </div>
  )
}
