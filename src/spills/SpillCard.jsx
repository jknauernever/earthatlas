// The card at top right of /spills: one NRC report (as reported, where it was placed and why, the ESI shoreline and
// species near it), a list of reports (a 5 km hotspot cell, or several reports at one spot), or one ESI shoreline class.
// Every value carries its own source link.
import { useState } from 'react'
import s from './SpillsApp.module.css'
import {
  nrcFile, NRC_HOME, ESI_HOME, WBD, PRECISION_BY_ID, esiShort, esiSentence, esiLevel, STATUS_WORD, STATE_NAMES, esiColor, esiNumber, isListed, locationSource, fmtDate, fmtInt, titleCase, nearbyHighlights, statusShort, spName,
} from './spillsShared.js'

const ext = { target: '_blank', rel: 'noopener noreferrer' }
const Src = ({ href, title, children }) => <a className={s.src} href={href} title={title} {...ext}>{children} ↗</a>

function Row({ label, children }) {
  if (children == null || children === '' || children === false) return null
  return <><dt>{label}</dt><dd>{children}</dd></>
}

export const EXPOSURE_NOTE = 'Unverified initial report to the National Response Center. Exposure is what lies near the reported location, not measured impact.'

export function statusText(sp) {
  const parts = []
  if (sp.fed) parts.push(`Federal ${STATUS_WORD[sp.fed] || sp.fed}`)
  for (const [st, code] of Object.entries(sp.st).sort()) parts.push(`${STATE_NAMES[st] || st} ${STATUS_WORD[code] || code}`)
  return parts.join(' · ')
}

function SpeciesName({ sp }) {
  return sp.masked
    ? <span title="The ESI gives this generic name in place of the species">“{sp.n}” <span className={s.dim}>(species not named in the ESI)</span></span>
    : <span>{sp.n}</span>
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
          {withStatus && <div className={s.spStatus}>{statusText(sp)}</div>}
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
function AtRisk({ p, species }) {
  const h = nearbyHighlights(p.sp || [], species)
  return (
    <div className={s.atRisk}>
      <div className={s.atRiskTitle}>What could be harmed within {p.r / 1000} km</div>
      {p.e && <div className={s.atRiskLine}><span className={s.esiSwatch} style={{ background: esiColor(p.e) }} /><b>{esiShort(p.e)}</b> shoreline: {esiLevel(p.e).toLowerCase()} by oil</div>}
      {h.listed.length > 0
        ? <ul className={s.atRiskList}>{h.listed.slice(0, 6).map((sp) => <li key={sp.n}><b>{spName(sp)}</b> <span className={s.spStatusInline}>{statusShort(sp, p.st)}</span></li>)}</ul>
        : <div className={s.atRiskLine}>No state- or federally-listed species mapped here.</div>}
      <div className={s.dim}>
        {h.listed.length > 6 ? `+${h.listed.length - 6} more listed · ` : ''}{h.other} other mapped wildlife and habitat areas · <Src href={ESI_HOME} title="NOAA Lake Michigan ESI 2025: biological resources and shoreline">NOAA ESI</Src>
      </div>
    </div>
  )
}

export function ReportCard({ p, species, esiNames, onClose, onBack }) {
  const prec = PRECISION_BY_ID[p.loc]
  const ls = p.loc ? locationSource(p) : null
  const nrc = <Src href={nrcFile(p.y)} title={`NRC FOIA file CY${String(p.y).slice(2)}.xlsx, report ${p.seq}`}>NRC</Src>
  const amount = p.g != null ? `${fmtInt(Math.round(p.g * 10) / 10)} gallon${p.g === 1 ? '' : 's'}` : 'not given'
  return (
    <div className={s.card}>
      <button type="button" className={s.close} onClick={onClose} aria-label="Close">×</button>
      {onBack && <button type="button" className={s.back} onClick={onBack}>← Back to the list</button>}
      <div className={s.cardTitle}>NRC report {p.seq}</div>
      <div className={s.cardMeta}>{fmtDate(p.d)}{p.city ? ` · ${p.city}, ${p.st}` : ''} · {nrc}</div>
      <div className={s.note}>{EXPOSURE_NOTE}</div>
      {p.loc && <AtRisk p={p} species={species} />}
      <div className={s.cardSub}>The report</div>
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
      {p.dups?.length > 0 && <div className={s.cardMeta}>Also reported as NRC {p.dups.join(', ')}</div>}

      <div className={s.cardSub}>Where it is on the map</div>
      {p.loc ? (
        <div className={s.cardText}>
          <span className={s.precBadge} data-g={prec.id}>{prec.label}</span> {p.how} · <Src href={ls.href} title={ls.title}>{ls.label}</Src>
        </div>
      ) : <div className={s.cardText}>No location could be read from this report; it is not on the map.</div>}
      <div className={s.cardText}>
        Matched to Lake Michigan {p.match === 'named'
          ? <>because the report names a Lake Michigan water ({nrc})</>
          : <>because it reached {p.match === 'drain' ? 'a storm drain or sewer' : 'water'} inside the Lake Michigan basin (<Src href={WBD} title="USGS Watershed Boundary Dataset, HU4 0403–0406, with NOAA ESI mapped water">USGS WBD + NOAA ESI</Src>)</>}
      </div>

      {p.loc && (
        <>
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
        </>
      )}
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
