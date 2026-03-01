import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchGlobalCounts, fetchTopSpecies, fetchTopCountries } from '../services/iNaturalist'
import { getTaxonMeta } from '../utils/taxon'
import SpeciesMapModal from './SpeciesMapModal'
import styles from './GlobalStats.module.css'

const COUNTER_INFO = {
  totalObs: {
    title: 'Total Observations',
    text: 'The total number of wildlife observations submitted to iNaturalist by citizen scientists worldwide. Each observation represents a single encounter with an organism, documented with a photo, location, and date.',
  },
  totalSpecies: {
    title: 'Species Documented',
    text: 'The number of distinct species that have been identified across all iNaturalist observations. This includes animals, plants, fungi, and other organisms verified through community identification.',
  },
  researchGrade: {
    title: 'Research Grade',
    text: 'Observations that meet iNaturalist\'s quality criteria: they have a photo, date, coordinates, and the community agrees on the species identification. Research-grade data is shared with scientific databases like GBIF.',
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
          <div className={styles.infoSource}>Source: <a href="https://www.inaturalist.org" target="_blank" rel="noopener noreferrer">iNaturalist.org</a></div>
        </div>
      )}
    </span>
  )
}

const TIME_OPTIONS = [
  { key: 'all',   label: 'All Time' },
  { key: '30d',   label: 'Last 30 Days' },
  { key: '24h',   label: '24 Hours' },
]

function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getDateRange(key) {
  if (key === 'all') return {}
  const now = new Date()
  const d2 = localDate(now)
  const d = new Date(now)
  if (key === '24h') d.setDate(d.getDate() - 1)
  else if (key === '30d') d.setDate(d.getDate() - 30)
  return { d1: localDate(d), d2 }
}

