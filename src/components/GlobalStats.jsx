import { useState, useEffect, useCallback, useRef } from 'react'
import { usePostHog } from 'posthog-js/react'
import { fetchGlobalCounts, fetchTopSpecies, fetchTopCountries } from '../services/iNaturalist'
import { fetchGBIFGlobalStats } from '../services/gbif'
import { fetchEBirdDashboardStats } from '../services/eBird'
import { getTaxonMeta } from '../utils/taxon'
import SpeciesMapModal from './SpeciesMapModal'
import styles from './GlobalStats.module.css'
import preloaded from '../data/preloaded-stats.json'

const PRE_INAT = preloaded?.iNaturalist || {}

const COUNTER_INFO_INAT = {
  totalObs: {
    title: 'Total Observations',
    text: 'The total number of wildlife observations submitted to iNaturalist by citizen scientists worldwide. Each observation represents a single encounter with an organism, documented with a photo, location, and date.',
  },
  totalSpecies: {
    title: 'Species Documented',
    text: 'The number of distinct species that have been identified across all iNaturalist observations. This includes animals, plants, fungi, and other organisms verified through community identification.',
  },
  activeObservers: {
    title: 'Active Observers (90 Days)',
    text: 'Unique people who have submitted at least one observation to iNaturalist in the past 90 days. Each observer contributes photos, locations, and identifications to the global biodiversity record.',
  },
}

const COUNTER_INFO_ALL = {
  totalObs: {
    title: 'Total Occurrences',
    text: 'Biodiversity occurrence records aggregated by GBIF from hundreds of data sources worldwide — including iNaturalist, eBird, museum collections, and research institutions.',
  },
  totalSpecies: {
    title: 'Species Documented',
    text: 'Distinct species identified across all iNaturalist observations, verified through community identification. Includes animals, plants, fungi, and other organisms.',
  },
  activeObservers: {
    title: 'Active Observers (90 Days)',
    text: 'Unique people who have submitted at least one observation to iNaturalist in the past 90 days. Each observer contributes photos, locations, and identifications to the global biodiversity record.',
  },
}

function InfoIcon({ statKey, activeInfo, setActiveInfo, counterInfo }) {
  const ref = useRef(null)
  const isOpen = activeInfo === statKey
  const info = counterInfo[statKey]

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
          <div className={styles.infoSource}>Source: <a href="https://www.gbif.org" target="_blank" rel="noopener noreferrer">GBIF</a>, <a href="https://www.inaturalist.org" target="_blank" rel="noopener noreferrer">iNaturalist</a>, <a href="https://ebird.org" target="_blank" rel="noopener noreferrer">eBird</a></div>
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
  const d = new Date()
  if (key === '24h') d.setDate(d.getDate() - 1)
  else if (key === '30d') d.setDate(d.getDate() - 30)
  return { d1: localDate(d) }
}

