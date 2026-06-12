/**
 * happywhaleService — data layer for the EarthAtlas /happywhale tool.
 *
 * Source: HappyWhale's external API (hwx), fronted by our edge proxy at
 * /api/happywhale (api/happywhale.js). Spec: docs/happywhale/openapi.yml
 * (also https://animal.us/apis/hwx/). Endpoints used:
 *   POST /encounters          — area (wkt | circle) + date range → BBEncounter[]
 *   POST /individual/info/:id — one individual + ALL its encounters worldwide
 *   GET  /config/species      — speciesKey → {name, plural, scientific} map
 *
 * As of 2026-06-11 the API is NOT live yet (next HappyWhale release cycle,
 * likely 1–2 months out; beta server first — Ken Southerland). Until then this
 * service runs in DEMO mode: a deterministic, spec-shaped mock dataset so the
 * whole tool can be built and QA'd now. Mode resolution:
 *   VITE_HAPPYWHALE_MODE = 'live'  — proxy only, surface errors
 *   VITE_HAPPYWHALE_MODE = 'mock'  — demo data only
 *   unset ('auto')                 — try the proxy, fall back to demo data
 * Every fetcher returns a `live` boolean so the UI can badge demo data.
 */

const API = '/api/happywhale'
const MODE = import.meta.env.VITE_HAPPYWHALE_MODE || 'auto'

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

/** Public HappyWhale page for an identified individual (live data only). */
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
    media: raw.media ? { type: raw.media.type, thumbUrl: raw.media.thumbUrl || null, url: raw.media.url || null } : null,
    individual: ind ? {
      id: ind.id,
      primaryId: ind.primaryId || null,
      nickname: ind.nickname || null,
      sex: ind.sex || null,
      avatar: ind.avatar ? { thumbUrl: ind.avatar.thumbUrl || null, url: ind.avatar.url || null } : null,
    } : null,
  }
}

const toDateStr = (ms) => new Date(ms).toISOString().slice(0, 10)

// ─── Fetchers ────────────────────────────────────────────────────────────────
/**
 * Species config (speciesKey → labels). Cache-forever data per the API docs.
 * Returns { species: [{code, name, plural, scientific}], live }.
 */
export async function fetchSpeciesConfig({ signal } = {}) {
  if (MODE !== 'mock') {
    try {
      const data = await proxyJSON('species', { signal })
      if (Array.isArray(data)) return { species: data, live: true }
      throw new Error('unexpected species payload')
    } catch (err) {
      if (MODE === 'live' || err.name === 'AbortError') throw err
    }
  }
  return { species: mockStore().speciesConfig, live: false }
}

/**
 * Encounters for an optional circle ({lat,lng,radiusMeters}) + date window
 * (from/to as epoch ms). Returns { encounters, limitExceeded, live }.
 * Note: the API has no species parameter — species filtering is client-side.
 */
export async function fetchEncounters({ circle, from, to, signal } = {}) {
  if (MODE !== 'mock') {
    try {
      const body = { date: { from: toDateStr(from), ...(to ? { to: toDateStr(to) } : {}) } }
      if (circle) body.area = { circle: { center: { lat: circle.lat, lng: circle.lng }, radius: circle.radiusMeters } }
      const data = await proxyJSON('encounters', { body, signal })
      if (data && Array.isArray(data.results)) {
        return {
          encounters: data.results.map(normEncounter).filter(Boolean),
          limitExceeded: !!data.limitExceeded,
          live: true,
        }
      }
      throw new Error('unexpected encounters payload')
    } catch (err) {
      if (MODE === 'live' || err.name === 'AbortError') throw err
    }
  }
  return mockEncounters({ circle, from, to })
}

/**
 * One identified individual + every encounter of it worldwide (for journey
 * tracks). Returns { individual, encounters, live }.
 */
