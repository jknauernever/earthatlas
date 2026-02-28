import { useEffect } from 'react'
import { getTaxonMeta, formatDate } from '../utils/taxon'
import styles from './ObservationModal.module.css'

export default function ObservationModal({ obs, onClose }) {
  const open = !!obs

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    const handleKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!obs) return null

  const taxon       = obs.taxon
  const common      = taxon?.preferred_common_name || taxon?.name || 'Unnamed species'
  const scientific  = taxon?.name || ''
  const iconicTaxon = taxon?.iconic_taxon_name || 'default'
  const { color, emoji } = getTaxonMeta(iconicTaxon)
  const photo       = obs.photos?.[0]?.url?.replace('square', 'large')
  const inatUrl     = `https://www.inaturalist.org/observations/${obs.id}`
  const wikiUrl     = taxon?.wikipedia_url
  const dateStr     = formatDate(obs.observed_on, { weekday:'long', year:'numeric', month:'long', day:'numeric' })
  const quality     = { research: 'Research Grade', needs_id: 'Needs ID', casual: 'Casual' }[obs.quality_grade] || obs.quality_grade

  const fields = [
    { label: 'Observed',       value: dateStr },
    { label: 'Quality Grade',  value: quality },
    { label: 'Location',       value: obs.place_guess || 'Unknown' },
    { label: 'Observer',       value: `@${obs.user?.login || 'Unknown'}` },
    taxon?.rank && { label: 'Taxonomic Rank', value: taxon.rank },
    obs.num_identification_agreements != null && {
      label: 'ID Agreements',
      value: `${obs.num_identification_agreements} / ${obs.num_identification_agreements + (obs.num_identification_disagreements || 0)}`
    },
  ].filter(Boolean)

  return (
    <div
      className={`${styles.overlay} ${open ? styles.open : ''}`}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className={styles.modal} role="dialog" aria-modal="true">
        {/* Image */}
        {photo
          ? <img className={styles.img} src={photo} alt={scientific} />
          : <div className={styles.imgPlaceholder}>{emoji}</div>}

        <div className={styles.content}>
          {/* Header */}
          <div className={styles.header}>
            <div className={styles.titles}>
              <h2 className={styles.common}>{common}</h2>
              <p className={styles.scientific}>
                <em>{scientific}</em>
                &nbsp;·&nbsp;
                <span className={styles.taxonTag} style={{ background: color }}>{iconicTaxon}</span>
              </p>
            </div>
            <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
          </div>

          {/* Fields */}
          <div className={styles.grid}>
            {fields.map(f => (
              <div key={f.label} className={styles.field}>
                <div className={styles.fieldLabel}>{f.label}</div>
                <div className={styles.fieldValue}>{f.value}</div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className={styles.actions}>
            <a className={`${styles.btn} ${styles.btnPrimary}`} href={inatUrl} target="_blank" rel="noopener noreferrer">
              View on iNaturalist ↗
            </a>
            {wikiUrl && (
              <a className={`${styles.btn} ${styles.btnSecondary}`} href={wikiUrl} target="_blank" rel="noopener noreferrer">
                Wikipedia ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
