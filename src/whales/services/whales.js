/**
 * Whale-specific data service
 * Built on top of GBIF occurrence API + Whale Museum Hotline API
 *
 * GBIF Cetacea (order) backbone taxon key: 733
 * This covers all whales, dolphins, and porpoises.
 */

const GBIF_API    = 'https://api.gbif.org/v1'
const HOTLINE_API = 'https://hotline.whalemuseum.org/api'

const CETACEA_KEY = 733

// ─── Species metadata ─────────────────────────────────────────────────────────
export const SPECIES_META = {
  2440719: { common: 'Humpback Whale',              scientific: 'Megaptera novaeangliae',       color: '#4dd9c0', emoji: '🐋', lengthM: 16, fact: 'Known for the longest songs in the animal kingdom — some lasting over 20 hours.' },
  2440708: { common: 'Blue Whale',                  scientific: 'Balaenoptera musculus',         color: '#6eb5e0', emoji: '🐳', lengthM: 30, fact: 'The largest animal ever known to exist — one heartbeat can be heard two miles away.' },
  2440698: { common: 'Gray Whale',                  scientific: 'Eschrichtius robustus',         color: '#9ab0c4', emoji: '🐋', lengthM: 14, fact: 'Makes one of the longest migrations of any mammal — up to 12,000 miles round trip.' },
  2440706: { common: 'Orca',                        scientific: 'Orcinus orca',                 color: '#f0b429', emoji: '🐬', lengthM: 8,  fact: 'Apex predators that live in tight-knit family pods with their own distinct dialects.' },
  2440710: { common: 'Fin Whale',                   scientific: 'Balaenoptera physalus',         color: '#7db8d8', emoji: '🐋', lengthM: 25, fact: 'Second largest animal on Earth — and one of the fastest great whales at up to 23 mph.' },
  2440718: { common: 'Sperm Whale',                 scientific: 'Physeter macrocephalus',        color: '#c09060', emoji: '🐋', lengthM: 18, fact: 'The deepest-diving mammal — capable of reaching 3km beneath the surface.' },
  2440714: { common: 'Minke Whale',                 scientific: 'Balaenoptera acutorostrata',    color: '#5bc4a8', emoji: '🐋', lengthM: 9,  fact: 'The most abundant baleen whale and the most frequently spotted on whale-watching trips.' },
  2440741: { common: 'Bottlenose Dolphin',          scientific: 'Tursiops truncatus',            color: '#68d8b8', emoji: '🐬', lengthM: 3,  fact: 'Individuals can be tracked for decades by their unique dorsal fins. Some live past 60.' },
  2440743: { common: 'Common Dolphin',              scientific: 'Delphinus delphis',             color: '#50c4a0', emoji: '🐬', lengthM: 2.5,fact: 'Often travels in superpods of thousands — some of the most spectacular wildlife events on Earth.' },
  2440700: { common: 'North Atlantic Right Whale',  scientific: 'Eubalaena glacialis',           color: '#e06868', emoji: '🐋', lengthM: 16, fact: 'Critically endangered — fewer than 340 remain. Every sighting is precious data.' },
  2440711: { common: 'Sei Whale',                   scientific: 'Balaenoptera borealis',         color: '#8ab8d0', emoji: '🐋', lengthM: 20, fact: 'Named for the Norwegian word for "coalfish" — the two arrive in feeding grounds together.' },
  2440749: { common: 'Spinner Dolphin',             scientific: 'Stenella longirostris',         color: '#60d8c8', emoji: '🐬', lengthM: 2,  fact: 'Can spin up to 7 times in a single leap — thought to be a form of social communication.' },
  2440745: { common: 'Pacific White-sided Dolphin', scientific: 'Lagenorhynchus obliquidens',   color: '#78d8e0', emoji: '🐬', lengthM: 2.3,fact: 'Acrobatic and energetic — they frequently bowride vessels for miles at a time.' },
}

