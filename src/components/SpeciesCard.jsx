import { getTaxonMeta, formatDate } from '../utils/taxon'
import styles from './SpeciesCard.module.css'

export default function SpeciesCard({ obs, onClick, index = 0 }) {
  const isEBird     = obs.source === 'eBird'
  const isGBIF      = obs.source === 'GBIF'
  const taxon       = obs.taxon
  const common      = taxon?.preferred_common_name || null
  const scientific  = taxon?.name || 'Unknown species'
  const iconicTaxon = taxon?.iconic_taxon_name || 'default'
  const { color, emoji } = getTaxonMeta(iconicTaxon)
  const photo       = obs.photos?.[0]?.url?.replace('square', 'medium')
  const date        = formatDate(obs.observed_on)
  const place       = obs.place_guess?.split(',').slice(0, 2).join(',') || null
  const isResearch  = obs.quality_grade === 'research'

  // Source-specific
  const observer    = isEBird ? null : (obs.user?.login || 'Unknown')
  const avatar      = isEBird ? null : obs.user?.icon_url
  const externalUrl = isEBird
    ? `https://ebird.org/checklist/${obs.id}`
    : isGBIF
    ? `https://www.gbif.org/occurrence/${obs.id}`
    : `https://www.inaturalist.org/observations/${obs.id}`
  const externalLabel = isEBird ? 'eBird' : isGBIF ? 'GBIF' : 'iNat'

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
        <span className={styles.taxonBadge} style={{ background: color }}>{iconicTaxon}</span>
        {isResearch && !isEBird && <span className={styles.quality}>✓ Research Grade</span>}
        {isEBird && obs.howMany && <span className={styles.quality}>×{obs.howMany}</span>}
      </div>

      {/* Body */}
      <div className={styles.body}>
        <div className={`${styles.common} ${!common ? styles.unnamed : ''}`}>
          {common || 'Unnamed species'}
        </div>
        <div className={styles.scientific}>{scientific}</div>

        <div className={styles.meta}>
          <span className={styles.metaChip}>📅 {date}</span>
          {place && <span className={styles.metaChip}>📍 {place}</span>}
        </div>

        <div className={styles.observer}>
          {isEBird ? (
            <span className={styles.observerName}>eBird</span>
          ) : isGBIF ? (
            <span className={styles.observerName}>{observer}</span>
          ) : (
            <>
              {avatar
                ? <img className={styles.avatar} src={avatar} alt={observer} />
                : <div className={styles.avatarFallback}>👤</div>}
              <span className={styles.observerName}>@{observer}</span>
            </>
          )}
          <a
            className={styles.inatLink}
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
          >
            {externalLabel} ↗
          </a>
        </div>
      </div>
    </article>
  )
}
