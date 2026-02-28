import SpeciesCard from './SpeciesCard'
import styles from './SpeciesGrid.module.css'

export default function SpeciesGrid({ observations, onSelect }) {
  return (
    <div className={styles.grid}>
      {observations.map((obs, i) => (
        <SpeciesCard
          key={obs.id}
          obs={obs}
          index={i}
          onClick={() => onSelect(obs)}
        />
      ))}
    </div>
  )
}
