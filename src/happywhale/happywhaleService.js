/**
 * happywhaleService — data layer for the EarthAtlas /happywhale tool.
 *
 * Source: HappyWhale's external API (hwx) on their beta server, fronted by our
 * edge proxy at /api/happywhale (api/happywhale.js — which also owns the OAuth
 * dance; the browser never sees credentials or tokens). Spec:
 * docs/happywhale/openapi.yml (also https://animal.us/apis/hwx/). Endpoints:
 *   POST /encounters          — area (wkt | circle) + date range → BBEncounter[]
 *   GET  /individual/info/:id — one individual + ALL its encounters worldwide
 *                               (the spec says POST; the live API wants GET)
 *   GET  /config/species      — speciesKey → {name, plural, scientific} map
 *
 * Live-data notes (verified against beta 2026-06-12):
 *  - media/avatar carry BOTH thumbUrl (100px -t bucket) and url (1200px -m
 *    bucket), plus a licenseLevel (e.g. PUBLIC_DOMAIN). Popups want `url`;
 *    the tiny thumbUrl suits avatars.
 *  - /encounters caps at 10,000 results (limitExceeded=true) and truncation
 *    keeps the OLDEST rows, so wide date windows surface stale data — the UI
 *    nudges users to narrow the search.
 */

const API = '/api/happywhale'

// ─── Species colors (map circles, chips, legend) ─────────────────────────────
export const SPECIES_COLORS = {
  humpback_whale: '#38bdf8',
  blue_whale: '#818cf8',
  gray_whale: '#d2b48c',
  killer_whale: '#7dd3fc',
  sperm_whale: '#c084fc',
  fin_whale: '#34d399',
  minke_whale: '#fbbf24',
  southern_right_whale: '#fb7185',
}
export const speciesColor = (key) => SPECIES_COLORS[key] || '#38bdf8'

/** Public HappyWhale page for an identified individual. */
export const individualUrl = (id) => `https://happywhale.com/individual/${id}`

