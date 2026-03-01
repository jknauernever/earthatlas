import { useState, useEffect, useCallback, useRef } from 'react'
import { usePostHog } from 'posthog-js/react'
import { fetchEBirdTaxonomy, fetchEBirdDashboardStats } from '../services/eBird'
import styles from './EBirdStats.module.css'

const COUNTER_INFO = {
  species: {
    title: 'Total Known Species in eBird',
    text: 'The total number of bird species in the eBird taxonomy. eBird maintains the most comprehensive global bird checklist, updated annually by ornithologists at the Cornell Lab of Ornithology.',
  },
  checklists: {
    title: "Today's Checklists",
    text: 'The number of bird checklists submitted to eBird today across tracked regions. Each checklist represents a birding session where an observer recorded every bird species they identified.',
  },
  speciesReported: {
    title: 'Species Reported',
    text: 'The number of unique bird species reported to eBird across tracked regions. This reflects the breadth of birding activity and species diversity captured by citizen scientists each day.',
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
          <div className={styles.infoSource}>Source: <a href="https://ebird.org" target="_blank" rel="noopener noreferrer">eBird.org</a></div>
        </div>
      )}
    </span>
  )
}

const DATE_OPTIONS = [
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
]

function getStatsDate(key) {
  const d = new Date()
  if (key === 'yesterday') d.setDate(d.getDate() - 1)
  return d
}

export default function EBirdStats() {
  const posthog = usePostHog()
  const [speciesCount, setSpeciesCount] = useState(null)
  const [dashStats, setDashStats] = useState(null)
  const [dateKey, setDateKey] = useState('yesterday') // yesterday usually has more complete data
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)
  const [activeInfo, setActiveInfo] = useState(null)

  // Fetch taxonomy count on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const taxonomy = await fetchEBirdTaxonomy()
        if (!cancelled) setSpeciesCount(taxonomy.length)
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Fetch regional stats when date changes
  const loadStats = useCallback(async (key) => {
    setStatsLoading(true)
    try {
      const date = getStatsDate(key)
      const data = await fetchEBirdDashboardStats(date)
      setDashStats(data)
    } catch {
      // silently fail
    } finally {
      setStatsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStats(dateKey)
  }, [dateKey, loadStats])

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
      <div className={styles.counters}>
        <div className={styles.counter}>
          <div className={styles.counterValue}>{speciesCount ? speciesCount.toLocaleString() : '—'}</div>
          <div className={styles.counterLabel}>
            Total Known Species
            <InfoIcon statKey="species" activeInfo={activeInfo} setActiveInfo={setActiveInfo} />
          </div>
        </div>
        <div className={styles.counter}>
          <div className={styles.counterValue}>
            {dashStats ? dashStats.totalChecklists.toLocaleString() : '—'}
          </div>
          <div className={styles.counterLabel}>
            {dateKey === 'today' ? "Today's" : "Yesterday's"} Checklists
            <InfoIcon statKey="checklists" activeInfo={activeInfo} setActiveInfo={setActiveInfo} />
          </div>
        </div>
        <div className={styles.counter}>
          <div className={styles.counterValue}>
            {dashStats ? dashStats.totalSpecies.toLocaleString() : '—'}
          </div>
          <div className={styles.counterLabel}>
            {dateKey === 'today' ? "Today's" : "Yesterday's"} Species Reported
            <InfoIcon statKey="speciesReported" activeInfo={activeInfo} setActiveInfo={setActiveInfo} />
          </div>
        </div>
      </div>

      {/* Top birding regions */}
      <div>
        <div className={styles.sectionRow}>
          <div>
            <h2 className={styles.sectionHeader}>Top Birding Regions</h2>
            <p className={styles.sectionSub}>eBird checklists by country</p>
          </div>
          <div className={styles.timePills}>
            {DATE_OPTIONS.map(opt => (
              <button
                key={opt.key}
                className={`${styles.timePill} ${dateKey === opt.key ? styles.timePillActive : ''}`}
                onClick={() => { setDateKey(opt.key); posthog?.capture('ebird_date_changed', { date_filter: opt.key }) }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.regionsList} style={{ marginTop: 16 }}>
          {statsLoading ? (
            [...Array(10)].map((_, i) => (
              <div key={i} className={`${styles.shimmer} ${styles.shimmerRegion}`} />
            ))
          ) : dashStats && dashStats.regions.map((r, i) => (
            <div key={r.code} className={styles.regionRow}>
              <span className={styles.rank}>{i + 1}</span>
              <span className={styles.regionFlag}>{r.flag}</span>
              <span className={styles.regionName}>{r.name}</span>
              <span className={styles.regionBar}>
                <span
                  className={styles.regionBarFill}
                  style={{ width: `${(r.numChecklists / dashStats.regions[0].numChecklists) * 100}%` }}
                />
              </span>
              <span className={styles.regionMeta}>
                <span className={styles.regionChecklists}>{r.numChecklists.toLocaleString()}</span>
                <span className={styles.regionSpecies}>{r.numSpecies} spp</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
