import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useSEO } from '../hooks/useSEO.js'
import styles from './NewsArticlePage.module.css'

// Species accent colors — matches explore configs
const SPECIES_THEME = {
  sharks:      { accent: '#ff6b6b', label: 'Sharks',      path: '/sharks' },
  whales:      { accent: '#a8e6cf', label: 'Whales',      path: '/whales' },
  dolphins:    { accent: '#74b9ff', label: 'Dolphins',     path: '/dolphins' },
  birds:       { accent: '#ffeaa7', label: 'Birds',        path: '/birds' },
  butterflies: { accent: '#ffd166', label: 'Butterflies',  path: '/butterflies' },
  bears:       { accent: '#a0855b', label: 'Bears',        path: '/bears' },
  condors:     { accent: '#e17055', label: 'Condors',      path: '/condors' },
  elephants:   { accent: '#b2bec3', label: 'Elephants',    path: '/elephants' },
  fungi:       { accent: '#81ecec', label: 'Fungi',        path: '/fungi' },
  hippos:      { accent: '#6c5ce7', label: 'Hippos',       path: '/hippos' },
  lions:       { accent: '#fdcb6e', label: 'Lions',        path: '/lions' },
  monkeys:     { accent: '#e17055', label: 'Monkeys',      path: '/monkeys' },
  sloths:      { accent: '#00b894', label: 'Sloths',       path: '/sloths' },
  tigers:      { accent: '#e17055', label: 'Tigers',       path: '/tigers' },
  wolves:      { accent: '#636e72', label: 'Wolves',       path: '/wolves' },
}

export default function NewsArticlePage() {
  const { species, slug } = useParams()
  const [article, setArticle] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const theme = SPECIES_THEME[species] || { accent: '#5a6b7a', label: species, path: `/${species}` }

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/news/article?slug=${encodeURIComponent(slug)}`)
      .then(res => {
        if (!res.ok) throw new Error(res.status === 404 ? 'Article not found' : 'Failed to load')
        return res.json()
      })
      .then(data => setArticle(data.article))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [slug])

  useSEO({
    title: article?.title,
    description: article?.summary?.replace(/<[^>]+>/g, '').slice(0, 160),
    path: `/news/${species}/${slug}`,
    image: article?.image,
  })

  // JSON-LD structured data
  useEffect(() => {
    if (!article) return
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: article.title,
      image: article.image ? [article.image] : [],
      datePublished: article.date,
      description: article.summary?.replace(/<[^>]+>/g, '').slice(0, 200),
      publisher: {
        '@type': 'Organization',
        name: 'EarthAtlas',
        url: 'https://earthatlas.org',
      },
    }
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.text = JSON.stringify(ld)
    document.head.appendChild(script)
    return () => script.remove()
  }, [article])

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.shimmer} style={{ height: 32, width: '60%', marginBottom: 16 }} />
          <div className={styles.shimmer} style={{ height: 300, marginBottom: 16 }} />
          <div className={styles.shimmer} style={{ height: 16, marginBottom: 8 }} />
          <div className={styles.shimmer} style={{ height: 16, width: '80%' }} />
        </div>
      </div>
    )
  }

  if (error || !article) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.errorBox}>
            <h1>Article not found</h1>
            <p>{error || 'This article may have been removed.'}</p>
            <Link to={theme.path} className={styles.backLink}>
              Back to {theme.label}
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const formattedDate = article.date
    ? new Date(article.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Breadcrumb */}
        <nav className={styles.breadcrumb}>
          <Link to="/">EarthAtlas</Link>
          <span className={styles.breadcrumbSep}>/</span>
          <Link to={theme.path}>{theme.label}</Link>
          <span className={styles.breadcrumbSep}>/</span>
          <span>News</span>
        </nav>

        {/* Article */}
        <article className={styles.article}>
          {/* Category + date */}
          <div className={styles.meta}>
            <span className={styles.categoryBadge} style={{ color: theme.accent, borderColor: theme.accent }}>
              {theme.label}
            </span>
            {article.source && (
              <span className={styles.source}>{article.source}</span>
            )}
            {formattedDate && (
              <span className={styles.date}>{formattedDate}</span>
            )}
          </div>

          {/* Headline */}
          <h1 className={styles.headline}>{article.title}</h1>

          {/* Hero image */}
          {article.image && (
            <figure className={styles.heroFigure}>
              <img src={article.image} alt="" className={styles.heroImage} />
              {article.imageCredit && (
                <figcaption className={styles.imageCredit}>{article.imageCredit}</figcaption>
              )}
            </figure>
          )}

          {/* Body */}
          <div
            className={styles.body}
            dangerouslySetInnerHTML={{ __html: article.summary }}
          />

          {/* Source link */}
          {article.sourceUrl && (
            <a
              href={article.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.sourceLink}
            >
              Read full article at {article.source || 'source'}
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 1h8v8M13 1L6 8" />
              </svg>
            </a>
          )}
        </article>

        {/* Back link */}
        <div className={styles.footer}>
          <Link to={theme.path} className={styles.backLink}>
            ← Explore {theme.label}
          </Link>
        </div>
      </div>
    </div>
  )
}