export async function fetchIndividualTrack({ id, signal } = {}) {
  if (MODE !== 'mock') {
    try {
      const data = await proxyJSON(`individual&id=${encodeURIComponent(id)}`, { body: {}, signal })
      if (data && data.individual) {
        return {
          individual: data.individual,
          encounters: (data.encs || []).map(normEncounter).filter(Boolean).sort((a, b) => a.time - b.time),
          // No ocean routing for live data (we don't know the geography of
          // arbitrary encounters) — the app falls back to point-to-point lines.
          path: null,
          live: true,
        }
      }
      throw new Error('unexpected individual payload')
    } catch (err) {
      if (MODE === 'live' || err.name === 'AbortError') throw err
    }
  }
  return mockIndividualTrack(id)
}

// ═════════════════════════════════════════════════════════════════════════════
// DEMO DATASET — deterministic, shaped exactly like the hwx spec, so flipping
// to the live API changes zero UI code. Delete nothing here when the API goes
// live: auto mode keeps it as the graceful-degradation fallback.
// ═════════════════════════════════════════════════════════════════════════════

// Small seeded PRNG so the demo map is identical across loads/shares.
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MOCK_SPECIES = [
  { code: 'humpback_whale', name: 'Humpback Whale', plural: 'Humpback Whales', scientific: 'Megaptera novaeangliae', icon: 'humpback' },
  { code: 'blue_whale', name: 'Blue Whale', plural: 'Blue Whales', scientific: 'Balaenoptera musculus', icon: 'blue' },
  { code: 'gray_whale', name: 'Gray Whale', plural: 'Gray Whales', scientific: 'Eschrichtius robustus', icon: 'gray' },
  { code: 'killer_whale', name: 'Killer Whale', plural: 'Killer Whales', scientific: 'Orcinus orca', icon: 'orca' },
  { code: 'sperm_whale', name: 'Sperm Whale', plural: 'Sperm Whales', scientific: 'Physeter macrocephalus', icon: 'sperm' },
  { code: 'fin_whale', name: 'Fin Whale', plural: 'Fin Whales', scientific: 'Balaenoptera physalus', icon: 'fin' },
  { code: 'minke_whale', name: 'Minke Whale', plural: 'Minke Whales', scientific: 'Balaenoptera acutorostrata', icon: 'minke' },
  { code: 'southern_right_whale', name: 'Southern Right Whale', plural: 'Southern Right Whales', scientific: 'Eubalaena australis', icon: 'right' },
]

