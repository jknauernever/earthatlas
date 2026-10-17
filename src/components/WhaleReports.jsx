/**
 * Whale reports — the per-sighting list for whale-database sightings (src/lib/whales.js),
 * shared by the main search (src/App.jsx) and /whales (src/explore/ExploreApp.jsx).
 *
 * Header: how many reports are in view and which sources they came from (each linked).
 * Rows, newest first: date · time, species (or what the source called it), count,
 * the channel and source it came through, the observer, and a link to the original
 * record when the source has one. Hydrophone detections say so. Shows a few rows and
 * grows on "Show more", so it never forces the panel to scroll.
 */
import { useState } from 'react'
import { whaleName, whaleSourceLabel, whaleSourceCounts, whaleCredit } from '../lib/whales.js'
import s from './WhaleReports.module.css'

const PAGE = 6

// Exact reports: date and time both in the viewer's local time (never a UTC date with a local time).
// Date-only reports (HappyWhale, some OBIS): the source's own date.
function when(r) {
  const D = { month: 'short', day: 'numeric', year: 'numeric' }
  if (r.time_precision === 'exact' && r.observed_at) {
    const t = new Date(r.observed_at)
    return `${t.toLocaleDateString(undefined, D)} · ${t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  }
  return r.observed_date ? new Date(`${r.observed_date}T12:00:00`).toLocaleDateString(undefined, D) : ''
}

function countText(c) {
  if (!c || (c.min == null && c.max == null)) return null
  if (c.min != null && c.max != null && c.min !== c.max) return `${c.min}–${c.max}`
  const n = c.max ?? c.min
  return n > 1 ? `${n}` : null
}

export default function WhaleReports({ reports = [], onSelect, title = 'Whale reports in view' }) {
  const [shown, setShown] = useState(PAGE)
  if (!reports.length) return null
  const sources = whaleSourceCounts(reports)
  // Newest first by date, then time (pages sort their own rows by date only).
  const key = (r) => r.observed_at || `${r.observed_date || ''}T12:00:00Z`
  const rows = [...reports].sort((a, b) => key(b).localeCompare(key(a))).slice(0, shown)
  return (
    <section className={s.box} aria-label={title}>
      <div className={s.head}>
        <span className={s.title}>{title}</span>
        <span className={s.count}>{reports.length.toLocaleString()}</span>
      </div>
      <div className={s.sources}>
        from{' '}
        {sources.map((src, i) => (
          <span key={src.id}>
            {i > 0 && (i === sources.length - 1 ? ' & ' : ', ')}
            {src.url ? <a href={src.url} target="_blank" rel="noopener noreferrer">{src.label}</a> : src.label}
            {' '}<span className={s.n}>({src.count.toLocaleString()})</span>
          </span>
        ))}
      </div>
      <ol className={s.list}>
        {rows.map((r) => {
          const n = countText(r.count)
          return (
            <li key={r.id} className={s.row}>
              <button type="button" className={s.main} onClick={onSelect ? () => onSelect(r) : undefined} disabled={!onSelect}
                title={onSelect ? 'Show on the map' : undefined}>
                <span className={s.when}>{when(r)}</span>
                <span className={s.what}>
                  {whaleName(r)}{n ? <span className={s.n}> × {n}</span> : null}
                  {r.kind === 'acoustic' && <span className={s.tag}>heard on hydrophone</span>}
                </span>
                {r.individual?.label && <span className={s.ind}>{r.individual.label}</span>}
              </button>
              <div className={s.credit}>
                {r.observer && <span>{r.observer} · </span>}
                {r.url
                  ? <a href={r.url} target="_blank" rel="noopener noreferrer" title={`View on ${whaleSourceLabel(r)}`}>{whaleCredit(r)} ↗</a>
                  : <span>{whaleCredit(r)}</span>}
              </div>
            </li>
          )
        })}
      </ol>
      {reports.length > shown && (
        <button type="button" className={s.more} onClick={() => setShown((v) => v + PAGE * 2)}>
          Show more ({(reports.length - shown).toLocaleString()} more)
        </button>
      )}
    </section>
  )
}
