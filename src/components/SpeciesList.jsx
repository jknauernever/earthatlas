import { useMemo } from 'react'
import { getTaxonMeta } from '../utils/taxon'
import styles from './SpeciesList.module.css'

function aggregateBySpecies(observations) {
  const map = {}
  for (const obs of observations) {
    const taxon = obs.taxon
    const sciName = taxon?.name?.toLowerCase() || ''
    const key = sciName.split(/\s+/).slice(0, 2).join(' ') || taxon?.id || obs.id
    if (!map[key]) {
      map[key] = {
        taxon,
        count: 0,
        bestPhoto: null,
      }
    }
    map[key].count++
    if (!map[key].bestPhoto) {
      const photo = obs.photos?.[0]?.url?.replace('square', 'small')
      if (photo) map[key].bestPhoto = photo
    }
  }
  return Object.values(map).sort((a, b) => b.count - a.count)
}

export default function SpeciesList({ observations, onSelect }) {
  const species = useMemo(() => aggregateBySpecies(observations), [observations])

  return (
    <div className={styles.list}>
      {species.map((sp, i) => {
        const taxon = sp.taxon
        const common = taxon?.preferred_common_name || taxon?.name || 'Unnamed species'
        const scientific = taxon?.name || ''
        const iconicTaxon = taxon?.iconic_taxon_name || 'default'
        const { emoji } = getTaxonMeta(iconicTaxon)
        const photo = sp.bestPhoto

        // Find first observation for this species to pass to onSelect
        const firstObs = observations.find(o => o.taxon?.name && taxon?.name && o.taxon.name.toLowerCase() === taxon.name.toLowerCase())

        return (
          <div
            key={taxon?.id || i}
            className={styles.row}
            style={{ animationDelay: `${Math.min(i * 0.025, 0.8)}s` }}
            onClick={() => onSelect(firstObs)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onSelect(firstObs)}
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

            <span className={styles.count}>{sp.count}</span>
          </div>
        )
      })}
    </div>
  )
}