// Real-world hotspots with rough seasonality (months 1–12) and species mixes.
// `anchors` are hand-placed OPEN-WATER points ([lat, lng]) ordered along a sea
// corridor, index 0 being the corridor's open-ocean "gate". Encounters spawn
// near a random anchor with a small jitter, so demo dots never land ashore;
// journey tracks walk the anchor chain so within-hotspot segments stay in the
// same water body (straits, bays) instead of cutting across islands.
const HOTSPOTS = [
  { key: 'monterey', anchors: [[36.55, -122.45], [36.7, -122.2], [36.78, -122.0]], jitter: 0.06, region: 'Monterey Bay, California', sea: null, ocean: 'Pacific Ocean', months: [4, 5, 6, 7, 8, 9, 10], species: ['humpback_whale', 'blue_whale', 'killer_whale', 'fin_whale', 'gray_whale'] },
  { key: 'maui', anchors: [[20.6, -156.8], [20.72, -156.7], [20.85, -156.73]], jitter: 0.03, region: 'Maui, Hawaiʻi', sea: null, ocean: 'Pacific Ocean', months: [12, 1, 2, 3, 4], species: ['humpback_whale'] },
  { key: 'seak', anchors: [[56.7, -134.85], [57.3, -134.85], [57.8, -134.9], [58.18, -135.35]], jitter: 0.05, region: 'Southeast Alaska', sea: null, ocean: 'Pacific Ocean', months: [5, 6, 7, 8, 9], species: ['humpback_whale', 'killer_whale'] },
  { key: 'salish', anchors: [[48.4, -124.8], [48.3, -124.2], [48.3, -123.6], [48.45, -123.18]], jitter: 0.04, region: 'Salish Sea, Washington', sea: 'Salish Sea', ocean: 'Pacific Ocean', months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], species: ['killer_whale', 'humpback_whale', 'minke_whale'] },
  { key: 'baja', anchors: [[26.55, -113.65], [26.72, -113.4], [26.79, -113.27]], jitter: 0.03, region: 'San Ignacio Lagoon, Baja California Sur', sea: null, ocean: 'Pacific Ocean', months: [1, 2, 3, 4], species: ['gray_whale'] },
  { key: 'azores', anchors: [[38.2, -29.1], [38.4, -28.75], [38.35, -28.55]], jitter: 0.05, region: 'Azores, Portugal', sea: null, ocean: 'Atlantic Ocean', months: [4, 5, 6, 7, 8, 9], species: ['sperm_whale', 'blue_whale', 'fin_whale'] },
  { key: 'dominica', anchors: [[15.2, -61.75], [15.35, -61.58], [15.5, -61.52]], jitter: 0.03, region: 'Dominica, Caribbean', sea: 'Caribbean Sea', ocean: 'Atlantic Ocean', months: [11, 12, 1, 2, 3], species: ['sperm_whale'] },
  { key: 'stellwagen', anchors: [[42.25, -69.9], [42.35, -70.25], [42.45, -70.45]], jitter: 0.05, region: 'Stellwagen Bank, Massachusetts', sea: 'Gulf of Maine', ocean: 'Atlantic Ocean', months: [4, 5, 6, 7, 8, 9, 10], species: ['humpback_whale', 'fin_whale', 'minke_whale'] },
  { key: 'iceland', anchors: [[66.6, -17.5], [66.25, -17.6], [66.05, -17.65]], jitter: 0.04, region: 'Skjálfandi Bay, Iceland', sea: 'Greenland Sea', ocean: 'Atlantic Ocean', months: [5, 6, 7, 8, 9], species: ['humpback_whale', 'blue_whale', 'minke_whale'] },
  { key: 'tonga', anchors: [[-19.1, -174.4], [-18.8, -174.25], [-18.6, -174.3]], jitter: 0.05, region: 'Vavaʻu, Tonga', sea: null, ocean: 'Pacific Ocean', months: [7, 8, 9, 10], species: ['humpback_whale'] },
  { key: 'antarctica', anchors: [[-63.4, -61.5], [-64.2, -62.5], [-64.8, -63.9]], jitter: 0.05, region: 'Antarctic Peninsula', sea: 'Southern Ocean', ocean: 'Southern Ocean', months: [12, 1, 2, 3], species: ['humpback_whale', 'minke_whale', 'killer_whale'] },
  { key: 'peninsula_valdes', anchors: [[-42.8, -62.9], [-42.5, -63.3]], jitter: 0.06, region: 'Península Valdés, Argentina', sea: null, ocean: 'Atlantic Ocean', months: [6, 7, 8, 9, 10, 11], species: ['southern_right_whale', 'killer_whale'] },
  { key: 'sri_lanka', anchors: [[5.4, 80.4], [5.7, 80.45], [5.82, 80.6]], jitter: 0.05, region: 'Mirissa, Sri Lanka', sea: 'Laccadive Sea', ocean: 'Indian Ocean', months: [12, 1, 2, 3, 4], species: ['blue_whale', 'sperm_whale'] },
]

