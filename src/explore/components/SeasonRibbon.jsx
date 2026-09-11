import { useRef, useState } from 'react'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * SeasonRibbon — the month histogram as a control, docked on the map in
 * patterns mode. Click a bar for a single month, drag across bars for a
 * span, "All months" for the unfiltered view, ▶ to animate month by month.
 *
 * Props:
 *   pattern   — [{ month: 1..12, count }] (fetchSeasonalPattern)
 *   season    — { type:'month', month } | { type:'range', from, to } | { type:'all' }  (0-based)
 *   onChange  — (season) => void
 *   playing   — boolean
 *   onPlayToggle — () => void
 *   styles    — CSS module from parent
 */
export default function SeasonRibbon({ pattern = [], season, onChange, playing, onPlayToggle, styles }) {
  const dragFrom = useRef(null)
  const [dragTo, setDragTo] = useState(null)

  const maxCount = Math.max(...pattern.map((p) => p.count), 1)

  const inSelection = (i) => {
    if (dragFrom.current != null && dragTo != null) {
      const a = Math.min(dragFrom.current, dragTo)
      const b = Math.max(dragFrom.current, dragTo)
      return i >= a && i <= b
    }
    if (season.type === 'all') return true
    if (season.type === 'range') return i >= season.from && i <= season.to
    return i === season.month
  }

  const commitDrag = (i) => {
    const from = dragFrom.current
    dragFrom.current = null
    setDragTo(null)
    if (from == null) return
    const a = Math.min(from, i)
    const b = Math.max(from, i)
    onChange(a === b ? { type: 'month', month: a } : { type: 'range', from: a, to: b })
  }

  const title = season.type === 'all'
    ? 'All months'
    : season.type === 'range'
      ? `${MONTHS[season.from]}–${MONTHS[season.to]}`
      : MONTHS_FULL[season.month]
  const total = season.type === 'all'
    ? pattern.reduce((s, p) => s + p.count, 0)
    : season.type === 'range'
      ? pattern.slice(season.from, season.to + 1).reduce((s, p) => s + p.count, 0)
      : (pattern[season.month]?.count || 0)

  return (
    <div className={styles.ribbon} onPointerLeave={() => { dragFrom.current = null; setDragTo(null) }}>
      <div className={styles.ribbonHead}>
        <button
          type="button"
          className={styles.ribbonPlay}
          onClick={onPlayToggle}
          aria-label={playing ? 'Pause month animation' : 'Animate months'}
          title={playing ? 'Pause' : 'Play the year month by month'}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <div className={styles.ribbonTitle}>
          {title}
          <small>{total.toLocaleString()} sightings · all years combined</small>
        </div>
        <button
          type="button"
          className={season.type === 'all' ? styles.ribbonChipOn : styles.ribbonChip}
          onClick={() => onChange({ type: 'all' })}
        >
          All months
        </button>
      </div>
      <div className={styles.ribbonBars}>
        {MONTHS.map((label, i) => {
          const count = pattern[i]?.count || 0
          const sel = inSelection(i)
          return (
            <div
              key={label}
              className={`${styles.ribbonBarCol}`}
              title={`${MONTHS_FULL[i]}: ${count.toLocaleString()} sightings — click, or drag for a span`}
              onPointerDown={(e) => { e.preventDefault(); dragFrom.current = i; setDragTo(i) }}
              onPointerEnter={() => { if (dragFrom.current != null) setDragTo(i) }}
              onPointerUp={() => commitDrag(i)}
            >
              <div
                className={sel ? styles.ribbonBarOn : styles.ribbonBar}
                style={{ height: `${Math.max(6, (count / maxCount) * 100)}%` }}
              />
              <span className={sel ? styles.ribbonLblOn : styles.ribbonLbl}>{label}</span>
            </div>
          )
        })}
      </div>
      <div className={styles.ribbonProv}>
        Historical sighting density by month, all years combined — drag across months for a span ·{' '}
        <a href="https://www.gbif.org" target="_blank" rel="noreferrer">GBIF</a>
      </div>
    </div>
  )
}