// ─── Proxy plumbing ──────────────────────────────────────────────────────────
async function proxyJSON(op, { body, signal } = {}) {
  const res = await fetch(`${API}?op=${op}`, {
    method: body ? 'POST' : 'GET',
    signal,
    headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`happywhale proxy returned ${res.status}`)
  const data = await res.json()
  // The proxy always answers 200; a failed upstream is signalled in-body so the
  // browser never sees a scary network error (mirrors /api/ebird).
  if (data && data._upstream_status != null) throw new Error(`happywhale upstream ${data._upstream_status}`)
  return data
}

// ─── Normalizers (BBEncounter / PubEncounter → internal shape) ───────────────
function normMedia(raw) {
  if (!raw) return null
  return {
    type: raw.type,
    thumbUrl: raw.thumbUrl || null,
    url: raw.url || null,
    licenseLevel: raw.licenseLevel || null,
  }
}

function normEncounter(raw) {
  if (!raw) return null
  // Spec: latlng is a float array, [0] = latitude, [1] = longitude.
  const lat = Array.isArray(raw.latlng) ? raw.latlng[0] : raw.lat
  const lng = Array.isArray(raw.latlng) ? raw.latlng[1] : raw.lng
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const ind = raw.individual || null
  return {
    id: raw.id,
    date: raw.date || null,
    time: raw.date ? new Date(`${raw.date}T12:00:00Z`).getTime() : 0,
    lat, lng,
    region: raw.region || null,
    location: raw.location || null,
    sea: raw.sea || null,
    ocean: raw.ocean || null,
    speciesKey: raw.speciesKey || ind?.speciesKey || 'unknown',
    minCount: raw.minCount ?? null,
    maxCount: raw.maxCount ?? null,
    comments: raw.comments || null,
    media: normMedia(raw.media),
    individual: ind ? {
      id: ind.id,
      primaryId: ind.primaryId || null,
      nickname: ind.nickname || null,
      sex: ind.sex || null,
      avatar: normMedia(ind.avatar),
    } : null,
  }
}

const toDateStr = (ms) => new Date(ms).toISOString().slice(0, 10)

// ─── Fetchers ────────────────────────────────────────────────────────────────
/**
 * Species config (speciesKey → labels). Cache-forever data per the API docs.
 * Returns { species: [{code, name, plural, scientific}] }.
 */
export async function fetchSpeciesConfig({ signal } = {}) {
  const data = await proxyJSON('species', { signal })
  if (!Array.isArray(data)) throw new Error('unexpected species payload')
  return { species: data }
}

/**
 * Encounters for an optional circle ({lat,lng,radiusMeters}) + date window
 * (from/to as epoch ms). Returns { encounters, limitExceeded }.
 * Note: the API has no species parameter — species filtering is client-side.
 */
export async function fetchEncounters({ circle, from, to, signal } = {}) {
  const body = { date: { from: toDateStr(from), ...(to ? { to: toDateStr(to) } : {}) } }
  if (circle) body.area = { circle: { center: { lat: circle.lat, lng: circle.lng }, radius: circle.radiusMeters } }
  const data = await proxyJSON('encounters', { body, signal })
  if (!data || !Array.isArray(data.results)) throw new Error('unexpected encounters payload')
  return {
    encounters: data.results.map(normEncounter).filter(Boolean),
    limitExceeded: !!data.limitExceeded,
  }
}

/**
 * One identified individual + every encounter of it worldwide (for journey
 * views). Returns { individual, encounters, path } — path is null: real
 * encounters carry no routing info, so the app draws point-to-point legs.
 */
export async function fetchIndividualTrack({ id, signal } = {}) {
  const data = await proxyJSON(`individual&id=${encodeURIComponent(id)}`, { signal })
  if (!data || !data.individual) throw new Error('unexpected individual payload')
  return {
    individual: { ...data.individual, avatar: normMedia(data.individual.avatar) },
    encounters: (data.encs || []).map(normEncounter).filter(Boolean).sort((a, b) => a.time - b.time),
    path: null,
  }
}

// ─── Journey arrow sampling ──────────────────────────────────────────────────
const havKm = (lat1, lng1, lat2, lng2) => {
  const r = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(a))
}

/**
 * Sample arrow markers along journey legs: a point every ~stepKm carrying the
 * local direction of travel as `rot` (degrees clockwise; 0 = the '→' glyph's
 * native east) and a power-of-two LOD `rank` (arrow i gets the largest k≤7
 * with i % 2^k === 0). Deterministic point symbols, NOT Mapbox line
 * placement — line placement silently drops symbols (curvature, tile
 * clipping, overlapping geometry), which read as random gaps in the arrow
 * chain. The layer's zoom-interpolated size expression shows rank ≥ r(zoom),
 * so the chain keeps an even ~45px rhythm at every zoom with no collision
 * logic involved.
 * Legs: [{ side, coords: [[lng,lat],…] }] → [{ lng, lat, rot, rank }].
 */
export function sampleArrowPoints(legs, stepKm = 10) {
  const out = []
  for (const leg of legs) {
    const c = leg.coords
    let carry = stepKm / 2 // start half a step in so chains don't sit on the dots
    let i = 0
    for (let s = 1; s < c.length; s++) {
      const [lngA, latA] = c[s - 1]
      const [lngB, latB] = c[s]
      const segKm = havKm(latA, lngA, latB, lngB)
      if (segKm <= 0) continue
      // Mercator-plane angle (not true bearing) so the glyph aligns with the
      // on-screen line direction even at high latitudes.
      const latMid = ((latA + latB) / 2) * (Math.PI / 180)
      const rot = (Math.atan2((lngB - lngA) * Math.cos(latMid), latB - latA) * 180) / Math.PI - 90
      let d = carry
      while (d <= segKm) {
        const t = d / segKm
        let rank = 0
        while (rank < 7 && i % (1 << (rank + 1)) === 0) rank++
        out.push({ lng: lngA + (lngB - lngA) * t, lat: latA + (latB - latA) * t, rot, rank })
        i++
        d += stepKm
      }
      carry = d - segKm
    }
  }
  return out
}
