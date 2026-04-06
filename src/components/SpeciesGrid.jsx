import { useMemo } from 'react'
import SpeciesCard from './SpeciesCard'
import styles from './SpeciesGrid.module.css'

function aggregateBySpecies(observations) {
  const map = {}
  for (const obs of observations) {
    const taxon = obs.taxon
    // Group by species-level name (first two words) so subspecies and
    // cross-source duplicates merge into one entry
    const sciName = taxon?.name?.toLowerCase() || ''
    const key = sciName.split(/\s+/).slice(0, 2).join(' ') || taxon?.id || obs.id
    if (!map[key]) {
      map[key] = {
        taxon,
        count: 0,
        bestPhoto: null,
        firstObs: obs,
      }
    }
    map[key].count++
    if (!map[key].bestPhoto) {
      const photo = obs.photos?.[0]?.url?.replace('square', 'medium')
      if (photo) map[key].bestPhoto = photo
    }
  }
  return Object.values(map).sort((a, b) => b.count - a.count)
}

export default function SpeciesGrid({ observations, onSelect }) {
  const species = useMemo(() => aggregateBySpecies(observations), [observations])

  return (
    <div className={styles.grid}>
      {species.map((sp, i) => (
        <SpeciesCard
          key={sp.taxon?.id || i}
          species={sp}
          index={i}
          onClick={() => onSelect(sp.firstObs)}
        />
      ))}
    </div>
  )
}