// Open-ocean corridors between hotspot GATES (anchor[0] ↔ anchor[0]), keyed
// 'a|b'. Waypoints are [lat, lng], ordered a → b, each placed in open water
// with margin around capes/islands so journey tracks never cross land.
// Each direction gets its OWN corridor, separated by a few degrees of open
// ocean (like real migration loops — coastal one way, offshore the other).
// Two reasons: round trips read as a clean loop of two arrowed paths instead
// of arrows fighting over one line, and Mapbox silently drops line-placed
// symbols on features with identical overlapping geometry, so out- and
// return legs must never share a line string.
// (Maui note: its gate sits SW of the Lahaina channels, so every Maui route
// must first clear the island chain — north past Oʻahu or south around the
// Big Island, never northeast over Maui itself.)
const ROUTES = {
  // Pacific: Hawaiʻi ↔ Alaska (out past Oʻahu / back mid-Pacific)
  'maui|seak': [[20.4, -157.3], [21, -158.4], [22.6, -158.6], [30, -150], [45, -140], [54, -137.5], [55.8, -135.6]],
  'seak|maui': [[55.6, -136.5], [52, -141], [43, -146], [28, -154], [22, -157.5], [20.5, -157.5]],
  // Pacific: Hawaiʻi ↔ California (south around the Big Island / back offshore)
  'maui|monterey': [[20.2, -156.65], [18.6, -156.2], [20, -150], [30, -135], [34.5, -126]],
  'monterey|maui': [[35.5, -124.5], [31, -131], [24, -143], [19.5, -152], [18.9, -155.5], [20, -156.7]],
  // Pacific: Alaska ↔ California (coastal / back offshore)
  'seak|monterey': [[55.5, -136.5], [51, -133.5], [45, -127.5], [39, -124.5]],
  'monterey|seak': [[38, -126.5], [44, -130.5], [50, -136], [55, -138.5], [56.2, -135.9]],
  // Pacific: Salish Sea ↔ Alaska (coastal / back offshore)
  'salish|seak': [[48.45, -125.3], [49.5, -127.3], [51.5, -131], [54.5, -134], [55.8, -135.3]],
  'seak|salish': [[55.6, -136.8], [53, -134.8], [50.5, -130], [48.8, -126.5]],
  // Pacific: Salish Sea ↔ California (coastal / back offshore)
  'salish|monterey': [[48.45, -125.3], [46.5, -125.5], [43, -125.5], [40, -125], [38, -123.8]],
  'monterey|salish': [[37.5, -125], [41, -127.5], [45, -128], [47.8, -126.8]],
  // Pacific: Baja ↔ California (nearshore north / back offshore — the real
  // gray-whale pattern)
  'baja|monterey': [[26.4, -114.3], [28.5, -116.2], [30.5, -117.5], [32.5, -119.5], [34.2, -121.3], [35.6, -121.9]],
  'monterey|baja': [[35.2, -123.5], [32, -122], [29, -119.5], [26.8, -116.5], [26, -114.5]],
  // South Pacific: Tonga ↔ Antarctic Peninsula
  'tonga|antarctica': [[-25, -172], [-35, -165], [-48, -140], [-58, -110], [-62, -85], [-62.5, -68]],
  'antarctica|tonga': [[-63.5, -75], [-60, -100], [-52, -130], [-40, -155], [-28, -168], [-21, -172.5]],
  // Atlantic: Gulf of Maine ↔ Iceland
  'stellwagen|iceland': [[42, -68.5], [42.8, -64], [45, -55], [50, -45], [56, -38], [62, -30], [65.8, -26], [66.8, -23.5], [66.9, -20.5]],
  'iceland|stellwagen': [[67.3, -21], [67.2, -25.5], [64, -31], [57, -41], [50, -50], [44, -59], [41.5, -65.5]],
  // Atlantic: Azores ↔ Iceland
  'azores|iceland': [[42, -28], [50, -26], [58, -24], [63.5, -25.5], [65.5, -26], [66.7, -24.5], [66.9, -21]],
  'iceland|azores': [[67.2, -22], [66.5, -28], [62, -30], [54, -30], [46, -31], [40.5, -29.5]],
  // Atlantic: Azores ↔ Dominica (both directions thread the Guadeloupe
  // channel, then diverge across the open Atlantic)
  'azores|dominica': [[35, -35], [28, -45], [21, -55], [17.5, -59], [16.1, -61.05], [15.8, -61.5]],
  'dominica|azores': [[15.75, -61.45], [16.5, -59.5], [20, -52], [26, -43], [33, -33.5]],
}

function corridorFor(a, b) {
  if (ROUTES[`${a}|${b}`]) return { key: `${a}|${b}`, wps: ROUTES[`${a}|${b}`], reversed: false }
  // Fallback for any pair authored in one direction only.
  if (ROUTES[`${b}|${a}`]) return { key: `${b}|${a}`, wps: ROUTES[`${b}|${a}`], reversed: true }
  return null
}


