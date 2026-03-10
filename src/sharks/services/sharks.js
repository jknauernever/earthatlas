/**
 * Shark-specific data service
 * Built on top of GBIF occurrence API + iNaturalist API
 *
 * Uses Elasmobranchii (class key 121) as a single taxon query — same pattern
 * as the whales service uses Cetacea (key 733). Elasmobranchii includes rays
 * but those are filtered out by the SPECIES_META lookup (unrecognized species
 * are labeled generically and sorted to the bottom).
 *
 * GBIF shark orders under Elasmobranchii:
 *   Lamniformes       (Great White, Mako, Thresher, Basking) — key 885
 *   Carcharhiniformes (Tiger, Bull, Hammerheads, Reef)       — key 887
 *   Orectolobiformes  (Whale Shark, Nurse, Wobbegong)        — key 769
 *   Squaliformes      (Dogfish, Sleeper sharks)              — key 883
 *
 * iNaturalist taxon for sharks: 47273 (Selachimorpha)
 */

const GBIF_API = 'https://api.gbif.org/v1'
const INAT_API = 'https://api.inaturalist.org/v1'

// Single GBIF taxon key — Elasmobranchii (sharks + rays + skates)
const SHARK_KEY = 121

// Shark-only order keys for filtering out rays/skates from Elasmobranchii results
const SHARK_ORDER_KEYS = new Set([
  885,  // Lamniformes (Great White, Mako, Thresher, Basking)
  887,  // Carcharhiniformes (Tiger, Bull, Hammerheads, Reef)
  769,  // Orectolobiformes (Whale Shark, Nurse, Wobbegong)
  883,  // Squaliformes (Dogfish, Sleeper sharks)
  770,  // Hexanchiformes (Cow sharks, Frilled shark)
  886,  // Heterodontiformes (Bullhead sharks)
  767,  // Pristiophoriformes (Sawsharks)
  882,  // Squatiniformes (Angel sharks)
])

function isShark(occ) {
  return SHARK_ORDER_KEYS.has(occ.orderKey)
}

// iNaturalist taxon ID for sharks (Selachimorpha)
const INAT_SHARK_TAXON = 47273

// Dataset key for iNaturalist on GBIF (to deduplicate)
const GBIF_INAT_DATASET = '50c9509d-22c7-4a22-a47d-8c48425ef4a7'

