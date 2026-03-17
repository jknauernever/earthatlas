/**
 * FeedPanel — "Latest" tab with newspaper/magazine layout.
 *
 * Two modes:
 *   compact  — 5 items in the 360px right panel, with "Expand" button
 *   expanded — rich editorial grid taking 3/4 of the page
 *
 * Mixes live iNat sightings (refreshed every 90s) with
 * news articles (refreshed every 20 min) in a unified feed.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchLatestINat, fetchNews } from '../services/feedService'
import styles from './FeedPanel.module.css'

const INAT_INTERVAL = 90_000
const NEWS_INTERVAL = 1_200_000

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return dateStr }
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric'
    })
  } catch { return dateStr }
}

export default function FeedPanel({ inatTaxonId, newsQuery, speciesSlug, accentColor, expanded, onToggleExpand }) {
  const [sightings, setSightings] = useState([])
  const [news, setNews] = useState([])
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  const loadSightings = useCallback(async () => {
    const items = await fetchLatestINat({ inatTaxonId, perPage: expanded ? 30 : 10 })
    if (mountedRef.current) setSightings(items)
  }, [inatTaxonId, expanded])

  const loadNews = useCallback(async () => {
    const items = await fetchNews({ newsQuery, speciesSlug, count: expanded ? 10 : 5 })
    if (mountedRef.current) setNews(items)
  }, [newsQuery, speciesSlug, expanded])

  useEffect(() => {
    mountedRef.current = true
    setLoading(true)

    Promise.all([loadSightings(), loadNews()]).then(() => {
      if (mountedRef.current) setLoading(false)
    })

    const inatTimer = setInterval(loadSightings, INAT_INTERVAL)
    const newsTimer = setInterval(loadNews, NEWS_INTERVAL)

    return () => {
      mountedRef.current = false
      clearInterval(inatTimer)
      clearInterval(newsTimer)
    }
  }, [loadSightings, loadNews])

  // Merge and sort by date, newest first
  const feed = [...sightings, ...news].sort((a, b) => {
    if (!a.date && !b.date) return 0
    if (!a.date) return 1
    if (!b.date) return -1
    return b.date.localeCompare(a.date)
  })

  if (loading && feed.length === 0) {
    return (
      <div className={styles.feedPanel}>
        <div className={styles.shimmerGrid}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={styles.shimmer} style={{ animationDelay: `${i * 0.12}s` }} />
          ))}
        </div>
      </div>
    )
  }

  if (feed.length === 0) {
    return (
      <div className={styles.feedPanel}>
        <div className={styles.empty}>No recent activity found</div>
      </div>
    )
  }

  if (expanded) {
    return <ExpandedFeed feed={feed} accentColor={accentColor} onCollapse={onToggleExpand} />
  }

  return <CompactFeed feed={feed} accentColor={accentColor} onExpand={onToggleExpand} />
}

/* ─── Compact mode (right panel, 360px) ──────────────────────────────────────── */

function CompactFeed({ feed, accentColor, onExpand }) {
  const items = feed.slice(0, 5)

  return (
    <div className={styles.feedPanel}>
      <div className={styles.compactHeader}>
        <div className={styles.compactRule} />
        <div className={styles.compactDateline}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </div>
      </div>

      {items.map((item, i) => (
        <CompactItem key={item.id} item={item} accentColor={accentColor} featured={i === 0} />
      ))}

      {feed.length > 5 && (
        <button className={styles.expandBtn} onClick={onExpand}>
          <span className={styles.expandBtnIcon}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 5h5V1M13 9H8v4M1 5l4-4M13 9l-4 4" />
            </svg>
          </span>
          View full feed
          <span className={styles.expandBtnCount}>{feed.length} items</span>
        </button>
      )}
    </div>
  )
}