// Identified individuals: nickname, species, and the hotspots they migrate
// between — humpbacks Hawaiʻi↔Alaska, grays Baja↔California, etc. The pairs are
// what make journey tracks worth drawing.
const MOCK_INDIVIDUALS = [
  { nickname: 'Comet', species: 'humpback_whale', sex: 'MALE', spots: ['maui', 'seak'] },
  { nickname: 'Half Moon', species: 'humpback_whale', sex: 'FEMALE', spots: ['maui', 'seak'] },
  { nickname: 'Inkwell', species: 'humpback_whale', sex: 'FEMALE', spots: ['maui', 'seak', 'monterey'] },
  { nickname: 'Banjo', species: 'humpback_whale', sex: 'MALE', spots: ['tonga', 'antarctica'] },
  { nickname: 'Tempest', species: 'humpback_whale', sex: 'FEMALE', spots: ['tonga', 'antarctica'] },
  { nickname: 'Quill', species: 'humpback_whale', sex: 'UNKNOWN', spots: ['stellwagen'] },
  { nickname: 'Cascade', species: 'humpback_whale', sex: 'FEMALE', spots: ['stellwagen', 'iceland'] },
  { nickname: 'Sojourner', species: 'humpback_whale', sex: 'MALE', spots: ['monterey', 'maui'] },
  { nickname: 'Orion', species: 'blue_whale', sex: 'MALE', spots: ['monterey'] },
  { nickname: 'Meridian', species: 'blue_whale', sex: 'UNKNOWN', spots: ['azores', 'iceland'] },
  { nickname: 'Fathom', species: 'blue_whale', sex: 'FEMALE', spots: ['sri_lanka'] },
  { nickname: 'Saltlick', species: 'gray_whale', sex: 'FEMALE', spots: ['baja', 'monterey'] },
  { nickname: 'Drifter', species: 'gray_whale', sex: 'MALE', spots: ['baja', 'monterey'] },
  { nickname: 'Glacier', species: 'killer_whale', sex: 'MALE', spots: ['salish', 'seak'] },
  { nickname: 'Luna', species: 'killer_whale', sex: 'FEMALE', spots: ['salish'] },
  { nickname: 'Pinwheel', species: 'killer_whale', sex: 'FEMALE', spots: ['salish', 'monterey'] },
  { nickname: 'Nautilus', species: 'sperm_whale', sex: 'MALE', spots: ['azores', 'dominica'] },
  { nickname: 'Calypso', species: 'sperm_whale', sex: 'FEMALE', spots: ['dominica'] },
  { nickname: 'Scrimshaw', species: 'sperm_whale', sex: 'MALE', spots: ['azores'] },
  { nickname: 'Ember', species: 'fin_whale', sex: 'UNKNOWN', spots: ['stellwagen'] },
  { nickname: 'Compass', species: 'fin_whale', sex: 'MALE', spots: ['azores'] },
  { nickname: 'Wren', species: 'minke_whale', sex: 'FEMALE', spots: ['iceland'] },
  { nickname: 'Sable', species: 'southern_right_whale', sex: 'FEMALE', spots: ['peninsula_valdes'] },
  { nickname: 'Marlow', species: 'southern_right_whale', sex: 'MALE', spots: ['peninsula_valdes'] },
]

const SPECIES_ID_PREFIX = {
  humpback_whale: 'MN', blue_whale: 'BM', gray_whale: 'ER', killer_whale: 'OO',
  sperm_whale: 'PM', fin_whale: 'BP', minke_whale: 'BA', southern_right_whale: 'EA',
}

