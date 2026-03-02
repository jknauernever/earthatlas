import { useState } from 'react'
import { getTaxonMeta } from '../../utils/taxon'
import styles from './Insights.module.css'

export default function TaxonomyBreakdown({ classes, loading }) {
  const [hover, setHover] = useState(null)

  if (loading) {
    return (
      <div className={styles.taxonList}>
        {[...Array(5)].map((_, i) => (
          <div key={i} className={`${styles.shimmer} ${styles.shimmerRow}`} />
        ))}
      </div>
    )
  }

  if (!classes || classes.length === 0) return <div className={styles.noData}>No taxonomy data</div>

  const maxCount = classes[0]?.count || 1
  const totalCount = classes.reduce((sum, c) => sum + c.count, 0)

  return (
    <div className={styles.taxonList}>
      {classes.map((c, i) => {
        const { color, emoji } = getTaxonMeta(c.iconicTaxon)
        const pct = totalCount > 0 ? ((c.count / totalCount) * 100).toFixed(1) : '0'
        const isHovered = hover === i
        return (
          <div
            key={c.key || i}
            className={`${styles.taxonRow} ${isHovered ? styles.taxonRowActive : ''}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{ opacity: hover !== null && !isHovered ? 0.6 : 1 }}
          >
            <span className={styles.taxonEmoji}>{emoji}</span>
            <span className={styles.taxonName}>{c.name}</span>
            <span className={styles.taxonBar}>
              <span
                className={styles.taxonBarFill}
                style={{ width: `${(c.count / maxCount) * 100}%`, background: color }}
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
