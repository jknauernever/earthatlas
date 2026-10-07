/**
 * A terminal card's ESTIMATED months: visits estimated from Global Fishing Watch hourly positions for the picked months NOAA's AIS
 * doesn't cover (lib/ships/activityEstimates.js readTerminalEstimates; Josh 2026-10-06, docs/SHIPS_ACTIVITY_FUSION.md Part 2).
 * Kept apart from the counted calls: marked ≈, own source, shared visits on their own line, tugs not counted (said why).
 */
import { useState } from 'react'
import { MonthBars, About } from './PortCard.jsx'
import styles from './ShipsApp.module.css'

const fmtN = (n) => Number(n).toLocaleString('en-US')
const plural = (n, w, ws = `${w}s`) => `${fmtN(n)} ${n === 1 ? w : ws}`
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const dayName = (d) => (d ? new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '')
const rec = (id) => `/ships/source/${id}`
const GFW = 'https://globalfishingwatch.org'
const EST_HUE = '#a5b4fc'

const dayWords = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const dayShort = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/**
 * Bars per day, for a window of one or two months (Josh 2026-10-07: one bar per month says nothing then). days = [{ day, n, extra? }],
 * n null = no data that day (not zero). extra stacks on top in a lighter shade (visits shared with a neighbouring terminal).
 * Same look as PortCard's MonthBars (shared .pcBars styles).
 */
export function DayBars({ days, say, hue = EST_HUE, label, none = 'no data yet' }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(1e-9, ...days.map((d) => (d.n || 0) + (d.extra || 0)))
  const mid = days[Math.floor(days.length / 2)]
  return (
    <div className={styles.pcBars}>
      <div className={styles.pcBarsReadout} aria-live="polite">
        {hover ? <>{dayWords(hover.day)}: <strong>{hover.n == null ? none : say(hover.n, hover)}</strong></> : ' '}
      </div>
      <div className={styles.pcBarsRow} role="list" aria-label={label} style={{ gap: days.length > 40 ? 0 : 1 }}>
        {days.map((d) => (
          <div key={d.day} role="listitem" className={styles.pcBar} style={{ cursor: 'default', opacity: d.n == null ? 0.35 : 1 }}
            onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)} aria-label={`${dayWords(d.day)}: ${d.n == null ? none : say(d.n, d)}`}>
            <span style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', width: '100%', height: '100%' }}>
              {d.extra > 0 && <span className={styles.pcBarFill} style={{ height: `${(100 * d.extra) / max}%`, minHeight: 3, background: hue, opacity: 0.45, borderRadius: d.n ? '2px 2px 0 0' : undefined }} />}
              {d.n > 0 && <span className={styles.pcBarFill} style={{ height: `${(100 * d.n) / max}%`, minHeight: 3, background: hue, borderRadius: d.extra ? 0 : undefined }} />}
              {d.n == null && <span className={styles.pcBarFill} style={{ height: 2, background: 'rgba(255,255,255,0.25)' }} />}
            </span>
          </div>
        ))}
      </div>
      <div className={styles.pcBarsAxis}><span>{dayShort(days[0].day)}</span><span>{dayShort(mid.day)}</span><span>{dayShort(days[days.length - 1].day)}</span></div>
    </div>
  )
}

/** The source link for estimated numbers: the newest month's record, else Global Fishing Watch. */
export function EstSource({ e, label = 'estimated from hourly positions (Global Fishing Watch)' }) {
  const r = e?.records?.[e.records.length - 1]
  return (
    <a className={`${styles.sourceLink} ${styles.srcLink}`} href={r ? rec(r.recordId) : GFW} target="_blank" rel="noopener noreferrer"
      title="Estimated by EarthAtlas from one AIS position per ship per hour (Powered by Global Fishing Watch, CC BY-NC 4.0) — click for the month’s record (rule and inputs)">
      {label}</a>
  )
}

/**
 * "≈ N" for a KPI box, or null when no picked month is estimated. With visits shared with a neighbouring terminal it is a range,
 * "≈ credited–(credited + shared)" (Josh 2026-10-07: "≈0" read as no data when every stop could also be at the neighbour).
 */
export const estKpi = (e, key) => {
  if (!e || !e.estimatedMonths.length) return null
  const lo = key === 'ships' ? e.ships : e.visits
  const hi = key === 'ships' ? (e.shared.shipsWithShared ?? e.ships + e.shared.ships) : e.visits + e.shared.visits
  return hi > lo ? `≈${fmtN(lo)}–${fmtN(hi)}` : `≈${fmtN(lo)}`
}

