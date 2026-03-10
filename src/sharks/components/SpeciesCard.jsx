import SpeciesInfoPopup from '../../components/SpeciesInfoPopup'

const IUCN_LABEL = {
  CR: 'Critically Endangered',
  EN: 'Endangered',
  VU: 'Vulnerable',
  NT: 'Near Threatened',
  LC: 'Least Concern',
}
const IUCN_BG = {
  CR: '#e74c3c', EN: '#e67e22', VU: '#f39c12', NT: '#27ae60', LC: '#2ecc71',
}

export default function SpeciesCard({ species, totalCount = 1, active, onClick, style, styles, openInfoKey, setOpenInfoKey }) {
  const likelihood = totalCount > 0 ? species.count / totalCount : 0
  const likelihoodLabel = likelihood > 0.4 ? 'High likelihood' : likelihood > 0.15 ? 'Moderate likelihood' : 'Occasional'
  const isKnownShark = species.color && species.color !== '#e8e8e8'
  const color = isKnownShark ? '#c0392b' : '#e67e22'
  const iucn = species.iucn || species.meta?.iucn || null
  const iucnLabel = IUCN_LABEL[iucn] || null
  const iucnBg = IUCN_BG[iucn] || null
  const infoKey = species.speciesKey || species.common
  const popupOpen = openInfoKey === infoKey

  return (
    <div
      className={`${styles.speciesCard} ${active ? styles.speciesCardActive : ''}`}
      onClick={onClick}
      style={{ ...style, position: 'relative', zIndex: popupOpen ? 100 : undefined }}
    >
      {iucnLabel && (
        <div className={styles.speciesStatusBanner} style={{ background: iucnBg }}>
          <span className={styles.speciesStatusIcon}>⚠</span> {iucnLabel}
        </div>
      )}
      <div className={styles.speciesCardTop}>
        <div className={styles.speciesNameGroup}>
          <div className={styles.speciesCommon}>
            {species.common}
            <SpeciesInfoPopup species={species} styles={styles} openInfoKey={openInfoKey} setOpenInfoKey={setOpenInfoKey} />
          </div>
          {species.scientific && (
            <div className={styles.speciesScientific}>{species.scientific}</div>
          )}
        </div>
        <div className={styles.speciesCardBadge}>
          <div className={styles.speciesCardCount} style={{ color }}>{species.count}</div>
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

      {species.meta?.fact && (
        <div className={styles.speciesCardFact}>{species.meta.fact}</div>
      )}
    </div>
  )
}
