/**
 * /shoreline/reports: everything /shoreline maps, counted by island (Josh 2026-11-08: "counts for all of the various data that
 * exists for the site", with an island filter at the top). Design: docs/SHORELINE_REPORT_PLAN.md.
 *
 * Data: /shoreline-data/report-counts.json from scripts/shoreline/report-counts.py, which counts every map layer at its nearest
 * island (islands from the Assessor's districts, as the /risks land-value report names them).
 * URL state: i (island).
 */
import { useEffect, useState } from 'react'
import BuiltByCredit from '../components/BuiltByCredit.jsx'
import DocBrand from '../components/DocBrand.jsx'
import { ChartTipProvider, useChartTip } from '../components/ChartTip.jsx'
import { BRANDS } from '../lib/brand.js'
import c from '../ships/ScrubberReport.module.css'
import r from './ShorelineReport.module.css'
import { FISH_TIERS, FISH_SPECIES, SHOREFORM_GROUPS, SHOREFORM_GROUP_ORDER, PIN_SPECS, FORAGE, MODIFICATIONS } from './shorelineLayers.js'
import { COUNTY_PARCELS_URL, COUNTY_BUILDINGS_URL, FISH_USE_URL, GUIDE_URL } from './shorelineSources.js'
import { FRIENDS_PAGE } from '../permits/habitat.js'

const FRIENDS_BRAND = BRANDS.find((b) => b.id === 'friends') || BRANDS[0]
const ASSESSOR_URL = 'https://www.sanjuancountywa.gov/149/Assessor'
const KELP = '#B89A3A', EELGRASS = '#20B2AA', ARMOR = '#8B0000', PARCEL = '#F97316', BUILDING = '#60A5FA'
const FORAGE_COLOR = Object.fromEntries(FORAGE.map((f) => [f.id, f.color]))

