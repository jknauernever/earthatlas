import { TAXON_FILTER_OPTIONS } from '../utils/taxon'
import styles from './TaxonFilter.module.css'

export default function TaxonFilter({ activeTaxon, onChange }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>Filter ›</span>
      {TAXON_FILTER_OPTIONS.map(opt => (
        <button
          key={opt.key}
          className={`${styles.pill} ${activeTaxon === opt.key ? styles.active : ''} ${styles['taxon_' + opt.key]}`}
          onClick={() => onChange(opt.key)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