// REAL HappyWhale photos (harvested from happywhale.com/browse, 2026-06) so
// the demo popups/cards show what live media will look like. Only species
// whose photos we could verify get a pool — the rest stay photo-less, which
// also exercises the no-photo popup variant. HappyWhale's media buckets, all
// keyed by the same UUID: `-t` = 100px micro-thumb (public), `-m` = 1200px
// medium (public), `-f` = full-res (403, access-controlled). Demo encounters
// put the -m variant in thumbUrl because the popup's ~250px photo slot turns
// the 100px -t to mush; avatars use -t (perfect for a 38px circle). Which
// bucket the real API's thumbUrl/url point at is an open question for Ken.
const MEDIA_HOST_T = 'https://au-hw-media-t.happywhale.com/'
const MEDIA_HOST_M = 'https://au-hw-media-m.happywhale.com/'
const REAL_ENCOUNTER_THUMBS = {
  humpback_whale: [
    'a5d552a3-3e42-4202-a79b-bdea85fc68a0.jpg',
    'f294c5ef-0f32-4f9f-848e-636b4577f1b7.jpg',
    'da37032d-b47a-4dfa-b619-1303103144cc.jpg',
    '6dcfd10c-33df-4af4-a991-17f6c0840d8b.jpg',
    'e78d983f-f160-4ed2-8681-bd03ee4d68cf.jpg',
    '493b885b-2ce1-4ba3-a07d-508c906b7900.jpg',
    '6b7a8263-2795-4fcc-a74c-24735f5b1e0b.jpg',
  ],
  sperm_whale: [
    '5ff3578e-3726-4df1-addf-7a7f267c0081.jpg',
    '627e70a0-b2e6-4688-a198-bc7bdc552861.jpg',
    '4d6c31ec-f078-4d87-bf52-eaceb260c206.jpg',
    'e1c45ce5-fb8a-48f9-a6a5-58c9c8ee1a47.jpg',
    '9424d9a5-dbce-43ee-b64e-0f99ce41ebcb.jpg',
  ],
}
const REAL_AVATARS = {
  humpback_whale: [
    'e81f4893-b87c-4f76-a85a-33c95ddb173c.jpg',
    'c808e542-4da7-46b5-a788-163e5176bf07.jpg',
    '7c791f85-5597-45a0-af49-1ddc6418df53.jpg',
  ],
  sperm_whale: [
    '5ff3578e-3726-4df1-addf-7a7f267c0081.jpg',
  ],
}

