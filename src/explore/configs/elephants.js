import { GBIF_TAXON_KEY, INAT_TAXON_ID, SPECIES_META } from '../species-data/elephants'
import { createExploreService } from '../shared-service'

const config = {
  slug: 'elephants',
  name: 'Elephants',
  emoji: '🐘',
  taxonLabel: 'elephant',
  gbifTaxonKey: GBIF_TAXON_KEY,

  theme: {
    glow: '#5a6e3e',
    glowDim: 'rgba(90, 110, 62, 0.10)',
    glowMid: 'rgba(90, 110, 62, 0.25)',
  },

  hero: {
    bgColor: '#1a1a0e',
    image: '/elephant-hero.jpg',
    eyebrow: 'EarthAtlas · Elephant Sightings',
    title: ['Find ', 'elephants.'],
    subtitle: 'Near you, or wherever you\'re going.',
    description: "Discover where elephants have been sighted across Africa and Asia — and when you're most likely to see them.",
    accentColor: '#a8c97e',
    navAccent: '#a8c97e',
  },

  seo: {
    title: 'Elephant Sightings Near You',
    description: 'Find elephant sightings and observations — seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',
    image: '/elephant-hero.jpg',
  },

  defaults: { radiusKm: 200, days: 90, maxSightings: 500, zoom: 6 },
  fallback: { commonName: 'Unknown elephant', color: '#5a6e3e', emoji: '🐘' },
  loading: { emoji: '🐘', message: 'Searching for elephants near {location}…', detail: 'Querying global biodiversity records for elephant sightings' },
  empty: { emoji: '🐘', text: 'No sightings found nearby', sub: 'Try switching to Seasonal patterns to see historical data,<br />or search a different region.' },
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
