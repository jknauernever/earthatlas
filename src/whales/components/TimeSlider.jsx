import { useMemo, useCallback } from 'react'
import styles from '../WhalesApp.module.css'

const MS_PER_DAY = 86400000

function dayToDate(minDate, day) {
  const d = new Date(new Date(minDate + 'T12:00:00').getTime() + day * MS_PER_DAY)
  return d.toISOString().split('T')[0]
}

function dateToDay(minDate, dateStr) {
  return Math.round((new Date(dateStr + 'T12:00:00') - new Date(minDate + 'T12:00:00')) / MS_PER_DAY)
}

function fmt(dateStr) {
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return dateStr }
}

/**
 * TimeSlider — dual-handle date range slider overlay for the whale map.
 *
 * Props:
 *   sightings — full unfiltered array (used to derive date range)
 *   value     — { start: string|null, end: string|null }, nulls = full extent
 *   onChange  — ({ start, end }) => void
 */
export default function TimeSlider({ sightings, value, onChange }) {
  const { minDate, maxDate, totalDays } = useMemo(() => {
    if (!sightings || sightings.length === 0) return { minDate: null, maxDate: null, totalDays: 0 }

    let min = null
    let max = null
    for (const s of sightings) {
      if (!s.date) continue
      if (!min || s.date < min) min = s.date
      if (!max || s.date > max) max = s.date
    }
    if (!min || !max) return { minDate: null, maxDate: null, totalDays: 0 }

    const days = Math.round((new Date(max + 'T12:00:00') - new Date(min + 'T12:00:00')) / MS_PER_DAY)
    return { minDate: min, maxDate: max, totalDays: days }
  }, [sightings])

  if (!minDate || !maxDate || totalDays < 1) return null

  const loDay = value.start ? dateToDay(minDate, value.start) : 0
  const hiDay = value.end   ? dateToDay(minDate, value.end)   : totalDays

  const loPct = (loDay / totalDays) * 100
  const hiPct = (hiDay / totalDays) * 100

  const handleLo = useCallback((e) => {
    const day = Math.min(parseInt(e.target.value, 10), hiDay - 1)
    onChange({ ...value, start: day <= 0 ? null : dayToDate(minDate, day) })
  }, [hiDay, minDate, onChange, value])

  const handleHi = useCallback((e) => {
    const day = Math.max(parseInt(e.target.value, 10), loDay + 1)
    onChange({ ...value, end: day >= totalDays ? null : dayToDate(minDate, day) })
  }, [loDay, totalDays, minDate, onChange, value])

  const startLabel = value.start ? fmt(value.start) : fmt(minDate)
  const endLabel   = value.end   ? fmt(value.end)   : fmt(maxDate)

  return (
    <div className={styles.timeSlider}>
      <span className={styles.timeSliderLabel}>{fmt(minDate)}</span>
      <div className={styles.timeSliderMiddle}>
        {/* Floating labels above each thumb */}
        <div className={styles.timeSliderThumbLabel} style={{ left: `${loPct}%` }}>
          {startLabel}
        </div>
        <div className={styles.timeSliderThumbLabel} style={{ left: `${hiPct}%` }}>
          {endLabel}
        </div>
        {/* Filled range between the two thumbs */}
        <div
          className={styles.timeSliderFill}
          style={{ left: `${loPct}%`, right: `${100 - hiPct}%` }}
        />
        {/* Low handle */}
        <input
          type="range"
          className={`${styles.timeSliderTrack} ${styles.timeSliderTrackLo}`}
          min={0}
          max={totalDays}
          value={loDay}
          onChange={handleLo}
        />
        {/* High handle */}
        <input
          type="range"
          className={`${styles.timeSliderTrack} ${styles.timeSliderTrackHi}`}
          min={0}
          max={totalDays}
          value={hiDay}
          onChange={handleHi}
        />
      </div>
      <span className={styles.timeSliderLabel}>{fmt(maxDate)}</span>
    </div>
  )
}
