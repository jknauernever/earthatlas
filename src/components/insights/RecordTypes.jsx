import { useState } from 'react'
import styles from './Insights.module.css'

const RECORD_META = {
  HUMAN_OBSERVATION:    { label: 'Human Observation',    color: '#4caf50' },
  PRESERVED_SPECIMEN:   { label: 'Museum Specimen',      color: '#795548' },
  MACHINE_OBSERVATION:  { label: 'Machine Observation',  color: '#2196f3' },
  OBSERVATION:          { label: 'Observation',          color: '#66bb6a' },
  FOSSIL_SPECIMEN:      { label: 'Fossil Specimen',      color: '#ff9800' },
  LIVING_SPECIMEN:      { label: 'Living Specimen',      color: '#8bc34a' },
  MATERIAL_SAMPLE:      { label: 'Material Sample',      color: '#9c27b0' },
  LITERATURE:           { label: 'Literature',           color: '#607d8b' },
  MATERIAL_CITATION:    { label: 'Material Citation',    color: '#78909c' },
  OCCURRENCE:           { label: 'Occurrence',           color: '#9e9e9e' },
  UNKNOWN:              { label: 'Unknown',              color: '#bdbdbd' },
}

export default function RecordTypes({ basisOfRecord, loading }) {
  const [hover, setHover] = useState(null)

  if (loading) {
    return (
      <div className={styles.taxonList}>
        {[...Array(3)].map((_, i) => (
          <div key={i} className={`${styles.shimmer} ${styles.shimmerRow}`} />
        ))}
      </div>
    )
  }

  if (!basisOfRecord || basisOfRecord.length === 0) return <div className={styles.noData}>No record type data available</div>

  const maxCount = basisOfRecord[0]?.count || 1
  const totalCount = basisOfRecord.reduce((sum, r) => sum + r.count, 0)

  return (
    <div className={styles.taxonList}>
      {basisOfRecord.map((r, i) => {
        const meta = RECORD_META[r.name] || { label: r.name, color: '#9e9e9e' }
        const pct = totalCount > 0 ? ((r.count / totalCount) * 100).toFixed(1) : '0'
        const isHovered = hover === i
        return (
          <div
            key={r.name}
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
                style={{ width: `${(r.count / maxCount) * 100}%`, background: meta.color }}
              />
            </span>
            <span className={styles.taxonCount}>
              {isHovered
                ? `${r.count.toLocaleString()} (${pct}%)`
                : r.count.toLocaleString()}
            </span>
          </div>
        )
      })}
    </div>
  )
}
