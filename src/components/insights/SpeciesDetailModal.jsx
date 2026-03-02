import { useState, useEffect, useCallback } from 'react'
import { fetchSpeciesDetail } from '../../services/insights'
import { getTaxonMeta } from '../../utils/taxon'
import SeasonalityChart from './SeasonalityChart'
import YearTrendChart from './YearTrendChart'
import styles from './SpeciesDetailModal.module.css'

export default function SpeciesDetailModal({ species, dataSource, coords, radiusKm, onClose }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)

  const open = !!species

  // Escape key
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    const handleKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, onClose])

  // Fetch species detail
  useEffect(() => {
    if (!species) return
    setLoading(true)
    setDetail(null)

    fetchSpeciesDetail({
      scientificName: species.scientificName,
      gbifKey: species.key,
      source: dataSource,
      coords,
      radiusKm,
    }).then(data => {
      setDetail(data)
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })
  }, [species, dataSource, coords, radiusKm])

  if (!species) return null

  const { color, emoji } = getTaxonMeta(species.iconicTaxon)
  const displayName = species.commonName || species.scientificName
  const photoUrl = detail?.taxonInfo?.photoUrl || species.photoUrl?.replace('square', 'medium')
  const wikiSummary = detail?.taxonInfo?.wikipediaSummary
  const wikiUrl = detail?.taxonInfo?.wikipediaUrl
  const conservation = detail?.taxonInfo?.conservationStatus

  // External link per source
  const externalUrl = dataSource === 'GBIF'
    ? `https://www.gbif.org/species/${species.key}`
    : dataSource === 'eBird'
      ? `https://ebird.org/species/${species.speciesCode || species.key}`
      : detail?.taxonInfo?.id
        ? `https://www.inaturalist.org/taxa/${detail.taxonInfo.id}`
        : null
  const externalLabel = dataSource === 'GBIF' ? 'GBIF' : dataSource === 'eBird' ? 'eBird' : 'iNaturalist'

  return (
    <div
      className={`${styles.overlay} ${open ? styles.open : ''}`}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className={styles.modal} role="dialog" aria-modal="true">
        {/* Hero image */}
        <div className={styles.hero}>
          {photoUrl
            ? <img className={styles.img} src={photoUrl} alt={species.scientificName} />
            : <div className={styles.imgPlaceholder}>{emoji}</div>}
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {loading ? (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner} />
            <div className={styles.loadingText}>Loading species data</div>
          </div>
        ) : (
          <div className={styles.content}>
            {/* Header */}
            <div className={styles.header}>
              <h2 className={styles.common}>{displayName}</h2>
              <div className={styles.meta}>
                <span className={styles.scientific}>{species.scientificName}</span>
                <span>·</span>
                <span className={styles.tag} style={{ background: color }}>{species.iconicTaxon || 'Other'}</span>
                {conservation && (
                  <span className={styles.conservationTag}>{conservation}</span>
                )}
              </div>
            </div>

            {/* Stat pills */}
            <div className={styles.stats}>
              <div className={styles.stat}>
                <div className={styles.statValue}>{species.count.toLocaleString()}</div>
                <div className={styles.statLabel}>Obs in Area</div>
              </div>
              {detail?.taxonInfo?.rank && (
                <div className={styles.stat}>
                  <div className={styles.statValue}>{detail.taxonInfo.rank}</div>
                  <div className={styles.statLabel}>Taxonomic Rank</div>
                </div>
              )}
              {detail?.taxonInfo?.ancestors?.length > 0 && (
                <div className={styles.stat}>
                  <div className={styles.statValue}>{detail.taxonInfo.ancestors.length}</div>
                  <div className={styles.statLabel}>Ancestor Taxa</div>
                </div>
              )}
            </div>

            {/* Wikipedia summary */}
            {wikiSummary && (
              <div
                className={styles.summary}
                dangerouslySetInnerHTML={{ __html: wikiSummary }}
              />
            )}

            {/* Seasonality histogram */}
            {detail?.seasonality && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Seasonality</h3>
                <p className={styles.sectionSub}>Global observations by month of year</p>
                <SeasonalityChart months={detail.seasonality} loading={false} />
              </div>
            )}

            {/* Year trend — GBIF local */}
            {detail?.yearTrend && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Local Trend</h3>
                <p className={styles.sectionSub}>Observations per year in this area</p>
                <YearTrendChart years={detail.yearTrend} loading={false} />
              </div>
            )}

            {/* Actions */}
            <div className={styles.actions}>
              {externalUrl && (
                <a className={`${styles.btn} ${styles.btnPrimary}`} href={externalUrl} target="_blank" rel="noopener noreferrer">
                  View on {externalLabel} ↗
                </a>
              )}
              {wikiUrl && (
                <a className={`${styles.btn} ${styles.btnSecondary}`} href={wikiUrl} target="_blank" rel="noopener noreferrer">
                  Wikipedia ↗
                </a>
              )}
              {detail?.taxonInfo?.id && dataSource !== 'iNaturalist' && (
                <a className={`${styles.btn} ${styles.btnSecondary}`}
                  href={`https://www.inaturalist.org/taxa/${detail.taxonInfo.id}`}
                  target="_blank" rel="noopener noreferrer">
                  iNaturalist ↗
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
