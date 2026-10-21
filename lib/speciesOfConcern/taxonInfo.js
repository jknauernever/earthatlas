/**
 * Photo and short description for each species in a lookup, from iNaturalist's taxon record: its default photo (with
 * the photographer's credit and license, shown beside it) and Wikipedia summary. Batched (30 per request) and cached
 * a week per taxon. Never throws: a failed batch just leaves those species without a photo.
 */
const cache = new Map()   // id -> { at, info }
const WEEK = 7 * 86400000
const strip = (html) => String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

function infoOf(t) {
  const p = t.default_photo || {}
  const summary = strip(t.wikipedia_summary)
  return {
    inat_id: t.id, name: t.name, common_name: t.preferred_common_name || null, rank: t.rank,
    photo: p.square_url ? { thumb: p.square_url, medium: p.medium_url || p.square_url.replace('/square.', '/medium.'), attribution: p.attribution || null, license: p.license_code || null } : null,
    summary: summary ? (summary.length > 320 ? `${summary.slice(0, 317).replace(/\s+\S*$/, '')}…` : summary) : null,
    wikipedia_url: t.wikipedia_url || null,
    inat_url: `https://www.inaturalist.org/taxa/${t.id}`,
  }
}

export async function fetchTaxonInfo(ids) {
  const out = new Map()
  const todo = []
  for (const id of new Set(ids.filter(Boolean).map(Number))) {
    const hit = cache.get(id)
    if (hit && Date.now() - hit.at < WEEK) out.set(id, hit.info)
    else todo.push(id)
  }
  for (let i = 0; i < todo.length; i += 30) {
    try {
      const res = await fetch(`https://api.inaturalist.org/v1/taxa/${todo.slice(i, i + 30).join(',')}`, { headers: { 'User-Agent': 'EarthAtlas species-of-concern lookup (earthatlas.org)' } })
      if (!res.ok) continue
      for (const t of (await res.json()).results || []) {
        const info = infoOf(t)
        cache.set(t.id, { at: Date.now(), info })
        out.set(t.id, info)
      }
    } catch { /* leave these without a photo */ }
  }
  return out
}
