/**
 * SpeciesCard — displays a single cetacean species with count, likelihood bar,
 * last seen date, and a curated fact from SPECIES_META.
 *
 * Props:
 *   species     — aggregated species object from aggregateSpecies()
 *   totalCount  — total sightings in the current view (for likelihood calc)
 *   active      — boolean, highlights the card when true
 *   onClick     — () => void
 *   style       — optional inline style (for animation-delay staggering)
 */
export default function SpeciesCard({ species, totalCount = 1, active, onClick, style, styles }) {
  const likelihood = totalCount > 0 ? species.count / totalCount : 0
  const likelihoodLabel = likelihood > 0.4 ? 'High likelihood' : likelihood > 0.15 ? 'Moderate likelihood' : 'Occasional'
  const color = species.color || '#1a5276'

  return (
    <div
      className={`${styles.speciesCard} ${active ? styles.speciesCardActive : ''}`}
      onClick={onClick}
      style={style}
    >
      <div className={styles.speciesCardTop}>
        <div className={styles.speciesNameGroup}>
          <div className={styles.speciesCommon}>{species.common}</div>
          {species.scientific && (
            <div className={styles.speciesScientific}>{species.scientific}</div>
          )}
        </div>
        <div className={styles.speciesCardBadge}>
          <div className={styles.speciesCardCount} style={{ color }}>
            {species.count}
          </div>
          <div className={styles.speciesCardCountLabel}>sightings</div>
        </div>
      </div>

      <div className={styles.speciesLikelihood}>
        <div className={styles.likelihoodTrack}>
          <div
            className={styles.likelihoodFill}
            style={{ width: `${Math.min(likelihood * 100 * 2.5, 100)}%`, background: color }}
          />
        </div>
        <div className={styles.likelihoodLabel}>{likelihoodLabel}</div>
      </div>
    </div>
  )
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return dateStr }
}