export default function GlobalStats({ dataSource = 'iNaturalist' }) {
  const posthog = usePostHog()
  const [counts, setCounts] = useState(PRE_INAT.counts || null)
  const [topSpecies, setTopSpecies] = useState(PRE_INAT.topSpecies || null)
  const [topCountries, setTopCountries] = useState(PRE_INAT.topCountries || null)
  const [speciesTime, setSpeciesTime] = useState('24h')
  const [speciesLoading, setSpeciesLoading] = useState(!PRE_INAT.topSpecies)
  const [countriesTime, setCountriesTime] = useState('24h')
  const [countriesLoading, setCountriesLoading] = useState(!PRE_INAT.topCountries)
  const [loading, setLoading] = useState(!PRE_INAT.counts)
  const [selectedTaxon, setSelectedTaxon] = useState(null)
  const [activeInfo, setActiveInfo] = useState(null)

  // Fetch global counts on mount — aggregate across sources when "All"
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        if (dataSource === 'All') {
          const [inat, gbif] = await Promise.all([
            fetchGlobalCounts().catch(() => null),
            fetchGBIFGlobalStats().catch(() => null),
          ])
          if (!cancelled) {
            // GBIF totalOccurrences is the superset (includes iNat + eBird + museums)
            // Use iNat species count — it's community-verified and more meaningful than GBIF backbone count
            setCounts({
              totalObs: (gbif?.totalOccurrences || 0),
              totalSpecies: (inat?.totalSpecies || 0),
              activeObservers: (inat?.activeObservers || 0),
            })
          }
        } else {
          const c = await fetchGlobalCounts()
          if (!cancelled) setCounts(c)
        }
      } catch {
        // Silently fail
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [dataSource])

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

  const isAll = dataSource === 'All'
  const counterInfo = isAll ? COUNTER_INFO_ALL : COUNTER_INFO_INAT

  return (
    <div className={styles.wrap}>
      {/* Stat counters */}
      {(counts || loading) && (
        <div className={styles.counters}>
          <div className={styles.counter}>
            <div className={styles.counterValue}>{loading ? '…' : (counts.totalObs ?? 0).toLocaleString()}</div>
            <div className={styles.counterLabel}>
              Total Occurrences
              <InfoIcon statKey="totalObs" activeInfo={activeInfo} setActiveInfo={setActiveInfo} counterInfo={counterInfo} />
            </div>
          </div>
          <div className={styles.counter}>
            <div className={styles.counterValue}>{loading ? '…' : (counts.totalSpecies ?? 0).toLocaleString()}</div>
            <div className={styles.counterLabel}>
              Species Documented
              <InfoIcon statKey="totalSpecies" activeInfo={activeInfo} setActiveInfo={setActiveInfo} counterInfo={counterInfo} />
            </div>
          </div>
          <div className={styles.counter}>
            <div className={styles.counterValue}>{loading ? '…' : (counts.activeObservers ?? 0).toLocaleString()}</div>
            <div className={styles.counterLabel}>
              Active Observers in the Last 90 Days
              <InfoIcon statKey="activeObservers" activeInfo={activeInfo} setActiveInfo={setActiveInfo} counterInfo={counterInfo} />
            </div>
          </div>
        </div>
      )}

      {/* Explore subsites */}
      <div>
        <div className={styles.sectionRow}>
          <div>
            <h2 className={styles.sectionHeader}>Explore by Group</h2>
            <p className={styles.sectionSub}>Specialized sighting explorers</p>
          </div>
        </div>
        <div className={styles.subsiteGrid} style={{ marginTop: 16 }}>
          {[
            { slug: 'tigers', name: 'Tigers', emoji: '🐯', image: '/tiger-hero.jpg', desc: 'Tiger sightings across Asia' },
            { slug: 'lions', name: 'Lions', emoji: '🦁', image: '/lion-hero.jpg', desc: 'Lion sightings across Africa & Asia' },
            { slug: 'sharks', name: 'Sharks', emoji: '🦈', image: '/shark-hero.jpg', desc: 'Shark encounters & data' },
            { slug: 'dolphins', name: 'Dolphins', emoji: '🐬', image: '/dolphin-hero.jpg', desc: 'Dolphin sightings worldwide' },
            { slug: 'elephants', name: 'Elephants', emoji: '🐘', image: '/elephant-hero.jpg', desc: 'Elephant sightings & data' },
            { slug: 'bears', name: 'Bears', emoji: '🐻', image: '/bear-hero.jpg', desc: 'Bear sightings worldwide' },
            { slug: 'monkeys', name: 'Monkeys & Primates', emoji: '🐒', image: '/monkey-hero.jpg', desc: 'Primate sightings & data' },
            { slug: 'whales', name: 'Whales', emoji: '🐋', image: '/whale-hero.jpg', desc: 'Cetacean sightings worldwide' },
            { slug: 'hippos', name: 'Hippos', emoji: '🦛', image: '/hippo-hero.jpg', desc: 'Hippo sightings in Africa' },
            { slug: 'wolves', name: 'Wolves', emoji: '🐺', image: '/wolf-hero.jpg', desc: 'Wolf & wild canid sightings' },
            { slug: 'butterflies', name: 'Butterflies', emoji: '🦋', image: '/butterfly-hero.jpg', desc: 'Lepidoptera near you' },
            { slug: 'condors', name: 'Condors', emoji: '🦅', image: '/condor-hero.jpg', desc: 'Condor sightings across the Americas' },
            { slug: 'sloths', name: 'Sloths', emoji: '🦥', image: '/sloth-hero.jpg', desc: 'Sloth sightings in Central & South America' },
          ].map(site => (
            <a key={site.slug} href={`/${site.slug}`} className={styles.subsiteCard}>
              <img className={styles.subsiteImg} src={site.image} alt={site.name} loading="lazy" />
              <div className={styles.subsiteOverlay}>
                <div className={styles.subsiteEmoji}>{site.emoji}</div>
                <div className={styles.subsiteName}>{site.name}</div>
                <div className={styles.subsiteDesc}>{site.desc}</div>
              </div>
            </a>
          ))}
        </div>
      </div>

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
                onClick={() => { setSpeciesTime(opt.key); posthog?.capture('species_time_changed', { time_filter: opt.key }) }}
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
              <div key={t.id} className={styles.speciesCard} onClick={() => { setSelectedTaxon(t); posthog?.capture('species_card_clicked', { species: common, scientific_name: scientific, taxon: iconic, rank: i + 1 }) }} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') { setSelectedTaxon(t); posthog?.capture('species_card_clicked', { species: common, scientific_name: scientific, taxon: iconic, rank: i + 1 }) } }} style={{ cursor: 'pointer' }}>
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
                onClick={() => { setCountriesTime(opt.key); posthog?.capture('countries_time_changed', { time_filter: opt.key }) }}
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
