import { GBIF_TAXON_KEY, INAT_TAXON_ID, SPECIES_META } from '../species-data/dolphins'
import { createExploreService } from '../shared-service'

const config = {
  slug: 'dolphins',
  name: 'Dolphins',
  emoji: '🐬',
  taxonLabel: 'dolphin',
  gbifTaxonKey: GBIF_TAXON_KEY,

  theme: {
    glow: '#1a7a8a',
    glowDim: 'rgba(26, 122, 138, 0.10)',
    glowMid: 'rgba(26, 122, 138, 0.25)',
  },

  hero: {
    bgColor: '#031c2e',
    image: '/dolphin-hero.jpg',
    eyebrow: 'EarthAtlas \u00b7 Dolphin Sightings',
    title: ['Find ', 'dolphins.'],
    subtitle: 'Near you, or wherever you\u2019re going.',
    description: "Discover which dolphins have been spotted near any coastline \u2014 and when you\u2019re most likely to see them.",
    accentColor: '#7ecfd6',
    navAccent: '#7ecfd6',
  },

  seo: {
    title: 'Dolphin Sightings Near You',
    description: 'Find dolphin sightings near any coastline \u2014 seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',
    image: '/dolphin-hero.jpg',
  },

  defaults: {
    radiusKm: 300,
    days: 90,
    maxSightings: 500,
    zoom: 6,
  },

  fallback: {
    commonName: 'Unknown dolphin',
    color: '#1a7a8a',
    emoji: '🐬',
  },

  loading: {
    emoji: '🐬',
    message: 'Scanning for dolphins near {location}\u2026',
    detail: 'Querying global biodiversity records for dolphin sightings',
  },

  empty: {
    emoji: '🐬',
    text: 'No sightings found nearby',
    sub: 'Try switching to Seasonal patterns to see historical data,<br />or search a different coastline.',
  },

  inatTaxonId: INAT_TAXON_ID,
  newsQuery: 'dolphins ocean marine',
  postFilter: null,
}

config.service = createExploreService({
  gbifTaxonKey: GBIF_TAXON_KEY,
  inatTaxonId: INAT_TAXON_ID,
  speciesMeta: SPECIES_META,
  fallback: config.fallback,
  postFilter: null,
})

export default config