let _store = null
function mockStore() {
  if (_store) return _store

  const rnd = mulberry32(20260611)
  const now = Date.now()
  const DAY = 86400e3
  const spanDays = 720 // two years back, so every preset has data

  // Random date within the past `spanDays` whose month is allowed for the spot.
  function seasonalTime(spot) {
    for (let tries = 0; tries < 40; tries++) {
      const t = now - rnd() * spanDays * DAY
      const m = new Date(t).getUTCMonth() + 1
      if (spot.months.includes(m)) return t
    }
    return now - rnd() * spanDays * DAY
  }
  // A water-safe position: a random corridor anchor plus a small jitter.
  function waterPoint(spot) {
    const anchorIdx = Math.floor(rnd() * spot.anchors.length)
    const [alat, alng] = spot.anchors[anchorIdx]
    return {
      anchorIdx,
      lat: alat + (rnd() - 0.5) * 2 * spot.jitter,
      lng: alng + (rnd() - 0.5) * 2 * spot.jitter,
    }
  }

  const spotByKey = Object.fromEntries(HOTSPOTS.map((h) => [h.key, h]))
  const encounters = []
  const individuals = new Map() // id → { individual(BBIndividual-ish), encounterIds }
  const encMeta = new Map() // encId → { spot, anchorIdx } (for water-safe track routing)
  let encId = 41000
  let indId = 7300
  let mediaId = 90000

  // ~60% of encounters of a pooled species carry a real HappyWhale thumbnail.
  const mediaFor = (speciesKey) => {
    const pool = REAL_ENCOUNTER_THUMBS[speciesKey]
    if (!pool || rnd() > 0.6) return null
    return { id: mediaId++, type: 'IMAGE', thumbUrl: MEDIA_HOST_M + pool[Math.floor(rnd() * pool.length)], url: null }
  }
  // Hand each pooled species' first individuals a distinct real avatar.
  const avatarCursor = {}
  const avatarFor = (speciesKey) => {
    const pool = REAL_AVATARS[speciesKey]
    const i = avatarCursor[speciesKey] || 0
    if (!pool || i >= pool.length) return null
    avatarCursor[speciesKey] = i + 1
    return { id: mediaId++, type: 'IMAGE', thumbUrl: MEDIA_HOST_T + pool[i], url: null }
  }

  // Identified individuals: 4–10 encounters each across their hotspot circuit.
  for (const def of MOCK_INDIVIDUALS) {
    const id = indId++
    const individual = {
      id,
      speciesKey: def.species,
      primaryId: `HW-${SPECIES_ID_PREFIX[def.species] || 'XX'}-${1000 + Math.floor(rnd() * 9000)}`,
      nickname: def.nickname,
      sex: def.sex,
      avatar: avatarFor(def.species),
    }
    const n = 4 + Math.floor(rnd() * 7)
    const ids = []
    for (let i = 0; i < n; i++) {
      // Rotate through the circuit (not random) so every multi-hotspot
      // individual demonstrably migrates — that's the point of the journeys.
      const spot = spotByKey[def.spots[i % def.spots.length]]
      const t = seasonalTime(spot)
      const pos = waterPoint(spot)
      const e = {
        id: encId++,
        date: toDateStr(t),
        latlng: [pos.lat, pos.lng],
        region: spot.region,
        sea: spot.sea,
        ocean: spot.ocean,
        speciesKey: def.species,
        minCount: 1, maxCount: 1 + Math.floor(rnd() * 2),
        media: mediaFor(def.species),
        individual,
      }
      encounters.push(e)
      encMeta.set(e.id, { spot: spot.key, anchorIdx: pos.anchorIdx })
      ids.push(e.id)
    }
    individuals.set(id, { individual, encounterIds: ids })
  }

  // Unidentified encounters fill out each hotspot.
  for (const spot of HOTSPOTS) {
    const n = 22 + Math.floor(rnd() * 26)
    for (let i = 0; i < n; i++) {
      const speciesKey = spot.species[Math.floor(rnd() * spot.species.length)]
      const t = seasonalTime(spot)
      const pos = waterPoint(spot)
      const minCount = 1 + Math.floor(rnd() * 3)
      const e = {
        id: encId++,
        date: toDateStr(t),
        latlng: [pos.lat, pos.lng],
        region: spot.region,
        sea: spot.sea,
        ocean: spot.ocean,
        speciesKey,
        minCount,
        maxCount: minCount + Math.floor(rnd() * 5),
        media: mediaFor(speciesKey),
        individual: null,
      }
      encounters.push(e)
      encMeta.set(e.id, { spot: spot.key, anchorIdx: pos.anchorIdx })
    }
  }

  _store = { speciesConfig: MOCK_SPECIES, encounters, individuals, encMeta, spotByKey }
  return _store
}

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

function mockEncounters({ circle, from, to }) {
  const all = mockStore().encounters
  const results = all.map(normEncounter).filter((e) => {
    if (from && e.time < from) return false
    if (to && e.time > to) return false
    if (circle && havKm(circle.lat, circle.lng, e.lat, e.lng) * 1000 > circle.radiusMeters) return false
    return true
  })
  return { encounters: results, limitExceeded: false, live: false }
}

