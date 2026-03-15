import { getTaxonMeta } from '../utils/taxon'
import styles from './SpeciesCard.module.css'

export default function SpeciesCard({ species, onClick, index = 0 }) {
  const taxon = species.taxon
  const common = taxon?.preferred_common_name || null
  const scientific = taxon?.name || 'Unknown species'
  const iconicTaxon = taxon?.iconic_taxon_name || 'default'
  const { emoji } = getTaxonMeta(iconicTaxon)
  const photo = species.bestPhoto

  return (
    <article
      className={styles.card}
      style={{ animationDelay: `${Math.min(index * 0.04, 0.8)}s` }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
    >
      {/* Image */}
      <div className={styles.imgWrap}>
        {photo ? (
          <img
            src={photo}
            alt={scientific}
            loading="lazy"
            onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }}
          />
        ) : null}
        <div className={styles.imgPlaceholder} style={{ display: photo ? 'none' : 'flex' }}>{emoji}</div>
        <span className={styles.countBadge}>{species.count}</span>
      </div>

      {/* Body */}
      <div className={styles.body}>
        <div className={`${styles.common} ${!common ? styles.unnamed : ''}`}>
          {common || 'Unnamed species'}
        </div>
        <div className={styles.scientific}>{scientific}</div>
      </div>
    </article>
  )
}
