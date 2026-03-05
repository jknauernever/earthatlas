/**
 * Butterfly & moth data service
 * Built on top of GBIF occurrence API + iNaturalist API
 *
 * GBIF Lepidoptera (order) backbone taxon key: 797
 * This covers all butterflies and moths.
 */

const GBIF_API = 'https://api.gbif.org/v1'
const INAT_API = 'https://api.inaturalist.org/v1'

const LEPIDOPTERA_KEY = 797
const INAT_LEPIDOPTERA_TAXON = 47157
const GBIF_INAT_DATASET = '50c9509d-22c7-4a22-a47d-8c48425ef4a7'

// ─── Species metadata ─────────────────────────────────────────────────────────
export const SPECIES_META = {
  // ─── Milkweed butterflies (Danaidae) ─────────────────────────────────────
  5130082: { common: 'Monarch', scientific: 'Danaus plexippus', color: '#5a3e28', emoji: '🦋', wingspanMm: 102, fact: 'Migrates up to 4,500 km from Canada to Mexican mountain forests — navigating by the sun and Earth\'s magnetic field.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/Danaus_plexippus_MHNT.jpg/640px-Danaus_plexippus_MHNT.jpg' },
  5130090: { common: 'Queen', scientific: 'Danaus gilippus', color: '#5a3e28', emoji: '🦋', wingspanMm: 78, fact: 'The Monarch\'s southern cousin — males use hair pencils to transfer scent to females during courtship.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Danaus_gilippus_berenice_-_queen_butterfly.jpg/640px-Danaus_gilippus_berenice_-_queen_butterfly.jpg' },
  5130088: { common: 'Plain Tiger', scientific: 'Danaus chrysippus', color: '#5a3e28', emoji: '🦋', wingspanMm: 75, fact: 'One of the most widespread butterflies on Earth — its bitter toxins, absorbed from milkweed, deter most predators.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bd/Danaus_chrysippus_-_Bali.jpg/640px-Danaus_chrysippus_-_Bali.jpg' },

  // ─── Swallowtails (Papilionidae) ─────────────────────────────────────────
  5119785: { common: 'Eastern Tiger Swallowtail', scientific: 'Papilio glaucus', color: '#5a3e28', emoji: '🦋', wingspanMm: 140, fact: 'Females can mimic the toxic Pipevine Swallowtail in a dark morph — a striking example of Batesian mimicry.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Eastern_Tiger_Swallowtail_Papilio_glaucus_Female_2000px.jpg/640px-Eastern_Tiger_Swallowtail_Papilio_glaucus_Female_2000px.jpg' },
  5119887: { common: 'Giant Swallowtail', scientific: 'Papilio cresphontes', color: '#5a3e28', emoji: '🦋', wingspanMm: 160, fact: 'The largest butterfly in North America — its caterpillar masquerades as a fresh bird dropping.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/Papilio_cresphontes_Cramer.jpg/640px-Papilio_cresphontes_Cramer.jpg' },
  5119800: { common: 'Old World Swallowtail', scientific: 'Papilio machaon', color: '#5a3e28', emoji: '🦋', wingspanMm: 88, fact: 'One of the most widely distributed swallowtails — found from Arctic tundra to the Sahara desert margins.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/Papilio_machaon_MHNT.jpg/640px-Papilio_machaon_MHNT.jpg' },
  5119907: { common: 'Pipevine Swallowtail', scientific: 'Battus philenor', color: '#5a3e28', emoji: '🦋', wingspanMm: 100, fact: 'Feeding on pipevine plants makes adults toxic to birds — at least five other species mimic their iridescent blue wings.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Battus_philenor.jpg/640px-Battus_philenor.jpg' },
  5120067: { common: 'Zebra Swallowtail', scientific: 'Eurytides marcellus', color: '#5a3e28', emoji: '🦋', wingspanMm: 88, fact: 'Completely dependent on pawpaw trees — the only plants its caterpillars can eat.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Eurytides_marcellus_1.jpg/640px-Eurytides_marcellus_1.jpg' },
  1890955: { common: 'Black Swallowtail', scientific: 'Papilio polyxenes', color: '#5a3e28', emoji: '🦋', wingspanMm: 95, fact: 'Its caterpillar feeds on parsley and dill — a common and welcome guest in herb gardens.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Black_Swallowtail%2C_Megan_McCarty68.jpg/640px-Black_Swallowtail%2C_Megan_McCarty68.jpg' },

  // ─── Whites and Sulphurs (Pieridae) ──────────────────────────────────────
  5118914: { common: 'Cabbage White', scientific: 'Pieris rapae', color: '#5a3e28', emoji: '🦋', wingspanMm: 52, fact: 'Accidentally introduced to North America in the 1860s — now one of the most abundant butterflies on Earth.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Pieris.rapae.mounted.jpg/640px-Pieris.rapae.mounted.jpg' },
  5118870: { common: 'Clouded Sulphur', scientific: 'Colias philodice', color: '#5a3e28', emoji: '🦋', wingspanMm: 55, fact: 'A master of thermoregulation — it angles its wings like a solar panel to warm up on cool mornings.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Clouded_sulphur_butterfly_%28Colias_philodice%29_male.jpg/640px-Clouded_sulphur_butterfly_%28Colias_philodice%29_male.jpg' },
  5118875: { common: 'Orange Sulphur', scientific: 'Colias eurytheme', color: '#5a3e28', emoji: '🦋', wingspanMm: 60, fact: 'Reflects ultraviolet light invisible to humans — males choose mates partly by UV pattern.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Colias_eurytheme_male_Gailhampton.jpg/640px-Colias_eurytheme_male_Gailhampton.jpg' },

  // ─── Gossamer-wings (Lycaenidae) ─────────────────────────────────────────
  5129378: { common: 'American Copper', scientific: 'Lycaena phlaeas', color: '#5a3e28', emoji: '🦋', wingspanMm: 30, fact: 'Males are ferociously territorial — they will chase away butterflies ten times their size from sunlit perches.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Lycaena_phlaeas_02.jpg/640px-Lycaena_phlaeas_02.jpg' },
  5134434: { common: 'Eastern Tailed-Blue', scientific: 'Cupido comyntas', color: '#5a3e28', emoji: '🦋', wingspanMm: 24, fact: 'One of the smallest butterflies in North America — barely wider than a thumbnail but with strikingly vivid blue wings.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Cupido_comyntas_01.jpg/640px-Cupido_comyntas_01.jpg' },
  5131256: { common: 'Holly Blue', scientific: 'Celastrina argiolus', color: '#5a3e28', emoji: '🦋', wingspanMm: 34, fact: 'Alternates host plants by season — holly in spring, ivy in summer — driven by parasitoid wasp pressure.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Celastrina_argiolus_-_Holly_blue_01.jpg/640px-Celastrina_argiolus_-_Holly_blue_01.jpg' },
  1898286: { common: 'Karner Blue', scientific: 'Plebejus samuelis', color: '#e06868', emoji: '🦋', wingspanMm: 28, fact: 'Federally endangered — depends entirely on wild lupine, a plant of vanishing oak-savanna habitats.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Karner_blue_%28Lycaeides_melissa_samuelis%29_male.jpg/640px-Karner_blue_%28Lycaeides_melissa_samuelis%29_male.jpg' },

  // ─── Nymphalids / Brushfoots ──────────────────────────────────────────────
  5130132: { common: 'Painted Lady', scientific: 'Vanessa cardui', color: '#5a3e28', emoji: '🦋', wingspanMm: 65, fact: 'The most widely distributed butterfly on Earth — found on every continent except Antarctica and South America.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Vanessa_cardui_-_Distelfalter.jpg/640px-Vanessa_cardui_-_Distelfalter.jpg' },
  5130194: { common: 'Red Admiral', scientific: 'Vanessa atalanta', color: '#5a3e28', emoji: '🦋', wingspanMm: 64, fact: 'Feeds on fermenting fruit in autumn and becomes visibly intoxicated — one of the few butterflies known to get drunk.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Vanessa_atalanta_Karlsruhe.jpg/640px-Vanessa_atalanta_Karlsruhe.jpg' },
  5130344: { common: 'Mourning Cloak', scientific: 'Nymphalis antiopa', color: '#5a3e28', emoji: '🦋', wingspanMm: 80, fact: 'One of the longest-lived butterflies — adults overwinter in tree cavities and can survive nearly a year.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Nymphalis_antiopa_2009_01.jpg/640px-Nymphalis_antiopa_2009_01.jpg' },
  5130392: { common: 'Common Buckeye', scientific: 'Junonia coenia', color: '#5a3e28', emoji: '🦋', wingspanMm: 65, fact: 'Its dramatic eyespots serve as startle displays — up close, they can momentarily confuse a would-be predator.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Junonia_coenia_by_Kaldari.jpg/640px-Junonia_coenia_by_Kaldari.jpg' },
  5130554: { common: 'Pearl Crescent', scientific: 'Phyciodes tharos', color: '#5a3e28', emoji: '🦋', wingspanMm: 32, fact: 'One of the most common butterflies in eastern North America — males patrol territories from low perches all day.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Phyciodes_tharos.jpg/640px-Phyciodes_tharos.jpg' },
  5130416: { common: 'Question Mark', scientific: 'Polygonia interrogationis', color: '#5a3e28', emoji: '🦋', wingspanMm: 64, fact: 'Named for a tiny silver question-mark on its hindwing underside — perfectly camouflaged as a dead leaf when closed.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Polygonia_interrogationis_-_Question_Mark.jpg/640px-Polygonia_interrogationis_-_Question_Mark.jpg' },
  5130400: { common: 'Comma', scientific: 'Polygonia c-album', color: '#5a3e28', emoji: '🦋', wingspanMm: 50, fact: 'Its deeply jagged wing edges and mottled underside make it one of the most convincing dead-leaf mimics in Europe.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c6/Polygonia_c-album_qtl1.jpg/640px-Polygonia_c-album_qtl1.jpg' },
  5130467: { common: 'Baltimore Checkerspot', scientific: 'Euphydryas phaeton', color: '#d87060', emoji: '🦋', wingspanMm: 55, fact: 'Maryland\'s state insect — dependent on turtleheads in wet meadows, a habitat shrinking rapidly across its range.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Euphydryas_phaeton_2.jpg/640px-Euphydryas_phaeton_2.jpg' },
  5130520: { common: 'Great Spangled Fritillary', scientific: 'Speyeria cybele', color: '#5a3e28', emoji: '🦋', wingspanMm: 85, fact: 'Only females overwinter as freshly-hatched larvae — they don\'t eat until violets emerge the following spring.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Speyeria_cybele_edit.jpg/640px-Speyeria_cybele_edit.jpg' },
  5130258: { common: 'Viceroy', scientific: 'Limenitis archippus', color: '#5a3e28', emoji: '🦋', wingspanMm: 75, fact: 'Long thought to mimic Monarchs for protection — turns out Viceroys are also toxic and the mimicry is mutual.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Limenitis_archippus_1.jpg/640px-Limenitis_archippus_1.jpg' },
  5130253: { common: 'White Admiral', scientific: 'Limenitis camilla', color: '#5a3e28', emoji: '🦋', wingspanMm: 60, fact: 'Glides effortlessly on motionless wings for long distances — its distinctive white band is visible from far away.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/White_Admiral_%28Limenitis_camilla%29.jpg/640px-White_Admiral_%28Limenitis_camilla%29.jpg' },
  5130315: { common: 'Small Tortoiseshell', scientific: 'Aglais urticae', color: '#5a3e28', emoji: '🦋', wingspanMm: 52, fact: 'One of Europe\'s most beloved garden butterflies — has declined sharply in some regions due to a parasitic fly.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Aglais_urticae_1_AB.jpg/640px-Aglais_urticae_1_AB.jpg' },
  5130348: { common: 'European Peacock', scientific: 'Aglais io', color: '#5a3e28', emoji: '🦋', wingspanMm: 65, fact: 'Produces a loud hissing sound by rubbing its wings together — startling predators with a combination of sight and sound.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Aglais_io_Weinsberg_20080612_1.jpg/640px-Aglais_io_Weinsberg_20080612_1.jpg' },

  // ─── Skippers (Hesperiidae) ───────────────────────────────────────────────
  5128855: { common: 'Silver-spotted Skipper', scientific: 'Epargyreus clarus', color: '#5a3e28', emoji: '🦋', wingspanMm: 54, fact: 'The most recognizable skipper in North America — its caterpillar stitches leaves into a shelter, sleeping inside by day.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/Epargyreus_clarus_1_AB.jpg/640px-Epargyreus_clarus_1_AB.jpg' },
  5128925: { common: 'Fiery Skipper', scientific: 'Hylephila phyleus', color: '#5a3e28', emoji: '🦋', wingspanMm: 30, fact: 'A frequent lawn visitor that thrives in disturbed urban environments — one of the most adaptable skippers.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/Hylephila_phileus_male.jpg/640px-Hylephila_phileus_male.jpg' },

  // ─── Moths ───────────────────────────────────────────────────────────────
  1810488: { common: 'Luna Moth', scientific: 'Actias luna', color: '#5a3e28', emoji: '🪲', wingspanMm: 115, fact: 'Adults have no mouth parts and cannot eat — they live only about a week, surviving on fat reserves from the caterpillar stage.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/Actias_luna_%28Luna_Moth%29.jpg/640px-Actias_luna_%28Luna_Moth%29.jpg' },
  1810477: { common: 'Cecropia Moth', scientific: 'Hyalophora cecropia', color: '#5a3e28', emoji: '🪲', wingspanMm: 160, fact: 'North America\'s largest native moth — its spectacular wingspan can reach 16 cm.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/76/Hyalophora_cecropia1.jpg/640px-Hyalophora_cecropia1.jpg' },
  1811219: { common: 'Atlas Moth', scientific: 'Attacus atlas', color: '#5a3e28', emoji: '🪲', wingspanMm: 250, fact: 'One of the world\'s largest moths by wing area — its wingtips are patterned to resemble the heads of snakes.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/Attacus_atlas_qtl2.jpg/640px-Attacus_atlas_qtl2.jpg' },
  1820993: { common: "Death's-head Hawkmoth", scientific: 'Acherontia atropos', color: '#5a3e28', emoji: '🪲', wingspanMm: 130, fact: 'The skull-shaped marking on its thorax and its ability to squeak loudly made it a symbol of terror in European folklore.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Acherontia_atropos.jpg/640px-Acherontia_atropos.jpg' },
  1820780: { common: 'Hummingbird Hawk-moth', scientific: 'Macroglossum stellatarum', color: '#5a3e28', emoji: '🪲', wingspanMm: 58, fact: 'Hovers and feeds in daylight with a tongue longer than its body — routinely mistaken for a hummingbird.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/Macroglossum_stellatarum_01.jpg/640px-Macroglossum_stellatarum_01.jpg' },
  1819887: { common: 'Garden Tiger Moth', scientific: 'Arctia caja', color: '#5a3e28', emoji: '🪲', wingspanMm: 65, fact: 'When threatened, it flashes bright red hindwings and releases foul-smelling yellow fluid from glands behind its head.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Arctia_caja.jpg/640px-Arctia_caja.jpg' },
  1819956: { common: 'Peppered Moth', scientific: 'Biston betularia', color: '#5a3e28', emoji: '🪲', wingspanMm: 55, fact: 'The textbook example of evolution by natural selection — industrial soot turned trees black and the dark form became dominant.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Biston_betularia_male_2016_05_27.jpg/640px-Biston_betularia_male_2016_05_27.jpg' },
  1820770: { common: 'Elephant Hawk-moth', scientific: 'Deilephila elpenor', color: '#5a3e28', emoji: '🪲', wingspanMm: 65, fact: 'Its pink and olive coloring makes it one of the most striking moths in Europe — and it can see in color at night.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Deilephila_elpenor.jpg/640px-Deilephila_elpenor.jpg' },
  7759088: { common: 'Rosy Maple Moth', scientific: 'Dryocampa rubicunda', color: '#5a3e28', emoji: '🪲', wingspanMm: 50, fact: 'Looks like a scoop of strawberry lemonade ice cream — its vivid pink and yellow coloring is unique among North American moths.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Dryocampa_rubicunda.jpg/640px-Dryocampa_rubicunda.jpg' },
  1820867: { common: 'White-lined Sphinx Moth', scientific: 'Hyles lineata', color: '#5a3e28', emoji: '🪲', wingspanMm: 80, fact: 'The most commonly seen sphinx moth in North America — often confused with hummingbirds at dusk.', photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/Hyles_lineata_01.jpg/640px-Hyles_lineata_01.jpg' },
}

export function getSpeciesMeta(speciesKey) {
  return SPECIES_META[speciesKey] || null
}

// Reverse lookup: scientific name → GBIF species key (for iNat matching)
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
    common: meta?.common || occ.vernacularName || occ.species || occ.genus || 'Unknown butterfly or moth',
    scientific: occ.species || occ.genus || '',
    color: meta?.color || '#5a3e28',
    emoji: meta?.emoji || '🦋',
    fact: meta?.fact || null,
    speciesPhoto: meta?.photoUrl || null,
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
export async function fetchRecentSightings({ lat, lng, radiusKm = 100, bounds, days = 30, limit = 300 }) {
  const bb = bounds || getBoundingBox(lat, lng, radiusKm)
  const d2 = new Date()
  const d1 = new Date(d2 - days * 86400000)
  const fmt = d => d.toISOString().split('T')[0]

  const params = new URLSearchParams({
    taxonKey: LEPIDOPTERA_KEY,
    hasCoordinate: 'true',
    occurrenceStatus: 'PRESENT',
    decimalLatitude: `${Number(bb.minLat).toFixed(5)},${Number(bb.maxLat).toFixed(5)}`,
    decimalLongitude: `${Number(bb.minLng).toFixed(5)},${Number(bb.maxLng).toFixed(5)}`,
    eventDate: `${fmt(d1)},${fmt(d2)}`,
    limit: Math.min(limit, 300),
  })

  const res = await fetch(`${GBIF_API}/occurrence/search?${params}`)
  if (!res.ok) throw new Error(`GBIF error: ${res.status}`)
  const data = await res.json()

  return {
    total: data.count || 0,
    sightings: (data.results || [])
      .filter(o => o.decimalLatitude && o.decimalLongitude)
      .filter(o => o.datasetKey !== GBIF_INAT_DATASET)
      .map(normalizeOccurrence),
  }
}

// ─── Historical sightings for a specific month (all years) ───────────────────
export async function fetchMonthSightings({ lat, lng, radiusKm = 150, bounds, month, limit = 300 }) {
  const bb = bounds || getBoundingBox(lat, lng, radiusKm)

  const params = new URLSearchParams({
    taxonKey: LEPIDOPTERA_KEY,
    hasCoordinate: 'true',
    occurrenceStatus: 'PRESENT',
    decimalLatitude: `${Number(bb.minLat).toFixed(5)},${Number(bb.maxLat).toFixed(5)}`,
    decimalLongitude: `${Number(bb.minLng).toFixed(5)},${Number(bb.maxLng).toFixed(5)}`,
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
export async function fetchSeasonalPattern({ lat, lng, radiusKm = 200, bounds, speciesKey = null }) {
  const bb = bounds || getBoundingBox(lat, lng, radiusKm)

  const params = new URLSearchParams({
    taxonKey: speciesKey || LEPIDOPTERA_KEY,
    hasCoordinate: 'true',
    occurrenceStatus: 'PRESENT',
    decimalLatitude: `${Number(bb.minLat).toFixed(5)},${Number(bb.maxLat).toFixed(5)}`,
    decimalLongitude: `${Number(bb.minLng).toFixed(5)},${Number(bb.maxLng).toFixed(5)}`,
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
        speciesKey: s.speciesKey || key,
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

// ─── iNaturalist sightings ───────────────────────────────────────────────────
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
    common: obs.taxon?.preferred_common_name || meta?.common || sciName || 'Unknown butterfly or moth',
    scientific: sciName,
    color: meta?.color || '#5a3e28',
    emoji: meta?.emoji || '🦋',
    fact: meta?.fact || null,
    speciesPhoto: meta?.photoUrl || null,
    lat: coords[1],
    lng: coords[0],
    date: obs.observed_on || null,
    place: obs.place_guess || null,
    observer: obs.user?.login || 'iNaturalist observer',
    photos: photo ? [photo] : [],
    source: 'iNaturalist',
  }
}

export async function fetchINatSightings({ lat, lng, radiusKm = 100, bounds, days = 30, limit = 400 }) {
  try {
    const d2 = new Date()
    const d1 = new Date(d2 - days * 86400000)
    const fmt = d => d.toISOString().split('T')[0]

    // iNat uses nelat/nelng/swlat/swlng when bounds are provided, otherwise lat/lng/radius
    const geoParams = bounds
      ? { nelat: bounds.maxLat, nelng: bounds.maxLng, swlat: bounds.minLat, swlng: bounds.minLng }
      : { lat, lng, radius: radiusKm }

    const baseParams = {
      taxon_id: INAT_LEPIDOPTERA_TAXON,
      ...geoParams,
      d1: fmt(d1),
      d2: fmt(d2),
      order_by: 'observed_on',
      per_page: '200',
      geo: 'true',
    }

    // First page
    const res1 = await fetch(`${INAT_API}/observations?${new URLSearchParams(baseParams)}`, {
      headers: { 'User-Agent': 'EarthAtlas/1.0 (https://earthatlas.org)' },
    })
    if (!res1.ok) return []
    const data1 = await res1.json()
    const page1 = (data1.results || []).map(normalizeINatObservation).filter(Boolean)

    // If first page was full and we want more, fetch page 2
    if (page1.length >= 200 && limit > 200) {
      const res2 = await fetch(`${INAT_API}/observations?${new URLSearchParams({ ...baseParams, page: '2' })}`, {
        headers: { 'User-Agent': 'EarthAtlas/1.0 (https://earthatlas.org)' },
      })
      if (res2.ok) {
        const data2 = await res2.json()
        const page2 = (data2.results || []).map(normalizeINatObservation).filter(Boolean)
        return [...page1, ...page2]
      }
    }
    return page1
  } catch {
    return []
  }
}
