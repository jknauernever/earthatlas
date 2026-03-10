// TimeSlider — receives styles as a prop (unlike WhalesApp version which imports directly)
import { useMemo, useCallback } from 'react'

const MS_PER_DAY = 86400000

function dayToDate(minDate, day) {
  const d = new Date(new Date(minDate + 'T12:00:00').getTime() + day * MS_PER_DAY)
  return d.toISOString().split('T')[0]
}
function dateToDay(minDate, dateStr) {
  return Math.round((new Date(dateStr + 'T12:00:00') - new Date(minDate + 'T12:00:00')) / MS_PER_DAY)
}
function fmt(dateStr) {
  try { return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
  catch { return dateStr }
}

export default function TimeSlider({ sightings, value, onChange, styles }) {
  const { minDate, maxDate, totalDays } = useMemo(() => {
    if (!sightings || sightings.length === 0) return { minDate: null, maxDate: null, totalDays: 0 }
    let min = null, max = null
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

  const presets = [{ label: 'Last 24h', days: 1 }, { label: 'Last week', days: 7 }, { label: 'Last month', days: 30 }]

  function applyPreset(days) {
    const end = new Date(maxDate + 'T12:00:00')
    const start = new Date(end.getTime() - days * MS_PER_DAY)
    const startStr = start.toISOString().split('T')[0]
    onChange({ start: startStr < minDate ? null : startStr, end: null })
  }
  function isActivePreset(days) {
    if (!value.start || value.end) return false
    const expected = new Date(new Date(maxDate + 'T12:00:00').getTime() - days * MS_PER_DAY).toISOString().split('T')[0]
    return value.start === expected
  }

  return (
    <div className={styles.timeSliderBlock}>
      <div className={styles.timeSlider}>
        <span className={styles.timeSliderLabel}>{fmt(minDate)}</span>
        <div className={styles.timeSliderMiddle}>
          <div className={styles.timeSliderThumbLabel} style={{ left: `${loPct}%` }}>{value.start ? fmt(value.start) : fmt(minDate)}</div>
          <div className={styles.timeSliderThumbLabel} style={{ left: `${hiPct}%` }}>{value.end ? fmt(value.end) : fmt(maxDate)}</div>
          <div className={styles.timeSliderFill} style={{ left: `${loPct}%`, right: `${100 - hiPct}%` }} />
          <input type="range" className={`${styles.timeSliderTrack} ${styles.timeSliderTrackLo}`} min={0} max={totalDays} value={loDay} onChange={handleLo} />
          <input type="range" className={`${styles.timeSliderTrack} ${styles.timeSliderTrackHi}`} min={0} max={totalDays} value={hiDay} onChange={handleHi} />
        </div>
        <span className={styles.timeSliderLabel}>{fmt(maxDate)}</span>
      </div>
      <div className={styles.timeSliderPresets}>
        {presets.map(({ label, days }) => (
          <button key={label} className={`${styles.timePresetBtn} ${isActivePreset(days) ? styles.timePresetBtnActive : ''}`} onClick={() => applyPreset(days)}>
            {label}
          </button>
        ))}
        {(value.start || value.end) && (
          <button className={styles.timePresetClear} onClick={() => onChange({ start: null, end: null })}>All data</button>
        )}
      </div>
    </div>
  )
}
