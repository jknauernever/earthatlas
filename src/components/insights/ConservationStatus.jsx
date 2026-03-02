import { useState } from 'react'
import styles from './Insights.module.css'

const IUCN_META = {
  LC: { label: 'Least Concern',       color: '#4caf50' },
  NT: { label: 'Near Threatened',     color: '#8bc34a' },
  VU: { label: 'Vulnerable',          color: '#ffc107' },
  EN: { label: 'Endangered',          color: '#ff9800' },
  CR: { label: 'Critically Endangered', color: '#f44336' },
  EW: { label: 'Extinct in the Wild', color: '#9c27b0' },
  EX: { label: 'Extinct',            color: '#424242' },
  DD: { label: 'Data Deficient',      color: '#9e9e9e' },
  NE: { label: 'Not Evaluated',       color: '#bdbdbd' },
}

export default function ConservationStatus({ categories, loading }) {
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

  if (!categories || categories.length === 0) return <div className={styles.noData}>No conservation data available</div>

  const maxCount = categories[0]?.count || 1
  const totalCount = categories.reduce((sum, c) => sum + c.count, 0)

  return (
    <div className={styles.taxonList}>
      {categories.map((c, i) => {
        const meta = IUCN_META[c.name] || { label: c.name, color: '#9e9e9e' }
        const pct = totalCount > 0 ? ((c.count / totalCount) * 100).toFixed(1) : '0'
        const isHovered = hover === i
        return (
          <div
            key={c.name}
            className={`${styles.taxonRow} ${isHovered ? styles.taxonRowActive : ''}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{ opacity: hover !== null && !isHovered ? 0.6 : 1 }}
          >
            <span className={styles.iucnDot} style={{ background: meta.color }} />
            <span className={styles.taxonName}>{meta.label}</span>
            <span className={styles.taxonBar}>
              <span
                className={styles.taxonBarFill}
                style={{ width: `${(c.count / maxCount) * 100}%`, background: meta.color }}
              />
            </span>
            <span className={styles.taxonCount}>
              {isHovered
                ? `${c.count.toLocaleString()} (${pct}%)`
                : c.count.toLocaleString()}
            </span>
          </div>
        )
      })}
    </div>
  )
}
