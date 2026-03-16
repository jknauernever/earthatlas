import { GBIF_TAXON_KEY, INAT_TAXON_ID, SPECIES_META } from '../species-data/whales'
import { createExploreService } from '../shared-service'

const config = {
  slug: 'whales',
  name: 'Whales',
  emoji: '🐋',
  taxonLabel: 'cetacean',
  gbifTaxonKey: GBIF_TAXON_KEY,

  theme: {
    glow: '#0e8a72',
    glowDim: 'rgba(14, 138, 114, 0.10)',
    glowMid: 'rgba(14, 138, 114, 0.25)',
  },

  hero: {
    bgColor: '#041e42',
    image: '/whale-hero.jpg',
    eyebrow: 'EarthAtlas \u00b7 Cetacean Sightings',
    title: ['Find ', 'whales.'],
    subtitle: 'Near you, or wherever you\u2019re going.',
    description: "Discover which whales and dolphins have been seen near any coastline \u2014 and when you\u2019re most likely to see them.",
    accentColor: '#a8e6cf',
    navAccent: '#4dd9c0',
  },

  seo: {
    title: 'Whale Sightings Near You',
    description: 'Find whales near any coastline \u2014 see recent sightings, seasonal patterns, and species data powered by GBIF and iNaturalist.',
    image: '/whale-hero.jpg',
  },

  defaults: {
    radiusKm: 300,
    days: 90,
    maxSightings: 500,
    zoom: 6,
  },

  fallback: {
    commonName: 'Unknown cetacean',
    color: '#1a5276',
    emoji: '🐋',
  },

  loading: {
    emoji: '🐋',
    message: 'Scanning the ocean near {location}\u2026',
    detail: 'Querying global biodiversity records and Pacific coast sighting networks',
  },

  empty: {
    emoji: '🐋',
    text: 'No sightings found nearby',
    sub: 'Try switching to Seasonal patterns to see historical data,<br />or search a different coastline.',
  },

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
