import { useState } from 'react'
import styles from './Insights.module.css'

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December']

export default function SeasonalityChart({ months, loading }) {
  const [hover, setHover] = useState(null)

  if (loading) {
    return <div className={`${styles.shimmer} ${styles.shimmerChart}`} />
  }

  if (!months || months.length === 0) return <div className={styles.noData}>No seasonal data available</div>

  const monthMap = {}
  months.forEach(m => { monthMap[Number(m.name)] = m.count })

  const bars = MONTH_LABELS.map((label, i) => ({
    label,
    fullLabel: MONTH_FULL[i],
    count: monthMap[i + 1] || 0,
    index: i,
  }))

  const totalCount = bars.reduce((sum, b) => sum + b.count, 0)
  const maxCount = Math.max(...bars.map(b => b.count), 1)

  return (
    <div className={styles.seasonChart}>
      {/* Hover detail */}
      <div className={styles.seasonDetail}>
        {hover !== null ? (
          <>
            <span className={styles.seasonDetailMonth}>{bars[hover].fullLabel}</span>
            <span className={styles.seasonDetailCount}>
              {bars[hover].count.toLocaleString()} observations
            </span>
            <span className={styles.seasonDetailPct}>
              {totalCount > 0 ? `${((bars[hover].count / totalCount) * 100).toFixed(1)}%` : ''}
            </span>
          </>
        ) : (
          <span className={styles.seasonDetailHint}>Hover over a bar for details</span>
        )}
      </div>

      <div className={styles.seasonBars}>
        {bars.map(b => (
          <div
            key={b.label}
            className={`${styles.seasonCol} ${hover === b.index ? styles.seasonColActive : ''}`}
            onMouseEnter={() => setHover(b.index)}
            onMouseLeave={() => setHover(null)}
          >
            <div className={styles.seasonBarWrap}>
              <div
                className={styles.seasonBar}
                style={{
                  height: `${(b.count / maxCount) * 100}%`,
                  opacity: hover !== null && hover !== b.index ? 0.4 : 1,
                }}
              />
            </div>
            <div className={styles.seasonLabel}>{b.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
