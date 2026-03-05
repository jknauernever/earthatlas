const STATUS_BY_COLOR = {
  '#e06868': 'CR',
  '#d87060': 'EN',
  '#d08060': 'EN',
  '#c87060': 'EN',
}

/**
 * SpeciesListItem — compact single-row species display for long lists (>10).
 * Same props as SpeciesCard.
 */
export default function SpeciesListItem({ species, totalCount = 1, active, onClick, style, styles }) {
  const likelihood = totalCount > 0 ? species.count / totalCount : 0
  const likelihoodLabel = likelihood > 0.4 ? 'High' : likelihood > 0.15 ? 'Moderate' : 'Occasional'
  const color = species.color || '#1a5276'
  const status = STATUS_BY_COLOR[color] || null

  return (
    <div
      className={`${styles.speciesRow} ${active ? styles.speciesRowActive : ''}`}
      onClick={onClick}
      style={style}
    >
      <div className={styles.speciesRowDot} style={{ background: color }} />
      <div className={styles.speciesRowName}>
        {species.common}
        {species.scientific && (
          <span className={styles.speciesRowSci}>{species.scientific}</span>
        )}
      </div>
      {status && <span className={styles.speciesRowStatus} style={{ color }}>{status}</span>}
      <span className={styles.speciesRowLikelihood}>{likelihoodLabel}</span>
      <span className={styles.speciesRowCount} style={{ color }}>
        {species.count}
      </span>
    </div>
  )
}
