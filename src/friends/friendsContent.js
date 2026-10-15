/**
 * Friends of the San Juans website content index, ported from salish-sea-propmapper src/services/friendsContent.ts
 * (the parts the habitat popups use). public/friends/friends-content.json is a straight copy of SSE's
 * public/data/friends-content.json (built by SSE's harvest + index scripts); refresh it from there.
 *
 * Shape: { generated, items: {id: {id, url, title, date 'YYYY-MM-DD', summary, excerpt?, topics, islands, places,
 * projectMatch, kind, quality, image {url, caption} | null, images []}}, byLayer: {layerId: [ids best first]},
 * byUrl }. Article and image URLs are absolute sanjuans.org links.
 */

const INDEX_URL = '/friends/friends-content.json'

let promise = null
let cached = null

// Start loading (idempotent). Call early so popups usually have it synchronously.
export function preloadFriendsContent() {
  if (!promise) {
    promise = fetch(INDEX_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((idx) => { cached = idx; return idx })
      .catch(() => null)
  }
  return promise
}

// The index if it has already loaded, else null (and a load is kicked off)
export function getFriendsContentSync() {
  if (!promise && typeof fetch === 'function') preloadFriendsContent()
  return cached
}

// For node checks and tests: hand the index in directly instead of fetching it
export function setFriendsContent(idx) {
  cached = idx
  promise = Promise.resolve(idx)
}

/**
 * Best articles for a specific feature: the layer's topic list re-ranked by how well each article's islands and
 * place names match the feature's own island and names. Ties fall back to quality and recency.
 */
export function articlesForFeature(idx, layerId, props, limit = 3) {
  if (!idx) return []
  const ids = idx.byLayer[layerId] ?? []
  const candidates = ids.map((id) => idx.items[id]).filter(Boolean)
  if (!candidates.length) return []

  const str = (v) => (v == null ? '' : String(v).trim().toLowerCase())
  const island = str(props.ISLAND ?? props.Island ?? props.island).replace(/\s+island$/, '').replace(/\s+is\.?$/, '')
  const nameFields = ['NAME', 'Name', 'name', 'NAME_2', 'SITE', 'Site', 'Beach_ID', 'LOCATION', 'PLACE']
  const names = nameFields.map((k) => str(props[k])).filter((n) => n.length >= 4)
  // Words from names worth matching (drop codes like "L-76" and tiny words)
  const nameWords = new Set()
  for (const n of names) for (const w of n.split(/[^a-z]+/)) if (w.length >= 4 && !['island', 'beach', 'point', 'road', 'bay'].includes(w)) nameWords.add(w)

  const score = (a) => {
    let sc = 0
    const places = a.places.map((p) => p.toLowerCase())
    const title = a.title.toLowerCase()
    if (names.some((n) => places.some((p) => p.includes(n) || n.includes(p)) || title.includes(n))) sc += 6
    else if ([...nameWords].some((w) => places.some((p) => p.includes(w)) || title.includes(w))) sc += 3
    if (island) {
      const isl = a.islands.map((i) => i.toLowerCase())
      if (isl.some((i) => island.includes(i) || i.includes(island))) sc += 2
      else if (isl.length) sc -= 1 // clearly about somewhere else
    }
    return sc
  }
  return candidates
    .map((a) => ({ a, sc: score(a) }))
    .sort((x, y) => y.sc - x.sc || y.a.quality - x.a.quality || (y.a.date > x.a.date ? 1 : -1))
    .slice(0, limit)
    .map((x) => x.a)
}

/**
 * Photos whose own caption names the subject (e.g. /eelgrass/), from any article in the index, best articles
 * first. Captions must be short and must not match `exclude` (art projects, boats, ships…): a related article's
 * photo is often not of the habitat at all.
 */
export function photosForSubject(idx, subject, exclude, limit = 2) {
  if (!idx) return []
  const seen = new Set()
  const out = []
  for (const it of Object.values(idx.items)) {
    for (const im of it.images) {
      const c = (im.caption || '').trim()
      if (!c || c.length > 70 || !subject.test(c) || exclude.test(c) || seen.has(im.url)) continue
      seen.add(im.url)
      out.push({ im: { url: im.url, caption: c }, q: it.quality })
    }
  }
  return out.sort((a, b) => b.q - a.q).slice(0, limit).map((x) => x.im)
}

// Short date for the article list: "Aug 2024"
export function articleDate(d) {
  const m = /^(\d{4})-(\d{2})/.exec(d)
  if (!m) return ''
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[Number(m[2]) - 1]} ${m[1]}`
}
