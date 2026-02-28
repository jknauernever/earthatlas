import { getTaxonMeta, formatDate } from '../utils/taxon'
import styles from './SpeciesList.module.css'

export default function SpeciesList({ observations, onSelect }) {
  return (
    <div className={styles.list}>
      {observations.map((obs, i) => {
        const taxon       = obs.taxon
        const common      = taxon?.preferred_common_name || taxon?.name || 'Unnamed species'
        const scientific  = taxon?.name || ''
        const iconicTaxon = taxon?.iconic_taxon_name || 'default'
        const { color, emoji } = getTaxonMeta(iconicTaxon)
        const photo       = obs.photos?.[0]?.url?.replace('square', 'small')
        const date        = formatDate(obs.observed_on, { month: 'short', day: 'numeric' })
        const inatUrl     = `https://www.inaturalist.org/observations/${obs.id}`

        return (
          <div
            key={obs.id}
            className={styles.row}
            style={{ animationDelay: `${Math.min(i * 0.025, 0.8)}s` }}
            onClick={() => onSelect(obs)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onSelect(obs)}
          >
            {photo
              ? <img className={styles.thumb} src={photo} alt={scientific} loading="lazy"
                  onError={e => { e.currentTarget.style.display='none'; e.currentTarget.nextSibling.style.display='flex' }} />
              : null}
            <div className={styles.thumbPlaceholder} style={{ display: photo ? 'none' : 'flex' }}>{emoji}</div>

            <div className={styles.names}>
              <div className={`${styles.common} ${!taxon?.preferred_common_name ? styles.unnamed : ''}`}>{common}</div>
              <div className={styles.scientific}>{scientific}</div>
            </div>

            <span className={styles.badge} style={{ background: color }}>{iconicTaxon}</span>
            <div className={styles.date}>{date}</div>

            <a
              className={styles.link}
              href={inatUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
            >↗</a>
          </div>
        )
      })}
    </div>
  )
}