const whole = (n) => Math.round(n || 0).toLocaleString('en-US')
const tenth = (n) => (n >= 100 ? whole(n) : (Math.round((n || 0) * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
const pct = (x) => (x >= 0.995 ? '100%' : x >= 0.1 ? `${Math.round(x * 100)}%` : x >= 0.001 ? `${(x * 100).toFixed(1)}%` : x > 0 ? '<0.1%' : '0%')

function readIsland() {
  return new URLSearchParams(window.location.search).get('i') || ''
}

function Src({ href, children, title }) {
  const internal = href.startsWith('/') || href.startsWith('#')
  return <a className={c.src} href={href} title={title} {...(internal ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>{children}</a>
}
const FriendsSrc = () => <Src href={FRIENDS_PAGE} title="Friends of the San Juans shoreline data">Friends of the San Juans</Src>
const How = () => <Src href="#how" title="How this is counted">how</Src>

/** The map's own swatch for a row: a line, an area or the layer's pin. */
function Swatch({ kind, color, pin }) {
  if (pin) {
    const p = PIN_SPECS[pin]
    const box = p.box || 24
    return (
      <span className={r.pin} style={{ background: p.color }} aria-hidden="true">
        <svg viewBox={`0 0 ${box} ${box}`} width="12" height="12">
          <path d={p.glyph} fill={p.stroke ? 'none' : '#fff'} stroke={p.stroke ? '#fff' : 'none'} strokeWidth={p.stroke ? 2 : 0} strokeLinecap="round" />
        </svg>
      </span>
    )
  }
  return <span className={kind === 'line' ? r.swLine : r.swArea} style={{ '--sw': color }} aria-hidden="true" />
}

/**
 * One measure: name, value, unit, and — with an island chosen — that island's share of the county, as a bar.
 * row = { name, key, unit, fmt, color, kind, pin, src, sub }
 */
function Rows({ rows, d, all, island }) {
  const tip = useChartTip()
  const shown = rows.filter((x) => (d[x.key] || 0) > 0)
  if (!shown.length) return <div className={c.none}>None mapped on {island}.</div>
  return (
    <div className={c.tableWrap}>
      <table className={`${c.table} ${r.rows}`}>
        <thead><tr>
          <th>Layer</th><th className={c.num}>{island || 'San Juan County'}</th>
          {island && <><th className={c.num}>County-wide</th><th className={r.barTh}>Share on {island}</th></>}
          <th>Source</th>
        </tr></thead>
        <tbody>
          {shown.map((x) => {
            const v = d[x.key] || 0, tot = all[x.key] || 0, f = x.fmt || whole
            return (
              <tr key={x.key}>
                <td><span className={r.name}><Swatch kind={x.kind} color={x.color} pin={x.pin} />{x.name}</span>{x.sub && <span className={r.sub}>{x.sub(d)}</span>}</td>
                <td className={c.num}><b>{f(v)}</b> <span className={r.unit}>{x.unit}</span></td>
                {island && <>
                  <td className={c.num}>{f(tot)} <span className={r.unit}>{x.unit}</span></td>
                  <td className={r.barTd} {...tip({ head: x.name, rows: [
                    { color: x.color || PIN_SPECS[x.pin]?.color, label: island, value: `${f(v)} ${x.unit}`.trim(), on: true },
                    { label: 'San Juan County', value: `${f(tot)} ${x.unit}`.trim() },
                  ], foot: `${pct(v / (tot || 1))} of the county’s total is on ${island}` })}><span className={r.bar}><span style={{ width: `${Math.min(100, (v / (tot || 1)) * 100)}%`, background: x.color || PIN_SPECS[x.pin]?.color }} /></span><span className={r.pct}>{pct(v / (tot || 1))}</span></td>
                </>}
                <td className={r.srcTd}>{x.src}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Miles at each priority level, per species: one stacked bar each, in the map's tier colors. */
function FishLevels({ d, where }) {
  const tip = useChartTip()
  const species = [...FISH_SPECIES.map((s) => ({ id: s.mode, name: s.name })), { id: 'all', name: 'Highest of all seven species' }]
  const rows = species.map((s) => ({ ...s, t: [1, 2, 3].map((t) => d[`fish_${s.id}_${t}`] || 0) })).filter((s) => s.t.some(Boolean))
  if (!rows.length) return <div className={c.none}>No modeled shoreline here.</div>
  const max = Math.max(...rows.map((s) => s.t[0] + s.t[1] + s.t[2]), 1)
  return (
    <>
      <div className={r.key}>
        {[3, 2, 1].map((t) => <span key={t}><Swatch kind="line" color={FISH_TIERS[t].color} />{FISH_TIERS[t].label}</span>)}
      </div>
      <div className={r.stackList}>
        {rows.map((s) => {
          const sum = s.t[0] + s.t[1] + s.t[2]
          return (
            <div key={s.id} className={`${r.stackRow} ${s.id === 'all' ? r.stackAll : ''}`}>
              <span className={r.stackName}>{s.name}</span>
              <span className={r.stackTrack} style={{ width: `${(sum / max) * 100}%` }}>
                {[3, 2, 1].map((t) => s.t[t - 1] > 0 && (
                  <span key={t} className={r.stackSeg} style={{ flexGrow: s.t[t - 1], background: FISH_TIERS[t].color }} {...tip({
                    head: `${s.name} · ${where}`,
                    rows: [3, 2, 1].map((u) => ({ color: FISH_TIERS[u].color, label: FISH_TIERS[u].label, value: `${tenth(s.t[u - 1])} mi`, on: u === t })),
                    foot: `${FISH_TIERS[t].label}: ${pct(s.t[t - 1] / (sum || 1))} of ${tenth(sum)} modeled miles`,
                  })} />
                ))}
              </span>
              <span className={r.stackNums}>
                <b style={{ color: FISH_TIERS[3].color }}>{tenth(s.t[2])}</b> highest · <b style={{ color: '#c2410c' }}>{tenth(s.t[1])}</b> high · {tenth(s.t[0])} moderate <span className={r.unit}>mi</span>
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}

/** Shoreform groups as one bar each, longest first. */
function Shoreforms({ d, where }) {
  const tip = useChartTip()
  const rows = SHOREFORM_GROUP_ORDER.map((g) => ({ g, mi: d[`shoreform_${g}`] || 0 })).filter((x) => x.mi > 0)
  if (d.shoreform_other) rows.push({ g: 'other', mi: d.shoreform_other })
  if (!rows.length) return <div className={c.none}>No mapped shoreforms here.</div>
  const max = Math.max(...rows.map((x) => x.mi), 1), tot = rows.reduce((a, x) => a + x.mi, 0)
  return (
    <div className={r.stackList}>
      {rows.map(({ g, mi }) => (
        <div key={g} className={r.barRow} {...tip({
          head: SHOREFORM_GROUPS[g]?.label || 'Not classified',
          rows: [{ color: SHOREFORM_GROUPS[g]?.color || '#708090', label: where, value: `${tenth(mi)} mi`, on: true }],
          foot: `${pct(mi / tot)} of ${tenth(tot)} miles of mapped shoreline`,
        })}>
          <span className={r.name}><Swatch kind="line" color={SHOREFORM_GROUPS[g]?.color || '#708090'} />{SHOREFORM_GROUPS[g]?.label || 'Not classified'}</span>
          <span className={r.bar}><span style={{ width: `${(mi / max) * 100}%`, background: SHOREFORM_GROUPS[g]?.color || '#708090' }} /></span>
          <span className={r.barN}><b>{tenth(mi)}</b> mi <span className={r.unit}>{pct(mi / tot)}</span></span>
        </div>
      ))}
    </div>
  )
}

/** All islands: one row per island; click to filter. */
function ByIsland({ data, onPick }) {
  const cols = [
    ['shore_mi', 'Shoreline', 'mi', tenth], ['kelp_acres', 'Bull kelp', 'ac', tenth], ['eelgrass_mi', 'Eelgrass edge', 'mi', tenth],
    ['fdoc_beaches', 'Forage fish beaches', '', whole], ['armor_mi', 'Armor', 'mi', tenth], ['docks', 'Docks', '', whole],
    ['buoys', 'Buoys & floats', '', whole], ['parcels', 'Properties', '', whole], ['buildings', 'Buildings', '', whole],
  ]
  return (
    <div className={c.card}>
      <div className={c.cardHead}><h2 className={c.h2}>By island</h2><span className={c.note}>Click an island to show only it</span></div>
      <div className={c.tableWrap}>
        <table className={`${c.table} ${r.islands}`}>
          <thead><tr><th>Island</th>{cols.map(([k, label, unit]) => <th key={k} className={c.num}>{label}{unit && <span className={r.unit}> {unit}</span>}</th>)}</tr></thead>
          <tbody>
            {data.islands.map((isl) => {
              const d = data.byIsland[isl]
              return (
                <tr key={isl} className={r.click} onClick={() => onPick(isl)}>
                  <td><button type="button" className={r.islandBtn} onClick={(e) => { e.stopPropagation(); onPick(isl) }}>{isl}</button></td>
                  {cols.map(([k, , , f]) => <td key={k} className={c.num}>{d[k] ? f(d[k]) : '—'}</td>)}
                </tr>
              )
            })}
            <tr className={c.lvl1}><td>San Juan County</td>{cols.map(([k, , , f]) => <td key={k} className={c.num}><b>{f(data.all[k])}</b></td>)}</tr>
          </tbody>
        </table>
      </div>
      <div className={c.hint}>Shoreline, kelp, eelgrass, forage fish, armor, docks and buoys: <FriendsSrc /> · parcels: <Src href={COUNTY_PARCELS_URL} title="San Juan County GIS">County parcels</Src> · buildings: <Src href={COUNTY_BUILDINGS_URL} title="San Juan County GIS">County building footprints</Src> · <How /></div>
    </div>
  )
}

/** /shoreline at an island's extent (lat, lng, z: the map's URL state). */
function mapHref(bbox) {
  if (!bbox) return '/shoreline'
  const [w, s, e, n] = bbox
  const lat = (s + n) / 2, lng = (w + e) / 2
  const z = Math.max(9, Math.min(14, Math.log2(Math.min(360 * 900 / 512 / Math.max(e - w, 1e-3), 180 * 600 / 512 / Math.max((n - s) / Math.cos((lat * Math.PI) / 180), 1e-3)))))
  return `/shoreline?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}&z=${z.toFixed(2)}`
}

export default function ShorelineReport() {
  const [island, setIsland] = useState(readIsland)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    fetch('/shoreline-data/report-counts.json').then((x) => (x.ok ? x.json() : Promise.reject(new Error(`HTTP ${x.status}`)))).then(setData).catch((e) => setErr(e.message))
  }, [])
  // An island name the data doesn't have is ignored
  const isl = data && island && !data.islands.includes(island) ? '' : island
  useEffect(() => {
    window.history.replaceState(null, '', `${window.location.pathname}${isl ? `?i=${encodeURIComponent(isl)}` : ''}${window.location.hash}`)
    document.title = `Shoreline data${isl ? ` · ${isl}` : ''} · San Juan County · Shoreline Ecosystems · EarthAtlas`
  }, [isl])
  const pick = (i) => { setIsland(i); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  const d = data ? (isl ? data.byIsland[isl] : data.all) : null
  const all = data?.all
  const where = isl ? `${isl}${isl === 'Other islands' ? '' : ' Island'}` : 'All of San Juan County'
  const structures = d ? (d.docks || 0) + (d.buoys || 0) + (d.ramps || 0) + (d.railways || 0) + (d.groins || 0) + (d.pilings || 0) : 0
  const label = isl || ''

  // Only what the map's left-hand nav lists, plus summaries of those layers (Josh 2026-11-09), under the nav's names and in its order.
  const habitatRows = [
    { key: 'kelp_acres', name: 'Bull Kelp', unit: 'acres', fmt: tenth, color: KELP, kind: 'area', src: <FriendsSrc />, sub: (x) => `${whole(x.kelp_beds)} beds` },
    { key: 'eelgrass_mi', name: 'Deepwater/Edge Eelgrass', unit: 'miles', fmt: tenth, color: EELGRASS, kind: 'line', src: <FriendsSrc /> },
  ]
  const forageRows = [
    { key: 'herring_acres', name: 'Herring spawning grounds', unit: 'acres', color: FORAGE_COLOR.herring, kind: 'area', src: <FriendsSrc />,
      sub: (x) => (x.herring_grounds === 1 ? 'part of 1 spawning ground' : `${isl ? 'parts of ' : ''}${whole(x.herring_grounds)} spawning grounds`) },
    { key: 'fdoc_mi', name: 'Smelt & sand lance — documented beaches', unit: 'miles', fmt: tenth, color: FORAGE_COLOR.fdoc, kind: 'line', src: <FriendsSrc />, sub: (x) => `${whole(x.fdoc_beaches)} beaches with eggs found` },
    { key: 'fpot_mi', name: 'Smelt & sand lance — potential habitat', unit: 'miles', fmt: tenth, color: FORAGE_COLOR.fpot, kind: 'line', src: <FriendsSrc /> },
  ]
  const modRows = [
    { key: 'armor_mi', name: 'Shoreline Armor (2019 survey)', unit: 'miles', fmt: tenth, pin: 'armor', src: <FriendsSrc />, sub: (x) => `${whole(x.armor_pieces)} mapped pieces` },
    { key: 'docks', name: 'Docks', unit: '', pin: 'dock', src: <FriendsSrc /> },
    { key: 'buoys', name: 'Mooring Buoys & Floats', unit: '', pin: 'buoy', src: <FriendsSrc /> },
    { key: 'ramps', name: 'Boat Ramps', unit: '', pin: 'ramp', src: <FriendsSrc /> },
    { key: 'railways', name: 'Marine Railways', unit: '', pin: 'railway', src: <FriendsSrc /> },
    { key: 'groins', name: 'Groins', unit: '', pin: 'groin', src: <FriendsSrc /> },
    { key: 'pilings', name: 'Pilings', unit: '', pin: 'piling', src: <FriendsSrc /> },
  ]
  const propertyRows = [
    { key: 'parcels', name: 'Properties', unit: '', color: PARCEL, kind: 'area', src: <Src href={COUNTY_PARCELS_URL} title="San Juan County GIS">County parcels</Src>, sub: (x) => `${whole(x.parcel_acres)} acres` },
    { key: 'waterfront_parcels', name: 'Properties with waterfront', unit: '', color: PARCEL, kind: 'area', src: <Src href={ASSESSOR_URL} title="San Juan County Assessor">Assessor</Src>, sub: () => 'a waterfront length on the Assessor’s roll' },
    { key: 'buildings', name: 'Building Footprints', unit: '', color: BUILDING, kind: 'area', src: <Src href={COUNTY_BUILDINGS_URL} title="San Juan County GIS">County buildings</Src>, sub: (x) => `${whole(x.building_sqft)} sq ft under roof` },
  ]

  return (
    <ChartTipProvider>
    <div className={c.page}>
      <header className={c.top}>
        {/* Friends of the San Juans data: their logo on every host (Friends logo rule) */}
        <DocBrand tool="Shoreline Ecosystems" href="/shoreline" brand={FRIENDS_BRAND} />
        <span className={r.topRight}>
          {/* "Other islands" are scattered across the county: the map's own default view */}
          <a className={r.mapBtn} href={mapHref(isl && isl !== 'Other islands' && data?.bbox?.[isl])}>Open {isl && isl !== 'Other islands' ? `${isl} ` : ''}on the map</a>
          <button className={c.print} onClick={() => window.print()} disabled={!d} aria-label="Print or save as PDF">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" />
            </svg>
            <span className={r.printLbl}>Print or save as PDF</span>
          </button>
        </span>
      </header>
      <main className={c.main}>
        <div className={c.kicker}>San Juan County, Washington · shoreline data</div>
        <h1 className={c.title}>What’s mapped on {isl ? `${where}’s` : 'the islands’'} shores</h1>
        <p className={c.lede}>
          Everything the <a className={c.src} href="/shoreline">Shoreline Ecosystems map</a> shows, counted: kelp, eelgrass and forage fish
          habitat, priority shorelines for fish, shoreforms and shoreline modifications mapped by <FriendsSrc /> and its partners, with
          the County’s <Src href={COUNTY_PARCELS_URL} title="San Juan County GIS">tax parcels</Src> and <Src href={COUNTY_BUILDINGS_URL} title="San Juan County GIS">building footprints</Src>.
        </p>

        <div className={`${c.controls} ${r.filter}`}>
          <span className={r.filterLbl}>Island</span>
          <span className={r.chips}>
            <button type="button" className={!isl ? r.chipOn : r.chip} onClick={() => setIsland('')}>All islands</button>
            {data?.islands.map((x) => <button key={x} type="button" className={isl === x ? r.chipOn : r.chip} onClick={() => setIsland(x)}>{x}</button>)}
          </span>
        </div>

        <dl className={c.facts}>
          <div><dt>Showing</dt><dd>{where}</dd></div>
          <div><dt>Shoreline data</dt><dd><FriendsSrc /></dd></div>
          {data && <div><dt>Parcels and buildings</dt><dd><Src href={COUNTY_PARCELS_URL} title="San Juan County GIS">San Juan County GIS</Src>, {data.parcelsFetched}</dd></div>}
          {data && <div><dt>Counted</dt><dd>{data.built} · <How /></dd></div>}
        </dl>

        {err && <div className={c.error}>Couldn’t load the shoreline counts ({err}).</div>}
        {!d && !err && <div className={c.loading}>Loading…</div>}
        {d && <>
          <div className={c.tiles}>
            <div className={c.tile}>
              <div className={c.tileValue}>{whole(d.shore_mi)}</div>
              <div className={c.tileLabel}>miles of shoreline mapped</div>
              <div className={c.tileSub}>classified into shoreforms{isl ? `: ${pct(d.shore_mi / all.shore_mi)} of the county’s ${whole(all.shore_mi)}` : ''}</div>
              <div className={c.tileSrc}>Source: <FriendsSrc /> shoreform mapping</div>
            </div>
            <div className={c.tile}>
              <div className={c.tileValue} style={{ color: '#8a6d1f' }}>{whole(d.kelp_acres)}</div>
              <div className={c.tileLabel}>acres of bull kelp</div>
              <div className={c.tileSub}>in {whole(d.kelp_beds)} canopy beds</div>
              <div className={c.tileSrc}>Source: Washington DNR and <FriendsSrc /></div>
            </div>
            <div className={c.tile}>
              <div className={c.tileValue} style={{ color: ARMOR }}>{tenth(d.armor_mi || 0)}</div>
              <div className={c.tileLabel}>miles of armored shoreline</div>
              <div className={c.tileSub}>{d.shore_mi ? `${pct((d.armor_mi || 0) / d.shore_mi)} of the mapped shoreline` : ''}</div>
              <div className={c.tileSrc}>Source: <FriendsSrc /> armor survey (2019)</div>
            </div>
            <div className={c.tile}>
              <div className={c.tileValue}>{whole(structures)}</div>
              <div className={c.tileLabel}>docks, buoys and other structures</div>
              <div className={c.tileSub}>{whole(d.docks)} docks · {whole(d.buoys)} mooring buoys and floats</div>
              <div className={c.tileSrc}>Source: <FriendsSrc /> shoreline inventory</div>
            </div>
          </div>

          <div className={c.card}>
            <div className={c.cardHead}><h2 className={c.h2}>Bull Kelp and Deepwater/Edge Eelgrass</h2><span className={c.note}>{where}</span></div>
            <Rows rows={habitatRows} d={d} all={all} island={label} />
            <div className={c.hint}>Kelp: Washington DNR and Friends · eelgrass: Friends, DNR and Friday Harbor Labs · <How /></div>
          </div>

          <div className={c.card}>
            <div className={c.cardHead}><h2 className={c.h2}>Properties and Building Footprints</h2><span className={c.note}>{where}</span></div>
            <Rows rows={propertyRows} d={d} all={all} island={label} />
            <div className={c.hint}>Source: <Src href={COUNTY_PARCELS_URL} title="San Juan County GIS">San Juan County parcels</Src> and <Src href={COUNTY_BUILDINGS_URL} title="San Juan County GIS">building footprints</Src>, downloaded {data.parcelsFetched} · <How /></div>
          </div>

          <div className={c.card}>
            <div className={c.cardHead}><h2 className={c.h2}>Priority Shorelines for Fish</h2><span className={c.note}>{where} · miles of shoreline at each level</span></div>
            <FishLevels d={d} where={label || 'San Juan County'} />
            <div className={c.hint}>Beamer &amp; Fresh 2012, Skagit River System Cooperative (high-resolution model), in Friends of the San Juans’ three levels. Nothing is ranked low. Source: <Src href={FISH_USE_URL} title="San Juan County map service">County map service</Src> · <How /></div>
          </div>

          <div className={c.card}>
            <div className={c.cardHead}><h2 className={c.h2}>Forage Fish Spawning</h2><span className={c.note}>{where}</span></div>
            <Rows rows={forageRows} d={d} all={all} island={label} />
            <div className={c.hint}>Herring: WDFW, compiled by Friends · smelt and sand lance: Friends egg surveys with WDFW records · <How /></div>
          </div>

          <div className={c.card}>
            <div className={c.cardHead}><h2 className={c.h2}>Shoreline Geology: Shoreforms</h2><span className={c.note}>{where} · {tenth(d.shore_mi)} miles</span></div>
            <Shoreforms d={d} where={label || 'San Juan County'} />
            <div className={c.hint}>Source: <FriendsSrc /> geomorphic shoreform mapping · what each shoreform means: <Src href={GUIDE_URL} title="Living with the Shoreline">Living with the Shoreline</Src></div>
          </div>

          <div className={c.card}>
            <div className={c.cardHead}><h2 className={c.h2}>Shoreline Modifications</h2><span className={c.note}>{where}</span></div>
            <Rows rows={modRows} d={d} all={all} island={label} />
            <div className={c.hint}>Source: <FriendsSrc /> Inventory of Shoreline Modifications (2010) and 2019 countywide armor survey · <How /></div>
          </div>

          {!isl && <ByIsland data={data} onPick={pick} />}

          <div className={c.card} id="how">
            <div className={c.cardHead}><h2 className={c.h2}>How this is counted</h2></div>
            <ul className={r.how}>
              <li><b>The data:</b> the same files the <a className={c.src} href="/shoreline">Shoreline Ecosystems map</a> draws: <FriendsSrc /> habitat, shoreform and shoreline-modification layers, the <Src href={FISH_USE_URL} title="County map service">priority shorelines for fish</Src> model, and the County’s <Src href={COUNTY_PARCELS_URL} title="San Juan County GIS">parcels</Src> and <Src href={COUNTY_BUILDINGS_URL} title="San Juan County GIS">building footprints</Src> ({data.parcelsFetched}).</li>
              <li><b>Islands:</b> each tax parcel’s island comes from its <Src href={ASSESSOR_URL} title="San Juan County Assessor">Assessor</Src> district, as in the <a className={c.src} href="/risks/reports/land-value">sea-level rise land report</a>. Parcels that touch or nearly touch (within 15 m) make one land mass, named by the district most of its area is in. “Other islands” are the smaller islands the Assessor groups together.</li>
              <li><b>Which island a feature counts toward:</b> the nearest land mass. Docks, buoys and other structures by their own point; kelp beds by a point inside each bed; shorelines, eelgrass edges and beaches cut into pieces of at most 20 m, each piece counted at its nearest island, so a line that runs past two islands is split between them; herring spawning grounds by a 50 m grid of points inside each ground, so their acres split the same way. Island numbers add up to the county total.</li>
              <li><b>Properties with waterfront:</b> parcels with a waterfront length on the Assessor’s roll.</li>
              <li><b>Lengths and areas:</b> measured by EarthAtlas in UTM zone 10N from the mapped shapes. Kelp acres are the canopy bed outlines.</li>
              <li><b>Priority levels:</b> each shoreline segment’s model score for each species, in the levels the map uses (the countywide salmon recovery prioritization’s bins). “Highest of all seven species” is each segment’s highest level for any species.</li>
            </ul>
          </div>
        </>}
        <BuiltByCredit variant="light" className={c.builtBy} />
      </main>
    </div>
    </ChartTipProvider>
  )
}