// ─── Species metadata ─────────────────────────────────────────────────────────
// Per-species color is the map dot color — vivid/luminous for dark ocean backgrounds
export const SPECIES_META = {
  // ─── Order Lamniformes ────────────────────────────────────────────────────
  2420694: {
    common: 'Great White Shark', scientific: 'Carcharodon carcharias',
    color: '#c0392b', emoji: '🦈', lengthM: 6,
    fact: 'Can detect a single drop of blood in 25 gallons of water and sense electric fields as faint as a half-billionth of a volt.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/150546290/medium.jpeg',
    iucn: 'VU',
  },
  5216248: {
    common: 'Shortfin Mako', scientific: 'Isurus oxyrinchus',
    color: '#3090ff', emoji: '🦈', lengthM: 3.8,
    fact: 'The fastest shark on Earth — capable of bursts exceeding 45 mph and leaping 20 feet out of the water.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/70551905/medium.jpg',
    iucn: 'EN',
  },
  5216258: {
    common: 'Longfin Mako', scientific: 'Isurus paucus',
    color: '#2070d0', emoji: '🦈', lengthM: 4.3,
    fact: 'Rarer and less studied than its shortfin cousin — distinguished by its long, broad pectoral fins.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/28758924/medium.jpg',
    iucn: 'EN',
  },
  2420726: {
    common: 'Basking Shark', scientific: 'Cetorhinus maximus',
    color: '#a060d0', emoji: '🦈', lengthM: 12,
    fact: 'The second-largest fish on Earth — filters up to 2,000 tons of water per hour through its gaping jaws.',
    photoUrl: 'https://static.inaturalist.org/photos/310765197/medium.jpg',
    iucn: 'VU',
  },
  2420797: {
    common: 'Common Thresher Shark', scientific: 'Alopias vulpinus',
    color: '#c060a0', emoji: '🦈', lengthM: 6,
    fact: 'Stuns prey by cracking its tail like a whip — generating one of the fastest strikes in the ocean.',
    photoUrl: 'https://static.inaturalist.org/photos/61205816/medium.jpg',
    iucn: 'VU',
  },
  2420809: {
    common: 'Pelagic Thresher', scientific: 'Alopias pelagicus',
    color: '#b050b0', emoji: '🦈', lengthM: 3.5,
    fact: 'The most oceanic thresher — rarely comes near shore and spends its life in the open Indo-Pacific.',
    photoUrl: 'https://static.inaturalist.org/photos/257429672/medium.jpg',
    iucn: 'EN',
  },
  // ─── Order Carcharhiniformes ───────────────────────────────────────────────
  2418234: {
    common: 'Tiger Shark', scientific: 'Galeocerdo cuvier',
    color: '#f0a500', emoji: '🦈', lengthM: 5.5,
    fact: 'The ocean\'s garbage collectors — known to swallow license plates, tires, and even a suit of armor.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/19051907/medium.jpg',
    iucn: 'NT',
  },
  2418036: {
    common: 'Bull Shark', scientific: 'Carcharhinus leucas',
    color: '#e05050', emoji: '🦈', lengthM: 3.5,
    fact: 'The only shark that can survive indefinitely in freshwater — found in rivers up to 2,500 miles inland.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/351417931/medium.jpg',
    iucn: 'VU',
  },
  2418792: {
    common: 'Great Hammerhead', scientific: 'Sphyrna mokarran',
    color: '#00d4d4', emoji: '🦈', lengthM: 6,
    fact: 'Its wide-set eyes give it 360° vertical vision — it can see above and below simultaneously.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/12399600/medium.jpg',
    iucn: 'CR',
  },
  2418789: {
    common: 'Scalloped Hammerhead', scientific: 'Sphyrna lewini',
    color: '#00b8e0', emoji: '🦈', lengthM: 4.3,
    fact: 'Forms enormous schools of hundreds during the day — then disperses to hunt alone at night.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/224059254/medium.jpg',
    iucn: 'CR',
  },
  2418794: {
    common: 'Smooth Hammerhead', scientific: 'Sphyrna zygaena',
    color: '#10a0c8', emoji: '🦈', lengthM: 4,
    fact: 'The most widely distributed hammerhead — found in temperate waters where others rarely venture.',
    photoUrl: 'https://static.inaturalist.org/photos/462644734/medium.jpg',
    iucn: 'VU',
  },
  2418052: {
    common: 'Oceanic Whitetip', scientific: 'Carcharhinus longimanus',
    color: '#f07030', emoji: '🦈', lengthM: 4,
    fact: 'Once the most numerous large shark in the open ocean — now critically endangered after population collapse.',
    photoUrl: 'https://static.inaturalist.org/photos/21906877/medium.jpg',
    iucn: 'CR',
  },
  2417981: {
    common: 'Blacktip Reef Shark', scientific: 'Carcharhinus melanopterus',
    color: '#60d060', emoji: '🦈', lengthM: 1.8,
    fact: 'Identified by its distinctive black-tipped fins — one of the most commonly seen reef sharks.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/405675476/medium.jpeg',
    iucn: 'VU',
  },
  2417970: {
    common: 'Blacktip Shark', scientific: 'Carcharhinus limbatus',
    color: '#50c050', emoji: '🦈', lengthM: 2.5,
    fact: 'Spins up through schools of fish and launches spiraling into the air — one of the most acrobatic sharks.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/247619680/medium.jpg',
    iucn: 'NT',
  },
  2418054: {
    common: 'Whitetip Reef Shark', scientific: 'Triaenodon obesus',
    color: '#d0d070', emoji: '🦈', lengthM: 2,
    fact: 'Packs cooperate to flush prey from coral crevices at night — one of the few truly social sharks.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/29230134/medium.jpg',
    iucn: 'VU',
  },
  2417940: {
    common: 'Blue Shark', scientific: 'Prionace glauca',
    color: '#4060e8', emoji: '🦈', lengthM: 3.8,
    fact: 'The most wide-ranging shark on Earth — regularly crosses ocean basins and can travel 1,000+ miles in weeks.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/358688436/medium.jpg',
    iucn: 'NT',
  },
  2417919: {
    common: 'Lemon Shark', scientific: 'Negaprion brevirostris',
    color: '#d4c000', emoji: '🦈', lengthM: 3.4,
    fact: 'Returns to the same nursery habitat year after year — strong site fidelity studied for decades.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/70552759/medium.jpg',
    iucn: 'VU',
  },
  2418059: {
    common: 'Caribbean Reef Shark', scientific: 'Carcharhinus perezi',
    color: '#a0e060', emoji: '🦈', lengthM: 3,
    fact: 'Can enter a trance-like state when turned on its back — a behavior called tonic immobility.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/290208487/medium.jpg',
    iucn: 'EN',
  },
  2418095: {
    common: 'Silky Shark', scientific: 'Carcharhinus falciformis',
    color: '#e0a060', emoji: '🦈', lengthM: 3.5,
    fact: 'One of the most abundant oceanic sharks — notorious for following fishing fleets for discarded bycatch.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/477653797/medium.jpg',
    iucn: 'VU',
  },
  2418005: {
    common: 'Dusky Shark', scientific: 'Carcharhinus obscurus',
    color: '#c08040', emoji: '🦈', lengthM: 4,
    fact: 'One of the slowest-maturing sharks — females don\'t reproduce until age 20 and gestate for 24 months.',
    photoUrl: 'https://static.inaturalist.org/photos/22033528/medium.jpg',
    iucn: 'EN',
  },
  // ─── Order Orectolobiformes ────────────────────────────────────────────────
  2417522: {
    common: 'Whale Shark', scientific: 'Rhincodon typus',
    color: '#9060e0', emoji: '🦈', lengthM: 14,
    fact: 'The largest fish on Earth — each individual is identified by its unique spot pattern, like a fingerprint.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/519729370/medium.jpg',
    iucn: 'EN',
  },
  2417495: {
    common: 'Nurse Shark', scientific: 'Ginglymostoma cirratum',
    color: '#e08840', emoji: '🦈', lengthM: 3,
    fact: 'Can rest motionless on the seafloor for hours — able to pump water over its gills without swimming.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/55987882/medium.jpg',
    iucn: 'VU',
  },
  8493577: {
    common: 'Zebra Shark', scientific: 'Stegostoma tigrinum',
    color: '#d4a840', emoji: '🦈', lengthM: 2.5,
    fact: 'Born with bold zebra stripes that fade into spots with age — the inspiration for its misleading scientific name.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/125113158/medium.jpg',
    iucn: 'EN',
  },
}

