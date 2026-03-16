export const GBIF_TAXON_KEY = 1494     // Pilosa (sloths + anteaters; filtered by postFilter)
export const INAT_TAXON_ID = 1317251  // Folivora (sloths only) on iNat

// Family keys for sloths — used to filter out anteaters from Pilosa results
const SLOTH_FAMILY_KEYS = new Set([
  9418,    // Bradypodidae (three-toed sloths)
  4692191, // Megalonychidae (two-toed sloths — GBIF classification)
])

// Species keys for sloths — backup filter when familyKey is missing
const SLOTH_SPECIES_KEYS = new Set([
  2436353, // Brown-throated three-toed sloth
  2436361, // Pale-throated three-toed sloth
  2436352, // Pygmy three-toed sloth
  2436351, // Maned sloth
  5219520, // Hoffmann's two-toed sloth
  5219519, // Linnaeus's two-toed sloth
])

export function isSloth(occ) {
  return SLOTH_FAMILY_KEYS.has(occ.familyKey) || SLOTH_SPECIES_KEYS.has(occ.speciesKey)
}

export const SPECIES_META = {
  // ─── Three-toed sloths (Bradypodidae) ─────────────────────────────────────────
  2436353: {
    common: 'Brown-throated Three-toed Sloth', scientific: 'Bradypus variegatus',
    color: '#8B7355', emoji: '🦥',
    fact: 'The most widespread sloth species — they move so slowly that algae grows on their fur, providing camouflage and a miniature ecosystem of moths and beetles.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/200780839/medium.jpg',
    iucn: 'LC',
  },
  2436361: {
    common: 'Pale-throated Three-toed Sloth', scientific: 'Bradypus tridactylus',
    color: '#9C8B6E', emoji: '🦥',
    fact: 'Can rotate their heads 270 degrees thanks to extra vertebrae in their necks — they have 8 or 9 cervical vertebrae compared to the 7 found in most other mammals.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/173543076/medium.jpg',
    iucn: 'LC',
  },
  2436352: {
    common: 'Pygmy Three-toed Sloth', scientific: 'Bradypus pygmaeus',
    color: '#A0522D', emoji: '🦥',
    fact: 'The world\'s most endangered sloth — found only on Isla Escudo de Veraguas off Panama, with fewer than 100 individuals remaining.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/1757875/medium.jpg',
    iucn: 'CR',
  },
  2436351: {
    common: 'Maned Sloth', scientific: 'Bradypus torquatus',
    color: '#6B4226', emoji: '🦥',
    fact: 'Endemic to Brazil\'s Atlantic Forest — named for the mane of long black hair running down their neck and shoulders, which is more prominent in males.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/109226411/medium.jpg',
    iucn: 'VU',
  },

  // ─── Two-toed sloths (Choloepodidae) ──────────────────────────────────────────
  5219520: {
    common: "Hoffmann's Two-toed Sloth", scientific: 'Choloepus hoffmanni',
    color: '#7B6B5A', emoji: '🦥',
    fact: 'Nocturnal and solitary — they sleep up to 20 hours a day and descend from the canopy only once a week to defecate, risking predation each time.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/233750668/medium.jpg',
    iucn: 'LC',
  },
  5219519: {
    common: "Linnaeus's Two-toed Sloth", scientific: 'Choloepus didactylus',
    color: '#8B7D6B', emoji: '🦥',
    fact: 'Despite their name, two-toed sloths actually have three toes — it\'s their fingers that number two. They can hang from branches using their claws even after death.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/197282735/medium.jpg',
    iucn: 'LC',
  },
}