export function getSpeciesMeta(speciesKey) {
  return SPECIES_META[speciesKey] || null
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
    common: meta?.common || occ.vernacularName || occ.species || occ.genus || 'Unknown cetacean',
    scientific: occ.species || occ.genus || '',
    color: meta?.color || '#4dd9c0',
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
export async function fetchRecentSightings({ lat, lng, radiusKm = 300, days = 90, limit = 200 }) {
  const bb = getBoundingBox(lat, lng, radiusKm)
  const d2 = new Date()
  const d1 = new Date(d2 - days * 86400000)
  const fmt = d => d.toISOString().split('T')[0]

  const params = new URLSearchParams({
    taxonKey: CETACEA_KEY,
    hasCoordinate: 'true',
    occurrenceStatus: 'PRESENT',
    decimalLatitude: `${bb.minLat},${bb.maxLat}`,
    decimalLongitude: `${bb.minLng},${bb.maxLng}`,
    eventDate: `${fmt(d1)},${fmt(d2)}`,
    limit: Math.min(limit, 300),
  })

  const res = await fetch(`${GBIF_API}/occurrence/search?${params}`)
  if (!res.ok) throw new Error(`GBIF error: ${res.status}`)
  const data = await res.json()

  return {
    total: data.count || 0,
    sightings: (data.results || []).filter(o => o.decimalLatitude && o.decimalLongitude).map(normalizeOccurrence),
  }
}

// ─── Historical sightings for a specific month (all years) ───────────────────
export async function fetchMonthSightings({ lat, lng, radiusKm = 400, month, limit = 200 }) {
  const bb = getBoundingBox(lat, lng, radiusKm)

  const params = new URLSearchParams({
    taxonKey: CETACEA_KEY,
    hasCoordinate: 'true',
    occurrenceStatus: 'PRESENT',
    decimalLatitude: `${bb.minLat},${bb.maxLat}`,
    decimalLongitude: `${bb.minLng},${bb.maxLng}`,
    month,
    limit: Math.min(limit, 300),
  })

  const res = await fetch(`${GBIF_API}/occurrence/search?${params}`)
  if (!res.ok) throw new Error(`GBIF error: ${res.status}`)
  const data = await res.json()

  return {
    total: data.count || 0,
    sightings: (data.results || []).filter(o => o.decimalLatitude && o.decimalLongitude).map(normalizeOccurrence),
  }
}

// ─── Seasonal pattern — monthly totals across all years ───────────────────────
export async function fetchSeasonalPattern({ lat, lng, radiusKm = 500 }) {
  const bb = getBoundingBox(lat, lng, radiusKm)

  const params = new URLSearchParams({
    taxonKey: CETACEA_KEY,
    hasCoordinate: 'true',
    occurrenceStatus: 'PRESENT',
    decimalLatitude: `${bb.minLat},${bb.maxLat}`,
    decimalLongitude: `${bb.minLng},${bb.maxLng}`,
    limit: '0',
    facet: 'month',
    'month.facetLimit': '12',
  })

  const res = await fetch(`${GBIF_API}/occurrence/search?${params}`)
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

// ─── Aggregate species from sightings ─────────────────────────────────────────
export function aggregateSpecies(sightings) {
  const map = {}
  for (const s of sightings) {
    const key = s.speciesKey || s.scientific || s.common
    if (!map[key]) {
      map[key] = {
        speciesKey: s.speciesKey,
        common: s.common,
        scientific: s.scientific,
        color: s.color,
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

// ─── Whale Museum Hotline (Pacific coast, open API) ───────────────────────────
export async function fetchHotlineSightings() {
  try {
    const res = await fetch(`${HOTLINE_API}/sightings?limit=100`)
    if (!res.ok) return []
    const data = await res.json()
    return (data || []).map(s => ({
      id: `hotline-${s.id}`,
      speciesKey: null,
      common: s.species || 'Unknown',
      scientific: '',
      color: '#4dd9c0',
      lat: parseFloat(s.latitude),
      lng: parseFloat(s.longitude),
      date: s.sighted_at ? s.sighted_at.split('T')[0] : null,
      place: s.location || null,
      observer: s.name || 'Whale Museum Hotline',
      photos: [],
      source: 'Hotline',
      quantity: s.quantity,
    })).filter(s => s.lat && s.lng && !isNaN(s.lat) && !isNaN(s.lng))
  } catch {
    return []
  }
}