export function getSpeciesMeta(speciesKey) {
  return SPECIES_META[speciesKey] || null
}

const _sciNameToKey = {}
for (const [key, meta] of Object.entries(SPECIES_META)) {
  _sciNameToKey[meta.scientific.toLowerCase()] = Number(key)
}
function gbifKeyFromScientific(sciName) {
  if (!sciName) return null
  return _sciNameToKey[sciName.toLowerCase()] || null
}

// ─── Bounding box ─────────────────────────────────────────────────────────────
function getBoundingBox(lat, lng, radiusKm) {
  const latDelta = radiusKm / 111
  const lngDelta = radiusKm / (111 * Math.cos(lat * (Math.PI / 180)))
  return {
    minLat: (lat - latDelta).toFixed(5),
    maxLat: (lat + latDelta).toFixed(5),
    minLng: (lng - lngDelta).toFixed(5),
    maxLng: (lng + lngDelta).toFixed(5),
  }
}

// ─── Normalize GBIF occurrence ────────────────────────────────────────────────
function normalizeOccurrence(occ) {
  const speciesKey = occ.speciesKey || occ.taxonKey
  const meta = getSpeciesMeta(speciesKey)
  return {
    id: String(occ.key),
    speciesKey,
    common: meta?.common || occ.vernacularName || occ.species || occ.genus || 'Unknown shark',
    scientific: occ.species || occ.genus || '',
    color: meta?.color || '#e8e8e8',
    emoji: meta?.emoji || '🦈',
    fact: meta?.fact || null,
    speciesPhoto: meta?.photoUrl || null,
    iucn: meta?.iucn || null,
    lat: occ.decimalLatitude,
    lng: occ.decimalLongitude,
    date: occ.eventDate ? occ.eventDate.split('T')[0] : null,
    place: [occ.locality, occ.stateProvince, occ.country].filter(Boolean).join(', ') || null,
    observer: occ.recordedBy || occ.institutionCode || occ.datasetName || 'GBIF contributor',
    photos: (occ.media || []).filter(m => m.type === 'StillImage' && m.identifier).slice(0, 2).map(m => m.identifier),
    source: 'GBIF',
  }
}

