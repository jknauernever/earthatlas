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

// The live taxonomy has dozens of species (orca ecotypes, dolphins, seals…) —
// far more than the hand-picked palette. Everything else gets a stable,
// visually distinct color from this wheel (hashed by species key, so a
// species keeps its color across sessions and views). Hues chosen to stay
// legible on the dark satellite basemap and apart from the hand-picked set.
const FALLBACK_PALETTE = [
  '#f472b6', // pink
  '#a3e635', // lime
  '#fb923c', // orange
  '#2dd4bf', // teal
  '#e879f9', // fuchsia
  '#facc15', // yellow
  '#4ade80', // green
  '#f87171', // red
  '#a5b4fc', // periwinkle
  '#fda4af', // light rose
  '#67e8f9', // light cyan
  '#d8b4fe', // lavender
]
export const speciesColor = (key) => {
  if (SPECIES_COLORS[key]) return SPECIES_COLORS[key]
  let h = 0
  for (let i = 0; i < (key || '').length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length]
}

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
 * views). Returns { individual, encounters }. NOTE: no path/track geometry —
 * real encounters carry no routing info, and drawing straight lines between
 * them sends "journeys" across peninsulas and continents. The app renders a
 * journey as chronologically NUMBERED stops instead: honest about what we
 * know (where and when), silent about what we don't (the route between).
 */
export async function fetchIndividualTrack({ id, signal } = {}) {
  const data = await proxyJSON(`individual&id=${encodeURIComponent(id)}`, { signal })
  if (!data || !data.individual) throw new Error('unexpected individual payload')
  return {
    individual: { ...data.individual, avatar: normMedia(data.individual.avatar) },
    encounters: (data.encs || []).map(normEncounter).filter(Boolean).sort((a, b) => a.time - b.time),
  }
}
