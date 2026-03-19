/**
 * Live Globe data service
 * Fetches recent observations from iNaturalist (global) and eBird (notable, rotating regions).
 * eBird species photos via Macaulay Library.
 */

import { cached } from '../utils/cache'

const INAT_API = 'https://api.inaturalist.org/v1'
const EBIRD_API = 'https://api.ebird.org/v2'
const MACAULAY_API = 'https://search.macaulaylibrary.org/api/v1/search'
const MACAULAY_CDN = 'https://cdn.download.ams.birds.cornell.edu/api/v1/asset'
const EBIRD_KEY = import.meta.env.VITE_EBIRD_API_KEY

// ─── Macaulay Library species photo cache ─────────────────────────────────
const macaulayCache = new Map()

async function fetchMacaulayPhoto(speciesCode) {
  if (macaulayCache.has(speciesCode)) return macaulayCache.get(speciesCode)
  try {
    const res = await fetch(
      `${MACAULAY_API}?taxonCode=${encodeURIComponent(speciesCode)}&mediaType=photo&sort=rating_rank_desc&count=1`
    )
    if (!res.ok) { macaulayCache.set(speciesCode, null); return null }
    const data = await res.json()
    const asset = data.results?.[0]
    if (!asset?.assetId) { macaulayCache.set(speciesCode, null); return null }
    const url = `${MACAULAY_CDN}/${asset.assetId}/480`
    macaulayCache.set(speciesCode, url)
    return url
  } catch {
    macaulayCache.set(speciesCode, null)
    return null
  }
}

// ─── iNaturalist: global recent observations with photos ──────────────────
export async function fetchRecentINat(perPage = 200) {
  const params = new URLSearchParams({
    per_page: Math.min(perPage, 200),
    order: 'desc',
    order_by: 'created_at',
    quality_grade: 'any',
    captive: 'false',
    photos: 'true',
  })
  const res = await fetch(`${INAT_API}/observations?${params}`)
  if (!res.ok) throw new Error(`iNaturalist error: ${res.status}`)
  const data = await res.json()

  return (data.results || [])
    .filter(o => o.geojson?.coordinates)
    .map(o => ({
      id: `inat-${o.id}`,
      source: 'iNaturalist',
      commonName: o.taxon?.preferred_common_name || o.taxon?.name || 'Unknown',
      scientificName: o.taxon?.name || '',
      photoUrl: o.photos?.[0]?.url?.replace('square', 'small') || o.taxon?.default_photo?.medium_url || null,
      lat: o.geojson.coordinates[1],
      lng: o.geojson.coordinates[0],
      location: o.place_guess || '',
      observedAt: o.observed_on || o.created_at || '',
      iconicTaxon: o.taxon?.iconic_taxon_name || 'Unknown',
    }))
}

// ─── eBird: notable observations from rotating regions ────────────────────
const EBIRD_REGIONS = ['US', 'CA', 'GB', 'AU', 'IN', 'BR', 'MX', 'CO', 'CR', 'ZA', 'ES', 'DE']
let regionIndex = 0

export async function fetchRecentEBird() {
  if (!EBIRD_KEY) return []

  // Pick 4 regions per cycle, rotate through all
  const regions = []
  for (let i = 0; i < 4; i++) {
    regions.push(EBIRD_REGIONS[(regionIndex + i) % EBIRD_REGIONS.length])
  }
  regionIndex = (regionIndex + 4) % EBIRD_REGIONS.length

  const allObs = []

  await Promise.all(regions.map(async (region) => {
    try {
      const res = await fetch(
        `${EBIRD_API}/data/obs/${region}/recent/notable?back=1&maxResults=50`,
        { headers: { 'x-ebirdapitoken': EBIRD_KEY } }
      )
      if (!res.ok) return
      const data = await res.json()
      if (!Array.isArray(data)) return

      // Fetch Macaulay photos for unique species (batch)
      const uniqueCodes = [...new Set(data.map(o => o.speciesCode).filter(Boolean))]
      await Promise.all(uniqueCodes.map(code => fetchMacaulayPhoto(code)))

      for (const o of data) {
        if (o.lat == null || o.lng == null) continue
        allObs.push({
          id: `ebird-${o.subId}-${o.speciesCode}`,
          source: 'eBird',
          commonName: o.comName || 'Unknown',
          scientificName: o.sciName || '',
          photoUrl: macaulayCache.get(o.speciesCode) || null,
          lat: o.lat,
          lng: o.lng,
          location: o.locName || '',
          observedAt: o.obsDt || '',
          iconicTaxon: 'Aves',
          speciesCode: o.speciesCode,
          howMany: o.howMany || null,
        })
      }
    } catch {
      // Skip failed regions silently
    }
  }))

  return allObs
}

// ─── Combined fetch ───────────────────────────────────────────────────────
export async function fetchAllRecent() {
  const [inat, ebird] = await Promise.all([
    fetchRecentINat().catch(() => []),
    fetchRecentEBird().catch(() => []),
  ])
  return [...inat, ...ebird]
}
