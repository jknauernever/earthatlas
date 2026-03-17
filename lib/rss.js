/**
 * RSS feed fetcher — lightweight XML parsing without dependencies.
 *
 * Extracts articles from RSS/Atom feeds including media tags
 * (media:content, media:thumbnail, enclosures) for images.
 */

/**
 * Fetch and parse an RSS feed. Returns normalized article items.
 */
export async function fetchRSSFeed(feedUrl, { maxItems = 20 } = {}) {
  const res = await fetch(feedUrl, {
    headers: { 'User-Agent': 'EarthAtlas/1.0 (https://earthatlas.org)' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`)

  const xml = await res.text()
  return parseRSSItems(xml, maxItems)
}

/**
 * Parse RSS XML into normalized article objects.
 */
function parseRSSItems(xml, maxItems) {
  const items = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match

  while ((match = itemRegex.exec(xml)) !== null && items.length < maxItems) {
    const block = match[1]

    const title = extractTag(block, 'title')
    const link = extractLink(block)
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'dc:date')
    const description = extractTag(block, 'description')
    const content = extractTag(block, 'content:encoded')
    const author = extractTag(block, 'dc:creator') || extractTag(block, 'author')
    const source = extractTagAttr(block, 'source') || null
    const categories = extractAllTags(block, 'category')

    if (!title || !link) continue

    // Image extraction from RSS metadata
    const image = extractRSSImage(block, description, content)

    items.push({
      title: decodeEntities(title),
      link: link.trim(),
      pubDate: pubDate || null,
      description: description ? stripHtml(decodeEntities(description)).slice(0, 500) : null,
      content: content ? stripHtml(decodeEntities(content)).slice(0, 3000) : null,
      author: author ? decodeEntities(author) : null,
      source: source ? decodeEntities(source) : null,
      categories,
      image,
    })
  }

  return items
}

/**
 * Extract image URL from RSS item using multi-strategy cascade.
 * Priority: media:content → media:thumbnail → enclosure → content <img> → description <img>
 */
function extractRSSImage(block, description, content) {
  // 1. media:content url attribute
  const mediaContent = block.match(/<media:content[^>]+url=["']([^"']+)["']/i)
  if (mediaContent && isValidImageUrl(mediaContent[1])) return mediaContent[1]

  // 2. media:thumbnail url attribute
  const mediaThumbnail = block.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i)
  if (mediaThumbnail && isValidImageUrl(mediaThumbnail[1])) return mediaThumbnail[1]

  // 3. enclosure with image type
  const enclosure = block.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image\/[^"']+["']/i)
    || block.match(/<enclosure[^>]+type=["']image\/[^"']+["'][^>]*url=["']([^"']+)["']/i)
  if (enclosure) {
    const url = enclosure[1] || enclosure[2]
    if (url && isValidImageUrl(url)) return url
  }

  // 4. First <img> in content:encoded
  if (content) {
    const img = extractFirstImg(decodeEntities(content))
    if (img) return img
  }

  // 5. First <img> in description
  if (description) {
    const img = extractFirstImg(decodeEntities(description))
    if (img) return img
  }

  return null
}

/* ─── Helpers ───────────────────────────────────────────────────────────────── */

function extractTag(xml, tag) {
  // Try CDATA first
  const cdata = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'))
  if (cdata) return cdata[1]
  // Plain text
  const plain = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return plain ? plain[1] : null
}

function extractTagAttr(xml, tag) {
  // Extract text content of a tag (used for <source>)
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'))
  return match ? match[1] : null
}

function extractAllTags(xml, tag) {
  const results = []
  const regex = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'gi')
  let m
  while ((m = regex.exec(xml)) !== null) {
    const val = decodeEntities(m[1]).trim()
    if (val) results.push(val)
  }
  return results
}

function extractLink(block) {
  // Atom-style <link href="...">
  const atomLink = block.match(/<link[^>]+href=["']([^"']+)["']/i)
  // RSS-style <link>url</link>
  const rssLink = extractTag(block, 'link')
  return atomLink ? atomLink[1] : (rssLink || '')
}

function extractFirstImg(html) {
  // Try src, then data-src, then first srcset URL
  const srcMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  if (srcMatch && isValidImageUrl(srcMatch[1])) return srcMatch[1]

  const dataSrcMatch = html.match(/<img[^>]+data-src=["']([^"']+)["']/i)
  if (dataSrcMatch && isValidImageUrl(dataSrcMatch[1])) return dataSrcMatch[1]

  const srcsetMatch = html.match(/<img[^>]+srcset=["']([^\s,"']+)/i)
  if (srcsetMatch && isValidImageUrl(srcsetMatch[1])) return srcsetMatch[1]

  return null
}

function isValidImageUrl(url) {
  if (!url || url.length < 10) return false
  // Skip icons, logos, pixels, social buttons
  if (/(?:icon|logo|avatar|social|button|share|pixel|1x1|spacer|tracking)/i.test(url)) return false
  // Must look like an image or come from a CDN
  if (/\.(?:jpg|jpeg|png|webp|gif)/i.test(url)) return true
  if (/(?:images|media|cdn|wp-content|uploads|photos)/i.test(url)) return true
  return false
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function stripHtml(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}