function CompactItem({ item, accentColor, featured }) {
  const hasImage = item.type === 'sighting' ? item.thumb : item.image
  const isSighting = item.type === 'sighting'

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`${styles.compactItem} ${featured ? styles.compactItemFeatured : ''}`}
    >
      {featured && hasImage && (
        <div className={styles.compactFeaturedImage}>
          <img src={item.type === 'sighting' ? item.photo || item.thumb : item.image} alt="" loading="lazy" />
          <div className={styles.compactFeaturedScrim} />
        </div>
      )}
      <div className={styles.compactBody}>
        <div className={styles.compactTitle}>{item.title}</div>
        {isSighting && item.scientific && !featured && (
          <div className={styles.compactSci}>{item.scientific}</div>
        )}
        <div className={styles.compactFooter}>
          <span
            className={styles.compactSource}
            style={isSighting ? { color: accentColor } : undefined}
          >
            {isSighting ? 'iNaturalist' : (item.source || 'News')}
          </span>
          <span className={styles.compactDot} />
          <span className={styles.compactTime}>{timeAgo(item.date)}</span>
          {isSighting && item.place && (
            <>
              <span className={styles.compactDot} />
              <span className={styles.compactPlace}>{item.place}</span>
            </>
          )}
        </div>
      </div>
      {!featured && hasImage && (
        <img
          className={styles.compactThumb}
          src={item.type === 'sighting' ? item.thumb : item.image}
          alt=""
          loading="lazy"
        />
      )}
    </a>
  )
}

/* ─── Expanded mode (articles masonry left, sightings strip right) ────────── */

function ExpandedFeed({ feed, accentColor, onCollapse }) {
  const articles = feed.filter(f => f.type === 'news')
  const sightings = feed.filter(f => f.type === 'sighting').slice(0, 10)

  return (
    <div className={styles.expandedFeed}>
      {/* Masthead */}
      <div className={styles.masthead}>
        <div className={styles.mastheadRule} />
        <div className={styles.mastheadInner}>
          <button className={styles.collapseBtn} onClick={onCollapse}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M5 1v5H1M9 13V8h4M5 1L1 5M9 13l4-4" />
            </svg>
            Back to map
          </button>
          <div className={styles.mastheadTitle}>Latest</div>
          <div className={styles.mastheadDate}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
        </div>
        <div className={styles.mastheadRule} />
      </div>

      {/* Two-column: articles masonry + sightings strip */}
      <div className={styles.expandedLayout}>
        {/* Articles — masonry */}
        <div className={styles.articlesMasonry}>
          {articles.map(item => (
            <ArticleCard key={item.id} item={item} />
          ))}
          {articles.length === 0 && (
            <div className={styles.empty}>No recent articles</div>
          )}
        </div>

        {/* Sightings strip */}
        {sightings.length > 0 && (
          <div className={styles.sightingsStrip}>
            <div className={styles.stripHeader}>
              <span className={styles.stripLabel}>Recent Sightings</span>
            </div>
            {sightings.map(item => (
              <SightingRow key={item.id} item={item} accentColor={accentColor} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ArticleCard({ item }) {
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className={styles.articleCard}>
      {item.image && (
        <div className={styles.articleImage}>
          <img src={item.image} alt="" loading="lazy" />
        </div>
      )}
      <div className={styles.articleBody}>
        <span className={styles.articleSource}>{item.source || 'News'}</span>
        <h3 className={styles.articleTitle}>{item.title}</h3>
        {item.description && (
          <p className={styles.articleDesc}>{item.description}</p>
        )}
        <span className={styles.articleTime}>{timeAgo(item.date)}</span>
      </div>
    </a>
  )
}

function SightingRow({ item, accentColor }) {
  const label = [item.place, timeAgo(item.date)].filter(Boolean).join(' · ')

  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className={styles.sightingRow}>
      {item.thumb && (
        <img className={styles.sightingThumb} src={item.thumb} alt="" loading="lazy" />
      )}
      <div className={styles.sightingInfo}>
        <span className={styles.sightingBadge}>Sighting</span>
        <div className={styles.sightingLabel}>{label || 'Unknown location'}</div>
      </div>
    </a>
  )
}
