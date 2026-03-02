import { useState } from 'react'
import { getTaxonMeta } from '../../utils/taxon'
import styles from './Insights.module.css'

export default function TopSpecies({ species, loading, onSpeciesClick }) {
  const [hover, setHover] = useState(null)

  if (loading) {
    return (
      <div className={styles.speciesGrid}>
        {[...Array(8)].map((_, i) => (
          <div key={i} className={`${styles.shimmer} ${styles.shimmerCard}`} />
        ))}
      </div>
    )
  }

  if (!species || species.length === 0) return null

  const totalCount = species.reduce((sum, s) => sum + s.count, 0)

  return (
    <div className={styles.speciesGrid}>
      {species.map((s, i) => {
        const { color, emoji } = getTaxonMeta(s.iconicTaxon)
        const pct = totalCount > 0 ? ((s.count / totalCount) * 100).toFixed(1) : '0'
        const isHovered = hover === i
        return (
          <div
            key={s.key}
            className={`${styles.speciesCard} ${isHovered ? styles.speciesCardActive : ''}`}
            style={{ cursor: onSpeciesClick ? 'pointer' : undefined }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSpeciesClick?.(s)}
          >
            <span className={styles.rank}>{i + 1}</span>
            {s.photoUrl
              ? <img className={styles.speciesPhoto} src={s.photoUrl} alt={s.scientificName} loading="lazy" />
              : <div className={styles.speciesPhotoPlaceholder}>{emoji}</div>}
            <div className={styles.speciesInfo}>
              <div className={styles.speciesCommon}>{s.commonName || s.scientificName}</div>
              {s.commonName && <div className={styles.speciesScientific}>{s.scientificName}</div>}
              <div className={styles.speciesCount}>
                {s.sightings != null
                  ? `${s.count.toLocaleString()} individual${s.count !== 1 ? 's' : ''} · ${s.sightings} sighting${s.sightings !== 1 ? 's' : ''}`
                  : `${s.count.toLocaleString()} obs`}
                {isHovered ? ` — ${pct}%` : ''}
              </div>
            </div>
            <span className={styles.badge} style={{ background: color }}>{s.iconicTaxon || 'Other'}</span>
          </div>
        )
      })}
    </div>
  )
}
