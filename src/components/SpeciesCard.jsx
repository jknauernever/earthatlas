import { getTaxonMeta, formatDate } from '../utils/taxon'
import styles from './SpeciesCard.module.css'

export default function SpeciesCard({ obs, onClick, index = 0 }) {
  const taxon       = obs.taxon
  const common      = taxon?.preferred_common_name || null
  const scientific  = taxon?.name || 'Unknown species'
  const iconicTaxon = taxon?.iconic_taxon_name || 'default'
  const { color, emoji } = getTaxonMeta(iconicTaxon)
  const photo       = obs.photos?.[0]?.url?.replace('square', 'medium')
  const date        = formatDate(obs.observed_on)
  const observer    = obs.user?.login || 'Unknown'
  const avatar      = obs.user?.icon_url
  const inatUrl     = `https://www.inaturalist.org/observations/${obs.id}`
  const isResearch  = obs.quality_grade === 'research'
  const place       = obs.place_guess?.split(',').slice(0, 2).join(',') || null

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
        {isResearch && <span className={styles.quality}>✓ Research Grade</span>}
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
          {avatar
            ? <img className={styles.avatar} src={avatar} alt={observer} />
            : <div className={styles.avatarFallback}>👤</div>}
          <span className={styles.observerName}>@{observer}</span>
          <a
            className={styles.inatLink}
            href={inatUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
          >
            iNat ↗
          </a>
        </div>
      </div>
    </article>
  )
}
