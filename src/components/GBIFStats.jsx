import { useState, useEffect, useRef } from 'react'
import { usePostHog } from 'posthog-js/react'
import { fetchGBIFGlobalStats, fetchGBIFTopCountries, fetchGBIFKingdomCounts } from '../services/gbif'
import styles from './GBIFStats.module.css'

const COUNTER_INFO = {
  occurrences: {
    title: 'Total Occurrences',
    text: 'The total number of biodiversity occurrence records aggregated in GBIF from thousands of institutions, citizen science platforms, and research collections worldwide.',
  },
  species: {
    title: 'Species in GBIF',
    text: 'The number of accepted species-level taxa in the GBIF backbone taxonomy, spanning all kingdoms of life — animals, plants, fungi, bacteria, and more.',
  },
  datasets: {
    title: 'Contributing Datasets',
    text: 'The number of distinct datasets published to GBIF by museums, herbaria, citizen science platforms (like iNaturalist and eBird), government agencies, and research institutions.',
  },
}

function InfoIcon({ statKey, activeInfo, setActiveInfo }) {
  const ref = useRef(null)
  const isOpen = activeInfo === statKey
  const info = COUNTER_INFO[statKey]

  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setActiveInfo(null)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen, setActiveInfo])

  return (
    <span className={styles.infoWrap} ref={ref}>
      <button
        className={`${styles.infoBtn} ${isOpen ? styles.infoBtnActive : ''}`}
        onClick={(e) => { e.stopPropagation(); setActiveInfo(isOpen ? null : statKey) }}
        aria-label={`About ${info.title}`}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <text x="8" y="12" textAnchor="middle" fill="currentColor" fontSize="10" fontWeight="700" fontFamily="var(--font-serif)">i</text>
        </svg>
      </button>
      {isOpen && (
        <div className={styles.infoPopover}>
          <div className={styles.infoTitle}>{info.title}</div>
          <div className={styles.infoText}>{info.text}</div>
          <div className={styles.infoSource}>Source: <a href="https://www.gbif.org" target="_blank" rel="noopener noreferrer">GBIF.org</a></div>
        </div>
      )}
    </span>
  )
}

function formatBillions(n) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  return n.toLocaleString()
}

export default function GBIFStats() {
  const posthog = usePostHog()
  const [stats, setStats] = useState(null)
  const [countries, setCountries] = useState(null)
  const [kingdoms, setKingdoms] = useState(null)
  const [loading, setLoading] = useState(true)
  const [countriesLoading, setCountriesLoading] = useState(true)
  const [kingdomsLoading, setKingdomsLoading] = useState(true)
  const [activeInfo, setActiveInfo] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const s = await fetchGBIFGlobalStats()
        if (!cancelled) setStats(s)
      } catch { /* silently fail */ }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const c = await fetchGBIFTopCountries(12)
        if (!cancelled) setCountries(c)
      } catch { /* silently fail */ }
      finally { if (!cancelled) setCountriesLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const k = await fetchGBIFKingdomCounts()
        if (!cancelled) setKingdoms(k)
      } catch { /* silently fail */ }
      finally { if (!cancelled) setKingdomsLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className={styles.wrap}>
        <div className={styles.counters}>
          {[0, 1, 2].map(i => (
            <div key={i} className={`${styles.shimmer} ${styles.shimmerCounter}`} />
          ))}
        </div>
        <div className={styles.regionsList}>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className={`${styles.shimmer} ${styles.shimmerRegion}`} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      {/* Stat counters */}
      {stats && (
        <div className={styles.counters}>
          <div className={styles.counter}>
            <div className={styles.counterValue}>{formatBillions(stats.totalOccurrences)}</div>
            <div className={styles.counterLabel}>
              Total Occurrences
              <InfoIcon statKey="occurrences" activeInfo={activeInfo} setActiveInfo={setActiveInfo} />
            </div>
          </div>
          <div className={styles.counter}>
            <div className={styles.counterValue}>{formatBillions(stats.totalSpecies)}</div>
            <div className={styles.counterLabel}>
              Species in GBIF
              <InfoIcon statKey="species" activeInfo={activeInfo} setActiveInfo={setActiveInfo} />
            </div>
          </div>
          <div className={styles.counter}>
            <div className={styles.counterValue}>{stats.totalDatasets.toLocaleString()}</div>
            <div className={styles.counterLabel}>
              Contributing Datasets
              <InfoIcon statKey="datasets" activeInfo={activeInfo} setActiveInfo={setActiveInfo} />
            </div>
          </div>
        </div>
      )}

      {/* Kingdoms breakdown */}
      <div>
        <div className={styles.sectionRow}>
          <div>
            <h2 className={styles.sectionHeader}>Occurrences by Kingdom</h2>
            <p className={styles.sectionSub}>All time on GBIF</p>
          </div>
        </div>
        <div className={styles.kingdomGrid} style={{ marginTop: 16 }}>
          {kingdomsLoading ? (
            [...Array(5)].map((_, i) => (
              <div key={i} className={`${styles.shimmer} ${styles.shimmerKingdom}`} />
            ))
          ) : kingdoms && kingdoms.map((k) => (
            <div key={k.key} className={styles.kingdomCard}>
              <span className={styles.kingdomEmoji}>{k.emoji}</span>
              <div className={styles.kingdomInfo}>
                <div className={styles.kingdomName}>{k.name}</div>
                <div className={styles.kingdomCount}>{formatBillions(k.count)} occurrences</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top countries */}
      <div>
        <div className={styles.sectionRow}>
          <div>
            <h2 className={styles.sectionHeader}>Top Countries by Occurrences</h2>
            <p className={styles.sectionSub}>All time on GBIF</p>
          </div>
        </div>
        <div className={styles.regionsList} style={{ marginTop: 16 }}>
          {countriesLoading ? (
            [...Array(10)].map((_, i) => (
              <div key={i} className={`${styles.shimmer} ${styles.shimmerRegion}`} />
            ))
          ) : countries && countries.map((c, i) => (
            <div key={c.code} className={styles.regionRow}>
              <span className={styles.rank}>{i + 1}</span>
              <span className={styles.regionFlag}>{c.flag}</span>
              <span className={styles.regionName}>{c.name}</span>
              <span className={styles.regionBar}>
                <span
                  className={styles.regionBarFill}
                  style={{ width: `${(c.count / countries[0].count) * 100}%` }}
                />
              </span>
              <span className={styles.regionCount}>{formatBillions(c.count)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
