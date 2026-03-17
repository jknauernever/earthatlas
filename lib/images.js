/**
 * Image extraction and fallback — og:image scraping + Pexels API.
 */

/**
 * Try to extract og:image or twitter:image from an article page.
 * Only reads the first ~50KB (the <head>) to minimize bandwidth.
 */
export async function fetchOgImage(url, timeoutMs = 5000) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'EarthAtlas/1.0 (https://earthatlas.org)' },
      redirect: 'follow',
    })
    clearTimeout(timer)
    if (!res.ok) return null

    // Stream only the head
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let html = ''
    while (html.length < 50_000) {
      const { done, value } = await reader.read()
      if (done) break
      html += decoder.decode(value, { stream: true })
      if (html.includes('</head>')) break
    }
    reader.cancel()

    // og:image (both attribute orderings)
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/)
    if (og) return og[1]

    // twitter:image
    const tw = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/)
    if (tw) return tw[1]

    // First substantial <img> in the page
    const imgs = [...html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)]
    for (const m of imgs) {
      const src = m[1]
      if (/(?:icon|logo|avatar|social|button|share|pixel|1x1|spacer)/i.test(src)) continue
      if (/\.(?:jpg|jpeg|png|webp)/i.test(src) || /(?:images|media|cdn|uploads)/i.test(src)) {
        return src
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Search Pexels for a stock photo using AI-generated keywords.
 * Returns { url, credit } or null.
 */
export async function searchPexels(keywords) {
  const apiKey = process.env.PEXELS_API_KEY
  if (!apiKey || !keywords) return null

  try {
    const params = new URLSearchParams({
      query: keywords,
      orientation: 'landscape',
      per_page: '5',
    })
    const res = await fetch(`https://api.pexels.com/v1/search?${params}`, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null

    const data = await res.json()
    if (!data.photos?.length) return null

    // Filter out political/military content
    const excluded = /(?:politician|president|campaign|rally|vote|election|gun|weapon|military|war|soldier|army|protest|police)/i
    const clean = data.photos.filter(p => {
      const alt = (p.alt || '').toLowerCase()
      return !excluded.test(alt)
    })
    if (!clean.length) return null

    // Pick a random photo for variety
    const photo = clean[Math.floor(Math.random() * clean.length)]

    return {
      url: photo.src.large,
      credit: photo.photographer
        ? `Photo by ${photo.photographer} on Pexels`
        : 'Photo from Pexels',
    }
  } catch {
    return null
  }
}

/**
 * Full image resolution cascade:
 * 1. RSS-extracted image (already attempted by rss.js)
 * 2. og:image from article page
 * 3. Pexels fallback using AI keywords
 */
export async function resolveImage({ rssImage, articleUrl, imageKeywords, isDuplicate }) {
  // 1. Already have an image from RSS
  if (rssImage && !(isDuplicate && await isDuplicate(rssImage))) {
    return { url: rssImage, credit: null }
  }

  // 2. Scrape og:image from the article
  if (articleUrl) {
    const ogImage = await fetchOgImage(articleUrl)
    if (ogImage && !(isDuplicate && await isDuplicate(ogImage))) {
      return { url: ogImage, credit: null }
    }
  }

  // 3. Pexels fallback (always unique enough via random selection)
  if (imageKeywords) {
    const pexels = await searchPexels(imageKeywords)
    if (pexels) return pexels
  }

  return { url: null, credit: null }
}