// ─── Recent sightings (past N days) ──────────────────────────────────────────
// Queries all major shark orders in parallel and merges results
export async function fetchRecentSightings({ lat, lng, radiusKm = 400, days = 90, limit = 200, signal }) {
  const bb = getBoundingBox(lat, lng, radiusKm)
  const d2 = new Date()
  const d1 = new Date(d2 - days * 86400000)
  const fmt = d => d.toISOString().split('T')[0]

  const params = new URLSearchParams({
    taxonKey: SHARK_KEY,
    hasCoordinate: 'true',
    occurrenceStatus: 'PRESENT',
    decimalLatitude: `${bb.minLat},${bb.maxLat}`,
    decimalLongitude: `${bb.minLng},${bb.maxLng}`,
    eventDate: `${fmt(d1)},${fmt(d2)}`,
    limit: Math.min(limit, 300),
  })

  const res = await fetch(`${GBIF_API}/occurrence/search?${params}`, { signal })
  const data = await res.json()

  const sightings = (data.results || [])
    .filter(o => o.decimalLatitude && o.decimalLongitude)
    .filter(o => o.datasetKey !== GBIF_INAT_DATASET)
    .filter(isShark)
    .map(normalizeOccurrence)

  return { total: sightings.length, sightings }
}

// ─── Historical sightings for a specific month (all years) ───────────────────
export async function fetchMonthSightings({ lat, lng, radiusKm = 500, month, limit = 200, signal }) {
  const bb = getBoundingBox(lat, lng, radiusKm)

  const params = new URLSearchParams({
    taxonKey: SHARK_KEY,
    hasCoordinate: 'true',
    occurrenceStatus: 'PRESENT',
    decimalLatitude: `${bb.minLat},${bb.maxLat}`,
    decimalLongitude: `${bb.minLng},${bb.maxLng}`,
    month,
    limit: Math.min(limit, 300),
  })

  const res = await fetch(`${GBIF_API}/occurrence/search?${params}`, { signal })
  const data = await res.json()

  const sightings = (data.results || [])
    .filter(o => o.decimalLatitude && o.decimalLongitude)
    .filter(isShark)
    .map(normalizeOccurrence)

  return { total: sightings.length, sightings }
}

