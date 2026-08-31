/**
 * Named-source lookup for a Carbon Mapper methane plume.
 *
 * GET /api/geo/plume-source?lat=…&lng=…&sector=6A
 * → { ok, html } — e.g. "This is almost certainly <b>Vancouver Landfill</b>
 *   (at this location, per OpenStreetMap) · near Delta, British Columbia."
 *
 * Runs the OSM Overpass + Mapbox reverse-geocode combination server-side:
 * the public Overpass instances rate-limit browser IPs aggressively, and a
 * plume's answer never changes — so responses cache at the edge for 30 days
 * (s-maxage) keyed by the rounded coordinate. Each plume costs the upstream
 * roughly one query ever, per region. Edge runtime like the other /api/geo
 * proxies (doesn't count against the serverless-function ceiling).
 */

export const config = { runtime: 'edge' }

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const RADIUS_M = 3000

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
  const q = `[out:json][timeout:10];(${all.map((s) => `${s}["name"](around:${RADIUS_M},${lat},${lng});`).join('')});out tags center 30;`
  let j = null
  for (const endpoint of MIRRORS) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(q)}`,
        signal: AbortSignal.timeout(12000),
      })
      if (!r.ok) continue
      const cand = await r.json().catch(() => null)
      if (!cand) continue
      if (!cand.elements?.length && cand.remark) continue // throttled: 200 + remark
      j = cand
      break
    } catch { /* next mirror */ }
  }
  if (!j) return null
  const sectorMatch = (tags) => sectorSel.some((sel) => {
    const m = sel.match(/\["([a-z_]+)"(?:[=~])"([^"]+)"\]/)
    if (!m) return false
    const v = tags[m[1]]
    return v != null && new RegExp(m[2]).test(v)
  })
  let best = null
  for (const el of j.elements || []) {
    const name = el.tags?.name
    const c = el.center || (el.lat != null ? { lat: el.lat, lon: el.lon } : null)
    if (!name || !c) continue
    const km = kmBetween({ lat, lng }, { lat: c.lat, lng: c.lon })
    const matched = sectorMatch(el.tags)
    // Sector-typed hits beat closer generic ones; mapped areas beat point labels.
    const score = km - (matched ? 10 : 0) + (el.type === 'node' ? 0.75 : 0)
    if (!best || score < best.score) best = { name, km, matched, score }
  }
  return best
}

async function nearestPlace(lat, lng) {
  const token = process.env.MAPBOX_TOKEN || process.env.VITE_MAPBOX_TOKEN
  if (!token) return null
  try {
    const r = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=place,locality,region&limit=1&access_token=${token}`,
      { signal: AbortSignal.timeout(6000) },
    )
    if (!r.ok) return null
    const j = await r.json()
    return j.features?.[0]?.place_name || null
  } catch {
    return null
  }
}

export default async function handler(req) {
  const u = new URL(req.url)
  const lat = Number(u.searchParams.get('lat'))
  const lng = Number(u.searchParams.get('lng'))
  const sector = (u.searchParams.get('sector') || '').slice(0, 8)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return new Response(JSON.stringify({ ok: false, error: 'bad coordinates' }), { status: 400 })
  }
  const [hit, place] = await Promise.all([overpassNearest(lat, lng, sector), nearestPlace(lat, lng)])
  const near = place ? ` · near ${esc(place)}` : ''
  let html = null
  if (hit && hit.matched && hit.km <= 2.5) {
    html = `This is almost certainly <b>${esc(hit.name)}</b> (${hit.km < 1 ? 'at this location' : `${hit.km.toFixed(1)} km away`}, per OpenStreetMap)${near}.`
  } else if (hit && hit.km <= 3) {
    html = `Likely source: <b>${esc(hit.name)}</b> (${hit.km.toFixed(1)} km away, per OpenStreetMap)${near}.`
  } else if (place) {
    html = `No named facility is mapped here — it's near ${esc(place)}.`
  }
  // Identifications never change: cache hard at the edge; brief client cache.
  // Failures (html null) cache only a minute so a throttled upstream retries.
  return new Response(JSON.stringify({ ok: !!html, html }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': html
        ? 'public, max-age=3600, s-maxage=2592000'
        : 'public, max-age=0, s-maxage=60',
    },
  })
}