export default function GlobalStats() {
  const [counts, setCounts] = useState(null)
  const [topSpecies, setTopSpecies] = useState(null)
  const [topCountries, setTopCountries] = useState(null)
  const [speciesTime, setSpeciesTime] = useState('24h')
  const [speciesLoading, setSpeciesLoading] = useState(true)
  const [countriesTime, setCountriesTime] = useState('24h')
  const [countriesLoading, setCountriesLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [selectedTaxon, setSelectedTaxon] = useState(null)
  const [activeInfo, setActiveInfo] = useState(null)

  // Fetch global counts on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const c = await fetchGlobalCounts()
        if (!cancelled) setCounts(c)
      } catch {
        // Silently fail
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Fetch top species when time toggle changes
  const loadSpecies = useCallback(async (timeKey) => {
    setSpeciesLoading(true)
    try {
      const range = getDateRange(timeKey)
      const data = await fetchTopSpecies(8, range)
      setTopSpecies(data)
    } catch {
      // Silently fail
    } finally {
      setSpeciesLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSpecies(speciesTime)
  }, [speciesTime, loadSpecies])

  // Fetch top countries when time toggle changes
  const loadCountries = useCallback(async (timeKey) => {
    setCountriesLoading(true)
    try {
      const range = getDateRange(timeKey)
      const data = await fetchTopCountries(range)
      setTopCountries(data)
    } catch {
      // Silently fail
    } finally {
      setCountriesLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCountries(countriesTime)
  }, [countriesTime, loadCountries])

  if (loading) {
    return (
      <div className={styles.wrap}>
        <div className={styles.counters}>
          {[0, 1, 2].map(i => (
            <div key={i} className={`${styles.shimmer} ${styles.shimmerCounter}`} />
          ))}
        </div>
        <div className={styles.speciesGrid}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
            <div key={i} className={`${styles.shimmer} ${styles.shimmerCard}`} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      {/* Stat counters */}
      {counts && (
        <div className={styles.counters}>
          <div className={styles.counter}>
            <div className={styles.counterValue}>{counts.totalObs.toLocaleString()}</div>
            <div className={styles.counterLabel}>
              Total Observations
              <InfoIcon statKey="totalObs" activeInfo={activeInfo} setActiveInfo={setActiveInfo} />
            </div>
          </div>
          <div className={styles.counter}>
            <div className={styles.counterValue}>{counts.totalSpecies.toLocaleString()}</div>
            <div className={styles.counterLabel}>
              Species Documented
              <InfoIcon statKey="totalSpecies" activeInfo={activeInfo} setActiveInfo={setActiveInfo} />
            </div>
          </div>
          <div className={styles.counter}>
            <div className={styles.counterValue}>{counts.researchGrade.toLocaleString()}</div>
            <div className={styles.counterLabel}>
              Research Grade
              <InfoIcon statKey="researchGrade" activeInfo={activeInfo} setActiveInfo={setActiveInfo} />
            </div>
          </div>
        </div>
      )}

      {/* Top species */}
      <div>
        <div className={styles.sectionRow}>
          <div>
            <h2 className={styles.sectionHeader}>Most Observed Species</h2>
            <p className={styles.sectionSub}>Globally on iNaturalist</p>
          </div>
          <div className={styles.timePills}>
            {TIME_OPTIONS.map(opt => (
              <button
                key={opt.key}
                className={`${styles.timePill} ${speciesTime === opt.key ? styles.timePillActive : ''}`}
                onClick={() => setSpeciesTime(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.speciesGrid} style={{ marginTop: 16 }}>
          {speciesLoading ? (
            [...Array(8)].map((_, i) => (
              <div key={i} className={`${styles.shimmer} ${styles.shimmerCard}`} />
            ))
          ) : topSpecies && topSpecies.map((item, i) => {
            const t = item.taxon
            const common = t.preferred_common_name || t.name
            const scientific = t.name
            const iconic = t.iconic_taxon_name || 'default'
            const { color, emoji } = getTaxonMeta(iconic)
            const photo = t.default_photo?.square_url

            return (
              <div key={t.id} className={styles.speciesCard} onClick={() => setSelectedTaxon(t)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setSelectedTaxon(t)} style={{ cursor: 'pointer' }}>
                <span className={styles.rank}>{i + 1}</span>
                {photo
                  ? <img className={styles.speciesPhoto} src={photo} alt={scientific} loading="lazy" />
                  : <div className={styles.speciesPhotoPlaceholder}>{emoji}</div>}
                <div className={styles.speciesInfo}>
                  <div className={styles.speciesCommon}>{common}</div>
                  <div className={styles.speciesScientific}>{scientific}</div>
                  <div className={styles.speciesCount}>{item.count.toLocaleString()} obs</div>
                </div>
                <span className={styles.badge} style={{ background: color }}>{iconic}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Top countries */}
      <div>
        <div className={styles.sectionRow}>
          <div>
            <h2 className={styles.sectionHeader}>Top Reporting Countries</h2>
            <p className={styles.sectionSub}>Ranked by observation count</p>
          </div>
          <div className={styles.timePills}>
            {TIME_OPTIONS.map(opt => (
              <button
                key={opt.key}
                className={`${styles.timePill} ${countriesTime === opt.key ? styles.timePillActive : ''}`}
                onClick={() => setCountriesTime(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.countriesList} style={{ marginTop: 16 }}>
          {countriesLoading ? (
            [...Array(10)].map((_, i) => (
              <div key={i} className={`${styles.shimmer} ${styles.shimmerCountry}`} />
            ))
          ) : topCountries && topCountries.map((c, i) => (
            <div key={c.placeId} className={styles.countryRow}>
              <span className={styles.rank}>{i + 1}</span>
              <span className={styles.countryFlag}>{c.flag}</span>
              <span className={styles.countryName}>{c.name}</span>
              <span className={styles.countryBar}>
                <span
                  className={styles.countryBarFill}
                  style={{ width: `${(c.count / topCountries[0].count) * 100}%` }}
                />
              </span>
              <span className={styles.countryCount}>{c.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      <SpeciesMapModal taxon={selectedTaxon} onClose={() => setSelectedTaxon(null)} />
    </div>
  )
}
