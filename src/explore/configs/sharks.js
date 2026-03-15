import { GBIF_TAXON_KEY, INAT_TAXON_ID, SPECIES_META, isShark } from '../species-data/sharks'
import { createExploreService } from '../shared-service'

const config = {
  slug: 'sharks',
  name: 'Sharks',
  emoji: '🦈',
  taxonLabel: 'shark',
  gbifTaxonKey: GBIF_TAXON_KEY,

  theme: {
    glow: '#c0392b',
    glowDim: 'rgba(192, 57, 43, 0.10)',
    glowMid: 'rgba(192, 57, 43, 0.25)',
  },

  hero: {
    bgColor: '#0a0a0a',
    image: '/shark-hero.jpg',
    eyebrow: 'EarthAtlas \u00b7 Shark Sightings',
    title: ['Find ', 'sharks.'],
    subtitle: 'Near you, or wherever you\u2019re going.',
    description: "Discover which sharks have been sighted near any coastline \u2014 and when they\u2019re most likely to be there.",
    accentColor: '#ff6b6b',
    navAccent: '#ff6b6b',
  },

  seo: {
    title: 'Shark Sightings Near You',
    description: "Discover which sharks have been sighted near any coastline \u2014 and when they're most likely to be there. Real-time data from GBIF and iNaturalist.",
    image: '/shark-hero.jpg',
  },

  defaults: {
    radiusKm: 400,
    days: 90,
    maxSightings: 500,
    zoom: 6,
  },

  fallback: {
    commonName: 'Unknown shark',
    color: '#e67e22',
    emoji: '🦈',
  },

  loading: {
    emoji: '🦈',
    message: 'Scanning the ocean near {location}\u2026',
    detail: 'Querying global biodiversity records for shark encounters',
  },

  empty: {
    emoji: '🦈',
    text: 'No sightings found nearby',
    sub: 'Try switching to Seasonal patterns to see historical data,<br />or search a different coastline.',
  },

  heatmapLayers: null,
  postFilter: isShark,
}

config.service = createExploreService({
  gbifTaxonKey: GBIF_TAXON_KEY,
  inatTaxonId: INAT_TAXON_ID,
  speciesMeta: SPECIES_META,
  fallback: config.fallback,
  postFilter: isShark,
})

export default config
