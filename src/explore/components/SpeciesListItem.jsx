import SpeciesInfoPopup from '../../components/SpeciesInfoPopup'

export default function SpeciesListItem({ species, active, onClick, style, styles, openInfoKey, setOpenInfoKey }) {
  const color = species.color || '#1a5276'
  const infoKey = species.speciesKey || species.common
  const popupOpen = openInfoKey === infoKey
  const photo = (species.photos && species.photos[0]) || species.meta?.photoUrl || null

  return (
    <div
      className={`${styles.speciesRow} ${active ? styles.speciesRowActive : ''}`}
      onClick={onClick}
      style={{ ...style, position: 'relative', zIndex: popupOpen ? 100 : undefined }}
    >
      {photo
        ? <img className={styles.speciesRowThumb} src={photo} alt={species.common} loading="lazy"
            onError={e => { e.currentTarget.style.display='none'; e.currentTarget.nextSibling.style.display='flex' }} />
        : null}
      <div className={styles.speciesRowThumbPlaceholder} style={{ display: photo ? 'none' : 'flex', borderColor: color }}>
        {species.meta?.emoji || ''}
      </div>
      <div className={styles.speciesRowName}>
        {species.common}
        {species.scientific && (
          <span className={styles.speciesRowSci}>{species.scientific}</span>
        )}
      </div>
      <SpeciesInfoPopup species={species} styles={styles} openInfoKey={openInfoKey} setOpenInfoKey={setOpenInfoKey} />
      <span className={styles.speciesRowCount} style={{ color }}>
        {species.count}
      </span>
    </div>
  )
}
