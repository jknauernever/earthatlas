// The card at top right of /spills: one NRC report (as reported, where it was placed and why, the ESI shoreline and
// species near it), a list of reports (a 5 km hotspot cell, or several reports at one spot), or one ESI shoreline class.
// Every value carries its own source link.
import { useEffect, useState } from 'react'
import s from './SpillsApp.module.css'
import pick from '../ships/ShipPicker.module.css'   // the ship card's tab row, shared
import {
  NRC_HOME, ESI_HOME, WBD, PRECISION_BY_ID, esiShort, esiSentence, esiLevel, esiColor, esiNumber, isListed, locationSource, fmtDate, fmtInt, titleCase, nearbyHighlights, statusShort, statusFull, speciesHref, critNear, chStatus, chSrcShort, gapOf, PA_COLOR, MANAGER, ACCESS, PADUS_HOME, PADUS_DATA,
  PHMSA_HOME, PIPE_COLOR, COMMODITY_PLAIN, bblText, pipeDetailUrl, gasDetailUrl, mcfText, GAS_SYSTEM,
} from './spillsShared.js'
import { padusLabel, padusKind } from '../lib/national/padus.js'

const ext = { target: '_blank', rel: 'noopener noreferrer' }
const Src = ({ href, title, children }) => <a className={s.src} href={href} title={title} {...ext}>{children} ↗</a>

// What to call a protected area: PAD-US's name, or what it is when that name is a placeholder or code (padusLabel).
export const areaName = (a) => padusLabel(a).name

// The card's tabs: every card opens on its first tab (the report); a tab chosen stays while that card is open.
function useCardTab(ids) {
  const [tab, setTab] = useState(ids[0])
  return [ids.includes(tab) ? tab : ids[0], setTab]
}
function Tabs({ tabs, tab, onTab }) {
  return (
    <div className={pick.tabs} role="tablist">
      {tabs.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} className={`${pick.tab} ${tab === id ? pick.tabOn : ''}`} onClick={() => onTab(id)}>{label}</button>
      ))}
    </div>
  )
}

function Row({ label, children }) {
  if (children == null || children === '' || children === false) return null
  return <><dt>{label}</dt><dd>{children}</dd></>
}

export const EXPOSURE_NOTE = 'Unverified initial report to the National Response Center. Exposure is what lies near the reported location, not measured impact.'

function SpeciesName({ sp }) {
  const href = speciesHref(sp)
  return href ? <a className={s.spLink} href={href} target="_blank" rel="noopener noreferrer" title={`${sp.txn} on EarthAtlas`}>{sp.n}</a> : <span>{sp.n}</span>
}

export function SpeciesList({ ids, species, radiusKm }) {
  const [showOther, setShowOther] = useState(false)
  const all = ids.map((i) => species[i])
  const fed = all.filter((sp) => sp.fed).sort((a, b) => a.n.localeCompare(b.n))
  const state = all.filter((sp) => !sp.fed && Object.keys(sp.st).length).sort((a, b) => a.n.localeCompare(b.n))
  const other = all.filter((sp) => !isListed(sp)).sort((a, b) => a.g.localeCompare(b.g) || a.n.localeCompare(b.n))
  const esiSrc = <Src href={ESI_HOME} title="NOAA Lake Michigan ESI 2025: biological resources and their listing status">NOAA ESI</Src>
  if (!all.length) return <div className={s.dim}>No ESI biological resources mapped within {radiusKm} km. {esiSrc}</div>
  const list = (rows, withStatus) => (
    <ul className={s.spList}>
      {rows.map((sp) => (
        <li key={`${sp.n}|${sp.g}`}>
          <SpeciesName sp={sp} /> <span className={s.dim}>{sp.g}</span>
          {withStatus && <div className={s.spStatus}>{statusFull(sp)}</div>}
        </li>
      ))}
    </ul>
  )
  return (
    <>
      <div className={s.cardMeta}>ESI biological resources mapped within {radiusKm} km: {all.length} · {esiSrc}</div>
      {fed.length > 0 && <><div className={s.cardSub}>Federally listed ({fed.length})</div>{list(fed, true)}</>}
      {state.length > 0 && <><div className={s.cardSub}>State listed ({state.length})</div>{list(state, true)}</>}
      {other.length > 0 && (
        <>
          <button type="button" className={s.cardSubBtn} onClick={() => setShowOther((v) => !v)} aria-expanded={showOther}>
            Other mapped resources ({other.length}) {showOther ? '▴' : '▾'}
          </button>
          {showOther && list(other, false)}
        </>
      )}
    </>
  )
}