export default function EstimatedVisits({ e, month, onMonth, onSelectVessel }) {
  if (!e) return null
  if (e.outsideArea) return (
    <div className={styles.section}>
      <div className={styles.legendNoteText}><strong>Estimated from hourly positions</strong> · not here yet: this terminal lies outside the area the
        hourly-position estimates cover. Not counted, not zero.</div>
    </div>
  )
  const span = `${monthName(e.months[0])} – ${monthName(e.months[e.months.length - 1])}`
  const r = e.rule || {}
  return (
    <div className={styles.section}>
      <div className={styles.legendNoteText}><strong>Estimated from hourly positions</strong> · {span}{e.through ? `, data through ${dayName(e.through)}` : ''}</div>
      {e.estimatedMonths.length > 0 && e.perDay && <DayBars days={e.perDay.map((d) => ({ ...d, extra: d.shared }))} label="Estimated visits per day by ships that fit this terminal (lighter: shared with a neighbouring terminal)"
        say={(n, d) => `≈ ${plural(n, 'visit')}${d?.extra ? ` + ≈ ${fmtN(d.extra)} shared` : ''}${d?.day?.endsWith('-01') ? ' (includes ships already here when the month began)' : ''}`} />}
      {e.estimatedMonths.length > 0 && !e.perDay && <MonthBars months={e.perMonth.map((m) => ({ ...m, extra: m.n == null ? 0 : m.shared }))} month={month} onMonth={onMonth}
        listed={false} hue={EST_HUE} say={(n, m) => `≈ ${plural(n, 'visit')}${m?.extra ? ` + ≈ ${fmtN(m.extra)} shared` : ''}`} none="not estimated yet"
        label="Estimated visits per month by ships that fit this terminal (lighter: shared with a neighbouring terminal)" />}
      {e.missing.length > 0 && <div className={styles.capNote}>Not estimated yet for {e.missing.length === e.months.length ? 'these months' : e.missing.map(monthName).join(', ')}: left out, not counted as zero.</div>}
      {e.estimatedMonths.length > 0 && <div className={styles.portSummary}>
        <strong>{estKpi(e, 'visits')} visits</strong> by {estKpi(e, 'ships').slice(1)} ships whose kind fits{e.visits > 0 && <> ({fmtN(e.hours)} h near the berth for those at this terminal alone)</>}{' '}
        <EstSource e={e} label="Global Fishing Watch" />
        {e.shared.visits > 0 && <div className={styles.legendNoteText}>
          + ≈ {plural(e.shared.visits, 'visit')} by {plural(e.shared.ships, 'ship')} at this terminal <strong>or</strong> {e.shared.with.map((w) => w.name).join(' or ')}: hourly positions can’t tell
          {e.shared.with.length > 1 ? ' these terminals' : ' the two'} apart, and the ship fits {e.shared.with.length > 1 ? 'more than one' : 'both'}. So the range runs from
          the visits that can only be this terminal ({fmtN(e.visits)}) to all of them ({fmtN(e.visits + e.shared.visits)}).
        </div>}
        <div className={styles.legendNoteText}>Tug visits aren’t counted in estimated months: tugs moor right next to these terminals, and one position an hour can’t tell a tug at the berth from one at its own dock.{e.notCounted.tugs > 0 ? ` (${plural(e.notCounted.tugs, 'tug stop')} nearby left out.)` : ''}</div>
      </div>}
      {e.list.map((s) => (
        <div key={`${s.key}:${s.shared}`} className={styles.incident}>
          <div className={styles.incidentHead}>
            <span className={styles.incidentTitle}>
              {s.vesselId
                ? <button type="button" className={styles.pcShipLink} onClick={() => onSelectVessel(s.vesselId)} title="Open this ship’s card">{s.name || `MMSI ${s.mmsi}`}</button>
                : <span title="Not in EarthAtlas’s ship database yet; the name is as the ship broadcast it">{s.name || (s.mmsi ? `MMSI ${s.mmsi}` : 'Unnamed ship')}</span>}
            </span>
            <span className={styles.period}>≈ {plural(s.visits, 'visit')}{s.shared ? ' (shared)' : ''}</span>
          </div>
          <div className={styles.incidentMeta}>
            {[s.mmsi && `MMSI ${s.mmsi}`, s.kind, `last ${dayName(s.lastAt)} UTC`, `${fmtN(s.hours)} h nearby`].filter(Boolean).join(' · ')}{' '}
            <EstSource e={e} label="Global Fishing Watch" />
          </div>
        </div>
      ))}
      {e.estimatedMonths.length > 0 && <About label="About these estimates">
        Estimated, not counted: Global Fishing Watch gives one AIS position per ship per hour, on a grid about 1 km across. A visit is estimated
        when a ship’s positions stay within about {r.stop_cells ?? 2} grid cells of each other from one hour to the next (about an hour at under
        ~1.2 knots) within {r.match_km ?? 0.65} km of a berth, and counts when the ship is a kind this terminal serves (the same rule as the counted
        visits). Terminals with berths within {r.neighbour_km ?? 1} km of each other can’t be told apart this way. Checked against NOAA’s
        per-minute AIS for June 2026 (Salish Sea): 90% of NOAA’s cargo-ship and tanker visits were found, and 90% of visits credited to one terminal
        were at that terminal. When NOAA publishes these months, its counted visits replace the estimates.{' '}
        <EstSource e={e} label="Powered by Global Fishing Watch" />
      </About>}
    </div>
  )
}
