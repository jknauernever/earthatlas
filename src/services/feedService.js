/**
 * Feed service — fetches live iNat sightings and news articles
 * for the "Latest" tab on species explore pages.
 */

const INAT_API = 'https://api.inaturalist.org/v1'

/**
 * Fetch recent iNaturalist observations for a taxon, globally.
 * Returns normalized feed items sorted newest-first.
 */
export async function fetchLatestINat({ inatTaxonId, perPage = 20 }) {
  if (!inatTaxonId) return []
  try {
    const params = new URLSearchParams({
      taxon_id: inatTaxonId,
      per_page: Math.min(perPage, 30),
      order: 'desc',
      order_by: 'created_at',
      quality_grade: 'any',
      captive: 'false',
      photos: 'true',
    })
    const res = await fetch(`${INAT_API}/observations?${params}`, {
      headers: { 'User-Agent': 'EarthAtlas/1.0 (https://earthatlas.org)' },
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.results || []).map(obs => {
      const photo = obs.photos?.[0]?.url?.replace('square', 'medium') || null
      const thumb = obs.photos?.[0]?.url?.replace('square', 'small') || null
      return {
        type: 'sighting',
        id: `inat-${obs.id}`,
        title: obs.taxon?.preferred_common_name || obs.taxon?.name || 'Unknown species',
        scientific: obs.taxon?.name || '',
        observer: obs.user?.login || 'iNaturalist observer',
        observerIcon: obs.user?.icon_url || null,
        date: obs.observed_on || obs.created_at?.split('T')[0] || null,
        place: obs.place_guess || null,
        photo,
        thumb,
        url: `https://www.inaturalist.org/observations/${obs.id}`,
      }
    })
  } catch {
    return []
  }
}

/**
 * Fetch news articles from the curated news feed API.
 * Falls back to the legacy Google News proxy if the new API returns empty.
 */
export async function fetchNews({ newsQuery, speciesSlug, count = 8 }) {
  // Try the new curated feed first
  if (speciesSlug) {
    try {
      const params = new URLSearchParams({ species: speciesSlug, limit: count })
      const res = await fetch(`/api/news/feed?${params}`)
      if (res.ok) {
        const data = await res.json()
        if (data.articles?.length > 0) {
          return data.articles.map(a => ({
            type: 'news',
            id: a.id,
            title: a.title,
            description: a.description || null,
            source: a.source || null,
            image: a.image || null,
            imageCredit: a.imageCredit || null,
            date: a.date || null,
            url: a.url,
            sourceUrl: a.sourceUrl || null,
          }))
        }
      }
    } catch { /* fall through to legacy */ }
  }

  // Legacy: Google News RSS proxy
  if (!newsQuery) return []
  try {
    const params = new URLSearchParams({ q: newsQuery, n: count })
    const res = await fetch(`/api/news-legacy?${params}`)
    if (!res.ok) return []
    const data = await res.json()
    return (data.articles || []).map((a, i) => ({
      type: 'news',
      id: `news-${i}-${Date.now()}`,
      title: a.title,
      description: a.description || null,
      source: a.source || null,
      image: a.image || null,
      date: a.pubDate ? new Date(a.pubDate).toISOString().split('T')[0] : null,
      url: a.link,
    }))
  } catch {
    return []
  }
}