// ─── Water-safe journey paths ────────────────────────────────────────────────
// Build the journey as one LEG per encounter-to-encounter hop, each a smoothed
// [lng,lat] polyline that never crosses land:
//  - same-hotspot legs walk the hotspot's anchor chain (stays inside the bay
//    or strait the dots live in),
//  - cross-hotspot legs exit via the hotspot gate (anchor[0]), follow the
//    open-ocean ROUTES corridor, and enter the destination via its gate.
// Each leg carries `side` (+1/-1 by travel direction along the corridor,
// 0 for local hops): the app offsets the arrow glyphs perpendicular by ems —
// a SCREEN-SPACE lane separation that holds at every zoom, unlike a
// geographic offset which merges at low zoom and over-spreads at high zoom.
function waterPathFor(encounters, store) {
  const legs = []
  // A whale that crosses the same corridor four times would draw four nearly
  // identical arrow chains stacked on each other. Each distinct route
  // segment + direction renders once — the repeat crossings add no visual
  // information, only clutter.
  const seen = new Set()
  for (let i = 1; i < encounters.length; i++) {
    const from = encounters[i - 1]
    const to = encounters[i]
    const raw = [[from.lat, from.lng]]
    const pushPt = (lat, lng) => {
      const prev = raw[raw.length - 1]
      if (Math.abs(prev[0] - lat) > 1e-6 || Math.abs(prev[1] - lng) > 1e-6) raw.push([lat, lng])
    }

    let side = 0
    const fromMeta = store.encMeta.get(from.id)
    const toMeta = store.encMeta.get(to.id)
    if (fromMeta && toMeta) {
      const legKey = fromMeta.spot === toMeta.spot
        ? `${fromMeta.spot}:${fromMeta.anchorIdx}>${toMeta.anchorIdx}`
        : `${fromMeta.spot}>${toMeta.spot}`
      if (seen.has(legKey)) continue
      seen.add(legKey)
      const fromSpot = store.spotByKey[fromMeta.spot]
      const toSpot = store.spotByKey[toMeta.spot]
      if (fromMeta.spot === toMeta.spot) {
        // Walk the anchors strictly between the two positions' anchors
        // (none when they share an anchor or sit on adjacent ones).
        const a0 = fromMeta.anchorIdx, a1 = toMeta.anchorIdx
        const step = a0 <= a1 ? 1 : -1
        for (let a = a0 + step; step > 0 ? a < a1 : a > a1; a += step) pushPt(...fromSpot.anchors[a])
      } else {
        // Out through the gate, along the corridor, in through the gate.
        for (let a = fromMeta.anchorIdx - 1; a >= 0; a--) pushPt(...fromSpot.anchors[a])
        const corridor = corridorFor(fromMeta.spot, toMeta.spot)
        if (corridor) {
          side = corridor.reversed ? -1 : 1
          for (const wp of (corridor.reversed ? [...corridor.wps].reverse() : corridor.wps)) pushPt(...wp)
        }
        for (let a = 0; a < toMeta.anchorIdx; a++) pushPt(...toSpot.anchors[a])
      }
    }
    pushPt(to.lat, to.lng)

    if (raw.length > 1) legs.push({ side, coords: catmullRom(raw.map(([lat, lng]) => [lng, lat])) })
  }
  return legs
}

// Centripetal Catmull-Rom through all control points — gentle curves between
// waypoints. Centripetal (not uniform) parameterization matters here: with
// very uneven point spacing (short anchor hops next to 30°-long ocean legs)
// the uniform variant overshoots, which could swing the curve back onto the
// land the waypoints steer around; centripetal is overshoot-free.
function catmullRom(pts, samplesPerSeg = 8) {
  if (pts.length < 3) return pts
  const get = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))]
  const knot = (a, b) => Math.sqrt(Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), 1e-6))
  const out = [pts[0]]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2)
    const t0 = 0
    const t1 = t0 + knot(p0, p1)
    const t2 = t1 + knot(p1, p2)
    const t3 = t2 + knot(p2, p3)
    for (let s = 1; s <= samplesPerSeg; s++) {
      const t = t1 + ((t2 - t1) * s) / samplesPerSeg
      out.push([0, 1].map((d) => {
        const a1 = ((t1 - t) * p0[d] + (t - t0) * p1[d]) / (t1 - t0)
        const a2 = ((t2 - t) * p1[d] + (t - t1) * p2[d]) / (t2 - t1)
        const a3 = ((t3 - t) * p2[d] + (t - t2) * p3[d]) / (t3 - t2)
        const b1 = ((t2 - t) * a1 + (t - t0) * a2) / (t2 - t0)
        const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1)
        return ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1)
      }))
    }
  }
  return out
}

function mockIndividualTrack(id) {
  const store = mockStore()
  const entry = store.individuals.get(Number(id))
  if (!entry) return { individual: null, encounters: [], path: null, live: false }
  const set = new Set(entry.encounterIds)
  const encounters = store.encounters.filter((e) => set.has(e.id))
    .map(normEncounter).filter(Boolean).sort((a, b) => a.time - b.time)
  return { individual: entry.individual, encounters, path: waterPathFor(encounters, store), live: false }
}
