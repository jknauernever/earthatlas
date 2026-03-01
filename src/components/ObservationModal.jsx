import { useEffect, useState } from 'react'
import { usePostHog } from 'posthog-js/react'
import { getTaxonMeta, formatDate } from '../utils/taxon'
import SpeciesMapModal from './SpeciesMapModal'
import styles from './ObservationModal.module.css'

export default function ObservationModal({ obs, onClose }) {
  const posthog = usePostHog()
  const open = !!obs
  const [showSpeciesMap, setShowSpeciesMap] = useState(false)

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    const handleKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  useEffect(() => { setShowSpeciesMap(false) }, [obs])

  useEffect(() => {
    if (!obs) return
    posthog?.capture('observation_viewed', {
      source: obs.source || 'iNaturalist',
      species: obs.taxon?.preferred_common_name || obs.taxon?.name,
      scientific_name: obs.taxon?.name,
      taxon: obs.taxon?.iconic_taxon_name,
      quality_grade: obs.quality_grade,
      location: obs.place_guess,
    })
  }, [obs, posthog])

  if (!obs) return null

  const isEBird = obs.source === 'eBird'
  const isGBIF  = obs.source === 'GBIF'
  const taxon       = obs.taxon
  const common      = taxon?.preferred_common_name || taxon?.name || 'Unnamed species'
  const scientific  = taxon?.name || ''
  const iconicTaxon = taxon?.iconic_taxon_name || 'default'
  const { color, emoji } = getTaxonMeta(iconicTaxon)
  const photo       = obs.photos?.[0]?.url?.replace('square', 'large')
  const dateStr     = formatDate(obs.observed_on, { weekday:'long', year:'numeric', month:'long', day:'numeric' })

  // Source-specific URLs and fields
  const externalUrl = isEBird
    ? `https://ebird.org/checklist/${obs.id}`
    : isGBIF
    ? `https://www.gbif.org/occurrence/${obs.id}`
    : `https://www.inaturalist.org/observations/${obs.id}`
  const externalLabel = isEBird ? 'View on eBird' : isGBIF ? 'View on GBIF' : 'View on iNaturalist'
  const wikiUrl = isEBird || isGBIF ? null : taxon?.wikipedia_url
  const quality = { research: 'Research Grade', needs_id: 'Needs ID', casual: 'Casual' }[obs.quality_grade] || obs.quality_grade

  const fields = [
    { label: 'Observed', value: dateStr },
    !isEBird && { label: 'Quality Grade', value: quality },
    { label: 'Location', value: obs.place_guess || 'Unknown' },
    !isEBird && { label: 'Observer', value: isGBIF ? (obs.user?.login || 'GBIF Contributor') : `@${obs.user?.login || 'Unknown'}` },
    isEBird && obs.howMany && { label: 'Count', value: `${obs.howMany} individual${obs.howMany !== 1 ? 's' : ''}` },
    !isEBird && taxon?.rank && { label: 'Taxonomic Rank', value: taxon.rank },
    !isEBird && !isGBIF && obs.num_identification_agreements != null && {
      label: 'ID Agreements',
      value: `${obs.num_identification_agreements} / ${obs.num_identification_agreements + (obs.num_identification_disagreements || 0)}`
    },
    isGBIF && {
      label: 'Data Source',
      value: 'GBIF — Global Biodiversity Information Facility',
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
            <a className={`${styles.btn} ${styles.btnPrimary}`} href={externalUrl} target="_blank" rel="noopener noreferrer">
              {externalLabel} ↗
            </a>
            {wikiUrl && (
              <a className={`${styles.btn} ${styles.btnSecondary}`} href={wikiUrl} target="_blank" rel="noopener noreferrer">
                Wikipedia ↗
              </a>
            )}
            {!isEBird && !isGBIF && taxon?.id && (
              <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => { setShowSpeciesMap(true); posthog?.capture('species_map_opened', { species: common, scientific_name: scientific, source: 'observation_modal' }) }}>
                Species Map
              </button>
            )}
          </div>
        </div>
      </div>

      {showSpeciesMap && <SpeciesMapModal taxon={taxon} onClose={() => setShowSpeciesMap(false)} />}
    </div>
  )
}