// ─── Seasonal pattern ─────────────────────────────────────────────────────────
export async function fetchSeasonalPattern({ lat, lng, radiusKm = 600, speciesKey = null, signal }) {
  const bb = getBoundingBox(lat, lng, radiusKm)

  const params = new URLSearchParams({
    taxonKey: speciesKey || SHARK_KEY,
    hasCoordinate: 'true',
    occurrenceStatus: 'PRESENT',
    decimalLatitude: `${bb.minLat},${bb.maxLat}`,
    decimalLongitude: `${bb.minLng},${bb.maxLng}`,
    limit: '0',
    facet: 'month',
    'month.facetLimit': '12',
  })

  const res = await fetch(`${GBIF_API}/occurrence/search?${params}`, { signal })
  if (!res.ok) throw new Error(`GBIF facets error: ${res.status}`)
  const data = await res.json()

  const monthFacet = (data.facets || []).find(f => f.field === 'MONTH')
  const counts = monthFacet?.counts || []

  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1
    const found = counts.find(c => Number(c.name) === m)
    return { month: m, count: found ? found.count : 0 }
  })
}

// ─── iNaturalist sightings ────────────────────────────────────────────────────
function normalizeINatObservation(obs) {
  const coords = obs.geojson?.coordinates // [lng, lat]
  if (!coords) return null
  const sciName = obs.taxon?.name || ''
  const speciesKey = gbifKeyFromScientific(sciName)
  const meta = speciesKey ? getSpeciesMeta(speciesKey) : null
  const photo = obs.photos?.[0]?.url?.replace('square', 'medium') || null
  return {
    id: `inat-${obs.id}`,
    speciesKey: speciesKey || sciName || null,
    common: obs.taxon?.preferred_common_name || meta?.common || sciName || 'Unknown shark',
    scientific: sciName,
    color: meta?.color || '#e8e8e8',
    emoji: meta?.emoji || '🦈',
    fact: meta?.fact || null,
    speciesPhoto: meta?.photoUrl || null,
    iucn: meta?.iucn || null,
    lat: coords[1],
    lng: coords[0],
    date: obs.observed_on || null,
    place: obs.place_guess || null,
    observer: obs.user?.login || 'iNaturalist observer',
    photos: photo ? [photo] : [],
    source: 'iNaturalist',
  }
}

export async function fetchINatSightings({ lat, lng, radiusKm = 400, days = 90, limit = 200, signal }) {
  try {
    const d2 = new Date()
    const d1 = new Date(d2 - days * 86400000)
    const fmt = d => d.toISOString().split('T')[0]

    const params = new URLSearchParams({
      taxon_id: INAT_SHARK_TAXON,
      lat,
      lng,
      radius: radiusKm,
      d1: fmt(d1),
      d2: fmt(d2),
      order_by: 'observed_on',
      per_page: Math.min(limit, 200),
      geo: 'true',
    })

    const res = await fetch(`${INAT_API}/observations?${params}`, {
      headers: { 'User-Agent': 'EarthAtlas/1.0 (https://earthatlas.org)' },
      signal,
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.results || []).map(normalizeINatObservation).filter(Boolean)
  } catch {
    return []
  }
}

// ─── Aggregate species from sightings ────────────────────────────────────────
export function aggregateSpecies(sightings) {
  const map = {}
  for (const s of sightings) {
    const key = s.speciesKey || s.scientific || s.common
    if (!map[key]) {
      map[key] = {
        speciesKey: s.speciesKey || key,
        common: s.common,
        scientific: s.scientific,
        color: s.color,
        iucn: s.iucn,
        meta: getSpeciesMeta(s.speciesKey),
        count: 0,
        lastSeen: null,
        photos: [],
      }
    }
    map[key].count++
    if (!map[key].lastSeen || s.date > map[key].lastSeen) map[key].lastSeen = s.date
    if (s.photos.length > 0 && map[key].photos.length === 0) map[key].photos = s.photos
  }
  return Object.values(map).sort((a, b) => b.count - a.count)
}
