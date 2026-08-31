/**
 * Name the facility under a Carbon Mapper methane plume, in words real
 * people understand: "Almost certainly the Vancouver Landfill".
 *
 * Deterministic, not AI: OpenStreetMap maps landfills, gas plants, mines and
 * feedlots as named polygons, so we ask Overpass for named candidates near
 * the plume origin, prefer ones whose OSM type matches the plume's IPCC
 * sector, and grade confidence by distance. When OSM has nothing named
 * nearby (remote well pads, mostly), fall back to Mapbox reverse geocoding
 * for a plain "near Odessa, Texas". Returns HTML-safe strings.
 */

import mapboxgl from 'mapbox-gl'

// Public Overpass mirrors: the main instance throttles per-IP under load
// (returning 200 + empty elements + a "remark"), so try mirrors in turn.
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const RADIUS_M = 3000
const cache = new Map() // "lat,lng" → resolved html (per session)

// OSM selectors per IPCC sector; every branch requires a name.
const SECTOR_SELECTORS = {
  '6A': ['nwr["landuse"="landfill"]', 'nwr["amenity"~"waste_transfer_station|waste_disposal|recycling"]'],
  '6B': ['nwr["man_made"="wastewater_plant"]'],
  '1B2': ['nwr["man_made"~"petroleum_well|gasometer|works"]', 'nwr["industrial"~"oil|gas|refinery|well"]', 'nwr["landuse"="industrial"]'],
  '1B1a': ['nwr["landuse"="quarry"]', 'nwr["man_made"="mineshaft"]', 'nwr["industrial"="mine"]'],
  '1B1': ['nwr["landuse"="quarry"]', 'nwr["man_made"="mineshaft"]', 'nwr["industrial"="mine"]'],
  '4B': ['nwr["landuse"="farmyard"]', 'nwr["man_made"="silo"]', 'nwr["building"~"barn|cowshed|sty"]'],
  '1A1': ['nwr["power"="plant"]'],
  '1A2': ['nwr["landuse"="industrial"]', 'nwr["man_made"="works"]'],
}
const GENERIC_SELECTORS = ['nwr["landuse"~"landfill|industrial|quarry|farmyard"]', 'nwr["man_made"~"works|petroleum_well|wastewater_plant"]', 'nwr["power"="plant"]']

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const kmBetween = (a, b) => {
  const d2r = Math.PI / 180
  const dLat = (b.lat - a.lat) * d2r
  const dLng = (b.lng - a.lng) * d2r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * d2r) * Math.cos(b.lat * d2r) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

async function overpassNearest(lat, lng, sector) {
  const sectorSel = SECTOR_SELECTORS[sector] || []
  const all = [...new Set([...sectorSel, ...GENERIC_SELECTORS])]
  const body = `[out:json][timeout:8];(${all.map((s) => `${s}["name"](around:${RADIUS_M},${lat},${lng});`).join('')});out tags center 30;`
  let j = null
  for (const endpoint of OVERPASS_MIRRORS) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 9000)
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(body)}`,
        signal: ctrl.signal,
      })
      if (!r.ok) continue
      const cand = await r.json().catch(() => null)
      if (!cand) continue
      // Throttled instances answer 200 with no elements and a "remark".
      if (!cand.elements?.length && cand.remark) continue
      j = cand
      break
    } catch { /* try the next mirror */ } finally { clearTimeout(t) }
  }
  if (!j) return null
  {
    const sectorMatch = (tags) => sectorSel.some((sel) => {
      const m = sel.match(/\["([a-z_]+)"(?:[=~])"([^"]+)"\]/)
      if (!m) return false
      const v = tags[m[1]]
      return v != null && new RegExp(`^(${m[2]})$|${m[2]}`).test(v)
    })
    let best = null
    for (const el of j.elements || []) {
      const name = el.tags?.name
      const c = el.center || (el.lat != null ? { lat: el.lat, lon: el.lon } : null)
      if (!name || !c) continue
      const km = kmBetween({ lat, lng }, { lat: c.lat, lng: c.lon })
      const matched = sectorMatch(el.tags)
      // Sector-typed hits beat closer generic ones; mapped AREAS (ways/
      // relations — real facility outlines) beat loose point labels.
      const score = km - (matched ? 10 : 0) + (el.type === 'node' ? 0.75 : 0)
      if (!best || score < best.score) best = { name, km, matched, score }
    }
    return best
  }
}

async function nearestPlace(lat, lng) {
  try {
    const token = mapboxgl.accessToken
    if (!token) return null
    const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=place,locality,region&limit=1&access_token=${token}`)
    if (!r.ok) return null
    const j = await r.json()
    return j.features?.[0]?.place_name || null
  } catch {
    return null
  }
}

/** → HTML string naming the source (with confidence + provenance), or null. */
export async function identifyPlumeSource(lat, lng, sector) {
  const key = `${lat},${lng}`
  if (cache.has(key)) return cache.get(key)
  // Server-first: the edge proxy caches each identification for 30 days and
  // shields users from Overpass's per-IP throttling. Direct browser lookup
  // remains as the dev / degraded-mode fallback.
  try {
    const r = await fetch(`/api/geo/plume-source?lat=${lat}&lng=${lng}&sector=${encodeURIComponent(sector || '')}`)
    if (r.ok) {
      const j = await r.json()
      if (j.ok && j.html) { cache.set(key, j.html); return j.html }
    }
  } catch { /* dev server has no /api — fall through to direct lookup */ }
  const [hit, place] = await Promise.all([overpassNearest(lat, lng, sector), nearestPlace(lat, lng)])
  const near = place ? ` · near ${esc(place)}` : ''
  let out = null
  if (hit && hit.matched && hit.km <= 2.5) {
    out = `This is almost certainly <b>${esc(hit.name)}</b> (${hit.km < 1 ? 'at this location' : `${hit.km.toFixed(1)} km away`}, per OpenStreetMap)${near}.`
  } else if (hit && hit.km <= 3) {
    out = `Likely source: <b>${esc(hit.name)}</b> (${hit.km.toFixed(1)} km away, per OpenStreetMap)${near}.`
  } else if (place) {
    out = `No named facility is mapped here — it's near ${esc(place)}.`
  }
  if (out) cache.set(key, out)
  return out
}
