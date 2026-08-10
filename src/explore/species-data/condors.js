// Condors are exactly two species — California Condor (Gymnogyps californianus)
// and Andean Condor (Vultur gryphus) — both monotypic, so species-level keys
// capture everything. Querying the family (Cathartidae 3242141 / iNat 71306)
// pulled in Turkey, Black, King, and Yellow-headed Vultures, which are not condors.
export const GBIF_TAXON_KEY = [2481920, 2481907]  // [California, Andean]
export const INAT_TAXON_ID = '4778,4747'          // [California, Andean]
// eBird species codes — fresh checklists surface here within minutes, vs the
// ~annual eBird→GBIF (EOD dataset) sync lag.
export const EBIRD_SPECIES_CODES = ['calcon', 'andcon1']  // [California, Andean]

// Only condor species keys — postFilter is defense-in-depth on top of the
// species-level queries above
const CONDOR_SPECIES_KEYS = new Set([
  2481920, // California Condor
  2481907, // Andean Condor
])

export function isCondor(occ) {
  return CONDOR_SPECIES_KEYS.has(occ.speciesKey)
}

export const SPECIES_META = {
  // ─── California Condor ────────────────────────────────────────────────────────
  2481920: {
    common: 'California Condor', scientific: 'Gymnogyps californianus',
    color: '#1a1a2e', emoji: '🦅',
    fact: 'With a wingspan of nearly 10 feet, the California Condor is the largest flying land bird in North America. Brought back from just 22 individuals in 1987, it remains one of conservation\'s greatest comeback stories.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/205288597/medium.jpg',
    iucn: 'CR',
  },

  // ─── Andean Condor ────────────────────────────────────────────────────────────
  2481907: {
    common: 'Andean Condor', scientific: 'Vultur gryphus',
    color: '#2c3e50', emoji: '🦅',
    fact: 'The Andean Condor has the largest wing area of any flying bird and can soar for over 100 miles without a single wingbeat, riding thermal currents above the Andes.',
    photoUrl: 'https://inaturalist-open-data.s3.amazonaws.com/photos/110654286/medium.jpg',
    iucn: 'VU',
  },
}
