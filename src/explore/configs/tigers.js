import { GBIF_TAXON_KEY, INAT_TAXON_ID, SPECIES_META } from '../species-data/tigers'
import { createExploreService } from '../shared-service'

const config = {
  slug: 'tigers',
  name: 'Tigers',
  emoji: '🐯',
  taxonLabel: 'tiger',
  gbifTaxonKey: GBIF_TAXON_KEY,

  theme: {
    glow: '#e67e22',
    glowDim: 'rgba(230, 126, 34, 0.10)',
    glowMid: 'rgba(230, 126, 34, 0.25)',
  },

  hero: {
    bgColor: '#1a0e00',
    image: '/tiger-hero.jpg',
    eyebrow: 'EarthAtlas \u00b7 Tiger Sightings',
    title: ['Find ', 'tigers.'],
    subtitle: 'Near you, or wherever you\u2019re going.',
    description: "Discover where tigers have been sighted across their range \u2014 and when you\u2019re most likely to see them.",
    accentColor: '#ffb347',
    navAccent: '#ffb347',
  },

  seo: {
    title: 'Tiger Sightings Near You',
    description: 'Find tiger sightings and observations near any location \u2014 seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',
    image: '/tiger-hero.jpg',
  },

  defaults: {
    radiusKm: 200,
    days: 90,
    maxSightings: 500,
    zoom: 6,
  },

  fallback: {
    commonName: 'Unknown tiger',
    color: '#e67e22',
    emoji: '🐯',
  },

  loading: {
    emoji: '🐯',
    message: 'Searching for tigers near {location}\u2026',
    detail: 'Querying global biodiversity records for tiger sightings',
  },

  empty: {
    emoji: '🐯',
    text: 'No sightings found nearby',
    sub: 'Try switching to Seasonal patterns to see historical data,<br />or search a different region.',
  },

  heatmapLayers: null,
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
