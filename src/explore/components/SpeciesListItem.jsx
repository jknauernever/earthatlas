import SpeciesInfoPopup from '../../components/SpeciesInfoPopup'

const STATUS_BY_COLOR = {
  '#e06868': 'CR',
  '#d87060': 'EN',
  '#d08060': 'EN',
  '#c87060': 'EN',
}

export default function SpeciesListItem({ species, totalCount = 1, active, onClick, style, styles, openInfoKey, setOpenInfoKey }) {
  const likelihood = totalCount > 0 ? species.count / totalCount : 0
  const likelihoodLabel = likelihood > 0.4 ? 'High' : likelihood > 0.15 ? 'Moderate' : 'Occasional'
  const color = species.color || '#1a5276'
  const status = STATUS_BY_COLOR[color] || null
  const infoKey = species.speciesKey || species.common
  const popupOpen = openInfoKey === infoKey

  return (
    <div
      className={`${styles.speciesRow} ${active ? styles.speciesRowActive : ''}`}
      onClick={onClick}
      style={{ ...style, position: 'relative', zIndex: popupOpen ? 100 : undefined }}
    >
      <div className={styles.speciesRowDot} style={{ background: color }} />
      <div className={styles.speciesRowName}>
        {species.common}
        {species.scientific && (
          <span className={styles.speciesRowSci}>{species.scientific}</span>
        )}
      </div>
      <SpeciesInfoPopup species={species} styles={styles} openInfoKey={openInfoKey} setOpenInfoKey={setOpenInfoKey} />
      {status && <span className={styles.speciesRowStatus} style={{ color }}>{status}</span>}
      <span className={styles.speciesRowLikelihood}>{likelihoodLabel}</span>
      <span className={styles.speciesRowCount} style={{ color }}>
        {species.count}
      </span>
    </div>
  )
}
