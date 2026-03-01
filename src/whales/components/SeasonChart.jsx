import { useState } from 'react'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December']

/**
 * SeasonChart — horizontal bar chart showing cetacean sighting density by month.
 *
 * Props:
 *   pattern        — array of { month: 1..12, count: N } (from fetchSeasonalPattern)
 *   activeMonth    — currently selected/hovered month index (0-based), or null
 *   onMonthChange  — (monthIndex) => void  (0-based)
 *   loading        — boolean
 *   styles         — CSS module from parent
 */
export default function SeasonChart({ pattern = [], activeMonth, onMonthChange, loading, styles }) {
  const [hover, setHover] = useState(null)

  const currentMonthIdx = new Date().getMonth() // 0-based

  const maxCount = Math.max(...pattern.map(p => p.count), 1)
  const totalCount = pattern.reduce((s, p) => s + p.count, 0)

  const displayMonth = hover ?? activeMonth

  if (loading) {
    return (
      <div>
        <div className={styles.shimmerCard} style={{ height: 120 }} />
      </div>
    )
  }

  return (
    <div>
      <div className={styles.seasonBars}>
        {MONTHS.map((label, i) => {
          const p = pattern[i] || { count: 0 }
          const isActive = displayMonth === i
          const isCurrent = i === currentMonthIdx
          const barH = p.count > 0 ? Math.max((p.count / maxCount) * 100, 6) : 2

          return (
            <div
              key={label}
              className={[
                styles.seasonCol,
                isActive ? styles.seasonColActive : '',
                isCurrent ? styles.seasonColCurrent : '',
              ].join(' ')}
              onMouseEnter={() => { setHover(i); onMonthChange?.(i) }}
              onMouseLeave={() => { setHover(null) }}
              onClick={() => onMonthChange?.(i)}
            >
              <div className={styles.seasonBarTrack}>
                <div className={styles.seasonBar} style={{ height: `${barH}%` }} />
              </div>
              <div className={styles.seasonMonthLabel}>{label}</div>
            </div>
          )
        })}
      </div>

      <div className={styles.seasonDetail}>
        {displayMonth !== null && displayMonth !== undefined ? (
          <>
            <span className={styles.seasonDetailMonth}>{MONTHS_FULL[displayMonth]}</span>
            <span className={styles.seasonDetailCount}>
              {(pattern[displayMonth]?.count || 0).toLocaleString()} historical sightings
            </span>
            {totalCount > 0 && (
              <span className={styles.seasonDetailHint}>
                {(((pattern[displayMonth]?.count || 0) / totalCount) * 100).toFixed(0)}% of annual activity
              </span>
            )}
          </>
        ) : (
          <span className={styles.seasonDetailHint}>
            Click a month to see historical sightings for that time of year
          </span>
        )}
      </div>
    </div>
  )
}
