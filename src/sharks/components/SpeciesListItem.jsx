import SpeciesInfoPopup from '../../components/SpeciesInfoPopup'

const IUCN_SHORT = { CR: 'CR', EN: 'EN', VU: 'VU', NT: 'NT', LC: 'LC' }
const IUCN_COLOR = { CR: '#e74c3c', EN: '#e67e22', VU: '#f39c12', NT: '#27ae60', LC: '#2ecc71' }

export default function SpeciesListItem({ species, totalCount = 1, active, onClick, style, styles, openInfoKey, setOpenInfoKey }) {
  const likelihood = totalCount > 0 ? species.count / totalCount : 0
  const likelihoodLabel = likelihood > 0.4 ? 'High' : likelihood > 0.15 ? 'Moderate' : 'Occasional'
  const isKnownShark = species.color && species.color !== '#e8e8e8'
  const dotColor = isKnownShark ? '#c0392b' : '#e67e22'
  const iucn = species.iucn || species.meta?.iucn || null
  const infoKey = species.speciesKey || species.common
  const popupOpen = openInfoKey === infoKey

  return (
    <div
      className={`${styles.speciesRow} ${active ? styles.speciesRowActive : ''}`}
      onClick={onClick}
      style={{ ...style, position: 'relative', zIndex: popupOpen ? 100 : undefined }}
    >
      <div className={styles.speciesRowDot} style={{ background: dotColor }} />
      <div className={styles.speciesRowName}>
        {species.common}
        {species.scientific && <span className={styles.speciesRowSci}>{species.scientific}</span>}
      </div>
      <SpeciesInfoPopup species={species} styles={styles} openInfoKey={openInfoKey} setOpenInfoKey={setOpenInfoKey} />
      {iucn && (
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: IUCN_COLOR[iucn], flexShrink: 0 }}>
          {IUCN_SHORT[iucn]}
        </span>
      )}
      <span className={styles.speciesRowCount} style={{ color: dotColor }}>{species.count}</span>
    </div>
  )
}