// The top of a report card: the shoreline and listed species that could be harmed, in one glance.
// A list that shows everything; past 12 items it starts at 10 with a "Show all" link (nothing is ever hidden for good).
function FullList({ items, render, className }) {
  const [all, setAll] = useState(false)
  const shown = all || items.length <= 12 ? items : items.slice(0, 10)
  return <>
    <ul className={className}>{shown.map(render)}</ul>
    {shown.length < items.length && <button type="button" className={s.moreBtn} onClick={() => setAll(true)}>Show all {items.length}</button>}
  </>
}

function AtRisk({ p, species, areas, onArea, chSpecies = [] }) {
  const crit = critNear(p, chSpecies)
  const hasEsi = species.length > 0
  const h = nearbyHighlights(p.sp || [], species)
  // most strongly protected first, then nearest
  const pa = [...(p.pa || [])].sort((x, y) => (+areas[x[0]].gap || 4) - (+areas[y[0]].gap || 4) || x[1] - y[1])
  return (
    <div className={s.atRisk}>
      <div className={s.atRiskTitle}>What could be harmed within {p.r / 1000} km</div>
      {p.e && <div className={s.atRiskLine}><span className={s.esiSwatch} style={{ background: esiColor(p.e) }} /><b>{esiShort(p.e)}</b> shoreline: {esiLevel(p.e).toLowerCase()} by oil</div>}
      {h.listed.length > 0
        ? <FullList className={s.atRiskList} items={h.listed} render={(sp) => <li key={sp.n}><b><SpeciesName sp={sp} /></b> <span className={s.spStatusInline}>{statusShort(sp, p.st)}</span></li>} />
        : hasEsi && <div className={s.atRiskLine}>No state- or federally-listed species mapped here.</div>}
      {hasEsi && <div className={s.dim}>
        {h.other} other mapped wildlife and habitat areas · <Src href={ESI_HOME} title="NOAA Lake Michigan ESI 2025: biological resources and shoreline">NOAA ESI</Src>
      </div>}
      {crit.length > 0 && <>
        <div className={s.atRiskSub}>Critical habitat ({crit.length})</div>
        <FullList className={s.atRiskList} items={crit} render={({ sp, m }) => (
            <li key={sp.n}>
              {(speciesHref(sp) || sp.url) ? <a className={s.spLink} href={speciesHref(sp) || sp.url} target="_blank" rel="noopener noreferrer" title={speciesHref(sp) ? `${sp.txn} on EarthAtlas` : `${sp.sci} · ${sp.src}`}><b>{sp.n}</b></a> : <b>{sp.n}</b>}{' '}
              <span className={s.spStatusInline}>{chStatus(sp)}</span>{' '}
              {speciesHref(sp) && sp.url && <Src href={sp.url} title={`${sp.sci}: species profile, ${sp.src}`}>{chSrcShort(sp)}</Src>}{' '}
              <span className={s.dim}>{m === 0 ? 'report is inside' : `${m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`} away`}</span>
            </li>
          )} />
        <div className={s.dim}>Habitat the law protects for listed species · <Src href="https://ecos.fws.gov/ecp/report/table/critical-habitat.html" title="U.S. Fish and Wildlife Service critical habitat (ECOS)">FWS</Src> <Src href="https://www.fisheries.noaa.gov/resource/map/national-esa-critical-habitat-mapper" title="NOAA Fisheries ESA critical habitat">NOAA Fisheries</Src></div>
      </>}
      {pa.length > 0 && <>
        <div className={s.atRiskSub}>Protected areas ({pa.length})</div>
        <FullList className={s.atRiskList} items={pa} render={([i, d]) => {
            const a = areas[i]
            return (
              <li key={i}>
                <span className={s.paSwatch} style={{ background: PA_COLOR }} />
                <button type="button" className={s.paLink} onClick={() => onArea(i)}>{areaName(a)}</button>{' '}
                <span className={s.dim}>{padusKind(a) || 'Protected area'}{d === 0 ? ', report is inside' : `, ${d < 1000 ? `${d} m` : `${(d / 1000).toFixed(1)} km`} away`}</span>
              </li>
            )
          }} />
        <div className={s.dim}><Src href={PADUS_HOME} title="USGS Protected Areas Database of the United States (PAD-US) 4.1">USGS PAD-US</Src></div>
      </>}
    </div>
  )
}

export function ReportCard({ p, species, areas, esiNames, onClose, onBack, onArea, pipe, onPipe, chSpecies }) {
  const prec = PRECISION_BY_ID[p.loc]
  const ls = p.loc ? locationSource(p) : null
  const nrc = <Src href={NRC_HOME} title={`National Response Center (U.S. Coast Guard), report ${p.seq}, from its public incident data`}>NRC</Src>
  const crit = critNear(p, chSpecies || [])
  const listedN = new Set((p.sp || []).filter((i) => species[i] && isListed(species[i])).map((i) => species[i].n)).size
  const harmN = listedN + crit.length + (p.pa || []).length
  const hasNext = !!pipe || p.dups?.length > 0
  const [tab, setTab] = useCardTab(['report', ...(hasNext ? ['next'] : []), 'harm'])
  const amount = p.g != null ? `${fmtInt(Math.round(p.g * 10) / 10)} gallon${p.g === 1 ? '' : 's'}` : 'not given'
  return (
    <div className={s.card}>
      <button type="button" className={s.close} onClick={onClose} aria-label="Close">×</button>
      {onBack && <button type="button" className={s.back} onClick={onBack}>← Back to the list</button>}
      <div className={s.cardTitle}>NRC report {p.seq}</div>
      <div className={s.cardMeta}>{fmtDate(p.d)}{p.city ? ` · ${p.city}, ${p.st}` : ''} · {nrc}</div>
      <div className={s.cardSummary}>{p.m.length ? titleCase(p.m[0]) : 'Material not given'} · {p.g != null ? amount : 'amount not given'}{p.w ? ` · ${titleCase(p.w)}` : ''}</div>
      <Tabs tab={tab} onTab={setTab} tabs={[['report', 'The report'], ...(hasNext ? [['next', 'What happened next']] : []), ['harm', `What could be harmed${harmN ? ` · ${harmN}` : ''}`]]} />

      {tab === 'harm' && (p.loc ? <>
        <AtRisk p={p} species={species} areas={areas} onArea={onArea} chSpecies={chSpecies} />
        {species.length > 0 && <>
          <div className={s.cardSub}>Most easily harmed shoreline within {p.r / 1000} km</div>
          {p.e ? (
            <div className={s.cardText}>
              <span className={s.esiSwatch} style={{ background: esiColor(p.e) }} /><b>{esiShort(p.e)}</b> · {esiLevel(p.e)} by oil ({esiNumber(p.e)} of 10)
              <div>{esiSentence(p.e)}</div>
              <div className={s.dim}>NOAA term: {p.e} {esiNames[p.e] || ''} <Src href={ESI_HOME} title="NOAA Lake Michigan ESI 2025, shoreline classification (ESIL)">NOAA ESI</Src></div>
              {p.en && <div className={s.dim}>Nearest shoreline: {esiShort(p.en[0].split('/')[0])}, {p.en[1] < 1000 ? `${p.en[1]} m` : `${(p.en[1] / 1000).toFixed(1)} km`} away</div>}
            </div>
          ) : <div className={s.dim}>No ESI shoreline mapped within {p.r / 1000} km. <Src href={ESI_HOME}>NOAA ESI</Src></div>}
          <div className={s.cardSub}>All wildlife and habitats mapped nearby</div>
          <SpeciesList ids={p.sp || []} species={species} radiusKm={p.r / 1000} />
        </>}
      </> : <div className={s.cardText}>No location could be read from this report, so nothing nearby could be checked.</div>)}

      {tab === 'report' && <>
        <div className={s.noteSmall}>Unverified initial report to the National Response Center: what the caller said, not a confirmed spill.</div>
      <dl className={s.dl}>
        <Row label="Material">{p.m.length ? p.m.map(titleCase).join('; ') : 'not given'}</Row>
        <Row label="Amount">{amount}</Row>
        <Row label="Incident type">{p.t}</Row>
        <Row label="Cause">{p.c}</Row>
        <Row label="Medium">{p.med}</Row>
        <Row label="Water body">{p.w ? titleCase(p.w) : null}{p.trib ? ` (tributary of ${titleCase(p.trib)})` : ''}</Row>
        <Row label="Sheen">{p.sheen}</Row>
        <Row label="Location as reported">{[p.il, p.addr].filter(Boolean).join(' · ') || null}</Row>
        <Row label="Potential release">{p.pot ? 'Yes (the report describes a potential release)' : null}</Row>
        <Row label="Reported">{fmtDate(p.rec)}</Row>
      </dl>
      {p.desc && <div className={s.desc}>“{p.desc}” <span className={s.dim}>(caller’s description)</span> {nrc}</div>}

      <div className={s.cardSub}>Where it is on the map</div>
      {p.loc ? (
        <div className={s.cardText}>
          <span className={s.precBadge} data-g={prec.id}>{prec.label}</span> {p.how} · <Src href={ls.href} title={ls.title}>{ls.label}</Src>
        </div>
      ) : <div className={s.cardText}>No location could be read from this report; it is not on the map.</div>}
      {p.match === 'water' || (p.match === 'drain' && !p.e && !p.sp)
        ? <div className={s.cardText}>Included because the caller reported it reached {p.match === 'drain' ? 'a storm drain or sewer' : 'water'} ({nrc})</div>
        : <div className={s.cardText}>
        Matched to Lake Michigan {p.match === 'named'
          ? <>because the report names a Lake Michigan water ({nrc})</>
          : <>because it reached {p.match === 'drain' ? 'a storm drain or sewer' : 'water'} inside the Lake Michigan basin (<Src href={WBD} title="USGS Watershed Boundary Dataset, HU4 0403–0406, with NOAA ESI mapped water">USGS WBD + NOAA ESI</Src>)</>}
      </div>}
      </>}

      {tab === 'next' && <>
      {pipe && (
        <div className={s.pipeBox}>
          <div className={s.pipeTitle}>The pipeline operator’s accident report</div>
          <div><b>{bblText(pipe.bbl)}</b> released{pipe.rec != null ? `, ${bblText(pipe.rec).split(' (')[0]} recovered` : ''} · {pipe.o}</div>
          <button type="button" className={s.paLink} onClick={() => onPipe(pipe.id)}>Open PHMSA report {pipe.id}</button>{' '}
          <Src href={PHMSA_HOME} title="PHMSA hazardous liquid pipeline accident reports">PHMSA</Src>
        </div>
      )}
        {p.dups?.length > 0 && <div className={s.cardText}>The same spill was also reported to the NRC as report {p.dups.join(', ')}.</div>}
      </>}
    </div>
  )
}

export function ListCard({ title, meta, points, onPick, onClose, children }) {
  const rows = [...points].sort((a, b) => (b.d || '').localeCompare(a.d || ''))
  return (
    <div className={s.card}>
      <button type="button" className={s.close} onClick={onClose} aria-label="Close">×</button>
      <div className={s.cardTitle}>{title}</div>
      {meta && <div className={s.cardMeta}>{meta}</div>}
      <div className={s.note}>{EXPOSURE_NOTE}</div>
      {children}
      <div className={s.cardSub}>Reports ({rows.length}) <Src href={NRC_HOME} title="National Response Center FOIA files">NRC</Src></div>
      <ul className={s.reportList}>
        {rows.map((p) => (
          <li key={p.seq}>
            <button type="button" onClick={() => onPick(p.seq)}>
              <span className={s.precDot} data-g={PRECISION_BY_ID[p.loc]?.group} />
              <span className={s.rlDate}>{fmtDate(p.d)}</span>
              <span className={s.rlText}>{p.m.length ? titleCase(p.m[0]) : 'Material not given'}{p.g != null ? ` · ${fmtInt(Math.round(p.g))} gal` : ''}</span>
              <span className={s.dim}>{p.city}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AreaCard({ a, onClose, onBack }) {
  const g = gapOf(a)
  // PAD-US gives the manager as an agency name or a short code ("CNTY"); the local manager name is clearer when there is one
  const known = (v) => (v && !/^unknown$/i.test(v) && !/^[A-Z]{2,6}$/.test(v) ? v : '')
  const { office } = padusLabel(a)
  const manager = [known(a.lm) || a.agency || known(a.mn), office].filter(Boolean).join(', ')
  const localDes = a.ld && /\s/.test(a.ld) && a.ld !== a.d ? a.ld : ''
  return (
    <div className={s.card}>
      <button type="button" className={s.close} onClick={onClose} aria-label="Close">×</button>
      {onBack && <button type="button" className={s.back} onClick={onBack}>← Back</button>}
      <div className={s.cardTitle}><span className={s.paSwatch} style={{ background: PA_COLOR }} />{areaName(a)}</div>
      <div className={s.cardMeta}>{padusKind(a) || 'Protected area'}{localDes ? ` (${localDes})` : ''} · <Src href={PADUS_HOME} title="USGS Protected Areas Database of the United States (PAD-US) 4.1">USGS PAD-US</Src></div>
      <dl className={s.dl}>
        <dt>Protection</dt><dd>{g.label}</dd>
        <dt>Managed by</dt><dd>{MANAGER[a.mt] || a.mt}{manager ? `: ${manager}` : ''}</dd>
        <dt>Public access</dt><dd>{ACCESS[a.acc] || ACCESS.UK}</dd>
        {a.ac > 0 && <><dt>Size</dt><dd>{fmtInt(a.ac)} acre{a.ac === 1 ? '' : 's'}</dd></>}
        <dt>Source</dt><dd>USGS Protected Areas Database (PAD-US 4.1) <Src href={PADUS_DATA} title={`PAD-US 4.1 state downloads (ScienceBase)${a.src ? `; contributed by ${a.src}` : ''}${a.sd ? `, ${a.sd}` : ''}`}>data</Src></dd>
      </dl>
    </div>
  )
}

// One pipeline accident as its operator reported it to PHMSA. The full record (cause, narrative, costs) is fetched per
// year when the card opens.
const detailYears = new Map()
function useDetail(a, urlFor) {
  const [d, setD] = useState(null)
  useEffect(() => {
    let live = true
    setD(null)
    const url = urlFor(a.y)
    if (!detailYears.has(url)) detailYears.set(url, fetch(url).then((r) => r.json()).catch(() => ({})))
    detailYears.get(url).then((all) => { if (live) setD(all[a.id] || {}) })
    return () => { live = false }
  }, [a.id, a.y, urlFor])
  return d
}
const money = (v) => (v ? `$${Math.round(v).toLocaleString('en-US')}` : null)

export function PipeCard({ a, exposure, species, areas, nrcOnMap, onClose, onBack, onArea, onReport }) {
  const d = useDetail(a, pipeDetailUrl)
  const src = <Src href={PHMSA_HOME} title={`PHMSA hazardous liquid accident report ${a.id}`}>PHMSA</Src>
  const where = a.wh || [a.city, a.county ? `${a.county} County` : '', a.st].filter(Boolean).join(', ')
  const harms = [a.fat ? `${a.fat} killed` : '', a.inj ? `${a.inj} injured` : '', a.fire ? 'caught fire' : '', a.boom ? 'exploded' : '',
    a.water ? 'reached water' : '', a.drink ? 'reached drinking water' : '', a.wild ? 'harmed wildlife' : ''].filter(Boolean)
  return (
    <div className={s.card}>
      <button type="button" className={s.close} onClick={onClose} aria-label="Close">×</button>
      {onBack && <button type="button" className={s.back} onClick={onBack}>← Back</button>}
      <div className={s.cardTitle}><span className={s.pipeDot} />Pipeline accident · {a.o}</div>
      <div className={s.cardMeta}>{fmtDate(a.d)}{where ? ` · ${where}` : ''}{a.off ? ' · offshore' : ''}{a.k === 'gathering' ? ' · gathering or gravity line' : ''} · {src}</div>
      <div className={s.atRisk}>
        <div className={s.atRiskLine}><b>{bblText(a.bbl)}</b> of {(COMMODITY_PLAIN[a.c] || 'material').toLowerCase()} released</div>
        {a.rec != null && <div className={s.atRiskLine}>{bblText(a.rec)} recovered</div>}
        {harms.length > 0 && <div className={s.atRiskLine}>The operator reports it {harms.join(', ')}.</div>}
      </div>
      <div className={s.cardSub}>The operator’s report</div>
      <dl className={s.dl}>
        <Row label="Material">{COMMODITY_PLAIN[a.c]}{a.sub ? ` · ${a.sub}` : ''}{d?.cdet ? ` · ${d.cdet}` : ''}</Row>
        <Row label="Cause">{d?.cause}{d?.cause_d ? ` · ${d.cause_d}` : ''}</Row>
        <Row label="Pipeline">{[...new Set([d?.fac, d?.seg].filter(Boolean))].join(' · ')}</Row>
        <Row label="Water">{d?.wn}</Row>
        <Row label="Cleanup cost">{money(d?.cost_env)}</Row>
        <Row label="Emergency cost">{money(d?.cost_em)}</Row>
        <Row label="Property damage">{money(d?.cost_prop)}</Row>
        <Row label="NRC reports">{a.nrc.length ? a.nrc.map((n, k) => (
          <span key={n}>{k ? ', ' : ''}{nrcOnMap(n) ? <button type="button" className={s.paLink} onClick={() => onReport(n)}>{n}</button> : n}</span>
        )) : null}</Row>
        <Row label="PHMSA report">{a.k === 'gathering' ? `${a.id.slice(1)} (form F 7000-2, gathering and gravity lines)` : a.id}</Row>
      </dl>
      {d === null && <div className={s.dim}>Loading the full report…</div>}
      {d?.narr && <div className={s.desc}>“{d.narr}” <span className={s.dim}>(operator’s description)</span> {src}</div>}
      {exposure && <AtRisk p={{ ...exposure, st: a.st }} species={species} areas={areas} onArea={onArea} />}
    </div>
  )
}

// One gas pipeline incident (natural gas and other gases released to the air) as its operator reported it to PHMSA.
export function GasCard({ g, onClose, onBack }) {
  const d = useDetail(g, gasDetailUrl)
  const src = <Src href={PHMSA_HOME} title={`PHMSA gas incident report ${g.id.slice(1)}`}>PHMSA</Src>
  const where = g.wh || [g.city, g.county ? `${g.county} County` : '', g.st].filter(Boolean).join(', ')
  const harms = [g.fat ? `${g.fat} killed` : '', g.inj ? `${g.inj} injured` : '', g.evac ? `${fmtInt(g.evac)} people evacuated` : '',
    g.fire ? 'gas caught fire' : '', g.boom ? 'explosion' : ''].filter(Boolean)
  return (
    <div className={s.card}>
      <button type="button" className={s.close} onClick={onClose} aria-label="Close">×</button>
      {onBack && <button type="button" className={s.back} onClick={onBack}>← Back</button>}
      <div className={s.cardTitle}><span className={s.gasMark} />Gas pipeline incident · {g.o}</div>
      <div className={s.cardMeta}>{fmtDate(g.d)}{where ? ` · ${where}` : ''} · {GAS_SYSTEM[g.s]} · {src}</div>
      <div className={s.gasBox}>
        <div className={s.atRiskLine}>{g.mcf ? <><b>{mcfText(g.mcf)}</b> of {(g.gas || 'gas').toLowerCase()} released into the air</> : 'The operator reports no amount of gas released.'}</div>
        {harms.length > 0 && <div className={s.atRiskLine}>{harms.join(' · ')}</div>}
      </div>
      <div className={s.cardSub}>The operator’s report</div>
      <dl className={s.dl}>
        <Row label="Cause">{d?.cause}{d?.cause_d ? ` · ${d.cause_d}` : ''}</Row>
        <Row label="Pipeline">{[...new Set([d?.fac, d?.seg].filter(Boolean))].join(' · ')}</Row>
        <Row label="Planned release">{d?.planned ? `${mcfText(d.planned)} (released on purpose to make the line safe)` : null}</Row>
        <Row label="Cost of lost gas">{money(d?.cost_gas)}</Row>
        <Row label="Emergency cost">{money(d?.cost_em)}</Row>
        <Row label="Property damage">{money(d?.cost_prop)}</Row>
        <Row label="NRC reports">{g.nrc.length ? g.nrc.join(', ') : null}</Row>
        <Row label="PHMSA report">{g.id.slice(1)}</Row>
      </dl>
      {d === null && <div className={s.dim}>Loading the full report…</div>}
      {d?.narr && <div className={s.desc}>“{d.narr}” <span className={s.dim}>(operator’s description)</span> {src}</div>}
    </div>
  )
}

export function ShoreCard({ code, esi, esiNames, onClose }) {
  return (
    <div className={s.card}>
      <button type="button" className={s.close} onClick={onClose} aria-label="Close">×</button>
      <div className={s.cardTitle}><span className={s.esiSwatch} style={{ background: esiColor(code) }} />{esiShort(code)}</div>
      <div className={s.cardMeta}>{esiLevel(code)} by oil ({esiNumber(code)} of 10)</div>
      <div className={s.cardText}>{esiSentence(code)}</div>
      {esi.includes('/') && <div className={s.cardText}>This stretch also has: {esi.split('/').filter((c) => c !== code).map(esiShort).join(', ')}. The line takes the color of the most easily harmed one.</div>}
      <div className={s.cardMeta}>NOAA terms: {esi.split('/').map((c) => `${c} ${esiNames[c] || ''}`.trim()).join(' · ')} <Src href={ESI_HOME} title="NOAA Lake Michigan ESI 2025, shoreline classification (ESIL)">NOAA ESI</Src></div>
    </div>
  )
}
