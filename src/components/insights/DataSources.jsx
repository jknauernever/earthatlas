import { useState } from 'react'
import styles from './Insights.module.css'

export default function DataSources({ datasets, loading }) {
  const [hover, setHover] = useState(null)

  if (loading) {
    return (
      <div className={styles.taxonList}>
        {[...Array(4)].map((_, i) => (
          <div key={i} className={`${styles.shimmer} ${styles.shimmerRow}`} />
        ))}
      </div>
    )
  }

  if (!datasets || datasets.length === 0) return <div className={styles.noData}>No dataset information available</div>

  const maxCount = datasets[0]?.count || 1
  const totalCount = datasets.reduce((sum, d) => sum + d.count, 0)

  return (
    <div className={styles.taxonList}>
      {datasets.map((d, i) => {
        const pct = totalCount > 0 ? ((d.count / totalCount) * 100).toFixed(1) : '0'
        const isHovered = hover === i
        const title = d.title || d.name || d.key
        return (
          <div
            key={d.key || i}
            className={`${styles.taxonRow} ${isHovered ? styles.taxonRowActive : ''}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{ opacity: hover !== null && !isHovered ? 0.6 : 1 }}
          >
            <span className={styles.taxonName} title={title}>
              {title.length > 40 ? title.slice(0, 37) + '...' : title}
            </span>
            <span className={styles.taxonBar}>
              <span
                className={styles.taxonBarFill}
                style={{ width: `${(d.count / maxCount) * 100}%`, background: 'var(--moss)' }}
              />
            </span>
            <span className={styles.taxonCount}>
              {isHovered
                ? `${d.count.toLocaleString()} (${pct}%)`
                : d.count.toLocaleString()}
            </span>
          </div>
        )
      })}
    </div>
  )
}
